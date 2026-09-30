import { describe, expect, it } from "vitest";
import {
  fetchAcceptance, fetchActs, fetchClients, fetchDashboard, fetchEstimate, fetchEvents, fetchExpenses,
  fetchForemen, fetchImports, fetchProject, fetchProjects, fetchReport, fetchStages, fetchTranches,
  fetchWorkers, setDemoRole, type DemoRole,
} from "./api.demo.js";
import snapshot from "./demo/snapshot.json" with { type: "json" };

/**
 * Двойник отвечает каждой роли той формой, какую ей отдал сервер.
 *
 * Приёмку двойник не берёт из слепка готовой, а пересобирает: пакеты
 * заводятся и сторнируются в памяти вкладки, и ответ прораба выводится из
 * ответа руководителя снятием ключей. Выбор проекции стоял на роли из
 * слепка руководителя — `data["me-owner"].role === "OWNER"`, — а она
 * «OWNER» всегда. Переключатель ролей её не трогал, и прораб демонстрации
 * получал ставку, начисление и сумму пакета: ровно те величины, которых
 * сервер прорабу не отдаёт (полный аудит 30.09.2026, П-1).
 *
 * Ни одна проверка этого не видела: обход страницы ходит на живой сервер,
 * а обход демонстрации приёмку не открывал вовсе.
 *
 * Мерилом служит не перечень внутренних полей, а сам слепок: съёмка
 * ходила на стенд от имени каждой роли, и форма, снятая с прораба, есть
 * то, что сервер прорабу отдаёт. Перечень устарел бы на первом новом поле,
 * слепок — нет.
 */

type Форма = { [ключ: string]: Форма } | "лист";

/** Форма ответа: ключи на каждом уровне, массивы — объединением элементов. */
const форма = (значение: unknown): Форма => {
  if (Array.isArray(значение)) {
    const итог: Record<string, Форма> = {};
    for (const элемент of значение) {
      const своя = форма(элемент);
      if (своя === "лист") return "лист";
      Object.assign(итог, своя);
    }
    return итог;
  }
  if (значение !== null && typeof значение === "object") {
    return Object.fromEntries(
      Object.entries(значение).map(([ключ, вложенное]) => [ключ, форма(вложенное)]),
    );
  }
  return "лист";
};

const СНЯТО_СЕРВЕРОМ: Record<DemoRole, unknown> = {
  OWNER: snapshot["acceptance-owner"],
  /* Бухгалтер снимался одним ответом «кто я»: его данные совпадают с данными
     руководителя решением заказчика от 19.09.2026. */
  ACCOUNTANT: snapshot["acceptance-owner"],
  FOREMAN: snapshot["acceptance-foreman"],
  /* Заказчику вкладка приёмки не показывается, а ответ, если бы он пришёл,
     обязан быть не шире прорабского: внутренних величин ему нет нигде. */
  CLIENT: snapshot["acceptance-foreman"],
};

describe("двойник: приёмка по роли", () => {
  it.each(Object.keys(СНЯТО_СЕРВЕРОМ) as DemoRole[])("%s получает форму ответа сервера", async (роль) => {
    setDemoRole(роль);
    const ответ = await fetchAcceptance("R-99");
    expect(форма(ответ)).toEqual(форма(СНЯТО_СЕРВЕРОМ[роль]));
  });
});

/**
 * Сплошной отбор: ни одно чтение двойника не несёт прорабу и заказчику
 * внутренней величины.
 *
 * Приёмка была не единственной: смета руководителя уходила всем ролям —
 * при слепках прораба и заказчика, снятых и лежащих рядом без дела, — а
 * бригады и отчёт импорта отдавали начисленное и фонд оплаты труда. В
 * переключателе «Заказчик» стояли ставка и прибыль (полный аудит
 * 30.09.2026, П-1). Правило то же, что у проверки API: ключ, в имени
 * которого есть «wage», «profit» или «accru», — утечка. Чтения берутся те,
 * что роли открыты на сервере.
 */
const ВНУТРЕННЕЕ_ИМЯ = /wage|profit|accru/iu;
const внутренниеКлючи = (значение: unknown, путь = "$"): string[] => {
  if (Array.isArray(значение)) return значение.flatMap((элемент) => внутренниеКлючи(элемент, `${путь}[]`));
  if (значение === null || typeof значение !== "object") return [];
  return Object.entries(значение).flatMap(([ключ, вложенное]) => [
    ...(ВНУТРЕННЕЕ_ИМЯ.test(ключ) ? [`${путь}.${ключ}`] : []),
    ...внутренниеКлючи(вложенное, `${путь}.${ключ}`),
  ]);
};

const ОБЩИЕ: Record<string, () => Promise<unknown>> = {
  "перечень объектов": fetchProjects,
  "карточка R-99": () => fetchProject("R-99"),
  "журнал R-99": () => fetchEvents("R-99"),
  "график R-99": () => fetchStages("R-99"),
  "смета R-99": () => fetchEstimate("R-99"),
  "фотоотчёт R-99": () => fetchReport("R-99"),
  "акты R-99": () => fetchActs("R-99"),
};
const ПРОРАБУ: Record<string, () => Promise<unknown>> = {
  ...ОБЩИЕ,
  "первый экран": fetchDashboard,
  "заказчики": fetchClients,
  "бригады": fetchWorkers,
  "прорабы": fetchForemen,
  "отчёты импорта R-99": () => fetchImports("R-99"),
  "приёмка R-99": () => fetchAcceptance("R-99"),
  "транши R-99": () => fetchTranches("R-99"),
  "чеки R-99": () => fetchExpenses("R-99"),
};

describe("двойник: внутренние величины не доходят до прораба и заказчика", () => {
  it.each([
    ["FOREMAN", ПРОРАБУ],
    ["CLIENT", ОБЩИЕ],
  ] as const)("%s", async (роль, чтения) => {
    setDemoRole(роль);
    const утечки: string[] = [];
    for (const [имя, чтение] of Object.entries(чтения)) {
      const найдено = [...new Set(внутренниеКлючи(await чтение()))];
      if (найдено.length > 0) утечки.push(`${имя}: ${найдено.slice(0, 3).join(", ")}`);
    }
    expect(утечки).toEqual([]);
  });

  it("руководителю внутренние величины приходят: отбор проверен не на пустом ответе", async () => {
    setDemoRole("OWNER");
    expect(внутренниеКлючи(await fetchEstimate("R-99")).length).toBeGreaterThan(0);
  });
});
