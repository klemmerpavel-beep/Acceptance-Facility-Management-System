import { Injectable } from "@nestjs/common";
import type { Dashboard, LeadStage } from "@priyomka/contracts";
import {
  acceptedTotal, basisPoints, buildPortfolio, buildWeek, daysBetween, guidelineRange,
  kopecks, milliunits, taskState,
  type CalendarEvent, type Kopecks, type Milliunits, type PortfolioProject,
} from "@priyomka/domain";
import { PrismaService } from "../prisma.service";
import type { RequestUser } from "../common/current-user";
import { projectScope } from "../common/project-scope";
import { estimateFacts } from "../common/estimate-facts";
import { ProjectsService } from "../projects/projects.service";

/** Срок считается близким за две недели — то же правило, что и в домене. */
const SOON_DAYS = 14;

@Injectable()
export class SummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  /**
   * Сводка первого экрана. Считается по тем же объектам, что видит роль:
   * прораб получает портфель своих объектов, а не студии целиком.
   *
   * Сегодняшний день вычисляется здесь и уходит в ответ: клиент показывает
   * ту же неделю, что посчитал сервер, и не расходится с ним на границе суток.
   */
  async dashboard(user: RequestUser, today = new Date()): Promise<Dashboard> {
    const day = today.toISOString().slice(0, 10);

    const projects = await this.prisma.project.findMany({
      where: projectScope(user),
      select: {
        id: true, code: true, address: true, status: true,
        deadline: true, supervisionShare: true,
      },
      orderBy: { code: "asc" },
    });
    const facts = await estimateFacts(this.prisma, projects.map((project) => project.id));

    /**
     * Охват портфеля обмером. Одним запросом по всем видимым объектам: на
     * восьми объектах разница незаметна, но запрос на объект превратил бы
     * сводку в N+1 при первом же росте портфеля.
     */
    const rooms = await this.prisma.measureRoom.findMany({
      where: { projectId: { in: projects.map((project) => project.id) } },
      select: { projectId: true, floorArea: true },
    });
    const measure = {
      projects: new Set(rooms.map((room) => room.projectId)).size,
      rooms: rooms.length,
      floorArea: rooms.reduce((total, room) => total + room.floorArea, 0n).toString(),
    };

    /**
     * Выполнено на сумму по каждому объекту. Одним запросом по всем видимым
     * объектам — по той же причине, что и обмер: запрос на объект даёт N+1.
     *
     * Считается по записям приёмки: сторно приходит отрицательным
     * количеством и вычитается тем же проходом, второй обход не нужен.
     */
    const принятое = await this.prisma.acceptance.findMany({
      where: { batch: { projectId: { in: projects.map((project) => project.id) } } },
      select: {
        qty: true,
        itemId: true,
        batch: { select: { projectId: true } },
        item: { select: { unitPrice: true } },
      },
    });
    const выполнено = new Map<string, { qty: Milliunits; unitPrice: Kopecks }[]>();
    /* Принятой считается позиция с положительным итогом по её записям:
       полностью сторнированная в счётчик не входит — она снова ждёт приёмки. */
    const поПозиции = new Map<string, bigint>();
    for (const row of принятое) {
      const список = выполнено.get(row.batch.projectId) ?? [];
      список.push({ qty: milliunits(row.qty), unitPrice: kopecks(row.item.unitPrice) });
      выполнено.set(row.batch.projectId, список);
      поПозиции.set(row.itemId, (поПозиции.get(row.itemId) ?? 0n) + row.qty);
    }
    const принятыхПозиций = [...поПозиции.values()].filter((qty) => qty > 0n).length;

    const portfolioInput: PortfolioProject[] = projects.map((project) => {
      const own = facts.get(project.id);
      return {
        code: project.code,
        address: project.address,
        status: project.status,
        deadline: project.deadline === null ? null : asDay(project.deadline),
        worksTotal: own?.works ?? null,
        wageTotal: own?.wage ?? null,
        supervisionShare: basisPoints(own?.supervisionShare ?? project.supervisionShare),
        positions: own?.positions ?? 0,
        discrepancy: own?.discrepancy ?? null,
        findings: own?.findings ?? 0,
        acceptedTotal: acceptedTotal(выполнено.get(project.id) ?? []),
      };
    });

    const portfolio = buildPortfolio(portfolioInput, { today: day, role: user.role });

    // События недели: сроки объектов и импорты смет. Придуманных событий в
    // полосе нет — если неделя пуста, она так и показывается.
    const deadlineEvents: CalendarEvent[] = projects
      .filter((project): project is typeof project & { deadline: Date } => project.deadline !== null)
      .map((project) => {
        const date = asDay(project.deadline);
        const days = daysBetween(day, date);
        return {
          date,
          kind: "deadline" as const,
          title: `Дедлайн ${project.code}`,
          projectCode: project.code,
          tone: days < 0 ? ("danger" as const)
            : days <= SOON_DAYS ? ("warn" as const)
            : ("neutral" as const),
        };
      });

    const codeById = new Map(projects.map((project) => [project.id, project.code]));
    const importEvents: CalendarEvent[] = [...facts.entries()]
      .map(([projectId, own]) => ({ projectId, own }))
      .filter((entry): entry is { projectId: string; own: typeof entry.own & { importedAt: Date } } =>
        entry.own.importedAt !== null)
      .map((entry) => {
        const code = codeById.get(entry.projectId) ?? null;
        return {
          date: asDay(entry.own.importedAt),
          kind: "import" as const,
          title: `Импорт сметы${code === null ? "" : ` ${code}`}`,
          projectCode: code,
          tone: "ok" as const,
        };
      });

    const week = buildWeek(day, [...deadlineEvents, ...importEvents]);
    /* Двадцать записей, а не восемь: главная показывает четыре свежие, а
       остальные открываются кнопкой на том же экране. Восьми хватало, пока
       лента была развёрнута целиком; под раскрытие восемь означало бы, что
       за кнопкой прячутся четыре строки. */
    const feed = await this.projects.eventsFor(user, projects, 20);

    /*
     * Воронка на первом экране. Руководителю — целиком, прорабу — не
     * приходит вовсе: заявок он не касается, и пустые счётчики сообщали бы
     * «заявок нет» вместо «это не ваш контур».
     *
     * Просроченные задачи считаются по дате тем же доменом, что на доске:
     * второй счёт просрочки разошёлся бы с первым на границе суток.
     */
    const воронка = user.role !== "OWNER" ? undefined : await (async () => {
      const заявки = await this.prisma.lead.findMany({
        where: { orgId: user.orgId, outcome: "OPEN" },
        select: {
          stage: true, area: true, rateSnapshot: true, spreadSnapshot: true,
          tasks: { select: { dueOn: true, doneAt: true } },
        },
      });
      const середины = заявки
        .map((заявка) => (
          заявка.area === null || заявка.rateSnapshot === null || заявка.spreadSnapshot === null
            ? null
            : guidelineRange(
              milliunits(заявка.area),
              kopecks(заявка.rateSnapshot),
              basisPoints(заявка.spreadSnapshot),
            )
        ))
        .filter((вилка): вилка is NonNullable<typeof вилка> => вилка !== null)
        /* Середина вилки, а не её край: сумма нижних границ занижала бы
           портфель воронки, сумма верхних — завышала. */
        .map((вилка) => (вилка.low + вилка.high) / 2n);

      return {
        stages: STAGE_LABELS.map(({ stage, label }) => ({
          stage,
          label,
          count: заявки.filter((заявка) => заявка.stage === stage).length,
        })),
        open: заявки.length,
        overdueTasks: заявки.reduce((всего, заявка) => всего + заявка.tasks.filter((task) =>
          taskState(
            task.dueOn.toISOString().slice(0, 10),
            task.doneAt === null ? null : task.doneAt.toISOString().slice(0, 10),
            day,
          ) === "просрочена").length, 0),
        quoted: середины.length,
        quotedMid: середины.reduce((всего, середина) => всего + середина, 0n).toString(),
      };
    })();

    return {
      today: day,
      money: {
        works: portfolio.money.works.toString(),
        supervision: portfolio.money.supervision.toString(),
        estimate: portfolio.money.estimate.toString(),
        accepted: portfolio.money.accepted.toString(),
        ...(portfolio.money.wage === undefined ? {} : { wage: portfolio.money.wage.toString() }),
      },
      statuses: portfolio.statuses,
      projects: portfolio.projects,
      estimate: {
        positions: portfolio.estimate.positions,
        findings: portfolio.estimate.findings,
        discrepancy: portfolio.estimate.discrepancy.toString(),
        projectsWithDiscrepancy: portfolio.estimate.projectsWithDiscrepancy,
      },
      /* Принятые позиции считаются по записям приёмки. Акты и расходы
         появятся на этапе Э4; до тех пор здесь нули, а не правдоподобные
         числа: сводка не выдумывает работу. */
      acceptance: {
        accepted: принятыхПозиций,
        pending: portfolio.estimate.positions - принятыхПозиций,
        acts: 0,
        expenses: 0,
      },
      measure,
      ...(воронка === undefined ? {} : { leads: воронка }),
      deadlines: portfolio.deadlines.slice(0, 5),
      week,
      feed,
    };
  }
}

const asDay = (value: Date): string => value.toISOString().slice(0, 10);

/** Подписи стадий воронки. Те же, что отдаёт доска. */
const STAGE_LABELS: readonly { stage: LeadStage; label: string }[] = [
  { stage: "FIRST_CONTACT", label: "Первичный контакт" },
  { stage: "MEETING", label: "Знакомство" },
  { stage: "DECIDING", label: "Принимают решение" },
  { stage: "CONTRACT", label: "Согласование договора" },
];
