import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Памятка прорабу называет только существующие органы (план, пункт 6.4).
 *
 * Памятка печатается и раздаётся прорабам, а продукт меняется: кнопку
 * переименуют, и лист на стене объекта будет называть орган, которого нет.
 * Подписи органов в памятке набраны классом `.ui`; каждая обязана стоять
 * строкой в исходниках экранов — в разметке или в словаре глаголов
 * (`verbs.ts`), откуда берут подписи кнопок заведения.
 */
const КОРЕНЬ = new URL("./", import.meta.url).pathname;
const ПАМЯТКА = readFileSync(new URL("../../../design/prorab.html", import.meta.url), "utf8");

const безКомментариев = (текст: string): string => текст
  .replace(/\{\/\*[\s\S]*?\*\/\}/gu, "")
  .replace(/\/\*[\s\S]*?\*\//gu, "")
  .replace(/^\s*\/\/.*$/gmu, "");

const исходники = readdirSync(КОРЕНЬ)
  .filter((имя) => /\.tsx?$/u.test(имя) && !имя.includes(".test.") && !имя.startsWith("api."))
  .map((имя) => безКомментариев(readFileSync(`${КОРЕНЬ}${имя}`, "utf8")))
  .join("\n");

const подписи = [...ПАМЯТКА.matchAll(/<span class="ui">([^<]+)<\/span>/gu)]
  .map((пара) => (пара[1] ?? "").replace(/\s+/gu, " ").trim());

describe("памятка прорабу", () => {
  it("подписи органов найдены: правило проверяет не пустое место", () => {
    expect(подписи.length).toBeGreaterThan(10);
  });

  it("каждая подпись органа стоит в исходниках экранов строкой", () => {
    const нет = [...new Set(подписи)].filter((подпись) =>
      !исходники.includes(`"${подпись}"`) && !исходники.includes(`>${подпись}<`)
      && !new RegExp(`>\\s*${подпись}\\s*<`, "u").test(исходники));
    expect(нет).toEqual([]);
  });
});
