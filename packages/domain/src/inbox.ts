import { daysBetween } from "./portfolio.js";
import { trancheRemainder } from "./tranche.js";
import { kopecks, type BasisPoints, type Kopecks } from "./money.js";

/**
 * Очередь «Ждёт вашего действия» (этап Э8, ДР-1).
 *
 * Обобщение `nextAction` (`progress.ts`) на все роли: тот вычисляет один
 * следующий шаг объекта из его фактов, эта — перечень того, что ждёт
 * действия конкретного человека, по всем его объектам. Факты собирает
 * сервер теми же службами, что строят экраны назначения, — поэтому число
 * пункта совпадает с числом записей там, куда пункт ведёт. Здесь — только
 * правила: что положено роли, у каких объектов, с какого порога и в каком
 * порядке.
 */
export type ВидПункта =
  | "expenseDrafts" | "trancheToClose" | "actUnsigned" | "paymentOverdue" | "sectionsNoStage"
  | "clientNoAccess" | "clientNotEntered" | "waitingLong" | "stageToday" | "expenseRejected"
  | "newPhotos" | "newActs";

export type РольОчереди = "OWNER" | "ACCOUNTANT" | "FOREMAN" | "CLIENT";
export type СтатусОбъектаОчереди = "NEW" | "IN_PROGRESS" | "PAUSED" | "WAITING_CLIENT" | "DONE" | "ARCHIVED";

/** Что ждёт действия каждой роли — по заданию этапа Э8. */
export const ВИДЫ_ОЧЕРЕДИ: Readonly<Record<РольОчереди, readonly ВидПункта[]>> = {
  OWNER: [
    "expenseDrafts", "trancheToClose", "actUnsigned", "paymentOverdue", "sectionsNoStage",
    "clientNoAccess", "clientNotEntered", "waitingLong",
  ],
  ACCOUNTANT: ["trancheToClose", "actUnsigned", "paymentOverdue"],
  FOREMAN: ["stageToday", "expenseRejected"],
  CLIENT: ["newPhotos", "newActs"],
};

/**
 * Пункты, которые остаются и у завершённого объекта: деньги (долг не
 * исчезает с завершением работ, решение допроса Э8-5) и новое для заказчика.
 * Прочие — о ходе работ — только у действующих объектов. Архив не даёт
 * пунктов никаких.
 */
const ВСЕГДА: ReadonlySet<ВидПункта> = new Set<ВидПункта>([
  "trancheToClose", "actUnsigned", "paymentOverdue", "newPhotos", "newActs",
]);

/** «Ждёт ответа» дольше этого числа дней — пункт руководителю. */
export const ДОЛГО_ЖДЁТ_ДНЕЙ = 7;

export interface ФактПункта {
  readonly count: number;
  /** ГГГГ-ММ-ДД: с какого дня ждёт. */
  readonly since: string;
}

export interface ФактыОчереди {
  readonly code: string;
  readonly status: СтатусОбъектаОчереди;
  readonly пункты: Partial<Record<ВидПункта, ФактПункта>>;
}

export interface ПунктОчереди {
  readonly kind: ВидПункта;
  readonly code: string;
  readonly count: number;
  readonly since: string;
}

/** Уместен ли вид пункта у объекта в этом статусе. */
export function уместенВОчереди(вид: ВидПункта, статус: СтатусОбъектаОчереди): boolean {
  if (статус === "ARCHIVED") return false;
  return ВСЕГДА.has(вид) || статус !== "DONE";
}

/**
 * Пункты очереди роли. Порядок — от давнего к свежему: дольше ждущее стоит
 * выше; при равной дате — по коду объекта, чтобы порядок не прыгал.
 */
export function inboxItems(
  role: РольОчереди,
  объекты: readonly ФактыОчереди[],
  today: string,
): ПунктОчереди[] {
  const виды = ВИДЫ_ОЧЕРЕДИ[role];
  const пункты: ПунктОчереди[] = [];
  for (const объект of объекты) {
    for (const вид of виды) {
      const факт = объект.пункты[вид];
      if (факт === undefined || факт.count <= 0) continue;
      if (!уместенВОчереди(вид, объект.status)) continue;
      if (вид === "waitingLong" && daysBetween(факт.since, today) <= ДОЛГО_ЖДЁТ_ДНЕЙ) continue;
      пункты.push({ kind: вид, code: объект.code, count: факт.count, since: факт.since });
    }
  }
  return пункты.sort((а, б) => а.since.localeCompare(б.since) || а.code.localeCompare(б.code));
}

/* --- Отборы экранов назначения ---------------------------------------------

   Число пункта совпадает с числом записей там, куда пункт ведёт (решение
   допроса Э8-4), только если правило отбора одно. Поэтому оно живёт здесь:
   сервер считает им пункт, экран — показывает отобранное. Второе написание
   того же правила на экране разошлось бы с первым на первой правке. */

/** Чек ждёт разбора руководителем. */
export const чекЧерновик = (чек: { readonly status: string }): boolean => чек.status === "DRAFT";

/** Свой чек отклонён: заведён тем, кто смотрит. */
export const свойЧекОтклонён = (чек: { readonly status: string; readonly own: boolean }): boolean =>
  чек.status === "REJECTED" && чек.own;

/** Акт сформирован (транш закрыт), отметки подписи нет. */
export const актБезПодписи = (акт: { readonly signedAt: string | null }): boolean => акт.signedAt === null;

interface РазделПриёмки {
  readonly stage: {
    readonly brigade: unknown;
    readonly startsOn: string;
    readonly endsOn: string;
  } | null;
  readonly positions: readonly { readonly remaining: string }[];
}

/**
 * Раздел сметы без этапа с бригадой: принять его нельзя — начисление
 * адресуется бригаде этапа, и прорабу на объекте нечего делать.
 */
export const разделБезЭтапа = (раздел: РазделПриёмки): boolean =>
  раздел.stage === null || раздел.stage.brigade === null;

/** Этап раздела идёт сегодня, и в разделе есть что принять. */
export const разделСегодня = (раздел: РазделПриёмки, today: string): boolean =>
  раздел.stage !== null
  && раздел.stage.startsOn <= today && today <= раздел.stage.endsOn
  && раздел.positions.some((позиция) => BigInt(позиция.remaining) > 0n);

/** Появилось после отметки прошлого захода. Сравнение мгновений, не строк. */
export const новоеПосле = (at: string, seenAt: string): boolean => Date.parse(at) > Date.parse(seenAt);

/**
 * Отборы, которые понимают экраны назначения. Закрытый перечень: адрес с
 * отбором вне него экран не узнает и покажет всё, и число пункта
 * разойдётся с экраном молча.
 */
export const ОТБОРЫ = [
  "draft", "rejected", "open", "overdue", "unsigned", "nostage", "today", "since", "notentered",
] as const;
export type Отбор = (typeof ОТБОРЫ)[number];

/**
 * Адрес экрана назначения пункта: вкладка объекта (или раздел) с отбором.
 * Пишется сервером в каждый пункт; экран разбирает его тем же перечнем.
 * `значение` — отметка прошлого захода для «нового» или опознаватель
 * заказчика для «ещё не входил».
 */
export function адресПункта(вид: ВидПункта, code: string, значение = ""): string {
  const АДРЕС: Record<ВидПункта, string> = {
    expenseDrafts: `#${code}/expenses?draft`,
    expenseRejected: `#${code}/expenses?rejected`,
    trancheToClose: `#${code}/tranches?open`,
    paymentOverdue: `#${code}/tranches?overdue`,
    actUnsigned: `#${code}/documents?unsigned`,
    newActs: `#${code}/documents?since=${значение}`,
    sectionsNoStage: `#${code}/acceptance?nostage`,
    stageToday: `#${code}/acceptance?today`,
    newPhotos: `#${code}/report?since=${значение}`,
    clientNotEntered: `#settings?notentered=${значение}`,
    /* Объект целиком: вход выдаётся с шага «Выдать вход заказчику» на
       «Обзоре», а ожидание ответа названо в штампе объекта. Запись одна —
       сам объект. */
    clientNoAccess: `#${code}`,
    waitingLong: `#${code}`,
  };
  return АДРЕС[вид];
}

/** День, с которого транш просрочен: следующий за последним днём порога. */
export function просроченС(closedOn: string, graceDays: number): string {
  const день = new Date(`${closedOn}T00:00:00Z`);
  день.setUTCDate(день.getUTCDate() + graceDays + 1);
  return день.toISOString().slice(0, 10);
}

/**
 * С какого мгновения открытый транш выработан: приёмка, после которой
 * остаток ушёл в ноль и больше не поднимался. Сторно возвращает остаток
 * выше нуля — и отсчёт начинается заново со следующей приёмки, которая
 * снова его исчерпала. `null` — остаток выше нуля.
 */
export function исчерпанС(
  шаги: readonly { readonly at: string; readonly выработка: Kopecks }[],
  amount: Kopecks,
  share: BasisPoints,
): string | null {
  let накоплено = 0n;
  let с: string | null = null;
  for (const шаг of шаги) {
    накоплено += шаг.выработка as bigint;
    const остаток = trancheRemainder(amount, kopecks(накоплено), share) as bigint;
    if (остаток > 0n) с = null;
    else с ??= шаг.at;
  }
  return с;
}
