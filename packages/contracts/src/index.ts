/**
 * Контракты API. Одни и те же схемы проверяют тело запроса на сервере и
 * типизируют клиента: расхождение между ними невозможно по построению.
 *
 * Денежные величины пересекают границу HTTP строкой, а не числом: JSON
 * не имеет целых произвольной длины, а `number` для денег запрещён (БП-08).
 */
import { z } from "zod";

/** Целое число копеек в виде строки: "375877835". */
export const kopecksString = z
  .string()
  .regex(/^-?\d+$/, "Копейки передаются целым числом в строке");

/** Тысячные доли единицы измерения в виде строки: "406910" — это 406,91 м². */
export const milliunitsString = z
  .string()
  .regex(/^-?\d+$/, "Количество передаётся в тысячных долях целым числом в строке");

export const roleSchema = z.enum(["OWNER", "FOREMAN", "SUPPLY"]);
export type Role = z.infer<typeof roleSchema>;

export const projectStatusSchema = z.enum([
  "NEW", "IN_PROGRESS", "PAUSED", "WAITING_CLIENT", "DONE", "ARCHIVED",
]);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

/** Код объекта: латинская буква, дефис, цифры. Сквозной идентификатор R-99. */
export const projectCodeSchema = z
  .string()
  .regex(/^[A-Z]-\d{1,4}$/, "Код объекта имеет вид R-99");

export const requestMagicLinkSchema = z.object({
  email: z.string().email("Нужен адрес почты"),
});
export type RequestMagicLink = z.infer<typeof requestMagicLinkSchema>;

export const consumeTokenSchema = z.object({
  token: z.string().min(32, "Ссылка входа повреждена"),
});

/**
 * Вход по номеру телефона. Схема проверяет только форму: правила номера
 * живут в `parsePhone` доменного слоя и применяются на сервере — иначе
 * они разойдутся между клиентом и API уже на второй правке.
 */
export const requestSmsCodeSchema = z.object({
  phone: z.string().min(1, "Введите номер телефона").max(32, "Слишком длинный номер"),
});
export type RequestSmsCode = z.infer<typeof requestSmsCodeSchema>;

export const confirmSmsCodeSchema = z.object({
  phone: z.string().min(1, "Введите номер телефона").max(32, "Слишком длинный номер"),
  code: z.string().regex(/^\d{6}$/, "Код состоит из шести цифр"),
});
export type ConfirmSmsCode = z.infer<typeof confirmSmsCodeSchema>;

/**
 * Ответ на запрос кода одинаков для существующего и несуществующего номера:
 * иначе форма входа становится проверялкой того, кто есть в системе.
 * На стенде код возвращается в теле и показывается на экране; в
 * промышленной среде поле не приходит, а код уходит сообщением.
 */
export const smsCodeIssuedSchema = z.object({
  sent: z.literal(true),
  /** Номер в показном виде: `+7 (900) 000-00-00`. */
  phone: z.string(),
  code: z.string().optional(),
  /** Через сколько секунд можно запросить код заново. */
  retryAfterSeconds: z.number().int().positive(),
});
export type SmsCodeIssued = z.infer<typeof smsCodeIssuedSchema>;

/** Часовой пояс в виде IANA: «Europe/Moscow». */
export const timeZoneSchema = z
  .string()
  .regex(/^[A-Za-z]+\/[A-Za-z_+-]+$/, "Часовой пояс задаётся в виде Europe/Moscow");

export const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  timeZone: timeZoneSchema,
  /** Валюта учёта одна на организацию: суммы в разных валютах не складываются. */
  currency: z.literal("RUB"),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  logoKey: z.string().nullable(),
});
export type Organization = z.infer<typeof organizationSchema>;

/** Правка организации: пустая строка в необязательном поле означает «стереть». */
export const updateOrganizationSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(200).optional(),
  timeZone: timeZoneSchema.optional(),
  phone: z.string().max(32).nullable().optional(),
  // Пустая строка означает «стереть»: форма присылает очищенное поле,
  // а не отсутствие ключа, и это не повод отказывать в правке.
  email: z.union([z.literal(""), z.string().email("Нужен адрес почты")]).nullable().optional(),
});
export type UpdateOrganization = z.infer<typeof updateOrganizationSchema>;

/** Справочник единиц измерения организации. Ведётся на вкладке «Смета». */
export const unitSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /** Сколько написаний исходных файлов сведено к этой форме. */
  aliases: z.array(z.string()),
});
export type Unit = z.infer<typeof unitSchema>;

export const currentUserSchema = z.object({
  id: z.string().uuid(),
  role: roleSchema,
  name: z.string(),
  organization: z.object({ id: z.string().uuid(), name: z.string() }),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

/** Расчётная единица сдельной оплаты: бригада или мастер. */
export const workerKindSchema = z.enum(["BRIGADE", "PERSON"]);
export type WorkerKind = z.infer<typeof workerKindSchema>;

/**
 * Этап работ — строка графика производства работ объекта.
 *
 * Приходит вместе с объектом, а не отдельным запросом: полоса плана на
 * главной рисует все объекты сразу, и второй запрос на этап каждого из них
 * упёрся бы в сотню обращений на один экран.
 */
export const workStageSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  order: z.number().int().nonnegative(),
  startsOn: z.string().date(),
  endsOn: z.string().date(),
  /** Заявленный прогресс в сотых долях процента: 5000 = 50,00 %. */
  progress: z.number().int().min(0).max(10_000),
  /**
   * Раздел сметы, работы которого ведёт этап, и бригада-получатель
   * начисления. Через эту пару приёмка раздела узнаёт, кому начислять:
   * раздел → этап → бригада. Пусто — связи нет, и раздел принять нельзя.
   */
  sectionId: z.string().uuid().nullable(),
  brigade: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
});
export type WorkStage = z.infer<typeof workStageSchema>;

/**
 * Тело запроса на заведение и правку этапа.
 *
 * Соотношение дат и год в диапазоне договора схема не проверяет: ей
 * неизвестны сроки объекта. Это делает сервис через `stageDateFault` из
 * `@priyomka/domain` — тем же кодом, которым экран показывает подсказку до
 * обращения к сети. Два независимых свода правил разошлись бы на третьей
 * правке.
 */
export const createWorkStageSchema = z.object({
  name: z.string().trim().min(1, "Назовите этап").max(60, "Слишком длинное название этапа"),
  startsOn: z.string().date("Начало этапа: дата в формате ГГГГ-ММ-ДД."),
  endsOn: z.string().date("Окончание этапа: дата в формате ГГГГ-ММ-ДД."),
  /** Заявленный прогресс в сотых долях процента. По умолчанию этап не начат. */
  progress: z.number().int().min(0).max(10_000).default(0),
  /** Раздел сметы и бригада — необязательны: график заводится раньше сметы. */
  sectionId: z.string().uuid().nullable().optional(),
  brigadeId: z.string().uuid().nullable().optional(),
});
export type CreateWorkStage = z.infer<typeof createWorkStageSchema>;

export const updateWorkStageSchema = createWorkStageSchema.partial();
export type UpdateWorkStage = z.infer<typeof updateWorkStageSchema>;

/**
 * Перестановка этапов: полный порядок, а не пара «этап и новое место».
 * Частичный порядок оставляет вопрос, что делать с остальными строками, и
 * два одновременных перемещения дают разный результат в зависимости от
 * того, чьё пришло первым.
 */
export const reorderWorkStagesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Порядок этапов пуст."),
});
export type ReorderWorkStages = z.infer<typeof reorderWorkStagesSchema>;

export const projectSummarySchema = z.object({
  id: z.string().uuid(),
  code: projectCodeSchema,
  address: z.string(),
  status: projectStatusSchema,
  /** Дата начала работ. Отличается от даты заведения объекта в системе. */
  startedAt: z.string().date().nullable(),
  deadline: z.string().date().nullable(),
  /**
   * Дата заведения объекта. Нужна затем, что из неё выводится диапазон
   * допустимых дат этапа, когда ни начала работ, ни срока сдачи нет
   * (`projectRange` в домене). Без неё экран считал бы диапазон своим
   * правилом и расходился бы с сервером на объекте без сроков.
   */
  createdAt: z.string().date(),
  keysCount: z.number().int().nonnegative(),
  supervisionShare: z.number().int().nonnegative(),
  client: z.object({
    code: z.string(),
    name: z.string(),
    isCompany: z.boolean(),
    requisites: z.string().nullable(),
  }),
  foreman: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  /** Итог сметы для клиента действующей редакции; пусто — сметы нет. */
  estimateTotal: kopecksString.nullable(),
  estimateVersion: z.number().int().nullable(),
  positions: z.number().int().nonnegative(),
  /**
   * Готовность в сотых долях процента, средневзвешенная по длительности
   * этапов. `null` — этапов нет, готовность не задана.
   *
   * Ноль и «не задано» намеренно различаются. Ноль означает «работа не
   * начата», отсутствие графика — «мы не знаем». Одно число на оба смысла
   * заставляет читателя гадать, а гадать он не станет — он перестанет
   * верить и остальным числам экрана.
   */
  readiness: z.number().int().min(0).max(10_000).nullable(),
  /**
   * Остаток текущего транша. `null` — открытого транша нет.
   *
   * Ноль здесь означал бы «транш выработан ровно до копейки», а это иное
   * утверждение, чем «транша нет»; по тому же правилу, что и `readiness`.
   * Отрицательная величина — перевыработка, законное состояние.
   */
  trancheRemainder: kopecksString.nullable(),
  /** Этапы графика в порядке ведения. Пусто — график не заведён. */
  stages: z.array(workStageSchema),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

/**
 * Заведение объекта. Код проверяется тем же выражением, что и в пути
 * запроса: объект с кодом, которого нельзя открыть ссылкой, — брак.
 */
export const createProjectSchema = z.object({
  code: projectCodeSchema,
  address: z.string().trim().min(3, "Адрес объекта: не короче трёх знаков.").max(200),
  clientId: z.string().uuid("Выберите заказчика из справочника."),
  deadline: z.string().date("Срок сдачи: дата в формате ГГГГ-ММ-ДД.").nullable(),
});
export type CreateProject = z.infer<typeof createProjectSchema>;

export const createClientSchema = z.object({
  code: z.string().trim().min(1, "Код заказчика обязателен.").max(20),
  name: z.string().trim().min(2, "Имя или название заказчика: не короче двух знаков.").max(120),
  isCompany: z.boolean(),
  requisites: z.string().trim().max(400).nullable(),
});
export type CreateClient = z.infer<typeof createClientSchema>;

export const createWorkerSchema = z.object({
  name: z.string().trim().min(2, "Название бригады или имя мастера: не короче двух знаков.").max(120),
  kind: workerKindSchema,
});
export type CreateWorker = z.infer<typeof createWorkerSchema>;

export const updateProjectStatusSchema = z.object({ status: projectStatusSchema });
export type UpdateProjectStatus = z.infer<typeof updateProjectStatusSchema>;

/** Событие журнала: смена статуса, импорт сметы, правка величины. */
export const eventSchema = z.object({
  at: z.string(),
  kind: z.enum(["status", "import", "field"]),
  title: z.string(),
  detail: z.string().nullable(),
  projectCode: z.string().nullable(),
  actor: z.string().nullable(),
});
export type ProjectEvent = z.infer<typeof eventSchema>;

/** Контрагент: заказчик объекта. Реквизиты видит только руководитель. */
export const clientRowSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  isCompany: z.boolean(),
  requisites: z.string().nullable(),
  projects: z.number().int().nonnegative(),
  estimateTotal: kopecksString,
});
export type ClientRow = z.infer<typeof clientRowSchema>;

export const workerRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  kind: workerKindSchema,
});
export type WorkerRow = z.infer<typeof workerRowSchema>;

const eventToneSchema = z.enum(["neutral", "ok", "warn", "danger"]);

export const calendarDaySchema = z.object({
  date: z.string().date(),
  isToday: z.boolean(),
  events: z.array(
    z.object({
      date: z.string().date(),
      kind: z.enum(["deadline", "import", "status"]),
      title: z.string(),
      projectCode: z.string().nullable(),
      tone: eventToneSchema,
    }),
  ),
});

/**
 * Сводка первого экрана. Денежные величины — клиентские; фонд оплаты труда
 * приходит только роли OWNER и потому объявлен необязательным.
 */
export const measureAmountSchema = z
  .string()
  .regex(/^\d+$/, "Величина обмера передаётся в тысячных долях целым числом в строке");

export const dashboardSchema = z.object({
  today: z.string().date(),
  money: z.object({
    works: kopecksString,
    supervision: kopecksString,
    estimate: kopecksString,
    accepted: kopecksString,
    wage: kopecksString.optional(),
  }),
  statuses: z.array(z.object({ status: projectStatusSchema, count: z.number().int() })),
  projects: z.object({
    total: z.number().int(),
    withEstimate: z.number().int(),
    overdue: z.number().int(),
    /** Срок сегодня. Вложен в dueWeek, а тот — в dueSoon. */
    dueToday: z.number().int(),
    dueWeek: z.number().int(),
    dueSoon: z.number().int(),
  }),
  estimate: z.object({
    positions: z.number().int(),
    findings: z.number().int(),
    discrepancy: kopecksString,
    projectsWithDiscrepancy: z.number().int(),
  }),
  acceptance: z.object({
    accepted: z.number().int(),
    pending: z.number().int(),
    acts: z.number().int(),
    expenses: z.number().int(),
  }),
  /**
   * Охват портфеля обмером. Величины в тысячных долях, как везде: площадь
   * отсюда станет количествами позиций сметы.
   */
  measure: z.object({
    projects: z.number().int(),
    rooms: z.number().int(),
    floorArea: measureAmountSchema,
  }),
  deadlines: z.array(
    z.object({
      code: projectCodeSchema,
      address: z.string(),
      deadline: z.string().date(),
      days: z.number().int(),
    }),
  ),
  week: z.array(calendarDaySchema),
  feed: z.array(eventSchema),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

export const errorSchema = z.object({
  /** Сообщение объясняет, что произошло и что делать. Извинений нет. */
  message: z.string(),
  details: z.array(z.string()).optional(),
});

/** Написание единицы, требующее решения оператора. */
export const unitDecisionSchema = z.object({
  raw: z.string(),
  suggestion: z.string(),
  rows: z.array(z.number().int()),
  positions: z.number().int(),
});

/** Находка отчёта о расхождениях. Вид определяет набор полей. */
export const findingSchema = z.object({
  kind: z.string(),
  title: z.string(),
  /** Денежная величина находки, копейки строкой. Пусто, если находка не о деньгах. */
  amount: kopecksString.nullable(),
  rows: z.array(z.number().int()),
});

export const importReportSchema = z.object({
  positions: z.number().int(),
  sectionsTopLevel: z.number().int(),
  sectionsNested: z.number().int(),
  otherExpenses: z.number().int(),
  computedWorksTotal: kopecksString,
  declaredWorksTotal: kopecksString.nullable(),
  worksTotalDelta: kopecksString.nullable(),
  computedWageTotal: kopecksString,
  declaredWageTotal: kopecksString.nullable(),
  wageTotalDelta: kopecksString.nullable(),
  supervisionShare: z.number().int().nullable(),
  supervisionAmount: kopecksString.nullable(),
  computedEstimateTotal: kopecksString,
  declaredEstimateTotal: kopecksString.nullable(),
  hasDiscrepancy: z.boolean(),
  unitDecisions: z.array(unitDecisionSchema),
  findings: z.array(findingSchema),
});
export type ImportReport = z.infer<typeof importReportSchema>;

/** Подтверждённые оператором сопоставления единиц: написание → каноническая форма. */
export const unitOverridesSchema = z.record(z.string(), z.string());

export const importPreviewResponseSchema = z.object({
  fileName: z.string(),
  report: importReportSchema,
});

export const importResultSchema = z.object({
  importId: z.string().uuid(),
  estimateId: z.string().uuid(),
  version: z.number().int(),
  report: importReportSchema,
});
export type ImportResult = z.infer<typeof importResultSchema>;

/** Позиция сметы в ответе. Внутренние поля приходят только роли OWNER. */
export const estimateItemSchema = z.object({
  id: z.string().uuid(),
  order: z.number().int(),
  name: z.string(),
  unit: z.string(),
  qty: milliunitsString,
  qtyAccepted: milliunitsString,
  unitPrice: kopecksString,
  total: kopecksString,
  unitWage: kopecksString.optional(),
  wageTotal: kopecksString.optional(),
  profit: kopecksString.optional(),
  profitShare: z.number().int().optional(),
});

export interface EstimateSectionNode {
  id: string;
  name: string;
  level: number;
  sourceRow: number | null;
  items: z.infer<typeof estimateItemSchema>[];
  children: EstimateSectionNode[];
  subtotal: string;
  subtotalWage?: string | undefined;
}

/** Раздел рекурсивен, поэтому схема объявляется отложенно. */
export const estimateSectionSchema: z.ZodType<EstimateSectionNode> = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    level: z.number().int(),
    sourceRow: z.number().int().nullable(),
    items: z.array(estimateItemSchema),
    children: z.array(estimateSectionSchema),
    subtotal: kopecksString,
    subtotalWage: kopecksString.optional(),
  }),
);

export const estimateViewSchema = z.object({
  version: z.number().int(),
  importedAt: z.string().nullable(),
  positions: z.number().int(),
  sectionsTopLevel: z.number().int(),
  sectionsNested: z.number().int(),
  sections: z.array(estimateSectionSchema),
  otherExpenses: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      unit: z.string(),
      unitPrice: kopecksString,
      order: z.number().int(),
    }),
  ),
  totals: z.object({
    works: kopecksString,
    supervisionShare: z.number().int(),
    supervision: kopecksString,
    estimate: kopecksString,
    wage: kopecksString.optional(),
    profit: kopecksString.optional(),
  }),
  /** Заявленный в исходном файле итог и расхождение с пересчётом (БП-09). */
  declaredWorksTotal: kopecksString.nullable(),
  worksTotalDelta: kopecksString.nullable(),
});
export type EstimateView = z.infer<typeof estimateViewSchema>;

/* --- правка сметы (пункты плана 2.5, 2.6 и 3.9) ---------------------------

   Правка идёт на месте и новой редакции не порождает: редакция растёт только
   при импорте (Р11 в редакции от 09.09.2026). Каждое поле необязательно —
   лист правит те, которые человек тронул, и присылает только их: полное тело
   заставило бы клиента пересылать неизменённые деньги и открыло бы гонку
   двух окон на полях, которых никто не касался. */

export const updateEstimateItemSchema = z.object({
  name: z.string().trim().min(1, "Наименование не может быть пустым.").max(300).optional(),
  /** Код канонической единицы: м², м.п., шт, точка, ед, рейс, ч/ч, этаж, %. */
  unit: z.string().trim().min(1, "Единица измерения не может быть пустой.").optional(),
  qty: milliunitsString.optional(),
  unitPrice: kopecksString.optional(),
  unitWage: kopecksString.optional(),
});
export type UpdateEstimateItem = z.infer<typeof updateEstimateItemSchema>;

/**
 * Надбавка «сопровождение объекта» — сотые доли процента: 1200 = 12,00 %.
 *
 * Правится у сметы, а не у объекта: смета есть источник цен, по которым
 * считаются итог для клиента и остаток транша (установлено стадией E).
 * Верхняя граница — 100,00 %: надбавка выше удваивает счёт клиенту и почти
 * наверняка означает, что человек ввёл рубли вместо процентов.
 */
export const updateSupervisionSchema = z.object({
  supervisionShare: z.number().int()
    .min(0, "Надбавка не может быть отрицательной.")
    .max(10_000, "Надбавка выше 100 % — проверьте, не введены ли рубли вместо процентов."),
});
export type UpdateSupervision = z.infer<typeof updateSupervisionSchema>;

export const importRecordSchema = z.object({
  id: z.string().uuid(),
  estimateId: z.string().uuid(),
  version: z.number().int(),
  fileName: z.string(),
  importedAt: z.string(),
  positions: z.number().int(),
  report: importReportSchema,
});
export type ImportRecord = z.infer<typeof importRecordSchema>;

/* ---------------------------------------------------------------------------
 * Обмерный план (стадия C.1)
 *
 * Величины обмера пересекают HTTP строкой в тысячных долях — той же
 * идиомой, что количества сметы: площадь в тысячных м², периметры в
 * тысячных м.п., высота в тысячных м, объём в тысячных м³.
 *
 * Знака у величины обмера нет: отрицательной площади не бывает, и
 * `milliunitsString` для неё слишком широка.
 * ------------------------------------------------------------------------ */

export const openingKindSchema = z.enum(["WINDOW", "DOOR"]);
export type OpeningKind = z.infer<typeof openingKindSchema>;

export const measureOpeningSchema = z.object({
  kind: openingKindSchema,
  count: z.number().int().positive(),
  area: measureAmountSchema,
  /** Откосы: суммарная длина по всем проёмам этого вида, тысячных м.п. */
  reveal: measureAmountSchema,
});
export type MeasureOpening = z.infer<typeof measureOpeningSchema>;

export const measureRoomSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  order: z.number().int(),
  floorArea: measureAmountSchema,
  floorPerimeter: measureAmountSchema,
  ceilingPerimeter: measureAmountSchema,
  height: measureAmountSchema,
  /** Выводится сервером из четырёх величин выше. Клиент их не считает. */
  wallArea: measureAmountSchema,
  volume: measureAmountSchema,
  openings: z.array(measureOpeningSchema),
});
export type MeasureRoom = z.infer<typeof measureRoomSchema>;

export const measureTotalsSchema = z.object({
  rooms: z.number().int().nonnegative(),
  floorArea: measureAmountSchema,
  wallArea: measureAmountSchema,
  floorPerimeter: measureAmountSchema,
  ceilingPerimeter: measureAmountSchema,
  volume: measureAmountSchema,
});
export type MeasureTotals = z.infer<typeof measureTotalsSchema>;

/**
 * Сведения о загруженном плане объекта. Адреса файла в контракте нет: он
 * выводится из кода объекта на стороне клиента. Иначе демонстрационная
 * сборка, работающая без сервера, обязана подставлять в контрактное поле
 * строку `data:`.
 */
export const measurePlanSchema = z.object({
  fileName: z.string(),
  contentType: z.string(),
  byteSize: z.number().int().positive(),
  uploadedAt: z.string(),
  uploadedBy: z.string().nullable(),
});
export type MeasurePlan = z.infer<typeof measurePlanSchema>;

/** Вкладка «Замер» одним запросом: помещения, итоги, сведения о плане. */
export const measureViewSchema = z.object({
  rooms: z.array(measureRoomSchema),
  totals: measureTotalsSchema,
  plan: measurePlanSchema.nullable(),
});
export type MeasureView = z.infer<typeof measureViewSchema>;

/**
 * Границы величин. Высота ниже 1,50 м и выше 6,00 м — почти наверняка
 * промах в единицах (сантиметры вместо метров), и поймать его на вводе
 * дешевле, чем объяснять потом объём в две тысячи кубометров.
 *
 * Верхние границы площади и периметров намеренно щедрые: продукт считает
 * квартиры, но обмер коттеджа не должен упираться в предел.
 */
const HEIGHT_MIN = 1_500;
const HEIGHT_MAX = 6_000;
const LENGTH_MAX = 10_000_000; // 10 000 м
const AREA_MAX = 10_000_000;   // 10 000 м²

const inRange = (schema: typeof measureAmountSchema, min: number, max: number, what: string) =>
  schema.refine((value) => {
    const amount = Number(value);
    return amount >= min && amount <= max;
  }, `${what} вне допустимых границ`);

export const createMeasureRoomSchema = z.object({
  name: z.string().min(1, "Назовите помещение").max(60, "Слишком длинное название"),
  floorArea: inRange(measureAmountSchema, 1, AREA_MAX, "Площадь пола"),
  floorPerimeter: inRange(measureAmountSchema, 1, LENGTH_MAX, "Периметр пола"),
  ceilingPerimeter: inRange(measureAmountSchema, 1, LENGTH_MAX, "Периметр потолка"),
  height: inRange(measureAmountSchema, HEIGHT_MIN, HEIGHT_MAX, "Высота"),
  /** Не больше одной строки на вид проёма: окна и двери. */
  openings: z.array(measureOpeningSchema).max(2).optional(),
});
export type CreateMeasureRoom = z.infer<typeof createMeasureRoomSchema>;

export const updateMeasureRoomSchema = createMeasureRoomSchema.partial();
export type UpdateMeasureRoom = z.infer<typeof updateMeasureRoomSchema>;

/* --- приёмка выполненных работ --------------------------------------------
   Внутренние величины (ставка, начисленное, свод по бригадам) объявлены
   необязательными и приходят только роли OWNER — тем же приёмом, что
   `unitWage` и `wage` в смете: ключа нет в ответе, а не значение `null`.

   Сумма начисления прорабу не отдаётся. Начисление есть ставка, умноженная
   на количество, и при известном количестве сумма выдаёт ставку
   арифметически — то есть обходит разграничение на уровне полей. Норматив
   дизайн-системы обещал показывать её в подтверждении; обещание снято,
   причина записана в редакции 2.8. */

/** Позиция сметы в приёмке: сколько по смете, сколько принято, сколько осталось. */
export const acceptancePositionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  unit: z.string(),
  order: z.number().int(),
  qty: milliunitsString,
  /** Принято с учётом сторно. Может быть нулём — это честный ноль. */
  accepted: milliunitsString,
  remaining: milliunitsString,
  unitPrice: kopecksString,
  /** Ставка сдельной оплаты за единицу. Только OWNER. */
  unitWage: kopecksString.optional(),
});
export type AcceptancePosition = z.infer<typeof acceptancePositionSchema>;

/** Бригада-получатель начисления. */
export const brigadeSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});
export type Brigade = z.infer<typeof brigadeSchema>;

/**
 * Раздел сметы в приёмке.
 *
 * `stage` пуст, когда раздел не ведёт ни один этап графика. Принять такой
 * раздел нельзя: начисление некому адресовать. Экран обязан сказать это
 * словами и увести на вкладку «Работа», а не гасить кнопку молча.
 */
export const acceptanceSectionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  order: z.number().int(),
  stage: z.object({ id: z.string().uuid(), name: z.string(), brigade: brigadeSchema.nullable() })
    .nullable(),
  positions: z.array(acceptancePositionSchema),
});
export type AcceptanceSection = z.infer<typeof acceptanceSectionSchema>;

/** Строка пакета: что именно принято по одной позиции. */
export const acceptanceLineSchema = z.object({
  id: z.string().uuid(),
  positionName: z.string(),
  unit: z.string(),
  qty: milliunitsString,
  /** Заполнено у сторно: причина и время обратной записи. */
  reversedAt: z.string().nullable(),
  reason: z.string().nullable(),
  /** Начислено по этой строке. Только OWNER. */
  amount: kopecksString.optional(),
});
export type AcceptanceLine = z.infer<typeof acceptanceLineSchema>;

/** Пакет приёмки: то, что прораб подтвердил одним действием. */
export const acceptanceBatchSchema = z.object({
  id: z.string().uuid(),
  sectionId: z.string().uuid(),
  sectionName: z.string(),
  brigade: brigadeSchema,
  createdAt: z.string(),
  author: z.string().nullable(),
  comment: z.string().nullable(),
  /** Опознаватели фотографий пакета. Адрес файла выводится клиентом. */
  photos: z.array(z.string().uuid()),
  lines: z.array(acceptanceLineSchema),
});
export type AcceptanceBatch = z.infer<typeof acceptanceBatchSchema>;

/** Строка свода начислений по бригаде. Только OWNER. */
export const accrualRowSchema = z.object({
  brigadeId: z.string().uuid(),
  brigadeName: z.string(),
  /** За последние семь дней и за всё время по объекту. */
  week: kopecksString,
  total: kopecksString,
  /**
   * За текущий транш. `null` — открытого транша нет, и разрезать нечем.
   * Ключ остаётся: строка свода существует, отсутствует лишь основание
   * разреза. Отсутствие ключа означало бы «не положено по роли» — весь
   * свод и так отдаётся одному руководителю.
   */
  tranche: kopecksString.nullable(),
});
export type AccrualRow = z.infer<typeof accrualRowSchema>;

export const acceptanceViewSchema = z.object({
  sections: z.array(acceptanceSectionSchema),
  batches: z.array(acceptanceBatchSchema),
  totals: z.object({
    positions: z.number().int().nonnegative(),
    acceptedPositions: z.number().int().nonnegative(),
    /** Выполнено на сумму: Σ принятое × цена единицы. Величина клиентская. */
    accepted: kopecksString,
    /** Начислено бригадам. Только OWNER. */
    accrued: kopecksString.optional(),
  }),
  /** Свод начислений по бригадам. Только OWNER. */
  accruals: z.array(accrualRowSchema).optional(),
});
export type AcceptanceView = z.infer<typeof acceptanceViewSchema>;

/**
 * Заведение пакета. Раздел, отмеченные позиции с количествами и
 * необязательный комментарий; фотография приходит тем же запросом отдельной
 * частью, поэтому в схеме её нет.
 */
export const createAcceptanceSchema = z.object({
  sectionId: z.string().uuid(),
  comment: z.string().trim().max(280, "Комментарий длиннее 280 знаков").optional(),
  positions: z.array(z.object({
    itemId: z.string().uuid(),
    qty: milliunitsString,
  })).min(1, "Отметьте хотя бы одну позицию."),
});
export type CreateAcceptance = z.infer<typeof createAcceptanceSchema>;

/**
 * Сторно приёмки. Причина обязательна: обратная запись без причины
 * неотличима от ошибки ввода, а история не переписывается — значит,
 * объяснить её задним числом будет нечем.
 */
export const reversalSchema = z.object({
  reason: z.string().trim().min(1, "Назовите причину сторно.").max(280, "Причина длиннее 280 знаков"),
});
export type Reversal = z.infer<typeof reversalSchema>;

/* Транш — сумма платежа клиента, в счёт которой идёт выработка (пункты
   плана 4.2–4.4). Величины транша клиентские: клиент платит смету с
   надбавкой «сопровождение объекта», и остаток, посчитанный по стоимости
   работ без надбавки, расходится с экономикой объекта (БП-05).

   Разграничения по ролям здесь нет ни одного поля: транш есть сумма,
   которую платит клиент, а цены сметы прораб и так видит. Внутренними
   остаются ставка и прибыль, и в траншах их нет. */

export const trancheStatusSchema = z.enum(["OPEN", "CLOSED", "PAID"]);
export type TrancheStatus = z.infer<typeof trancheStatusSchema>;

/** Транш с выведенными величинами: выработка, её клиентская сумма, остаток. */
export const trancheSchema = z.object({
  id: z.string().uuid(),
  /** Ноль — предоплата (Р12). */
  number: z.number().int().nonnegative(),
  amount: kopecksString,
  status: trancheStatusSchema,
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  comment: z.string().nullable(),
  /** Выработано по траншу: Σ принятое × цена единицы, без надбавки. */
  produced: kopecksString,
  /** Клиентская сумма выработки: надбавка одним умножением к итогу. */
  client: kopecksString,
  /** Остаток. Отрицательный при перевыработке — законное состояние. */
  remainder: kopecksString,
  /** Заполнение в сотых долях процента. Больше 10000 — перевыработка. */
  fill: z.number().int(),
});
export type Tranche = z.infer<typeof trancheSchema>;

/**
 * Вид вкладки «Транши».
 *
 * `outside` — выработка пакетов приёмки, записанных до появления траншей.
 * Приписать их первому траншу значило бы переписать историю (БП-04),
 * поэтому они показываются отдельной строкой. Ноль в ней — честный ноль.
 */
export const trancheViewSchema = z.object({
  /** Надбавка действующей сметы в сотых долях процента: 1200 = 12,00 %. */
  supervisionShare: z.number().int().nonnegative(),
  tranches: z.array(trancheSchema),
  /** Открытый транш объекта. `null` — открытого нет. */
  current: trancheSchema.nullable(),
  outside: z.object({
    batches: z.number().int().nonnegative(),
    produced: kopecksString,
    client: kopecksString,
  }),
});
export type TrancheView = z.infer<typeof trancheViewSchema>;

/**
 * Заведение транша. Номер не приходит от клиента: он выводится из уже
 * заведённых, иначе два открытых окна завели бы транш с одним номером.
 */
export const createTrancheSchema = z.object({
  amount: kopecksString,
  /** Предоплата: транш № 0, заводится сразу оплаченным (Р12). */
  prepayment: z.boolean().optional(),
  comment: z.string().trim().max(280, "Комментарий длиннее 280 знаков").optional(),
});
export type CreateTranche = z.infer<typeof createTrancheSchema>;

/** Закрытие транша. Комментарий необязателен: закрытие само по себе — факт. */
export const closeTrancheSchema = z.object({
  comment: z.string().trim().max(280, "Комментарий длиннее 280 знаков").optional(),
});
export type CloseTranche = z.infer<typeof closeTrancheSchema>;
