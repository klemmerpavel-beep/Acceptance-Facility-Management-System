import { describe, expect, it } from "vitest";
import { ВИДЫ_ОЧЕРЕДИ, адресПункта } from "@priyomka/domain";
import { ВКЛАДКИ, адрес, разобрать, ссылкаВхода, токенВхода, type Маршрут } from "./route.js";

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

/**
 * Отбор в адресе (этап Э8, ДР-1). Пункт очереди ведёт на список с отбором
 * ровно тех записей, что назвал числом; адрес пункта строит сервер тем же
 * доменным `адресПункта`, и разобрать его обязан этот модуль.
 */
describe("отбор в адресе", () => {
  it("адрес каждого вида пункта очереди разбирается, и отбор из него не теряется", () => {
    for (const вид of new Set(Object.values(ВИДЫ_ОЧЕРЕДИ).flat())) {
      const href = адресПункта(вид, "R-99", "2026-10-02T10:00:00.000Z");
      const маршрут = разобрать(href);
      expect(маршрут, href).not.toBeNull();
      if (href.includes("?")) expect(маршрут?.отбор, href).toBeDefined();
      expect(маршрут === null ? null : адрес(маршрут)).toBe(href);
    }
  });

  it("значение отбора — с двоеточиями и точками отметки времени", () => {
    expect(разобрать("#R-99/report?since=2026-10-02T10:00:00.000Z")).toEqual({
      kind: "project", code: "R-99", tab: "report",
      отбор: { вид: "since", значение: "2026-10-02T10:00:00.000Z" },
    });
    expect(разобрать("#settings?notentered=00000000-0000-4000-8000-000000000001")).toEqual({
      kind: "section", section: "settings",
      отбор: { вид: "notentered", значение: "00000000-0000-4000-8000-000000000001" },
    });
  });

  it("неизвестный отбор не отбирает ничего: экран открывается целиком", () => {
    expect(разобрать("#R-99/expenses?zzz")).toEqual({ kind: "project", code: "R-99", tab: "expenses" });
  });
});

/**
 * Ссылка входа — фрагмент адреса, а не строка запроса (ADR-0008, п. 2; П-61).
 * Фрагмент на сервер не уходит и в журнал доступа не попадает; строка запроса
 * попадала. Свойства: токен только во фрагменте; выданная ссылка разбирается
 * обратно в тот же токен; адрес входа экраном вошедшего не считается.
 */
describe("ссылка входа во фрагменте", () => {
  const ТОКЕН = "Zq3-x_Y8aB0cD1eF2gH3iJ4kL5mN6oP7qR8sT9uV0w";

  it("токен — во фрагменте, строки запроса нет", () => {
    const ссылка = ссылкаВхода("https://priyomka.example/", ТОКЕН);
    expect(ссылка).toBe(`https://priyomka.example/#login/${ТОКЕН}`);
    const адрес = new URL(ссылка);
    expect(адрес.search).toBe("");
    expect(адрес.pathname).toBe("/");
    expect(адрес.hash).toBe(`#login/${ТОКЕН}`);
    expect(ссылка).not.toMatch(/consume|token=/u);
  });

  it("путь демонстрации сохраняется, прежний фрагмент — нет", () => {
    expect(ссылкаВхода("https://example.github.io/priyomka/#R-99", "abc")).toBe("https://example.github.io/priyomka/#login/abc");
  });

  it("выданная ссылка разбирается обратно в тот же токен", () => {
    expect(токенВхода(new URL(ссылкаВхода("https://priyomka.example/", ТОКЕН)).hash)).toBe(ТОКЕН);
  });

  it("не ссылка входа — не токен", () => {
    for (const hash of ["", "#", "#login", "#login/", "#login/a b", "#login/abc/def", "#R-99", "#home"]) {
      expect(токенВхода(hash), hash).toBeNull();
    }
  });

  it("адрес входа не экран вошедшего: оболочка остаётся на своём", () => {
    expect(разобрать(`#login/${ТОКЕН}`)).toBeNull();
  });
});
