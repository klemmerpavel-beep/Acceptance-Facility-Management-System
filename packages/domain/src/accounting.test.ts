import { describe, expect, it } from "vitest";
import {
  awaitingDays, clientDebts, graceDays, moneyState, moneyTotals, outstanding,
  paymentFault, paymentOverdue, paymentReversalFault, PAYMENT_GRACE_DAYS,
  type TrancheMoney,
} from "./accounting.js";
import { kopecks } from "./money.js";

/**
 * Оплаченное задаётся отдельно от суммы и по умолчанию равно нулю.
 *
 * Умолчание «оплачено столько же, сколько сумма» было бы удобнее в половине
 * тестов и скрыло бы ровно то, ради чего заход делался: недобор оплаченного
 * транша. Тест, который не может выразить расхождение, его и не поймает.
 */
const транш = (
  status: TrancheMoney["status"],
  amount: number,
  closedOn: string | null = null,
  paid = 0,
  порог: number | null = null,
): TrancheMoney => ({
  status,
  amount: kopecks(BigInt(amount)),
  paid: kopecks(BigInt(paid)),
  closedOn,
  graceDays: порог,
});

const СЕГОДНЯ = "2026-09-11";

describe("состояние денег транша", () => {
  it("открытый транш деньгами к получению не считается", () => {
    expect(moneyState(транш("OPEN", 100))).toBe("в работе");
  });

  it("закрытый ждёт оплаты, оплаченный оплачен", () => {
    expect(moneyState(транш("CLOSED", 100, СЕГОДНЯ))).toBe("ждёт оплаты");
    expect(moneyState(транш("PAID", 100, "2026-08-01", 100))).toBe("оплачено");
  });

  it("закрытый с частью денег назван оплаченным частично", () => {
    expect(moneyState(транш("CLOSED", 100, СЕГОДНЯ, 40))).toBe("оплачен частично");
  });

  it("закрытый, погашенный полностью, частичным не называется", () => {
    /* Денег по нему не ждут, но отметку руководитель ещё не поставил:
       состояние держится на отметке, а не на арифметике. */
    expect(moneyState(транш("CLOSED", 100, СЕГОДНЯ, 100))).toBe("ждёт оплаты");
  });
});

describe("непокрытая часть транша", () => {
  it("у закрытого читается как долг", () => {
    expect(outstanding(транш("CLOSED", 100, СЕГОДНЯ, 40))).toBe(60n);
  });

  it("у оплаченного читается как недобор: отметка разошлась с платежами", () => {
    expect(outstanding(транш("PAID", 100, "2026-08-01", 90))).toBe(10n);
  });

  it("переплата возвращается со знаком, а не обрезается нулём", () => {
    expect(outstanding(транш("CLOSED", 100, СЕГОДНЯ, 130))).toBe(-30n);
  });
});

describe("ожидание оплаты", () => {
  it("у открытого и оплаченного считать нечего", () => {
    expect(awaitingDays(транш("OPEN", 100), СЕГОДНЯ)).toBeNull();
    expect(awaitingDays(транш("PAID", 100, "2026-09-01", 100), СЕГОДНЯ)).toBeNull();
  });

  it("закрытый без даты закрытия не даёт отрицательного ожидания", () => {
    expect(awaitingDays(транш("CLOSED", 100, null), СЕГОДНЯ)).toBeNull();
  });

  it("дни считаются от закрытия до сегодня", () => {
    expect(awaitingDays(транш("CLOSED", 100, "2026-09-04"), СЕГОДНЯ)).toBe(7);
  });

  it("закрыт сегодня — ноль дней, а не отрицательное число", () => {
    expect(awaitingDays(транш("CLOSED", 100, СЕГОДНЯ), СЕГОДНЯ)).toBe(0);
    expect(awaitingDays(транш("CLOSED", 100, "2026-09-20"), СЕГОДНЯ)).toBe(0);
  });

  it("просрочка наступает строго после порога, а не в день порога", () => {
    const наПороге = транш("CLOSED", 100, "2026-09-04");
    expect(awaitingDays(наПороге, СЕГОДНЯ)).toBe(PAYMENT_GRACE_DAYS);
    expect(paymentOverdue(наПороге, СЕГОДНЯ)).toBe(false);
    expect(paymentOverdue(транш("CLOSED", 100, "2026-09-03"), СЕГОДНЯ)).toBe(true);
  });

  it("оплаченный не просрочен, сколько бы ни лежал", () => {
    expect(paymentOverdue(транш("PAID", 100, "2020-01-01", 100), СЕГОДНЯ)).toBe(false);
  });

  it("частичная оплата не двигает дату отсчёта", () => {
    /* Решение заказчика от 19.09.2026. Обратное сделало бы непросроченным
       любого, кто платит по рублю в неделю. */
    expect(paymentOverdue(транш("CLOSED", 100, "2026-08-01", 99), СЕГОДНЯ)).toBe(true);
  });

  it("погашенный полностью закрытый транш просроченным не называется", () => {
    expect(paymentOverdue(транш("CLOSED", 100, "2026-08-01", 100), СЕГОДНЯ)).toBe(false);
  });
});

describe("порог просрочки по договору", () => {
  it("незаполненное поле даёт умолчание, а не отсутствие учёта", () => {
    expect(graceDays(транш("CLOSED", 100, СЕГОДНЯ))).toBe(PAYMENT_GRACE_DAYS);
  });

  it("договорный порог старше умолчания", () => {
    expect(graceDays(транш("CLOSED", 100, СЕГОДНЯ, 0, 30))).toBe(30);
  });

  it("тот же транш при разных порогах просрочен по-разному", () => {
    const закрыт = "2026-09-01";
    expect(paymentOverdue(транш("CLOSED", 100, закрыт, 0, 7), СЕГОДНЯ)).toBe(true);
    expect(paymentOverdue(транш("CLOSED", 100, закрыт, 0, 30), СЕГОДНЯ)).toBe(false);
  });

  it("нулевой порог договором допускается: просрочка со дня после закрытия", () => {
    expect(paymentOverdue(транш("CLOSED", 100, СЕГОДНЯ, 0, 0), СЕГОДНЯ)).toBe(false);
    expect(paymentOverdue(транш("CLOSED", 100, "2026-09-10", 0, 0), СЕГОДНЯ)).toBe(true);
  });
});

describe("свод денег портфеля", () => {
  it("пустой портфель даёт нули, а не пустоту", () => {
    const свод = moneyTotals([], СЕГОДНЯ);
    expect(свод).toEqual({ inWork: 0n, awaiting: 0n, paid: 0n, overdue: 0n, shortfall: 0n });
  });

  it("каждое состояние складывается в своё слагаемое", () => {
    const свод = moneyTotals([
      транш("OPEN", 100),
      транш("CLOSED", 200, СЕГОДНЯ),
      транш("PAID", 300, "2026-08-01", 300),
    ], СЕГОДНЯ);
    expect(свод.inWork).toBe(100n);
    expect(свод.awaiting).toBe(200n);
    expect(свод.paid).toBe(300n);
  });

  it("частичная оплата делит транш между ожидающим и полученным", () => {
    const свод = moneyTotals([транш("CLOSED", 1000, СЕГОДНЯ, 400)], СЕГОДНЯ);
    expect(свод.awaiting).toBe(600n);
    expect(свод.paid).toBe(400n);
  });

  it("сумма трёх слагаемых равна предъявленному при любых платежах", () => {
    /* Инвариант раздела: человек не должен складывать одни и те же деньги
       дважды. Он и держит `shortfall` вне слагаемых. */
    const портфель = [
      транш("OPEN", 100),
      транш("CLOSED", 500, СЕГОДНЯ, 125),
      транш("CLOSED", 300, "2026-08-01", 0),
      транш("PAID", 900, "2026-08-01", 850),
      транш("PAID", 250, "2026-07-01", 250),
    ];
    const свод = moneyTotals(портфель, СЕГОДНЯ);
    const предъявлено = портфель.reduce((итог, т) => итог + (т.amount as bigint), 0n);
    expect(свод.inWork + свод.awaiting + свод.paid).toBe(предъявлено);
  });

  it("просроченное входит в ожидающее, а не стоит четвёртым слагаемым", () => {
    const свод = moneyTotals([
      транш("CLOSED", 500, "2026-08-01"),
      транш("CLOSED", 300, СЕГОДНЯ),
    ], СЕГОДНЯ);
    expect(свод.awaiting).toBe(800n);
    expect(свод.overdue).toBe(500n);
  });

  it("просроченным числится непокрытый остаток, а не вся сумма транша", () => {
    const свод = moneyTotals([транш("CLOSED", 500, "2026-08-01", 200)], СЕГОДНЯ);
    expect(свод.overdue).toBe(300n);
  });

  it("недобор считается отдельно и не прячется в полученном", () => {
    /* Цена решения «оплаченным транш называет руководитель»: в «получено»
       попала вся сумма, хотя платежей меньше. Разница названа. */
    const свод = moneyTotals([транш("PAID", 1000, "2026-08-01", 900)], СЕГОДНЯ);
    expect(свод.paid).toBe(1000n);
    expect(свод.shortfall).toBe(100n);
  });

  it("оплаченный полностью недобора не даёт", () => {
    expect(moneyTotals([транш("PAID", 1000, "2026-08-01", 1000)], СЕГОДНЯ).shortfall).toBe(0n);
  });
});

describe("долг по заказчикам", () => {
  const строка = (clientId: string, clientName: string, tranche: TrancheMoney) =>
    ({ clientId, clientName, tranche });

  it("заказчик без денег в свод не попадает", () => {
    const свод = clientDebts([строка("c1", "Пустой", транш("OPEN", 900))], СЕГОДНЯ);
    expect(свод).toEqual([]);
  });

  it("деньги одного заказчика складываются по всем его объектам", () => {
    const свод = clientDebts([
      строка("c1", "Ковалёва", транш("CLOSED", 100, СЕГОДНЯ)),
      строка("c1", "Ковалёва", транш("CLOSED", 250, СЕГОДНЯ)),
      строка("c1", "Ковалёва", транш("PAID", 400, "2026-08-01", 400)),
    ], СЕГОДНЯ);
    expect(свод).toHaveLength(1);
    expect(свод[0]?.awaiting).toBe(350n);
    expect(свод[0]?.paid).toBe(400n);
  });

  it("частичный платёж по закрытому траншу виден в полученном заказчика", () => {
    const свод = clientDebts([
      строка("c1", "Ковалёва", транш("CLOSED", 1000, СЕГОДНЯ, 250)),
    ], СЕГОДНЯ);
    expect(свод[0]?.awaiting).toBe(750n);
    expect(свод[0]?.paid).toBe(250n);
  });

  it("порядок — от большего долга к меньшему", () => {
    const свод = clientDebts([
      строка("c1", "Малый", транш("CLOSED", 100, СЕГОДНЯ)),
      строка("c2", "Большой", транш("CLOSED", 900, СЕГОДНЯ)),
    ], СЕГОДНЯ);
    expect(свод.map((строка) => строка.name)).toEqual(["Большой", "Малый"]);
  });

  it("просрочка хотя бы по одному траншу помечает заказчика", () => {
    const свод = clientDebts([
      строка("c1", "Ковалёва", транш("CLOSED", 100, СЕГОДНЯ)),
      строка("c1", "Ковалёва", транш("CLOSED", 100, "2026-08-01")),
    ], СЕГОДНЯ);
    expect(свод[0]?.overdue).toBe(true);
  });

  it("заказчик без просрочки не помечается", () => {
    const свод = clientDebts(
      [строка("c1", "Ковалёва", транш("PAID", 100, "2026-08-01", 100))],
      СЕГОДНЯ,
    );
    expect(свод[0]?.overdue).toBe(false);
  });

  it("строка несёт порог, по которому заказчик признан просрочившим", () => {
    const свод = clientDebts(
      [строка("c1", "Ковалёва", транш("CLOSED", 100, "2026-09-01", 0, 30))],
      СЕГОДНЯ,
    );
    expect(свод[0]?.graceDays).toBe(30);
    expect(свод[0]?.overdue).toBe(false);
  });
});

describe("запись платежа", () => {
  const запрос = (правка: Partial<Parameters<typeof paymentFault>[0]> = {}) => ({
    amount: kopecks(1000n),
    paidOn: "2026-09-10",
    today: СЕГОДНЯ,
    status: "CLOSED" as const,
    openedOn: "2026-09-01",
    ...правка,
  });

  it("верный платёж проходит", () => {
    expect(paymentFault(запрос())).toBeNull();
  });

  it("нулевой и отрицательный платёж отвергаются", () => {
    expect(paymentFault(запрос({ amount: kopecks(0n) }))).toContain("больше нуля");
    expect(paymentFault(запрос({ amount: kopecks(-1n) }))).toContain("больше нуля");
  });

  it("платёж будущим днём отвергается", () => {
    expect(paymentFault(запрос({ paidOn: "2026-09-12" }))).toContain("будущим днём");
  });

  it("платёж раньше открытия транша отвергается", () => {
    expect(paymentFault(запрос({ paidOn: "2025-09-10" }))).toContain("раньше открытия");
  });

  it("по открытому траншу оплата не записывается", () => {
    expect(paymentFault(запрос({ status: "OPEN" }))).toContain("Закройте транш");
  });

  it("доплата по оплаченному траншу разрешена: недобор закрывается деньгами", () => {
    expect(paymentFault(запрос({ status: "PAID" }))).toBeNull();
  });

  it("переплата не запрещается: её показывают, а не прячут", () => {
    expect(paymentFault(запрос({ amount: kopecks(10_000_000n) }))).toBeNull();
  });
});

describe("сторно платежа", () => {
  it("сторно с причиной проходит", () => {
    expect(paymentReversalFault({ reason: "Ошибка в выписке", reversed: false, isReversal: false }))
      .toBeNull();
  });

  it("причина обязательна", () => {
    expect(paymentReversalFault({ reason: "   ", reversed: false, isReversal: false }))
      .toContain("причину сторно");
  });

  it("дважды сторнировать нельзя", () => {
    expect(paymentReversalFault({ reason: "Ещё раз", reversed: true, isReversal: false }))
      .toContain("уже сторнирован");
  });

  it("сторно не сторнируется", () => {
    expect(paymentReversalFault({ reason: "Откат отката", reversed: false, isReversal: true }))
      .toContain("не сторнируется");
  });
});
