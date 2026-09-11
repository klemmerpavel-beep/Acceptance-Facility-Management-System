import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateWorkStage, UpdateWorkStage, WorkStage } from "@priyomka/contracts";
import {
  acceptedQty, acceptedShare, acceptedTotal, kopecks, milliunits,
  projectRange, stageDateFault, type ProjectRange,
} from "@priyomka/domain";
import { PrismaService } from "../prisma.service";
import { AuditService } from "../common/audit.service";
import { currentEstimate } from "../common/current-estimate";
import { topLevelSections } from "../common/section-rollup";
import type { RequestUser } from "../common/current-user";
import { projectScope } from "../common/project-scope";

/**
 * График производства работ объекта.
 *
 * Каждый пишущий вызов возвращает список этапов целиком, а не одну
 * изменённую строку. Причина та же, что у обмера: экран показывает номера
 * и порядок, и после перестановки половина строк меняется. Собирать новое
 * состояние на клиенте из частичного ответа значит завести вторую копию
 * правил сортировки.
 */

interface StageRow {
  id: string;
  name: string;
  order: number;
  startsOn: Date;
  endsOn: Date;
  progress: number;
  sectionId: string | null;
  brigade: { id: string; name: string } | null;
}

const iso = (date: Date): string => date.toISOString().slice(0, 10);

const toStage = (row: StageRow, actual: number | null): WorkStage => ({
  id: row.id,
  name: row.name,
  order: row.order,
  startsOn: iso(row.startsOn),
  endsOn: iso(row.endsOn),
  progress: row.progress,
  actualProgress: actual,
  sectionId: row.sectionId,
  brigade: row.brigade,
});

@Injectable()
export class StagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Видимость объекта берётся из общего правила: своего здесь нет. */
  private async projectOf(user: RequestUser, code: string) {
    const project = await this.prisma.project.findFirst({
      where: { ...projectScope(user), code },
      select: { id: true, code: true, startedAt: true, deadline: true, createdAt: true },
    });
    if (!project) {
      throw new NotFoundException({ message: `Объект ${code} не найден или недоступен.` });
    }
    return project;
  }

  /** Сроки объекта берутся общим правилом домена: своего здесь нет. */
  private static range(project: {
    startedAt: Date | null;
    deadline: Date | null;
    createdAt: Date;
  }): ProjectRange {
    return projectRange({
      startedAt: project.startedAt === null ? null : iso(project.startedAt),
      deadline: project.deadline === null ? null : iso(project.deadline),
      createdAt: iso(project.createdAt),
    });
  }

  private async list(projectId: string): Promise<WorkStage[]> {
    const rows = await this.prisma.workStage.findMany({
      where: { projectId },
      orderBy: { order: "asc" },
      include: { brigade: { select: { id: true, name: true } } },
    });
    const фактическая = await this.actualProgress(projectId);
    return rows.map((row) => toStage(row, фактическая.get(row.sectionId ?? "") ?? null));
  }

  /**
   * Фактическая готовность разделов — доля принятого в итоге раздела.
   *
   * Заявленную ставит человек, эта считается по приёмке. Обе живут рядом:
   * заявленная законно опережает приёмку (материал закуплен, работа идёт,
   * пакет ещё не собран), и подменять одну другой значило бы стереть то,
   * ради чего человек её ставит. Расхождение и есть содержание.
   *
   * Считается по действующей редакции сметы — тем же правилом, что приёмка
   * (Р11). Иначе вкладка «Работа» и вкладка «Приёмка» разошлись бы на
   * первом же импорте.
   *
   * Пустая карта, когда сметы нет: этапу тогда неоткуда взять величину, и
   * экран покажет прочерк, а не ноль. Ноль означает «ничего не принято».
   */
  private async actualProgress(projectId: string): Promise<Map<string, number>> {
    const estimate = await currentEstimate(this.prisma, projectId);
    if (estimate === null) return new Map();

    const [items, acceptances, верхний] = await Promise.all([
      this.prisma.estimateItem.findMany({
        where: { estimateId: estimate.id },
        select: { id: true, sectionId: true, qty: true, unitPrice: true },
      }),
      /* Приёмки только по позициям действующей редакции: прежние относятся
         к позициям, которых в смете уже нет (Р11). */
      this.prisma.acceptance.findMany({
        where: { batch: { projectId }, item: { estimateId: estimate.id } },
        select: { itemId: true, qty: true },
      }),
      topLevelSections(this.prisma, estimate.id),
    ]);

    const принятоПоПозиции = new Map<string, bigint>();
    for (const record of acceptances) {
      принятоПоПозиции.set(
        record.itemId,
        (принятоПоПозиции.get(record.itemId) ?? 0n) + record.qty,
      );
    }

    const итог = new Map<string, { всего: bigint; принято: bigint }>();
    for (const item of items) {
      const ключ = верхний.get(item.sectionId) ?? item.sectionId;
      const свод = итог.get(ключ) ?? { всего: 0n, принято: 0n };
      const цена = kopecks(item.unitPrice);
      свод.всего += acceptedTotal([{ qty: milliunits(item.qty), unitPrice: цена }]);
      свод.принято += acceptedTotal([{
        qty: acceptedQty([{ qty: milliunits(принятоПоПозиции.get(item.id) ?? 0n) }]),
        unitPrice: цена,
      }]);
      итог.set(ключ, свод);
    }

    const доли = new Map<string, number>();
    for (const [sectionId, свод] of итог) {
      const доля = acceptedShare(kopecks(свод.принято), kopecks(свод.всего));
      if (доля !== null) доли.set(sectionId, Number(доля));
    }
    return доли;
  }

  async view(user: RequestUser, code: string): Promise<WorkStage[]> {
    const project = await this.projectOf(user, code);
    return this.list(project.id);
  }

  /**
   * Проверка связей этапа: раздел сметы и бригада.
   *
   * До этой правки оба опознавателя уходили в базу как есть, и три
   * обращения давали 500 «Internal server error»: раздел, который уже
   * ведёт другой этап (нарушение `@@unique([sectionId])`), несуществующий
   * раздел и несуществующая бригада (нарушение внешнего ключа). Человек
   * получал отказ сервера там, где ошибся во вводе.
   *
   * Раздел ищется в **действующей** редакции сметы, а не среди всех
   * разделов объекта. Приёмка привязывает пакет к разделу действующей
   * редакции (Р11) и ищет этап по этому разделу; этап, оставшийся на
   * разделе прежней редакции, при приёмке найден не был бы, и начисление
   * ушло бы в никуда молча. Это тот же класс расхождения, что закрыт
   * стадией D.
   *
   * Бригада проверяется на принадлежность организации, но не на вид:
   * получателем начисления бывает и мастер-одиночка, а `WageAccrual`
   * ссылается на `Worker` без различения вида.
   *
   * `null` разрешён обоими полями и означает снятие связи: этап без
   * раздела законен — график заводят раньше сметы.
   */
  private async checkBindings(
    orgId: string,
    projectId: string,
    input: { sectionId?: string | null; brigadeId?: string | null },
    stageId: string | null,
  ): Promise<void> {
    if (typeof input.sectionId === "string") {
      const estimate = await currentEstimate(this.prisma, projectId);
      if (estimate === null) {
        throw new BadRequestException({
          message: "У объекта нет сметы: связывать этап не с чем. "
            + "Импортируйте смету на вкладке «Импорт».",
        });
      }

      const section = await this.prisma.estimateSection.findFirst({
        where: { id: input.sectionId, estimateId: estimate.id },
        select: { id: true, name: true, parentId: true },
      });
      if (section === null) {
        throw new NotFoundException({
          message: "Раздел не найден в действующей смете объекта.",
        });
      }

      /* Только раздел верхнего уровня. Приёмка складывает позиции вложенных
         разделов в родительский и ищет этап по опознавателю верхнего:
         этап, привязанный к вложенному, приёмке не виден вовсе, и начислять
         по нему некому. Связь была бы, а работать бы не работала. */
      if (section.parentId !== null) {
        throw new BadRequestException({
          message: `«${section.name}» — вложенный раздел. Этап ведёт раздел верхнего `
            + "уровня: приёмка принимает вложенные разделы вместе с родительским.",
        });
      }

      const занят = await this.prisma.workStage.findFirst({
        where: {
          projectId,
          sectionId: section.id,
          ...(stageId === null ? {} : { NOT: { id: stageId } }),
        },
        select: { name: true },
      });
      if (занят !== null) {
        throw new BadRequestException({
          message: `Раздел «${section.name}» уже ведёт этап «${занят.name}». `
            + "Раздел ведёт один этап: иначе приёмка не знала бы, чьей бригаде начислять.",
        });
      }
    }

    if (typeof input.brigadeId === "string") {
      const бригада = await this.prisma.worker.findFirst({
        where: { id: input.brigadeId, orgId },
        select: { id: true },
      });
      if (бригада === null) {
        throw new NotFoundException({
          message: "Бригада не найдена в справочнике организации.",
        });
      }
    }
  }

  /** Имя раздела для журнала: `null` означает «связи не было». */
  private async sectionName(id: string | null): Promise<string | null> {
    if (id === null) return null;
    const section = await this.prisma.estimateSection.findUnique({
      where: { id },
      select: { name: true },
    });
    return section?.name ?? null;
  }

  /** Имя бригады для журнала: `null` означает «получателя не было». */
  private async brigadeName(id: string | null): Promise<string | null> {
    if (id === null) return null;
    const worker = await this.prisma.worker.findUnique({
      where: { id },
      select: { name: true },
    });
    return worker?.name ?? null;
  }

  async create(user: RequestUser, code: string, input: CreateWorkStage): Promise<WorkStage[]> {
    const project = await this.projectOf(user, code);
    const fault = stageDateFault(input, StagesService.range(project));
    if (fault !== null) throw new BadRequestException({ message: fault });

    const занято = await this.prisma.workStage.findUnique({
      where: { projectId_name: { projectId: project.id, name: input.name } },
      select: { id: true },
    });
    if (занято) {
      throw new BadRequestException({
        message: `Этап «${input.name}» на объекте уже есть. Название этапа — его опознавательный знак в графике и в акте.`,
      });
    }

    await this.checkBindings(user.orgId, project.id, input, null);

    /* Новый этап встаёт в конец: место в графике определяет человек
       перестановкой, а не порядок заведения. */
    const последний = await this.prisma.workStage.aggregate({
      where: { projectId: project.id },
      _max: { order: true },
    });

    const stage = await this.prisma.workStage.create({
      data: {
        projectId: project.id,
        name: input.name,
        order: (последний._max.order ?? -1) + 1,
        startsOn: new Date(input.startsOn),
        endsOn: new Date(input.endsOn),
        progress: input.progress,
        ...(input.sectionId === undefined ? {} : { sectionId: input.sectionId }),
        ...(input.brigadeId === undefined ? {} : { brigadeId: input.brigadeId }),
      },
      select: { id: true },
    });

    await this.audit.record({
      orgId: user.orgId,
      actorId: user.id,
      entity: "WorkStage",
      entityId: stage.id,
      field: "этап заведён",
      oldValue: null,
      newValue: `${input.name}: ${input.startsOn} — ${input.endsOn}`,
    });

    return this.list(project.id);
  }

  async update(
    user: RequestUser,
    code: string,
    id: string,
    input: UpdateWorkStage,
  ): Promise<WorkStage[]> {
    const project = await this.projectOf(user, code);
    const прежний = await this.prisma.workStage.findFirst({
      where: { id, projectId: project.id },
    });
    if (!прежний) {
      throw new NotFoundException({ message: "Этап не найден на этом объекте." });
    }

    const startsOn = input.startsOn ?? iso(прежний.startsOn);
    const endsOn = input.endsOn ?? iso(прежний.endsOn);
    const fault = stageDateFault({ startsOn, endsOn }, StagesService.range(project));
    if (fault !== null) throw new BadRequestException({ message: fault });

    if (input.name !== undefined && input.name !== прежний.name) {
      const занято = await this.prisma.workStage.findUnique({
        where: { projectId_name: { projectId: project.id, name: input.name } },
        select: { id: true },
      });
      if (занято) {
        throw new BadRequestException({ message: `Этап «${input.name}» на объекте уже есть.` });
      }
    }

    await this.checkBindings(user.orgId, project.id, input, id);

    await this.prisma.workStage.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        startsOn: new Date(startsOn),
        endsOn: new Date(endsOn),
        ...(input.progress === undefined ? {} : { progress: input.progress }),
        ...(input.sectionId === undefined ? {} : { sectionId: input.sectionId }),
        ...(input.brigadeId === undefined ? {} : { brigadeId: input.brigadeId }),
      },
    });

    /* В журнал уходит то, что изменилось, а не всё тело запроса: строка
       «сроки: те же → те же» ничего не сообщает и мешает искать нужное. */
    const было = `${iso(прежний.startsOn)} — ${iso(прежний.endsOn)}`;
    const стало = `${startsOn} — ${endsOn}`;
    if (было !== стало) {
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "WorkStage",
        entityId: id,
        field: `сроки этапа «${input.name ?? прежний.name}»`,
        oldValue: было,
        newValue: стало,
      });
    }
    /* Смена раздела и смена бригады пишутся в журнал наравне со сроками:
       этой парой решается, кому уйдёт сдельная оплата за принятые позиции
       раздела. Записывается имя, а не опознаватель: журнал читает человек. */
    if (input.sectionId !== undefined && input.sectionId !== прежний.sectionId) {
      const [было, стало] = await Promise.all([
        this.sectionName(прежний.sectionId),
        this.sectionName(input.sectionId),
      ]);
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "WorkStage",
        entityId: id,
        field: `раздел сметы у этапа «${input.name ?? прежний.name}»`,
        oldValue: было,
        newValue: стало,
      });
    }
    if (input.brigadeId !== undefined && input.brigadeId !== прежний.brigadeId) {
      const [было, стало] = await Promise.all([
        this.brigadeName(прежний.brigadeId),
        this.brigadeName(input.brigadeId),
      ]);
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "WorkStage",
        entityId: id,
        field: `бригада у этапа «${input.name ?? прежний.name}»`,
        oldValue: было,
        newValue: стало,
      });
    }

    if (input.progress !== undefined && input.progress !== прежний.progress) {
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "WorkStage",
        entityId: id,
        field: `готовность этапа «${input.name ?? прежний.name}»`,
        oldValue: `${String(прежний.progress / 100)} %`,
        newValue: `${String(input.progress / 100)} %`,
      });
    }

    return this.list(project.id);
  }

  async remove(user: RequestUser, code: string, id: string): Promise<WorkStage[]> {
    const project = await this.projectOf(user, code);
    const stage = await this.prisma.workStage.findFirst({ where: { id, projectId: project.id } });
    if (!stage) {
      throw new NotFoundException({ message: "Этап не найден на этом объекте." });
    }

    /* Удаление физическое. Этап — план, а не денежная запись: сторно нужно
       там, где число уже вошло в начисление, а плановый отрезок ничего не
       начисляет. Журнал при этом остаётся. */
    await this.prisma.workStage.delete({ where: { id } });
    await this.audit.record({
      orgId: user.orgId,
      actorId: user.id,
      entity: "WorkStage",
      entityId: id,
      field: "этап снят",
      oldValue: `${stage.name}: ${iso(stage.startsOn)} — ${iso(stage.endsOn)}`,
      newValue: null,
    });

    return this.list(project.id);
  }

  async reorder(user: RequestUser, code: string, ids: string[]): Promise<WorkStage[]> {
    const project = await this.projectOf(user, code);
    const свои = await this.prisma.workStage.findMany({
      where: { projectId: project.id },
      select: { id: true },
    });

    /* Порядок принимается только полный. Частичный оставил бы вопрос, что
       делать с остальными строками, и два одновременных перемещения дали
       бы разный итог в зависимости от того, чьё пришло первым. */
    const набор = new Set(свои.map((row) => row.id));
    const присланные = new Set(ids);
    if (ids.length !== свои.length || присланные.size !== ids.length
        || ids.some((id) => !набор.has(id))) {
      throw new BadRequestException({
        message: "Порядок этапов задаётся полным списком этапов объекта, без повторов.",
      });
    }

    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.workStage.update({ where: { id }, data: { order: index } }),
      ),
    );

    return this.list(project.id);
  }
}
