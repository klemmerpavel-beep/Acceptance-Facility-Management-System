import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { updateProjectStatusSchema } from "@priyomka/contracts";
import { inboxKindSchema } from "@priyomka/contracts";
import { actTurn, expenseTurn, trancheTurn, waitingTurn, ПУНКТ, пунктов, ХОД } from "./turn.js";

/**
 * Строка «чей ход» (этап Э8, ДР-4). Проверяется здесь, а не только обходом
 * страницы: на стенде встречаются не все обороты — транша, закрытого
 * сегодня, в наполнении нет, и правило «меньше дня» молчало бы в браузере.
 */
describe("транш", () => {
  it.each([
    [0, "Закрыт 05.10 · ждёт оплаты заказчиком · меньше дня"],
    [1, "Закрыт 05.10 · ждёт оплаты заказчиком · 1 день"],
    [3, "Закрыт 05.10 · ждёт оплаты заказчиком · 3 дня"],
    [12, "Закрыт 05.10 · ждёт оплаты заказчиком · 12 дней"],
  ] as const)("закрыт %i дн. назад — «%s»", (дней, фраза) => {
    expect(trancheTurn({ status: "CLOSED", closedAt: "2026-10-05T09:00:00.000Z", awaitingDays: дней })).toBe(фраза);
  });

  it("открытый и оплаченный ничего не ждут — строки нет", () => {
    expect(trancheTurn({ status: "OPEN", closedAt: null, awaitingDays: null })).toBeNull();
    expect(trancheTurn({ status: "PAID", closedAt: "2026-10-01T09:00:00.000Z", awaitingDays: null })).toBeNull();
  });
});

describe("акт, чек и объект", () => {
  it("акт без подписи ждёт заказчика, подписанный называет дату", () => {
    expect(actTurn(null)).toBe("Сформирован · ждёт подписи заказчика");
    expect(actTurn("2026-09-14")).toBe("Подписан 14.09");
  });

  it("ждёт руководителя только черновик чека", () => {
    expect(expenseTurn("DRAFT")).toBe("Черновик · ждёт руководителя");
    expect(expenseTurn("CONFIRMED")).toBeNull();
    expect(expenseTurn("REJECTED")).toBeNull();
  });

  it("объект «Ждёт ответа» называет, чего ждём; без поля — строки нет", () => {
    expect(waitingTurn("От заказчика: выбор плитки")).toBe("Ждём: От заказчика: выбор плитки");
    expect(waitingTurn(null)).toBeNull();
  });
});

describe("поле «Ждём» в контракте смены статуса", () => {
  it("«Ждёт ответа» без поля — отказ, и отказ называет поле", () => {
    const итог = updateProjectStatusSchema.safeParse({ status: "WAITING_CLIENT" });
    expect(итог.success).toBe(false);
    expect(итог.error?.issues[0]?.message).toMatch(/«Ждём»/u);
    expect(updateProjectStatusSchema.safeParse({ status: "WAITING_CLIENT", waitingFor: "   " }).success).toBe(false);
  });

  it("с полем — принимается; прочим статусам поле не нужно", () => {
    expect(updateProjectStatusSchema.safeParse({ status: "WAITING_CLIENT", waitingFor: "Выбор плитки" }).success).toBe(true);
    expect(updateProjectStatusSchema.safeParse({ status: "IN_PROGRESS" }).success).toBe(true);
  });

  it("длиннее 140 знаков — отказ с названным пределом", () => {
    const итог = updateProjectStatusSchema.safeParse({ status: "WAITING_CLIENT", waitingFor: "я".repeat(141) });
    expect(итог.success).toBe(false);
    expect(итог.error?.issues[0]?.message).toMatch(/140/u);
  });
});

/**
 * Словарь закрыт: обороты «чей ход» не пишутся экраном своими словами.
 * Ищется обход — фраза словаря в тексте модуля экрана мимо `turn.ts`.
 */
describe("закрытость словаря", () => {
  const КОРЕНЬ = new URL("./", import.meta.url).pathname;
  const безКомментариев = (текст: string): string => текст
    .replace(/\{\/\*[\s\S]*?\*\/\}/gu, "")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^\s*\/\/.*$/gmu, "");
  const модули = readdirSync(КОРЕНЬ)
    .filter((имя) => (имя.endsWith(".tsx") || имя.endsWith(".ts")) && !имя.endsWith(".test.ts") && имя !== "turn.ts")
    .map((имя) => ({ имя, текст: безКомментариев(readFileSync(`${КОРЕНЬ}${имя}`, "utf8")) }));

  it("модулей достаточно: правило проверяет не пустое место", () => {
    expect(модули.length).toBeGreaterThan(30);
  });

  it("ни один модуль не пишет оборот «чей ход» мимо словаря", () => {
    const обороты = [/ждёт оплаты заказчиком/u, /ждёт подписи заказчика/u, /ждёт руководителя/u];
    const найдено = модули.flatMap(({ имя, текст }) => обороты
      .filter((оборот) => оборот.test(текст)).map((оборот) => `${имя}: ${оборот.source}`));
    expect(найдено).toEqual([]);
  });

  it("словарь называет четыре оборота", () => {
    expect(Object.keys(ХОД)).toHaveLength(4);
  });
});

/**
 * Пункты очереди «Ждёт вашего действия» (этап Э8, ДР-1). Строка начинается
 * с раздела продукта; число записей стоит во фразе, где их бывает больше
 * одной, — то самое число, что сверяется с экраном назначения.
 */
describe("пункты очереди", () => {
  it("у каждого вида контракта есть фраза, и только у них", () => {
    expect(Object.keys(ПУНКТ).sort()).toEqual([...inboxKindSchema.options].sort());
  });

  it("число записей стоит во фразе там, где записей бывает больше одной", () => {
    const одна = new Set(["trancheToClose", "clientNoAccess", "waitingLong"]);
    for (const [вид, фраза] of Object.entries(ПУНКТ)) {
      expect(фраза.что(17).includes("17"), вид).toBe(!одна.has(вид));
    }
  });

  it("раздел — с прописной, кнопка ведёт глаголом «Перейти»", () => {
    for (const фраза of Object.values(ПУНКТ)) {
      expect(фраза.раздел).toMatch(/^[А-ЯЁ]/u);
      expect(фраза.кнопка).toMatch(/^Перейти к /u);
    }
  });

  it("число пунктов согласовано: 1 пункт, 3 пункта, 5 пунктов", () => {
    expect([1, 3, 5, 11, 21].map(пунктов)).toEqual(["1 пункт", "3 пункта", "5 пунктов", "11 пунктов", "21 пункт"]);
  });
});
