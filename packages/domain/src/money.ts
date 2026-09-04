/**
 * Деньги и количества.
 *
 * Единственное место в системе, где выполняется денежная арифметика и
 * округление. Правила, которые здесь реализованы, объявлены в
 * `docs/01_PROJECT.md`, раздел 8:
 *
 *   БП-08. Все денежные величины хранятся в копейках целым числом.
 *          Тип float/double для денег запрещён.
 *   БП-07. Надбавка «сопровождение объекта» применяется процентом к итогу
 *          по работам.
 *
 * Почему не число с плавающей точкой: в смете «Московский проспект 116»
 * 132 позиции работ, и уже на первой из них 406,91 × 120 в двоичной плавающей
 * арифметике даёт 48 829,200000000004. Накопление таких хвостов по всей
 * смете противоречит целевому значению метрики «расхождение расчёта
 * оплаты труда с ручным — 0».
 */

/** Целое число копеек. Именованный тип: копейки нельзя перепутать с рублями. */
export type Kopecks = bigint & { readonly __brand: "Kopecks" };

/**
 * Количество в тысячных долях единицы измерения: 406,91 м² → 406910.
 * Смета заказчика содержит количества с точностью до сотых; тысячные дают
 * запас на порядок и позволяют делить пакет между приёмками без потери.
 */
export type Milliunits = bigint & { readonly __brand: "Milliunits" };

/**
 * Доля в сотых долях процента: 1200 = 12,00 %. Надбавка «сопровождение
 * объекта» задаётся в смете как 0,12 и хранится как 1200.
 */
export type BasisPoints = bigint & { readonly __brand: "BasisPoints" };

const MILLI = 1000n;
const PERCENT = 10_000n;

export const kopecks = (value: bigint | number | string): Kopecks => asInteger(value) as Kopecks;
export const milliunits = (value: bigint | number | string): Milliunits => asInteger(value) as Milliunits;
export const basisPoints = (value: bigint | number | string): BasisPoints => asInteger(value) as BasisPoints;

function asInteger(value: bigint | number | string): bigint {
  if (typeof value === "number" && !Number.isInteger(value)) {
    throw new TypeError(
      `Денежная величина принимает только целое: получено ${value}. ` +
        `Рубли переводятся в копейки до вызова, количества — в тысячные доли.`,
    );
  }
  return BigInt(value);
}

/**
 * Единственное правило округления системы: половина вверх по модулю
 * (half away from zero).
 *
 * Выбор обоснован ожиданием заказчика: 0,5 копейки округляется вверх и для
 * начисления, и для сторно, поэтому пара «начисление + сторно» даёт ноль,
 * а не копейку расхождения. Банковское округление к чётному этого свойства
 * не даёт и на выборке из 132 позиций заметно смещает итог.
 *
 * Правило вынесено наружу ради обмера (`measure.ts`): площадь стен и объём
 * получаются умножением двух величин в тысячных долях и делением на 1000 —
 * та же операция, что у стоимости позиции. Второе написание того же
 * правила разошлось бы с первым, и обмер начал бы округлять иначе, чем
 * деньги, которые из него выводятся.
 */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError("Делитель должен быть положительным");
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** Сумма денежных величин. Пустой список даёт ноль, а не ошибку. */
export function sum(values: readonly Kopecks[]): Kopecks {
  let total = 0n;
  for (const value of values) total += value;
  return total as Kopecks;
}

export const add = (a: Kopecks, b: Kopecks): Kopecks => (a + b) as Kopecks;
export const subtract = (a: Kopecks, b: Kopecks): Kopecks => (a - b) as Kopecks;
export const negate = (a: Kopecks): Kopecks => -(a as bigint) as Kopecks;

/**
 * Стоимость позиции: количество × цена единицы.
 * Количество приходит в тысячных долях, поэтому произведение делится на 1000
 * с округлением по единственному правилу.
 */
export function multiplyByQuantity(unitPrice: Kopecks, quantity: Milliunits): Kopecks {
  return divideRoundHalfUp(unitPrice * quantity, MILLI) as Kopecks;
}

/** Доля от суммы: надбавка, процент готовности в деньгах. */
export function applyPercent(amount: Kopecks, share: BasisPoints): Kopecks {
  return divideRoundHalfUp(amount * share, PERCENT) as Kopecks;
}

/**
 * Сумма с надбавкой, вычисленная **одним умножением**.
 *
 * Раздельное начисление надбавки на каждую позицию с округлением до копейки
 * даёт на 132 позициях накопленное расхождение в рублях. Поэтому надбавка
 * применяется к итогу за транш или за акт целиком, и округление происходит
 * ровно один раз.
 */
export function withSurcharge(amount: Kopecks, share: BasisPoints): Kopecks {
  return divideRoundHalfUp(amount * (PERCENT + share), PERCENT) as Kopecks;
}

/** Доля одной величины в другой, в сотых долях процента. Ноль на нулевой базе. */
export function shareOf(part: Kopecks, whole: Kopecks): BasisPoints {
  if (whole === 0n) return 0n as BasisPoints;
  return divideRoundHalfUp(part * PERCENT, whole < 0n ? -(whole as bigint) : whole) as BasisPoints;
}

/** Разбор рублёвой записи «3 758 778,35» или «3758778.35» в копейки. */
export function parseRubles(input: string): Kopecks {
  const normalized = input.replace(/\s|\u00a0/g, "").replace(",", ".");
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) throw new TypeError(`Не рублёвая сумма: ${input}`);
  const [, sign, whole, fraction = ""] = match;
  const value = BigInt(whole ?? "0") * 100n + BigInt(fraction.padEnd(2, "0"));
  return (sign === "-" ? -value : value) as Kopecks;
}

/** Разбор количества «406,91» в тысячные доли единицы. */
export function parseQuantity(input: string): Milliunits {
  const normalized = input.replace(/\s|\u00a0/g, "").replace(",", ".");
  const match = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(normalized);
  if (!match) throw new TypeError(`Не количество: ${input}`);
  const [, sign, whole, fraction = ""] = match;
  const value = BigInt(whole ?? "0") * MILLI + BigInt(fraction.padEnd(3, "0"));
  return (sign === "-" ? -value : value) as Milliunits;
}
