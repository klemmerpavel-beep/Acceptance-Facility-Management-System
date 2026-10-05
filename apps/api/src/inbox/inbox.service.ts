import { Injectable } from "@nestjs/common";
import type { Inbox, InboxSeen } from "@priyomka/contracts";
import {
  acceptedTotal, адресПункта, актБезПодписи, inboxItems, исчерпанС, kopecks, milliunits, новоеПосле,
  PAYMENT_GRACE_DAYS, просроченС, разделБезЭтапа, разделСегодня, свойЧекОтклонён,
  уместенВОчереди, чекЧерновик, basisPoints, ВИДЫ_ОЧЕРЕДИ,
  type ВидПункта, type ФактПункта, type ФактыОчереди,
} from "@priyomka/domain";
import { PrismaService } from "../prisma.service";
import { orgDay, type OrgDay } from "../common/org-day";
import type { RequestUser } from "../common/current-user";
import { projectScope } from "../common/project-scope";
import { TranchesService } from "../tranches/tranches.service";
import { AcceptanceService } from "../acceptance/acceptance.service";
import { ExpensesService } from "../expenses/expenses.service";
import { ActsService } from "../acts/acts.service";

/**
 * Очередь «Ждёт вашего действия» (этап Э8, ДР-1).
 *
 * Новых сущностей очередь не заводит: каждый пункт — хранимый факт, и
 * вычисляется он при каждом запросе по образцу `nextAction`. Факты берутся
 * у тех же служб, что строят экраны назначения, и отбираются теми же
 * доменными правилами, что отбирает экран (`inbox.ts` домена): только так
 * число пункта совпадает с числом записей там, куда пункт ведёт.
 *
 * Цена приёма названа: на объект — несколько обращений к службам. Объектов
 * у студии десяток, а счёт, написанный вторым запросом «для очереди»,
 * разошёлся бы с экраном на первой правке.
 */

/** Самый ранний день набора. */
const раньше = (дни: readonly string[]): string => [...дни].sort()[0] ?? "";

/** Пункт из дней его записей: число — записи, «с» — самая ранняя. */
const факт = (дни: readonly string[]): ФактПункта | undefined =>
  дни.length === 0 ? undefined : { count: дни.length, since: раньше(дни) };

@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tranches: TranchesService,
    private readonly acceptance: AcceptanceService,
    private readonly expenses: ExpensesService,
    private readonly acts: ActsService,
  ) {}

  async inbox(user: RequestUser): Promise<Inbox> {
    const день = await orgDay(this.prisma, user.orgId);
    const нужны = new Set<ВидПункта>(ВИДЫ_ОЧЕРЕДИ[user.role]);

    /* Отметка прошлого захода — только у заказчика: «новое» есть только у
       него. Пока отметки нет, нового нет — сравнивать не с чем, а первый
       заход встречает экран первого входа (решение допроса Э8-2). */
    const seenAt = user.role === "CLIENT"
      ? (await this.prisma.user.findUnique({ where: { id: user.id }, select: { lastSeenAt: true } }))
        ?.lastSeenAt ?? null
      : null;
    const отметка = seenAt?.toISOString() ?? null;

    const объекты = await this.prisma.project.findMany({
      where: { ...projectScope(user), status: { not: "ARCHIVED" } },
      orderBy: { code: "asc" },
      select: {
        id: true, code: true, status: true, createdAt: true, supervisionShare: true, clientId: true,
        client: { select: { paymentGraceDays: true } },
        _count: { select: { estimates: true, tranches: true } },
      },
    });

    /* Входы заказчиков — одной выборкой на организацию и тем же признаком
       «входил», что пилюля в «Людях»: сессия была. */
    const заказчики = нужны.has("clientNoAccess") || нужны.has("clientNotEntered")
      ? await this.prisma.user.findMany({
        where: { orgId: user.orgId, role: "CLIENT", revokedAt: null },
        select: { clientId: true, createdAt: true, sessions: { select: { id: true }, take: 1 } },
      })
      : [];

    const факты: ФактыОчереди[] = [];
    for (const объект of объекты) {
      const нужен = (вид: ВидПункта): boolean => нужны.has(вид) && уместенВОчереди(вид, объект.status);
      const пункты: Partial<Record<ВидПункта, ФактПункта>> = {};

      if (объект._count.tranches > 0
        && (нужен("trancheToClose") || нужен("actUnsigned") || нужен("paymentOverdue"))) {
        Object.assign(пункты, await this.траншевые(объект, день, нужен));
      }

      if (нужен("expenseDrafts") || нужен("expenseRejected")) {
        const чеки = (await this.expenses.view(user, объект.code)).rows;
        const черновики = факт(чеки.filter(чекЧерновик).map((чек) => день.day(new Date(чек.createdAt))));
        const отклонены = факт(чеки.filter(свойЧекОтклонён)
          .map((чек) => день.day(new Date(чек.decidedAt ?? чек.createdAt))));
        if (нужен("expenseDrafts") && черновики !== undefined) пункты.expenseDrafts = черновики;
        if (нужен("expenseRejected") && отклонены !== undefined) пункты.expenseRejected = отклонены;
      }

      if (объект._count.estimates > 0 && (нужен("sectionsNoStage") || нужен("stageToday"))) {
        const вид = await this.acceptance.view(user, объект.code);
        const без = вид.sections.filter(разделБезЭтапа);
        if (нужен("sectionsNoStage") && без.length > 0) {
          /* Разделы появляются вместе с редакцией сметы: с неё и ждут. */
          const смета = await this.prisma.estimate.findFirst({
            where: { projectId: объект.id }, orderBy: { version: "desc" }, select: { createdAt: true },
          });
          пункты.sectionsNoStage = { count: без.length, since: день.day(смета?.createdAt ?? объект.createdAt) };
        }
        const сегодня = факт(вид.sections
          .filter((раздел) => разделСегодня(раздел, вид.today))
          .map((раздел) => раздел.stage?.startsOn ?? вид.today));
        if (нужен("stageToday") && сегодня !== undefined) пункты.stageToday = сегодня;
      }

      if (нужен("clientNoAccess") || нужен("clientNotEntered")) {
        const свои = заказчики.filter((человек) => человек.clientId === объект.clientId);
        if (нужен("clientNoAccess") && свои.length === 0) {
          пункты.clientNoAccess = { count: 1, since: день.day(объект.createdAt) };
        }
        const невходившие = факт(свои
          .filter((человек) => человек.sessions.length === 0)
          .map((человек) => день.day(человек.createdAt)));
        if (нужен("clientNotEntered") && невходившие !== undefined) пункты.clientNotEntered = невходившие;
      }

      if (нужен("waitingLong") && объект.status === "WAITING_CLIENT") {
        /* С последнего перевода в «Ждёт ответа» — по журналу; объект,
           заведённый сразу в этом статусе, ждёт со дня заведения. */
        const перевод = await this.prisma.auditLog.findFirst({
          where: {
            orgId: user.orgId, entity: "Project", entityId: объект.id,
            field: "status", newValue: "WAITING_CLIENT",
          },
          orderBy: { at: "desc" },
          select: { at: true },
        });
        пункты.waitingLong = { count: 1, since: день.day(перевод?.at ?? объект.createdAt) };
      }

      if (отметка !== null && нужен("newPhotos")) {
        const отчёт = await this.acceptance.report(user, объект.code);
        const новые = отчёт.days.flatMap((сутки) => сутки.batches)
          .filter((пакет) => пакет.photos.length > 0 && новоеПосле(пакет.at, отметка));
        if (новые.length > 0) {
          пункты.newPhotos = {
            count: новые.reduce((всего, пакет) => всего + пакет.photos.length, 0),
            since: раньше(новые.map((пакет) => день.day(new Date(пакет.at)))),
          };
        }
      }

      if (отметка !== null && нужен("newActs")) {
        const новые = факт((await this.acts.list(user, объект.code))
          .filter((акт) => новоеПосле(акт.closedTime, отметка))
          .map((акт) => день.day(new Date(акт.closedTime))));
        if (новые !== undefined) пункты.newActs = новые;
      }

      факты.push({ code: объект.code, status: объект.status, пункты });
    }

    const заказчикОбъекта = new Map(объекты.map((объект) => [объект.code, объект.clientId]));
    return {
      today: день.today,
      items: inboxItems(user.role, факты, день.today).map((пункт) => ({
        kind: пункт.kind,
        projectCode: пункт.code,
        count: пункт.count,
        since: пункт.since,
        href: адресПункта(
          пункт.kind,
          пункт.code,
          пункт.kind === "clientNotEntered" ? (заказчикОбъекта.get(пункт.code) ?? "") : (отметка ?? ""),
        ),
      })),
      seenAt: отметка,
    };
  }

  /**
   * Денежные пункты объекта: транш выработан, акт без подписи, просрочка.
   * Вид траншей строится той же службой, что вкладка «Транши».
   */
  private async траншевые(
    объект: { id: string; supervisionShare: number; client: { paymentGraceDays: number | null } },
    день: OrgDay,
    нужен: (вид: ВидПункта) => boolean,
  ): Promise<Partial<Record<ВидПункта, ФактПункта>>> {
    const вид = await this.tranches.build(объект, день);
    const пункты: Partial<Record<ВидПункта, ФактПункта>> = {};
    const порог = объект.client.paymentGraceDays ?? PAYMENT_GRACE_DAYS;
    const закрыт = (транш: { closedAt: string | null }): string[] =>
      транш.closedAt === null ? [] : [день.day(new Date(транш.closedAt))];

    /* Акт — у закрытого транша: то же условие, что у перечня актов. */
    const безПодписи = факт(вид.tranches
      .filter((транш) => транш.status !== "OPEN" && актБезПодписи(транш))
      .flatMap(закрыт));
    if (нужен("actUnsigned") && безПодписи !== undefined) пункты.actUnsigned = безПодписи;

    const просрочены = факт(вид.tranches
      .filter((транш) => транш.overdue)
      .flatMap((транш) => закрыт(транш).map((закрытС) => просроченС(закрытС, порог))));
    if (нужен("paymentOverdue") && просрочены !== undefined) пункты.paymentOverdue = просрочены;

    const открытый = вид.current;
    if (нужен("trancheToClose") && открытый !== null && BigInt(открытый.remainder) <= 0n) {
      /* С приёмки, исчерпавшей остаток, — по пакетам транша в порядке
         записи и той же арифметикой, что у вкладки. */
      const пакеты = await this.prisma.acceptanceBatch.findMany({
        where: { trancheId: открытый.id },
        orderBy: { createdAt: "asc" },
        select: {
          createdAt: true,
          acceptances: { select: { qty: true, item: { select: { unitPrice: true } } } },
        },
      });
      const с = исчерпанС(
        пакеты.map((пакет) => ({
          at: пакет.createdAt.toISOString(),
          выработка: acceptedTotal(пакет.acceptances.map((строка) => ({
            qty: milliunits(строка.qty),
            unitPrice: kopecks(строка.item.unitPrice),
          }))),
        })),
        kopecks(открытый.amount),
        basisPoints(вид.supervisionShare),
      );
      пункты.trancheToClose = { count: 1, since: день.day(new Date(с ?? открытый.openedAt)) };
    }
    return пункты;
  }

  /**
   * Отметка захода заказчика — «сейчас». Трогает только его собственную
   * запись и данных объекта не касается (решение допроса Э8-2).
   */
  async seen(user: RequestUser): Promise<InboxSeen> {
    const сейчас = new Date();
    await this.prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: сейчас } });
    return { seenAt: сейчас.toISOString() };
  }
}
