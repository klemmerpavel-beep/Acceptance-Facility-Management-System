import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Памятка заказчику называет только существующие органы (этап Э8, ДР-11).
 *
 * Правило то же, что у памятки прорабу (`foreman-guide.test.ts`): памятка
 * печатается и отдаётся заказчику, а продукт меняется — и лист, называющий
 * вкладку, которой нет, хуже отсутствующего. Подписи органов набраны классом
 * `.ui`; каждая обязана стоять строкой в исходниках экранов. Вторым правилом
 * — три блока: памятка и экран первого входа называют их одними словами.
 */
const КОРЕНЬ = new URL("./", import.meta.url).pathname;
const ПАМЯТКА = readFileSync(new URL("../../../design/zakazchik.html", import.meta.url), "utf8");
const ЭКРАН = readFileSync(new URL("./ClientGuide.tsx", import.meta.url), "utf8");

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

describe("памятка заказчику", () => {
  it("подписи органов найдены: правило проверяет не пустое место", () => {
    expect(new Set(подписи).size).toBeGreaterThanOrEqual(8);
  });

  it("каждая подпись органа стоит в исходниках экранов строкой", () => {
    const нет = [...new Set(подписи)].filter((подпись) =>
      !исходники.includes(`"${подпись}"`) && !исходники.includes(`>${подпись}<`)
      && !new RegExp(`>\\s*${подпись}\\s*<`, "u").test(исходники));
    expect(нет).toEqual([]);
  });

  it("три блока экрана первого входа названы в памятке теми же словами", () => {
    for (const блок of ["Что вы здесь видите", "Что нужно от вас", "Как связаться"]) {
      expect(ЭКРАН).toContain(`>${блок}<`);
      expect(ПАМЯТКА).toContain(`<h2>${блок}</h2>`);
    }
  });
});
