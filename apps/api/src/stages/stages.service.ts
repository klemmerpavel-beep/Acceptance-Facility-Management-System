import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateWorkStage, UpdateWorkStage, WorkStage } from "@priyomka/contracts";
import { projectRange, stageDateFault, type ProjectRange } from "@priyomka/domain";
import { PrismaService } from "../prisma.service";
import { AuditService } from "../common/audit.service";
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

const toStage = (row: StageRow): WorkStage => ({
  id: row.id,
  name: row.name,
  order: row.order,
  startsOn: iso(row.startsOn),
  endsOn: iso(row.endsOn),
  progress: row.progress,
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
    return rows.map(toStage);
  }

  async view(user: RequestUser, code: string): Promise<WorkStage[]> {
    const project = await this.projectOf(user, code);
    return this.list(project.id);
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
