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

export const projectSummarySchema = z.object({
  id: z.string().uuid(),
  code: projectCodeSchema,
  address: z.string(),
  status: projectStatusSchema,
  /** Дата начала работ. Отличается от даты заведения объекта в системе. */
  startedAt: z.string().date().nullable(),
  deadline: z.string().date().nullable(),
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
  /** Доля принятого в сотых долях процента. До этапа приёмки — ноль. */
  readiness: z.number().int().nonnegative(),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

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

/** Расчётная единица сдельной оплаты: бригада или мастер. */
export const workerRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  kind: z.enum(["BRIGADE", "PERSON"]),
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
