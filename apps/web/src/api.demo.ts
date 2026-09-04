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
  Role, SmsCodeIssued, Unit, UpdateMeasureRoom, WorkerRow,
} from "@priyomka/contracts";
import { measureTotals, milliunits, roomVolume, wallArea } from "@priyomka/domain";
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

let role: Role = "OWNER";
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

export const demoRole = (): Role => role;
export const setDemoRole = (next: Role): void => {
  role = next;
  signedIn = true;
};
export const demoSignIn = (): void => {
  signedIn = true;
};

const pause = (ms = 180): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchCurrentUser(): Promise<CurrentUser> {
  await pause(60);
  if (!signedIn) throw new Error("Войдите по ссылке, отправленной на почту.");
  return role === "OWNER" ? data["me-owner"] : data["me-foreman"];
}

export async function fetchProjects(): Promise<ProjectSummary[]> {
  await pause(60);
  const rows = role === "OWNER" ? data["projects-owner"] : data["projects-foreman"];
  return rows.map(withChangedStatus);
}

const withChangedStatus = (project: ProjectSummary): ProjectSummary => {
  const status = changedStatus.get(project.code);
  return status === undefined ? project : { ...project, status };
};

export async function fetchDashboard(): Promise<Dashboard> {
  await pause(120);
  return role === "OWNER" ? data["summary-owner"] : data["summary-foreman"];
}

export async function fetchClients(): Promise<ClientRow[]> {
  await pause(80);
  return role === "OWNER" ? data["clients-owner"] : data["clients-foreman"];
}

export async function fetchWorkers(): Promise<WorkerRow[]> {
  await pause(80);
  return data.workers;
}

export async function fetchEvents(code: string): Promise<ProjectEvent[]> {
  await pause(80);
  if (code !== "R-99") return [];
  return role === "OWNER" ? data["events-owner"] : data["events-foreman"];
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
  if (role !== "OWNER") throw new Error("Статус объекта меняет руководитель.");
  const rows = data["projects-owner"];
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
  return role === "OWNER" ? data["estimate-owner"] : data["estimate-foreman"];
}

export async function fetchImports(code: string): Promise<ImportRecord[]> {
  await pause(120);
  return code === "R-99" ? data.imports : [];
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
    uploadedBy: data[role === "OWNER" ? "me-owner" : "me-foreman"].name,
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
