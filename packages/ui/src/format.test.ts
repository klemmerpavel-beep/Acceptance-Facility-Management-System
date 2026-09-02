import { describe, expect, it } from "vitest";
import { formatKopecks, formatPercent, formatQty, formatQtyWithUnit, kopecks, milliunits } from "./format.js";

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
