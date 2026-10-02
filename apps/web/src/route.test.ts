import { describe, expect, it } from "vitest";
import { ВКЛАДКИ, адрес, разобрать, type Маршрут } from "./route.js";

/**
 * Адреса экранов (полный аудит 30.09.2026, П-50; решение заказчика от
 * 01.10.2026). Свойство, на котором держатся «Назад», перезагрузка и
 * переданная ссылка: собранный адрес разбирается обратно в тот же экран.
 */
describe("адрес экрана", () => {
  const маршруты: Маршрут[] = [
    { kind: "section", section: "home" },
    { kind: "section", section: "projects" },
    { kind: "section", section: "settings" },
    { kind: "section", section: "documents" },
    ...ВКЛАДКИ.map((tab) => ({ kind: "project" as const, code: "R-99", tab })),
  ];

  it.each(маршруты)("собранный адрес разбирается в тот же экран: %o", (маршрут) => {
    expect(разобрать(адрес(маршрут))).toEqual(маршрут);
  });

  it("объект без вкладки — «Обзор», и «Обзор» в адрес не пишется", () => {
    expect(разобрать("#R-99")).toEqual({ kind: "project", code: "R-99", tab: "overview" });
    expect(адрес({ kind: "project", code: "R-99", tab: "overview" })).toBe("#R-99");
  });

  it("неизвестная вкладка объекта ведёт на «Обзор», а не в никуда", () => {
    expect(разобрать("#R-99/zzz")).toEqual({ kind: "project", code: "R-99", tab: "overview" });
  });

  it("пустой и ничего не называющий адрес не меняет экрана", () => {
    for (const hash of ["", "#", "#неизвестно", "#r-99", "#R-99999", "#%E0%A4%A"]) {
      expect(разобрать(hash)).toBeNull();
    }
  });

  it("раздел «Документы» и вкладка «Документы» не путаются", () => {
    expect(разобрать("#documents")).toEqual({ kind: "section", section: "documents" });
    expect(разобрать("#R-99/documents")).toEqual({ kind: "project", code: "R-99", tab: "documents" });
  });
});
