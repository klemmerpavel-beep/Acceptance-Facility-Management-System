import { describe, expect, it } from "vitest";
import {
  add, applyPercent, basisPoints, kopecks, milliunits, multiplyByQuantity,
  negate, parseQuantity, parseRubles, shareOf, subtract, sum, withSurcharge,
} from "./money.js";

/** Позиции действующей сметы «Московский проспект 116» от 25.08.2026. */
const ПОЗИЦИИ = [
  { имя: "Штукатурка стен по маякам", кол: "406,91", цена: "900", сумма: "366 219,00" },
  { имя: "Грунтование стен",          кол: "406,91", цена: "120", сумма: "48 829,20" },
  { имя: "Полусухая стяжка",          кол: "120,2",  цена: "1000", сумма: "120 200,00" },
  { имя: "Монтаж ГКЛ стена",          кол: "5,36",   цена: "1400", сумма: "7 504,00" },
  { имя: "Возведение перегородок",    кол: "4778",   цена: "50",   сумма: "238 900,00" },
  { имя: "Фартук на кухню",           кол: "3,3",    цена: "2800", сумма: "9 240,00" },
] as const;

describe("БП-08: деньги хранятся в копейках целым числом", () => {
  it.each(ПОЗИЦИИ)("$имя: $кол × $цена = $сумма", ({ кол, цена, сумма }) => {
    const total = multiplyByQuantity(parseRubles(цена), parseQuantity(кол));
    expect(total).toBe(parseRubles(сумма));
  });

  it("дробные количества не теряют точность на всей смете", () => {
    // Двоичная плавающая арифметика на первой же позиции даёт
    // 48 829,200000000004; целочисленная — ровно 48 829,20.
    const итог = sum(ПОЗИЦИИ.map((п) => multiplyByQuantity(parseRubles(п.цена), parseQuantity(п.кол))));
    expect(итог).toBe(parseRubles("790 892,20"));
  });

  it("нецелое значение отвергается на входе", () => {
    expect(() => kopecks(12.5)).toThrow(TypeError);
  });
});

describe("правило округления: половина вверх по модулю", () => {
  it("ровная половина округляется от нуля в обе стороны", () => {
    expect(multiplyByQuantity(kopecks(1n), milliunits(1500n))).toBe(2n);
    expect(multiplyByQuantity(kopecks(-1n), milliunits(1500n))).toBe(-2n);
  });

  it("начисление и его сторно дают ноль", () => {
    // Свойство, ради которого выбрано округление от нуля: при округлении
    // к чётному пара «начисление + сторно» оставляла бы копейку.
    const начислено = multiplyByQuantity(parseRubles("350"), parseQuantity("406,915"));
    const сторно = negate(начислено);
    expect(add(начислено, сторно)).toBe(0n);
  });

  it("меньше половины округляется вниз", () => {
    expect(multiplyByQuantity(kopecks(1n), milliunits(1499n))).toBe(1n);
  });
});

describe("БП-07: надбавка «сопровождение объекта»", () => {
  const итогПоРаботам = parseRubles("3 356 052,10");
  const надбавка = basisPoints(1200n);

  it("12 % от итога по работам равны 402 726,25 ₽", () => {
    expect(applyPercent(итогПоРаботам, надбавка)).toBe(parseRubles("402 726,25"));
  });

  it("итог сметы с надбавкой равен 3 758 778,35 ₽", () => {
    expect(withSurcharge(итогПоРаботам, надбавка)).toBe(parseRubles("3 758 778,35"));
  });

  it("одно умножение к итогу не совпадает с поэлементным начислением", () => {
    // Причина, по которой надбавка применяется к сумме за транш целиком:
    // округление до копейки на каждой позиции накапливает расхождение.
    const позиции = Array.from({ length: 141 }, () => parseRubles("1 234,56"));
    const поэлементно = sum(позиции.map((п) => withSurcharge(п, надбавка)));
    const однимУмножением = withSurcharge(sum(позиции), надбавка);
    expect(поэлементно).not.toBe(однимУмножением);
    expect(поэлементно - однимУмножением).toBeGreaterThan(0n);
  });
});

describe("недосчёт итога действующей сметы", () => {
  it("пересчёт по позициям расходится с заявленным итогом на 438 800,00 ₽", () => {
    const пересчёт = parseRubles("3 794 852,10");
    const заявлено = parseRubles("3 356 052,10");
    const пропущенныйРаздел = parseRubles("295 000,00");   // «Черновой электромонтаж», F44 вне формулы
    const пустойИтог = parseRubles("143 800,00");          // «Монтажные работы», ячейка F164 пуста
    expect(subtract(пересчёт, заявлено)).toBe(parseRubles("438 800,00"));
    expect(add(пропущенныйРаздел, пустойИтог)).toBe(subtract(пересчёт, заявлено));
  });
});

describe("доли и разбор строк", () => {
  it("доля выполненного в итоге сметы", () => {
    expect(shareOf(parseRubles("1 784 222,20"), parseRubles("3 794 852,10"))).toBe(4702n);
    expect(shareOf(kopecks(0n), kopecks(0n))).toBe(0n);
  });

  it("разряды неразрывным пробелом и запятая как разделитель", () => {
    expect(parseRubles("3 758 778,35")).toBe(375877835n);
    expect(parseRubles("3758778.35")).toBe(375877835n);
    expect(parseQuantity("406,91")).toBe(406910n);
    expect(parseQuantity("4778")).toBe(4778000n);
  });

  it("мусор на входе отвергается", () => {
    expect(() => parseRubles("около 500")).toThrow(TypeError);
    expect(() => parseQuantity("м2")).toThrow(TypeError);
  });
});
