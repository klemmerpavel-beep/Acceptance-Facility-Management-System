import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  ConvertLead, CreateLead, CreateLeadTask, LeadBoard, LeadCard, LeadStage,
  LoseLead, ProjectEvent, UpdateLead, UpdateLeadTask,
} from "@priyomka/contracts";
import {
  basisPoints, formatKopecks, guidelineRange, kopecks, looksLikeCompany, milliunits, taskState,
} from "@priyomka/domain";
import { PrismaService } from "../prisma.service";
import { AuditService } from "../common/audit.service";
import type { RequestUser } from "../common/current-user";

/**
 * Заявки: воронка и ориентир цены (стадия F).
 *
 * Раздел ведёт руководитель. Прорабу маршруты закрыты ролью целиком — не
 * пустым списком: пустая доска сообщала бы «заявок нет» вместо «это не ваш
 * раздел», а прораб заявок не касается вовсе.
 *
 * Ориентир хранится снимком тарифа и отклонения на момент расчёта, по тому
 * же правилу, по которому приёмка хранит снимок ставки (БП-03): правка
 * справочника не вправе задним числом изменить цену, названную заказчику
 * по телефону.
 */
@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Подписи стадий. Живут на сервере: их же читает лента событий. */
  private static readonly STAGES: readonly { stage: LeadStage; label: string }[] = [
    { stage: "FIRST_CONTACT", label: "Первичный контакт" },
    { stage: "MEETING", label: "Знакомство" },
    { stage: "DECIDING", label: "Принимают решение" },
    { stage: "CONTRACT", label: "Согласование договора" },
  ];

  private static readonly STAGE_LABEL: Record<LeadStage, string> = {
    FIRST_CONTACT: "Первичный контакт",
    MEETING: "Знакомство",
    DECIDING: "Принимают решение",
    CONTRACT: "Согласование договора",
  };

  private static readonly SELECT = {
    id: true, number: true, name: true, phone: true, address: true, note: true,
    stage: true, outcome: true, lostReason: true, createdAt: true,
    repairTypeId: true, area: true, rateSnapshot: true, spreadSnapshot: true,
    repairType: { select: { name: true } },
    project: { select: { code: true } },
    tasks: {
      select: { id: true, title: true, dueOn: true, doneAt: true },
      orderBy: { dueOn: "asc" },
    },
  } as const;

  /**
   * Доска воронки.
   *
   * Колонки отдаются всегда все четыре, даже пустые: колонка, исчезающая
   * вместе с последней заявкой, ломает картину воронки — человек перестаёт
   * видеть стадию, на которой у него ничего нет.
   */
  async board(user: RequestUser, openOnly: boolean): Promise<LeadBoard> {
    const все = await this.prisma.lead.findMany({
      where: { orgId: user.orgId },
      orderBy: { createdAt: "desc" },
      select: LeadsService.SELECT,
    });
    const сегодня = new Date().toISOString().slice(0, 10);
    const карточки = все.map((lead) => LeadsService.card(lead, сегодня));
    const видимые = openOnly ? карточки.filter((lead) => lead.outcome === "OPEN") : карточки;

    return {
      columns: LeadsService.STAGES.map(({ stage, label }) => ({
        stage,
        label,
        leads: видимые.filter((lead) => lead.stage === stage),
      })),
      totals: {
        open: карточки.filter((lead) => lead.outcome === "OPEN").length,
        won: карточки.filter((lead) => lead.outcome === "WON").length,
        lost: карточки.filter((lead) => lead.outcome === "LOST").length,
      },
    };
  }

  async create(user: RequestUser, input: CreateLead): Promise<LeadCard> {
    const lead = await this.withNumber(user.orgId, (number) => this.prisma.lead.create({
      data: {
        orgId: user.orgId,
        number,
        name: input.name,
        phone: input.phone,
        address: input.address ?? null,
        note: input.note ?? null,
      },
      select: LeadsService.SELECT,
    }));

    await this.audit.record({
      orgId: user.orgId,
      actorId: user.id,
      entity: "Lead",
      entityId: lead.id,
      field: "заявка заведена",
      oldValue: null,
      newValue: `№ ${lead.number}, ${lead.name}`,
    });
    return LeadsService.card(lead, new Date().toISOString().slice(0, 10));
  }

  /**
   * Номер выводится сервером из уже заведённых — два открытых окна иначе
   * завели бы заявку с одним номером. Уникальный ключ (orgId, number) —
   * последняя линия обороны, а не надежда на отсутствие гонки: на отказ
   * ключа попытка повторяется с пересчитанным номером.
   */
  private async withNumber<T>(orgId: string, create: (number: number) => Promise<T>): Promise<T> {
    for (let попытка = 0; попытка < 3; попытка += 1) {
      const последний = await this.prisma.lead.aggregate({
        where: { orgId },
        _max: { number: true },
      });
      try {
        return await create((последний._max.number ?? 1000) + 1);
      } catch (cause: unknown) {
        const код = (cause as { code?: string }).code;
        if (код !== "P2002" || попытка === 2) throw cause;
      }
    }
    throw new BadRequestException({ message: "Не удалось присвоить номер заявке. Повторите." });
  }

  async update(user: RequestUser, id: string, input: UpdateLead): Promise<LeadCard> {
    const lead = await this.own(user, id);
    if (lead.outcome !== "OPEN") {
      throw new BadRequestException({
        message: lead.outcome === "WON"
          ? `Заявка № ${lead.number} уже превращена в объект: править её нечего.`
          : `Заявка № ${lead.number} закрыта отказом: история не переписывается.`,
      });
    }

    /* Ориентир пересчитывается только когда пришли тип или площадь, и
       снимок тарифа берётся в этот момент. Правка имени или примечания
       вилку не трогает: она не от них считается. */
    const трогаютОриентир = input.repairTypeId !== undefined || input.area !== undefined;
    const typeId = input.repairTypeId === undefined ? lead.repairTypeId : input.repairTypeId;
    const area = input.area === undefined
      ? lead.area
      : input.area === null ? null : BigInt(input.area);

    let снимок: { rateSnapshot: bigint | null; spreadSnapshot: number | null } = {
      rateSnapshot: lead.rateSnapshot,
      spreadSnapshot: lead.spreadSnapshot,
    };
    if (трогаютОриентир) {
      if (typeId === null || area === null) {
        снимок = { rateSnapshot: null, spreadSnapshot: null };
      } else {
        const тип = await this.prisma.repairType.findFirst({
          where: { orgId: user.orgId, id: typeId },
          select: { ratePerSqm: true, spread: true },
        });
        if (тип === null) {
          throw new BadRequestException({ message: "Тип ремонта не найден в справочнике." });
        }
        снимок = { rateSnapshot: тип.ratePerSqm, spreadSnapshot: тип.spread };
      }
    }

    const обновлённая = await this.prisma.lead.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.phone === undefined ? {} : { phone: input.phone }),
        ...(input.address === undefined ? {} : { address: input.address }),
        ...(input.note === undefined ? {} : { note: input.note }),
        ...(input.stage === undefined ? {} : { stage: input.stage }),
        ...(трогаютОриентир ? { repairTypeId: typeId, area, ...снимок } : {}),
      },
      select: LeadsService.SELECT,
    });

    if (input.stage !== undefined && input.stage !== lead.stage) {
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "Lead",
        entityId: id,
        field: "стадия",
        oldValue: LeadsService.STAGE_LABEL[lead.stage],
        newValue: LeadsService.STAGE_LABEL[input.stage],
      });
    }
    /* Ориентир — денежная величина, и её правка пишется в журнал (БП-10)
       рублями, а не сырыми копейками: журнал читает человек. */
    if (трогаютОриентир) {
      const было = LeadsService.range(lead);
      const стало = LeadsService.range(обновлённая);
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "Lead",
        entityId: id,
        field: "ориентир",
        oldValue: было === null ? null : `${formatKopecks(было.low)} — ${formatKopecks(было.high)}`,
        newValue: стало === null ? null : `${formatKopecks(стало.low)} — ${formatKopecks(стало.high)}`,
      });
    }
    return LeadsService.card(обновлённая, new Date().toISOString().slice(0, 10));
  }

  /**
   * Превращение заявки в заказчика и объект — одним действием, как объявлено
   * картой разделов.
   *
   * Заявка после этого не удаляется и не чистится: история не переписывается
   * (БП-04), а телефон остаётся именно на ней — поля телефона у заказчика в
   * схеме нет.
   */
  async convert(user: RequestUser, id: string, input: ConvertLead): Promise<LeadCard> {
    const lead = await this.own(user, id);
    if (lead.outcome === "WON") {
      throw new BadRequestException({
        message: `Заявка № ${lead.number} уже превращена в объект ${lead.project?.code ?? "—"}.`,
      });
    }
    if (lead.outcome === "LOST") {
      throw new BadRequestException({
        message: `Заявка № ${lead.number} закрыта отказом: превращать нечего.`,
      });
    }

    const код = input.code.trim().toUpperCase();
    const занятКод = await this.prisma.project.findUnique({
      where: { orgId_code: { orgId: user.orgId, code: код } },
      select: { id: true },
    });
    if (занятКод !== null) {
      throw new BadRequestException({ message: `Объект с кодом ${код} уже заведён.` });
    }
    const занятЗаказчик = await this.prisma.client.findUnique({
      where: { orgId_code: { orgId: user.orgId, code: input.clientCode.trim() } },
      select: { id: true },
    });
    if (занятЗаказчик !== null) {
      throw new BadRequestException({
        message: `Заказчик с кодом ${input.clientCode.trim()} уже есть в справочнике.`,
      });
    }

    const обновлённая = await this.prisma.$transaction(async (tx) => {
      const client = await tx.client.create({
        data: {
          orgId: user.orgId,
          code: input.clientCode.trim(),
          name: lead.name,
          isCompany: looksLikeCompany(lead.name),
        },
        select: { id: true },
      });
      const project = await tx.project.create({
        data: {
          orgId: user.orgId,
          code: код,
          address: input.address.trim(),
          clientId: client.id,
          status: "NEW",
        },
        select: { id: true },
      });
      return tx.lead.update({
        where: { id },
        data: { outcome: "WON", stage: "CONTRACT", clientId: client.id, projectId: project.id },
        select: LeadsService.SELECT,
      });
    });

    await this.audit.record({
      orgId: user.orgId,
      actorId: user.id,
      entity: "Lead",
      entityId: id,
      field: "превращена в объект",
      oldValue: null,
      newValue: `${код}, заказчик ${lead.name}`,
    });
    return LeadsService.card(обновлённая, new Date().toISOString().slice(0, 10));
  }

  /** Отказ. Причина обязательна: отказ без причины ничему не учит. */
  async lose(user: RequestUser, id: string, input: LoseLead): Promise<LeadCard> {
    const lead = await this.own(user, id);
    if (lead.outcome !== "OPEN") {
      throw new BadRequestException({
        message: `Заявка № ${lead.number} уже закрыта: ${lead.outcome === "WON" ? "превращена в объект" : "отказ"}.`,
      });
    }
    const обновлённая = await this.prisma.lead.update({
      where: { id },
      data: { outcome: "LOST", lostReason: input.reason },
      select: LeadsService.SELECT,
    });
    await this.audit.record({
      orgId: user.orgId,
      actorId: user.id,
      entity: "Lead",
      entityId: id,
      field: "отказ",
      oldValue: null,
      newValue: input.reason,
    });
    return LeadsService.card(обновлённая, new Date().toISOString().slice(0, 10));
  }

  async addTask(user: RequestUser, id: string, input: CreateLeadTask): Promise<LeadCard> {
    const lead = await this.own(user, id);
    await this.prisma.leadTask.create({
      data: { orgId: user.orgId, leadId: lead.id, title: input.title, dueOn: new Date(input.dueOn) },
    });
    return this.card(user, id);
  }

  async setTask(
    user: RequestUser,
    id: string,
    taskId: string,
    input: UpdateLeadTask,
  ): Promise<LeadCard> {
    const lead = await this.own(user, id);
    const задача = await this.prisma.leadTask.findFirst({
      where: { id: taskId, leadId: lead.id, orgId: user.orgId },
      select: { id: true },
    });
    if (задача === null) throw new NotFoundException({ message: "Задача не найдена." });
    await this.prisma.leadTask.update({
      where: { id: taskId },
      data: { doneAt: input.done ? new Date() : null },
    });
    return this.card(user, id);
  }

  /**
   * Журнал заявки.
   *
   * Записи в него пишутся с первого дня, но читать их было негде — ровно
   * тот же дефект, что был у журнала объекта: запись, которую нельзя
   * прочитать, спора не решает, ради которого журнал и заводился.
   *
   * Порядок обратный: последнее событие сверху, как в ленте объекта.
   */
  async events(user: RequestUser, id: string, limit = 20): Promise<ProjectEvent[]> {
    const lead = await this.own(user, id);
    const записи = await this.prisma.auditLog.findMany({
      where: { orgId: user.orgId, entity: "Lead", entityId: lead.id },
      orderBy: { at: "desc" },
      take: limit,
      select: {
        at: true, field: true, oldValue: true, newValue: true,
        actor: { select: { name: true } },
      },
    });
    return записи.map((запись) => ({
      at: запись.at.toISOString(),
      kind: "field" as const,
      title: `Заявка: ${запись.field}`,
      /* Стрелка ставится только там, где есть обе стороны: у заведения и
         превращения прежнего значения нет, и «— → R-42» читалось бы как
         потеря величины. */
      detail: запись.oldValue === null
        ? запись.newValue
        : `${запись.oldValue} → ${запись.newValue ?? "—"}`,
      projectCode: lead.project?.code ?? null,
      actor: запись.actor?.name ?? null,
    }));
  }

  private async card(user: RequestUser, id: string): Promise<LeadCard> {
    const lead = await this.own(user, id);
    return LeadsService.card(lead, new Date().toISOString().slice(0, 10));
  }

  private async own(user: RequestUser, id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, orgId: user.orgId },
      select: LeadsService.SELECT,
    });
    if (lead === null) throw new NotFoundException({ message: "Заявка не найдена." });
    return lead;
  }

  /** Вилка из снимка, а не из действующего тарифа. */
  private static range(lead: {
    area: bigint | null;
    rateSnapshot: bigint | null;
    spreadSnapshot: number | null;
  }): { low: bigint; high: bigint } | null {
    if (lead.area === null || lead.rateSnapshot === null || lead.spreadSnapshot === null) {
      return null;
    }
    return guidelineRange(
      milliunits(lead.area),
      kopecks(lead.rateSnapshot),
      basisPoints(lead.spreadSnapshot),
    );
  }

  private static card(lead: {
    id: string; number: number; name: string; phone: string;
    address: string | null; note: string | null;
    stage: LeadStage; outcome: "OPEN" | "WON" | "LOST"; lostReason: string | null;
    createdAt: Date; repairTypeId: string | null;
    area: bigint | null; rateSnapshot: bigint | null; spreadSnapshot: number | null;
    repairType: { name: string } | null;
    project: { code: string } | null;
    tasks: { id: string; title: string; dueOn: Date; doneAt: Date | null }[];
  }, today: string): LeadCard {
    const вилка = LeadsService.range(lead);
    return {
      id: lead.id,
      number: lead.number,
      name: lead.name,
      phone: lead.phone,
      address: lead.address,
      note: lead.note,
      stage: lead.stage,
      outcome: lead.outcome,
      lostReason: lead.lostReason,
      createdAt: lead.createdAt.toISOString(),
      repairTypeId: lead.repairTypeId,
      guideline: вилка === null ? null : {
        low: вилка.low.toString(),
        high: вилка.high.toString(),
        typeName: lead.repairType?.name ?? "тип удалён из справочника",
        area: (lead.area ?? 0n).toString(),
        rate: (lead.rateSnapshot ?? 0n).toString(),
        spread: lead.spreadSnapshot ?? 0,
      },
      tasks: lead.tasks.map((task) => {
        const срок = task.dueOn.toISOString().slice(0, 10);
        const выполнена = task.doneAt === null ? null : task.doneAt.toISOString().slice(0, 10);
        return {
          id: task.id,
          title: task.title,
          dueOn: срок,
          doneAt: выполнена,
          state: taskState(срок, выполнена, today),
        };
      }),
      projectCode: lead.project?.code ?? null,
    };
  }
}
