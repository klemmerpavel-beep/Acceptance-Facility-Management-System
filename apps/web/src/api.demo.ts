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
  ClientRow, CurrentUser, Dashboard, EstimateView, ImportRecord, ImportReport, ImportResult,
  Organization, ProjectEvent, ProjectStatus, ProjectSummary, Role, SmsCodeIssued, Unit, WorkerRow,
} from "@priyomka/contracts";
import snapshot from "./demo/snapshot.json" with { type: "json" };

type Snapshot = {
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
};

const data = snapshot as unknown as Snapshot;

let role: Role = "OWNER";
let signedIn = true;

/**
 * Правки, сделанные в демонстрации, живут до перезагрузки страницы: сервера
 * нет, но и притворяться, будто смена статуса не сработала, неправильно —
 * иначе кнопка выглядела бы сломанной.
 */
const changedStatus = new Map<string, ProjectStatus>();

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
