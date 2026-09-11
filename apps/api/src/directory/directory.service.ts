import { BadRequestException, Injectable } from "@nestjs/common";
import type {
  ClientRow,
  CreateClient,
  CreateWorker,
  Organization,
  Unit,
  UpdateOrganization,
  WorkerRow,
} from "@priyomka/contracts";
import { parseContactPhone } from "@priyomka/domain";
import { unitAliases } from "@priyomka/importer";
import {
  accrualSummary, basisPoints, clientTotals, kopecks, sum,
  type AccrualRecord, type Kopecks,
} from "@priyomka/domain";
import { PrismaService } from "../prisma.service";
import type { RequestUser } from "../common/current-user";
import { projectScope } from "../common/project-scope";
import { estimateFacts } from "../common/estimate-facts";

/** Единица, ещё не встречавшаяся в сметах организации, своей строки не имеет. */
const EMPTY_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Справочники организации: заказчики и расчётные единицы сдельной оплаты.
 *
 * Заказчик виден только вместе со своими объектами: прораб получает список
 * заказчиков тех объектов, на которые он назначен, и ничей больше.
 */
@Injectable()
export class DirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  async clients(user: RequestUser): Promise<ClientRow[]> {
    const projects = await this.prisma.project.findMany({
      where: projectScope(user),
      select: { id: true, clientId: true, supervisionShare: true },
    });

    const facts = await estimateFacts(this.prisma, projects.map((project) => project.id));
    // Руководитель видит справочник целиком, включая заказчиков без
    // объектов: иначе заведённый заказчик исчезал бы из списка сразу после
    // добавления и до того, как ему заведут первый объект. Прораб по
    // прежнему видит только заказчиков доступных ему объектов — это
    // разграничение видимости строк, а не полнота справочника.
    const clients = await this.prisma.client.findMany({
      where:
        user.role === "OWNER"
          ? { orgId: user.orgId }
          : { orgId: user.orgId, id: { in: [...new Set(projects.map((p) => p.clientId))] } },
      orderBy: { code: "asc" },
    });

    return clients.map((client) => {
      const own = projects.filter((project) => project.clientId === client.id);
      const totals: Kopecks[] = own.map((project) => {
        const estimate = facts.get(project.id);
        if (estimate === undefined) return kopecks(0);
        return clientTotals(estimate.works, basisPoints(estimate.supervisionShare)).total;
      });
      return {
        id: client.id,
        code: client.code,
        name: client.name,
        isCompany: client.isCompany,
        requisites: client.requisites,
        projects: own.length,
        estimateTotal: sum(totals).toString(),
      };
    });
  }

  /** Карточка организации. Читают все роли: часовой пояс нужен и прорабу. */
  async organization(user: RequestUser): Promise<Organization> {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: user.orgId },
    });
    return {
      id: organization.id,
      name: organization.name,
      timeZone: organization.timeZone,
      currency: "RUB",
      phone: organization.phone,
      email: organization.email,
      logoKey: organization.logoKey,
    };
  }

  /**
   * Правка карточки. Пустая строка в необязательном поле означает «стереть»
   * и приводится к null: иначе в базе останется пустая строка, которую
   * интерфейс покажет как заполненное поле.
   */
  async updateOrganization(user: RequestUser, patch: UpdateOrganization): Promise<Organization> {
    const blank = (value: string | null | undefined): string | null | undefined =>
      value === undefined ? undefined : value === null || value.trim() === "" ? null : value.trim();

    // Контактный номер приводится к тому же хранимому виду, что и номер
    // входа, но городской код здесь допустим: телефон студии печатается
    // на счёте, а входить по нему никто не будет.
    const phone = blank(patch.phone);
    let storedPhone: string | null | undefined = phone;
    if (typeof phone === "string") {
      const parsed = parseContactPhone(phone);
      if (!parsed.ok) throw new BadRequestException({ message: parsed.message });
      storedPhone = parsed.value;
    }

    await this.prisma.organization.update({
      where: { id: user.orgId },
      data: {
        ...(patch.name === undefined ? {} : { name: patch.name.trim() }),
        ...(patch.timeZone === undefined ? {} : { timeZone: patch.timeZone }),
        ...(storedPhone === undefined ? {} : { phone: storedPhone }),
        ...(blank(patch.email) === undefined ? {} : { email: blank(patch.email) }),
      },
    });
    return this.organization(user);
  }

  /**
   * Справочник единиц измерения с написаниями, которые импорт приводит сам.
   * Показывается на вкладке «Смета» в настройках: сметчик должен видеть,
   * что справочник умеет, до того как получит отчёт о расхождениях.
   */
  async units(user: RequestUser): Promise<Unit[]> {
    const stored = await this.prisma.unit.findMany({
      where: { orgId: user.orgId },
      select: { id: true, code: true },
    });
    const aliases = unitAliases();
    const byCode = new Map(stored.map((unit) => [unit.code, unit.id]));

    return [...aliases].map(([code, spellings]) => ({
      // Единица, ещё не встречавшаяся в сметах, в таблице отсутствует:
      // справочник от этого не перестаёт её знать.
      id: byCode.get(code) ?? EMPTY_ID,
      name: code,
      aliases: [...spellings],
    }));
  }

  /**
   * Заведение заказчика. Код короткий и обиходный — «300», «118»: им
   * заказчика называют в разговоре, и он идёт в тему письма вместе с кодом
   * объекта. Двух заказчиков с одним кодом быть не может по той же
   * причине, по какой не может быть двух объектов с кодом R-99.
   */
  async createClient(user: RequestUser, input: CreateClient): Promise<ClientRow[]> {
    const занят = await this.prisma.client.findUnique({
      where: { orgId_code: { orgId: user.orgId, code: input.code } },
      select: { id: true },
    });
    if (занят) {
      throw new BadRequestException({ message: `Заказчик с кодом ${input.code} уже заведён.` });
    }
    await this.prisma.client.create({
      data: {
        orgId: user.orgId,
        code: input.code,
        name: input.name,
        isCompany: input.isCompany,
        requisites: input.requisites,
      },
    });
    return this.clients(user);
  }

  /**
   * Заведение бригады или мастера. Ставка здесь не спрашивается:
   * начисление всегда идёт по ставке позиции сметы, а не по ставке
   * работника, и поле, которое ни на что не влияет, вводить незачем.
   */
  async createWorker(user: RequestUser, input: CreateWorker): Promise<WorkerRow[]> {
    const занят = await this.prisma.worker.findUnique({
      where: { orgId_name: { orgId: user.orgId, name: input.name } },
      select: { id: true },
    });
    if (занят) {
      throw new BadRequestException({ message: `«${input.name}» уже есть в справочнике.` });
    }
    await this.prisma.worker.create({
      data: { orgId: user.orgId, name: input.name, kind: input.kind },
    });
    return this.workers(user);
  }

  /**
   * Расчётные единицы сдельной оплаты со сводом по рабочему.
   *
   * Свод по объекту сделан вкладкой приёмки; здесь — вторая половина пункта
   * 4 объёма: сколько начислено бригаде по всем объектам организации.
   * Величина внутренняя и уходит только руководителю — тем же правилом, что
   * ставка и прибыль в смете: прорабу её нет в ответе вовсе, а не нулём.
   *
   * Прорабу выборка не делается совсем: запрос ради полей, которые всё
   * равно не уйдут, — это плата за ничто.
   */
  async workers(user: RequestUser): Promise<WorkerRow[]> {
    const workers = await this.prisma.worker.findMany({
      where: { orgId: user.orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, kind: true },
    });
    if (user.role !== "OWNER") {
      return workers.map((worker) => ({ id: worker.id, name: worker.name, kind: worker.kind }));
    }

    const начисления = await this.prisma.wageAccrual.findMany({
      where: { brigade: { orgId: user.orgId } },
      select: {
        brigadeId: true,
        amount: true,
        createdAt: true,
        brigade: { select: { name: true } },
        acceptance: { select: { batch: { select: { projectId: true } } } },
      },
    });

    /* Свод сумм — правилом домена, а не местным циклом: сторно приходит
       отрицательной суммой, и пара «приёмка + сторно» обязана складываться
       в ноль тем же кодом, которым она складывается на вкладке приёмки. */
    const записи: AccrualRecord[] = начисления.map((row) => ({
      brigadeId: row.brigadeId,
      brigadeName: row.brigade.name,
      amount: kopecks(row.amount),
      at: row.createdAt.toISOString().slice(0, 10),
    }));
    const суммы = new Map(accrualSummary(записи).map((row) => [row.brigadeId, row.amount]));

    const объекты = new Map<string, Set<string>>();
    for (const row of начисления) {
      const набор = объекты.get(row.brigadeId) ?? new Set<string>();
      набор.add(row.acceptance.batch.projectId);
      объекты.set(row.brigadeId, набор);
    }

    return workers.map((worker) => ({
      id: worker.id,
      name: worker.name,
      kind: worker.kind,
      /* Ноль, а не отсутствие: бригада заведена в справочнике, и ноль здесь
         есть сведение — «работы не сдавала», а не «величины нет». */
      projects: объекты.get(worker.id)?.size ?? 0,
      wageTotal: (суммы.get(worker.id) ?? 0n).toString(),
    }));
  }
}
