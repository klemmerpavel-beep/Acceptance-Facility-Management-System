import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Механическая проверка нормативных правил дизайн-системы.
 *
 * Документ `docs/03_DESIGN_SYSTEM.md` объявляет три правила, которые до сих пор
 * держались на внимательности: «значение мимо токена — дефект», «ни один цвет
 * не определяется только внутри медиазапроса» и запрет на типографские знаки
 * в роли иконок. Правило, которое никто не проверяет, нарушается на третьей
 * неделе. Здесь они проверяются.
 */

const stylesDir = join(import.meta.dirname, "styles");
const repoRoot = join(import.meta.dirname, "..", "..", "..");
const read = (file: string) => readFileSync(join(stylesDir, file), "utf8");

const TOKENS = read("tokens.css");
const OTHER_SHEETS = ["base.css", "layout.css", "components.css"].map((name) => ({
  name,
  css: read(name),
}));


/**
 * Всё, что потребляет слой стилей: витрина дизайн-системы и разметка
 * приложения. Проверка мёртвых правил обязана видеть обоих потребителей,
 * иначе класс, использованный только в приложении, читается как мёртвый.
 */
function consumerSources(): string[] {
  const sources: string[] = [];
  /**
   * Страницы витрины и слепка несут копию слоя стилей внутри <style>. Если её
   * не снять, проверка мёртвых правил становится тавтологией: каждый класс
   * «используется» собственным же правилом. В потребители идёт только разметка.
   */
  const markupOnly = (html: string): string => html.replace(/<style[\s\S]*?<\/style>/g, "");
  const design = join(repoRoot, "design");
  if (existsSync(design)) {
    for (const file of readdirSync(design)) {
      if (file.endsWith(".html") && !file.startsWith("showcase.artifact")) {
        sources.push(markupOnly(readFileSync(join(design, file), "utf8")));
      }
    }
  }
  const walk = (directory: string): void => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(tsx|ts|html)$/.test(entry.name)) {
        sources.push(markupOnly(readFileSync(path, "utf8")));
      }
    }
  };
  walk(join(repoRoot, "apps", "web", "src"));
  const indexHtml = join(repoRoot, "apps", "web", "index.html");
  if (existsSync(indexHtml)) sources.push(markupOnly(readFileSync(indexHtml, "utf8")));
  return sources;
}

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/g;
const TOKEN_DEFINITION = /(--[a-z0-9-]+)\s*:\s*([^;]+);/g;
const TOKEN_REFERENCE = /var\((--[a-z0-9-]+)/g;

const definitionsIn = (css: string): Map<string, string> => {
  const found = new Map<string, string>();
  for (const match of css.matchAll(TOKEN_DEFINITION)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) found.set(name, value.trim());
  }
  return found;
};

describe("значение мимо токена — дефект", () => {
  it.each(OTHER_SHEETS)("$name не содержит литералов цвета", ({ css }) => {
    const literals = css.match(COLOR_LITERAL) ?? [];
    expect(literals).toEqual([]);
  });

  it("каждый упомянутый токен где-то определён", () => {
    const defined = new Set<string>();
    for (const css of [TOKENS, ...OTHER_SHEETS.map((s) => s.css)]) {
      for (const name of definitionsIn(css).keys()) defined.add(name);
    }
    const referenced = new Set<string>();
    for (const css of [TOKENS, ...OTHER_SHEETS.map((s) => s.css)]) {
      for (const match of css.matchAll(TOKEN_REFERENCE)) {
        if (match[1] !== undefined) referenced.add(match[1]);
      }
    }
    // Локальные свойства компонентов объявляются через var(--x, запасное)
    // и определяются в разметке, а не в стилях: они исключены.
    const componentLocal = new Set(["--stack-gap", "--row-gap", "--level"]);
    const missing = [...referenced].filter((n) => !defined.has(n) && !componentLocal.has(n));
    expect(missing).toEqual([]);
  });
});

describe("ни один цвет не определяется только внутри медиазапроса", () => {
  const base = definitionsIn(TOKENS.slice(0, TOKENS.indexOf("@media (prefers-color-scheme")));
  const mediaBlock = TOKENS.slice(
    TOKENS.indexOf("@media (prefers-color-scheme"),
    TOKENS.indexOf(':root[data-theme="dark"]'),
  );
  const explicitBlock = TOKENS.slice(TOKENS.indexOf(':root[data-theme="dark"]'));

  it("базовый :root объявляет все токены до переопределения темой", () => {
    const overridden = [...definitionsIn(mediaBlock).keys(), ...definitionsIn(explicitBlock).keys()];
    const declaredOnlyInTheme = overridden.filter((name) => !base.has(name));
    expect(declaredOnlyInTheme).toEqual([]);
  });

  it("системная тёмная тема и явный переключатель задают одно и то же", () => {
    const bySystem = definitionsIn(mediaBlock);
    const byToggle = definitionsIn(explicitBlock);
    expect(Object.fromEntries(byToggle)).toEqual(Object.fromEntries(bySystem));
  });
});

describe("иконки", () => {
  /** Разметка, которую сегодня потребляет слой стилей. */
  const markup = (): string => consumerSources().join("\n");

  it("типографские знаки и эмодзи не используются в роли иконок", () => {
    // Геометрические знаки, стрелки, эмодзи — всё, что подменяет иконку глифом.
    const glyphAsIcon = /aria-hidden="true"\s*>\s*[^<\s][^<]*</g;
    const found = markup().match(glyphAsIcon) ?? [];
    expect(found).toEqual([]);
  });
});

describe("мёртвые правила", () => {
  it("каждый объявленный класс используется в разметке", () => {
    const declared = new Set<string>();
    for (const { css } of OTHER_SHEETS) {
      for (const match of css.matchAll(/^\.([a-z][a-z0-9_-]*)/gm)) {
        if (match[1] !== undefined) declared.add(match[1]);
      }
    }
    const haystack = consumerSources().join("\n");
    const unused = [...declared].filter((name) => !new RegExp(`\\b${name}\\b`).test(haystack));
    expect(unused).toEqual([]);
  });
});

/**
 * Контраст. Раздел 7 норматива требует 4,5:1 для основного текста, и до сих
 * пор это требование держалось на глаз: шесть пар светлой темы ему не
 * отвечали, включая подписи внутренних колонок сметы. Проверка считает
 * отношение яркостей по WCAG и не даёт правке палитры вернуть недобор.
 */
describe("контраст текста к фону не ниже 4,5:1", () => {
  const solid = (css: string): Map<string, string> => {
    const found = new Map<string, string>();
    for (const [, name, value] of css.matchAll(/(--[a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) {
      if (name !== undefined && value !== undefined) found.set(name, value);
    }
    return found;
  };

  const light = solid(TOKENS.slice(0, TOKENS.indexOf("@media (prefers-color-scheme")));
  const dark = solid(TOKENS.slice(TOKENS.indexOf(':root[data-theme="dark"]')));

  /** Относительная яркость по определению WCAG 2.1. */
  const luminance = (hex: string): number => {
    const channel = (offset: number): number => {
      const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  };

  const contrast = (foreground: string, background: string): number => {
    const a = luminance(foreground);
    const b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };

  /** Пары «текст на поверхности», которые действительно встречаются в
   *  компонентах. Список ведётся руками: механически из CSS его не вывести —
   *  какой токен ляжет под какой, решает разметка. */
  const PAIRS: ReadonlyArray<readonly [string, string, string]> = [
    ["--ink", "--bg", "основной текст на полотне"],
    ["--ink", "--surface", "основной текст на карточке"],
    ["--ink", "--surface-2", "основной текст на вторичной плашке"],
    ["--ink-2", "--surface", "вторичный текст на карточке"],
    ["--ink-2", "--surface-2", "вторичный текст на вторичной плашке"],
    ["--ink-2", "--neutral-soft", "нейтральная пилюля"],
    ["--ink-3", "--surface", "подписи на карточке"],
    ["--ink-3", "--surface-2", "подписи внутренних колонок сметы"],
    ["--ink-3", "--bg", "подписи на полотне"],
    ["--accent", "--surface", "ссылка и текстовая кнопка"],
    ["--accent", "--surface-2", "выбранный переключатель темы в шапке"],
    ["--accent", "--accent-soft", "код объекта на бейдже"],
    ["--accent-ink", "--accent", "текст на акцентной заливке"],
    ["--band-ink", "--band", "текст и иконки в шапке и обложке"],
    ["--band-active-ink", "--band-active", "выбранный раздел навигации"],
    ["--ok", "--ok-soft", "пилюля «Принято»"],
    ["--warn", "--warn-soft", "пилюля «Черновик»"],
    ["--signal", "--signal-soft", "пилюля перевыработки транша"],
    ["--danger", "--danger-soft", "пилюля «Сторно»"],
    ["--danger", "--surface", "сумма расхождения"],
    ["--ink-inv", "--danger", "текст на опасной кнопке"],
  ];

  const themes: ReadonlyArray<readonly [string, Map<string, string>]> = [
    ["светлая", light],
    ["тёмная", dark],
  ];

  it.each(themes)("%s тема: каждая пара проходит норму", (_name, theme) => {
    const failures: string[] = [];
    for (const [foreground, background, label] of PAIRS) {
      const fg = theme.get(foreground);
      const bg = theme.get(background);
      if (fg === undefined || bg === undefined) {
        failures.push(`${label}: токен не найден (${foreground}, ${background})`);
        continue;
      }
      const ratio = contrast(fg, bg);
      if (ratio < 4.5) failures.push(`${label}: ${ratio.toFixed(2)} (${fg} на ${bg})`);
    }
    expect(failures).toEqual([]);
  });
});
