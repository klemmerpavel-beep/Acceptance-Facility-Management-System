import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { CreateProject, ProjectEvent, ProjectSummary } from "@priyomka/contracts";
import { basisPoints, clientTotals, projectReadiness } from "@priyomka/domain";
import { PrismaService } from "../prisma.service";
import { AuditService } from "../common/audit.service";
import type { RequestUser } from "../common/current-user";
import { projectScope } from "../common/project-scope";
import { estimateFacts, type EstimateFacts } from "../common/estimate-facts";

const STATUS_LABEL: Record<ProjectSummary["status"], string> = {
  NEW: "Новый",
  IN_PROGRESS: "В работе",
  PAUSED: "Пауза",
  WAITING_CLIENT: "Ждёт ответа",
  DONE: "Завершён",
  ARCHIVED: "Архив",
};

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: RequestUser): Promise<ProjectSummary[]> {
    const projects = await this.prisma.project.findMany({
      where: projectScope(user),
      include: { client: true, foreman: true, workStages: STAGES },
      orderBy: { code: "asc" },
    });
    const facts = await estimateFacts(this.prisma, projects.map((project) => project.id));
    return projects.map((project) => toSummary(project, facts.get(project.id)));
  }

  async byCode(user: RequestUser, code: string): Promise<ProjectSummary> {
    const project = await this.prisma.project.findFirst({
      where: { ...projectScope(user), code },
      include: { client: true, foreman: true, workStages: STAGES },
    });
    if (!project) {
      throw new NotFoundException({ message: `Объект ${code} не найден или недоступен.` });
    }
    const facts = await estimateFacts(this.prisma, [project.id]);
    return toSummary(project, facts.get(project.id));
  }

  /**
   * Заведение объекта.
   *
   * Заказчик обязателен и берётся из справочника: объект без заказчика не
   * бьётся ни со сметой, ни со счётом, а «завести на потом» означает
   * завести навсегда. Прораб и дата начала не спрашиваются — их назначают
   * тогда, когда бригада действительно выходит.
   */
  async create(user: RequestUser, input: CreateProject): Promise<ProjectSummary> {
    const client = await this.prisma.client.findFirst({
      where: { orgId: user.orgId, id: input.clientId },
      select: { id: true },
    });
    if (!client) {
      throw new BadRequestException({ message: "Заказчик не найден в справочнике." });
    }

    const занят = await this.prisma.project.findUnique({
      where: { orgId_code: { orgId: user.orgId, code: input.code } },
      select: { id: true },
    });
    if (занят) {
      throw new BadRequestException({
        message: `Объект ${input.code} уже заведён. Код объекта сквозной: два объекта с одним кодом разойдутся в почте и в актах.`,
      });
    }

    const project = await this.prisma.project.create({
      data: {
        orgId: user.orgId,
        code: input.code,
        address: input.address,
        clientId: client.id,
        deadline: input.deadline === null ? null : new Date(input.deadline),
      },
      select: { id: true },
    });

    await this.audit.record({
      orgId: user.orgId,
      actorId: user.id,
      entity: "Project",
      entityId: project.id,
      field: "создан",
      oldValue: null,
      newValue: `${input.code} — ${input.address}`,
    });

    return this.byCode(user, input.code);
  }

  /**
   * Смена статуса. Прежнее значение уходит в журнал: статус — единственное
   * поле карточки, которое меняют часто, и «кто перевёл объект в паузу»
   * спрашивают через неделю после того, как это сделали.
   */
  async setStatus(
    user: RequestUser,
    code: string,
    status: ProjectSummary["status"],
  ): Promise<ProjectSummary> {
    if (user.role !== "OWNER") {
      throw new ForbiddenException({ message: "Статус объекта меняет руководитель." });
    }
    const project = await this.prisma.project.findFirst({ where: { ...projectScope(user), code } });
    if (!project) {
      throw new NotFoundException({ message: `Объект ${code} не найден или недоступен.` });
    }
    if (project.status !== status) {
      await this.prisma.project.update({ where: { id: project.id }, data: { status } });
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "Project",
        entityId: project.id,
        field: "status",
        oldValue: project.status,
        newValue: status,
      });
    }
    return this.byCode(user, code);
  }

  /**
   * События объекта: журнал правок и протоколы импорта в одной ленте.
   * Карточка иначе не отвечает на вопрос «что тут вообще происходило».
   */
  async events(user: RequestUser, code: string, limit = 20): Promise<ProjectEvent[]> {
    const project = await this.prisma.project.findFirst({
      where: { ...projectScope(user), code },
      select: { id: true, code: true },
    });
    if (!project) {
      throw new NotFoundException({ message: `Объект ${code} не найден или недоступен.` });
    }
    return this.eventsFor(user, [project], limit);
  }

  /** Общая сборка ленты: используется и карточкой объекта, и сводкой. */
  async eventsFor(
    user: RequestUser,
    projects: readonly { id: string; code: string }[],
    limit: number,
  ): Promise<ProjectEvent[]> {
    if (projects.length === 0) return [];
    const byId = new Map(projects.map((project) => [project.id, project.code]));

    /**
     * Записи журнала трёх видов: правка объекта, правка обмера, замена
     * плана. Все три адресованы объектом, поэтому берутся одним запросом.
     *
     * Обмер адресуется объектом, а не помещением, намеренно: помещение
     * можно удалить, и запись об удалении, сославшись на исчезнувшую
     * строку, выпала бы из ленты — то есть самое важное событие обмера
     * стало бы единственным невидимым. Какое именно помещение правили,
     * названо в самой записи.
     *
     * Показывать эти записи обязательно: журнал заводился ради спора
     * «кто поменял площадь», а запись, которую никто не видит, спора не
     * решает.
     */
    const entries = await this.prisma.auditLog.findMany({
      where: {
        orgId: user.orgId,
        entity: { in: ["Project", "MeasureRoom", "MeasurePlan"] },
        entityId: { in: [...byId.keys()] },
      },
      orderBy: { at: "desc" },
      take: limit,
      include: { actor: { select: { name: true } } },
    });

    const imports = await this.prisma.estimateImport.findMany({
      where: { estimate: { projectId: { in: [...byId.keys()] } } },
      orderBy: { importedAt: "desc" },
      take: limit,
      select: {
        importedAt: true, fileName: true, positions: true,
        estimate: { select: { projectId: true, version: true } },
      },
    });

    const events: ProjectEvent[] = [
      ...entries.map((entry): ProjectEvent => ({
        at: entry.at.toISOString(),
        kind: entry.field === "status" ? "status" : "field",
        title:
          entry.field === "status"
            ? `Статус: ${label(entry.oldValue)} → ${label(entry.newValue)}`
            : `Правка поля «${entry.field}»`,
        detail: entry.field === "status" ? null : `${entry.oldValue ?? "—"} → ${entry.newValue ?? "—"}`,
        projectCode: byId.get(entry.entityId) ?? null,
        actor: entry.actor?.name ?? null,
      })),
      ...imports.map((record): ProjectEvent => ({
        at: record.importedAt.toISOString(),
        kind: "import",
        title: `Импорт сметы: редакция ${record.estimate.version}, позиций ${record.positions}`,
        detail: record.fileName,
        projectCode: byId.get(record.estimate.projectId) ?? null,
        actor: null,
      })),
    ];

    return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }
}

/**
 * Подпись статуса для журнала. Строка из журнала — не обязательно
 * действующий статус: старая запись могла быть сделана до переименования.
 * Утверждение типа это скрывало, и запасное значение никогда не срабатывало.
 */
const label = (status: string | null): string => {
  if (status === null) return "—";
  return Object.hasOwn(STATUS_LABEL, status)
    ? STATUS_LABEL[status as ProjectSummary["status"]]
    : status;
};

interface ProjectRow {
  id: string;
  code: string;
  address: string;
  status: ProjectSummary["status"];
  startedAt: Date | null;
  deadline: Date | null;
  createdAt: Date;
  keysCount: number;
  supervisionShare: number;
  client: { code: string; name: string; isCompany: boolean; requisites: string | null };
  foreman: { id: string; name: string } | null;
  workStages: StageRow[];
}

interface StageRow {
  id: string;
  name: string;
  order: number;
  startsOn: Date;
  endsOn: Date;
  progress: number;
}

/**
 * Этапы приходят вместе с объектом одним запросом и в порядке ведения.
 * Отдельным обращением на объект полоса плана стоила бы сотни запросов на
 * один экран — ровно то, чем оборачивается ленивая связь в списке.
 */
const STAGES = { orderBy: { order: "asc" } } as const;

const asDate = (value: Date | null): string | null =>
  value === null ? null : value.toISOString().slice(0, 10);

function toSummary(project: ProjectRow, facts: EstimateFacts | undefined): ProjectSummary {
  // Итог для клиента считается по надбавке самой сметы: у объекта надбавка
  // может быть изменена после того, как смета уже импортирована.
  const totals =
    facts === undefined
      ? null
      : clientTotals(facts.works, basisPoints(facts.supervisionShare));
  const readiness = projectReadiness(
    project.workStages.map((stage) => ({
      startsOn: stage.startsOn.toISOString().slice(0, 10),
      endsOn: stage.endsOn.toISOString().slice(0, 10),
      progress: basisPoints(stage.progress),
    })),
  );
  return {
    id: project.id,
    code: project.code,
    address: project.address,
    status: project.status,
    startedAt: asDate(project.startedAt),
    deadline: asDate(project.deadline),
    createdAt: project.createdAt.toISOString().slice(0, 10),
    keysCount: project.keysCount,
    supervisionShare: project.supervisionShare,
    client: {
      code: project.client.code,
      name: project.client.name,
      isCompany: project.client.isCompany,
      requisites: project.client.requisites,
    },
    foreman: project.foreman ? { id: project.foreman.id, name: project.foreman.name } : null,
    estimateTotal: totals === null ? null : totals.total.toString(),
    estimateVersion: facts?.version ?? null,
    positions: facts?.positions ?? 0,
    // Готовность взвешена по длительности этапов (packages/domain/src/schedule.ts).
    // Объект без графика получает null, а не ноль: «работа не начата» и
    // «график не заведён» — разные утверждения, и одно число на оба лишило
    // бы читателя возможности их различить.
    readiness: readiness === null ? null : Number(readiness),
    stages: project.workStages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      order: stage.order,
      startsOn: stage.startsOn.toISOString().slice(0, 10),
      endsOn: stage.endsOn.toISOString().slice(0, 10),
      progress: stage.progress,
    })),
  };
}

