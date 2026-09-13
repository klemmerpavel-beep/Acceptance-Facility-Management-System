import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  ClientRow,
  CreateClient,
  Foreman,
  CreateWorker,
  CreateRepairType,
  Organization,
  RepairType,
  Unit,
  UpdateOrganization,
  UpdateRepairType,
  WorkerRow,
} from "@priyomka/contracts";
import { nextClientCode, parseContactPhone } from "@priyomka/domain";
import { unitAliases } from "@priyomka/importer";
import {
  accrualSummary, basisPoints, clientTotals, formatKopecks, formatPercent, kopecks, sum,
  type AccrualRecord, type Kopecks,
} from "@priyomka/domain";
import { PrismaService } from "../prisma.service";
import { AuditService } from "../common/audit.service";
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
      requisites: organization.requisites,
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
        ...(blank(patch.requisites) === undefined ? {} : { requisites: blank(patch.requisites) }),
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
    /* Код, которого не прислали, назначает сервер. Так заводит заказчика
       форма нового объекта: там человек называет одно имя, и спрашивать
       обиходный код значило бы вернуть его в справочник ровно за тем, ради
       чего заведение сделано попутным. Правило выбора — в домене и испытано
       тестом; здесь только выборка занятых кодов. */
    let код = input.code;
    if (код === undefined) {
      const коды = await this.prisma.client.findMany({
        where: { orgId: user.orgId },
        select: { code: true },
      });
      код = nextClientCode(коды.map((строка) => строка.code));
    }

    const занят = await this.prisma.client.findUnique({
      where: { orgId_code: { orgId: user.orgId, code: код } },
      select: { id: true },
    });
    if (занят) {
      throw new BadRequestException({ message: `Заказчик с кодом ${код} уже заведён.` });
    }
    await this.prisma.client.create({
      data: {
        orgId: user.orgId,
        code: код,
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
  /**
   * Прорабы организации: те, кого можно назначить на объект.
   *
   * Отдельно от `workers`: там бригады и мастера — сдельные исполнители,
   * которым начисляют за принятую работу. Прораб — пользователь продукта, он
   * ведёт объект и заводит приёмку. Свести их в один список значило бы
   * предложить назначить прорабом бригаду.
   *
   * Внутренних полей нет вовсе: имя и опознаватель — всё, что нужно, чтобы
   * выбрать из списка. Телефон и почта прораба к назначению отношения не
   * имеют и потому не выдаются.
   */
  async foremen(user: RequestUser): Promise<Foreman[]> {
    return this.prisma.user.findMany({
      where: { orgId: user.orgId, role: "FOREMAN" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  }

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

  /**
   * Типы ремонта с тарифом за квадратный метр.
   *
   * Справочник правится на экране, а не зашит в код: цены меняются чаще,
   * чем выходят редакции продукта (решение заказчика от 11.09.2026).
   * Число заявок при строке нужно экрану, чтобы не предлагать удаление
   * типа, по которому уже назван ориентир.
   */
  async repairTypes(user: RequestUser): Promise<RepairType[]> {
    const строки = await this.prisma.repairType.findMany({
      where: { orgId: user.orgId },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: {
        id: true, name: true, ratePerSqm: true, spread: true, order: true,
        _count: { select: { leads: true } },
      },
    });
    return строки.map((тип) => ({
      id: тип.id,
      name: тип.name,
      ratePerSqm: тип.ratePerSqm.toString(),
      spread: тип.spread,
      order: тип.order,
      leads: тип._count.leads,
    }));
  }

  async createRepairType(user: RequestUser, input: CreateRepairType): Promise<RepairType[]> {
    const занято = await this.prisma.repairType.findUnique({
      where: { orgId_name: { orgId: user.orgId, name: input.name } },
      select: { id: true },
    });
    if (занято !== null) {
      throw new BadRequestException({ message: `Тип «${input.name}» уже есть в справочнике.` });
    }
    const последний = await this.prisma.repairType.aggregate({
      where: { orgId: user.orgId },
      _max: { order: true },
    });
    const тип = await this.prisma.repairType.create({
      data: {
        orgId: user.orgId,
        name: input.name,
        ratePerSqm: BigInt(input.ratePerSqm),
        spread: input.spread,
        order: (последний._max.order ?? -1) + 1,
      },
      select: { id: true },
    });
    await this.audit.record({
      orgId: user.orgId,
      actorId: user.id,
      entity: "RepairType",
      entityId: тип.id,
      field: "тариф за квадратный метр",
      oldValue: null,
      newValue: `${input.name}: ${formatKopecks(kopecks(input.ratePerSqm))} ± ${formatPercent(BigInt(input.spread))}`,
    });
    return this.repairTypes(user);
  }

  /**
   * Правка тарифа. Заявки, посчитанные по нему раньше, не меняются: они
   * хранят снимок (БП-03), и в этом весь смысл снимка.
   */
  async updateRepairType(
    user: RequestUser,
    id: string,
    input: UpdateRepairType,
  ): Promise<RepairType[]> {
    const было = await this.prisma.repairType.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true, name: true, ratePerSqm: true, spread: true },
    });
    if (было === null) throw new NotFoundException({ message: "Тип ремонта не найден." });

    await this.prisma.repairType.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.ratePerSqm === undefined ? {} : { ratePerSqm: BigInt(input.ratePerSqm) }),
        ...(input.spread === undefined ? {} : { spread: input.spread }),
      },
    });
    if (input.ratePerSqm !== undefined && BigInt(input.ratePerSqm) !== было.ratePerSqm) {
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "RepairType",
        entityId: id,
        field: "тариф за квадратный метр",
        oldValue: formatKopecks(kopecks(было.ratePerSqm)),
        newValue: formatKopecks(kopecks(input.ratePerSqm)),
      });
    }
    return this.repairTypes(user);
  }
}
