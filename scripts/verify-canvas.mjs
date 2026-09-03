/**
 * Проверка артбордов дизайн-канвы.
 *
 * Артборд рендерится только внутри редактора канвы, поэтому увидеть дефект
 * раскладки глазами до публикации нельзя. Скрипт собирает из каждого
 * `.dc.html` обычную страницу (содержимое `<helmet>` уходит в `<head>`),
 * открывает её в объявленном размере и проверяет то, что проверяется
 * механически: горизонтальное переполнение, выход содержимого за высоту
 * артборда, типографские знаки в роли иконок, цвета мимо токенов,
 * ссылки на неопределённые токены и `position:absolute` без
 * позиционированного предка.
 */
import { chromium } from "playwright-core";
import { launchOptions, browserSource } from "./browser.mjs";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const canvasDir = join(dirname(fileURLToPath(import.meta.url)), "..", "design", "canvas");
const SHOTS = process.env.SHOTS ?? "/tmp/canvas";
mkdirSync(SHOTS, { recursive: true });

const layout = JSON.parse(readFileSync(join(canvasDir, "canvas.json"), "utf8"));
const problems = [];
const note = (file, detail) => problems.push(`${file}: ${detail}`);

/**
 * Знак в роли иконки — дефект только внутри элемента управления: тире как
 * значение («Без налога — »), кавычки-ёлочки и длинное тире в тексте
 * законны, а «‹» вместо стрелки на кнопке — нет.
 */
const GLYPH_ONLY = /^[\s‹›→←↑↓×✓✔✗✕−–—•▶◀▲▼☰⋮⌄⌃+]+$/;

const files = layout.artboards.map((board) => board.file);
for (const name of readdirSync(canvasDir).filter((n) => n.endsWith(".dc.html"))) {
  if (!files.includes(name)) note(name, "артборд не объявлен в canvas.json");
}

/** Собирает из артборда обычную страницу — так же, как это делает канва. */
function toPage(source) {
  const helmet = source.match(/<helmet>([\s\S]*?)<\/helmet>/);
  const body = source.slice(source.indexOf("</helmet>") + "</helmet>".length)
    .replace(/<\/?x-dc>/g, "")
    .replace(/<\/body>[\s\S]*$/, "");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">${helmet ? helmet[1] : ""}</head><body>${body}</body></html>`;
}

const browser = await chromium.launch(launchOptions());
console.log(`Браузер: ${browserSource()}`);

for (const board of layout.artboards) {
  const source = readFileSync(join(canvasDir, board.file), "utf8");

  // Статические правила: цвет мимо токена и ссылка на неопределённый токен.
  const style = source.match(/<style>([\s\S]*?)<\/style>/);
  const root = style ? style[1].slice(0, style[1].indexOf("}") + 1) : "";
  const defined = new Set([...root.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  // Переменную можно объявить и локально, в атрибуте style элемента.
  for (const [, token] of source.matchAll(/style="[^"]*?(--[a-z0-9-]+)\s*:/g)) defined.add(token);
  for (const [, token] of source.matchAll(/;\s*(--[a-z0-9-]+)\s*:/g)) defined.add(token);
  for (const [, token] of source.matchAll(/var\((--[a-z0-9-]+)/g)) {
    if (!defined.has(token)) note(board.file, `ссылка на неопределённый токен ${token}`);
  }
  /**
   * Цвет мимо токена. Разрешены только два места: объявление токенов в
   * `:root` и презентационные атрибуты SVG (`fill`, `stroke`, `stop-color`),
   * которым нельзя передать `var()`, — и там значение обязано совпадать со
   * значением объявленного токена. Всё прочее — дефект: именно так в канву
   * попадали придуманные оттенки, которых нет в палитре.
   */
  const palette = new Set([...root.matchAll(/:\s*(#[0-9a-fA-F]{3,8})\s*;/g)].map((m) => m[1].toLowerCase()));
  const afterRoot = style ? style[1].slice(root.length) : "";
  for (const [literal] of afterRoot.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    note(board.file, `цвет мимо токена в стилях: ${literal}`);
  }
  const svgAllowed = new Set();
  for (const [, attribute, value] of source.matchAll(/\b(fill|stroke|stop-color)="(#[0-9a-fA-F]{3,8})"/g)) {
    if (!palette.has(value.toLowerCase())) note(board.file, `${attribute}="${value}" — нет такого цвета в палитре`);
    svgAllowed.add(`${attribute}="${value}"`);
  }
  const markup = source.slice(source.indexOf("</helmet>"));
  for (const [literal] of markup.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const context = markup.slice(Math.max(0, markup.indexOf(literal) - 24), markup.indexOf(literal) + literal.length + 1);
    if (/\b(fill|stroke|stop-color)="$/.test(context.slice(0, context.length - literal.length - 1))) continue;
    if (/(fill|stroke|stop-color)="/.test(context)) continue;
    note(board.file, `цвет мимо токена в разметке: ${literal}`);
  }
  for (const [literal] of markup.matchAll(/\brgba?\([^)]*\)/g)) {
    note(board.file, `цвет мимо токена в разметке: ${literal}`);
  }

  const page = await browser.newPage({
    viewport: { width: board.w, height: board.h },
    locale: "ru-RU",
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.setContent(toPage(source), { waitUntil: "domcontentloaded" });

  const measured = await page.evaluate(() => {
    const out = { scrollWidth: document.documentElement.scrollWidth,
                  scrollHeight: document.documentElement.scrollHeight,
                  glyphs: [], orphans: [] };
    for (const element of document.querySelectorAll("*")) {
      const style = getComputedStyle(element);
      if (style.position === "absolute") {
        let parent = element.parentElement, anchored = false;
        while (parent) {
          const parentStyle = getComputedStyle(parent);
          if (parentStyle.position !== "static" || parentStyle.transform !== "none") { anchored = true; break; }
          parent = parent.parentElement;
        }
        if (!anchored) out.orphans.push(element.className || element.tagName);
      }
      if (element.children.length === 0 && element.textContent) {
        const control = element.closest("button, a, summary, [role='button'], [role='switch'], label");
        if (control) out.glyphs.push([control.tagName, element.textContent.trim()]);
      }
    }
    return out;
  });

  if (measured.scrollWidth > board.w + 1) {
    note(board.file, `горизонтальное переполнение: ${measured.scrollWidth} px при ширине ${board.w}`);
  }
  if (measured.scrollHeight > board.h + 1) {
    note(board.file, `содержимое выше артборда: ${measured.scrollHeight} px при высоте ${board.h}`);
  }
  for (const orphan of measured.orphans) {
    note(board.file, `position:absolute без позиционированного предка: ${orphan}`);
  }
  for (const [tag, text] of measured.glyphs) {
    if (text.length > 0 && GLYPH_ONLY.test(text)) {
      note(board.file, `знак в роли иконки внутри <${tag}>: «${text}»`);
    }
  }
  for (const error of errors) note(board.file, `консоль: ${error}`);

  await page.screenshot({ path: join(SHOTS, board.file.replace(".dc.html", ".png")), fullPage: true });
  await page.close();
}

await browser.close();

if (problems.length > 0) {
  console.error(`Дефектов: ${problems.length}\n` + problems.map((p) => `  ${p}`).join("\n"));
  process.exit(1);
}
console.log(`Артбордов проверено: ${layout.artboards.length}. Снимки в ${SHOTS}. Дефектов нет.`);
