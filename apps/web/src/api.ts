import type {
  CurrentUser, DocumentTemplate, IssuedDocument, ProjectSummary, SaveTemplate, TemplateRow,
} from "@priyomka/contracts";
import {
  clientRowSchema, currentUserSchema, dashboardSchema, estimateViewSchema, eventSchema,
  importPreviewResponseSchema, importRecordSchema, importResultSchema, leadBoardSchema,
  photoReportSchema, foremenSchema, nextProjectCodeSchema, expenseViewSchema,
  actListSchema, actViewSchema,
  documentTemplateSchema, issuedDocumentSchema, templateRowSchema,
  leadCardSchema, measureViewSchema, repairTypeSchema,
  organizationSchema, projectSummarySchema, smsCodeIssuedSchema, unitSchema, workerRowSchema,
  workStageSchema, acceptanceViewSchema, trancheViewSchema, accountingViewSchema,
  type AcceptanceView, type CreateAcceptance, type Reversal,
  type CloseTranche, type CreateTranche, type TrancheView, type AccountingView,
  type ClientRow, type CreateClient, type CreateMeasureRoom, type CreateProject,
  type CreateWorker, type CreateWorkStage, type Dashboard, type DisplacedByImport,
  type EstimateView, type ImportRecord,
  type ActRow, type ActView, type CreateExpense, type ExpenseView,
  type ImportReport, type ImportResult, type MeasureSetKind, type MeasureView, type Organization,
  type ProjectEvent,
  type SmsCodeIssued, type Unit, type UpdateMeasureRoom, type UpdateOrganization,
  type UpdateEstimateItem, type UpdateSupervision, type UpdateProject, type Foreman,
  type UpdateWorkStage, type WorkerRow, type WorkStage,
  type ConvertLead, type CreateLead, type CreateLeadTask, type CreateRepairType,
  type LeadBoard, type LeadCard, type LoseLead, type PhotoReport, type RepairType,
  type UpdateLead, type UpdateLeadTask, type UpdateRepairType,
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

/**
 * Карточка одного объекта. Нужна там, где действие вкладки меняет величину
 * сводки: подтверждённый чек прибавляет потраченное, а сводка приходит
 * снаружи и сама себя не обновляет — «Обзор» показывал бы прежнее число
 * рядом с новым итогом вкладки.
 */
export const fetchProject = (code: string): Promise<ProjectSummary> =>
  request(`/projects/${code}`, projectSummarySchema);

export const fetchProjects = (): Promise<ProjectSummary[]> =>
  request("/projects", z.array(projectSummarySchema));

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Тот же конверт, но правкой: отличается только глаголом. */
const patch = (body: unknown): RequestInit => ({ ...json(body), method: "PATCH" });

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
): Promise<{ fileName: string; report: ImportReport; displaced: DisplacedByImport | null }> {
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

/**
 * Набор обмера в запросе.
 *
 * Начальный набор не приписывается: у объекта без перепланировки адрес
 * остаётся прежним, и прежние ссылки продолжают работать. Сервер понимает
 * отсутствие набора тем же значением.
 */
const наборВЗапросе = (set: MeasureSetKind): string =>
  set === "INITIAL" ? "" : `?set=${set}`;

export const fetchMeasure = (code: string, set: MeasureSetKind = "INITIAL"): Promise<MeasureView> =>
  request(`/projects/${code}/measure${наборВЗапросе(set)}`, measureViewSchema);

export const createRoom = (
  code: string,
  set: MeasureSetKind,
  room: CreateMeasureRoom,
): Promise<MeasureView> =>
  request(`/projects/${code}/measure/rooms${наборВЗапросе(set)}`, measureViewSchema, json(room));

/* Правка и удаление набора не называют: помещение принадлежит набору
   само, и сервер берёт набор у него. Второе место для той же величины
   разошлось бы с первым. */
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

export function uploadPlan(code: string, set: MeasureSetKind, file: File): Promise<MeasureView> {
  const form = new FormData();
  form.append("file", file);
  return request(`/projects/${code}/measure/plan${наборВЗапросе(set)}`, measureViewSchema, {
    method: "PUT", body: form,
  });
}

export const deletePlan = (code: string, set: MeasureSetKind): Promise<MeasureView> =>
  request(`/projects/${code}/measure/plan${наборВЗапросе(set)}`, measureViewSchema, { method: "DELETE" });

/* --- приёмка выполненных работ --------------------------------------------
   Пакет уходит одним запросом вместе со снимком: фотография обязательна, и
   раздельная отправка допускала бы пакет без свидетельства. */

export const fetchAcceptance = (code: string): Promise<AcceptanceView> =>
  request(`/projects/${code}/acceptance`, acceptanceViewSchema);

export function createAcceptance(
  code: string,
  batch: CreateAcceptance,
  photo: File,
): Promise<AcceptanceView> {
  const form = new FormData();
  form.append("batch", JSON.stringify(batch));
  form.append("file", photo);
  return request(`/projects/${code}/acceptance`, acceptanceViewSchema, { method: "POST", body: form });
}

/* --- чеки на материалы ---------------------------------------------------
   Чек уходит одним запросом вместе со снимком: снимок обязателен, и
   раздельная отправка допускала бы расход без свидетельства. Тот же приём,
   что у пакета приёмки. */

export const fetchExpenses = (code: string): Promise<ExpenseView> =>
  request(`/projects/${code}/expenses`, expenseViewSchema);

export function createExpense(
  code: string,
  expense: CreateExpense,
  photo: File,
): Promise<ExpenseView> {
  const form = new FormData();
  form.append("expense", JSON.stringify(expense));
  form.append("file", photo);
  return request(`/projects/${code}/expenses`, expenseViewSchema, { method: "POST", body: form });
}

export const decideExpense = (
  code: string,
  id: string,
  решение: "confirm" | "reject",
): Promise<ExpenseView> =>
  request(`/projects/${code}/expenses/${id}/${решение}`, expenseViewSchema, { method: "POST" });

export const deleteExpense = (code: string, id: string): Promise<ExpenseView> =>
  request(`/projects/${code}/expenses/${id}`, expenseViewSchema, { method: "DELETE" });

/** Адрес снимка чека. Выводится из опознавателя, а не приходит контрактом. */
export const expensePhotoUrl = (code: string, id: string): string =>
  `${BASE}/projects/${code}/expenses/${id}/file`;

/* --- акты выполненных работ ----------------------------------------------
   Акт есть представление закрытого транша; отдельной записи у него нет.
   Вид по умолчанию клиентский: он уходит заказчику, и ошибиться в сторону
   показа внутренних величин должно быть труднее, чем наоборот. */

export const fetchActs = (code: string): Promise<ActRow[]> =>
  request(`/projects/${code}/acts`, actListSchema);

export const fetchAct = (
  code: string,
  trancheId: string,
  audience: "client" | "internal" = "client",
): Promise<ActView> =>
  request(
    `/projects/${code}/acts/${trancheId}${audience === "internal" ? "?view=internal" : ""}`,
    actViewSchema,
  );

export const signAct = (code: string, trancheId: string, signedAt: string): Promise<ActRow[]> =>
  request(`/projects/${code}/acts/${trancheId}/signature`, actListSchema, json({ signedAt }));

/* --- шаблоны документов организации ----------------------------------------- */

/* Схема массива собирается здесь, а не в контрактах: сервер отдаёт перечень
   массивом, и заводить ради этого второе имя в общем словаре незачем. */
const templateListSchema = z.array(templateRowSchema);

export const fetchTemplates = (): Promise<TemplateRow[]> =>
  request("/templates", templateListSchema);

export const fetchTemplate = (id: string): Promise<DocumentTemplate> =>
  request(`/templates/${id}`, documentTemplateSchema);

export const createTemplate = (input: SaveTemplate): Promise<TemplateRow[]> =>
  request("/templates", templateListSchema, json(input));

export const updateTemplate = (id: string, input: SaveTemplate): Promise<TemplateRow[]> =>
  request(`/templates/${id}`, templateListSchema, { ...json(input), method: "PUT" });

export const deleteTemplate = (id: string): Promise<TemplateRow[]> =>
  request(`/templates/${id}`, templateListSchema, { method: "DELETE" });

/** Выпуск документа: метки заменяются значениями на сервере, где лежат данные. */
export const issueDocument = (id: string, projectCode: string): Promise<IssuedDocument> =>
  request(`/templates/${id}/issue`, issuedDocumentSchema, json({ projectCode }));

export const reverseAcceptance = (
  code: string,
  id: string,
  input: Reversal,
): Promise<AcceptanceView> =>
  request(`/projects/${code}/acceptance/${id}/reversal`, acceptanceViewSchema, json(input));

/**
 * Адрес снимка пакета. Не поле контракта по той же причине, что адрес плана
 * объекта: демонстрационная сборка работает без сервера и подставляет сюда
 * встроенное изображение.
 */
/** Фотоотчёт объекта: те же снимки приёмки, без отбора по редакции сметы. */
export const fetchReport = (code: string): Promise<PhotoReport> =>
  request(`/projects/${code}/acceptance/report`, photoReportSchema);

export const acceptancePhotoUrl = (code: string, id: string): string =>
  `${BASE}/projects/${code}/acceptance/photo/${id}`;

/* --- график производства работ ------------------------------------------
   Каждый пишущий вызов возвращает список этапов целиком: перестановка
   меняет половину строк, и собирать новый порядок на экране значило бы
   завести вторую копию правил сортировки. */

const stagesSchema = z.array(workStageSchema);

export const fetchStages = (code: string): Promise<WorkStage[]> =>
  request(`/projects/${code}/stages`, stagesSchema);

export const createStage = (code: string, stage: CreateWorkStage): Promise<WorkStage[]> =>
  request(`/projects/${code}/stages`, stagesSchema, json(stage));

/** Завести график из разделов сметы: заведённые этапы не трогаются. */
export const planStages = (code: string, from: string, to: string): Promise<WorkStage[]> =>
  request(`/projects/${code}/stages/plan`, stagesSchema, json({ from, to }));

export const updateStage = (
  code: string,
  id: string,
  stage: UpdateWorkStage,
): Promise<WorkStage[]> =>
  request(`/projects/${code}/stages/${id}`, stagesSchema, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(stage),
  });

export const deleteStage = (code: string, id: string): Promise<WorkStage[]> =>
  request(`/projects/${code}/stages/${id}`, stagesSchema, { method: "DELETE" });

export const reorderStages = (code: string, ids: string[]): Promise<WorkStage[]> =>
  request(`/projects/${code}/stages/order`, stagesSchema, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });

/**
 * Адрес изображения плана. Не поле контракта: демонстрационная сборка
 * работает без сервера и подставляет сюда встроенное изображение, а
 * контракт не должен знать о её существовании.
 */
export const planUrl = (code: string, set: MeasureSetKind = "INITIAL"): string =>
  `${BASE}/projects/${code}/measure/plan/file${наборВЗапросе(set)}`;

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

/**
 * Правка полей объекта на месте. Ответ — обновлённая карточка целиком, а не
 * признак успеха: правка адреса меняет и штамп, и крошку, и подпись плитки,
 * и собирать новое состояние на клиенте значило бы завести вторую копию
 * правил.
 */
export const updateProject = (code: string, patch: UpdateProject): Promise<ProjectSummary> =>
  request(`/projects/${code}`, projectSummarySchema, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });

/** Прорабы организации: список для назначения на объект. */
export const fetchForemen = (): Promise<Foreman[]> =>
  request("/foremen", foremenSchema);

/**
 * Предложенный номер для нового объекта; `null` — предложить нечего.
 *
 * Запрашивается при открытии формы, а не держится в состоянии экрана: номер
 * устаревает, как только объект заведёт кто-то другой, и подставленный
 * заранее был бы занят к моменту нажатия.
 */
export const fetchNextProjectCode = (): Promise<string | null> =>
  request("/projects/next-code", nextProjectCodeSchema).then((ответ) => ответ.code);

/* --- правка сметы --------------------------------------------------------
   Оба вызова возвращают вид сметы целиком: правка одной позиции меняет
   подытог её раздела, итог работ, надбавку и итог для клиента, и собирать
   новое состояние на клиенте значило бы завести вторую копию правил. */

export const updateEstimateItem = (
  code: string,
  id: string,
  input: UpdateEstimateItem,
): Promise<EstimateView> =>
  request(`/projects/${code}/estimate/items/${id}`, estimateViewSchema, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

export const updateSupervision = (
  code: string,
  input: UpdateSupervision,
): Promise<EstimateView> =>
  request(`/projects/${code}/estimate/supervision`, estimateViewSchema, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

/* --- транши ---------------------------------------------------------------
   Закрытие и оплата — отдельные вызовы, а не правка статуса: это разные
   события, и общий вызов допускал бы переход «открыт → оплачен», которого
   не бывает. Каждый возвращает вид целиком: закрытие меняет и величины
   транша, и признак «открытого нет», от которого зависит вся вкладка. */

export const fetchTranches = (code: string): Promise<TrancheView> =>
  request(`/projects/${code}/tranches`, trancheViewSchema);

export const createTranche = (code: string, input: CreateTranche): Promise<TrancheView> =>
  request(`/projects/${code}/tranches`, trancheViewSchema, json(input));

export const closeTranche = (code: string, id: string, input: CloseTranche): Promise<TrancheView> =>
  request(`/projects/${code}/tranches/${id}/closure`, trancheViewSchema, json(input));

export const payTranche = (code: string, id: string): Promise<TrancheView> =>
  request(`/projects/${code}/tranches/${id}/payment`, trancheViewSchema, json({}));

/* --- заявки ---------------------------------------------------------------
   Каждый пишущий вызов возвращает доску целиком: смена стадии переносит
   карточку между колонками и меняет счётчики, и собирать это на экране
   значило бы завести вторую копию правил воронки.

   Превращение, отказ и правка задач объявлены отдельными вызовами, а не
   правкой полей: это разные события с разными отказами. */

/** Бухгалтерия: деньги заказчиков по всему портфелю. Только руководителю. */
export const fetchAccounting = (): Promise<AccountingView> =>
  request("/accounting", accountingViewSchema);

export const fetchLeads = (open: boolean): Promise<LeadBoard> =>
  request(`/leads?open=${String(open)}`, leadBoardSchema);

export const fetchLeadEvents = (id: string): Promise<ProjectEvent[]> =>
  request(`/leads/${id}/events`, z.array(eventSchema));

export const createLead = (input: CreateLead): Promise<LeadCard> =>
  request("/leads", leadCardSchema, json(input));

export const updateLead = (id: string, input: UpdateLead): Promise<LeadCard> =>
  request(`/leads/${id}`, leadCardSchema, patch(input));

export const convertLead = (id: string, input: ConvertLead): Promise<LeadCard> =>
  request(`/leads/${id}/conversion`, leadCardSchema, json(input));

export const loseLead = (id: string, input: LoseLead): Promise<LeadCard> =>
  request(`/leads/${id}/loss`, leadCardSchema, json(input));

export const addLeadTask = (id: string, input: CreateLeadTask): Promise<LeadCard> =>
  request(`/leads/${id}/tasks`, leadCardSchema, json(input));

export const setLeadTask = (
  id: string,
  taskId: string,
  input: UpdateLeadTask,
): Promise<LeadCard> =>
  request(`/leads/${id}/tasks/${taskId}`, leadCardSchema, patch(input));

/* Справочник тарифов. Тариф — денежная величина, и справочник целиком
   принадлежит руководителю. */

export const fetchRepairTypes = (): Promise<RepairType[]> =>
  request("/repair-types", z.array(repairTypeSchema));

export const createRepairType = (input: CreateRepairType): Promise<RepairType[]> =>
  request("/repair-types", z.array(repairTypeSchema), json(input));

export const updateRepairType = (id: string, input: UpdateRepairType): Promise<RepairType[]> =>
  request(`/repair-types/${id}`, z.array(repairTypeSchema), patch(input));
