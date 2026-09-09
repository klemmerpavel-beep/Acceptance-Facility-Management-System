import { describe, expect, it } from "vitest";
import {
  accrualsByTranche,
  clientAmount,
  nextTrancheNumber,
  trancheFault,
  trancheFill,
  trancheRemainder,
  type TrancheAccrualRecord,
} from "./tranche.js";
import { add, applyPercent, basisPoints, kopecks, negate, parseRubles, sum } from "./money.js";

/* Надбавка «сопровождение объекта» действующей сметы «Московский проспект
   116» — 12,00 %, то есть 1200 сотых долей процента. Величина транша взята
   из допроса заказчика: 300–500 тыс. ₽, «чтобы заказчику суммы не казались
   большими» (docs/01_PROJECT.md:66). */
const НАДБАВКА = basisPoints(1200);
const ТРАНШ = parseRubles("400 000,00");

describe("клиентская сумма выработки", () => {
  it("прибавляет надбавку к стоимости работ", () => {
    expect(clientAmount(parseRubles("100 000,00"), НАДБАВКА)).toBe(parseRubles("112 000,00"));
  });

  it("нулевая выработка даёт ноль", () => {
    expect(clientAmount(kopecks(0), НАДБАВКА)).toBe(0n);
  });

  it("нулевая надбавка оставляет сумму как есть", () => {
    expect(clientAmount(parseRubles("100 000,00"), basisPoints(0))).toBe(parseRubles("100 000,00"));
  });
});

describe("остаток транша", () => {
  it("при нулевой выработке равен сумме транша", () => {
    expect(trancheRemainder(ТРАНШ, kopecks(0), НАДБАВКА)).toBe(ТРАНШ);
  });

  it("вычитает клиентскую сумму, а не стоимость работ", () => {
    /* Ручной расчёт: 250 000 × 1,12 = 280 000; 400 000 − 280 000 = 120 000.
       Расчёт по стоимости работ дал бы 150 000 — на 30 000 ₽ больше, и это
       ровно то расхождение с экономикой объекта, ради которого правило
       записано в БП-05. */
    const остаток = trancheRemainder(ТРАНШ, parseRubles("250 000,00"), НАДБАВКА);
    expect(остаток).toBe(parseRubles("120 000,00"));
    expect(остаток).not.toBe(parseRubles("150 000,00"));
  });

  it("перевыработка даёт отрицательный остаток, а не ноль", () => {
    expect(trancheRemainder(ТРАНШ, ТРАНШ, НАДБАВКА)).toBe(parseRubles("-48 000,00"));
  });

  it("приёмка и её сторно не меняют остаток", () => {
    const выработка = parseRubles("37 500,00");
    const после = sum([выработка, negate(выработка)]);
    expect(trancheRemainder(ТРАНШ, после, НАДБАВКА)).toBe(ТРАНШ);
  });
});

describe("заполнение полосы", () => {
  it("половина транша даёт 50,00 %", () => {
    /* 178 571,43 × 1,12 = 200 000,0016 → 200 000 копеек ровно половина
       от 400 000. Число подобрано так, чтобы деление было точным. */
    expect(trancheFill(ТРАНШ, parseRubles("178 571,43"), НАДБАВКА)).toBe(5000n);
  });

  it("выработка ровно на сумму транша даёт 100,00 %", () => {
    expect(trancheFill(ТРАНШ, parseRubles("357 142,86"), НАДБАВКА)).toBe(10_000n);
  });

  it("перевыработка даёт больше 100,00 % и не обрезается", () => {
    expect(trancheFill(ТРАНШ, ТРАНШ, НАДБАВКА)).toBe(11_200n);
  });

  it("нулевая сумма транша даёт ноль, а не деление на ноль", () => {
    expect(trancheFill(kopecks(0), parseRubles("1 000,00"), НАДБАВКА)).toBe(0n);
  });
});

describe("надбавка применяется одним умножением", () => {
  it("поэлементное начисление даёт другое число", () => {
    /* 132 позиции — столько их в действующей смете. Цена подобрана так,
       чтобы надбавка давала дробную копейку: 1 150,04 × 0,12 = 138,0048.
       Поэлементное округление отбрасывает 0,48 копейки на каждой позиции
       и делает это в одну и ту же сторону — смещение систематическое и
       не гасится усреднением, сколько бы позиций ни было. */
    const цена = parseRubles("1 150,04");
    const позиции = Array.from({ length: 132 }, () => цена);

    const поэлементно = sum(позиции.map((позиция) => add(позиция, applyPercent(позиция, НАДБАВКА))));
    const однимУмножением = clientAmount(sum(позиции), НАДБАВКА);

    expect(поэлементно).not.toBe(однимУмножением);
    expect(однимУмножением - поэлементно).toBe(63n);
  });

  it("на одной позиции способы совпадают: расхождение накопительное", () => {
    const цена = parseRubles("1 150,04");
    expect(add(цена, applyPercent(цена, НАДБАВКА))).toBe(clientAmount(цена, НАДБАВКА));
  });
});

describe("отказ при заведении транша", () => {
  const обычный = { prepayment: false, openNumber: null, hasPrepayment: false };

  it("нулевая сумма отклоняется", () => {
    expect(trancheFault({ ...обычный, amount: kopecks(0) }))
      .toBe("Сумма транша должна быть больше нуля.");
  });

  it("отрицательная сумма отклоняется", () => {
    expect(trancheFault({ ...обычный, amount: parseRubles("-1,00") }))
      .toBe("Сумма транша должна быть больше нуля.");
  });

  it("второй открытый транш отклоняется и называет мешающий", () => {
    expect(trancheFault({ ...обычный, amount: ТРАНШ, openNumber: 3 }))
      .toBe("У объекта уже открыт транш № 3. Закройте его, прежде чем открывать следующий.");
  });

  it("предоплата заводится и при открытом транше", () => {
    /* Предоплата приходит оплаченной и выработку не накапливает: деньги
       получены, работы ещё нет. Открытый транш ей не помеха. */
    expect(trancheFault({ amount: ТРАНШ, prepayment: true, openNumber: 3, hasPrepayment: false }))
      .toBeNull();
  });

  it("вторая предоплата отклоняется", () => {
    expect(trancheFault({ amount: ТРАНШ, prepayment: true, openNumber: null, hasPrepayment: true }))
      .toBe("Предоплата уже заведена траншем № 0. Второй предоплаты у объекта не бывает.");
  });

  it("первый транш при отсутствии открытого принимается", () => {
    expect(trancheFault({ ...обычный, amount: ТРАНШ })).toBeNull();
  });
});

describe("номер следующего транша", () => {
  it("у объекта без траншей — ноль", () => {
    expect(nextTrancheNumber([])).toBe(0);
  });

  it("после предоплаты — первый", () => {
    expect(nextTrancheNumber([0])).toBe(1);
  });

  it("считается по наибольшему номеру, а не по количеству", () => {
    expect(nextTrancheNumber([0, 1])).toBe(2);
    expect(nextTrancheNumber([1])).toBe(2);
  });
});

describe("свод начислений за транш", () => {
  const запись = (
    trancheId: string | null,
    brigadeName: string,
    рубли: string,
  ): TrancheAccrualRecord => ({
    brigadeId: brigadeName,
    brigadeName,
    amount: parseRubles(рубли),
    at: "2026-09-09",
    trancheId,
  });

  it("отбирает записи своего транша", () => {
    const свод = accrualsByTranche(
      [запись("t1", "Бригада Фархата", "10 000,00"), запись("t2", "Бригада Рашида", "7 000,00")],
      "t1",
    );
    expect(свод).toHaveLength(1);
    expect(свод[0]?.brigadeName).toBe("Бригада Фархата");
  });

  it("записи вне транша в свод не попадают", () => {
    expect(accrualsByTranche([запись(null, "Бригада Фархата", "10 000,00")], "t1")).toHaveLength(0);
  });

  it("складывает начисления одной бригады и учитывает сторно", () => {
    const свод = accrualsByTranche(
      [
        запись("t1", "Бригада Фархата", "10 000,00"),
        запись("t1", "Бригада Фархата", "-4 000,00"),
      ],
      "t1",
    );
    expect(свод[0]?.amount).toBe(parseRubles("6 000,00"));
  });
});
