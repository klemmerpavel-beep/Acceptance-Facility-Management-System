import { Injectable } from "@nestjs/common";
import type { AccountingView } from "@priyomka/contracts";
import {
  awaitingDays, clientDebts, kopecks, moneyState, moneyTotals, paymentOverdue,
  PAYMENT_GRACE_DAYS, type TrancheMoney,
} from "@priyomka/domain";
import { PrismaService } from "../prisma.service";
import { spentFacts, type SpentFacts } from "../common/expense-facts";
import type { RequestUser } from "../common/current-user";

/**
 * Бухгалтерия: деньги заказчиков по всему портфелю.
 *
 * Раздел собирается из траншей, а не из новой сущности платежа: транш и
 * есть то, что предъявляется заказчику и оплачивается целиком. Второй учёт
 * тех же денег разошёлся бы с первым на первой частичной оплате.
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
        project: {
          select: {
            code: true, address: true,
            client: { select: { id: true, name: true } },
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
        closedOn: iso(row.closedAt),
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
          state: moneyState(row.status),
          openedAt: row.openedAt.toISOString(),
          closedAt: row.closedAt === null ? null : row.closedAt.toISOString(),
          paidAt: row.paidAt === null ? null : row.paidAt.toISOString(),
          awaitingDays: awaitingDays(транш, today),
          overdue: paymentOverdue(транш, today),
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
      })),
    };
  }
}
