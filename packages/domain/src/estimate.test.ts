import { describe, expect, it } from "vitest";
import { basisPoints, parseQuantity, parseRubles } from "./money.js";
import { buildEstimateView, type BuildEstimateInput, type SectionNode } from "./estimate.js";
import { findInternalFields, INTERNAL_FIELDS } from "./projection.js";

/**
 * Выборка из действующей сметы: раздел верхнего уровня с вложенным
 * подразделом, как «Кондиционирование» → «Черновой монтаж».
 */
const входные = (role: BuildEstimateInput["role"]): BuildEstimateInput => ({
  role,
  supervisionShare: basisPoints(1200n),
  otherExpenses: [
    { id: "e1", name: "Вывоз мусора (Камаз)", unit: "рейс", unitPrice: parseRubles("12000"), order: 1 },
  ],
  sections: [
    { id: "s1", parentId: null, name: "ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ", order: 1, sourceRow: 5 },
    { id: "s2", parentId: null, name: "КОНДИЦИОНИРОВАНИЕ (ПО ФАКТУ)", order: 2, sourceRow: 165 },
    { id: "s3", parentId: "s2", name: "Черновой монтаж", order: 3, sourceRow: 166 },
  ],
  items: [
    {
      id: "i1", sectionId: "s1", order: 1, name: "Штукатурка стен по маякам", unit: "м²",
      qty: parseQuantity("406,91"), qtyAccepted: parseQuantity("0"),
      unitPrice: parseRubles("900"), unitWage: parseRubles("350"),
    },
    {
      id: "i2", sectionId: "s1", order: 2, name: "Полусухая стяжка", unit: "м²",
      qty: parseQuantity("120,2"), qtyAccepted: parseQuantity("0"),
      unitPrice: parseRubles("1000"), unitWage: parseRubles("700"),
    },
    {
      id: "i3", sectionId: "s3", order: 3, name: "Сквозное отверстие Ф52 мм", unit: "шт",
      qty: parseQuantity("3"), qtyAccepted: parseQuantity("0"),
      unitPrice: parseRubles("3100"), unitWage: parseRubles("500"),
    },
  ],
});

const NBSP = " ";
const rub = (value: string): bigint => parseRubles(value.replace(new RegExp(NBSP, "g"), " "));

describe("сборка дерева разделов", () => {
  const view = buildEstimateView(входные("OWNER"));

  it("разделы собраны в дерево, вложенность отражена уровнем", () => {
    expect(view.sections.map((s) => s.name)).toEqual([
      "ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ",
      "КОНДИЦИОНИРОВАНИЕ (ПО ФАКТУ)",
    ]);
    expect(view.sections[1]?.children.map((s) => [s.name, s.level])).toEqual([["Черновой монтаж", 2]]);
    expect(view.sectionsTopLevel).toBe(2);
    expect(view.sectionsNested).toBe(1);
    expect(view.positions).toBe(3);
  });

  it("подытог раздела включает вложенные разделы", () => {
    // 406,91 × 900 + 120,2 × 1000 = 366 219 + 120 200
    expect(view.sections[0]?.subtotal).toBe(rub("486419"));
    // раздел верхнего уровня своих позиций не имеет: весь подытог из вложенного
    expect(view.sections[1]?.subtotal).toBe(rub("9300"));
    expect(view.sections[1]?.children[0]?.subtotal).toBe(rub("9300"));
  });

  it("БП-07: надбавка считается от итога по работам", () => {
    expect(view.totals.works).toBe(rub("495719"));
    expect(view.totals.supervision).toBe(rub("59486.28"));
    expect(view.totals.estimate).toBe(rub("555205.28"));
  });

  it("руководителю доступны фонд оплаты и прибыль", () => {
    expect(view.totals.wage).toBe(rub("228058.5"));
    expect(view.totals.profit).toBe(rub("267660.5"));
    expect(view.sections[0]?.subtotalWage).toBe(rub("226558.5"));
  });
});

describe("БП-09 и раздел 4 промта: разграничение на уровне полей действует на всей глубине", () => {
  it.each(["FOREMAN", "SUPPLY"] as const)("роль %s не получает внутренних величин нигде в ответе", (role) => {
    const view = buildEstimateView(входные(role));
    // Проверяется весь ответ целиком: позиция в третьем уровне вложенности —
    // такая же утечка, как поле в корне.
    expect(findInternalFields(view)).toEqual([]);
    expect(view.totals.wage).toBeUndefined();
    expect(view.sections.every(нетВнутренних)).toBe(true);
    // Публичные величины при этом на месте.
    expect(view.totals.works).toBe(rub("495719"));
    expect(view.sections[0]?.items).toHaveLength(2);
  });

  it("руководитель получает те же поля, что перечислены как внутренние", () => {
    const owner = buildEstimateView(входные("OWNER"));
    const item = owner.sections[0]?.items[0];
    for (const поле of INTERNAL_FIELDS) expect(Object.hasOwn(item ?? {}, поле)).toBe(true);
  });
});

const нетВнутренних = (node: SectionNode): boolean =>
  node.subtotalWage === undefined && node.children.every(нетВнутренних);
