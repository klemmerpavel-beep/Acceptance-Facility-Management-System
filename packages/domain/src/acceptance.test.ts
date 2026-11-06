import { describe, expect, it } from "vitest";
import {
  acceptanceFault,
  acceptedQty,
  acceptedShare,
  acceptedTotal,
  accrualAmount,
  accrualSummary,
  minimumQty,
  remainingQty,
  requestedByItem,
  sectionFault,
  type AccrualRecord,
} from "./acceptance.js";
import {
  add, kopecks, milliunits, negate, negateQuantity, parseQuantity, parseRubles,
} from "./money.js";

/* Числа взяты из разбора действующей сметы «Московский проспект 116»:
   позиция «Штукатурка стен» — 240,00 м² по 1 150,00 ₽ за м² при ставке
   460,00 ₽ за м². Ставка и цена — из внутренней проекции, поэтому в тесте
   они названы прямо, а в ответе прорабу их нет. */
const КОЛИЧЕСТВО = parseQuantity("240");
const ЦЕНА = parseRubles("1 150,00");
const СТАВКА = parseRubles("460,00");

describe("принятое количество", () => {
  it("пустой список даёт честный ноль", () => {
    expect(acceptedQty([])).toBe(0n);
  });

  it("складывает приёмки", () => {
    expect(acceptedQty([{ qty: parseQuantity("80") }, { qty: parseQuantity("60,5") }]))
      .toBe(parseQuantity("140,5"));
  });

  it("сторно уменьшает принятое отрицательным количеством", () => {
    const принято = parseQuantity("80");
    expect(acceptedQty([{ qty: принято }, { qty: negateQuantity(принято) }])).toBe(0n);
  });

  it("остаток есть количество позиции минус принятое", () => {
    expect(remainingQty(КОЛИЧЕСТВО, parseQuantity("140,5"))).toBe(parseQuantity("99,5"));
  });

  it("отрицательный остаток не подрезается нулём", () => {
    // Правило БП-02 такого не допускает; если остаток ушёл в минус, его
    // обязано быть видно, а не спрятано.
    expect(remainingQty(parseQuantity("10"), parseQuantity("12"))).toBe(parseQuantity("-2"));
  });
});

describe("отказ приёмки (БП-02)", () => {
  const позиция = { qty: КОЛИЧЕСТВО, unit: "м²" };

  it("частичная приёмка проходит", () => {
    expect(acceptanceFault({ ...позиция, requested: parseQuantity("80"), accepted: milliunits(0) }))
      .toBeNull();
  });

  it("приёмка ровно до остатка проходит", () => {
    expect(acceptanceFault({ ...позиция, requested: parseQuantity("100"), accepted: parseQuantity("140") }))
      .toBeNull();
  });

  it("превышение на одну тысячную отклоняется", () => {
    const отказ = acceptanceFault({
      ...позиция, requested: parseQuantity("100,001"), accepted: parseQuantity("140"),
    });
    expect(отказ).toContain("по смете осталось");
  });

  it("отказ называет остаток и говорит, что делать", () => {
    expect(acceptanceFault({ ...позиция, requested: parseQuantity("12"), accepted: parseQuantity("231,6") }))
      .toBe("Нельзя принять 12,00\u00A0м² — по смете осталось 8,40\u00A0м². "
        + "Уменьшите количество или измените смету.");
  });

  it("нулевое и отрицательное количество приёмкой не является", () => {
    for (const сколько of ["0", "-5"]) {
      expect(acceptanceFault({ ...позиция, requested: parseQuantity(сколько), accepted: milliunits(0) }))
        .toBe("Количество должно быть больше нуля. Снятие принятого делается сторно.");
    }
  });

  it("после сторно остаток возвращается и приёмка снова проходит", () => {
    const принято = acceptedQty([{ qty: parseQuantity("240") }, { qty: parseQuantity("-240") }]);
    expect(acceptanceFault({ ...позиция, requested: КОЛИЧЕСТВО, accepted: принято })).toBeNull();
  });
});

describe("повтор позиции в одном пакете (БП-02)", () => {
  const позиция = { qty: КОЛИЧЕСТВО, unit: "м²", accepted: milliunits(0) };

  it("строки одной позиции складываются", () => {
    const сведено = requestedByItem([
      { itemId: "штукатурка", qty: parseQuantity("80") },
      { itemId: "грунт", qty: parseQuantity("12") },
      { itemId: "штукатурка", qty: parseQuantity("60,5") },
    ]);
    expect([...сведено]).toEqual([
      ["штукатурка", parseQuantity("140,5")],
      ["грунт", parseQuantity("12")],
    ]);
  });

  it("позиция дважды на весь остаток отклоняется по сумме запроса", () => {
    /* Каждая строка сама по себе проходит: остаток 240 м², отмечено 240 м².
       Пакет из двух таких строк принимал 480 м² — вдвое больше сметы. */
    const строки = [
      { itemId: "штукатурка", qty: КОЛИЧЕСТВО },
      { itemId: "штукатурка", qty: КОЛИЧЕСТВО },
    ];
    for (const строка of строки) {
      expect(acceptanceFault({ ...позиция, requested: строка.qty })).toBeNull();
    }
    const сведено = requestedByItem(строки).get("штукатурка") ?? milliunits(0);
    expect(acceptanceFault({ ...позиция, requested: сведено }))
      .toBe("Нельзя принять 480,00\u00A0м² — по смете осталось 240,00\u00A0м². "
        + "Уменьшите количество или измените смету.");
  });
});

describe("позиция и раздел пакета (БП-03)", () => {
  /* Раздел «Отделка» вложен в «Стены»: позиция вложенного раздела
     принимается пакетом верхнего. «Электрика» — другой верхний раздел. */
  const верхний = new Map([["стены", "стены"], ["отделка", "стены"], ["электрика", "электрика"]]);
  const стены = { id: "стены", name: "Стены" };

  it("позиция своего раздела входит в пакет", () => {
    expect(sectionFault({ name: "Штукатурка стен", sectionId: "стены" }, стены, верхний)).toBeNull();
  });

  it("позиция вложенного раздела входит в пакет верхнего", () => {
    expect(sectionFault({ name: "Шпаклёвка", sectionId: "отделка" }, стены, верхний)).toBeNull();
  });

  it("позиция другого раздела отклоняется с названием позиции и раздела", () => {
    expect(sectionFault({ name: "Прокладка кабеля", sectionId: "электрика" }, стены, верхний))
      .toBe("Позиция «Прокладка кабеля» не относится к разделу «Стены». "
        + "Пакет принимает позиции одного раздела: отметьте её в пакете своего раздела.");
  });

  it("вложенный раздел пакетом не является: его позиции принимает верхний", () => {
    const отделка = { id: "отделка", name: "Отделка" };
    expect(sectionFault({ name: "Шпаклёвка", sectionId: "отделка" }, отделка, верхний))
      .toContain("не относится к разделу «Отделка»");
  });
});

describe("начисление (БП-03, БП-04)", () => {
  it("сумма есть ставка, умноженная на количество", () => {
    // 460,00 ₽ × 80,000 м² = 36 800,00 ₽
    expect(accrualAmount(СТАВКА, parseQuantity("80"))).toBe(parseRubles("36 800,00"));
  });

  it("дробное количество округляется единственным правилом", () => {
    // 460,00 ₽ × 18,405 м² = 8 466,30 ₽ ровно.
    expect(accrualAmount(СТАВКА, parseQuantity("18,405"))).toBe(parseRubles("8 466,30"));
  });

  it("начисление и его сторно складываются в ноль", () => {
    const начислено = accrualAmount(СТАВКА, parseQuantity("18,405"));
    const сторно = accrualAmount(СТАВКА, negateQuantity(parseQuantity("18,405")));
    expect(сторно).toBe(negate(начислено));
    expect(add(начислено, сторно)).toBe(0n);
  });

  it("снимок ставки не меняется при правке сметы", () => {
    // Начисление считается по ставке, переданной в момент приёмки. Позже
    // ставка в смете стала иной — начисленное остаётся прежним.
    const поСнимку = accrualAmount(СТАВКА, parseQuantity("80"));
    const поНовой = accrualAmount(parseRubles("520,00"), parseQuantity("80"));
    expect(поСнимку).toBe(parseRubles("36 800,00"));
    expect(поНовой).not.toBe(поСнимку);
  });
});

describe("выполнено на сумму (БП-05)", () => {
  it("пустой список даёт ноль", () => {
    expect(acceptedTotal([])).toBe(0n);
  });

  it("совпадает с ручным расчётом до копейки", () => {
    // 80,000 × 1 150,00 = 92 000,00; 60,500 × 1 150,00 = 69 575,00;
    // итого 161 575,00 ₽.
    expect(acceptedTotal([
      { qty: parseQuantity("80"), unitPrice: ЦЕНА },
      { qty: parseQuantity("60,5"), unitPrice: ЦЕНА },
    ])).toBe(parseRubles("161 575,00"));
  });

  it("сторно вычитается тем же проходом", () => {
    expect(acceptedTotal([
      { qty: parseQuantity("80"), unitPrice: ЦЕНА },
      { qty: parseQuantity("-80"), unitPrice: ЦЕНА },
    ])).toBe(0n);
  });
});

describe("наименьшее количество позиции (Р17)", () => {
  it("позицию нельзя уменьшить ниже принятого", () => {
    expect(minimumQty(parseQuantity("140,5"))).toBe(parseQuantity("140,5"));
  });

  it("непринятую позицию можно уменьшить до нуля", () => {
    expect(minimumQty(milliunits(0))).toBe(0n);
  });
});

describe("свод начислений по бригадам", () => {
  const записи: AccrualRecord[] = [
    { brigadeId: "b1", brigadeName: "Бригада Фархата", amount: parseRubles("36 800,00"), at: "2026-09-01" },
    { brigadeId: "b2", brigadeName: "Электрики Евгения", amount: parseRubles("12 400,00"), at: "2026-09-03" },
    { brigadeId: "b1", brigadeName: "Бригада Фархата", amount: parseRubles("9 200,00"), at: "2026-09-05" },
    { brigadeId: "b2", brigadeName: "Электрики Евгения", amount: parseRubles("-12 400,00"), at: "2026-09-06" },
  ];

  it("складывает по бригаде и ставит наибольшую сумму первой", () => {
    const свод = accrualSummary(записи);
    expect(свод).toHaveLength(2);
    expect(свод[0]?.brigadeName).toBe("Бригада Фархата");
    expect(свод[0]?.amount).toBe(parseRubles("46 000,00"));
  });

  it("бригада с полностью сторнированным начислением остаётся в своде", () => {
    const свод = accrualSummary(записи);
    expect(свод[1]?.brigadeName).toBe("Электрики Евгения");
    expect(свод[1]?.amount).toBe(0n);
  });

  it("период отсекает записи вне его границ, обе включительно", () => {
    const свод = accrualSummary(записи, { from: "2026-09-03", to: "2026-09-05" });
    expect(свод).toHaveLength(2);
    expect(свод.find((row) => row.brigadeId === "b1")?.amount).toBe(parseRubles("9 200,00"));
    expect(свод.find((row) => row.brigadeId === "b2")?.amount).toBe(parseRubles("12 400,00"));
  });

  it("пустой период даёт пустой свод, а не ошибку", () => {
    expect(accrualSummary(записи, { from: "2026-10-01", to: "2026-10-31" })).toEqual([]);
  });
});

describe("копейки не теряются на длинной череде приёмок", () => {
  it("сто приёмок по 2,405 м² дают тот же итог, что одна на 240,5 м²", () => {
    // Дробление пакета между приёмками не должно накапливать погрешность:
    // ради этого количества и хранятся в тысячных.
    const частями = Array.from({ length: 100 }, () => ({ qty: parseQuantity("2,405"), unitPrice: ЦЕНА }));
    const целиком = [{ qty: parseQuantity("240,5"), unitPrice: ЦЕНА }];
    expect(acceptedTotal(частями)).toBe(acceptedTotal(целиком));
    expect(acceptedTotal(целиком)).toBe(kopecks(parseRubles("276 575,00")));
  });
});

describe("фактическая готовность: доля принятого в итоге раздела", () => {
  const раздел = kopecks(parseRubles("1 000 000,00"));

  it("ничего не принято — ноль, а не отсутствие", () => {
    expect(acceptedShare(kopecks(0n), раздел)).toBe(0n);
  });

  it("принят весь раздел — ровно сто процентов", () => {
    expect(acceptedShare(раздел, раздел)).toBe(10_000n);
  });

  it("половина раздела — пятьдесят процентов", () => {
    expect(acceptedShare(kopecks(parseRubles("500 000,00")), раздел)).toBe(5000n);
  });

  it("перевыработка не подрезается: она законна и должна быть видна", () => {
    expect(acceptedShare(kopecks(parseRubles("1 200 000,00")), раздел)).toBe(12_000n);
  });

  it("раздел без денег не даёт доли: делить не на что", () => {
    expect(acceptedShare(kopecks(parseRubles("10 000,00")), kopecks(0n))).toBeNull();
  });

  it("округление то же, что у денег: половина вверх по модулю", () => {
    // 1/3 раздела = 33,333…% → 3333 сотых доли процента.
    expect(acceptedShare(kopecks(100_000n), kopecks(300_000n))).toBe(3333n);
    // 2/3 = 66,666…% → 6667: половина уходит вверх.
    expect(acceptedShare(kopecks(200_000n), kopecks(300_000n))).toBe(6667n);
  });
});
