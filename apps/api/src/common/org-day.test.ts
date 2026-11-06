import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpensesService } from "../expenses/expenses.service";
import { TranchesService } from "../tranches/tranches.service";
import { ActsService } from "../acts/acts.service";
import { SummaryService } from "../summary/summary.service";
import { LeadsService } from "../leads/leads.service";
import type { RequestUser } from "./current-user";

/**
 * «Сегодня» служб — день организации по её часовому поясу (фаза 0, дефект
 * K10). Службы брали день по UTC: в Воронеже с полуночи до трёх ночи чек и
 * платёж с сегодняшней датой отклонялись как будущие, транш, открытый в эти
 * часы, числился открытым вчера, а неделя первого экрана считалась от
 * вчерашнего дня.
 *
 * Граница одна на все проверки: 00:30 седьмого ноября по Москве — по UTC
 * ещё шестое. Стенд этой границы не испытывает: часы сервера там настоящие,
 * и прогон в рабочее время даёт одинаковый день в любом поясе. Поэтому
 * мгновение передаётся службе доводом, а база подменяется ровно теми
 * запросами, что идут до правила дня. Дальше правила служба не пускается:
 * запись останавливается условной ошибкой, и её появление означает, что
 * правило дня пропустило запрос.
 */
const ГРАНИЦА = new Date("2026-11-06T21:30:00Z");
const СЕГОДНЯ = "2026-11-07";
const ЗАВТРА = "2026-11-08";
const ДАЛЬШЕ = new Error("правило дня пропустило запрос");

const руководитель: RequestUser = {
  id: "руководитель", role: "OWNER", name: "Руководитель", orgId: "организация", orgName: "Студия",
  clientId: null,
};

const организация = { findUnique: vi.fn(() => Promise.resolve({ timeZone: "Europe/Moscow" })) };
const запись = vi.fn(() => Promise.reject(ДАЛЬШЕ));
const журнал = { record: vi.fn(() => Promise.resolve()) };

afterEach(() => { vi.useRealTimers(); });

describe("чек: «чек из будущего» по дню организации", () => {
  const снимок = (): Promise<Buffer> =>
    sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 120, b: 60 } } }).jpeg().toBuffer();

  const завести = async (spentAt: string): Promise<unknown> => {
    const prisma = {
      organization: организация,
      project: { findFirst: vi.fn(() => Promise.resolve({ id: "объект", orgId: "организация" })) },
    };
    const служба = new ExpensesService(prisma as never, журнал, { put: запись } as never);
    return служба.create(руководитель, "R-1", {
      kind: "MATERIALS", amount: "150000", reimbursable: true, seller: "Леруа",
      spentAt, sectionId: null, note: null,
    }, { fileName: "chek.jpg", contentType: "image/jpeg", buffer: await снимок() }, ГРАНИЦА).catch((ошибка: unknown) => ошибка);
  };

  it("сегодняшний по Москве чек принимается, хотя по UTC это завтра", async () => {
    expect(await завести(СЕГОДНЯ)).toBe(ДАЛЬШЕ);
  });

  it("завтрашний по Москве чек отклоняется", async () => {
    const отказ = await завести(ЗАВТРА);
    expect(отказ).toBeInstanceOf(BadRequestException);
    expect((отказ as BadRequestException).message).toContain("из будущего");
  });
});

describe("платёж: будущий день и день открытия транша по дню организации", () => {
  /* Транш открыт в 00:10 седьмого по Москве — по UTC шестого. */
  const записать = (paidOn: string): Promise<unknown> => {
    const prisma = {
      organization: организация,
      project: {
        findFirst: vi.fn(() => Promise.resolve({
          id: "объект", code: "R-1", orgId: "организация", supervisionShare: 0, client: null,
        })),
      },
      tranche: {
        findFirst: vi.fn(() => Promise.resolve({
          id: "транш", number: 1, status: "CLOSED", openedAt: new Date("2026-11-06T21:10:00Z"),
        })),
      },
      $transaction: запись,
    };
    const служба = new TranchesService(prisma as never, журнал);
    return служба.addPayment(руководитель, "R-1", "транш", { amount: "100000", paidOn }, ГРАНИЦА)
      .catch((ошибка: unknown) => ошибка);
  };

  it("платёж сегодняшним по Москве днём записывается", async () => {
    expect(await записать(СЕГОДНЯ)).toBe(ДАЛЬШЕ);
  });

  it("платёж днём раньше открытия транша по Москве отклоняется", async () => {
    const отказ = await записать("2026-11-06");
    expect(отказ).toBeInstanceOf(BadRequestException);
    expect((отказ as BadRequestException).message).toContain("раньше открытия транша");
  });
});

describe("акт: дата подписания по дню организации", () => {
  const подписать = (signedAt: string): Promise<unknown> => {
    const prisma = {
      organization: организация,
      project: { findFirst: vi.fn(() => Promise.resolve({ id: "объект", code: "R-1", client: null })) },
      tranche: {
        findFirst: vi.fn(() => Promise.resolve({
          id: "транш", number: 1, closedAt: new Date("2026-11-05T12:00:00Z"), signedAt: null,
        })),
      },
      $transaction: запись,
    };
    const служба = new ActsService(prisma as never, журнал, {} as never);
    return служба.sign(руководитель, "R-1", "транш", { signedAt }, ГРАНИЦА).catch((ошибка: unknown) => ошибка);
  };

  it("акт, подписанный сегодня по Москве, отмечается", async () => {
    expect(await подписать(СЕГОДНЯ)).toBe(ДАЛЬШЕ);
  });

  it("подписание завтрашним по Москве днём отклоняется", async () => {
    const отказ = await подписать(ЗАВТРА);
    expect(отказ).toBeInstanceOf(BadRequestException);
    expect((отказ as BadRequestException).message).toContain("позже сегодняшней");
  });
});

describe("первый экран и доска заявок: один день организации", () => {
  /* Пустой портфель: каждая выборка отвечает пустым списком. День сводки от
     содержимого не зависит — он и проверяется. */
  const пустая = new Proxy({}, {
    get: (_, модель) => модель === "organization"
      ? организация
      : new Proxy({}, { get: () => () => Promise.resolve([]) }),
  });

  it("неделя сводки считается от сегодняшнего дня организации", async () => {
    const служба = new SummaryService(пустая as never, { eventsFor: () => Promise.resolve([]) } as never);
    const сводка = await служба.dashboard(руководитель, ГРАНИЦА);
    expect(сводка.today).toBe(СЕГОДНЯ);
    expect(сводка.week.some((день) => день.date === СЕГОДНЯ && день.isToday)).toBe(true);
  });

  it("задача со сроком на вчера по Москве просрочена, как и в сводке", async () => {
    vi.useFakeTimers({ now: ГРАНИЦА, toFake: ["Date"] });
    const заявка = {
      id: "заявка", number: 1, name: "Заявка", phone: "+79000000000", address: null, note: null,
      stage: "FIRST_CONTACT", outcome: "OPEN", lostReason: null, createdAt: ГРАНИЦА, anonymizedAt: null,
      repairTypeId: null, area: null, rateSnapshot: null, spreadSnapshot: null, repairType: null, project: null,
      tasks: [{ id: "задача", title: "Позвонить", dueOn: new Date("2026-11-06T00:00:00Z"), doneAt: null }],
    };
    const prisma = { organization: организация, lead: { findMany: vi.fn(() => Promise.resolve([заявка])) } };
    const доска = await new LeadsService(prisma as never, журнал).board(руководитель, true);
    expect(доска.columns.flatMap((колонка) => колонка.leads)[0]?.tasks[0]?.state).toBe("просрочена");
  });
});
