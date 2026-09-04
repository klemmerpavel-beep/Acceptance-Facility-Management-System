import { Injectable } from "@nestjs/common";
import type { Dashboard } from "@priyomka/contracts";
import {
  basisPoints, buildPortfolio, buildWeek, daysBetween,
  type CalendarEvent, type PortfolioProject,
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
    const feed = await this.projects.eventsFor(user, projects, 8);

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
      // Приёмки, акты и расходы появятся на своих этапах. До тех пор здесь
      // нули, а не правдоподобные числа: сводка не выдумывает работу.
      acceptance: { accepted: 0, pending: portfolio.estimate.positions, acts: 0, expenses: 0 },
      measure,
      deadlines: portfolio.deadlines.slice(0, 5),
      week,
      feed,
    };
  }
}

const asDay = (value: Date): string => value.toISOString().slice(0, 10);
