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
      accepted: kopecks(0),
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
