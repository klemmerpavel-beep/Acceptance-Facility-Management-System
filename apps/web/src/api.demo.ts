/**
 * Слой доступа к данным для демонстрационной сборки.
 *
 * Повторяет набор функций `api.ts`, но вместо запросов к серверу отдаёт
 * слепок настоящих ответов, снятый с работающего стенда. Экраны при этом
 * используются те же самые: демонстрация показывает продукт, а не макет.
 *
 * Чего демонстрация не делает: не проверяет права на сервере, не пишет в
 * базу, не разбирает приложенный файл. Разграничение по ролям показано
 * данными, которые сервер отдал каждой роли на самом деле.
 */
import type {
  ClientRow, CreateMeasureRoom, CurrentUser, Dashboard, EstimateView, ImportRecord, ImportReport,
  ImportResult, MeasureRoom, MeasureView, Organization, ProjectEvent, ProjectStatus, ProjectSummary,
  CreateClient, CreateProject, CreateWorker,
  SmsCodeIssued, Unit, UpdateMeasureRoom, UpdateWorkStage, WorkerRow, WorkStage, CreateWorkStage,
  AcceptanceView, CreateAcceptance, Reversal,
  CloseTranche, CreateTranche, TrancheView,
} from "@priyomka/contracts";
import {
  acceptanceFault, accrualAmount, clientAmount, basisPoints, kopecks, measureTotals,
  milliunits, nextTrancheNumber, projectRange, trancheFault, trancheFill, trancheRemainder,
  remainingQty, roomVolume, stageDateFault, wallArea,
  type ProjectRange,
} from "@priyomka/domain";
import snapshot from "./demo/snapshot.json" with { type: "json" };

interface Snapshot {
  "me-owner": CurrentUser;
  "me-foreman": CurrentUser;
  "projects-owner": ProjectSummary[];
  "projects-foreman": ProjectSummary[];
  "summary-owner": Dashboard;
  "summary-foreman": Dashboard;
  "clients-owner": ClientRow[];
  "clients-foreman": ClientRow[];
  workers: WorkerRow[];
  "events-owner": ProjectEvent[];
  "events-foreman": ProjectEvent[];
  units: string[];
  organization: Organization;
  unitDirectory: Unit[];
  "acceptance-owner": AcceptanceView;
  "acceptance-foreman": AcceptanceView;
  tranches: TrancheView;
  "estimate-owner": EstimateView;
  "estimate-foreman": EstimateView;
  imports: ImportRecord[];
  preview: { fileName: string; report: ImportReport };
  import: ImportResult;
  measure: MeasureView;
}

const data = snapshot as unknown as Snapshot;

/**
 * Роли в демонстрации больше нет: пользователь у продукта один. Слепок
 * по-прежнему снят от руководителя — это и есть единственный пользователь.
 */
let signedIn = true;

/**
 * Правки, сделанные в демонстрации, живут до перезагрузки страницы: сервера
 * нет, но и притворяться, будто смена статуса не сработала, неправильно —
 * иначе кнопка выглядела бы сломанной.
 */
const changedStatus = new Map<string, ProjectStatus>();

/**
 * Обмер демонстрации. Правки живут до перезагрузки, как и смена статуса.
 * Производные величины считает тот же домен, что и сервер: показывать в
 * демонстрации другое число, чем в продукте, — обман, а не упрощение.
 */
let measureRooms: MeasureRoom[] = [];
let measurePlan: MeasureView["plan"] = null;

const measured = (room: MeasureRoom): MeasureRoom => {
  const values = {
    floorArea: milliunits(room.floorArea),
    floorPerimeter: milliunits(room.floorPerimeter),
    ceilingPerimeter: milliunits(room.ceilingPerimeter),
    height: milliunits(room.height),
  };
  return {
    ...room,
    wallArea: wallArea(values).toString(),
    volume: roomVolume(values).toString(),
  };
};

const measureView = (): MeasureView => {
  const totals = measureTotals(measureRooms.map((room) => ({
    floorArea: milliunits(room.floorArea),
    floorPerimeter: milliunits(room.floorPerimeter),
    ceilingPerimeter: milliunits(room.ceilingPerimeter),
    height: milliunits(room.height),
  })));
  return {
    rooms: measureRooms,
    totals: {
      rooms: totals.rooms,
      floorArea: totals.floorArea.toString(),
      wallArea: totals.wallArea.toString(),
      floorPerimeter: totals.floorPerimeter.toString(),
      ceilingPerimeter: totals.ceilingPerimeter.toString(),
      volume: totals.volume.toString(),
    },
    plan: measurePlan,
  };
};

/**
 * Приведение отказа к тексту для экрана. Двойник обязан повторять весь
 * набор экспортов `api.ts`: подмена идёт разрешением модуля, и недостающий
 * экспорт роняет сборку демонстрации, а не отдельный экран.
 */
export const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "Неизвестная ошибка. Повторите действие.";


export const demoSignIn = (): void => {
  signedIn = true;
};

const pause = (ms = 180): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchCurrentUser(): Promise<CurrentUser> {
  await pause(60);
  if (!signedIn) throw new Error("Войдите по ссылке, отправленной на почту.");
  return data["me-owner"];
}

export async function fetchProjects(): Promise<ProjectSummary[]> {
  await pause(60);
  const rows = [...data["projects-owner"], ...заведённые.projects];
  return rows.map(withChangedStatus);
}

const withChangedStatus = (project: ProjectSummary): ProjectSummary => {
  const status = changedStatus.get(project.code);
  return status === undefined ? project : { ...project, status };
};

export async function fetchDashboard(): Promise<Dashboard> {
  await pause(120);
  return data["summary-owner"];
}

/**
 * Записи, заведённые в демонстрации. Живут до перезагрузки, как и смена
 * статуса: сервера нет, но притворяться, будто кнопка не сработала, хуже —
 * форма выглядела бы сломанной именно там, где показывает главное обещание
 * экрана: сохранённая запись видна в списке сразу.
 */
const заведённые: { clients: ClientRow[]; workers: WorkerRow[]; projects: ProjectSummary[] } = {
  clients: [],
  workers: [],
  projects: [],
};

/** Идентификатор заведённой записи. Сервера нет, uuid берётся из счётчика. */
let счётчик = 0;
const новыйId = (): string =>
  `00000000-0000-4000-8000-${String((счётчик += 1)).padStart(12, "0")}`;

export async function fetchClients(): Promise<ClientRow[]> {
  await pause(80);
  return [...data["clients-owner"], ...заведённые.clients];
}

export async function fetchWorkers(): Promise<WorkerRow[]> {
  await pause(80);
  return [...data.workers, ...заведённые.workers];
}

export async function createClient(input: CreateClient): Promise<ClientRow[]> {
  await pause(120);
  if ([...data["clients-owner"], ...заведённые.clients].some((row) => row.code === input.code)) {
    throw new Error(`Заказчик с кодом ${input.code} уже заведён.`);
  }
  заведённые.clients.push({
    id: новыйId(),
    code: input.code,
    name: input.name,
    isCompany: input.isCompany,
    requisites: input.requisites,
    projects: 0,
    estimateTotal: "0",
  });
  return [...data["clients-owner"], ...заведённые.clients];
}

export async function createWorker(input: CreateWorker): Promise<WorkerRow[]> {
  await pause(120);
  if ([...data.workers, ...заведённые.workers].some((row) => row.name === input.name)) {
    throw new Error(`«${input.name}» уже есть в справочнике.`);
  }
  заведённые.workers.push({ id: новыйId(), name: input.name, kind: input.kind });
  return [...data.workers, ...заведённые.workers];
}

export async function createProject(input: CreateProject): Promise<ProjectSummary> {
  await pause(120);
  const все = [...data["projects-owner"], ...заведённые.projects];
  if (все.some((project) => project.code === input.code)) {
    throw new Error(
      `Объект ${input.code} уже заведён. Код объекта сквозной: два объекта с одним кодом разойдутся в почте и в актах.`,
    );
  }
  const client = [...data["clients-owner"], ...заведённые.clients].find(
    (row) => row.id === input.clientId,
  );
  const created: ProjectSummary = {
    id: новыйId(),
    code: input.code,
    address: input.address,
    status: "NEW",
    startedAt: null,
    deadline: input.deadline,
    // Объект заводится «сегодня» демонстрации, а не в день открытия страницы:
    // снимок и так живёт в одной дате, и вторая сбила бы сроки.
    createdAt: data["summary-owner"].today,
    keysCount: 0,
    supervisionShare: 1200,
    client: {
      code: client?.code ?? "—",
      name: client?.name ?? "—",
      isCompany: client?.isCompany ?? false,
      requisites: client?.requisites ?? null,
    },
    foreman: null,
    estimateTotal: null,
    estimateVersion: null,
    positions: 0,
    // Графика у нового объекта нет, и готовность не задана, а не равна нулю.
    readiness: null,
    // Транша у нового объекта нет: остаток отсутствует, а не равен нулю.
    trancheRemainder: null,
    stages: [],
  };
  заведённые.projects.push(created);
  return created;
}

export async function fetchEvents(code: string): Promise<ProjectEvent[]> {
  await pause(80);
  if (code !== "R-99") return [];
  return data["events-owner"];
}

/**
 * Смена статуса. На стенде это запрос PATCH с записью прежнего значения в
 * журнал; здесь — правка в памяти. Роль проверяется так же, как на сервере:
 * статус меняет руководитель.
 */
export async function setProjectStatus(
  code: string,
  status: ProjectStatus,
): Promise<ProjectSummary> {
  await pause(240);
  const rows = [...data["projects-owner"], ...заведённые.projects];
  const project = rows.find((row) => row.code === code);
  if (project === undefined) throw new Error(`Объект ${code} не найден или недоступен.`);
  changedStatus.set(code, status);
  return { ...project, status };
}

export async function fetchCanonicalUnits(): Promise<string[]> {
  await pause(40);
  return data.units;
}

export async function requestSmsCode(phone: string): Promise<SmsCodeIssued> {
  await pause();
  // Слепок снят с работающего стенда, сервера здесь нет: код фиксированный
  // и показывается на экране, как на стенде.
  return { sent: true, phone, code: "418302", retryAfterSeconds: 60 };
}

export async function confirmSmsCode(): Promise<{ ok: true }> {
  await pause();
  demoSignIn();
  return { ok: true };
}

export async function fetchOrganization(): Promise<Organization> {
  await pause(40);
  return data.organization;
}

/** Правка в демонстрации не сохраняется: сервера нет, и врать об этом нельзя. */
export async function saveOrganization(): Promise<Organization> {
  await pause();
  throw new Error("Демонстрация показывает слепок данных: правка не сохраняется.");
}

export async function fetchUnits(): Promise<Unit[]> {
  await pause(40);
  return data.unitDirectory;
}

export async function logout(): Promise<{ ok: true }> {
  await pause(60);
  signedIn = false;
  return { ok: true };
}

export async function previewEstimate(): Promise<{ fileName: string; report: ImportReport }> {
  await pause(600);
  return data.preview;
}

/**
 * Импорт повторяет поведение сервера: пока написания единиц не приведены к
 * справочнику, запись не выполняется. Сообщение — то же, что отдаёт API.
 */
export async function importEstimate(
  _code: string,
  _file: File,
  overrides: Record<string, string>,
): Promise<ImportResult> {
  await pause(700);
  const unresolved = data.preview.report.unitDecisions.filter(
    (decision) => (overrides[decision.raw] ?? "") === "",
  );
  if (unresolved.length > 0) {
    const positions = unresolved.reduce((sum, decision) => sum + decision.positions, 0);
    throw new Error(
      `Импорт остановлен: ${positions} позиций с написаниями единиц, которые не приведены ` +
        `к справочнику — ${unresolved.map((d) => d.raw.trim()).join(", ")}. ` +
        "Сопоставьте их на экране импорта и повторите.",
    );
  }
  return data.import;
}

/**
 * Смета в проекции той роли, за которую сейчас смотрят. Слепки сняты с
 * сервера порознь: у прораба внутренних величин нет не потому, что их
 * скрыл интерфейс, а потому, что сервер их не отдал.
 */
export async function fetchEstimate(code: string): Promise<EstimateView> {
  await pause(320);
  if (code !== "R-99") {
    throw new Error(`У объекта ${code} нет сметы. Импортируйте её на вкладке «Импорт».`);
  }
  return data["estimate-owner"];
}

export async function fetchImports(code: string): Promise<ImportRecord[]> {
  await pause(120);
  return code === "R-99" ? data.imports : [];
}

/* --- приёмка выполненных работ --------------------------------------------
   Правки живут в памяти вкладки до перезагрузки. Снимок не разбирается:
   демонстрация показывает заготовку вместо снятого файла — сервера, который
   принял бы фотографию, здесь нет. */

/** Заготовка снимка: приглушённый градиент 96×72, вшит в страницу. */
const ЗАГОТОВКА_СНИМКА = "data:image/png;base64,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";

let приёмка: AcceptanceView | null = null;

const приёмкаR99 = (role: "OWNER" | "FOREMAN"): AcceptanceView => {
  приёмка ??= structuredClone(data["acceptance-owner"]);
  if (role === "OWNER") return приёмка;
  /* Прорабу внутренние величины не отдаются. Ключи убираются, а не
     обнуляются: в продукте их в ответе нет вовсе. */
  return {
    ...приёмка,
    sections: приёмка.sections.map((section) => ({
      ...section,
      positions: section.positions.map((position) => ({
        id: position.id,
        name: position.name,
        unit: position.unit,
        order: position.order,
        qty: position.qty,
        accepted: position.accepted,
        remaining: position.remaining,
        unitPrice: position.unitPrice,
      })),
    })),
    batches: приёмка.batches.map((batch) => ({
      ...batch,
      lines: batch.lines.map((line) => ({
        id: line.id,
        positionName: line.positionName,
        unit: line.unit,
        qty: line.qty,
        reversedAt: line.reversedAt,
        reason: line.reason,
      })),
    })),
    totals: {
      positions: приёмка.totals.positions,
      acceptedPositions: приёмка.totals.acceptedPositions,
      accepted: приёмка.totals.accepted,
    },
  };
};

export async function fetchAcceptance(code: string): Promise<AcceptanceView> {
  await pause(220);
  if (code !== "R-99") {
    return { sections: [], batches: [], totals: { positions: 0, acceptedPositions: 0, accepted: "0" } };
  }
  return приёмкаR99(data["me-owner"].role === "OWNER" ? "OWNER" : "FOREMAN");
}

export async function createAcceptance(
  _code: string,
  batch: CreateAcceptance,
  photo: File,
): Promise<AcceptanceView> {
  await pause(320);
  /* Тип снимка проверяется и здесь: на сервере он определяется по содержимому
     файла, а в демонстрации содержимое читать нечем — но отказ должен быть
     тот же, иначе демонстрация примет то, что продукт отвергнет. */
  if (!photo.type.startsWith("image/")) {
    throw new Error("Снимок принимается изображением: image/jpeg, image/png, image/webp.");
  }
  const вид = приёмкаR99("OWNER");
  const section = вид.sections.find((row) => row.id === batch.sectionId);
  if (section === undefined) throw new Error("Раздел не найден в действующей смете объекта.");
  const brigade = section.stage?.brigade;
  if (brigade == null) {
    throw new Error(`У раздела «${section.name}» нет этапа графика с бригадой. `
      + "Свяжите раздел с этапом на вкладке «Работа»: начисление адресуется бригаде этапа.");
  }

  const lines = [];
  for (const принято of batch.positions) {
    const position = section.positions.find((row) => row.id === принято.itemId);
    if (position === undefined) throw new Error("Позиция не найдена в действующей смете объекта.");
    const fault = acceptanceFault({
      requested: milliunits(принято.qty),
      qty: milliunits(position.qty),
      accepted: milliunits(position.accepted),
      unit: position.unit,
    });
    if (fault !== null) throw new Error(`${position.name}. ${fault}`);

    position.accepted = (milliunits(position.accepted) + milliunits(принято.qty)).toString();
    position.remaining = remainingQty(milliunits(position.qty), milliunits(position.accepted)).toString();
    lines.push({
      id: новыйId(),
      positionName: position.name,
      unit: position.unit,
      qty: принято.qty,
      reversedAt: null,
      reason: null,
      amount: accrualAmount(kopecks(position.unitWage ?? "0"), milliunits(принято.qty)).toString(),
    });
  }

  вид.batches = [{
    id: новыйId(),
    sectionId: section.id,
    sectionName: section.name,
    brigade,
    createdAt: new Date().toISOString(),
    author: data["me-owner"].name,
    comment: batch.comment ?? null,
    photos: [новыйId()],
    lines,
  }, ...вид.batches];
  выработатьВТранш(вид, section.id, lines, 1n);
  пересчитатьПриёмку(вид);
  return приёмкаR99("OWNER");
}

export async function reverseAcceptance(
  _code: string,
  id: string,
  input: Reversal,
): Promise<AcceptanceView> {
  await pause(280);
  const вид = приёмкаR99("OWNER");
  for (const batch of вид.batches) {
    const line = batch.lines.find((row) => row.id === id);
    if (line === undefined) continue;
    if (line.reversedAt !== null) throw new Error("Эта приёмка уже сторнирована.");
    line.reversedAt = new Date().toISOString();
    line.reason = input.reason;
    const position = вид.sections
      .find((section) => section.id === batch.sectionId)?.positions
      .find((row) => row.name === line.positionName);
    if (position !== undefined) {
      position.accepted = (milliunits(position.accepted) - milliunits(line.qty)).toString();
      position.remaining = remainingQty(milliunits(position.qty), milliunits(position.accepted)).toString();
    }
    выработатьВТранш(вид, batch.sectionId, [line], -1n);
    пересчитатьПриёмку(вид);
    return приёмкаR99("OWNER");
  }
  throw new Error("Приёмка не найдена на этом объекте.");
}

/**
 * Провести выработку в открытый транш. Знак задаётся вызывающим: приёмка
 * прибавляет, сторно вычитает.
 *
 * Открытого транша нет — выработка никуда не идёт и остаётся «вне транша»,
 * ровно как на сервере: приписать её траншу задним числом значило бы
 * переписать историю.
 */
function выработатьВТранш(
  вид: AcceptanceView,
  sectionId: string,
  lines: readonly { positionName: string; qty: string }[],
  знак: bigint,
): void {
  const транши = траншиR99();
  const открытый = транши.current;
  if (открытый === null) return;

  const позиции = вид.sections.find((section) => section.id === sectionId)?.positions ?? [];
  const дельта = lines.reduce((всего, line) => {
    const position = позиции.find((row) => row.name === line.positionName);
    return всего + accrualAmount(kopecks(position?.unitPrice ?? "0"), milliunits(line.qty));
  }, 0n);

  открытый.produced = (kopecks(открытый.produced) + знак * дельта).toString();
  пересчитатьТранш(открытый, транши.supervisionShare);
}

/** Итоги пересчитываются целиком: складывать разности значило бы завести
    вторую копию правил, которая разойдётся с первой. */
function пересчитатьПриёмку(вид: AcceptanceView): void {
  const строки = вид.batches.flatMap((batch) =>
    batch.lines.filter((line) => line.reversedAt === null).map((line) => ({ batch, line })));
  вид.totals.acceptedPositions = вид.sections
    .flatMap((section) => section.positions)
    .filter((position) => milliunits(position.accepted) > 0n).length;
  вид.totals.accepted = строки.reduce((всего, { batch, line }) => {
    const position = вид.sections
      .find((section) => section.id === batch.sectionId)?.positions
      .find((row) => row.name === line.positionName);
    return всего + accrualAmount(kopecks(position?.unitPrice ?? "0"), milliunits(line.qty));
  }, 0n).toString();
  вид.totals.accrued = строки
    .reduce((всего, { line }) => всего + kopecks(line.amount ?? "0"), 0n).toString();

  const своды = new Map<string, { name: string; сумма: bigint }>();
  for (const { batch, line } of строки) {
    const прежнее = своды.get(batch.brigade.id);
    своды.set(batch.brigade.id, {
      name: batch.brigade.name,
      сумма: (прежнее?.сумма ?? 0n) + kopecks(line.amount ?? "0"),
    });
  }
  вид.accruals = [...своды].map(([brigadeId, свод]) => ({
    brigadeId,
    brigadeName: свод.name,
    week: свод.сумма.toString(),
    total: свод.сумма.toString(),
    /* Все пакеты стенда записаны при открытом транше, поэтому разрез за
       транш совпадает с итогом. Транш закрыт — разрезать нечем, и это
       null, а не ноль: ноль означал бы «за транш не начислено». */
    tranche: траншиR99().current === null ? null : свод.сумма.toString(),
  }));
}

/** Снимок пакета: в демонстрации это вшитая заготовка, а не файл на сервере. */
export const acceptancePhotoUrl = (): string => ЗАГОТОВКА_СНИМКА;

/* --- график производства работ ------------------------------------------
   Сервера в демонстрации нет, но правка графика обязана работать: именно
   её заказчик и смотрит. Этапы берутся из снимка объекта R-99 и живут в
   памяти вкладки — до перезагрузки страницы. Валидатор дат тот же, что на
   сервере: демонстрация не должна принимать то, что продукт отвергнет. */

let этапы: WorkStage[] | null = null;

const этапыR99 = (): WorkStage[] => {
  этапы ??= data["projects-owner"].find((project) => project.code === "R-99")?.stages ?? [];
  return [...этапы].sort((left, right) => left.order - right.order);
};

/** Диапазон объекта — тем же правилом домена, что на сервере. */
const диапазонR99 = (): ProjectRange => {
  const объект = data["projects-owner"].find((project) => project.code === "R-99");
  return projectRange({
    startedAt: объект?.startedAt ?? null,
    deadline: объект?.deadline ?? null,
    createdAt: объект?.createdAt ?? data["summary-owner"].today,
  });
};

const проверитьДаты = (dates: { startsOn: string; endsOn: string }): void => {
  const отказ = stageDateFault(dates, диапазонR99());
  if (отказ !== null) throw new Error(отказ);
};

export async function fetchStages(code: string): Promise<WorkStage[]> {
  await pause(180);
  return code === "R-99" ? этапыR99() : [];
}

export async function createStage(_code: string, stage: CreateWorkStage): Promise<WorkStage[]> {
  await pause(260);
  const список = этапыR99();
  if (список.some((existing) => existing.name === stage.name)) {
    throw new Error(`Этап «${stage.name}» на объекте уже есть.`);
  }
  проверитьДаты(stage);
  этапы = [...список, {
    id: новыйId(),
    name: stage.name,
    order: список.length,
    startsOn: stage.startsOn,
    endsOn: stage.endsOn,
    progress: stage.progress,
    // Раздел и бригада в демонстрации не назначаются: приёмка в ней ведётся
    // по слепку, а не по связям.
    sectionId: null,
    brigade: null,
  }];
  return этапыR99();
}

export async function updateStage(
  _code: string,
  id: string,
  stage: UpdateWorkStage,
): Promise<WorkStage[]> {
  await pause(220);
  const список = этапыR99();
  const прежний = список.find((existing) => existing.id === id);
  if (прежний === undefined) throw new Error("Этап не найден на этом объекте.");
  const next = {
    ...прежний,
    ...(stage.name === undefined ? {} : { name: stage.name }),
    ...(stage.startsOn === undefined ? {} : { startsOn: stage.startsOn }),
    ...(stage.endsOn === undefined ? {} : { endsOn: stage.endsOn }),
    ...(stage.progress === undefined ? {} : { progress: stage.progress }),
  };
  проверитьДаты(next);
  этапы = список.map((existing) => (existing.id === id ? next : existing));
  return этапыR99();
}

export async function deleteStage(_code: string, id: string): Promise<WorkStage[]> {
  await pause(220);
  этапы = этапыR99().filter((stage) => stage.id !== id).map((stage, index) => ({ ...stage, order: index }));
  return этапыR99();
}

export async function reorderStages(_code: string, ids: string[]): Promise<WorkStage[]> {
  await pause(200);
  const список = этапыR99();
  if (ids.length !== список.length || new Set(ids).size !== ids.length) {
    throw new Error("Порядок этапов задаётся полным списком этапов объекта, без повторов.");
  }
  этапы = ids.map((id, index) => {
    const stage = список.find((existing) => existing.id === id);
    if (stage === undefined) throw new Error("Порядок этапов задаётся полным списком этапов объекта, без повторов.");
    return { ...stage, order: index };
  });
  return этапыR99();
}

/* --- обмерный план ------------------------------------------------------ */

export async function fetchMeasure(code: string): Promise<MeasureView> {
  await pause(220);
  if (code !== "R-99") return { rooms: [], totals: measureView().totals, plan: null };
  if (measureRooms.length === 0 && measurePlan === null) {
    measureRooms = data.measure.rooms;
    measurePlan = data.measure.plan;
  }
  return measureView();
}

/** Правка обмера в демонстрации: сервера нет, но кнопка обязана работать. */
export async function createRoom(_code: string, room: CreateMeasureRoom): Promise<MeasureView> {
  await pause(260);
  if (measureRooms.some((existing) => existing.name === room.name)) {
    throw new Error(`Помещение «${room.name}» на объекте уже есть.`);
  }
  measureRooms = [...measureRooms, measured({
    id: `demo-${String(measureRooms.length + 1)}`,
    name: room.name,
    order: measureRooms.length + 1,
    floorArea: room.floorArea,
    floorPerimeter: room.floorPerimeter,
    ceilingPerimeter: room.ceilingPerimeter,
    height: room.height,
    wallArea: "0",
    volume: "0",
    openings: room.openings ?? [],
  })];
  return measureView();
}

export async function updateRoom(
  _code: string,
  id: string,
  room: UpdateMeasureRoom,
): Promise<MeasureView> {
  await pause(260);
  // Спред объединил бы необязательные поля запроса с обязательными полями
  // помещения и подставил undefined там, где правки не было.
  const patch = Object.fromEntries(
    Object.entries(room).filter(([, value]) => value !== undefined),
  ) as Partial<MeasureRoom>;
  measureRooms = measureRooms.map((existing) =>
    existing.id === id ? measured({ ...existing, ...patch }) : existing,
  );
  return measureView();
}

export async function deleteRoom(_code: string, id: string): Promise<MeasureView> {
  await pause(220);
  measureRooms = measureRooms.filter((room) => room.id !== id);
  return measureView();
}

export async function uploadPlan(_code: string, file: File): Promise<MeasureView> {
  await pause(400);
  measurePlan = {
    fileName: file.name,
    contentType: file.type,
    byteSize: file.size,
    uploadedAt: new Date().toISOString(),
    uploadedBy: data["me-owner"].name,
  };
  return measureView();
}

export async function deletePlan(code: string): Promise<MeasureView> {
  await pause(220);
  if (code === "R-99") measurePlan = null;
  return measureView();
}

/**
 * Адрес изображения плана. В демонстрации сервера нет и отдавать нечего:
 * возвращается пустая строка, а экран показывает состояние «плана нет».
 */
export const planUrl = (): string => "";

/* --- транши ---------------------------------------------------------------
   Состояние живёт в памяти вкладки, как и приёмка: демонстрация без сервера
   обязана показывать последствия действия, а не отказывать в нём. Величины
   выводятся теми же функциями домена, что на сервере — второй свод правил
   разошёлся бы с первым, и демонстрация врала бы про арифметику. */

let транши: TrancheView | null = null;

const траншиR99 = (): TrancheView => {
  if (транши === null) {
    транши = structuredClone(data.tranches);
    /* После клонирования `current` — отдельный объект, а не ссылка на строку
       списка: сервер отдаёт его копией. Правка выработки в нём не дошла бы
       до списка, и полоса разошлась бы с таблицей. */
    транши.current = транши.tranches.find((строка) => строка.status === "OPEN") ?? null;
  }
  return транши;
};

/** Величины транша пересчитываются целиком: выработка хранится, остальное выводится. */
function пересчитатьТранш(транш: TrancheView["tranches"][number], share: number): void {
  const выработка = kopecks(транш.produced);
  const доля = basisPoints(share);
  транш.client = clientAmount(выработка, доля).toString();
  транш.remainder = trancheRemainder(kopecks(транш.amount), выработка, доля).toString();
  транш.fill = Number(trancheFill(kopecks(транш.amount), выработка, доля));
}

export async function fetchTranches(code: string): Promise<TrancheView> {
  await pause(120);
  if (code !== "R-99") {
    return { supervisionShare: 1200, tranches: [], current: null,
      outside: { batches: 0, produced: "0", client: "0" } };
  }
  return траншиR99();
}

export async function createTranche(_code: string, input: CreateTranche): Promise<TrancheView> {
  await pause(240);
  const вид = траншиR99();
  const prepayment = input.prepayment ?? false;
  const fault = trancheFault({
    amount: kopecks(input.amount),
    prepayment,
    openNumber: вид.current?.number ?? null,
    hasPrepayment: вид.tranches.some((транш) => транш.number === 0),
  });
  if (fault !== null) throw new Error(fault);

  const number = prepayment
    ? 0
    : nextTrancheNumber(вид.tranches.map((транш) => транш.number));
  const now = new Date().toISOString();
  const транш = {
    id: новыйId(),
    number,
    amount: input.amount,
    status: prepayment ? "PAID" as const : "OPEN" as const,
    openedAt: now,
    closedAt: null,
    paidAt: prepayment ? now : null,
    comment: input.comment ?? null,
    produced: "0",
    client: "0",
    remainder: input.amount,
    fill: 0,
  };
  пересчитатьТранш(транш, вид.supervisionShare);
  вид.tranches = [...вид.tranches, транш].sort((слева, справа) => слева.number - справа.number);
  вид.current = вид.tranches.find((строка) => строка.status === "OPEN") ?? null;
  return вид;
}

export async function closeTranche(
  _code: string, id: string, input: CloseTranche,
): Promise<TrancheView> {
  await pause(200);
  const вид = траншиR99();
  const транш = вид.tranches.find((строка) => строка.id === id);
  if (транш === undefined) throw new Error("Транш не найден у этого объекта.");
  if (транш.status !== "OPEN") {
    throw new Error(`Транш № ${String(транш.number)} уже закрыт. Закрыть его второй раз нельзя.`);
  }
  транш.status = "CLOSED";
  транш.closedAt = new Date().toISOString();
  if (input.comment !== undefined) транш.comment = input.comment;
  вид.current = вид.tranches.find((строка) => строка.status === "OPEN") ?? null;
  return вид;
}

export async function payTranche(_code: string, id: string): Promise<TrancheView> {
  await pause(200);
  const вид = траншиR99();
  const транш = вид.tranches.find((строка) => строка.id === id);
  if (транш === undefined) throw new Error("Транш не найден у этого объекта.");
  if (транш.status === "OPEN") {
    throw new Error(
      `Транш № ${String(транш.number)} ещё открыт. Закройте его, прежде чем отмечать оплату.`,
    );
  }
  if (транш.status === "PAID") {
    throw new Error(`Транш № ${String(транш.number)} уже отмечен оплаченным.`);
  }
  транш.status = "PAID";
  транш.paidAt = new Date().toISOString();
  return вид;
}
