import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { MeasureRoom, MeasureView, CreateMeasureRoom, UpdateMeasureRoom } from "@priyomka/contracts";
import { measureTotals, milliunits, roomVolume, wallArea, type RoomMeasure } from "@priyomka/domain";
import { PrismaService } from "../prisma.service";
import { AuditService } from "../common/audit.service";
import { FileStorage } from "../common/file-storage";
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
});

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

  async view(user: RequestUser, code: string): Promise<MeasureView> {
    const project = await this.projectOf(user, code);
    const rooms = await this.prisma.measureRoom.findMany({
      where: { projectId: project.id },
      include: { openings: true },
      orderBy: { order: "asc" },
    });
    const plan = await this.prisma.measurePlan.findUnique({
      where: { projectId: project.id },
      include: { uploadedBy: { select: { name: true } } },
    });

    const totals = measureTotals(rooms.map(asMeasure));
    return {
      rooms: rooms.map(toRoomDto),
      totals: {
        rooms: totals.rooms,
        floorArea: totals.floorArea.toString(),
        wallArea: totals.wallArea.toString(),
        floorPerimeter: totals.floorPerimeter.toString(),
        ceilingPerimeter: totals.ceilingPerimeter.toString(),
        volume: totals.volume.toString(),
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

  async createRoom(user: RequestUser, code: string, input: CreateMeasureRoom): Promise<MeasureView> {
    const project = await this.projectOf(user, code);
    const last = await this.prisma.measureRoom.findFirst({
      where: { projectId: project.id },
      orderBy: { order: "desc" },
      select: { order: true },
    });

    const taken = await this.prisma.measureRoom.findFirst({
      where: { projectId: project.id, name: input.name },
      select: { id: true },
    });
    if (taken !== null) {
      throw new BadRequestException({
        message: `Помещение «${input.name}» на объекте уже есть. Два одинаковых названия в обмере — ошибка замера: назовите «${input.name} 2».`,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.measureRoom.create({
        data: {
          projectId: project.id,
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
        field: `${input.name} — помещение внесено`,
        oldValue: null,
        newValue: `${input.floorArea} тысячных м², высота ${input.height}`,
      });
    });

    return this.view(user, code);
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

      if (input.openings !== undefined) {
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
          oldValue: before[field].toString(),
          newValue: next,
        });
      }
      if (input.name !== undefined && input.name !== before.name) {
        await this.audit.record({
          orgId: user.orgId, actorId: user.id,
          entity: "MeasureRoom", entityId: project.id,
          field: `${before.name} — ${FIELD_LABEL.name ?? "название"}`,
          oldValue: before.name, newValue: input.name,
        });
      }
    });

    return this.view(user, code);
  }

  async deleteRoom(user: RequestUser, code: string, id: string): Promise<MeasureView> {
    const project = await this.projectOf(user, code);
    const room = await this.roomOf(project.id, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.measureRoom.delete({ where: { id: room.id } });
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "MeasureRoom",
        entityId: project.id,
        field: `${room.name} — помещение удалено`,
        oldValue: `${room.floorArea.toString()} тысячных м², высота ${room.height.toString()}`,
        newValue: null,
      });
    });

    return this.view(user, code);
  }

  /**
   * Загрузка плана объекта. Прежний файл снимается с диска: план один на
   * объект, и оставлять предыдущий значит копить мусор, на который уже
   * ничто не ссылается.
   */
  async savePlan(
    user: RequestUser,
    code: string,
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

    const previous = await this.prisma.measurePlan.findUnique({ where: { projectId: project.id } });
    const key = `projects/${project.id}/plan/${randomUUID()}.${IMAGE_EXTENSION[contentType]}`;
    await this.storage.put(key, body, contentType);

    await this.prisma.$transaction(async (tx) => {
      await tx.measurePlan.upsert({
        where: { projectId: project.id },
        update: { storageKey: key, fileName, contentType, byteSize: body.byteLength, uploadedById: user.id },
        create: {
          projectId: project.id, storageKey: key, fileName, contentType,
          byteSize: body.byteLength, uploadedById: user.id,
        },
      });
      await this.audit.record({
        orgId: user.orgId, actorId: user.id,
        entity: "MeasurePlan", entityId: project.id, field: "план объекта",
        oldValue: previous?.fileName ?? null, newValue: fileName,
      });
    });

    if (previous !== null) await this.storage.remove(previous.storageKey);
    return this.view(user, code);
  }

  async readPlan(user: RequestUser, code: string): Promise<{ body: Buffer; contentType: string; fileName: string }> {
    const project = await this.projectOf(user, code);
    const plan = await this.prisma.measurePlan.findUnique({ where: { projectId: project.id } });
    if (plan === null) {
      throw new NotFoundException({ message: "План объекта не загружен." });
    }
    return { body: await this.storage.get(plan.storageKey), contentType: plan.contentType, fileName: plan.fileName };
  }

  async deletePlan(user: RequestUser, code: string): Promise<MeasureView> {
    const project = await this.projectOf(user, code);
    const plan = await this.prisma.measurePlan.findUnique({ where: { projectId: project.id } });
    if (plan === null) {
      throw new NotFoundException({ message: "План объекта не загружен." });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.measurePlan.delete({ where: { projectId: project.id } });
      await this.audit.record({
        orgId: user.orgId, actorId: user.id,
        entity: "MeasurePlan", entityId: project.id, field: "план объекта",
        oldValue: plan.fileName, newValue: null,
      });
    });

    await this.storage.remove(plan.storageKey);
    return this.view(user, code);
  }
}
