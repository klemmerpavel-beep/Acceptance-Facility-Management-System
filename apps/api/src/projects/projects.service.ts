import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { CreateProject, ProjectEvent, ProjectSummary, UpdateProject } from "@priyomka/contracts";
import {
  acceptedShare, basisPoints, clientTotals, estimateAgainstGuideline, kopecks,
  projectReadiness, trancheRemainder,
} from "@priyomka/domain";
import { PrismaService } from "../prisma.service";
import { AuditService } from "../common/audit.service";
import type { RequestUser } from "../common/current-user";
import { projectScope } from "../common/project-scope";
import { estimateFacts, type EstimateFacts } from "../common/estimate-facts";
import { acceptedFacts, type AcceptedFacts } from "../common/accepted-facts";
import { guidelineFacts, type GuidelineFacts } from "../common/guideline-facts";
import { openTranches, type OpenTranche } from "../common/tranche-facts";
import { coverPhotos } from "../common/cover-facts";

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
    const ids = projects.map((project) => project.id);
    /* Обложки идут в этой же связке, а не отдельным заходом на объект:
       `coverPhotos` берёт снимки всего списка одним запросом. */
    const [facts, tranches, обложки] = await Promise.all([
      estimateFacts(this.prisma, ids),
      openTranches(this.prisma, ids),
      coverPhotos(this.prisma, ids),
    ]);
    /* Принятое — одним запросом на весь портфель, а не по запросу на объект:
       реестр из восьми строк иначе стоил бы восьми обращений, и цена росла
       бы вместе с портфелем. Редакции берутся готовыми из `facts`. */
    const [принятое, ориентиры] = await Promise.all([
      acceptedFacts(this.prisma, facts),
      guidelineFacts(this.prisma, ids),
    ]);
    return projects.map((project) => toSummary(
      project, facts.get(project.id), tranches.get(project.id),
      принятое.get(project.id), ориентиры.get(project.id), обложки.get(project.id)));
  }

  async byCode(user: RequestUser, code: string): Promise<ProjectSummary> {
    const project = await this.prisma.project.findFirst({
      where: { ...projectScope(user), code },
      include: { client: true, foreman: true, workStages: STAGES },
    });
    if (!project) {
      throw new NotFoundException({ message: `Объект ${code} не найден или недоступен.` });
    }
    const [facts, tranches, обложки] = await Promise.all([
      estimateFacts(this.prisma, [project.id]),
      openTranches(this.prisma, [project.id]),
      coverPhotos(this.prisma, [project.id]),
    ]);
    const [принятое, ориентиры] = await Promise.all([
      acceptedFacts(this.prisma, facts),
      guidelineFacts(this.prisma, [project.id]),
    ]);
    return toSummary(
      project, facts.get(project.id), tranches.get(project.id),
      принятое.get(project.id), ориентиры.get(project.id), обложки.get(project.id));
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
   * Правка полей объекта на месте.
   *
   * Каждое изменённое поле уходит в журнал отдельной записью — тем же
   * способом, каким это делает смена статуса. Одной записью «объект правлен»
   * обойтись нельзя: журнал отвечает на вопрос «что именно стало другим»,
   * и сводная запись заставляет сличать две версии карточки, которых у
   * читателя нет.
   *
   * Непроменявшееся не пишется. Сохранение без изменения — обычное дело:
   * человек открыл поле, передумал и нажал «Сохранить». Запись о нём
   * засорила бы журнал строками «адрес: Ленина 1 → Ленина 1».
   *
   * Порядок: сперва сверяются все поля, потом пишется одна правка базы и
   * следом записи журнала. Правка по полю за раз оставила бы карточку в
   * половинном состоянии, если второе поле не прошло проверку.
   */
  async update(
    user: RequestUser,
    code: string,
    patch: UpdateProject,
  ): Promise<ProjectSummary> {
    if (user.role !== "OWNER") {
      throw new ForbiddenException({ message: "Поля объекта правит руководитель." });
    }
    const project = await this.prisma.project.findFirst({ where: { ...projectScope(user), code } });
    if (!project) {
      throw new NotFoundException({ message: `Объект ${code} не найден или недоступен.` });
    }

    /* Прораб проверяется до записи: чужой или несуществующий идентификатор
       иначе ушёл бы в базу и был бы отвергнут уже связью, сообщением
       драйвера вместо человеческого. */
    if (patch.foremanId !== undefined && patch.foremanId !== null) {
      const прораб = await this.prisma.user.findFirst({
        where: { id: patch.foremanId, orgId: user.orgId, role: "FOREMAN" },
      });
      if (!прораб) {
        throw new BadRequestException({ message: "Такого прораба нет в организации." });
      }
    }

    const день = (значение: Date | null): string | null =>
      значение === null ? null : значение.toISOString().slice(0, 10);

    /* Поля перечислены вместе со своими прежним и новым значением: список
       ведётся один раз и служит и записи в базу, и записям журнала. Две
       копии перечня разошлись бы на первом же добавленном поле, и в журнал
       перестало бы попадать именно оно. */
    const поля: {
      имя: string;
      было: string | null;
      стало: string | null;
      данные: Record<string, unknown>;
    }[] = [];
    if (patch.address !== undefined && patch.address !== project.address) {
      поля.push({ имя: "адрес", было: project.address, стало: patch.address,
        данные: { address: patch.address } });
    }
    if (patch.deadline !== undefined && patch.deadline !== день(project.deadline)) {
      поля.push({ имя: "срок", было: день(project.deadline), стало: patch.deadline,
        данные: { deadline: patch.deadline === null ? null : new Date(patch.deadline) } });
    }
    if (patch.startedAt !== undefined && patch.startedAt !== день(project.startedAt)) {
      поля.push({ имя: "начало работ", было: день(project.startedAt), стало: patch.startedAt,
        данные: { startedAt: patch.startedAt === null ? null : new Date(patch.startedAt) } });
    }
    if (patch.foremanId !== undefined && patch.foremanId !== project.foremanId) {
      поля.push({ имя: "прораб", было: project.foremanId, стало: patch.foremanId,
        данные: { foremanId: patch.foremanId } });
    }
    if (patch.keysCount !== undefined && patch.keysCount !== project.keysCount) {
      поля.push({ имя: "ключи", было: String(project.keysCount), стало: String(patch.keysCount),
        данные: { keysCount: patch.keysCount } });
    }

    if (поля.length > 0) {
      await this.prisma.project.update({
        where: { id: project.id },
        data: Object.assign({}, ...поля.map((поле) => поле.данные)) as Record<string, unknown>,
      });
      for (const поле of поля) {
        await this.audit.record({
          orgId: user.orgId,
          actorId: user.id,
          entity: "Project",
          entityId: project.id,
          field: поле.имя,
          oldValue: поле.было,
          newValue: поле.стало,
        });
      }
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
    const projectIds = projects.map((project) => project.id);
    /* Код объекта ищется по опознавателю записи. Часть записей адресована
       объектом, часть — этапом или траншем, поэтому карта пополняется их
       опознавателями: иначе событие графика осталось бы без объекта и в
       сводке портфеля было бы непонятно, о чём оно. */
    const кодПо = new Map(projects.map((project) => [project.id, project.code]));

    /*
     * Что видно в ленте и кому.
     *
     * Записи о деньгах — цены и ставки позиции, надбавка, суммы траншей —
     * видит только руководитель. Запись журнала есть обход поля: строка
     * «цена единицы: 1 150,50 ₽ → 1 200,00 ₽» рассказывает ровно то, что
     * поле скрывает от прораба. Разграничение на уровне полей иначе
     * держалось бы на одном экране и текло бы в ленте.
     *
     * График прорабу остаётся: сроки, готовность, раздел и бригада — то,
     * по чему он работает.
     *
     * Приёмки в ленте нет намеренно: вкладка показывает её пакетами со
     * строками, автором, снимком и сторно. Повторить её здесь значило бы
     * залить ленту дубликатом того, что рядом показано подробнее.
     */
    const внутренние = user.role === "OWNER";
    const поОбъекту = внутренние
      ? ["Project", "MeasureRoom", "MeasurePlan", "EstimateItem", "Estimate"]
      : ["Project", "MeasureRoom", "MeasurePlan"];

    const [этапы, транши] = await Promise.all([
      this.prisma.workStage.findMany({
        where: { projectId: { in: projectIds } },
        select: { id: true, projectId: true },
      }),
      внутренние
        ? this.prisma.tranche.findMany({
          where: { projectId: { in: projectIds } },
          select: { id: true, projectId: true },
        })
        : Promise.resolve([] as { id: string; projectId: string }[]),
    ]);
    for (const row of [...этапы, ...транши]) {
      const code = кодПо.get(row.projectId);
      if (code !== undefined) кодПо.set(row.id, code);
    }

    /**
     * Записи журнала по объекту, его этапам и траншам.
     *
     * Отбор уходит в запрос, а не фильтрует выбранное: недоступное роли не
     * должно физически попадать в ответ — то же правило, по которому
     * видимость объекта живёт в `projectScope`, а не в проверке после
     * выборки.
     *
     * Показывать эти записи обязательно: журнал заводился ради спора «кто
     * поменял величину», а запись, которую никто не видит, спора не решает.
     */
    const entries = await this.prisma.auditLog.findMany({
      where: {
        orgId: user.orgId,
        OR: [
          { entity: { in: поОбъекту }, entityId: { in: projectIds } },
          { entity: "WorkStage", entityId: { in: этапы.map((row) => row.id) } },
          ...(внутренние
            ? [{ entity: "Tranche", entityId: { in: транши.map((row) => row.id) } }]
            : []),
        ],
      },
      orderBy: { at: "desc" },
      take: limit,
      include: { actor: { select: { name: true } } },
    });

    const imports = await this.prisma.estimateImport.findMany({
      where: { estimate: { projectId: { in: projectIds } } },
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
        /* Вид «статус» — только у объекта. Состояние транша тоже писалось
           полем `status`, и общая ветка титуловала его «Статус: OPEN →
           CLOSED», то есть выдавала смену состояния транша за смену статуса
           объекта. Различает не имя поля, а сущность записи. */
        kind: статусОбъекта(entry) ? "status" : "field",
        title: статусОбъекта(entry)
          ? `Статус: ${label(entry.oldValue)} → ${label(entry.newValue)}`
          : `${РАЗДЕЛ[entry.entity] ?? "Объект"}: ${entry.field}`,
        detail: статусОбъекта(entry)
          ? null
          : `${entry.oldValue ?? "—"} → ${entry.newValue ?? "—"}`,
        projectCode: кодПо.get(entry.entityId) ?? null,
        actor: entry.actor?.name ?? null,
      })),
      ...imports.map((record): ProjectEvent => ({
        at: record.importedAt.toISOString(),
        kind: "import",
        title: `Импорт сметы: редакция ${record.estimate.version}, позиций ${record.positions}`,
        detail: record.fileName,
        projectCode: кодПо.get(record.estimate.projectId) ?? null,
        actor: null,
      })),
    ];

    return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }
}

/** Смена статуса объекта: только она рисуется отдельным видом события. */
const статусОбъекта = (entry: { entity: string; field: string }): boolean =>
  entry.entity === "Project" && entry.field === "status";

/**
 * Раздел продукта, к которому относится запись журнала.
 *
 * Заголовок называет место, а не механику: «Смета: цена единицы» вместо
 * «Правка поля „цена единицы"». Человек ищет в ленте по месту — «что там
 * было со сметой», — а слово «поле» в этом поиске не помогает.
 */
const РАЗДЕЛ: Readonly<Record<string, string>> = {
  Project: "Объект",
  MeasureRoom: "Замер",
  MeasurePlan: "Замер",
  EstimateItem: "Смета",
  Estimate: "Смета",
  WorkStage: "График",
  Tranche: "Транш",
};

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
  sectionId: string | null;
  brigade: { id: string; name: string } | null;
}

/**
 * Этапы приходят вместе с объектом одним запросом и в порядке ведения.
 * Отдельным обращением на объект полоса плана стоила бы сотни запросов на
 * один экран — ровно то, чем оборачивается ленивая связь в списке.
 */
/* Бригада приходит вместе с этапом: через неё приёмка узнаёт получателя
   начисления, и второй запрос за именем бригады на каждый этап дал бы
   семь обращений на один экран объекта. */
const STAGES = {
  orderBy: { order: "asc" },
  include: { brigade: { select: { id: true, name: true } } },
} as const;

const asDate = (value: Date | null): string | null =>
  value === null ? null : value.toISOString().slice(0, 10);

function toSummary(
  project: ProjectRow,
  facts: EstimateFacts | undefined,
  tranche: OpenTranche | undefined,
  accepted: AcceptedFacts | undefined,
  guideline: GuidelineFacts | undefined,
  coverPhotoId: string | undefined,
): ProjectSummary {
  // Итог для клиента считается по надбавке самой сметы: у объекта надбавка
  // может быть изменена после того, как смета уже импортирована.
  const totals =
    facts === undefined
      ? null
      : clientTotals(facts.works, basisPoints(facts.supervisionShare));
  /* Остаток текущего транша считается по надбавке действующей сметы, той
     же, что и итог для клиента: транш есть сумма платежа клиента, а клиент
     платит смету с надбавкой (БП-05). Открытого транша нет — величины нет,
     и это `null`, а не ноль: ноль означал бы «выработан ровно до копейки». */
  const остатокТранша = tranche === undefined || facts === undefined
    ? null
    : trancheRemainder(tranche.amount, tranche.produced, basisPoints(facts.supervisionShare));
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
    /* Принятое стоит рядом с заявленным, а не вместо него: заявленную
       ставит человек и она законно опережает приёмку, принятое считается по
       приёмке (БП-01). Сметы нет — принятого нет: `null` и прочерк, а не
       ноль. Ноль означал бы «ничего не принято», а это иное утверждение —
       то же правило, по которому `readiness` пуст без графика. */
    acceptedShare: facts === undefined || accepted === undefined
      ? null
      : (() => {
        const доля = acceptedShare(accepted.accepted, facts.works);
        return доля === null ? null : Number(доля);
      })(),
    accepted: accepted === undefined || facts === undefined
      ? null
      : kopecks(accepted.accepted).toString(),
    acceptedPositions: accepted?.positions ?? 0,
    /* Обложка — производная от приёмки, и собирается она здесь же, из
       готовой карты: у объекта без снимков это `null`, а не пустой объект.
       Пустой объект пришлось бы разбирать читателю ответа, а «снимков нет»
       и «снимок есть, но неизвестен» — разные утверждения. */
    cover: coverPhotoId === undefined ? null : { photoId: coverPhotoId },
    /* Ориентир и его сверка со сметой. Сверка пуста, пока сметы нет:
       ноль означал бы «сошлось копейка в копейку», а это иное утверждение. */
    guideline: guideline === undefined ? null : {
      low: guideline.low.toString(),
      high: guideline.high.toString(),
      typeName: guideline.typeName,
      area: guideline.area.toString(),
      rate: guideline.rate.toString(),
      spread: guideline.spread,
      leadNumber: guideline.leadNumber,
      verdict: totals === null ? null : (() => {
        const сверка = estimateAgainstGuideline(totals.total, {
          low: kopecks(guideline.low),
          high: kopecks(guideline.high),
        });
        return { verdict: сверка.verdict, delta: сверка.delta.toString() };
      })(),
    },
    trancheRemainder: остатокТранша === null ? null : остатокТранша.toString(),
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

