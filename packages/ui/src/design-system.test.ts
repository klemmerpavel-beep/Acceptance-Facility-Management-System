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
  const markup = (): string => {
    const design = join(repoRoot, "design");
    const files = existsSync(design)
      ? readdirSync(design).filter((f) => f.endsWith(".html") && !f.startsWith("showcase.artifact"))
      : [];
    return files.map((f) => readFileSync(join(design, f), "utf8")).join("\n");
  };

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
    const consumers: string[] = [];
    const design = join(repoRoot, "design");
    if (existsSync(design)) {
      for (const file of readdirSync(design)) {
        if (file.endsWith(".html") && !file.startsWith("showcase.artifact")) {
          consumers.push(readFileSync(join(design, file), "utf8"));
        }
      }
    }
    const haystack = consumers.join("\n");
    const unused = [...declared].filter((name) => !new RegExp(`\\b${name}\\b`).test(haystack));
    expect(unused).toEqual([]);
  });
});
