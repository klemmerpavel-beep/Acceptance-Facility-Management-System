/**
 * Обмер помещений.
 *
 * Единственное место, где живут формулы обмерного плана. Экран их не
 * повторяет и сервер не повторяет: обе стороны зовут отсюда, поэтому
 * сводка на карточке объекта и число, ушедшее в смету, не могут разойтись.
 *
 * Что измеряется, а что выводится
 * -------------------------------
 * Прораб на объекте вносит четыре величины на помещение: площадь пола,
 * периметр пола, периметр потолка и высоту. Площадь стен и объём выводятся
 * из них. Разделение не произвольно — оно следует из того, чем эти числа
 * являются на стройке:
 *
 *   периметр потолка — линия примыкания стен к потолку, она замкнута;
 *   периметр пола    — длина плинтуса, то есть та же линия за вычетом
 *                      дверных проёмов и того, что закрыто встроенной
 *                      мебелью.
 *
 * Поэтому периметр пола меньше периметра потолка (в обмере «Московского
 * проспекта 116» — 86,07 против 97,39) и **не является периметром
 * многоугольника**: выводить его из площади нельзя ни при каких условиях.
 * Проверка: для семи прямоугольных помещений общей площадью 80,53 м²
 * изопериметрический минимум суммы периметров составляет около 89,4 м —
 * больше измеренных 86,07. Обе величины измеряются, ни одна не выводится.
 *
 * Отсюда же формула площади стен: она идёт по периметру ПОТОЛКА, потому
 * что штукатурится и красится вся стена, включая участки над дверными
 * проёмами. По периметру пола итог дал бы 232,39 м² вместо 262,95 —
 * недосчёт в тринадцать процентов оплачиваемой работы.
 *
 * Единицы
 * -------
 * Все величины — тысячные доли, целым числом (`Milliunits`), по тому же
 * правилу, что количества сметы: площадь в тысячных м², периметры в
 * тысячных м.п., высота в тысячных м, объём в тысячных м³. Число с
 * плавающей точкой не применяется: площади отсюда становятся количествами
 * позиций сметы, а количества умножаются на цены.
 */

import { divideRoundHalfUp, type Milliunits } from "./money.js";

/** Множитель тысячных долей — тот же, что у количеств сметы. */
const MILLI = 1000n;

/** Помещение в том виде, в каком его измерил прораб. */
export interface RoomMeasure {
  /** Площадь пола, тысячных м². */
  readonly floorArea: Milliunits;
  /** Периметр пола — длина плинтуса, тысячных м.п. */
  readonly floorPerimeter: Milliunits;
  /** Периметр потолка — замкнутая линия примыкания, тысячных м.п. */
  readonly ceilingPerimeter: Milliunits;
  /** Высота помещения, тысячных м. */
  readonly height: Milliunits;
  /**
   * Проёмы помещения: не больше строки на вид. Необязательны — помещение
   * без окон и дверей законно, и отсутствие строки значит «нет», а не ноль.
   */
  readonly openings?: readonly RoomOpening[];
}

/** Вид проёма: окна или двери. */
export type OpeningKind = "WINDOW" | "DOOR";

/** Проёмы одного вида в помещении: сколько, общая площадь и длина откосов. */
export interface RoomOpening {
  readonly kind: OpeningKind;
  readonly count: number;
  /** Площадь всех проёмов вида, тысячных м². */
  readonly area: Milliunits;
  /** Откосы по всем проёмам вида, тысячных м.п. */
  readonly reveal: Milliunits;
}

/** Итог проёмов одного вида по объекту. */
export interface OpeningTotals {
  readonly count: number;
  readonly area: Milliunits;
  readonly reveal: Milliunits;
}

/**
 * Произведение двух величин в тысячных долях. Результат тоже в тысячных,
 * поэтому произведение делится на 1000 по единственному правилу
 * округления системы.
 */
const product = (a: Milliunits, b: Milliunits): Milliunits =>
  divideRoundHalfUp(a * b, MILLI) as Milliunits;

/** Площадь стен: периметр потолка × высота. Проёмы не вычитаются. */
export function wallArea(room: RoomMeasure): Milliunits {
  return product(room.ceilingPerimeter, room.height);
}

/** Объём помещения: площадь пола × высота. */
export function roomVolume(room: RoomMeasure): Milliunits {
  return product(room.floorArea, room.height);
}

/** Итоги по объекту. Все величины в тысячных долях, кроме счётчика. */
export interface MeasureTotals {
  readonly rooms: number;
  readonly floorArea: Milliunits;
  readonly wallArea: Milliunits;
  readonly floorPerimeter: Milliunits;
  readonly ceilingPerimeter: Milliunits;
  readonly volume: Milliunits;
  /** Окна по объекту (план, пункт 7.4). */
  readonly windows: OpeningTotals;
  /** Двери по объекту (план, пункт 7.4). */
  readonly doors: OpeningTotals;
}

/**
 * Итоги проёмов одного вида: суммы по помещениям. Помещение без строки
 * этого вида даёт ноль — отсутствие проёмов, а не пропуск.
 */
function openingTotals(rooms: readonly RoomMeasure[], kind: OpeningKind): OpeningTotals {
  let count = 0;
  let area = 0n;
  let reveal = 0n;
  for (const room of rooms) {
    for (const opening of room.openings ?? []) {
      if (opening.kind !== kind) continue;
      count += opening.count;
      area += opening.area;
      reveal += opening.reveal;
    }
  }
  return { count, area: area as Milliunits, reveal: reveal as Milliunits };
}

/**
 * Итоги по объекту.
 *
 * Производные величины считаются по каждому помещению и суммируются в
 * тысячных долях; округление до сотых происходит один раз, при выводе на
 * экран. Обратный порядок — округлить каждое помещение, потом сложить —
 * даёт на этом обмере объём 217,44 м³ вместо 217,43. Это тот же класс
 * ошибки, ради которого в системе одно правило округления и одно место
 * его применения.
 *
 * Пустой список даёт нули, а не отказ: объект без обмера — законное
 * состояние, и экран показывает по нему честный ноль.
 */
export function measureTotals(rooms: readonly RoomMeasure[]): MeasureTotals {
  let floorArea = 0n;
  let walls = 0n;
  let floorPerimeter = 0n;
  let ceilingPerimeter = 0n;
  let volume = 0n;

  for (const room of rooms) {
    floorArea += room.floorArea;
    floorPerimeter += room.floorPerimeter;
    ceilingPerimeter += room.ceilingPerimeter;
    walls += wallArea(room);
    volume += roomVolume(room);
  }

  return {
    rooms: rooms.length,
    floorArea: floorArea as Milliunits,
    wallArea: walls as Milliunits,
    floorPerimeter: floorPerimeter as Milliunits,
    ceilingPerimeter: ceilingPerimeter as Milliunits,
    volume: volume as Milliunits,
    windows: openingTotals(rooms, "WINDOW"),
    doors: openingTotals(rooms, "DOOR"),
  };
}
