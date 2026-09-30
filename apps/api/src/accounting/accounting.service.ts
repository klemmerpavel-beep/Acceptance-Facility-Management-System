import { Injectable } from "@nestjs/common";
import type { AccountingView } from "@priyomka/contracts";
import {
  awaitingDays, clientDebts, graceDays, kopecks, moneyState, moneyTotals, outstanding,
  paymentOverdue, PAYMENT_GRACE_DAYS, sum, type TrancheMoney,
} from "@priyomka/domain";
import { PrismaService } from "../prisma.service";
import { spentFacts, type SpentFacts } from "../common/expense-facts";
import type { RequestUser } from "../common/current-user";

/**
 * Бухгалтерия: деньги заказчиков по всему портфелю.
 *
 * Раздел собирается из траншей и платежей по ним. Платёж заведён 19.09.2026
 * ответом заказчика на вопрос 4 квиза; довод против второго учёта тех же
 * денег не отменён, а исполнен — расхождение считается прямо и зовётся
 * недобором (`shortfall`).
 *
 * Порог просрочки приходит из карточки заказчика (ответ на вопрос 5 того же
 * квиза) и кладётся в каждый транш: арифметика домена спрашивает порог у
 * транша, потому что просрочка — свойство денег, а не строки справочника.
 *
 * Выборка одна на весь раздел. Пройтись по объектам и спросить транши у
 * каждого значило бы сделать столько запросов, сколько объектов, — и на
 * трёх десятках объектов экран денег открывался бы секундами.
 */
@Injectable()
export class AccountingService {
  constructor(private readonly prisma: PrismaService) {}

  async view(user: RequestUser, today: string): Promise<AccountingView> {
    const rows = await this.prisma.tranche.findMany({
      where: { project: { orgId: user.orgId } },
      orderBy: [{ openedAt: "desc" }, { number: "desc" }],
      select: {
        id: true, number: true, amount: true, status: true,
        openedAt: true, closedAt: true, paidAt: true, comment: true,
        payments: { select: { amount: true } },
        project: {
          select: {
            code: true, address: true,
            client: { select: { id: true, name: true, paymentGraceDays: true } },
          },
        },
      },
    });

    /* Расходы берутся отдельной выборкой и в клиентские деньги не входят:
       реестр отвечает на вопрос «сколько должны заказчики», а материалы —
       деньги студии. Колонка рядом, слагаемым — нет. */
    const объекты = await this.prisma.project.findMany({
      where: { orgId: user.orgId },
      select: { id: true, code: true, address: true },
      orderBy: { code: "asc" },
    });
    const расходы = await spentFacts(this.prisma, объекты.map((объект) => объект.id));
    const расходыПортфеля = объекты
      .map((объект) => ({ объект, факт: расходы.get(объект.id) }))
      .filter((пара): пара is { объект: typeof объекты[number]; факт: SpentFacts } =>
        пара.факт !== undefined)
      .map(({ объект, факт }) => ({
        projectCode: объект.code,
        address: объект.address,
        spent: факт.spent.toString(),
        reimbursable: факт.reimbursable.toString(),
      }));

    const iso = (date: Date | null): string | null =>
      date === null ? null : date.toISOString().slice(0, 10);

    /* Запись базы и её денежный срез идут парой, а не двумя списками с
       общим индексом: два списка расходятся при первой же фильтрации, и
       расходятся молча. */
    const пары = rows.map((row) => ({
      row,
      money: {
        status: row.status,
        amount: kopecks(row.amount),
        /* Сторно приходит отрицательной суммой, поэтому оплаченное — простое
           сложение всех платежей, а не сложение неотменённых. Отбор по
           признаку «не сторнирован» дал бы тот же ответ ровно до первого
           сторно, записанного двумя окнами сразу. */
        paid: sum(row.payments.map((платёж) => kopecks(платёж.amount))),
        closedOn: iso(row.closedAt),
        graceDays: row.project.client.paymentGraceDays,
      } satisfies TrancheMoney,
    }));
    const деньги = пары.map((пара) => пара.money);

    return {
      totals: (() => {
        const свод = moneyTotals(деньги, today);
        return {
          inWork: свод.inWork.toString(),
          awaiting: свод.awaiting.toString(),
          paid: свод.paid.toString(),
          overdue: свод.overdue.toString(),
          shortfall: свод.shortfall.toString(),
          graceDays: PAYMENT_GRACE_DAYS,
        };
      })(),
      materials: {
        spent: расходыПортфеля.reduce((всего, с) => всего + BigInt(с.spent), 0n).toString(),
        reimbursable: расходыПортфеля
          .reduce((всего, с) => всего + BigInt(с.reimbursable), 0n).toString(),
      },
      expenses: расходыПортфеля,
      rows: пары.map(({ row, money: транш }) => {
        return {
          id: row.id,
          projectCode: row.project.code,
          address: row.project.address,
          clientId: row.project.client.id,
          clientName: row.project.client.name,
          number: row.number,
          amount: row.amount.toString(),
          paid: транш.paid.toString(),
          outstanding: outstanding(транш).toString(),
          state: moneyState(транш),
          openedAt: row.openedAt.toISOString(),
          closedAt: row.closedAt === null ? null : row.closedAt.toISOString(),
          paidAt: row.paidAt === null ? null : row.paidAt.toISOString(),
          awaitingDays: awaitingDays(транш, today),
          overdue: paymentOverdue(транш, today),
          graceDays: graceDays(транш),
          graceByContract: транш.graceDays !== null,
          comment: row.comment,
        };
      }),
      clients: clientDebts(
        пары.map(({ row, money }) => ({
          clientId: row.project.client.id,
          clientName: row.project.client.name,
          tranche: money,
        })),
        today,
      ).map((строка) => ({
        clientId: строка.clientId,
        name: строка.name,
        awaiting: строка.awaiting.toString(),
        paid: строка.paid.toString(),
        overdue: строка.overdue,
        graceDays: строка.graceDays,
      })),
    };
  }
}
