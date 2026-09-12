import { describe, expect, it } from "vitest";
import { due, dueByDays, daysUntil } from "./due.js";

/**
 * Шкала срочности. Проверяется здесь, а не обходом страницы: на стенде
 * встречаются не все ступени — объекта со сроком «сегодня» или «завтра» в
 * наполнении нет, и проверка словаря в браузере молчала бы о двух оборотах
 * из пяти. Правило, которое нельзя опровергнуть на стенде, переезжает туда,
 * где его можно опровергнуть.
 */
describe("ступени шкалы", () => {
  it.each([
    [-27, "overdue"], [-1, "overdue"], [0, "today"], [1, "today"],
    [2, "soon"], [7, "soon"], [8, "later"], [365, "later"],
  ] as const)("%i дней — ступень %s", (days, level) => {
    expect(dueByDays(days).level).toBe(level);
  });

  it("срок не задан — своя ступень, а не «далеко»", () => {
    expect(dueByDays(null).level).toBe("none");
    expect(dueByDays(null).days).toBeNull();
  });

  /* Порог недели взят не с потолка: недельным ритмом меряются сроки
     объектов и порог оплаты транша. Граница включительная. */
  it("седьмой день ещё «на неделе», восьмой — уже нет", () => {
    expect(dueByDays(7).level).toBe("soon");
    expect(dueByDays(8).level).toBe("later");
  });
});

describe("словарь", () => {
  it.each([
    [-27, "просрочен на 27 дней"],
    [-2, "просрочен на 2 дня"],
    [-1, "просрочен на 1 день"],
    [0, "сдать сегодня"],
    [1, "сдать завтра"],
    [3, "через 3 дня"],
    [34, "через 34 дня"],
    [11, "через 11 дней"],
  ] as const)("%i дней — «%s»", (days, words) => {
    expect(dueByDays(days).words).toBe(words);
  });

  it("без срока — «срок не задан»", () => {
    expect(dueByDays(null).words).toBe("срок не задан");
  });

  /* Пять ступеней — пять оборотов, и других быть не должно: слово вне
     словаря означает, что срок посчитали ещё раз на месте. */
  it("каждый оборот словаря опознаётся образцом проверки страницы", () => {
    const образцы = [/^просрочен на /u, /^сдать сегодня$/u, /^сдать завтра$/u,
      /^через /u, /^срок не задан$/u];
    const все = [-30, -1, 0, 1, 5, 40].map((days) => dueByDays(days).words);
    все.push(dueByDays(null).words);
    for (const слово of все) {
      expect(образцы.some((образец) => образец.test(слово))).toBe(true);
    }
  });
});

describe("пилюля", () => {
  it("класс ступени входит в имя класса", () => {
    expect(dueByDays(-1).pill).toBe("duepill duepill--overdue");
    expect(dueByDays(0).pill).toBe("duepill duepill--today");
    expect(dueByDays(5).pill).toBe("duepill duepill--soon");
    expect(dueByDays(50).pill).toBe("duepill duepill--later");
    expect(dueByDays(null).pill).toBe("duepill duepill--none");
  });
});

describe("дата и дни", () => {
  it("считает календарные дни между датами", () => {
    expect(daysUntil("2026-08-15", "2026-09-11")).toBe(-27);
    expect(daysUntil("2026-09-11", "2026-09-11")).toBe(0);
    expect(daysUntil("2026-09-12", "2026-09-11")).toBe(1);
  });

  /* Вход по дате и вход по дням обязаны давать одно и то же: два входа
     заведены ради сводки, которая отдаёт дни, а не дату, — и разойтись
     они не должны. */
  it("вход по дате и вход по дням дают один ответ", () => {
    expect(due("2026-08-15", "2026-09-11")).toEqual(dueByDays(-27));
    expect(due(null, "2026-09-11")).toEqual(dueByDays(null));
  });
});
