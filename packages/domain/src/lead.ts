import {
  applyPercent, basisPoints, kopecks, multiplyByQuantity,
  type BasisPoints, type Kopecks, type Milliunits,
} from "./money.js";

/**
 * Ориентир цены: вилка «от — до» по площади и тарифу типа ремонта.
 *
 * Вилка, а не точка, — решение заказчика от 11.09.2026. Смета
 * предварительная (01_PROJECT.md, раздел 4, шаг 2), и названное одним числом
 * заказчик запоминает как обещанное. Отклонение задаётся типом ремонта и
 * хранится на заявке снимком: правка справочника не вправе задним числом
 * изменить цену, названную по телефону.
 */
export interface Guideline {
  readonly low: Kopecks;
  readonly high: Kopecks;
}

/**
 * Вилка по площади, тарифу и отклонению.
 *
 * `null`, когда считать не из чего: нулевая площадь или нулевой тариф.
 * Ноль означал бы «ремонт бесплатный», а это иное утверждение — то же
 * правило, по которому доля принятого пуста при нулевом итоге раздела.
 *
 * Площадь — тысячные квадратного метра, тариф — копейки за метр: умножение
 * идёт тем же `multiplyByQuantity`, что и цена позиции сметы на количество.
 */
export function guidelineRange(
  area: Milliunits,
  rate: Kopecks,
  spread: BasisPoints,
): Guideline | null {
  if (area <= 0n || rate <= 0n) return null;
  const центр = multiplyByQuantity(rate, area);
  const отклонение = applyPercent(центр, spread);
  return { low: kopecks(центр - отклонение), high: kopecks(центр + отклонение) };
}

/** Куда лёг итог сметы относительно названной вилки. */
export interface GuidelineVerdict {
  readonly verdict: "внутри" | "выше" | "ниже";
  /** На сколько вышел за границу. Внутри вилки — ноль. */
  readonly delta: Kopecks;
}

/**
 * Сверка итога сметы с ориентиром — то, ради чего ориентир хранится.
 *
 * Величина расхождения считается до ближайшей границы, а не до середины:
 * вилка объявлена целиком, и попадание в её край — попадание, а не промах
 * на половину отклонения.
 */
export function estimateAgainstGuideline(total: Kopecks, range: Guideline): GuidelineVerdict {
  if (total > range.high) return { verdict: "выше", delta: kopecks(total - range.high) };
  if (total < range.low) return { verdict: "ниже", delta: kopecks(range.low - total) };
  return { verdict: "внутри", delta: kopecks(0n) };
}

/** Состояние задачи по заявке. */
export type TaskState = "выполнена" | "просрочена" | "ждёт";

/**
 * Просрочка вычисляется по дате, а не хранится признаком: хранимый признак
 * врёт с полуночи до первого пересчёта, и врёт именно в тот день, когда
 * задача просрочилась.
 *
 * День срока просрочкой не считается: задача со сроком «сегодня» ещё в
 * работе весь сегодняшний день.
 */
export function taskState(dueOn: string, doneAt: string | null, today: string): TaskState {
  if (doneAt !== null) return "выполнена";
  return dueOn < today ? "просрочена" : "ждёт";
}

/** Отклонение по умолчанию для нового типа ремонта: ±15 %. */
export const DEFAULT_SPREAD: BasisPoints = basisPoints(1500);
