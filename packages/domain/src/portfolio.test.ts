import { describe, expect, it } from "vitest";
import { basisPoints, kopecks } from "./money.js";
import {
  buildPortfolio, buildWeek, daysBetween, workingDaysBetween, type PortfolioProject,
} from "./portfolio.js";

/** Объект действующей сметы: 3 794 852,10 ₽ по работам, надбавка 12 %. */
const R99: PortfolioProject = {
  code: "R-99",
  address: "Московский проспект 116",
  status: "IN_PROGRESS",
  deadline: "2026-08-15",
  worksTotal: kopecks(379_485_210),
  wageTotal: kopecks(122_805_850),
  supervisionShare: basisPoints(1200),
  positions: 132,
  discrepancy: kopecks(43_880_000),
  findings: 6,
};

const R31: PortfolioProject = {
  code: "R-31",
  address: "Кольцовская 24б, кв. 118",
  status: "IN_PROGRESS",
  deadline: "2026-11-30",
  worksTotal: kopecks(100_000_000),
  wageTotal: kopecks(30_000_000),
  supervisionShare: basisPoints(1500),
  positions: 40,
  discrepancy: null,
  findings: 0,
};

const R42: PortfolioProject = {
  code: "R-42",
  address: "Плехановская 22",
  status: "NEW",
  deadline: null,
  worksTotal: null,
  wageTotal: null,
  supervisionShare: basisPoints(1200),
  positions: 0,
  discrepancy: null,
  findings: 0,
};

const TODAY = "2026-09-02";

describe("сводка по портфелю", () => {
  it("итог по работам складывает только объекты со сметой", () => {
    const view = buildPortfolio([R99, R31, R42], { today: TODAY, role: "OWNER" });
    expect(view.money.works).toBe(479_485_210n);
    expect(view.projects.total).toBe(3);
    expect(view.projects.withEstimate).toBe(2);
  });

  it("надбавка считается по объектам, а не усредняется по портфелю", () => {
    const view = buildPortfolio([R99, R31], { today: TODAY, role: "OWNER" });
    // 3 794 852,10 × 12 % = 455 382,25 (округление половины от нуля);
    // 1 000 000,00 × 15 % = 150 000,00. Средняя ставка дала бы другое число.
    expect(view.money.supervision).toBe(45_538_225n + 15_000_000n);
    expect(view.money.estimate).toBe(479_485_210n + 45_538_225n + 15_000_000n);
  });

  it("фонд оплаты труда не попадает в сводку прораба", () => {
    const owner = buildPortfolio([R99], { today: TODAY, role: "OWNER" });
    const foreman = buildPortfolio([R99], { today: TODAY, role: "FOREMAN" });
    expect(owner.money.wage).toBe(122_805_850n);
    expect("wage" in foreman.money).toBe(false);
  });

  it("принято — честный ноль до появления приёмки", () => {
    const view = buildPortfolio([R99, R31], { today: TODAY, role: "OWNER" });
    expect(view.money.accepted).toBe(0n);
  });

  it("сроки: просрочка и близкий срок считаются от переданного дня", () => {
    const view = buildPortfolio([R99, R31], { today: "2026-09-02", role: "OWNER" });
    // 15.08.2026 уже прошло, 30.11.2026 ещё далеко.
    expect(view.projects.overdue).toBe(1);
    expect(view.projects.dueSoon).toBe(0);
    expect(view.deadlines[0]?.code).toBe("R-99");
    expect(view.deadlines[0]?.days).toBe(-18);

    const earlier = buildPortfolio([R31], { today: "2026-11-20", role: "OWNER" });
    expect(earlier.projects.dueSoon).toBe(1);
  });

  it("срок сегодня и срок на неделе — три вложенных счётчика, а не три независимых", () => {
    // 30.11.2026 — срок R-31. Заход в этот день, за пять дней и за десять.
    const сегодня = buildPortfolio([R31], { today: "2026-11-30", role: "OWNER" });
    expect(сегодня.projects.dueToday).toBe(1);
    expect(сегодня.projects.dueWeek).toBe(1);
    expect(сегодня.projects.dueSoon).toBe(1);

    const заПять = buildPortfolio([R31], { today: "2026-11-25", role: "OWNER" });
    expect(заПять.projects.dueToday).toBe(0);
    expect(заПять.projects.dueWeek).toBe(1);

    // Восемь дней — за пределами недели, но внутри двух: карточка «на неделе»
    // обязана погаснуть раньше карточки «близкий срок».
    const заВосемь = buildPortfolio([R31], { today: "2026-11-22", role: "OWNER" });
    expect(заВосемь.projects.dueWeek).toBe(0);
    expect(заВосемь.projects.dueSoon).toBe(1);
  });

  it("просроченный объект в счётчики предстоящих сроков не попадает", () => {
    const view = buildPortfolio([R99], { today: "2026-09-05", role: "OWNER" });
    expect(view.projects.overdue).toBe(1);
    expect(view.projects.dueToday).toBe(0);
    expect(view.projects.dueWeek).toBe(0);
  });

  it("завершённый объект в срочность не попадает", () => {
    const done = { ...R99, status: "DONE" as const };
    const view = buildPortfolio([done], { today: TODAY, role: "OWNER" });
    expect(view.projects.overdue).toBe(0);
    expect(view.deadlines).toEqual([]);
  });

  it("статусы отдаются в порядке жизни объекта и без пустых", () => {
    const view = buildPortfolio([R42, R99], { today: TODAY, role: "OWNER" });
    expect(view.statuses).toEqual([
      { status: "NEW", count: 1 },
      { status: "IN_PROGRESS", count: 1 },
    ]);
  });

  it("расхождения импорта суммируются по портфелю", () => {
    const view = buildPortfolio([R99, R31, R42], { today: TODAY, role: "OWNER" });
    expect(view.estimate.discrepancy).toBe(43_880_000n);
    expect(view.estimate.projectsWithDiscrepancy).toBe(1);
    expect(view.estimate.positions).toBe(172);
    expect(view.estimate.findings).toBe(6);
  });
});

describe("недельная полоса", () => {
  const events = [
    { date: "2026-09-02", kind: "import" as const, title: "Импорт сметы", projectCode: "R-99", tone: "neutral" as const },
    { date: "2026-09-04", kind: "deadline" as const, title: "Дедлайн", projectCode: "R-27", tone: "danger" as const },
    { date: "2026-09-20", kind: "deadline" as const, title: "За пределами недели", projectCode: "R-31", tone: "warn" as const },
  ];

  it("неделя начинается понедельником и содержит семь дней", () => {
    const week = buildWeek("2026-09-02", events);
    expect(week).toHaveLength(7);
    expect(week[0]?.date).toBe("2026-08-31");
    expect(week[6]?.date).toBe("2026-09-06");
  });

  it("сегодняшний день отмечен ровно один раз", () => {
    const week = buildWeek("2026-09-02", events);
    expect(week.filter((day) => day.isToday).map((day) => day.date)).toEqual(["2026-09-02"]);
  });

  it("события раскладываются по своим дням, чужие не попадают", () => {
    const week = buildWeek("2026-09-02", events);
    expect(week[2]?.events.map((event) => event.projectCode)).toEqual(["R-99"]);
    expect(week[4]?.events.map((event) => event.projectCode)).toEqual(["R-27"]);
    expect(week.flatMap((day) => day.events)).toHaveLength(2);
  });

  it("сдвиг на неделю вперёд и назад берёт соседние понедельники", () => {
    expect(buildWeek("2026-09-02", [], 1)[0]?.date).toBe("2026-09-07");
    expect(buildWeek("2026-09-02", [], -1)[0]?.date).toBe("2026-08-24");
  });

  it("воскресенье относится к своей неделе, а не к следующей", () => {
    expect(buildWeek("2026-09-06", [])[0]?.date).toBe("2026-08-31");
  });
});

describe("разница дат", () => {
  it("считается в календарных днях через границы месяца и года", () => {
    expect(daysBetween("2026-09-02", "2026-08-15")).toBe(-18);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
  });
});

describe("рабочие дни", () => {
  it("выходные не считаются", () => {
    // Понедельник 31.08.2026 — понедельник 07.09.2026: семь календарных, пять рабочих.
    expect(daysBetween("2026-08-31", "2026-09-07")).toBe(7);
    expect(workingDaysBetween("2026-08-31", "2026-09-07")).toBe(5);
  });

  it("промежуток целиком из выходных даёт ноль", () => {
    expect(workingDaysBetween("2026-09-05", "2026-09-07")).toBe(0);
  });

  it("обратный и нулевой промежуток дают ноль, а не отрицательное число", () => {
    expect(workingDaysBetween("2026-09-07", "2026-08-31")).toBe(0);
    expect(workingDaysBetween("2026-09-07", "2026-09-07")).toBe(0);
  });

  it("срок объекта действующей сметы считается от начала работ", () => {
    // R-99: работы начаты 02.03.2026, срок по договору 15.08.2026.
    expect(daysBetween("2026-03-02", "2026-08-15")).toBe(166);
    expect(workingDaysBetween("2026-03-02", "2026-08-15")).toBe(120);
  });
});
