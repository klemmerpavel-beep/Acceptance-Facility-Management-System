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
} from "@priyomka/contracts";
import {
  measureTotals, milliunits, projectRange, roomVolume, stageDateFault, wallArea,
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
