import { describe, expect, it } from "vitest";
import { basisPoints, milliunits, parseQuantity, parseRubles } from "./money.js";
import {
  buildEstimateView, estimateItemFault, estimateItemMoveFault, estimateItemWarning,
  groupByStageRoom,
  measureSourcesFor, sectionWeights, БЕЗ_ПОМЕЩЕНИЯ, ВНЕ_ГРАФИКА,
  MEASURE_LABEL, MEASURE_SOURCES, measureSourceNote,
  type BuildEstimateInput, type GroupNode, type SectionNode,
  estimateItemRemovalFault,
  estimateSectionRemovalFault,
  estimateSectionNestingFault,
  isQtySource, measureDrift, measureDriftNote, projectSources, QTY_SOURCE_LABEL, QTY_SOURCES, qtySourceFault,
  qtySourceMismatch, qtySourceNote, qtySourceScope, qtySourceValue, surfaceFault, surfaceSources, SURFACE_KINDS,
  SURFACE_LABEL, type QtySourceRecord,
} from "./estimate.js";
import { measureTotals, type RoomMeasure, type WallMeasure } from "./measure.js";
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
    { id: "s1", parentId: null, name: "ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ", order: 1, sourceRow: 5,
      stage: "Демонтаж" },
    { id: "s2", parentId: null, name: "КОНДИЦИОНИРОВАНИЕ (ПО ФАКТУ)", order: 2, sourceRow: 165 },
    { id: "s3", parentId: "s2", name: "Черновой монтаж", order: 3, sourceRow: 166 },
  ],
  items: [
    {
      id: "i1", sectionId: "s1", order: 1, name: "Штукатурка стен по маякам", unit: "м²",
      qty: parseQuantity("406,91"), qtyAccepted: parseQuantity("0"),
      unitPrice: parseRubles("900"), unitWage: parseRubles("350"),
      room: { id: "r1", name: "Спальня", set: "INITIAL" },
    },
    {
      id: "i2", sectionId: "s1", order: 2, name: "Полусухая стяжка", unit: "м²",
      qty: parseQuantity("120,2"), qtyAccepted: parseQuantity("0"),
      unitPrice: parseRubles("1000"), unitWage: parseRubles("700"),
      room: { id: "r2", name: "Кухня", set: "INITIAL" },
    },
    {
      /* Порядок — место ВНУТРИ раздела: у первой позиции вложенного
         раздела он снова первый. Сквозной номер считает сборка вида. */
      id: "i3", sectionId: "s3", order: 1, name: "Сквозное отверстие Ф52 мм", unit: "шт",
      qty: parseQuantity("3"), qtyAccepted: parseQuantity("0"),
      unitPrice: parseRubles("3100"), unitWage: parseRubles("500"),
      /* Помещение не выбрано: так приходит всё, что импортировано из файла. */
      room: null,
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
  it.each(["FOREMAN", "CLIENT"] as const)("роль %s не получает внутренних величин нигде в ответе", (role) => {
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
  it("позиции в квадратных метрах предлагаются площадь пола и обе площади стен", () => {
    // Прежняя «площадь стен» — брутто — остаётся на месте; нетто встаёт рядом
    // третьей строкой (этап Э11, шаг 1), а не вместо неё.
    expect(measureSourcesFor("м²")).toEqual(["floorArea", "wallArea", "wallAreaNet"]);
    expect(MEASURE_LABEL.wallArea).toBe("площадь стен");
    expect(MEASURE_LABEL.wallAreaNet).toBe("площадь стен нетто");
  });

  it("источник подстановки называет помещение, величину и число", () => {
    expect(measureSourceNote("wallAreaNet", "Спальня", milliunits(43_740), "м²")).toBe(
      "Подставлено из обмера помещения «Спальня»: площадь стен нетто, 43,74\u00A0м²."
      + " Это копия: правка обмера количество не изменит.",
    );
    expect(measureSourceNote("wallArea", null, milliunits(262_953), "м²")).toBe(
      "Подставлено из обмера объекта: площадь стен, 262,953\u00A0м²."
      + " Это копия: правка обмера количество не изменит.",
    );
  });

  it("источник называет ровно подставленное число — до тысячной, а не округлённое", () => {
    // Санузел контрольной квартиры (measure.test.ts): 16,868 м² за вычетом
    // проёмов. В поле количества ложится «16,868»; «16,87» в строке
    // источника назвало бы не то число, что подставлено.
    expect(measureSourceNote("wallAreaNet", "Санузел", milliunits(16_868), "м²")).toContain(", 16,868\u00A0м².");
    expect(measureSourceNote("floorArea", "Санузел", milliunits(4_000), "м²")).toContain(", 4\u00A0м².");
  });

  it("число в погонных метрах кончает предложение одной точкой (П-78)", () => {
    // «м.п.» уже с точкой: прежде строка печаталась «17,6 м.п.. Это копия».
    expect(measureSourceNote("floorPerimeter", "Спальня", milliunits(17_600), "м.п.")).toBe(
      "Подставлено из обмера помещения «Спальня»: периметр пола, 17,6\u00A0м.п."
      + " Это копия: правка обмера количество не изменит.",
    );
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

describe("номер строки документа", () => {
  /* В хранении `order` — место позиции внутри своего раздела; номер в
     колонке «№» сквозной по документу и считается при сборке вида. Возьми
     номер из хранения — и после первой же перестановки в смете окажется два
     номера 47 и ни одного 61. */
  const вид = buildEstimateView(входные("OWNER"));
  const позиции = (узлы: readonly SectionNode[]): { order: number }[] =>
    узлы.flatMap((узел) => [...узел.items, ...позиции(узел.children)]);

  it("номера идут подряд от единицы, без пропусков и повторов", () => {
    const номера = позиции(вид.sections).map((позиция) => позиция.order);
    expect(номера).toEqual(Array.from({ length: вид.positions }, (_, i) => i + 1));
  });

  it("позиции раздела нумеруются раньше вложенных разделов", () => {
    /* Так они и показываются. Разойдясь, номер перестал бы быть номером
       строки: человек читает документ сверху вниз. */
    const кондиционирование = вид.sections.find((узел) => узел.children.length > 0);
    const свои = кондиционирование?.items.map((позиция) => позиция.order) ?? [];
    const вложенные = позиции(кондиционирование?.children ?? []).map((п) => п.order);
    if (свои.length > 0 && вложенные.length > 0) {
      expect(Math.max(...свои)).toBeLessThan(Math.min(...вложенные));
    }
  });
});

describe("группировка «Этап → Помещение → Категория»", () => {
  const вид = buildEstimateView(входные("OWNER"));
  /* Деньги домен держит целыми копейками; через HTTP они пойдут строкой.
     Преобразование — забота вызывающего, правило группировки одно. */
  type Позиция = (typeof вид.sections)[number]["items"][number];
  const деньги = (item: Позиция) => ({
    total: item.total as bigint,
    wage: "wageTotal" in item ? (item.wageTotal as bigint) : undefined,
  });
  const дерево = groupByStageRoom<Позиция>(вид.sections, деньги);

  const обойти = (узлы: readonly GroupNode<Позиция>[]): GroupNode<Позиция>[] =>
    узлы.flatMap((узел) => [узел, ...обойти(узел.children)]);

  it("итог группировки до копейки равен итогу работ", () => {
    /* Главный инвариант. Отбросьте разрез «Помещение не выбрано» — и
       группировка потеряет позиции молча: на экране всё по-прежнему
       выглядит сметой, а подвал разойдётся с подвалом первой группировки. */
    const сумма = дерево.reduce((всего, узел) => всего + узел.subtotal, 0n);
    expect(сумма).toBe(вид.totals.works);
  });

  it("позиций в группировке столько же, сколько в смете", () => {
    const сумма = дерево.reduce((всего, узел) => всего + узел.positions, 0);
    expect(сумма).toBe(вид.positions);
  });

  it("каждая позиция лежит ровно в одном листе", () => {
    const листья = обойти(дерево).filter((узел) => узел.kind === "category");
    const опознаватели = листья.flatMap((узел) => узел.items.map((item) => item.id));
    expect(опознаватели.length).toBe(вид.positions);
    expect(new Set(опознаватели).size).toBe(вид.positions);
  });

  it("раздел без этапа собирается в названный разрез, а не пропадает", () => {
    /* «Кондиционирование» этапа не ведёт. Позиция такого раздела обязана
       быть видна под именем, а не исчезнуть из дерева. */
    const вне = дерево.find((узел) => узел.label === ВНЕ_ГРАФИКА);
    expect(вне?.positions).toBe(1);
  });

  it("позиция без помещения собирается в названный разрез", () => {
    const без = обойти(дерево).find((узел) => узел.label === БЕЗ_ПОМЕЩЕНИЯ);
    expect(без?.positions).toBe(1);
  });

  it("вложенный раздел наследует этап корня своей ветви", () => {
    /* Приёмка сворачивает вложенные разделы в верхний, и этап у них общий.
       Разойдясь, группировка показала бы работу в одном этапе, а принять её
       предлагалось бы в другом. */
    const вне = дерево.find((узел) => узел.label === ВНЕ_ГРАФИКА);
    const категории = обойти(вне?.children ?? []).filter((узел) => узел.kind === "category");
    expect(категории.map((узел) => узел.label)).toContain("Черновой монтаж");
  });

  it("подытоги уровней сходятся сверху вниз", () => {
    for (const узел of обойти(дерево)) {
      if (узел.children.length === 0) continue;
      const снизу = узел.children.reduce((всего, ребёнок) => всего + ребёнок.subtotal, 0n);
      expect(снизу).toBe(узел.subtotal);
    }
  });

  it("клиентская проекция не несёт фонда оплаты ни на одном уровне", () => {
    const прорабу = buildEstimateView(входные("FOREMAN"));
    const клиенту = groupByStageRoom(прорабу.sections, (item) => ({
      total: item.total,
      wage: "wageTotal" in item ? item.wageTotal : undefined,
    }));
    expect(обойти(клиенту).every((узел) => узел.subtotalWage === undefined)).toBe(true);
    expect(findInternalFields(клиенту)).toEqual([]);
  });
});

describe("перенос позиции", () => {
  const основа = {
    name: "Штукатурка стен по маякам",
    unit: "м²",
    section: "МАЛЯРНЫЕ РАБОТЫ",
  };

  it("непринятая позиция переносится", () => {
    expect(estimateItemMoveFault({
      ...основа, accepted: parseQuantity("0"), changesSection: true,
    })).toBeNull();
  });

  it("принятая позиция не меняет раздела, и отказ называет принятое", () => {
    const отказ = estimateItemMoveFault({
      ...основа, accepted: parseQuantity("37,6"), changesSection: true,
    });
    /* Пробел между числом и единицей неразрывный: сверка по обычному
       молчала бы на верном тексте. */
    expect(отказ).toContain("37,60\u00A0м²");
    expect(отказ).toContain("МАЛЯРНЫЕ РАБОТЫ");
  });

  it("принятая позиция переставляется внутри своего раздела", () => {
    /* Порядок в приёмке не участвует вовсе: запрет здесь был бы запретом
       ради симметрии, а не ради целости данных. */
    expect(estimateItemMoveFault({
      ...основа, accepted: parseQuantity("37,6"), changesSection: false,
    })).toBeNull();
  });
});

describe("удаление позиции и раздела (план, пункт 7.3)", () => {
  it("принятая позиция не удаляется: отказ называет принятое и путь через сторно", () => {
    const отказ = estimateItemRemovalFault({ accepted: parseQuantity("12,5"), name: "Грунтовка стен", unit: "м²" });
    expect(отказ).toMatch(/принято 12,50\s?м²/u);
    expect(отказ).toContain("Сторнируйте приёмку");
  });

  it("позиция без принятого — в том числе после полного сторно — удаляется", () => {
    expect(estimateItemRemovalFault({ accepted: parseQuantity("0"), name: "Грунтовка стен", unit: "м²" })).toBeNull();
  });

  it("раздел удаляется только пустым, и отказ называет всё, что его держит", () => {
    const пустой = { name: "Отделка", items: 0, removed: 0, children: 0, batches: 0, stage: null, expenses: 0 };
    expect(estimateSectionRemovalFault(пустой)).toBeNull();
    const отказ = estimateSectionRemovalFault({ ...пустой, items: 3, batches: 1, stage: "Чистовая отделка" });
    expect(отказ).toContain("позиций — 3");
    expect(отказ).toContain("пакетов приёмки — 1");
    expect(отказ).toContain("этап графика «Чистовая отделка»");
    expect(estimateSectionRemovalFault({ ...пустой, removed: 1 })).toContain("снятых со сметы позиций");
  });

  it("раздел вкладывается только в раздел верхнего уровня", () => {
    expect(estimateSectionNestingFault(false)).toBeNull();
    expect(estimateSectionNestingFault(true)).toContain("верхнего уровня");
  });
});

/**
 * Адрес поверхности, источник подстановки и признак «обмер изменился»
 * (этап Э11, шаг 2; решения Э11-2.5 — Э11-2.7).
 *
 * Помещение — комната вымышленной квартиры шага 2 (`measure.test.ts`, Д6);
 * величины посчитаны там вручную: пол 12,000 м², периметры 13,200 и
 * 14,050 м.п., стены брутто 37,800 и нетто 34,020 м², откосы своей стороны
 * 9,300 м.п. (окно 4,300 + сторона А двери 5,000); стена 1 «у окна» —
 * 3,200 × 2,700 = 8,640 брутто, за вычетом окна 2,100 — 6,540 нетто.
 */
const ст = (id: string, length: number, label: string | null = null): WallMeasure =>
  ({ id, label, length: milliunits(length), height: null });
const СТЕНА_1 = ст("С1", 3_200, "у окна");
const КОМНАТА: RoomMeasure = {
  floorArea: milliunits(12_000), floorPerimeter: milliunits(13_200),
  ceilingPerimeter: milliunits(14_050), height: milliunits(2_700),
  walls: [СТЕНА_1, ст("С2", 3_800), ст("С3", 3_200), ст("С4", 3_800)],
  wallOpenings: [
    { id: "О1", kind: "WINDOW", width: milliunits(1_500), height: milliunits(1_400), wallId: "С1",
      adjoiningWallId: null, reveal: milliunits(4_300), adjoiningReveal: null },
    { id: "Д1", kind: "DOOR", width: milliunits(800), height: milliunits(2_100), wallId: "С3",
      adjoiningWallId: "Кр-С2", reveal: milliunits(5_000), adjoiningReveal: milliunits(4_200) },
  ],
};
const ИТОГИ = measureTotals([КОМНАТА]);
const контекст = { room: КОМНАТА, wall: СТЕНА_1, totals: ИТОГИ };

describe("адрес поверхности и подстановка по нему (Э11-2.5, Э11-2.6)", () => {
  it("пять видов поверхности, подписи — словами листа", () => {
    expect(SURFACE_KINDS).toEqual(["FLOOR", "CEILING", "WALLS", "WALL", "REVEALS"]);
    expect(SURFACE_KINDS.map((kind) => SURFACE_LABEL[kind])).toEqual(
      ["пол", "потолок", "все стены", "одна стена", "откосы"],
    );
  });

  it("без выбора поверхности — величины помещения шага 1", () => {
    expect(surfaceSources(null, "м²")).toEqual(["room:floorArea", "room:wallArea", "room:wallAreaNet"]);
    expect(surfaceSources(null, "м.п.")).toEqual(["room:floorPerimeter", "room:ceilingPerimeter"]);
  });

  it("величины выбранной поверхности по единице позиции", () => {
    expect(surfaceSources("FLOOR", "м²")).toEqual(["room:floorArea"]);
    expect(surfaceSources("FLOOR", "м.п.")).toEqual(["room:floorPerimeter"]);
    // Площади потолка обмер не знает: у потолка — площадь пола под своим именем.
    expect(surfaceSources("CEILING", "м²")).toEqual(["room:floorArea"]);
    expect(QTY_SOURCE_LABEL["room:floorArea"]).toBe("площадь пола");
    expect(surfaceSources("CEILING", "м.п.")).toEqual(["room:ceilingPerimeter"]);
    expect(surfaceSources("WALLS", "м²")).toEqual(["room:wallArea", "room:wallAreaNet"]);
    expect(surfaceSources("WALL", "м²")).toEqual(["wall:wallArea", "wall:wallAreaNet"]);
    expect(surfaceSources("REVEALS", "м.п.")).toEqual(["room:revealLength"]);
  });

  it("единице, которой поверхность не мерится, не предлагается ничего; штук нет", () => {
    expect(surfaceSources("WALL", "м.п.")).toEqual([]);
    expect(surfaceSources("REVEALS", "м²")).toEqual([]);
    for (const kind of SURFACE_KINDS) expect(surfaceSources(kind, "шт")).toEqual([]);
  });

  it("«из обмера объекта» — перечень шага 1, без откосов", () => {
    expect(projectSources("м²")).toEqual(["project:floorArea", "project:wallArea", "project:wallAreaNet"]);
    expect(projectSources("м.п.")).toEqual(["project:floorPerimeter", "project:ceilingPerimeter"]);
  });

  it("каждая строка перечня — с областью и подписью", () => {
    expect(QTY_SOURCES).toHaveLength(13);
    for (const source of QTY_SOURCES) expect(QTY_SOURCE_LABEL[source]).toBeTruthy();
    expect(qtySourceScope("wall:wallAreaNet")).toBe("wall");
    expect(qtySourceScope("room:revealLength")).toBe("room");
    expect(qtySourceScope("project:floorArea")).toBe("project");
    expect(isQtySource("room:wallAreaNet")).toBe(true);
    expect(isQtySource("wallAreaNet")).toBe(false);
    expect(isQtySource("project:revealLength")).toBe(false);
  });

  it("величина источника — тем же доменом, что экран обмера", () => {
    const величины = Object.fromEntries(QTY_SOURCES.map((source) => [source, qtySourceValue(source, контекст)]));
    expect(величины).toEqual({
      "room:floorArea": 12_000n, "room:wallArea": 37_800n, "room:wallAreaNet": 34_020n,
      "room:floorPerimeter": 13_200n, "room:ceilingPerimeter": 14_050n, "room:revealLength": 9_300n,
      "wall:wallArea": 8_640n, "wall:wallAreaNet": 6_540n,
      "project:floorArea": 12_000n, "project:wallArea": 37_800n, "project:wallAreaNet": 34_020n,
      "project:floorPerimeter": 13_200n, "project:ceilingPerimeter": 14_050n,
    });
    expect(qtySourceValue("wall:wallArea", { ...контекст, wall: null })).toBeNull();
    expect(qtySourceValue("room:floorArea", { ...контекст, room: null })).toBeNull();
    expect(qtySourceValue("project:floorArea", { ...контекст, totals: null })).toBeNull();
  });

  it("адрес: вид — только у помещения, стена — только у «одной стены»", () => {
    expect(surfaceFault({ roomId: "к", surface: "WALL", wallId: "С1" })).toBeNull();
    // Стена снята переводом на перепланировку — адрес законен, стену выберут заново.
    expect(surfaceFault({ roomId: "к", surface: "WALL", wallId: null })).toBeNull();
    expect(surfaceFault({ roomId: null, surface: null, wallId: null })).toBeNull();
    expect(surfaceFault({ roomId: null, surface: "FLOOR", wallId: null })).toBe(
      "Поверхность выбирается у помещения: сначала выберите помещение позиции.",
    );
    expect(surfaceFault({ roomId: "к", surface: "WALLS", wallId: "С1" })).toBe(
      "Стена выбирается только у поверхности «одна стена».",
    );
  });

  it("источник — только из того, что лист предложил бы этому адресу и единице", () => {
    const адрес = { roomId: "к", surface: "WALL" as const, wallId: "С1", unit: "м²" };
    expect(qtySourceFault("wall:wallAreaNet", адрес)).toBeNull();
    expect(qtySourceFault("project:wallAreaNet", адрес)).toBeNull();
    expect(qtySourceFault("room:wallAreaNet", адрес)).toBe(
      "Величина «площадь стен нетто» не относится к поверхности «одна стена» позиции в «м²».",
    );
    expect(qtySourceFault("wall:wallArea", { ...адрес, wallId: null })).toBe(
      "Величина «площадь стены» берётся со стены: выберите стену.",
    );
    expect(qtySourceFault("room:floorArea", { ...адрес, roomId: null, surface: null, wallId: null })).toBe(
      "Величина «площадь пола» берётся из обмера помещения: выберите помещение позиции.",
    );
    expect(qtySourceFault("project:floorPerimeter", адрес)).toBe(
      "Величина «периметр пола» объекта не подставляется позиции в «м²».",
    );
    expect(qtySourceFault("room:revealLength", { roomId: "к", surface: "REVEALS", wallId: null, unit: "м.п." }))
      .toBeNull();
  });

  it("подставляемое число обязано совпасть с величиной обмера сейчас", () => {
    expect(qtySourceMismatch(milliunits(6_540), milliunits(6_540), "м²")).toBeNull();
    expect(qtySourceMismatch(milliunits(6_540), milliunits(6_240), "м²")).toBe(
      "Подставлено 6,54\u00A0м², а в обмере сейчас 6,24\u00A0м²: обмер изменился, пока лист был открыт."
      + " Подставьте заново.",
    );
    expect(qtySourceMismatch(milliunits(6_540), null, "м²")).toContain("больше нет");
  });

  it("строка источника называет помещение, стену, величину и ровно подставленное число", () => {
    expect(qtySourceNote("wall:wallAreaNet", { room: "Комната", wall: "Стена 1 · у окна" }, milliunits(6_540), "м²"))
      .toBe("Подставлено из обмера помещения «Комната», стена «Стена 1 · у окна»: площадь стены нетто,"
        + " 6,54\u00A0м². Это копия: правка обмера количество не изменит.");
    expect(qtySourceNote("room:revealLength", { room: "Комната", wall: null }, milliunits(9_300), "м.п."))
      .toBe("Подставлено из обмера помещения «Комната»: длина откосов, 9,3\u00A0м.п."
        + " Это копия: правка обмера количество не изменит.");
    // Удалённые помещение и стена так и названы, а не выданы за итог объекта.
    expect(qtySourceNote("room:wallArea", { room: null, wall: null }, milliunits(37_800), "м²"))
      .toContain("Подставлено из обмера удалённого помещения: площадь стен, 37,8\u00A0м².");
    expect(qtySourceNote("wall:wallArea", { room: "Комната", wall: null }, milliunits(8_640), "м²"))
      .toContain("из обмера помещения «Комната», стена удалена: площадь стены, 8,64\u00A0м².");
    expect(qtySourceNote("project:wallAreaNet", { room: "Комната", wall: null }, milliunits(34_020), "м²"))
      .toBe("Подставлено из обмера объекта: площадь стен нетто, 34,02\u00A0м²."
        + " Это копия: правка обмера количество не изменит.");
  });
});

describe("признак «обмер изменился» (Э11-2.7)", () => {
  const источник: QtySourceRecord = { source: "wall:wallAreaNet", value: milliunits(6_540), roomId: "к", wallId: "С1" };

  it("величина та же — расхождения нет", () => {
    const признак = measureDrift(источник, "к", контекст);
    expect(признак).toEqual({ state: "same", now: 6_540n });
    expect(measureDriftNote(признак, источник.value, "м²")).toBeNull();
  });

  it("признак в погонных метрах — одной точкой", () => {
    const откосы: QtySourceRecord = { source: "room:revealLength", value: milliunits(9_000), roomId: "к", wallId: null };
    expect(measureDriftNote(measureDrift(откосы, "к", контекст), откосы.value, "м.п.")).toBe(
      "Подставлено 9\u00A0м.п., сейчас 9,3\u00A0м.п. Количество само не меняется.",
    );
  });

  it("окно стены 1 расширили до 1,500 × 1,600 = 2,400: подставлено 6,54, сейчас 6,24", () => {
    // 8,640 − 2,400 = 6,240. Количество позиции признак не трогает.
    const расширено: RoomMeasure = {
      ...КОМНАТА,
      wallOpenings: (КОМНАТА.wallOpenings ?? []).map((o) => (o.id === "О1" ? { ...o, height: milliunits(1_600) } : o)),
    };
    const признак = measureDrift(источник, "к", { ...контекст, room: расширено });
    expect(признак).toEqual({ state: "changed", now: 6_240n });
    expect(measureDriftNote(признак, источник.value, "м²")).toBe(
      "Подставлено 6,54\u00A0м², сейчас 6,24\u00A0м². Количество само не меняется.",
    );
  });

  it("помещение источника удалено — «источник удалён»", () => {
    const признак = measureDrift({ ...источник, roomId: null }, "к", { ...контекст, room: null });
    expect(признак).toEqual({ state: "removed", reason: "Помещения источника больше нет в обмере." });
    expect(measureDriftNote(признак, источник.value, "м²")).toBe(
      "Помещения источника больше нет в обмере. Количество само не меняется.",
    );
  });

  it("стена источника удалена — «источник удалён»", () => {
    expect(measureDrift({ ...источник, wallId: null }, "к", { ...контекст, wall: null })).toEqual(
      { state: "removed", reason: "Стены источника больше нет в обмере." },
    );
  });

  it("позицию перевели на помещение перепланировки — «источник удалён», хотя величина цела", () => {
    expect(measureDrift(источник, "к-после", контекст)).toEqual({
      state: "removed",
      reason: "Позицию перевели на обмер после перепланировки: источник остался в прежнем наборе.",
    });
  });

  it("итог объекта не удаляется: сравнивается с итогом действующего набора", () => {
    const объект: QtySourceRecord = { source: "project:floorArea", value: milliunits(80_530), roomId: null, wallId: null };
    expect(measureDrift(объект, null, контекст)).toEqual({ state: "changed", now: 12_000n });
  });
});
