import { describe, expect, it } from "vitest";
import { basisPoints, kopecks } from "./money.js";
import {
  inboxItems, уместенВОчереди, ВИДЫ_ОЧЕРЕДИ, ОТБОРЫ, адресПункта, актБезПодписи, новоеПосле,
  исчерпанС, просроченС, разделБезЭтапа, разделСегодня, свойЧекОтклонён, чекЧерновик, type ФактыОчереди,
} from "./inbox.js";

const объект = (code: string, status: ФактыОчереди["status"], пункты: ФактыОчереди["пункты"]): ФактыОчереди =>
  ({ code, status, пункты });

describe("очередь «Ждёт вашего действия» (этап Э8, ДР-1)", () => {
  const всё = объект("R-99", "IN_PROGRESS", {
    expenseDrafts: { count: 2, since: "2026-10-01" },
    trancheToClose: { count: 1, since: "2026-10-03" },
    actUnsigned: { count: 1, since: "2026-09-20" },
    paymentOverdue: { count: 1, since: "2026-09-28" },
    sectionsNoStage: { count: 3, since: "2026-09-10" },
    clientNoAccess: { count: 1, since: "2026-08-01" },
    waitingLong: { count: 1, since: "2026-09-20" },
    stageToday: { count: 1, since: "2026-10-05" },
    expenseRejected: { count: 1, since: "2026-10-04" },
    newPhotos: { count: 5, since: "2026-10-04" },
    newActs: { count: 1, since: "2026-10-04" },
  });

  it("каждой роли — только её пункты", () => {
    for (const роль of ["OWNER", "ACCOUNTANT", "FOREMAN", "CLIENT"] as const) {
      const виды = new Set(inboxItems(роль, [всё], "2026-10-05").map((пункт) => пункт.kind));
      expect([...виды].every((вид) => ВИДЫ_ОЧЕРЕДИ[роль].includes(вид))).toBe(true);
    }
    expect(inboxItems("ACCOUNTANT", [всё], "2026-10-05").map((пункт) => пункт.kind).sort())
      .toEqual(["actUnsigned", "paymentOverdue", "trancheToClose"]);
    expect(inboxItems("FOREMAN", [всё], "2026-10-05").map((пункт) => пункт.kind).sort())
      .toEqual(["expenseRejected", "stageToday"]);
    expect(inboxItems("CLIENT", [всё], "2026-10-05").map((пункт) => пункт.kind).sort())
      .toEqual(["newActs", "newPhotos"]);
  });

  it("у завершённого объекта — только деньги и новое; у архивного — ничего", () => {
    expect(уместенВОчереди("paymentOverdue", "DONE")).toBe(true);
    expect(уместенВОчереди("expenseDrafts", "DONE")).toBe(false);
    expect(уместенВОчереди("newPhotos", "DONE")).toBe(true);
    expect(уместенВОчереди("paymentOverdue", "ARCHIVED")).toBe(false);
    const завершён = объект("R-19", "DONE", всё.пункты);
    expect(inboxItems("OWNER", [завершён], "2026-10-05").map((пункт) => пункт.kind).sort())
      .toEqual(["actUnsigned", "paymentOverdue", "trancheToClose"]);
  });

  it("«Ждёт ответа» — только дольше семи дней", () => {
    const ждёт = (since: string): number => inboxItems("OWNER",
      [объект("R-27", "WAITING_CLIENT", { waitingLong: { count: 1, since } })], "2026-10-10").length;
    expect(ждёт("2026-10-03")).toBe(0);
    expect(ждёт("2026-10-02")).toBe(1);
  });

  it("нулевое число пункта не даёт; порядок — от давнего к свежему", () => {
    const пункты = inboxItems("OWNER", [
      объект("R-99", "IN_PROGRESS", { expenseDrafts: { count: 0, since: "2026-09-01" }, actUnsigned: { count: 1, since: "2026-10-02" } }),
      объект("R-31", "IN_PROGRESS", { actUnsigned: { count: 2, since: "2026-09-25" } }),
    ], "2026-10-05");
    expect(пункты.map((пункт) => `${пункт.code}:${пункт.kind}`)).toEqual(["R-31:actUnsigned", "R-99:actUnsigned"]);
  });
});

describe("отборы экранов назначения (этап Э8, ДР-1)", () => {
  const раздел = (stage: { brigade: unknown; startsOn: string; endsOn: string } | null, остатки: string[]) =>
    ({ stage, positions: остатки.map((remaining) => ({ remaining })) });

  it("раздел без этапа и раздел, у этапа которого нет бригады, — оба «без этапа»", () => {
    expect(разделБезЭтапа(раздел(null, ["1000"]))).toBe(true);
    expect(разделБезЭтапа(раздел({ brigade: null, startsOn: "2026-10-01", endsOn: "2026-10-09" }, ["1000"]))).toBe(true);
    expect(разделБезЭтапа(раздел({ brigade: { id: "б" }, startsOn: "2026-10-01", endsOn: "2026-10-09" }, ["1000"]))).toBe(false);
  });

  it("«этап идёт сегодня» — включительно с обеих сторон и только при остатке", () => {
    const этап = { brigade: { id: "б" }, startsOn: "2026-10-01", endsOn: "2026-10-05" };
    expect(разделСегодня(раздел(этап, ["1000"]), "2026-10-01")).toBe(true);
    expect(разделСегодня(раздел(этап, ["1000"]), "2026-10-05")).toBe(true);
    expect(разделСегодня(раздел(этап, ["1000"]), "2026-10-06")).toBe(false);
    expect(разделСегодня(раздел(этап, ["0", "0"]), "2026-10-03")).toBe(false);
    expect(разделСегодня(раздел(null, ["1000"]), "2026-10-03")).toBe(false);
  });

  it("чеки: черновик — любой; отклонённый — только свой", () => {
    expect(чекЧерновик({ status: "DRAFT" })).toBe(true);
    expect(свойЧекОтклонён({ status: "REJECTED", own: true })).toBe(true);
    expect(свойЧекОтклонён({ status: "REJECTED", own: false })).toBe(false);
    expect(актБезПодписи({ signedAt: null })).toBe(true);
  });

  it("новое — строго после отметки, по мгновениям", () => {
    expect(новоеПосле("2026-10-05T10:00:00.001Z", "2026-10-05T10:00:00.000Z")).toBe(true);
    expect(новоеПосле("2026-10-05T10:00:00.000Z", "2026-10-05T10:00:00.000Z")).toBe(false);
    expect(новоеПосле("2026-10-05T13:00:00+03:00", "2026-10-05T09:59:00Z")).toBe(true);
  });

  it("у каждого вида — адрес с отбором из закрытого перечня или сам объект", () => {
    for (const вид of Object.values(ВИДЫ_ОЧЕРЕДИ).flat()) {
      const адрес = адресПункта(вид, "R-99", "x");
      const отбор = /\?([a-z]+)/u.exec(адрес)?.[1];
      expect(отбор === undefined || (ОТБОРЫ as readonly string[]).includes(отбор)).toBe(true);
    }
    expect(адресПункта("clientNoAccess", "R-99")).toBe("#R-99");
  });

  it("просрочка начинается на следующий день после порога", () => {
    expect(просроченС("2026-09-28", 7)).toBe("2026-10-06");
    expect(просроченС("2026-09-30", 0)).toBe("2026-10-01");
  });
});

describe("с какого мгновения транш выработан (этап Э8, ДР-1)", () => {
  const без = basisPoints(0);
  const шаг = (at: string, выработка: number) => ({ at, выработка: kopecks(выработка) });

  it("первая приёмка, исчерпавшая остаток; дальнейшие его не сдвигают", () => {
    expect(исчерпанС([шаг("a", 60), шаг("b", 40), шаг("c", 10)], kopecks(100), без)).toBe("b");
  });

  it("сторно поднимает остаток — отсчёт с новой исчерпавшей приёмки", () => {
    expect(исчерпанС([шаг("a", 100), шаг("b", -30), шаг("c", 30)], kopecks(100), без)).toBe("c");
    expect(исчерпанС([шаг("a", 100), шаг("b", -30)], kopecks(100), без)).toBeNull();
  });

  it("надбавка сопровождения входит в счёт: работ на 100 при 10 % — уже 110", () => {
    expect(исчерпанС([шаг("a", 95)], kopecks(100), basisPoints(1000))).toBe("a");
    expect(исчерпанС([шаг("a", 90)], kopecks(100), basisPoints(1000))).toBeNull();
  });
});
