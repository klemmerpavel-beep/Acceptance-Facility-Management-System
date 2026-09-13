import { describe, expect, it } from "vitest";
import { kopecks } from "./money.js";
import { expenseFault, expenseTotals, type ExpenseRecord } from "./expense.js";

const чек = (
  status: ExpenseRecord["status"],
  рубли: number,
  reimbursable = true,
): ExpenseRecord => ({ status, amount: kopecks(рубли * 100), reimbursable });

describe("итоги расходов объекта", () => {
  /* Набор нарочно смешанный: подтверждённые возмещаемые и свои, черновик и
     отклонённый. Каждая строка проверяет своё правило. */
  const строки = [
    чек("CONFIRMED", 12_340),           // материалы, возмещается
    чек("CONFIRMED", 3_500),            // доставка, возмещается
    чек("CONFIRMED", 4_200, false),     // расходник, остаётся на студии
    чек("DRAFT", 99_000),               // черновик прораба, ещё не разобран
    чек("REJECTED", 50_000),            // отклонён руководителем
  ];

  it("считает только подтверждённые", () => {
    expect(expenseTotals(строки).spent).toBe(kopecks(2_004_000));
  });

  it("разделяет возмещаемое и своё", () => {
    const итоги = expenseTotals(строки);
    expect(итоги.reimbursable).toBe(kopecks(1_584_000));
    expect(итоги.own).toBe(kopecks(420_000));
  });

  /* Разделение — не украшение: сумма частей обязана сходиться с целым,
     иначе одна из трёх величин лжёт. */
  it("возмещаемое и своё в сумме дают потраченное", () => {
    const { spent, reimbursable, own } = expenseTotals(строки);
    expect(reimbursable + own).toBe(spent);
  });

  it("черновик не попадает в потраченное", () => {
    const только = [чек("DRAFT", 99_000)];
    expect(expenseTotals(только).spent).toBe(kopecks(0));
  });

  it("отклонённый не попадает в потраченное", () => {
    const только = [чек("REJECTED", 50_000)];
    expect(expenseTotals(только).spent).toBe(kopecks(0));
  });

  it("пустой список даёт три нуля, а не отказ", () => {
    expect(expenseTotals([])).toEqual({
      spent: kopecks(0), reimbursable: kopecks(0), own: kopecks(0),
    });
  });
});

describe("отказ при заведении расхода", () => {
  const годный = { amount: kopecks(123_400), seller: "Петрович", spentAt: "2026-09-10" };
  const СЕГОДНЯ = "2026-09-13";

  it("годный чек принимается", () => {
    expect(expenseFault(годный, СЕГОДНЯ)).toBeNull();
  });

  it("покупка сегодняшним днём принимается", () => {
    expect(expenseFault({ ...годный, spentAt: СЕГОДНЯ }, СЕГОДНЯ)).toBeNull();
  });

  /* Случай назван словами, а не подставлен `%j`: подстановка сериализует
     довод в JSON, а денежная величина здесь — BigInt, который JSON не
     сериализует вовсе. Имя случая всё равно читается человеком. */
  it.each([
    ["нулевая сумма", { amount: kopecks(0) }, "больше нуля"],
    ["отрицательная сумма", { amount: kopecks(-100) }, "больше нуля"],
    ["сумма выше предела", { amount: kopecks(100_000_001) }, "миллиона рублей"],
    ["продавец пробелом", { seller: " " }, "где куплено"],
    ["продавец одной буквой", { seller: "Х" }, "где куплено"],
    ["покупка завтрашним днём", { spentAt: "2026-09-14" }, "из будущего"],
  ])("%s — отказ содержит «%s»", (_имя, правка, слово) => {
    const отказ = expenseFault({ ...годный, ...правка }, СЕГОДНЯ);
    expect(отказ).not.toBeNull();
    expect(отказ).toContain(слово);
  });

  /* Предел проверяется по обе стороны: порог, испытанный только снаружи,
     не отличает «больше предела» от «предел запрещён вовсе». */
  it("ровно миллион рублей принимается", () => {
    expect(expenseFault({ ...годный, amount: kopecks(100_000_000) }, СЕГОДНЯ)).toBeNull();
  });
});
