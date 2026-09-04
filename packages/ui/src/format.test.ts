import { describe, expect, it } from "vitest";
import { kopecks, measureTotals, milliunits, roomVolume, wallArea } from "@priyomka/domain";
import { formatKopecks, formatMeasure, formatPercent, formatQty, formatQtyWithUnit } from "./format.js";

const NBSP = " ";

describe("formatKopecks", () => {
  it("ставит неразрывный пробел в разрядах и всегда две цифры копеек", () => {
    // Итог сметы «Московский проспект 116» с надбавкой «сопровождение объекта».
    expect(formatKopecks(kopecks(375877835n))).toBe(`3${NBSP}758${NBSP}778,35${NBSP}₽`);
  });

  it("не теряет нулевые копейки", () => {
    expect(formatKopecks(kopecks(335605210n))).toBe(`3${NBSP}356${NBSP}052,10${NBSP}₽`);
    expect(formatKopecks(kopecks(100n))).toBe(`1,00${NBSP}₽`);
    expect(formatKopecks(kopecks(5n))).toBe(`0,05${NBSP}₽`);
    expect(formatKopecks(kopecks(0n))).toBe(`0,00${NBSP}₽`);
  });

  it("сторно читается со знаком минус перед разрядами", () => {
    expect(formatKopecks(kopecks(-428800n))).toBe(`−4${NBSP}288,00${NBSP}₽`);
  });

  it("умеет обходиться без символа валюты", () => {
    expect(formatKopecks(kopecks(29500000n), false)).toBe(`295${NBSP}000,00`);
  });
});

describe("formatQty", () => {
  it("отбрасывает незначащие нули дробной части", () => {
    expect(formatQty(milliunits(406910n))).toBe(`406,91`);
    expect(formatQty(milliunits(2000n))).toBe("2");
    expect(formatQty(milliunits(120200n))).toBe(`120,2`);
    expect(formatQty(milliunits(5360n))).toBe("5,36");
  });

  it("группирует разряды больших количеств", () => {
    // Позиция «Возведение перегородок (кирпич)», 4778 шт.
    expect(formatQty(milliunits(4778000n))).toBe(`4${NBSP}778`);
  });

  it("подставляет единицу измерения через неразрывный пробел", () => {
    expect(formatQtyWithUnit(milliunits(406910n), "м²")).toBe(`406,91${NBSP}м²`);
  });
});

describe("formatPercent", () => {
  it("показывает надбавку сопровождения без лишней дробной части", () => {
    expect(formatPercent(1200n)).toBe(`12${NBSP}%`);
    expect(formatPercent(1250n)).toBe(`12,5${NBSP}%`);
    expect(formatPercent(4850n)).toBe(`48,5${NBSP}%`);
  });
});

describe("formatMeasure", () => {
  it("держит два знака после запятой, в отличие от количества", () => {
    // Обмерный план читается столбцом: «18,4» рядом с «18,40» заставляет
    // проверять, одно ли это число.
    expect(formatMeasure(milliunits(18_400n), "м²")).toBe(`18,40${NBSP}м²`);
    expect(formatMeasure(milliunits(2_700n), "м")).toBe(`2,70${NBSP}м`);
    expect(formatQty(milliunits(18_400n))).toBe("18,4");
  });

  it("округляет третий знак половиной вверх", () => {
    expect(formatMeasure(milliunits(262_953n), "м²")).toBe(`262,95${NBSP}м²`);
    expect(formatMeasure(milliunits(6_345n), "м³")).toBe(`6,35${NBSP}м³`);
  });

  it("группирует разряды и выносит знак перед числом", () => {
    expect(formatMeasure(milliunits(1_234_567n), "м²")).toBe(`1${NBSP}234,57${NBSP}м²`);
    expect(formatMeasure(milliunits(-2_700n), "м")).toBe(`−2,70${NBSP}м`);
  });

  it("столбец ведомости сходится с показанным итогом", () => {
    // Свойство, которое видит человек: на печатной ведомости сумма
    // показанных объёмов обязана совпасть с показанным итогом. Величины
    // складываются в тысячных, а показываются в сотых, и при неудачно
    // подобранном обмере столбец расходится с итогом на копейку.
    const обмер = [
      { floorArea: milliunits(12_300n), ceilingPerimeter: milliunits(18_600n) },
      { floorArea: milliunits(18_400n), ceilingPerimeter: milliunits(17_600n) },
      { floorArea: milliunits(12_700n), ceilingPerimeter: milliunits(14_400n) },
      { floorArea: milliunits(23_630n), ceilingPerimeter: milliunits(21_390n) },
      { floorArea: milliunits(1_800n),  ceilingPerimeter: milliunits(5_400n) },
      { floorArea: milliunits(4_400n),  ceilingPerimeter: milliunits(8_400n) },
      { floorArea: milliunits(7_300n),  ceilingPerimeter: milliunits(11_600n) },
    ].map((к) => ({ ...к, floorPerimeter: milliunits(0n), height: milliunits(2_700n) }));

    const столбец = (значения: readonly string[]): string =>
      значения.map((v) => v.replace(/[^\d,]/g, "").replace(",", ".")).reduce(
        (сумма, v) => сумма + Math.round(Number(v) * 100), 0,
      ).toString();

    const объёмы = обмер.map((к) => formatMeasure(roomVolume(к), "м³"));
    const итог = measureTotals(обмер).volume;
    expect(столбец(объёмы)).toBe(столбец([formatMeasure(итог, "м³")]));

    const стены = обмер.map((к) => formatMeasure(wallArea(к), "м²"));
    expect(столбец(стены)).toBe(столбец([formatMeasure(measureTotals(обмер).wallArea, "м²")]));
  });
});
