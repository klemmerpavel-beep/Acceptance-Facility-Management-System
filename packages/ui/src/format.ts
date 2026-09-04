/**
 * Форматирование чисел интерфейса.
 *
 * Правило дизайн-системы (§3.1): суммы — табличными цифрами, по правому краю,
 * разряды неразрывным пробелом, копейки всегда две цифры: 3 758 778,00 ₽.
 *
 * Деньги во всей системе — целое число копеек (bigint). Тип number для
 * денежных величин запрещён: 0.1 + 0.2 !== 0.3, и на 132 позициях сметы
 * ошибка накапливается до рублей.
 */

/** Неразрывный пробел U+00A0 — разделитель разрядов. */
const NBSP = " ";

import { divideRoundHalfUp } from "@priyomka/domain";
import type { BasisPoints, Kopecks, Milliunits } from "@priyomka/domain";

const groupDigits = (digits: string): string =>
  digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);

/**
 * Копейки → строка суммы. Знак выносится перед разрядами: сторнирующие
 * записи отрицательны и должны читаться как «−4 288,00 ₽», а не «-4 288,00».
 *
 * @param withCurrency добавить символ рубля через неразрывный пробел
 */
export function formatKopecks(value: Kopecks | bigint, withCurrency = true): string {
  const raw: bigint = value;
  const negative = raw < 0n;
  const absolute = negative ? -raw : raw;
  const rubles = absolute / 100n;
  const cents = absolute % 100n;
  const body = `${groupDigits(rubles.toString())},${cents.toString().padStart(2, "0")}`;
  return `${negative ? "−" : ""}${body}${withCurrency ? `${NBSP}₽` : ""}`;
}

/**
 * Количество → строка. Незначащие нули отбрасываются: 2,000 → «2»,
 * 406,910 → «406,91». Целое количество без дробной части читается быстрее,
 * а на экране приёмки каждая лишняя цифра — это время прораба.
 */
export function formatQty(value: Milliunits | bigint): string {
  const raw: bigint = value;
  const negative = raw < 0n;
  const absolute = negative ? -raw : raw;
  const whole = absolute / 1000n;
  const fraction = (absolute % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  const body = fraction.length > 0
    ? `${groupDigits(whole.toString())},${fraction}`
    : groupDigits(whole.toString());
  return `${negative ? "−" : ""}${body}`;
}

/** Доля в сотых долях процента (1200 = 12,00 %) → «12 %» или «12,5 %». */
export function formatPercent(share: BasisPoints | bigint): string {
  const whole = share / 100n;
  const fraction = (share % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  const body = fraction.length > 0 ? `${whole},${fraction}` : whole.toString();
  return `${body}${NBSP}%`;
}

/** Единица измерения рядом с количеством: «406,91 м²». */
export function formatQtyWithUnit(value: Milliunits | bigint, unit: string): string {
  return `${formatQty(value)}${NBSP}${unit}`;
}

/**
 * Величина обмера: два знака после запятой всегда — «18,40 м²», «2,70 м»,
 * «17,60 м.п.».
 *
 * Отличается от `formatQtyWithUnit` тем, что незначащие нули не
 * отбрасываются, и это не придирка. Обмерный план — ведомость чисел одного
 * порядка, читаемая столбцом: «18,4» рядом с «18,40» заставляет проверять,
 * одно ли это число. В смете верно обратное — там «2» читается быстрее,
 * чем «2,00», и каждая лишняя цифра стоит времени прораба.
 *
 * Величины хранятся в тысячных долях, поэтому округление до сотых идёт по
 * тому же правилу «половина вверх», что и деньги: 262 953 тысячных →
 * «262,95 м²».
 */
export function formatMeasure(value: Milliunits | bigint, unit: string): string {
  const raw: bigint = value;
  const negative = raw < 0n;
  const hundredths = divideRoundHalfUp(negative ? -raw : raw, 10n);
  const whole = hundredths / 100n;
  const fraction = (hundredths % 100n).toString().padStart(2, "0");
  const body = `${groupDigits(whole.toString())},${fraction}`;
  return `${negative ? "−" : ""}${body}${NBSP}${unit}`;
}
