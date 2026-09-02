import type { CurrentUser, ProjectSummary } from "@priyomka/contracts";
import {
  clientRowSchema, currentUserSchema, dashboardSchema, estimateViewSchema, eventSchema,
  importPreviewResponseSchema, importRecordSchema, importResultSchema, projectSummarySchema,
  workerRowSchema,
  type ClientRow, type Dashboard, type EstimateView, type ImportRecord, type ImportReport,
  type ImportResult, type ProjectEvent, type WorkerRow,
} from "@priyomka/contracts";
import { z } from "zod";

/**
 * Клиент API. Ответы проверяются теми же схемами, что и запросы на сервере:
 * если сервер начнёт отдавать не то, ошибка возникнет здесь, а не в вёрстке.
 */
const BASE = "/api";

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { credentials: "include", ...init });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Запрос ${path} завершился кодом ${response.status}`);
  }
  return schema.parse(await response.json());
}

export const fetchCurrentUser = (): Promise<CurrentUser> =>
  request("/auth/me", currentUserSchema);

export const fetchProjects = (): Promise<ProjectSummary[]> =>
  request("/projects", z.array(projectSummarySchema));

// exactOptionalPropertyTypes: отсутствующий токен и токен со значением
// undefined — разные вещи, и тип это отражает.
export const requestMagicLink = (
  email: string,
): Promise<{ sent: true; token?: string | undefined }> =>
  request(
    "/auth/magic-link",
    z.object({ sent: z.literal(true), token: z.string().optional() }),
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) },
  );

export const logout = (): Promise<{ ok: true }> =>
  request("/auth/logout", z.object({ ok: z.literal(true) }), { method: "POST" });


/** Разбор без записи: отчёт и написания единиц, ждущие решения оператора. */
export async function previewEstimate(
  code: string,
  file: File,
): Promise<{ fileName: string; report: ImportReport }> {
  const form = new FormData();
  form.append("file", file);
  return request(`/projects/${code}/estimate/preview`, importPreviewResponseSchema, {
    method: "POST",
    body: form,
  });
}

/** Импорт с записью новой редакции сметы. */
export async function importEstimate(
  code: string,
  file: File,
  overrides: Record<string, string>,
): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("units", JSON.stringify(overrides));
  return request(`/projects/${code}/estimate/import`, importResultSchema, {
    method: "POST",
    body: form,
  });
}

export const fetchCanonicalUnits = (code: string): Promise<string[]> =>
  request(`/projects/${code}/estimate/units`, z.array(z.string()));

export const fetchEstimate = (code: string): Promise<EstimateView> =>
  request(`/projects/${code}/estimate`, estimateViewSchema);

export const fetchImports = (code: string): Promise<ImportRecord[]> =>
  request(`/projects/${code}/estimate/imports`, z.array(importRecordSchema));

export const fetchDashboard = (): Promise<Dashboard> => request("/summary", dashboardSchema);

export const fetchClients = (): Promise<ClientRow[]> =>
  request("/clients", z.array(clientRowSchema));

export const fetchWorkers = (): Promise<WorkerRow[]> =>
  request("/workers", z.array(workerRowSchema));

export const fetchEvents = (code: string): Promise<ProjectEvent[]> =>
  request(`/projects/${code}/events`, z.array(eventSchema));

/** Смена статуса объекта. Ответ — обновлённая карточка, а не признак успеха. */
export const setProjectStatus = (
  code: string,
  status: ProjectSummary["status"],
): Promise<ProjectSummary> =>
  request(`/projects/${code}/status`, projectSummarySchema, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
