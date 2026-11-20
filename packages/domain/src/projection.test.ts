import { describe, expect, it } from "vitest";
import { accrualAmount } from "./acceptance.js";
import { basisPoints, kopecks, negateQuantity, parseQuantity, parseRubles } from "./money.js";
import {
  INTERNAL_FIELDS, OWNER_LEVEL, actLineWage, clientTotals, findInternalFields, ownerLevel,
  projectActLine, projectEstimateItem,
  type ActLineAccrual, type EstimateItemRecord, type Role,
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
  room: { id: "room-01", name: "Спальня", set: "INITIAL" },
};

describe("роли, наследующие руководителя", () => {
  it("перечень назван и содержит бухгалтера", () => {
    /* Решение заказчика от 19.09.2026: бухгалтеру открыто всё, что открыто
       руководителю, кроме настроек и выдачи входа. */
    expect([...OWNER_LEVEL].sort()).toEqual(["ACCOUNTANT", "OWNER"]);
  });

  it.each<Role>(["OWNER", "ACCOUNTANT"])("роль %s наследует руководителя", (роль) => {
    expect(ownerLevel(роль)).toBe(true);
  });

  it.each<Role>(["FOREMAN", "CLIENT"])("роль %s его не наследует", (роль) => {
    expect(ownerLevel(роль)).toBe(false);
  });

  it("роль без сессии руководителя не наследует", () => {
    /* Страж сервера спрашивает тот же предикат и получает `undefined`, когда
       сессии нет. Ответ «да» открыл бы продукт невошедшему. */
    expect(ownerLevel(undefined)).toBe(false);
  });
});

describe("разграничение на уровне полей", () => {
  it("руководитель видит ставку, зарплату и прибыль", () => {
    const видимое = projectEstimateItem(позиция, "OWNER");
    expect(видимое.total).toBe(parseRubles("366 219,00"));
    expect(видимое.unitWage).toBe(parseRubles("350"));
    expect(видимое.wageTotal).toBe(parseRubles("142 418,50"));
    expect(видимое.profit).toBe(parseRubles("223 800,50"));
    expect(видимое.profitShare).toBe(6111n); // 61,11 %
  });

  it("бухгалтер видит те же внутренние величины, что и руководитель", () => {
    /* Ответ заказчика на вопрос 7 квиза от 19.09.2026. Перечень
       `INTERNAL_FIELDS` не изменился составом, но изменился смыслом: он
       отвечает на вопрос «чего не видят прораб и заказчик», а не «что видит
       один руководитель». */
    expect(projectEstimateItem(позиция, "ACCOUNTANT")).toEqual(
      projectEstimateItem(позиция, "OWNER"),
    );
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

  it.each<Role>(["FOREMAN", "CLIENT"])("роль %s получает помещение позиции", (роль) => {
    /* Помещение внутренней величиной не является, и прорабу оно нужнее
       прочих: он принимает помещение, а не позицию (довод при пакете
       приёмки в схеме). Отбор по роли не должен унести его заодно с
       деньгами — правило стережёт именно это. */
    const видимое = projectEstimateItem(позиция, роль);
    expect(видимое.room).toEqual({ id: "room-01", name: "Спальня", set: "INITIAL" });
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
  const принято = (qty: string, ставка: string): ActLineAccrual => {
    const количество = parseQuantity(qty);
    const снимок = parseRubles(ставка);
    return { qty: количество, unitWage: снимок, amount: accrualAmount(снимок, количество) };
  };

  it("клиентская строка акта не содержит внутренних величин", () => {
    const клиенту = projectActLine(строка, "client");
    expect(клиенту.total).toBe(parseRubles("216 000,00"));
    expect(findInternalFields(клиенту)).toEqual([]);
  });

  it("внутренняя строка акта их содержит", () => {
    const внутрь = projectActLine(строка, "internal", actLineWage([принято("240", "350")]));
    expect(внутрь.wageTotal).toBe(parseRubles("84 000,00"));
    expect(findInternalFields(внутрь).sort()).toEqual(
      INTERNAL_FIELDS.map((f) => `$.${f}`).sort(),
    );
  });

  /* П-60, решение В-1 от 07.11.2026: «начислено» внутреннего акта — сумма
     начислений приёмок строки, а не ставка сметы на день вывода или
     подписи. Опыт решения: приёмка 1 ед. по ставке 5 000,00 ₽, затем
     правка ставки сметы до 5 100,00 ₽ — начислено 5 000,00 ₽. */
  it("правка ставки после приёмки «начислено» акта не меняет", () => {
    const опыт = { name: "Монтаж", unit: "шт", unitPrice: parseRubles("6 000"), qtyInAct: parseQuantity("1") };
    const внутрь = projectActLine(опыт, "internal", actLineWage([принято("1", "5 000")]));
    expect(внутрь.unitWage).toBe(parseRubles("5 000"));
    expect(внутрь.wageTotal).toBe(parseRubles("5 000"));
    expect(внутрь.profit).toBe(parseRubles("1 000"));
    expect(внутрь.profitShare).toBe(basisPoints(1667n));
  });

  it("сумма — точная сумма начислений, а не ставка на суммарное количество", () => {
    /* Две приёмки по 0,5 ед. по ставке 0,01 ₽: каждая округляется половиной
       вверх до копейки — начислено 0,02 ₽, а 1 ед. × 0,01 ₽ дала бы 0,01 ₽. */
    const начислено = actLineWage([принято("0,5", "0,01"), принято("0,5", "0,01")]);
    expect(начислено.wageTotal).toBe(kopecks(2));
    expect(начислено.unitWage).toBe(kopecks(1));
  });

  it("ставку правили между приёмками — ставки нет, начислено точное", () => {
    const начислено = actLineWage([принято("2", "350"), принято("1", "370")]);
    expect(начислено.unitWage).toBeNull();
    expect(начислено.wageTotal).toBe(parseRubles("1 070"));
  });

  it("пара «приёмка и её сторно» ставки строки не задаёт", () => {
    const отменённая = принято("2", "350");
    const сторно = {
      qty: negateQuantity(отменённая.qty),
      unitWage: отменённая.unitWage,
      amount: accrualAmount(отменённая.unitWage, negateQuantity(отменённая.qty)),
    };
    const начислено = actLineWage([отменённая, сторно, принято("1", "370")]);
    expect(начислено.unitWage).toBe(parseRubles("370"));
    expect(начислено.wageTotal).toBe(parseRubles("370"));
  });

  it("строка, сторнированная целиком, — ноль по ставке пары", () => {
    const отменённая = принято("2", "350");
    const начислено = actLineWage([отменённая, {
      qty: negateQuantity(отменённая.qty),
      unitWage: отменённая.unitWage,
      amount: accrualAmount(отменённая.unitWage, negateQuantity(отменённая.qty)),
    }]);
    expect(начислено).toEqual({ unitWage: parseRubles("350"), wageTotal: kopecks(0) });
  });

  it("строка без начислений — ноль и без ставки", () => {
    expect(actLineWage([])).toEqual({ unitWage: null, wageTotal: kopecks(0) });
  });

  it("внутренняя строка без начисленного не считается", () => {
    expect(() => projectActLine(строка, "internal", undefined as never)).toThrow(TypeError);
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
