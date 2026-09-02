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
import type { CurrentUser, ImportReport, ImportResult, ProjectSummary, Role } from "@priyomka/contracts";
import snapshot from "./demo/snapshot.json" with { type: "json" };

type Snapshot = {
  "me-owner": CurrentUser;
  "me-foreman": CurrentUser;
  "projects-owner": ProjectSummary[];
  "projects-foreman": ProjectSummary[];
  units: string[];
  preview: { fileName: string; report: ImportReport };
  import: ImportResult;
};

const data = snapshot as unknown as Snapshot;

let role: Role = "OWNER";
let signedIn = true;

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
  return role === "OWNER" ? data["projects-owner"] : data["projects-foreman"];
}

export async function fetchCanonicalUnits(): Promise<string[]> {
  await pause(40);
  return data.units;
}

export async function requestMagicLink(): Promise<{ sent: true; token?: string | undefined }> {
  await pause();
  return { sent: true, token: "demo" };
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
