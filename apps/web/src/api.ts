import type { CurrentUser, ProjectSummary } from "@priyomka/contracts";
import {
  clientRowSchema, currentUserSchema, dashboardSchema, estimateViewSchema, eventSchema,
  importPreviewResponseSchema, importRecordSchema, importResultSchema, measureViewSchema,
  organizationSchema, projectSummarySchema, smsCodeIssuedSchema, unitSchema, workerRowSchema,
  type ClientRow, type CreateClient, type CreateMeasureRoom, type CreateProject,
  type CreateWorker, type Dashboard, type EstimateView, type ImportRecord,
  type ImportReport, type ImportResult, type MeasureView, type Organization, type ProjectEvent,
  type SmsCodeIssued, type Unit, type UpdateMeasureRoom, type UpdateOrganization, type WorkerRow,
} from "@priyomka/contracts";
import { z } from "zod";

/**
 * Клиент API. Ответы проверяются теми же схемами, что и запросы на сервере:
 * если сервер начнёт отдавать не то, ошибка возникнет здесь, а не в вёрстке.
 */
const BASE = "/api";

/**
 * Отказ сети и неожиданный ответ сервера — разные события, и человеку нужно
 * знать, какое случилось: в первом случае данные не ушли и попытку надо
 * повторить, во втором повторять бессмысленно. Текст браузера «Failed to
 * fetch» не говорит ни того, ни другого и вдобавок на английском (Д-02).
 */
export class OfflineError extends Error {
  constructor() {
    super("Нет связи с сервером. Данные не отправлены — повторите, когда появится сеть.");
    this.name = "OfflineError";
  }
}

/**
 * Текст отказа для экрана.
 *
 * Обещание отклоняется чем угодно, а не только Error: типизировать параметр
 * `catch` как Error — обещание компилятору, которое ничем не обеспечено.
 * Здесь оно проверяется один раз, а экраны получают строку.
 */
export const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "Неизвестная ошибка. Повторите действие.";

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { credentials: "include", ...init });
  } catch {
    throw new OfflineError();
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Запрос ${path} завершился кодом ${response.status}`);
  }
  const payload: unknown = await response.json();
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    // Текст ZodError адресован разработчику; пользователю он ничего не даёт.
    throw new Error("Сервер вернул неожиданный ответ. Обновите страницу; если повторится — сообщите в поддержку.");
  }
  return parsed.data;
}

export const fetchCurrentUser = (): Promise<CurrentUser> =>
  request("/auth/me", currentUserSchema);

export const fetchProjects = (): Promise<ProjectSummary[]> =>
  request("/projects", z.array(projectSummarySchema));

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/**
 * Запрос кода подтверждения. Ответ одинаков для существующего и
 * несуществующего номера; на стенде в нём приходит сам код.
 */
export const requestSmsCode = (phone: string): Promise<SmsCodeIssued> =>
  request("/auth/phone/request", smsCodeIssuedSchema, json({ phone }));

/** Обмен кода на сессию. Кука ставится сервером. */
export const confirmSmsCode = (phone: string, code: string): Promise<{ ok: true }> =>
  request("/auth/phone/confirm", z.object({ ok: z.literal(true) }), json({ phone, code }));

export const fetchOrganization = (): Promise<Organization> =>
  request("/organization", organizationSchema);

export const saveOrganization = (patch: UpdateOrganization): Promise<Organization> =>
  request("/organization", organizationSchema, { ...json(patch), method: "PATCH" });

/** Справочник единиц измерения организации с написаниями импорта. */
export const fetchUnits = (): Promise<Unit[]> => request("/units", z.array(unitSchema));

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

/* --- обмерный план ------------------------------------------------------ */

export const fetchMeasure = (code: string): Promise<MeasureView> =>
  request(`/projects/${code}/measure`, measureViewSchema);

export const createRoom = (code: string, room: CreateMeasureRoom): Promise<MeasureView> =>
  request(`/projects/${code}/measure/rooms`, measureViewSchema, json(room));

export const updateRoom = (
  code: string,
  id: string,
  room: UpdateMeasureRoom,
): Promise<MeasureView> =>
  request(`/projects/${code}/measure/rooms/${id}`, measureViewSchema, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(room),
  });

export const deleteRoom = (code: string, id: string): Promise<MeasureView> =>
  request(`/projects/${code}/measure/rooms/${id}`, measureViewSchema, { method: "DELETE" });

export function uploadPlan(code: string, file: File): Promise<MeasureView> {
  const form = new FormData();
  form.append("file", file);
  return request(`/projects/${code}/measure/plan`, measureViewSchema, { method: "PUT", body: form });
}

export const deletePlan = (code: string): Promise<MeasureView> =>
  request(`/projects/${code}/measure/plan`, measureViewSchema, { method: "DELETE" });

/**
 * Адрес изображения плана. Не поле контракта: демонстрационная сборка
 * работает без сервера и подставляет сюда встроенное изображение, а
 * контракт не должен знать о её существовании.
 */
export const planUrl = (code: string): string => `${BASE}/projects/${code}/measure/plan/file`;

export const fetchImports = (code: string): Promise<ImportRecord[]> =>
  request(`/projects/${code}/estimate/imports`, z.array(importRecordSchema));

export const fetchDashboard = (): Promise<Dashboard> => request("/summary", dashboardSchema);

export const fetchClients = (): Promise<ClientRow[]> =>
  request("/clients", z.array(clientRowSchema));

export const fetchWorkers = (): Promise<WorkerRow[]> =>
  request("/workers", z.array(workerRowSchema));

export const fetchEvents = (code: string): Promise<ProjectEvent[]> =>
  request(`/projects/${code}/events`, z.array(eventSchema));

/** Тело запроса на заведение записи. Одна форма на три маршрута. */
const заведение = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Ответ — заведённая карточка, а не признак успеха: экран показывает её сразу. */
export const createProject = (input: CreateProject): Promise<ProjectSummary> =>
  request("/projects", projectSummarySchema, заведение(input));

/** Ответ — весь справочник: список на экране обновляется целиком, без второго запроса. */
export const createClient = (input: CreateClient): Promise<ClientRow[]> =>
  request("/clients", z.array(clientRowSchema), заведение(input));

export const createWorker = (input: CreateWorker): Promise<WorkerRow[]> =>
  request("/workers", z.array(workerRowSchema), заведение(input));

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
