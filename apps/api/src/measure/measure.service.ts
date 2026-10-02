import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  MeasureRoom, MeasureSetKind, MeasureView, CreateMeasureRoom, UpdateMeasureRoom,
} from "@priyomka/contracts";
import {
  measureTotals, milliunits, roomVolume, wallArea, количествоТекстом, type RoomMeasure,
  сколько,
} from "@priyomka/domain";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { AuditService } from "../common/audit.service";
import { FileStorage } from "../common/file-storage";
import { безМетаданных } from "../common/clean-image";
import type { RequestUser } from "../common/current-user";
import { projectScope } from "../common/project-scope";
import { detectImageType, ALLOWED_IMAGE_TYPES, IMAGE_EXTENSION } from "./image-type";

/**
 * Обмерный план объекта.
 *
 * Производные величины — площадь стен и объём — в базе не лежат: они
 * выводятся доменом при каждой сборке ответа. Так экран, печатная форма и
 * будущий перенос площадей в смету получают одно и то же число.
 */

/** Подписи полей для журнала: «floorArea» на экране прораба недопустимо. */
const FIELD_LABEL: Readonly<Record<string, string>> = {
  name: "название",
  floorArea: "площадь пола",
  floorPerimeter: "периметр пола",
  ceilingPerimeter: "периметр потолка",
  height: "высота",
  openings: "проёмы",
};

/** Величины, правка которых пишется в журнал по отдельности. */
const MEASURED = ["floorArea", "floorPerimeter", "ceilingPerimeter", "height"] as const;

/** Единица величины обмера в записи журнала. */
const ЕДИНИЦА: Readonly<Record<(typeof MEASURED)[number], string>> = {
  floorArea: "м²",
  floorPerimeter: "м.п.",
  ceilingPerimeter: "м.п.",
  height: "м",
};

interface RoomRow {
  id: string;
  name: string;
  order: number;
  floorArea: bigint;
  floorPerimeter: bigint;
  ceilingPerimeter: bigint;
  height: bigint;
  openings: { kind: "WINDOW" | "DOOR"; count: number; area: bigint; reveal: bigint }[];
}

const asMeasure = (row: RoomRow): RoomMeasure => ({
  floorArea: milliunits(row.floorArea),
  floorPerimeter: milliunits(row.floorPerimeter),
  ceilingPerimeter: milliunits(row.ceilingPerimeter),
  height: milliunits(row.height),
  /* Проёмы входят в итоги объекта (план, пункт 7.4): «Общее» называет окна и
     двери так же, как площади. Площадь стен их по-прежнему не вычитает. */
  openings: row.openings.map((opening) => ({
    kind: opening.kind,
    count: opening.count,
    area: milliunits(opening.area),
    reveal: milliunits(opening.reveal),
  })),
});

/** Проёмы помещения словами — для журнала: «окна 2 шт, 3,60 м², откосы 9,80 м.п.». */
const проёмыДляЖурнала = (
  openings: readonly { kind: "WINDOW" | "DOOR"; count: number; area: bigint | string; reveal: bigint | string }[],
): string => {
  if (openings.length === 0) return "нет";
  return (["WINDOW", "DOOR"] as const)
    .flatMap((вид) => openings.filter((проём) => проём.kind === вид))
    .map((проём) => `${проём.kind === "WINDOW" ? "окна" : "двери"} ${String(проём.count)} шт, `
      + `${количествоТекстом(milliunits(проём.area), "м²")}, откосы ${количествоТекстом(milliunits(проём.reveal), "м.п.")}`)
    .join("; ");
};

const toRoomDto = (row: RoomRow): MeasureRoom => {
  const measure = asMeasure(row);
  return {
    id: row.id,
    name: row.name,
    order: row.order,
    floorArea: row.floorArea.toString(),
    floorPerimeter: row.floorPerimeter.toString(),
    ceilingPerimeter: row.ceilingPerimeter.toString(),
    height: row.height.toString(),
    wallArea: wallArea(measure).toString(),
    volume: roomVolume(measure).toString(),
    openings: row.openings.map((opening) => ({
      kind: opening.kind,
      count: opening.count,
      area: opening.area.toString(),
      reveal: opening.reveal.toString(),
    })),
  };
};

/**
 * Пометка набора в записи журнала.
 *
 * У начального набора пометки нет: он был единственным, и приписка «набор
 * начальный» к каждой записи прошлого журнала сделала бы правкой прошлого
 * то, что правкой не является. Помечается только то, что отличается.
 */
const НАБОР_В_ЖУРНАЛ: Record<MeasureSetKind, string> = {
  INITIAL: "",
  REPLANNED: " (после перепланировки)",
};

/**
 * Помещение в журнале: «10,00 м², высота 2,70 м». Прежде журнал печатал
 * хранимые тысячные — «10000 тысячных м², высота 2700», — и запись о десяти
 * метрах читалась как о десяти тысячах (полный аудит 30.09.2026, П-20).
 */
const помещениеДляЖурнала = (площадь: string | bigint, высота: string | bigint): string =>
  `${количествоТекстом(milliunits(площадь), "м²")}, высота ${количествоТекстом(milliunits(высота), "м")}`;

@Injectable()
export class MeasureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: FileStorage,
  ) {}

  /** Видимость объекта берётся из общего правила: своего здесь нет. */
  private async projectOf(user: RequestUser, code: string) {
    const project = await this.prisma.project.findFirst({ where: { ...projectScope(user), code } });
    if (!project) {
      throw new NotFoundException({ message: `Объект ${code} не найден или недоступен.` });
    }
    return project;
  }

  /**
   * Помещение внутри объекта. Условие содержит и объект, и помещение:
   * чужое и несуществующее дают одинаковый 404, как везде в продукте.
   */
  private async roomOf(projectId: string, id: string) {
    const room = await this.prisma.measureRoom.findFirst({
      where: { id, projectId },
      include: { openings: true },
    });
    if (!room) {
      throw new NotFoundException({ message: "Помещение не найдено или недоступно." });
    }
    return room;
  }

  /**
   * Обмер одного набора.
   *
   * Набор приходит запросом, а не выводится сервером из наличия
   * перепланировки: человек смотрит то, что выбрал, и «сервер сам решил
   * показать вам другой обмер» — это не помощь, а потеря места.
   *
   * Рядом с набором идёт перечень заполненных: экран отличает
   * «перепланировки не было» от «перепланировка есть, но не выбрана».
   */
  async view(user: RequestUser, code: string, set: MeasureSetKind): Promise<MeasureView> {
    const project = await this.projectOf(user, code);
    const rooms = await this.prisma.measureRoom.findMany({
      where: { projectId: project.id, set },
      include: { openings: true },
      orderBy: { order: "asc" },
    });
    const plan = await this.prisma.measurePlan.findFirst({
      where: { projectId: project.id, set },
      include: { uploadedBy: { select: { name: true } } },
    });
    const заполнены = await this.prisma.measureRoom.findMany({
      where: { projectId: project.id },
      select: { set: true },
      distinct: ["set"],
    });

    const totals = measureTotals(rooms.map(asMeasure));
    return {
      set,
      filled: заполнены.map((строка) => строка.set),
      rooms: rooms.map(toRoomDto),
      totals: {
        rooms: totals.rooms,
        floorArea: totals.floorArea.toString(),
        wallArea: totals.wallArea.toString(),
        floorPerimeter: totals.floorPerimeter.toString(),
        ceilingPerimeter: totals.ceilingPerimeter.toString(),
        volume: totals.volume.toString(),
        windows: {
          count: totals.windows.count,
          area: totals.windows.area.toString(),
          reveal: totals.windows.reveal.toString(),
        },
        doors: {
          count: totals.doors.count,
          area: totals.doors.area.toString(),
          reveal: totals.doors.reveal.toString(),
        },
      },
      plan: plan === null ? null : {
        fileName: plan.fileName,
        contentType: plan.contentType,
        byteSize: plan.byteSize,
        uploadedAt: plan.uploadedAt.toISOString(),
        uploadedBy: plan.uploadedBy?.name ?? null,
      },
    };
  }

  /**
   * Перевод позиций сметы на одноимённое помещение перепланировки.
   *
   * Отдельного действия «завести набор перепланировки» в продукте нет:
   * помещения заводят по одному. Поэтому перевод срабатывает здесь — при
   * появлении в наборе `REPLANNED` помещения, одноимённого начальному.
   * Имя однозначно: `@@unique([projectId, set, name])`.
   *
   * Переводится **ссылка и только ссылка**. Количество позиции не
   * пересчитывается: «Кухня» 12,70 м² и «Гостиная» 23,63 м² слились в
   * «Кухню-гостиную» 36,80 м², и пересчёт опустил бы количество ниже уже
   * принятого либо удвоил бы объём работ. Деньги в смете правит человек
   * осознанно, а не перестройка перегородки; после перевода позиция честно
   * показывает расхождение своего количества с новой площадью.
   *
   * Помещения, которому в новом наборе нет одноимённого, перевод не
   * касается вовсе — и это видно: набор приходит вместе с помещением
   * позиции, и смета помечает такие позиции словами.
   *
   * Переводятся позиции действующей редакции. Прежние редакции остаются на
   * своём основании: по ним считали тогда, и переписывать это незачем.
   */
  private async перевестиПозиции(
    tx: Prisma.TransactionClient,
    user: RequestUser,
    projectId: string,
    orgId: string,
    имя: string,
    новоеПомещение: string,
  ): Promise<void> {
    const начальное = await tx.measureRoom.findFirst({
      where: { projectId, set: "INITIAL", name: имя },
      select: { id: true },
    });
    if (начальное === null) return;

    const редакция = await tx.estimate.findFirst({
      where: { projectId },
      orderBy: { version: "desc" },
      select: { id: true },
    });
    if (редакция === null) return;

    const { count } = await tx.estimateItem.updateMany({
      where: { estimateId: редакция.id, roomId: начальное.id, removedAt: null },
      data: { roomId: новоеПомещение },
    });
    if (count === 0) return;

    await this.audit.record({
      orgId,
      actorId: user.id,
      entity: "EstimateItem",
      entityId: projectId,
      field: `${имя} — позиции сметы переведены на обмер после перепланировки`,
      oldValue: "начальный обмер",
      newValue: сколько(count, "позиция", "позиции", "позиций"),
    }, tx);
  }

  async createRoom(
    user: RequestUser,
    code: string,
    set: MeasureSetKind,
    input: CreateMeasureRoom,
  ): Promise<MeasureView> {
    const project = await this.projectOf(user, code);
    const last = await this.prisma.measureRoom.findFirst({
      where: { projectId: project.id, set },
      orderBy: { order: "desc" },
      select: { order: true },
    });

    /* Занятость имени проверяется внутри набора, а не по объекту:
       «Санузел» есть и до перепланировки, и после — это одно помещение в
       двух состояниях, а не ошибка замера. */
    const taken = await this.prisma.measureRoom.findFirst({
      where: { projectId: project.id, set, name: input.name },
      select: { id: true },
    });
    if (taken !== null) {
      throw new BadRequestException({
        message: `Помещение «${input.name}» в этом наборе обмера уже есть. Два одинаковых названия в одном наборе — ошибка замера: назовите «${input.name} 2».`,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const заведено = await tx.measureRoom.create({
        select: { id: true },
        data: {
          projectId: project.id,
          set,
          name: input.name,
          order: (last?.order ?? 0) + 1,
          floorArea: BigInt(input.floorArea),
          floorPerimeter: BigInt(input.floorPerimeter),
          ceilingPerimeter: BigInt(input.ceilingPerimeter),
          height: BigInt(input.height),
          openings: {
            create: (input.openings ?? []).map((opening) => ({
              kind: opening.kind,
              count: opening.count,
              area: BigInt(opening.area),
              reveal: BigInt(opening.reveal),
            })),
          },
        },
      });
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "MeasureRoom",
        entityId: project.id,
        field: `${input.name} — помещение внесено${НАБОР_В_ЖУРНАЛ[set]}`,
        oldValue: null,
        newValue: помещениеДляЖурнала(input.floorArea, input.height),
      }, tx);
      if (set === "REPLANNED") {
        await this.перевестиПозиции(
          tx, user, project.id, user.orgId, input.name, заведено.id,
        );
      }
    });

    return this.view(user, code, set);
  }

  async updateRoom(
    user: RequestUser,
    code: string,
    id: string,
    input: UpdateMeasureRoom,
  ): Promise<MeasureView> {
    const project = await this.projectOf(user, code);
    const before = await this.roomOf(project.id, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.measureRoom.update({
        where: { id: before.id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.floorArea === undefined ? {} : { floorArea: BigInt(input.floorArea) }),
          ...(input.floorPerimeter === undefined ? {} : { floorPerimeter: BigInt(input.floorPerimeter) }),
          ...(input.ceilingPerimeter === undefined ? {} : { ceilingPerimeter: BigInt(input.ceilingPerimeter) }),
          ...(input.height === undefined ? {} : { height: BigInt(input.height) }),
        },
      });

      /* Проёмы пишутся в журнал одной записью «было → стало» словами, в той
         же транзакции (БП-10): прежде они пересоздавались молча, и спор
         «кто убрал окно» разрешить было нечем. Запись делается, только если
         проёмы и правда поменялись: лист присылает их при каждом
         сохранении. */
      if (input.openings !== undefined) {
        const было = проёмыДляЖурнала(before.openings);
        const стало = проёмыДляЖурнала(input.openings);
        if (было !== стало) {
          await this.audit.record({
            orgId: user.orgId,
            actorId: user.id,
            entity: "MeasureRoom",
            entityId: project.id,
            field: `${before.name} — ${FIELD_LABEL.openings ?? "проёмы"}`,
            oldValue: было,
            newValue: стало,
          }, tx);
        }
        await tx.measureOpening.deleteMany({ where: { roomId: before.id } });
        for (const opening of input.openings) {
          await tx.measureOpening.create({
            data: {
              roomId: before.id,
              kind: opening.kind,
              count: opening.count,
              area: BigInt(opening.area),
              reveal: BigInt(opening.reveal),
            },
          });
        }
      }

      // Каждая изменённая величина — отдельная запись: спор на объекте
      // звучит как «кто поменял площадь», а не «кто правил помещение».
      for (const field of MEASURED) {
        const next = input[field];
        if (next === undefined || BigInt(next) === before[field]) continue;
        await this.audit.record({
          orgId: user.orgId,
          actorId: user.id,
          entity: "MeasureRoom",
          entityId: project.id,
          field: `${before.name} — ${FIELD_LABEL[field] ?? field}`,
          /* Словами и в единицах, а не сырыми тысячными: «18400 → 20000»
             читалось как восемнадцать тысяч метров. */
          oldValue: количествоТекстом(milliunits(before[field]), ЕДИНИЦА[field]),
          newValue: количествоТекстом(milliunits(next), ЕДИНИЦА[field]),
        }, tx);
      }
      if (input.name !== undefined && input.name !== before.name) {
        await this.audit.record({
          orgId: user.orgId, actorId: user.id,
          entity: "MeasureRoom", entityId: project.id,
          field: `${before.name} — ${FIELD_LABEL.name ?? "название"}`,
          oldValue: before.name, newValue: input.name,
        }, tx);
        /* Переименование помещения перепланировки в имя начального — то же
           событие, что и заведение: намерение одно, и два разных исхода у
           одного намерения были бы дефектом. */
        if (before.set === "REPLANNED") {
          await this.перевестиПозиции(
            tx, user, project.id, user.orgId, input.name, before.id,
          );
        }
      }
    });

    /* Набор берётся у самого помещения, а не запросом: правят то, что
       открыто, и разойтись эти два ответа не могут по построению. */
    return this.view(user, code, before.set);
  }

  async deleteRoom(user: RequestUser, code: string, id: string): Promise<MeasureView> {
    const project = await this.projectOf(user, code);
    const room = await this.roomOf(project.id, id);

    /* Связь позиции с помещением объявлена `ON DELETE SET NULL`: иначе
       каскадное удаление объекта упёрлось бы в ссылку, а порядок обхода
       каскадов не определён — наполнение стенда падало бы через раз.
       Но обнуление на прямом удалении было бы молчаливым снятием основания
       количества с десятка позиций, поэтому прямое удаление предваряется
       отказом, который называет число привязанных позиций. */
    const привязано = await this.prisma.estimateItem.count({ where: { roomId: room.id, removedAt: null } });
    if (привязано > 0) {
      throw new BadRequestException({
        message: `К помещению «${room.name}» привязано позиций сметы: ${привязано.toString()}. `
          + "Удаление сняло бы с них основание количества молча. Перенесите их в другое "
          + "помещение или отвяжите, затем удаляйте.",
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.measureRoom.delete({ where: { id: room.id } });
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "MeasureRoom",
        entityId: project.id,
        field: `${room.name} — помещение удалено${НАБОР_В_ЖУРНАЛ[room.set]}`,
        oldValue: помещениеДляЖурнала(room.floorArea, room.height),
        newValue: null,
      }, tx);
    });

    return this.view(user, code, room.set);
  }

  /**
   * Загрузка плана набора. Прежний файл снимается с диска: план один на
   * набор, и оставлять предыдущий значит копить мусор, на который уже
   * ничто не ссылается.
   */
  async savePlan(
    user: RequestUser,
    code: string,
    set: MeasureSetKind,
    fileName: string,
    body: Buffer,
  ): Promise<MeasureView> {
    const project = await this.projectOf(user, code);

    const contentType = detectImageType(body);
    if (contentType === null) {
      throw new BadRequestException({
        message: `План принимается снимком или изображением: ${ALLOWED_IMAGE_TYPES.join(", ")}. Тип определяется по содержимому файла, а не по расширению.`,
      });
    }

    const previous = await this.prisma.measurePlan.findFirst({ where: { projectId: project.id, set } });
    const key = `projects/${project.id}/plan/${randomUUID()}.${IMAGE_EXTENSION[contentType]}`;
    /* План снимают телефоном в квартире заказчика: метаданные несут её
       координаты (П-39). */
    await this.storage.put(key, await безМетаданных(body, contentType), contentType);

    await this.prisma.$transaction(async (tx) => {
      await tx.measurePlan.upsert({
        where: { projectId_set: { projectId: project.id, set } },
        update: { storageKey: key, fileName, contentType, byteSize: body.byteLength, uploadedById: user.id },
        create: {
          projectId: project.id, set, storageKey: key, fileName, contentType,
          byteSize: body.byteLength, uploadedById: user.id,
        },
      });
      await this.audit.record({
        orgId: user.orgId, actorId: user.id,
        entity: "MeasurePlan", entityId: project.id,
        field: `план объекта${НАБОР_В_ЖУРНАЛ[set]}`,
        oldValue: previous?.fileName ?? null, newValue: fileName,
      }, tx);
    });

    if (previous !== null) await this.storage.remove(previous.storageKey);
    return this.view(user, code, set);
  }

  async readPlan(
    user: RequestUser,
    code: string,
    set: MeasureSetKind,
  ): Promise<{ body: Buffer; contentType: string; fileName: string }> {
    const project = await this.projectOf(user, code);
    const plan = await this.prisma.measurePlan.findFirst({ where: { projectId: project.id, set } });
    if (plan === null) {
      throw new NotFoundException({ message: "План объекта не загружен." });
    }
    return { body: await this.storage.get(plan.storageKey), contentType: plan.contentType, fileName: plan.fileName };
  }

  async deletePlan(user: RequestUser, code: string, set: MeasureSetKind): Promise<MeasureView> {
    const project = await this.projectOf(user, code);
    const plan = await this.prisma.measurePlan.findFirst({ where: { projectId: project.id, set } });
    if (plan === null) {
      throw new NotFoundException({ message: "План объекта не загружен." });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.measurePlan.delete({ where: { projectId_set: { projectId: project.id, set } } });
      await this.audit.record({
        orgId: user.orgId, actorId: user.id,
        entity: "MeasurePlan", entityId: project.id,
        field: `план объекта${НАБОР_В_ЖУРНАЛ[set]}`,
        oldValue: plan.fileName, newValue: null,
      }, tx);
    });

    await this.storage.remove(plan.storageKey);
    return this.view(user, code, set);
  }
}
