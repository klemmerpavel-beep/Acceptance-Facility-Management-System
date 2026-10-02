import { describe, expect, it } from "vitest";
import { nextAction, ШАГИ_ОБЪЕКТА, type ФактыОбъекта } from "./progress.js";

const ничего: ФактыОбъекта = {
  rooms: false, estimate: false, schedule: false, foreman: false, clientAccess: false,
  prepayment: false, acceptance: false, act: false, signed: false,
};

describe("следующее действие объекта (план, пункт 7.8)", () => {
  it("девять шагов в порядке работы над объектом", () => {
    expect(ШАГИ_ОБЪЕКТА.map((шаг) => шаг.key)).toEqual([
      "rooms", "estimate", "schedule", "foreman", "clientAccess", "prepayment", "acceptance", "act", "signed",
    ]);
  });

  it("новый объект: выполнено 0 из 9, следующий — помещения замера", () => {
    expect(nextAction(ничего)).toEqual({ done: 0, total: 9, next: { key: "rooms", label: "Завести помещения замера" } });
  });

  it("следующий — первый невыполненный, даже если позже что-то сделано", () => {
    const итог = nextAction({ ...ничего, rooms: true, estimate: true, schedule: true, act: true, signed: true });
    expect(итог.done).toBe(5);
    expect(итог.next?.key).toBe("foreman");
  });

  it("всё выполнено — следующего шага нет", () => {
    const всё = Object.fromEntries(ШАГИ_ОБЪЕКТА.map((шаг) => [шаг.key, true])) as unknown as ФактыОбъекта;
    expect(nextAction(всё)).toEqual({ done: 9, total: 9, next: null });
  });
});
