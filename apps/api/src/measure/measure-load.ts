import type { Prisma, WallOpening } from "@prisma/client";
import {
  milliunits, wallName, type RoomMeasure, type WallMeasure, type WallOpeningMeasure,
} from "@priyomka/domain";

/**
 * Чтение обмера со стенами и проёмами (этап Э11, шаг 2).
 *
 * Обмер читают двое: служба замера — вкладку, и служба сметы — величины
 * источника подстановки для признака «обмер изменился». Правило сборки
 * помещения для домена одно, и написать его дважды значило бы однажды
 * развести «Замер» и признак в смете на одной и той же стене.
 */

/** Помещение вместе с итогами проёмов и стенами в порядке строк. */
export const ROOM_WITH_WALLS = {
  openings: true,
  walls: { orderBy: { order: "asc" } },
} satisfies Prisma.MeasureRoomInclude;

export type RoomWithWalls = Prisma.MeasureRoomGetPayload<{ include: typeof ROOM_WITH_WALLS }>;

/** Клиент базы: служба или транзакция — чтение одинаково. */
type Db = Prisma.TransactionClient;

/**
 * Помещения по условию и проёмы на их стенах — с любой стороны: и по стене
 * стороны А, и по стене стороны Б. Для набора хватило бы стороны А (обе
 * стены по правилу службы — одного набора), но для одного помещения проём
 * соседа, привязанный к его стене, иначе выпал бы из нетто.
 */
export async function обмерСоСтенами(
  db: Db,
  where: Prisma.MeasureRoomWhereInput,
): Promise<{ rooms: RoomWithWalls[]; openings: WallOpening[] }> {
  const rooms = await db.measureRoom.findMany({
    where,
    include: ROOM_WITH_WALLS,
    orderBy: [{ set: "asc" }, { order: "asc" }],
  });
  const openings = await db.wallOpening.findMany({
    where: { OR: [{ wall: { room: where } }, { adjoiningWall: { room: where } }] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return { rooms, openings };
}

/** Проём в виде, который понимает домен. */
export const проёмДляДомена = (opening: WallOpening): WallOpeningMeasure => ({
  id: opening.id,
  kind: opening.kind,
  width: milliunits(opening.width),
  height: milliunits(opening.height),
  wallId: opening.wallId,
  adjoiningWallId: opening.adjoiningWallId,
  reveal: opening.reveal === null ? null : milliunits(opening.reveal),
  adjoiningReveal: opening.adjoiningReveal === null ? null : milliunits(opening.adjoiningReveal),
});

/** Стена в виде, который понимает домен. */
export const стенаДляДомена = (wall: RoomWithWalls["walls"][number]): WallMeasure => ({
  id: wall.id,
  label: wall.label,
  length: milliunits(wall.length),
  height: wall.height === null ? null : milliunits(wall.height),
});

/**
 * Помещение для домена: четыре величины, итоги проёмов, стены и проёмы на
 * его стенах с любой стороны. Итоги передаются как есть: у помещения со
 * стенами их снимает сохранение, а домен их у такого помещения и не читает.
 */
export function помещениеДляДомена(room: RoomWithWalls, openings: readonly WallOpening[]): RoomMeasure {
  const свои = new Set(room.walls.map((wall) => wall.id));
  return {
    floorArea: milliunits(room.floorArea),
    floorPerimeter: milliunits(room.floorPerimeter),
    ceilingPerimeter: milliunits(room.ceilingPerimeter),
    height: milliunits(room.height),
    openings: room.openings.map((opening) => ({
      kind: opening.kind,
      count: opening.count,
      area: milliunits(opening.area),
      reveal: milliunits(opening.reveal),
    })),
    walls: room.walls.map(стенаДляДомена),
    wallOpenings: openings
      .filter((opening) => свои.has(opening.wallId)
        || (opening.adjoiningWallId !== null && свои.has(opening.adjoiningWallId)))
      .map(проёмДляДомена),
  };
}

/** Где стоит стена: её помещение, место и имя «Стена 1 · у окна». */
export interface WallPlace {
  readonly wall: RoomWithWalls["walls"][number];
  readonly room: RoomWithWalls;
  readonly name: string;
}

/** Указатель стен набора по опознавателю: имя стены и её помещение. */
export function стеныПоId(rooms: readonly RoomWithWalls[]): Map<string, WallPlace> {
  const указатель = new Map<string, WallPlace>();
  for (const room of rooms) {
    for (const wall of room.walls) {
      указатель.set(wall.id, { wall, room, name: wallName(wall.order, wall.label) });
    }
  }
  return указатель;
}
