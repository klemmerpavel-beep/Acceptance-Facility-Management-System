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
      project: {
        findFirst: vi.fn(() => Promise.resolve({
          id: "объект", code: "R-1", client: null, supervisionShare: 1200,
        })),
      },
      tranche: {
        findFirst: vi.fn(() => Promise.resolve({
          id: "транш", number: 1, closedAt: new Date("2026-11-05T12:00:00Z"), signedAt: null,
        })),
      },
      /* Подписание фиксирует акт с надбавкой действующей сметы (этап Э9,
         ДР-3) и читает её до записи, — значит, и до правила дня не доходит
         без этого запроса. */
      estimate: { findFirst: vi.fn(() => Promise.resolve({ supervisionShare: 1200 })) },
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

/* П-68, класс K10: дни акта — закрытие транша, фиксация, поправка, скан —
   мгновения и переводятся в день организации. Служба срезала их по UTC: в
   00:30 седьмого по Москве акт датировался шестым, фиксация и поправка —
   тоже. Дата подписания — день календаря, хранимый полночью UTC, и
   переводом не сдвигается: у организации к западу от Гринвича перевод дал
   бы вчерашний день. */
describe("акт: дни закрытия, фиксации, поправки и скана — по дню организации (П-68)", () => {
  const ПОДПИСАН = new Date("2026-11-06T00:00:00Z");
  const организацияВПоясе = (timeZone: string) => ({
    findUnique: vi.fn(() => Promise.resolve({ timeZone })),
    findUniqueOrThrow: vi.fn(() => Promise.resolve({ name: "Студия", phone: null, email: null, requisites: null })),
  });
  const объект = {
    findFirst: vi.fn(() => Promise.resolve({
      id: "объект", code: "R-1", supervisionShare: 1200, client: { name: "Заказчик", requisites: null },
    })),
  };
  const поправка = {
    id: "поправка", actLineId: "строка", qtyBefore: 1000n, qtyAfter: 900n, priceBefore: 100000n, priceAfter: 100000n,
    reason: "Перемерено", createdAt: ГРАНИЦА,
    actLine: { name: "Монтаж", unit: "шт", tranche: { number: 1 } },
    tranche: { number: 2 },
  };
  const транш = {
    id: "транш", number: 1, status: "CLOSED", closedAt: ГРАНИЦА, signedAt: ПОДПИСАН, paidAt: null,
    signedScanType: "application/pdf", signedScanAt: ГРАНИЦА, fixedAt: ГРАНИЦА, fixedShare: 1200,
    actLines: [{
      id: "строка", itemId: "позиция", name: "Монтаж", unit: "шт", qty: 1000n, unitPrice: 100000n,
      unitWage: 50000n, wageTotal: 50000n,
    }],
    corrections: [поправка],
    batches: [],
  };
  const служба = (timeZone: string): ActsService => new ActsService({
    organization: организацияВПоясе(timeZone),
    project: объект,
    estimate: { findFirst: vi.fn(() => Promise.resolve({ supervisionShare: 1200 })) },
    tranche: { findMany: vi.fn(() => Promise.resolve([транш])), findFirst: vi.fn(() => Promise.resolve(транш)) },
    actCorrection: { findMany: vi.fn(() => Promise.resolve([поправка])) },
  } as never, журнал, {} as never);

  it("перечень: акт закрыт, зафиксирован и отсканирован седьмого по Москве, хотя по UTC шестое", async () => {
    const [строка] = await служба("Europe/Moscow").list(руководитель, "R-1");
    expect(строка?.closedAt).toBe(СЕГОДНЯ);
    expect(строка?.fixedAt).toBe(СЕГОДНЯ);
    expect(строка?.scan?.uploadedAt).toBe(СЕГОДНЯ);
    expect(строка?.signedAt).toBe("2026-11-06");
  });

  it("акт: дата, день фиксации и день поправки — седьмое по Москве", async () => {
    const акт = await служба("Europe/Moscow").view(руководитель, "R-1", "транш", "internal");
    expect(акт.closedAt).toBe(СЕГОДНЯ);
    expect(акт.fixedAt).toBe(СЕГОДНЯ);
    expect(акт.corrections[0]?.createdAt).toBe(СЕГОДНЯ);
    expect(акт.amendments[0]?.createdAt).toBe(СЕГОДНЯ);
  });

  it("дата подписания — день календаря: к западу от Гринвича не сдвигается на вчера", async () => {
    const [строка] = await служба("America/New_York").list(руководитель, "R-1");
    expect(строка?.signedAt).toBe("2026-11-06");
    expect(строка?.closedAt).toBe("2026-11-06");
    const акт = await служба("America/New_York").view(руководитель, "R-1", "транш", "client");
    expect(акт.signedAt).toBe("2026-11-06");
  });
});
