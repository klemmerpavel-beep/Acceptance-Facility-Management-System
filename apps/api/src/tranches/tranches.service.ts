import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  CloseTranche, CreatePayment, CreateTranche, ReversePayment, Tranche, TranchePayment, TrancheView,
} from "@priyomka/contracts";
import {
  acceptedTotal,
  basisPoints,
  clientAmount,
  formatKopecks,
  kopecks,
  milliunits,
  negate,
  nextTrancheNumber,
  paymentFault,
  paymentReversalFault,
  sum,
  subtract,
  trancheFault,
  trancheFill,
  trancheRemainder,
  type BasisPoints,
  type Kopecks,
} from "@priyomka/domain";
import { PrismaService } from "../prisma.service";
import { AuditService } from "../common/audit.service";
import type { RequestUser } from "../common/current-user";
import { projectScope } from "../common/project-scope";

/**
 * Транши объекта.
 *
 * Каждый пишущий вызов возвращает вид целиком, а не одну изменённую строку.
 * Причина та же, что у приёмки: закрытие транша меняет и его собственные
 * величины, и признак «открытого транша нет», от которого зависит вся
 * вкладка. Частичный ответ заставил бы экран пересобирать это сам.
 *
 * Выработка не хранится, а считается при каждом чтении по пакетам приёмки
 * транша (БП-04: сторно не переписывает записи, а добавляет обратную).
 *
 * По редакции сметы выработка **не отбирается**, в отличие от вида приёмки:
 * транш есть счёт реально выполненного, и приёмка прежней редакции остаётся
 * выполненной работой. Цена берётся у той позиции, к которой приёмка
 * привязана. Прежний комментарий утверждал обратное — при единственной
 * редакции расхождение было незаметно.
 */

/** Платёж в том виде, в каком его отдаёт выборка. */
interface PaymentRow {
  id: string;
  amount: bigint;
  paidOn: Date;
  comment: string | null;
  reason: string | null;
  reversalOfId: string | null;
  createdAt: Date;
  createdBy: { name: string } | null;
  reversal: { id: string } | null;
}

/** Пакет приёмки в том виде, в каком его читает арифметика транша. */
interface BatchRow {
  trancheId: string | null;
  acceptances: { qty: bigint; item: { unitPrice: bigint } }[];
}

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

/** Выработка по набору пакетов: Σ принятое × цена единицы, без надбавки. */
function produced(batches: readonly BatchRow[]): Kopecks {
  return sum(
    batches.map((batch) =>
      acceptedTotal(
        batch.acceptances.map((row) => ({
          qty: milliunits(row.qty),
          unitPrice: kopecks(row.item.unitPrice),
        })),
      ),
    ),
  );
}

@Injectable()
export class TranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Видимость объекта берётся из общего правила: своего здесь нет. */
  private async projectOf(user: RequestUser, code: string) {
    const project = await this.prisma.project.findFirst({
      where: { ...projectScope(user), code },
      select: { id: true, code: true, orgId: true, supervisionShare: true },
    });
    if (!project) {
      throw new NotFoundException({ message: `Объект ${code} не найден или недоступен.` });
    }
    return project;
  }

  async view(user: RequestUser, code: string): Promise<TrancheView> {
    const project = await this.projectOf(user, code);
    return this.build(project.id, project.supervisionShare);
  }

  /**
   * Надбавка берётся у действующей сметы, а не у объекта.
   *
   * Смета — источник цен, по которым считается выработка; надбавка объекта
   * есть значение по умолчанию для новой сметы. Разойдясь, они дали бы
   * остаток, посчитанный по одной надбавке, и итог сметы — по другой.
   */
  private async build(projectId: string, fallbackShare: number): Promise<TrancheView> {
    const [смета, строки, пакеты] = await Promise.all([
      this.prisma.estimate.findFirst({
        where: { projectId },
        orderBy: { version: "desc" },
        select: { supervisionShare: true },
      }),
      this.prisma.tranche.findMany({
        where: { projectId },
        orderBy: { number: "asc" },
        select: {
          id: true, number: true, amount: true, status: true,
          openedAt: true, closedAt: true, paidAt: true, signedAt: true, comment: true,
          payments: {
            orderBy: [{ paidOn: "asc" }, { createdAt: "asc" }],
            select: {
              id: true, amount: true, paidOn: true, comment: true, reason: true,
              reversalOfId: true, createdAt: true,
              createdBy: { select: { name: true } },
              reversal: { select: { id: true } },
            },
          },
        },
      }),
      this.prisma.acceptanceBatch.findMany({
        where: { projectId },
        select: {
          trancheId: true,
          acceptances: { select: { qty: true, item: { select: { unitPrice: true } } } },
        },
      }),
    ]);

    const share = basisPoints(смета?.supervisionShare ?? fallbackShare);

    const поТраншам = new Map<string, BatchRow[]>();
    const вне: BatchRow[] = [];
    for (const пакет of пакеты) {
      if (пакет.trancheId === null) {
        вне.push(пакет);
        continue;
      }
      поТраншам.set(пакет.trancheId, [...(поТраншам.get(пакет.trancheId) ?? []), пакет]);
    }

    const tranches = строки.map((строка) =>
      this.toTranche(строка, produced(поТраншам.get(строка.id) ?? []), share));
    const внеВыработка = produced(вне);

    return {
      supervisionShare: Number(share),
      tranches,
      current: tranches.find((транш) => транш.status === "OPEN") ?? null,
      outside: {
        batches: вне.length,
        produced: внеВыработка.toString(),
        client: clientAmount(внеВыработка, share).toString(),
      },
    };
  }

  private toTranche(
    row: {
      id: string; number: number; amount: bigint; status: "OPEN" | "CLOSED" | "PAID";
      openedAt: Date; closedAt: Date | null; paidAt: Date | null; signedAt: Date | null;
      comment: string | null; payments: PaymentRow[];
    },
    выработка: Kopecks,
    share: BasisPoints,
  ): Tranche {
    const amount = kopecks(row.amount);
    /* Оплаченное — сумма всех платежей, а не неотменённых: сторно приходит
       отрицательной суммой и обнуляет свою пару само. Отбор по признаку
       «не сторнирован» дал бы тот же ответ ровно до первого сторно. */
    const оплачено = sum(row.payments.map((платёж) => kopecks(платёж.amount)));
    return {
      id: row.id,
      number: row.number,
      amount: amount.toString(),
      status: row.status,
      openedAt: row.openedAt.toISOString(),
      closedAt: iso(row.closedAt),
      paidAt: iso(row.paidAt),
      signedAt: row.signedAt === null ? null : row.signedAt.toISOString().slice(0, 10),
      comment: row.comment,
      produced: выработка.toString(),
      client: clientAmount(выработка, share).toString(),
      remainder: trancheRemainder(amount, выработка, share).toString(),
      fill: Number(trancheFill(amount, выработка, share)),
      paid: оплачено.toString(),
      outstanding: subtract(amount, оплачено).toString(),
      payments: row.payments.map((платёж): TranchePayment => ({
        id: платёж.id,
        amount: платёж.amount.toString(),
        paidOn: платёж.paidOn.toISOString().slice(0, 10),
        comment: платёж.comment,
        reason: платёж.reason,
        reversalOfId: платёж.reversalOfId,
        reversed: платёж.reversal !== null,
        createdAt: платёж.createdAt.toISOString(),
        author: платёж.createdBy?.name ?? null,
      })),
    };
  }

  async create(user: RequestUser, code: string, input: CreateTranche): Promise<TrancheView> {
    const project = await this.projectOf(user, code);
    const заведённые = await this.prisma.tranche.findMany({
      where: { projectId: project.id },
      select: { number: true, status: true },
    });

    const prepayment = input.prepayment ?? false;
    const открытый = заведённые.find((транш) => транш.status === "OPEN") ?? null;
    const отказ = trancheFault({
      amount: kopecks(input.amount),
      prepayment,
      openNumber: открытый?.number ?? null,
      hasPrepayment: заведённые.some((транш) => транш.number === 0),
    });
    if (отказ !== null) throw new BadRequestException({ message: отказ });

    /* Предоплата приходит оплаченной: деньги получены до начала работ, и
       статус «открыт» обещал бы, что в счёт неё ещё предстоит выработать
       (решение Р12). Номер выводится сервером — два открытых окна иначе
       завели бы транш с одним номером. */
    const number = prepayment ? 0 : nextTrancheNumber(заведённые.map((транш) => транш.number));
    const now = new Date();
    const транш = await this.prisma.tranche.create({
      data: {
        projectId: project.id,
        number,
        amount: kopecks(input.amount),
        status: prepayment ? "PAID" : "OPEN",
        paidAt: prepayment ? now : null,
        comment: input.comment ?? null,
        createdById: user.id,
        /* Предоплата приходит с деньгами, значит приходит и с платежом.
           Без этой записи предоплаченный транш с первого же дня числился бы
           недобором на всю сумму: отметка «оплачен» стоит, платежей нет. */
        ...(prepayment
          ? {
            payments: {
              create: {
                amount: kopecks(input.amount),
                paidOn: now,
                comment: "Предоплата 30 %",
                createdById: user.id,
              },
            },
          }
          : {}),
      },
      select: { id: true, amount: true },
    });

    await this.audit.record({
      orgId: project.orgId,
      actorId: user.id,
      entity: "Tranche",
      entityId: транш.id,
      field: prepayment ? "предоплата" : "открыт",
      oldValue: null,
      /* Сумма пишется рублями: журнал читает человек, и «45000000 копеек»
         он в уме не делит. Форма общая с экранами. */
      newValue: `транш № ${String(number)} на ${formatKopecks(kopecks(транш.amount))}`,
    });

    return this.build(project.id, project.supervisionShare);
  }

  /**
   * Закрытие транша.
   *
   * Выработка не проверяется ни снизу, ни сверху: транш закрывают решением,
   * а не арифметикой. Недовыработанный транш закрывают, когда работы по
   * нему больше не ведутся; перевыработанный — когда пора выставлять акт.
   * Отказ один: закрывать уже закрытый нечего.
   */
  async close(
    user: RequestUser, code: string, id: string, input: CloseTranche,
  ): Promise<TrancheView> {
    const project = await this.projectOf(user, code);
    const транш = await this.trancheOf(project.id, id);
    if (транш.status !== "OPEN") {
      throw new BadRequestException({
        message: `Транш № ${String(транш.number)} уже закрыт. Закрыть его второй раз нельзя.`,
      });
    }

    await this.prisma.tranche.update({
      where: { id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        ...(input.comment === undefined ? {} : { comment: input.comment }),
      },
    });
    await this.audit.record({
      orgId: project.orgId, actorId: user.id, entity: "Tranche", entityId: id,
      field: "состояние", oldValue: "открыт", newValue: "закрыт",
    });

    return this.build(project.id, project.supervisionShare);
  }

  /**
   * Отметка оплаты. Открытый транш оплаченным не считается: пока по нему
   * идёт выработка, сумма к оплате ещё не определена.
   */
  async pay(user: RequestUser, code: string, id: string): Promise<TrancheView> {
    const project = await this.projectOf(user, code);
    const транш = await this.trancheOf(project.id, id);
    if (транш.status === "OPEN") {
      throw new BadRequestException({
        message: `Транш № ${String(транш.number)} ещё открыт. Закройте его, прежде чем отмечать оплату.`,
      });
    }
    if (транш.status === "PAID") {
      throw new BadRequestException({
        message: `Транш № ${String(транш.number)} уже отмечен оплаченным.`,
      });
    }

    await this.prisma.tranche.update({ where: { id }, data: { status: "PAID", paidAt: new Date() } });
    await this.audit.record({
      orgId: project.orgId, actorId: user.id, entity: "Tranche", entityId: id,
      field: "состояние", oldValue: "закрыт", newValue: "оплачен",
    });

    return this.build(project.id, project.supervisionShare);
  }

  /**
   * Запись платежа заказчика.
   *
   * Состояние транша платёж не меняет — решение заказчика от 19.09.2026:
   * оплаченным транш называет отметка руководителя. Соблазн выставить
   * `PAID` здесь, когда платежи покрыли сумму, велик и потому назван:
   * поддавшись ему, продукт завёл бы два способа назначить одно состояние,
   * а они расходятся на первой переплате и на первом сторно.
   */
  async addPayment(
    user: RequestUser, code: string, id: string, input: CreatePayment, today: string,
  ): Promise<TrancheView> {
    const project = await this.projectOf(user, code);
    const транш = await this.trancheOf(project.id, id);

    const отказ = paymentFault({
      amount: kopecks(input.amount),
      paidOn: input.paidOn,
      today,
      status: транш.status,
      openedOn: транш.openedAt.toISOString().slice(0, 10),
    });
    if (отказ !== null) throw new BadRequestException({ message: отказ });

    const платёж = await this.prisma.tranchePayment.create({
      data: {
        trancheId: id,
        amount: kopecks(input.amount),
        paidOn: new Date(`${input.paidOn}T00:00:00.000Z`),
        comment: input.comment ?? null,
        createdById: user.id,
      },
      select: { id: true, amount: true },
    });

    await this.audit.record({
      orgId: project.orgId, actorId: user.id, entity: "TranchePayment", entityId: платёж.id,
      field: `платёж по траншу № ${String(транш.number)}`,
      oldValue: null,
      newValue: `${formatKopecks(kopecks(платёж.amount))} от ${input.paidOn}`,
    });

    return this.build(project.id, project.supervisionShare);
  }

  /**
   * Сторно платежа: запись того же вида с обратной суммой (БП-04).
   *
   * Удаления нет и не будет. Через месяц спрашивают не «сколько оплачено», а
   * «почему сумма изменилась», и удалённая строка на этот вопрос не отвечает.
   */
  async reversePayment(
    user: RequestUser, code: string, id: string, paymentId: string, input: ReversePayment,
  ): Promise<TrancheView> {
    const project = await this.projectOf(user, code);
    const транш = await this.trancheOf(project.id, id);

    const платёж = await this.prisma.tranchePayment.findFirst({
      where: { id: paymentId, trancheId: id },
      select: { id: true, amount: true, paidOn: true, reversalOfId: true, reversal: { select: { id: true } } },
    });
    if (!платёж) {
      throw new NotFoundException({ message: "Платёж не найден у этого транша." });
    }

    const отказ = paymentReversalFault({
      reason: input.reason,
      reversed: платёж.reversal !== null,
      isReversal: платёж.reversalOfId !== null,
    });
    if (отказ !== null) throw new BadRequestException({ message: отказ });

    /* Сторно датируется днём сторнируемого платежа, а не сегодняшним.
       Иначе пара «платёж + сторно» разъезжалась бы по датам, и оплаченное
       на любой промежуточный день считалось бы неверно. */
    const сторно = await this.prisma.tranchePayment.create({
      data: {
        trancheId: id,
        amount: negate(kopecks(платёж.amount)),
        paidOn: платёж.paidOn,
        reason: input.reason,
        reversalOfId: платёж.id,
        createdById: user.id,
      },
      select: { id: true, amount: true },
    });

    await this.audit.record({
      orgId: project.orgId, actorId: user.id, entity: "TranchePayment", entityId: сторно.id,
      field: `сторно платежа по траншу № ${String(транш.number)}`,
      oldValue: formatKopecks(kopecks(платёж.amount)),
      newValue: input.reason,
    });

    return this.build(project.id, project.supervisionShare);
  }

  /** Транш ищется в границах объекта: чужой по опознавателю не открывается. */
  private async trancheOf(projectId: string, id: string) {
    const транш = await this.prisma.tranche.findFirst({
      where: { id, projectId },
      select: { id: true, number: true, status: true, openedAt: true },
    });
    if (!транш) throw new NotFoundException({ message: "Транш не найден у этого объекта." });
    return транш;
  }
}
