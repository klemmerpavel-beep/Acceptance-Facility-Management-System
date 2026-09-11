import { describe, expect, it } from "vitest";
import { readinessRows, statusSlices, type ProjectStatus } from "./portfolio.js";

const строка = (status: ProjectStatus, count: number) => ({ status, count });

describe("состав портфеля долями", () => {
  it("пустой портфель не даёт ни одного сегмента", () => {
    expect(statusSlices([])).toEqual([]);
    expect(statusSlices([строка("NEW", 0)])).toEqual([]);
  });

  it("один статус занимает полосу целиком", () => {
    const [доля] = statusSlices([строка("IN_PROGRESS", 4)]);
    expect(доля?.share).toBe(10_000);
    expect(доля?.count).toBe(4);
  });

  it("статус без объектов в полосу не попадает", () => {
    const доли = statusSlices([строка("NEW", 2), строка("ARCHIVED", 0), строка("DONE", 2)]);
    expect(доли.map((доля) => доля.status)).toEqual(["NEW", "DONE"]);
  });

  it("сумма долей равна ста процентам при любых остатках", () => {
    /* Три четверти по трети — худший случай округления: порознь каждая
       дала бы 3333, и полоса недотянула бы до края на одну сотую. */
    for (const счёт of [[1, 1, 1], [2, 4, 1, 1], [7, 11, 13], [1, 1, 1, 1, 1, 1]]) {
      const доли = statusSlices(счёт.map((count, i) =>
        строка((["NEW", "IN_PROGRESS", "WAITING_CLIENT", "PAUSED", "DONE", "ARCHIVED"] as const)[i]!, count)));
      expect(доли.reduce((сумма, доля) => сумма + доля.share, 0)).toBe(10_000);
    }
  });

  it("порядок сегментов — жизнь объекта, а не число объектов", () => {
    const доли = statusSlices([строка("DONE", 9), строка("NEW", 1), строка("IN_PROGRESS", 2)]);
    expect(доли.map((доля) => доля.status)).toEqual(["NEW", "IN_PROGRESS", "DONE"]);
  });

  it("доли пропорциональны числу объектов", () => {
    const [новые, вРаботе] = statusSlices([строка("NEW", 1), строка("IN_PROGRESS", 3)]);
    expect(новые?.share).toBe(2500);
    expect(вРаботе?.share).toBe(7500);
  });
});

describe("отбор строк готовности", () => {
  const объект = (code: string, readiness: number | null, acceptedShare: number | null = null) =>
    ({ code, readiness, acceptedShare });

  it("объект без графика в список не попадает: ноль означал бы «не начата»", () => {
    const { shown } = readinessRows([объект("R-1", null), объект("R-2", 1000)], 5);
    expect(shown.map((row) => row.code)).toEqual(["R-2"]);
  });

  it("порядок по возрастанию заявленной: сверху то, где отстаёт", () => {
    const { shown } = readinessRows(
      [объект("R-1", 8000), объект("R-2", 1000), объект("R-3", 4000)],
      5,
    );
    expect(shown.map((row) => row.code)).toEqual(["R-2", "R-3", "R-1"]);
  });

  it("предел отсекает лишние строки и называет их число", () => {
    const много = Array.from({ length: 9 }, (_, i) => объект(`R-${String(i)}`, i * 1000));
    const { shown, rest } = readinessRows(много, 5);
    expect(shown).toHaveLength(5);
    expect(rest).toBe(4);
    expect(shown.map((row) => row.code)).toEqual(["R-0", "R-1", "R-2", "R-3", "R-4"]);
  });

  it("объектов меньше предела: остатка нет", () => {
    const { shown, rest } = readinessRows([объект("R-1", 1000)], 5);
    expect(shown).toHaveLength(1);
    expect(rest).toBe(0);
  });

  it("принятое переносится как есть, включая его отсутствие", () => {
    const { shown } = readinessRows([объект("R-1", 5000, 200), объект("R-2", 6000)], 5);
    expect(shown[0]?.fact).toBe(200);
    expect(shown[1]?.fact).toBeNull();
  });

  it("пустой портфель даёт пустой график", () => {
    expect(readinessRows([], 5)).toEqual({ shown: [], rest: 0 });
  });
});
