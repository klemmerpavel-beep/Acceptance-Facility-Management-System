import { describe, expect, it } from "vitest";
import { basisPoints, parseQuantity, parseRubles } from "./money.js";
import {
  buildEstimateView, estimateItemFault, estimateItemWarning, measureSourcesFor,
  sectionWeights, MEASURE_LABEL, MEASURE_SOURCES,
  type BuildEstimateInput, type SectionNode,
} from "./estimate.js";
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

/* Правка позиции. Числа взяты из действующей сметы: «Штукатурка стен» —
   240,00 м² по 1 150,00 ₽ за м² при ставке 460,00 ₽ за м². */
const ПОЗИЦИЯ = {
  unit: "м²",
  unitPrice: parseRubles("1 150,00"),
  unitWage: parseRubles("460,00"),
};

describe("отказ при правке позиции", () => {
  it("позиция без приёмок уменьшается до любого положительного", () => {
    expect(estimateItemFault({
      ...ПОЗИЦИЯ, qty: parseQuantity("0,001"), accepted: parseQuantity("0"),
    })).toBeNull();
  });

  it("нулевое количество отклоняется и называет, что делать вместо", () => {
    expect(estimateItemFault({ ...ПОЗИЦИЯ, qty: parseQuantity("0"), accepted: parseQuantity("0") }))
      .toBe("Количество должно быть больше нуля. Ненужная позиция удаляется, а не обнуляется.");
  });

  it("отрицательное количество отклоняется", () => {
    expect(estimateItemFault({ ...ПОЗИЦИЯ, qty: parseQuantity("-1"), accepted: parseQuantity("0") }))
      .not.toBeNull();
  });

  it("уменьшение ровно до принятого допускается", () => {
    expect(estimateItemFault({
      ...ПОЗИЦИЯ, qty: parseQuantity("12"), accepted: parseQuantity("12"),
    })).toBeNull();
  });

  it("уменьшение на тысячную ниже принятого отклоняется с эталонным текстом", () => {
    expect(estimateItemFault({
      ...ПОЗИЦИЯ, qty: parseQuantity("11,999"), accepted: parseQuantity("12"),
    })).toBe(
      // \u00A0 — неразрывный пробел между числом и единицей: домен ставит его
      // намеренно, и обычный пробел в ожидании даёт ложное расхождение.
      "По этой позиции уже принято 12,00\u00A0м². Уменьшить количество ниже принятого "
      + "нельзя: сторнируйте приёмку или оставьте количество не ниже принятого.",
    );
  });

  it("отказ не называет запрошенное количество: в тысячных оно печатается так же", () => {
    /* 11,999 и 12,000 в двух знаках дают одно и то же «12,00». Текст, который
       называл бы оба числа, читался бы как «нельзя уменьшить до 12,00, потому
       что принято 12,00». Дефект найден собственным тестом до экрана. */
    const отказ = estimateItemFault({
      ...ПОЗИЦИЯ, qty: parseQuantity("11,999"), accepted: parseQuantity("12"),
    });
    expect(отказ?.indexOf("12,00")).toBe(отказ?.lastIndexOf("12,00"));
  });

  it("увеличение поверх принятого допускается", () => {
    expect(estimateItemFault({
      ...ПОЗИЦИЯ, qty: parseQuantity("300"), accepted: parseQuantity("12"),
    })).toBeNull();
  });

  it("отрицательная цена отклоняется", () => {
    expect(estimateItemFault({
      ...ПОЗИЦИЯ, qty: parseQuantity("240"), accepted: parseQuantity("0"),
      unitPrice: parseRubles("-1,00"),
    })).toBe("Цена единицы не может быть отрицательной.");
  });

  it("отрицательная ставка отклоняется", () => {
    expect(estimateItemFault({
      ...ПОЗИЦИЯ, qty: parseQuantity("240"), accepted: parseQuantity("0"),
      unitWage: parseRubles("-1,00"),
    })).toBe("Ставка оплаты труда не может быть отрицательной.");
  });

  it("нулевая ставка законна: у части позиций сметы маржа сто процентов", () => {
    expect(estimateItemFault({
      ...ПОЗИЦИЯ, qty: parseQuantity("240"), accepted: parseQuantity("0"),
      unitWage: parseRubles("0,00"),
    })).toBeNull();
  });
});

describe("предупреждение при правке позиции", () => {
  const основа = { qty: parseQuantity("240"), accepted: parseQuantity("0"), unit: "м²" };

  it("ставка ниже цены предупреждения не даёт", () => {
    expect(estimateItemWarning({ ...основа, ...ПОЗИЦИЯ })).toBeNull();
  });

  it("ставка вровень с ценой предупреждения не даёт: маржа ноль — законна", () => {
    expect(estimateItemWarning({
      ...основа, unitPrice: parseRubles("460,00"), unitWage: parseRubles("460,00"),
    })).toBeNull();
  });

  it("ставка выше цены предупреждает, но не отказывает", () => {
    const убыточная = {
      ...основа, unitPrice: parseRubles("460,00"), unitWage: parseRubles("1 150,00"),
    };
    expect(estimateItemWarning(убыточная)).toBe(
      "Ставка выше цены единицы: позиция уйдёт в убыток. Проверьте, не опечатка ли это.",
    );
    expect(estimateItemFault(убыточная)).toBeNull();
  });
});

describe("перенос величин обмера", () => {
  it("позиции в квадратных метрах предлагаются две площади", () => {
    expect(measureSourcesFor("м²")).toEqual(["floorArea", "wallArea"]);
  });

  it("позиции в погонных метрах предлагаются два периметра", () => {
    expect(measureSourcesFor("м.п.")).toEqual(["floorPerimeter", "ceilingPerimeter"]);
  });

  it("единице, которой в карте нет, не предлагается ничего", () => {
    expect(measureSourcesFor("шт")).toEqual([]);
    expect(measureSourcesFor("рейс")).toEqual([]);
  });

  it("у каждой предлагаемой величины есть подпись", () => {
    for (const unit of Object.keys(MEASURE_SOURCES)) {
      for (const source of measureSourcesFor(unit)) {
        expect(MEASURE_LABEL[source]).toBeTruthy();
      }
    }
  });
});

describe("разделы, которые может вести этап (5.2)", () => {
  const дерево = [
    {
      id: "s1", name: "ДЕМОНТАЖ",
      children: [
        { id: "s1a", name: "Мастер ванная", children: [] },
        { id: "s1b", name: "Кухня", children: [] },
      ],
    },
    { id: "s2", name: "ЭЛЕКТРОМОНТАЖ", children: [] },
  ];

  it("предлагаются разделы верхнего уровня в порядке сметы", () => {
    expect(sectionWeights(дерево).map((choice) => choice.name)).toEqual([
      "ДЕМОНТАЖ", "ЭЛЕКТРОМОНТАЖ",
    ]);
  });

  it("вложенный раздел не предлагается: приёмка его не видит", () => {
    expect(sectionWeights(дерево).some((choice) => choice.id === "s1a")).toBe(false);
  });

  it("пустая смета не даёт ни одной строки выбора", () => {
    expect(sectionWeights([])).toEqual([]);
  });

  it("раздел без итога весит ноль, а не ломает раскладку", () => {
    /* Лист выбора раздела итога не запрашивает, и поле необязательно.
       Ноль здесь означает «вес неизвестен», и раскладка делит окно
       поровну — это её правило, а не выдумка вызывающего. */
    expect(sectionWeights(дерево).every((section) => section.total === 0n)).toBe(true);
  });
});
