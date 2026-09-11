import { describe, expect, it } from "vitest";
import {
  awaitingDays, clientDebts, moneyState, moneyTotals, paymentOverdue, PAYMENT_GRACE_DAYS,
  type TrancheMoney,
} from "./accounting.js";
import { kopecks } from "./money.js";

const транш = (
  status: TrancheMoney["status"],
  amount: number,
  closedOn: string | null = null,
): TrancheMoney => ({ status, amount: kopecks(BigInt(amount)), closedOn });

const СЕГОДНЯ = "2026-09-11";

describe("состояние денег транша", () => {
  it("открытый транш деньгами к получению не считается", () => {
    expect(moneyState("OPEN")).toBe("в работе");
  });

  it("закрытый ждёт оплаты, оплаченный оплачен", () => {
    expect(moneyState("CLOSED")).toBe("ждёт оплаты");
    expect(moneyState("PAID")).toBe("оплачено");
  });
});

describe("ожидание оплаты", () => {
  it("у открытого и оплаченного считать нечего", () => {
    expect(awaitingDays(транш("OPEN", 100), СЕГОДНЯ)).toBeNull();
    expect(awaitingDays(транш("PAID", 100, "2026-09-01"), СЕГОДНЯ)).toBeNull();
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
    expect(paymentOverdue(транш("PAID", 100, "2020-01-01"), СЕГОДНЯ)).toBe(false);
  });
});

describe("свод денег портфеля", () => {
  it("пустой портфель даёт нули, а не пустоту", () => {
    const свод = moneyTotals([], СЕГОДНЯ);
    expect(свод).toEqual({ inWork: 0n, awaiting: 0n, paid: 0n, overdue: 0n });
  });

  it("каждое состояние складывается в своё слагаемое", () => {
    const свод = moneyTotals([
      транш("OPEN", 100),
      транш("CLOSED", 200, СЕГОДНЯ),
      транш("PAID", 300, "2026-08-01"),
    ], СЕГОДНЯ);
    expect(свод.inWork).toBe(100n);
    expect(свод.awaiting).toBe(200n);
    expect(свод.paid).toBe(300n);
  });

  it("просроченное входит в ожидающее, а не стоит четвёртым слагаемым", () => {
    /* Иначе сумма перестала бы сходиться с предъявленным, и одни и те же
       деньги складывались бы дважды. */
    const свод = moneyTotals([
      транш("CLOSED", 500, "2026-08-01"),
      транш("CLOSED", 300, СЕГОДНЯ),
    ], СЕГОДНЯ);
    expect(свод.awaiting).toBe(800n);
    expect(свод.overdue).toBe(500n);
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
      строка("c1", "Ковалёва", транш("PAID", 400, "2026-08-01")),
    ], СЕГОДНЯ);
    expect(свод).toHaveLength(1);
    expect(свод[0]?.awaiting).toBe(350n);
    expect(свод[0]?.paid).toBe(400n);
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
    const свод = clientDebts([строка("c1", "Ковалёва", транш("PAID", 100, "2026-08-01"))], СЕГОДНЯ);
    expect(свод[0]?.overdue).toBe(false);
  });
});
