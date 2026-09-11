/**
 * Сводка по портфелю объектов.
 *
 * Чистые функции: ни базы, ни HTTP, ни текущей даты изнутри. Сегодняшний
 * день передаётся аргументом — иначе тест на «просрочено» жил бы ровно до
 * следующего дедлайна.
 *
 * Разграничение по полям действует и здесь: фонд оплаты труда попадает в
 * сводку только роли OWNER. Агрегат — такой же носитель внутренней
 * величины, как и позиция сметы.
 */
import { add, kopecks, sum, type BasisPoints, type Kopecks } from "./money.js";
import { clientTotals } from "./projection.js";
import type { Role } from "./projection.js";

export type ProjectStatus =
  | "NEW" | "IN_PROGRESS" | "PAUSED" | "WAITING_CLIENT" | "DONE" | "ARCHIVED";

/** Порядок статусов в сводке: от начала жизни объекта к её концу. */
export const STATUS_ORDER: readonly ProjectStatus[] = [
  "NEW", "IN_PROGRESS", "WAITING_CLIENT", "PAUSED", "DONE", "ARCHIVED",
];

/** Статусы, при которых объект считается действующим и попадает в срочность. */
const LIVE: ReadonlySet<ProjectStatus> = new Set<ProjectStatus>([
  "NEW", "IN_PROGRESS", "WAITING_CLIENT", "PAUSED",
]);

export interface PortfolioProject {
  code: string;
  address: string;
  status: ProjectStatus;
  /** Дата в виде ГГГГ-ММ-ДД либо её отсутствие. */
  deadline: string | null;
  /** Итог по работам действующей редакции сметы; пусто — сметы нет. */
  worksTotal: Kopecks | null;
  /** Выполнено на сумму: Σ принятое × цена единицы. Ноль — приёмок нет. */
  acceptedTotal: Kopecks;
  wageTotal: Kopecks | null;
  supervisionShare: BasisPoints;
  positions: number;
  /** Недосчёт итога по последнему импорту: пересчёт минус заявленное. */
  discrepancy: Kopecks | null;
  findings: number;
}

export interface PortfolioMoney {
  works: Kopecks;
  supervision: Kopecks;
  estimate: Kopecks;
  /** Принято по приёмкам. До этапа приёмки — ноль, и это честный ноль. */
  accepted: Kopecks;
  wage?: Kopecks;
}

export interface DeadlineRow {
  code: string;
  address: string;
  deadline: string;
  /** Дней до срока; отрицательное — просрочка. */
  days: number;
}

export interface PortfolioView {
  money: PortfolioMoney;
  statuses: { status: ProjectStatus; count: number }[];
  projects: {
    total: number;
    withEstimate: number;
    overdue: number;
    dueToday: number;
    dueWeek: number;
    dueSoon: number;
  };
  estimate: {
    positions: number;
    findings: number;
    discrepancy: Kopecks;
    projectsWithDiscrepancy: number;
  };
  deadlines: DeadlineRow[];
}

/** Разница в календарных днях между датами ГГГГ-ММ-ДД. Часовых поясов нет. */
export function daysBetween(from: string, to: string): number {
  const parse = (value: string): number => {
    const [year, month, day] = value.split("-").map(Number);
    if (year === undefined || month === undefined || day === undefined) {
      throw new Error(`Дата ${value} не в формате ГГГГ-ММ-ДД`);
    }
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/**
 * Рабочих дней в промежутке [от, до): суббота и воскресенье не считаются.
 * Производственный календарь с переносами праздников не применяется — его
 * пришлось бы вести вручную и обновлять каждый год, а решение о сроке от
 * трёх дней в году не зависит.
 */
export function workingDaysBetween(from: string, to: string): number {
  const total = daysBetween(from, to);
  if (total <= 0) return 0;
  const [year, month, day] = from.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Дата ${from} не в формате ГГГГ-ММ-ДД`);
  }
  const start = Date.UTC(year, month - 1, day);
  let working = 0;
  for (let index = 0; index < total; index += 1) {
    const weekday = new Date(start + index * 86_400_000).getUTCDay();
    if (weekday !== 0 && weekday !== 6) working += 1;
  }
  return working;
}

/** Срок считается близким за две недели: раньше на него не реагируют. */
const SOON_DAYS = 14;

/**
 * Ближайшая неделя — семь дней, а не «до конца календарной недели».
 * В понедельник вторая формулировка охватила бы пять дней, в субботу —
 * один, и число на карточке меняло бы смысл в зависимости от дня захода.
 */
const WEEK_DAYS = 7;

export function buildPortfolio(
  projects: readonly PortfolioProject[],
  options: { today: string; role: Role },
): PortfolioView {
  const works = sum(projects.map((p) => p.worksTotal ?? kopecks(0)));

  // Надбавка своя у каждого объекта, поэтому итог собирается по объектам,
  // а не одним умножением на портфель: 12 % и 15 % не усредняются.
  let supervision = kopecks(0);
  let estimate = kopecks(0);
  for (const project of projects) {
    if (project.worksTotal === null) continue;
    const totals = clientTotals(project.worksTotal, project.supervisionShare);
    supervision = add(supervision, totals.supervision);
    estimate = add(estimate, totals.total);
  }

  const statuses = STATUS_ORDER.map((status) => ({
    status,
    count: projects.filter((project) => project.status === status).length,
  })).filter((row) => row.count > 0);

  const live = projects.filter((project) => LIVE.has(project.status));
  const dated = live
    .filter((project): project is PortfolioProject & { deadline: string } => project.deadline !== null)
    .map((project) => ({
      code: project.code,
      address: project.address,
      deadline: project.deadline,
      days: daysBetween(options.today, project.deadline),
    }))
    .sort((a, b) => a.days - b.days);

  const wage = sum(projects.map((p) => p.wageTotal ?? kopecks(0)));

  return {
    money: {
      works,
      supervision,
      estimate,
      accepted: sum(projects.map((p) => p.acceptedTotal)),
      ...(options.role === "OWNER" ? { wage } : {}),
    },
    statuses,
    projects: {
      total: projects.length,
      withEstimate: projects.filter((project) => project.worksTotal !== null).length,
      overdue: dated.filter((row) => row.days < 0).length,
      dueToday: dated.filter((row) => row.days === 0).length,
      dueWeek: dated.filter((row) => row.days >= 0 && row.days <= WEEK_DAYS).length,
      dueSoon: dated.filter((row) => row.days >= 0 && row.days <= SOON_DAYS).length,
    },
    estimate: {
      positions: projects.reduce((total, project) => total + project.positions, 0),
      findings: projects.reduce((total, project) => total + project.findings, 0),
      discrepancy: sum(projects.map((p) => p.discrepancy ?? kopecks(0))),
      projectsWithDiscrepancy: projects.filter(
        (project) => project.discrepancy !== null && project.discrepancy !== kopecks(0),
      ).length,
    },
    deadlines: dated,
  };
}

export type EventTone = "neutral" | "ok" | "warn" | "danger";

export interface CalendarEvent {
  /** ГГГГ-ММ-ДД. */
  date: string;
  kind: "deadline" | "import" | "status";
  title: string;
  projectCode: string | null;
  tone: EventTone;
}

export interface CalendarDay {
  date: string;
  isToday: boolean;
  events: CalendarEvent[];
}

/**
 * Неделя, содержащая заданный день, от понедельника к воскресенью.
 * Неделя, а не «ближайшие семь дней»: заказчик планирует неделями, и
 * плавающее окно ломает привычку смотреть на понедельник.
 */
export function buildWeek(
  today: string,
  events: readonly CalendarEvent[],
  offsetWeeks = 0,
): CalendarDay[] {
  const [year, month, day] = today.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Дата ${today} не в формате ГГГГ-ММ-ДД`);
  }
  const anchor = new Date(Date.UTC(year, month - 1, day));
  // getUTCDay: воскресенье — ноль, поэтому неделя сдвигается на шесть.
  const shift = (anchor.getUTCDay() + 6) % 7;
  const monday = new Date(anchor.getTime() - shift * 86_400_000 + offsetWeeks * 7 * 86_400_000);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday.getTime() + index * 86_400_000).toISOString().slice(0, 10);
    return {
      date,
      isToday: date === today,
      events: events.filter((event) => event.date === date),
    };
  });
}

/* ---------------------------------------------------------------------------
   Состав портфеля долями
   -------------------------------------------------------------------------- */

/** Доля статуса в портфеле: число объектов и ширина сегмента в сотых процента. */
export interface StatusSlice {
  readonly status: ProjectStatus;
  readonly count: number;
  /** Сотые доли процента: 4444 = 44,44 %. Целое — долей с плавающей точкой в продукте нет. */
  readonly share: number;
}

/**
 * Состав портфеля по статусам, долями одной полосы.
 *
 * Доли считаются накопительно, а не каждая порознь: порознь шесть округлений
 * дают до шести сотых расхождения с сотней, и последний сегмент полосы либо
 * не достаёт до края, либо вылезает за него. Щель в один пиксель на стыке
 * читается как ещё один статус, которого нет.
 *
 * Статусы без объектов в полосу не попадают: сегмент нулевой ширины —
 * это не сегмент, а невидимая граница, на которую нельзя навести.
 * В подписях под полосой они тоже не нужны: «Архив — 0» сообщает ровно то,
 * что и молчание, но занимает строку.
 *
 * Порядок — `STATUS_ORDER`, от начала жизни объекта к её концу. Полоса
 * читается слева направо как путь объекта, и порядок по убыванию числа
 * сделал бы её переставляющейся при каждой смене статуса.
 */
export function statusSlices(
  rows: readonly { status: ProjectStatus; count: number }[],
): StatusSlice[] {
  const счёт = new Map(rows.map((row) => [row.status, row.count]));
  const всего = rows.reduce((итог, row) => итог + row.count, 0);
  if (всего === 0) return [];

  const slices: StatusSlice[] = [];
  let накоплено = 0;
  let роздано = 0;
  for (const status of STATUS_ORDER) {
    const count = счёт.get(status) ?? 0;
    if (count === 0) continue;
    накоплено += count;
    const граница = Math.round((накоплено * 10_000) / всего);
    slices.push({ status, count, share: граница - роздано });
    роздано = граница;
  }
  return slices;
}

/** Строка готовности: что показывает график и сколько осталось за ним. */
export interface ReadinessRow {
  readonly code: string;
  /** Заявленная готовность, сотые доли процента. */
  readonly claim: number;
  /** Принятое по приёмке, сотые доли процента. `null` — приёмки нет. */
  readonly fact: number | null;
}

/**
 * Отбор строк для графика готовности первого экрана.
 *
 * Три правила в одном месте: объект без графика не показывается вовсе
 * (ноль означал бы «работа не начата», а её просто не планировали),
 * порядок — по возрастанию заявленной (сверху то, где работа отстаёт),
 * и предел строк, за которым начинается уже список, а не график.
 *
 * Правило живёт здесь, а не в разметке экрана, потому что на стенде его
 * негде испытать: действующих объектов с графиком там ровно столько,
 * сколько строк показывает экран, и снятый предел ничего не меняет.
 * Проверка, которая не может упасть, не стережёт ничего.
 */
export function readinessRows(
  projects: readonly { code: string; readiness: number | null; acceptedShare: number | null }[],
  limit: number,
): { shown: ReadinessRow[]; rest: number } {
  const сГрафиком = projects
    .filter((project) => project.readiness !== null)
    .map((project) => ({
      code: project.code,
      claim: project.readiness ?? 0,
      fact: project.acceptedShare,
    }))
    .sort((левый, правый) => левый.claim - правый.claim);

  return {
    shown: сГрафиком.slice(0, Math.max(0, limit)),
    rest: Math.max(0, сГрафиком.length - Math.max(0, limit)),
  };
}
