import { describe, expect, it } from "vitest";
import { basisPoints, parseQuantity, parseRubles } from "./money.js";
import {
  INTERNAL_FIELDS, clientTotals, findInternalFields, projectActLine, projectEstimateItem,
  type EstimateItemRecord, type Role,
} from "./projection.js";

/** Позиция 3 действующей сметы: штукатурка стен по маякам. */
const позиция: EstimateItemRecord = {
  id: "itm-003",
  sectionId: "sec-01",
  order: 3,
  name: "Штукатурка стен по маякам (до 2,5 см)",
  unit: "м²",
  qty: parseQuantity("406,91"),
  qtyAccepted: parseQuantity("240"),
  unitPrice: parseRubles("900"),
  unitWage: parseRubles("350"),
};

describe("разграничение на уровне полей", () => {
  it("руководитель видит ставку, зарплату и прибыль", () => {
    const видимое = projectEstimateItem(позиция, "OWNER");
    expect(видимое.total).toBe(parseRubles("366 219,00"));
    expect(видимое.unitWage).toBe(parseRubles("350"));
    expect(видимое.wageTotal).toBe(parseRubles("142 418,50"));
    expect(видимое.profit).toBe(parseRubles("223 800,50"));
    expect(видимое.profitShare).toBe(6111n); // 61,11 %
  });

  it.each<Role>(["FOREMAN", "CLIENT"])("роль %s не получает внутренних ключей", (роль) => {
    const видимое = projectEstimateItem(позиция, роль);
    // Ключи отсутствуют, а не равны undefined: JSON.stringify опускает
    // undefined, но структурное сравнение и журналы — нет.
    for (const поле of INTERNAL_FIELDS) {
      expect(Object.hasOwn(видимое, поле)).toBe(false);
    }
    expect(видимое.total).toBe(parseRubles("366 219,00"));
    expect(видимое.qtyAccepted).toBe(parseQuantity("240"));
  });

  it("перечень внутренних полей совпадает с разницей двух проекций", () => {
    const руководитель = projectEstimateItem(позиция, "OWNER");
    const прораб = projectEstimateItem(позиция, "FOREMAN");
    const разница = Object.keys(руководитель).filter((k) => !Object.hasOwn(прораб, k)).sort();
    expect(разница).toEqual([...INTERNAL_FIELDS].sort());
  });
});

describe("клиентская проекция акта", () => {
  const строка = { ...позиция, qtyInAct: parseQuantity("240") };

  it("клиентская строка акта не содержит внутренних величин", () => {
    const клиенту = projectActLine(строка, "client");
    expect(клиенту.total).toBe(parseRubles("216 000,00"));
    expect(findInternalFields(клиенту)).toEqual([]);
  });

  it("внутренняя строка акта их содержит", () => {
    const внутрь = projectActLine(строка, "internal");
    expect(внутрь.wageTotal).toBe(parseRubles("84 000,00"));
    expect(findInternalFields(внутрь).sort()).toEqual(
      INTERNAL_FIELDS.map((f) => `$.${f}`).sort(),
    );
  });

  it("БП-07: надбавка сопровождения показывается отдельной строкой", () => {
    const итоги = clientTotals(parseRubles("3 356 052,10"), basisPoints(1200n));
    expect(итоги.supervision).toBe(parseRubles("402 726,25"));
    expect(итоги.total).toBe(parseRubles("3 758 778,35"));
    expect(findInternalFields(итоги)).toEqual([]);
  });
});

describe("поиск утечки внутренних полей", () => {
  it("находит внутреннее поле на любой глубине ответа", () => {
    const ответ = {
      project: { code: "R-99" },
      estimate: { sections: [{ items: [{ name: "Затирка", profit: 99000n }] }] },
    };
    expect(findInternalFields(ответ)).toEqual(["$.estimate.sections[0].items[0].profit"]);
  });

  it("чистый ответ не даёт ложного срабатывания", () => {
    const ответ = {
      project: { code: "R-99", address: "Московский проспект 116" },
      items: [projectEstimateItem(позиция, "FOREMAN")],
    };
    expect(findInternalFields(ответ)).toEqual([]);
  });
});
