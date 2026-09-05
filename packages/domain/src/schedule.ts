/**
 * График производства работ.
 *
 * Единственное место, где живёт арифметика этапов. Сервер зовёт отсюда для
 * поля `readiness` в списке объектов, экран — для полосы плана на главной.
 * Обе стороны считают одним кодом, поэтому число в таблице и длина отрезка
 * над ней не могут разойтись.
 *
 * Почему готовность взвешивается по длительности
 * ----------------------------------------------
 * Простое среднее по этапам считает демонтаж на три дня равным чистовой
 * отделке на два месяца. На обмерном объекте R-99 это даёт 88,57 % против
 * 85,57 % — три процента, взятые из воздуха. Взвешивание по длительности
 * не идеально (день штукатурки и день уборки стоят разного), но оно хотя
 * бы опирается на измеренную величину, а не на порядковый номер строки.
 *
 * Почему пустой список даёт null, а не ноль
 * -----------------------------------------
 * Ноль означает «работа не начата». Отсутствие этапов означает «график не
 * заведён». Показать второе первым значит соврать про объект, у которого
 * работа идёт, а график ведут в тетради. Тип это и закрепляет: `null`
 * нельзя случайно сложить или показать процентом.
 *
 * Единицы: прогресс — базисные пункты (`BasisPoints`, 10000 = 100,00 %),
 * как надбавка сопровождения. Доля с плавающей точкой не применяется.
 * Геометрия полосы — обычные числа: это проценты раскладки, а не величина.
 */

import { basisPoints, divideRoundHalfUp, type BasisPoints } from "./money.js";
import { daysBetween } from "./portfolio.js";

/** Этап в том виде, в каком его читает арифметика. Имя и порядок ей не нужны. */
export interface StageSpan {
  /** ГГГГ-ММ-ДД. */
  readonly startsOn: string;
  /** ГГГГ-ММ-ДД, включительно: этап, идущий один день, длится один день. */
  readonly endsOn: string;
  readonly progress: BasisPoints;
}

/**
 * Длительность этапа в днях, обе границы включительно.
 *
 * Этап 02.03 — 02.03 длится один день, а не ноль: иначе однодневная
 * приёмка получила бы нулевой вес и выпала из готовности целиком.
 * Перевёрнутый отрезок (конец раньше начала) даёт один день, а не
 * отрицательный вес: отказывать здесь нечему — данные уже в базе, а
 * отрицательный вес испортил бы итог по всему объекту.
 */
export function stageDays(stage: StageSpan): number {
  return Math.max(1, daysBetween(stage.startsOn, stage.endsOn) + 1);
}

/**
 * Готовность объекта в базисных пунктах, средневзвешенная по длительности
 * этапов. `null` — этапов нет, готовность не задана.
 */
export function projectReadiness(stages: readonly StageSpan[]): BasisPoints | null {
  if (stages.length === 0) return null;

  let weighted = 0n;
  let total = 0n;
  for (const stage of stages) {
    const days = BigInt(stageDays(stage));
    weighted += days * (stage.progress as bigint);
    total += days;
  }

  return basisPoints(divideRoundHalfUp(weighted, total));
}

/** Окно графика: крайние даты и длина в днях, обе границы включительно. */
export interface PlanWindow {
  readonly from: string;
  readonly to: string;
  readonly days: number;
}

/**
 * Окно, вмещающее все переданные этапы. `null` — этапов нет ни одного.
 *
 * Окно строится по этапам, а не по срокам договора: объект, у которого
 * работы начались раньше подписания или уехали за срок, обязан помещаться
 * в полосу целиком. Полоса, обрезающая просроченный хвост, скрывает ровно
 * то, ради чего на неё смотрят.
 */
export function planWindow(stages: readonly StageSpan[]): PlanWindow | null {
  const first = stages[0];
  if (first === undefined) return null;

  let from = first.startsOn;
  let to = first.endsOn;
  for (const stage of stages) {
    if (stage.startsOn < from) from = stage.startsOn;
    if (stage.endsOn > to) to = stage.endsOn;
  }

  return { from, to, days: Math.max(1, daysBetween(from, to) + 1) };
}

/**
 * Окно вокруг дня: `months` месяцев, считая с предыдущего.
 *
 * Полоса, растянутая на весь диапазон этапов портфеля, отдаёт текущему
 * месяцу одну двенадцатую ширины, а завершённому прошлому году — половину
 * экрана. Смотрят на неё ради того, что горит сейчас, и окно строится
 * вокруг сегодняшнего дня.
 *
 * Назад отсчитывается ровно один месяц, а не половина срока: прошлое нужно
 * затем, чтобы увидеть хвост просрочки, и одного месяца для этого хватает.
 * Остальная ширина уходит вперёд, где лежит работа, которую ещё можно
 * успеть сделать.
 */
export function windowAround(day: string, months: number): PlanWindow {
  const [year, month] = day.split("-").map(Number);
  if (year === undefined || month === undefined) {
    throw new Error(`Дата ${day} не в формате ГГГГ-ММ-ДД`);
  }

  const начало = new Date(Date.UTC(year, month - 2, 1));
  // Нулевой день следующего месяца — последний день текущего.
  const конец = new Date(Date.UTC(year, month - 2 + months, 0));
  const iso = (value: Date): string => value.toISOString().slice(0, 10);
  const from = iso(начало);
  const to = iso(конец);

  return { from, to, days: Math.max(1, daysBetween(from, to) + 1) };
}

/** Отступ и длина отрезка в процентах ширины окна. */
export interface BarGeometry {
  readonly offset: number;
  readonly length: number;
}

/** Округление до сотых: сотая доля процента на полосе в 1000 px — десятая пикселя. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Геометрия отрезка этапа внутри окна.
 *
 * Этап, целиком выпавший из окна, даёт нулевую длину, а не отрицательный
 * отступ: вызывающий волен его не рисовать. Отрезок, начавшийся до окна,
 * прижимается к левому краю — обрезается ровно то, чего в окне нет.
 */
export function barGeometry(stage: StageSpan, window: PlanWindow): BarGeometry {
  const start = Math.max(0, daysBetween(window.from, stage.startsOn));
  const end = Math.min(window.days, daysBetween(window.from, stage.endsOn) + 1);
  const length = Math.max(0, end - start);

  return {
    offset: round2((start / window.days) * 100),
    length: round2((length / window.days) * 100),
  };
}

/**
 * Положение дня в окне, в процентах. `null` — день вне окна.
 *
 * Отсчёт идёт от середины дня, а не от его начала: вертикаль текущего дня
 * должна стоять посреди своей клетки, иначе она сольётся со стыком
 * вчерашнего и сегодняшнего.
 */
export function dayOffset(day: string, window: PlanWindow): number | null {
  const index = daysBetween(window.from, day);
  if (index < 0 || index >= window.days) return null;
  return round2(((index + 0.5) / window.days) * 100);
}
