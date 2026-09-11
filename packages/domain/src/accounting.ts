/**
 * Бухгалтерия: деньги заказчиков по портфелю.
 *
 * Что раздел считает и чего не считает
 * ------------------------------------
 * Считает движение клиентских денег: сколько предъявлено, сколько ждёт
 * оплаты, сколько получено. Не считает налоги, страховые взносы и зарплаты
 * по графику — они письменно исключены из объёма (`01_PROJECT.md`, раздел
 * 6.2), и раздел с таким именем не повод их туда вернуть. Реальных выплат
 * и банковских связей здесь тоже нет: продукт ведёт запись о деньгах, а не
 * распоряжается ими.
 *
 * Единица учёта — транш, а не отдельный платёж
 * --------------------------------------------
 * Транш и есть то, что предъявляется заказчику и оплачивается целиком:
 * «остаток по клиентской сумме» — величина, ради которой руководитель
 * открывает систему вечером. Заводить поверх него вторую сущность платежа
 * значило бы вести два учёта одних денег, и на первой же частичной оплате
 * они разошлись бы. Частичная оплата — отдельное решение, и принимать его
 * следует вместе с решением о том, что тогда считать закрытым траншем.
 */

import { kopecks, sum, type Kopecks } from "./money.js";
import { daysBetween } from "./portfolio.js";

/** Состояние денег транша. Три, а не два: между «закрыт» и «оплачен» проходят дни. */
export type MoneyState = "в работе" | "ждёт оплаты" | "оплачено";

/** Транш в том виде, в каком его читает арифметика раздела. */
export interface TrancheMoney {
  readonly status: "OPEN" | "CLOSED" | "PAID";
  readonly amount: Kopecks;
  /** ГГГГ-ММ-ДД. `null` — транш ещё открыт. */
  readonly closedOn: string | null;
}

/**
 * Состояние денег транша.
 *
 * Открытый транш деньгами к получению не считается: по нему идёт
 * выработка, и сумма к оплате ещё не определена. Назвать её ожидаемой
 * значило бы обещать заказчику счёт, которого никто не выставлял.
 */
export function moneyState(status: TrancheMoney["status"]): MoneyState {
  if (status === "OPEN") return "в работе";
  return status === "PAID" ? "оплачено" : "ждёт оплаты";
}

/**
 * Сколько дней транш закрыт и не оплачен. `null` — считать нечего:
 * транш открыт или уже оплачен.
 */
export function awaitingDays(tranche: TrancheMoney, today: string): number | null {
  if (tranche.status !== "CLOSED" || tranche.closedOn === null) return null;
  return Math.max(0, daysBetween(tranche.closedOn, today));
}

/**
 * Порог, после которого ожидание оплаты названо просрочкой.
 *
 * Семь дней — недельный ритм студии, тот же, которым в продукте меряются
 * сроки объектов. Величина управленческая, а не выведенная: живёт одной
 * константой и правится одной строкой, если заказчик назовёт свою.
 */
export const PAYMENT_GRACE_DAYS = 7;

export function paymentOverdue(tranche: TrancheMoney, today: string): boolean {
  const дней = awaitingDays(tranche, today);
  return дней !== null && дней > PAYMENT_GRACE_DAYS;
}

/** Свод денег портфеля. Все величины — копейки. */
export interface MoneyTotals {
  readonly inWork: Kopecks;
  readonly awaiting: Kopecks;
  readonly paid: Kopecks;
  /** Часть ожидающего, просроченная сверх порога. Не слагаемое сверх трёх. */
  readonly overdue: Kopecks;
}

/**
 * Свод по портфелю.
 *
 * Просроченное не выделяется в четвёртое слагаемое, а входит в ожидающее:
 * иначе сумма трёх чисел перестала бы сходиться с предъявленным, и человек
 * складывал бы одни и те же деньги дважды.
 */
export function moneyTotals(
  tranches: readonly TrancheMoney[],
  today: string,
): MoneyTotals {
  const по = (предикат: (t: TrancheMoney) => boolean): Kopecks =>
    sum(tranches.filter(предикат).map((t) => t.amount));

  return {
    inWork: по((t) => t.status === "OPEN"),
    awaiting: по((t) => t.status === "CLOSED"),
    paid: по((t) => t.status === "PAID"),
    overdue: по((t) => paymentOverdue(t, today)),
  };
}

/** Сколько заказчик должен и сколько уже заплатил. */
export interface ClientDebt {
  readonly clientId: string;
  readonly name: string;
  readonly awaiting: Kopecks;
  readonly paid: Kopecks;
  readonly overdue: boolean;
}

/**
 * Долг по заказчикам, от большего к меньшему.
 *
 * Заказчики без ожидающих и без оплаченных денег в свод не попадают:
 * строка с двумя нулями сообщает ровно то же, что её отсутствие, но
 * занимает место, которого на экране денег мало.
 */
export function clientDebts(
  rows: readonly {
    clientId: string;
    clientName: string;
    tranche: TrancheMoney;
  }[],
  today: string,
): ClientDebt[] {
  const свод = new Map<string, { name: string; awaiting: bigint; paid: bigint; overdue: boolean }>();
  for (const row of rows) {
    const прежний = свод.get(row.clientId)
      ?? { name: row.clientName, awaiting: 0n, paid: 0n, overdue: false };
    if (row.tranche.status === "CLOSED") прежний.awaiting += row.tranche.amount as bigint;
    if (row.tranche.status === "PAID") прежний.paid += row.tranche.amount as bigint;
    if (paymentOverdue(row.tranche, today)) прежний.overdue = true;
    свод.set(row.clientId, прежний);
  }

  return [...свод.entries()]
    .map(([clientId, запись]) => ({
      clientId,
      name: запись.name,
      awaiting: kopecks(запись.awaiting),
      paid: kopecks(запись.paid),
      overdue: запись.overdue,
    }))
    .filter((строка) => (строка.awaiting as bigint) > 0n || (строка.paid as bigint) > 0n)
    .sort((левый, правый) => {
      const разница = (правый.awaiting as bigint) - (левый.awaiting as bigint);
      if (разница !== 0n) return разница > 0n ? 1 : -1;
      return левый.name.localeCompare(правый.name, "ru");
    });
}
