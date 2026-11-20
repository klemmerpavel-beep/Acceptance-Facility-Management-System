import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  MeasureRoom, MeasureSetKind, MeasureView, CreateMeasureRoom, UpdateMeasureRoom, MeasureWallInput,
  CreateWallOpening, UpdateWallOpening, MeasureWall,
} from "@priyomka/contracts";
import {
  measureTotals, milliunits, openingArea, openingText, openingTotalsText, revealLength, roomVolume,
  singleWallArea, singleWallAreaNet, singleWallNetWarning, transferOpening, wallArea, wallAreaNet,
  wallName, wallRemovalFault, wallsLength, wallsLengthWarning, количествоТекстом, type RoomMeasure,
  type WallItemRefs, сколько,
} from "@priyomka/domain";
import { Prisma, type WallOpening } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { AuditService } from "../common/audit.service";
import { FileStorage } from "../common/file-storage";
import { безМетаданных } from "../common/clean-image";
import type { RequestUser } from "../common/current-user";
import { projectScope } from "../common/project-scope";
import { detectImageType, ALLOWED_IMAGE_TYPES, IMAGE_EXTENSION } from "./image-type";
import {
  обмерСоСтенами, помещениеДляДомена, проёмДляДомена, стеныПоId, ROOM_WITH_WALLS,
  type RoomWithWalls, type WallPlace,
} from "./measure-load";

/**
 * Обмерный план объекта.
 *
 * Производные величины — площадь стен брутто и нетто и объём — в базе не
 * лежат: они выводятся доменом при каждой сборке ответа. Так экран,
 * печатная форма и перенос площадей в смету получают одно и то же число.
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

/** Отказ: стены и итоги проёмов в одном теле — две записи об одних проёмах. */
const СТЕНЫ_И_ИТОГИ = "У помещения со стенами итогов проёмов нет: с первой стеной оно считается по стенам,"
  + " и окна и двери заводятся на стенах.";

/** Отказ: стена с опознавателем, которой у помещения нет. */
const ЧУЖАЯ_СТЕНА = "Стены нет у этого помещения: перечень стен присылается своим помещением.";

/** Отказ: откосы второй стороны без её стены. */
const ОТКОСЫ_БЕЗ_СТЕНЫ = "Откосы второй стороны вводятся вместе с её стеной: выберите стену смежного помещения.";

/** Длина или высота словами для журнала: «4,00 м». */
const метры = (value: bigint): string => количествоТекстом(milliunits(value), "м");

/** Стена в журнале: «длина 4,00 м, высота как у помещения». */
const стенаДляЖурнала = (wall: { length: bigint; height: bigint | null }): string =>
  `длина ${метры(wall.length)}, высота ${wall.height === null ? "как у помещения" : метры(wall.height)}`;

/** Проём в журнале: «Дверь 0,80 × 2,10 м». */
const проёмДляЖурнала = (opening: Pick<WallOpening, "kind" | "width" | "height">): string =>
  openingText({ kind: opening.kind, width: milliunits(opening.width), height: milliunits(opening.height) });

/** Откосы словами; не измерены — так и сказано. */
const откосыДляЖурнала = (value: bigint | null): string =>
  value === null ? "не измерены" : количествоТекстом(milliunits(value), "м.п.");

/** Позиций на стене нет. */
const БЕЗ_ПОЗИЦИЙ: WallItemRefs = { current: 0, previous: 0 };

/**
 * Стена в ответе: величины, площади брутто и нетто тем же доменом, что
 * помещение, и проёмы на ней с любой стороны — со стороной и соседом.
 */
const toWallDto = (
  room: RoomMeasure,
  wall: RoomWithWalls["walls"][number],
  openings: readonly WallOpening[],
  стены: ReadonlyMap<string, WallPlace>,
  ссылки: ReadonlyMap<string, WallItemRefs>,
): MeasureWall => {
  const измерено = { id: wall.id, label: wall.label, length: milliunits(wall.length),
    height: wall.height === null ? null : milliunits(wall.height) };
  const наСтене = openings.filter((opening) => opening.wallId === wall.id || opening.adjoiningWallId === wall.id);
  return {
    id: wall.id,
    order: wall.order,
    label: wall.label,
    name: wallName(wall.order, wall.label),
    length: wall.length.toString(),
    height: wall.height === null ? null : wall.height.toString(),
    wallArea: singleWallArea(room, измерено).toString(),
    wallAreaNet: singleWallAreaNet(room, измерено).toString(),
    warning: singleWallNetWarning(room, измерено, wall.order),
    openings: наСтене.map((opening) => {
      const сторонаА = opening.wallId === wall.id;
      const другаяСтена = сторонаА ? opening.adjoiningWallId : opening.wallId;
      const другая = другаяСтена === null ? undefined : стены.get(другаяСтена);
      return {
        id: opening.id,
        kind: opening.kind,
        width: opening.width.toString(),
        height: opening.height.toString(),
        area: openingArea(проёмДляДомена(opening)).toString(),
        side: сторонаА ? "A" as const : "B" as const,
        reveal: (сторонаА ? opening.reveal : opening.adjoiningReveal)?.toString() ?? null,
        other: другая === undefined ? null : {
          roomId: другая.room.id,
          roomName: другая.room.name,
          wallId: другая.wall.id,
          wallName: другая.name,
          reveal: (сторонаА ? opening.adjoiningReveal : opening.reveal)?.toString() ?? null,
        },
      };
    }),
    estimateItems: ссылки.get(wall.id) ?? БЕЗ_ПОЗИЦИЙ,
  };
};

const toRoomDto = (
  row: RoomWithWalls,
  openings: readonly WallOpening[],
  стены: ReadonlyMap<string, WallPlace>,
  ссылки: ReadonlyMap<string, WallItemRefs>,
): MeasureRoom => {
  const measure = помещениеДляДомена(row, openings);
  const длина = wallsLength(measure);
  return {
    id: row.id,
    name: row.name,
    order: row.order,
    floorArea: row.floorArea.toString(),
    floorPerimeter: row.floorPerimeter.toString(),
    ceilingPerimeter: row.ceilingPerimeter.toString(),
    height: row.height.toString(),
    wallArea: wallArea(measure).toString(),
    wallAreaNet: wallAreaNet(measure).toString(),
    volume: roomVolume(measure).toString(),
    openings: row.openings.map((opening) => ({
      kind: opening.kind,
      count: opening.count,
      area: opening.area.toString(),
      reveal: opening.reveal.toString(),
    })),
    walls: row.walls.map((wall) => toWallDto(measure, wall, openings, стены, ссылки)),
    wallsLength: длина === null ? null : длина.toString(),
    wallsWarning: wallsLengthWarning(measure),
    revealLength: revealLength(measure).toString(),
  };
};

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
      include: ROOM_WITH_WALLS,
    });
    if (!room) {
      throw new NotFoundException({ message: "Помещение не найдено или недоступно." });
    }
    return room;
  }

  /**
   * Позиции сметы с адресом на стенах — по стене: действующей редакции и
   * прежних (норматив 55.5). Действующая — последняя по номеру, как везде.
   */
  private async ссылкиНаСтены(
    projectId: string,
    wallIds: readonly string[],
  ): Promise<Map<string, WallItemRefs>> {
    const ссылки = new Map<string, WallItemRefs>();
    if (wallIds.length === 0) return ссылки;
    const позиции = await this.prisma.estimateItem.findMany({
      where: { wallId: { in: [...wallIds] }, removedAt: null },
      select: { wallId: true, estimateId: true },
    });
    if (позиции.length === 0) return ссылки;
    const действующая = await this.prisma.estimate.findFirst({
      where: { projectId },
      orderBy: { version: "desc" },
      select: { id: true },
    });
    for (const позиция of позиции) {
      if (позиция.wallId === null) continue;
      const было = ссылки.get(позиция.wallId) ?? БЕЗ_ПОЗИЦИЙ;
      ссылки.set(позиция.wallId, позиция.estimateId === действующая?.id
        ? { current: было.current + 1, previous: было.previous }
        : { current: было.current, previous: было.previous + 1 });
    }
    return ссылки;
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
   *
   * С этапа Э11 (шаг 2) помещение приходит со стенами и проёмами на них, а
   * набор — с проёмами без второй стороны: строка стены соседа предлагает
   * привязать их одним касанием (решение Э11-2.2 «а»).
   */
  async view(user: RequestUser, code: string, set: MeasureSetKind): Promise<MeasureView> {
    const project = await this.projectOf(user, code);
    const { rooms, openings } = await обмерСоСтенами(this.prisma, { projectId: project.id, set });
    const plan = await this.prisma.measurePlan.findFirst({
      where: { projectId: project.id, set },
      include: { uploadedBy: { select: { name: true } } },
    });
    const заполнены = await this.prisma.measureRoom.findMany({
      where: { projectId: project.id },
      select: { set: true },
      distinct: ["set"],
    });

    const стены = стеныПоId(rooms);
    const ссылки = await this.ссылкиНаСтены(project.id, [...стены.keys()]);
    const totals = measureTotals(rooms.map((room) => помещениеДляДомена(room, openings)));
    return {
      set,
      filled: заполнены.map((строка) => строка.set),
      rooms: rooms.map((room) => toRoomDto(room, openings, стены, ссылки)),
      totals: {
        rooms: totals.rooms,
        floorArea: totals.floorArea.toString(),
        wallArea: totals.wallArea.toString(),
        wallAreaNet: totals.wallAreaNet.toString(),
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
      unboundOpenings: openings.flatMap((opening) => {
        const место = стены.get(opening.wallId);
        if (opening.adjoiningWallId !== null || место === undefined) return [];
        return [{
          id: opening.id,
          kind: opening.kind,
          width: opening.width.toString(),
          height: opening.height.toString(),
          roomId: место.room.id,
          roomName: место.room.name,
          wallId: место.wall.id,
          wallName: место.name,
        }];
      }),
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
   *
   * Адрес поверхности (этап Э11, шаг 2; решение Э11-2.8 «б»): вид
   * сохраняется, стена снимается всегда — стены принадлежат набору обмера, и
   * стены начального обмера в новом помещении нет. Сопоставление по подписи
   * угадывало бы: подписи необязательны, а «Стена 2» после перепланировки —
   * не та стена. Источник количества не трогается: признак назовёт его
   * «источник удалён» — позиция стоит уже не на его помещении.
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

    const соСтеной = await tx.estimateItem.count({
      where: { estimateId: редакция.id, roomId: начальное.id, removedAt: null, NOT: { wallId: null } },
    });
    const { count } = await tx.estimateItem.updateMany({
      where: { estimateId: редакция.id, roomId: начальное.id, removedAt: null },
      data: { roomId: новоеПомещение, wallId: null },
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
    if (соСтеной > 0) {
      await this.audit.record({
        orgId,
        actorId: user.id,
        entity: "EstimateItem",
        entityId: projectId,
        field: `${имя} — стена адреса снята переводом: стены начального обмера в новом наборе нет`,
        oldValue: "стена начального обмера",
        newValue: `не выбрана у ${сколько(соСтеной, "позиции", "позиций", "позиций")}`,
      }, tx);
    }
  }

  /**
   * Отказ, если на снимаемые стены ссылаются позиции сметы — по образцу
   * помещения (`deleteRoom`): связь объявлена `SET NULL`, и прямое удаление
   * сняло бы адрес «одна стена» с позиций молча. Считаются позиции всех
   * редакций, как у помещения: прежние редакции стоят на своём основании.
   * Текст — функция домена, та же, что у листа: позиции прежних редакций
   * не правятся, и отказ не обещает им пути, которого нет (П-85).
   */
  private async отказСтенСПозициями(
    projectId: string,
    roomName: string,
    walls: readonly { id: string; order: number; label: string | null }[],
  ): Promise<void> {
    if (walls.length === 0) return;
    const ссылки = await this.ссылкиНаСтены(projectId, walls.map((wall) => wall.id));
    const отказ = wallRemovalFault(roomName, walls.map((wall) => ({
      name: wallName(wall.order, wall.label),
      refs: ссылки.get(wall.id) ?? БЕЗ_ПОЗИЦИЙ,
    })));
    if (отказ !== null) throw new BadRequestException({ message: отказ });
  }

  /**
   * Снятие стен в транзакции сохранения или удаления помещения (этап Э11,
   * шаг 2). Проёмы решаются до удаления стен — каскад `wallId` удалил бы
   * проём раньше, чем его передадут соседу:
   *
   *   стена — сторона А, сторона Б привязана: проём переходит к соседу,
   *     откосы сторон меняются местами (решение Э11-2.3 «б», вместо прежнего
   *     ADR-0002, п. 7); журнал называет переход;
   *   стена — сторона А, стороны Б нет: проём удаляется каскадом;
   *   стена — сторона Б: привязка снимается, откосы той стороны — тоже.
   *
   * `сПомещением` — стены уходят вместе с помещением: запись журнала об
   * удалении помещения называет его, и строка на каждую стену была бы
   * шумом. Переходы проёмов к соседям пишутся и тогда: они меняют соседа.
   */
  private async снятьСтены(
    tx: Prisma.TransactionClient,
    user: RequestUser,
    projectId: string,
    room: { name: string },
    walls: readonly { id: string; order: number; label: string | null; length: bigint; height: bigint | null }[],
    сПомещением: boolean,
  ): Promise<void> {
    const ids = new Set(walls.map((wall) => wall.id));
    const затронуты = await tx.wallOpening.findMany({
      where: { OR: [{ wallId: { in: [...ids] } }, { adjoiningWallId: { in: [...ids] } }] },
      include: { wall: { include: { room: true } }, adjoiningWall: { include: { room: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const запись = (field: string, oldValue: string | null, newValue: string | null) =>
      this.audit.record({
        orgId: user.orgId, actorId: user.id, entity: "MeasureRoom", entityId: projectId,
        field, oldValue, newValue,
      }, tx);

    for (const проём of затронуты) {
      const текст = проёмДляЖурнала(проём);
      const сторонаА = `«${проём.wall.room.name}», ${wallName(проём.wall.order, проём.wall.label)}`;
      const сосед = проём.adjoiningWall;
      if (ids.has(проём.wallId)) {
        const перешёл = transferOpening(проёмДляДомена(проём));
        if (перешёл !== null && сосед !== null && !ids.has(сосед.id)) {
          await tx.wallOpening.update({
            where: { id: проём.id },
            data: {
              wallId: перешёл.wallId,
              adjoiningWallId: перешёл.adjoiningWallId,
              reveal: перешёл.reveal,
              adjoiningReveal: перешёл.adjoiningReveal,
            },
          });
          await запись(
            `${проём.wall.room.name} — ${текст} передан соседу`,
            сторонаА,
            `«${сосед.room.name}», ${wallName(сосед.order, сосед.label)}: `
              + "его сторона стала первой, откосы сторон поменялись местами",
          );
        } else {
          await запись(`${проём.wall.room.name} — ${текст} удалён вместе со стеной`, сторонаА, null);
        }
        continue;
      }
      if (сосед !== null) {
        await tx.wallOpening.update({
          where: { id: проём.id },
          data: { adjoiningWallId: null, adjoiningReveal: null },
        });
        await запись(
          `${проём.wall.room.name} — ${текст}: вторая сторона снята`,
          `«${сосед.room.name}», ${wallName(сосед.order, сосед.label)}`,
          "не привязана",
        );
      }
    }

    if (!сПомещением) {
      for (const wall of walls) {
        await запись(`${room.name} — ${wallName(wall.order, wall.label)} удалена`, стенаДляЖурнала(wall), null);
      }
    }
    await tx.measureWall.deleteMany({ where: { id: { in: [...ids] } } });
  }

  /**
   * Стены помещения перечнем целиком (этап Э11, шаг 2). Стена с
   * опознавателем правится, без него — заводится; прежняя, которой в
   * перечне нет, снимается (`снятьСтены`). Порядок — порядок перечня:
   * «Стена N» называется по месту, и место плотное.
   *
   * Опознаватели постоянные: на стену ссылаются позиции сметы, и
   * пересоздание строк, как у итогов проёмов, обнуляло бы их адрес каждым
   * сохранением.
   */
  private async записатьСтены(
    tx: Prisma.TransactionClient,
    user: RequestUser,
    projectId: string,
    room: { id: string; name: string; walls: RoomWithWalls["walls"] },
    стены: readonly MeasureWallInput[],
  ): Promise<void> {
    const прежние = new Map(room.walls.map((wall) => [wall.id, wall]));
    const остаются = new Set(стены.flatMap((стена) => (стена.id === undefined ? [] : [стена.id])));
    const снимаются = room.walls.filter((wall) => !остаются.has(wall.id));
    if (снимаются.length > 0) await this.снятьСтены(tx, user, projectId, room, снимаются, false);

    const запись = (field: string, oldValue: string | null, newValue: string | null) =>
      this.audit.record({
        orgId: user.orgId, actorId: user.id, entity: "MeasureRoom", entityId: projectId,
        field, oldValue, newValue,
      }, tx);

    for (const [index, стена] of стены.entries()) {
      const order = index + 1;
      const подпись = стена.label?.trim() ?? "";
      const label = подпись === "" ? null : подпись;
      const length = BigInt(стена.length);
      const height = стена.height === undefined || стена.height === null ? null : BigInt(стена.height);
      const имя = wallName(order, label);
      const прежняя = стена.id === undefined ? undefined : прежние.get(стена.id);
      if (прежняя === undefined) {
        await tx.measureWall.create({ data: { roomId: room.id, order, label, length, height } });
        await запись(`${room.name} — ${имя} заведена`, null, стенаДляЖурнала({ length, height }));
        continue;
      }
      await tx.measureWall.update({ where: { id: прежняя.id }, data: { order, label, length, height } });
      /* Каждая величина — своей записью, словами и в единицах: спор звучит
         как «кто поменял длину второй стены», а не «кто правил помещение». */
      if (length !== прежняя.length) {
        await запись(`${room.name} — ${имя}: длина`, метры(прежняя.length), метры(length));
      }
      if (height !== прежняя.height) {
        await запись(
          `${room.name} — ${имя}: высота`,
          прежняя.height === null ? "как у помещения" : метры(прежняя.height),
          height === null ? "как у помещения" : метры(height),
        );
      }
      if (label !== прежняя.label) {
        await запись(`${room.name} — ${имя}: подпись`, прежняя.label ?? "нет", label ?? "нет");
      }
    }
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
    const стены = input.walls ?? [];
    if (стены.length > 0 && (input.openings ?? []).length > 0) {
      throw new BadRequestException({ message: СТЕНЫ_И_ИТОГИ });
    }
    if (стены.some((стена) => стена.id !== undefined)) {
      throw new BadRequestException({ message: ЧУЖАЯ_СТЕНА });
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
      if (стены.length > 0) {
        await this.записатьСтены(tx, user, project.id, { id: заведено.id, name: input.name, walls: [] }, стены);
      }
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

    /* Стены (этап Э11, шаг 2). С первой стеной помещение считается только
       по стенам, и итогов проёмов у него нет (решение Э11-2.1 «а»): тело,
       в котором есть и стены, и итоги, — две записи об одних и тех же
       проёмах, и принимать его нельзя. Стена из другого помещения — отказ:
       перечень присылается своим помещением. */
    const стеныПосле = input.walls;
    const стенПосле = стеныПосле?.length ?? before.walls.length;
    if (стенПосле > 0 && (input.openings ?? []).length > 0) {
      throw new BadRequestException({ message: СТЕНЫ_И_ИТОГИ });
    }
    if (стеныПосле !== undefined) {
      const свои = new Set(before.walls.map((wall) => wall.id));
      if (стеныПосле.some((стена) => стена.id !== undefined && !свои.has(стена.id))) {
        throw new BadRequestException({ message: ЧУЖАЯ_СТЕНА });
      }
      const остаются = new Set(стеныПосле.flatMap((стена) => (стена.id === undefined ? [] : [стена.id])));
      await this.отказСтенСПозициями(project.id, before.name, before.walls.filter((wall) => !остаются.has(wall.id)));
    }

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

      /* Первая стена снимает итоги проёмов тем же сохранением (решение
         Э11-2.1 «а»): о проёмах помещения остаётся одна запись — проёмы на
         стенах. Снятие пишется в журнал было/стало словами и в единицах; лист
         называет его до сохранения (`openingTotalsDropNote`). Прежние числа
         не возвращаются и при удалении всех стен: поля итогов пусты. */
      const первыеСтены = before.walls.length === 0 && стенПосле > 0;
      if (первыеСтены && before.openings.length > 0) {
        await this.audit.record({
          orgId: user.orgId,
          actorId: user.id,
          entity: "MeasureRoom",
          entityId: project.id,
          field: `${before.name} — итоги проёмов сняты: помещение считается по стенам`,
          oldValue: openingTotalsText(before.openings.map((opening) => ({
            kind: opening.kind, count: opening.count,
            area: milliunits(opening.area), reveal: milliunits(opening.reveal),
          }))),
          newValue: "нет",
        }, tx);
        await tx.measureOpening.deleteMany({ where: { roomId: before.id } });
      } else if (input.openings !== undefined && стенПосле === 0) {
        /* Проёмы пишутся в журнал одной записью «было → стало» словами, в
           той же транзакции (БП-10): прежде они пересоздавались молча, и
           спор «кто убрал окно» разрешить было нечем. Запись делается, только
           если проёмы и правда поменялись: лист присылает их при каждом
           сохранении. */
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

      if (стеныПосле !== undefined) {
        await this.записатьСтены(tx, user, project.id, before, стеныПосле);
        if (стенПосле === 0 && before.walls.length > 0) {
          /* Итоги называются теми, что сохранены этим же телом: лист со
             снятой последней стеной присылает и введённые итоги, и запись
             «итоги пусты» рядом с записью о них противоречила бы им (П-87). */
          await this.audit.record({
            orgId: user.orgId,
            actorId: user.id,
            entity: "MeasureRoom",
            entityId: project.id,
            field: `${before.name} — стены сняты: помещение считается по четырём величинам`,
            oldValue: сколько(before.walls.length, "стена", "стены", "стен"),
            newValue: `итоги проёмов: ${проёмыДляЖурнала(input.openings ?? [])}`,
          }, tx);
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
      /* Стены уходят каскадом с помещением, но проёмы с привязанной
         стороной Б сначала переходят к соседу (решение Э11-2.3 «б»):
         удаление записи одного помещения — дубля, повторного ввода — не
         вправе молча менять нетто соседнего. */
      if (room.walls.length > 0) {
        await this.снятьСтены(tx, user, project.id, room, room.walls, true);
      }
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
   * Стена внутри объекта: чужая и несуществующая дают одинаковый 404, как
   * помещение.
   */
  private async стенаОбъекта(projectId: string, wallId: string) {
    const стена = await this.prisma.measureWall.findFirst({
      where: { id: wallId, room: { projectId } },
      include: { room: true },
    });
    if (стена === null) {
      throw new NotFoundException({ message: "Стена не найдена или недоступна." });
    }
    return стена;
  }

  /**
   * Стена второй стороны проёма (ADR-0002, п. 2): стена соседнего помещения
   * того же объекта и того же набора обмера. Ограничений базы на это нет —
   * правило здесь, с отказом, который называет нарушенное.
   */
  private async стенаСоседа(
    projectId: string,
    сторонаА: { id: string; set: MeasureSetKind },
    wallId: string,
  ) {
    const сосед = await this.prisma.measureWall.findFirst({
      where: { id: wallId, room: { projectId } },
      include: { room: true },
    });
    if (сосед === null) {
      throw new BadRequestException({ message: "Стены второй стороны нет в обмере этого объекта." });
    }
    if (сосед.room.set !== сторонаА.set) {
      throw new BadRequestException({
        message: "Стена второй стороны — из другого набора обмера: проём соединяет помещения одного набора.",
      });
    }
    if (сосед.room.id === сторонаА.id) {
      throw new BadRequestException({
        message: "Вторая сторона — стена соседнего помещения, а не этого же: проём соединяет два помещения.",
      });
    }
    return сосед;
  }

  /**
   * Заведение проёма со строки стены (этап Э11, шаг 2; решение Э11-2.4 «а»):
   * стена стороны А — из адреса, вид — из тела. Вторая сторона
   * необязательна: у соседа без стен проём сохраняется односторонним
   * (решение Э11-2.2 «а»), сосед вычитает его своими итогами.
   */
  async createOpening(
    user: RequestUser,
    code: string,
    wallId: string,
    input: CreateWallOpening,
  ): Promise<MeasureView> {
    const project = await this.projectOf(user, code);
    const стена = await this.стенаОбъекта(project.id, wallId);
    const сторонаБ = input.adjoiningWallId ?? null;
    if (сторонаБ === null && (input.adjoiningReveal ?? null) !== null) {
      throw new BadRequestException({ message: ОТКОСЫ_БЕЗ_СТЕНЫ });
    }
    const сосед = сторонаБ === null ? null : await this.стенаСоседа(project.id, стена.room, сторонаБ);

    await this.prisma.$transaction(async (tx) => {
      const проём = await tx.wallOpening.create({
        data: {
          wallId: стена.id,
          adjoiningWallId: сосед?.id ?? null,
          kind: input.kind,
          width: BigInt(input.width),
          height: BigInt(input.height),
          reveal: input.reveal === undefined || input.reveal === null ? null : BigInt(input.reveal),
          adjoiningReveal: сосед === null || input.adjoiningReveal === undefined || input.adjoiningReveal === null
            ? null
            : BigInt(input.adjoiningReveal),
        },
      });
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "MeasureRoom",
        entityId: project.id,
        field: `${стена.room.name} — ${wallName(стена.order, стена.label)}: проём заведён`,
        oldValue: null,
        newValue: `${проёмДляЖурнала(проём)}, откосы ${откосыДляЖурнала(проём.reveal)}; `
          + (сосед === null
            ? "вторая сторона не привязана"
            : `вторая сторона — «${сосед.room.name}», ${wallName(сосед.order, сосед.label)},`
              + ` откосы ${откосыДляЖурнала(проём.adjoiningReveal)}`),
      }, tx);
    });

    return this.view(user, code, стена.room.set);
  }

  /** Проём объекта с обеими стенами и их помещениями; чужой — 404. */
  private async проёмОбъекта(projectId: string, id: string) {
    const проём = await this.prisma.wallOpening.findFirst({
      where: { id, wall: { room: { projectId } } },
      include: { wall: { include: { room: true } }, adjoiningWall: { include: { room: true } } },
    });
    if (проём === null) {
      throw new NotFoundException({ message: "Проём не найден или недоступен." });
    }
    return проём;
  }

  /**
   * Правка проёма: размеры, откосы сторон, привязка второй стороны.
   *
   * Привязка — то самое «одно касание» в строке стены соседа (решение
   * Э11-2.2 «а»): `adjoiningWallId` — стена соседа, `adjoiningReveal` —
   * откосы его стороны. Новая вторая сторона без своих откосов получает
   * пустые, а не прежние: прежние мерились у другой стены.
   */
  async updateOpening(
    user: RequestUser,
    code: string,
    id: string,
    input: UpdateWallOpening,
  ): Promise<MeasureView> {
    const project = await this.projectOf(user, code);
    const before = await this.проёмОбъекта(project.id, id);

    const сторонаБ = input.adjoiningWallId === undefined ? before.adjoiningWallId : input.adjoiningWallId;
    const сменаБ = сторонаБ !== before.adjoiningWallId;
    const сосед = !сменаБ
      ? before.adjoiningWall
      : сторонаБ === null ? null : await this.стенаСоседа(project.id, before.wall.room, сторонаБ);
    let откосыБ: bigint | null;
    if (сторонаБ === null) {
      if ((input.adjoiningReveal ?? null) !== null) {
        throw new BadRequestException({ message: ОТКОСЫ_БЕЗ_СТЕНЫ });
      }
      откосыБ = null;
    } else if (input.adjoiningReveal !== undefined) {
      откосыБ = input.adjoiningReveal === null ? null : BigInt(input.adjoiningReveal);
    } else {
      откосыБ = сменаБ ? null : before.adjoiningReveal;
    }
    const after = {
      kind: input.kind ?? before.kind,
      width: input.width === undefined ? before.width : BigInt(input.width),
      height: input.height === undefined ? before.height : BigInt(input.height),
      reveal: input.reveal === undefined ? before.reveal : input.reveal === null ? null : BigInt(input.reveal),
      adjoiningWallId: сторонаБ,
      adjoiningReveal: откосыБ,
    };

    const комнатаА = before.wall.room.name;
    const текст = проёмДляЖурнала(before);
    const где = (стена: typeof before.adjoiningWall): string =>
      стена === null ? "не привязана" : `«${стена.room.name}», ${wallName(стена.order, стена.label)}`;

    await this.prisma.$transaction(async (tx) => {
      await tx.wallOpening.update({ where: { id: before.id }, data: after });
      const запись = (field: string, oldValue: string | null, newValue: string | null) =>
        this.audit.record({
          orgId: user.orgId, actorId: user.id, entity: "MeasureRoom", entityId: project.id,
          field: `${комнатаА} — ${текст}: ${field}`, oldValue, newValue,
        }, tx);
      const стало = проёмДляЖурнала(after);
      if (стало !== текст) await запись("вид и размеры", текст, стало);
      if (after.reveal !== before.reveal) {
        await запись(`откосы стороны «${комнатаА}»`, откосыДляЖурнала(before.reveal), откосыДляЖурнала(after.reveal));
      }
      if (сменаБ) await запись("вторая сторона", где(before.adjoiningWall), где(сосед));
      if (сосед !== null && after.adjoiningReveal !== before.adjoiningReveal) {
        await запись(
          `откосы стороны «${сосед.room.name}»`,
          сменаБ ? "не измерены" : откосыДляЖурнала(before.adjoiningReveal),
          откосыДляЖурнала(after.adjoiningReveal),
        );
      }
    });

    return this.view(user, code, before.wall.room.set);
  }

  /** Удаление проёма — с обеих сторон сразу: запись одна на два помещения. */
  async deleteOpening(user: RequestUser, code: string, id: string): Promise<MeasureView> {
    const project = await this.projectOf(user, code);
    const проём = await this.проёмОбъекта(project.id, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.wallOpening.delete({ where: { id: проём.id } });
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "MeasureRoom",
        entityId: project.id,
        field: `${проём.wall.room.name} — ${wallName(проём.wall.order, проём.wall.label)}: проём удалён`,
        oldValue: проёмДляЖурнала(проём)
          + (проём.adjoiningWall === null
            ? ""
            : `; вторая сторона — «${проём.adjoiningWall.room.name}», `
              + wallName(проём.adjoiningWall.order, проём.adjoiningWall.label)),
        newValue: null,
      }, tx);
    });

    return this.view(user, code, проём.wall.room.set);
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
