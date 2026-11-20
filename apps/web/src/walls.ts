import type { MeasureRoom, MeasureWall, MeasureWallOpening } from "@priyomka/contracts";
import {
  milliunits, openingText, type Milliunits, type RoomMeasure, type WallMeasure, type WallOpeningMeasure,
} from "@priyomka/domain";
import { завести } from "./verbs.js";

/**
 * Стены и проёмы ответа обмера в том виде, который понимает домен (этап
 * Э11, шаг 2).
 *
 * Сервер отдаёт проём у каждой стены, на которой он стоит, — со стороной и
 * соседом. Домен хранит проём одной записью на два помещения: сторона А —
 * `wallId`, сторона Б — `adjoiningWallId`. Сборка здесь одна на лист
 * помещения, вкладку «Замер», лист позиции и двойник демонстрации: два
 * написания одной сборки разошлись бы на первой правке, и экран показал бы
 * нетто стены не тем числом, что сервер.
 */

const необязательная = (value: string | null): Milliunits | null => (value === null ? null : milliunits(value));

/** Проём ответа как запись домена: сторона А и сторона Б — по стороне строки. */
export function проёмДомена(wall: MeasureWall, opening: MeasureWallOpening): WallOpeningMeasure {
  const width = milliunits(opening.width);
  const height = milliunits(opening.height);
  if (opening.side === "A") {
    return {
      id: opening.id, kind: opening.kind, width, height,
      wallId: wall.id,
      adjoiningWallId: opening.other?.wallId ?? null,
      reveal: необязательная(opening.reveal),
      adjoiningReveal: необязательная(opening.other?.reveal ?? null),
    };
  }
  /* Сторона Б: эта стена — соседняя, первая сторона — у другого помещения.
     Без неё строки стороны Б не бывает: сервер отдаёт её только при
     привязанной стороне А. */
  return {
    id: opening.id, kind: opening.kind, width, height,
    wallId: opening.other?.wallId ?? wall.id,
    adjoiningWallId: wall.id,
    reveal: необязательная(opening.other?.reveal ?? null),
    adjoiningReveal: необязательная(opening.reveal),
  };
}

/** Проёмы на стенах помещений — каждый один раз. */
export function проёмыСтен(rooms: readonly MeasureRoom[]): WallOpeningMeasure[] {
  const поId = new Map<string, WallOpeningMeasure>();
  for (const room of rooms) {
    for (const wall of room.walls) {
      for (const opening of wall.openings) {
        if (!поId.has(opening.id)) поId.set(opening.id, проёмДомена(wall, opening));
      }
    }
  }
  return [...поId.values()];
}

/** Стена ответа как запись домена. */
export const стенаДомена = (wall: Pick<MeasureWall, "id" | "label" | "length" | "height">): WallMeasure => ({
  id: wall.id,
  label: wall.label,
  length: milliunits(wall.length),
  height: необязательная(wall.height),
});

/**
 * Помещение ответа в виде, который понимает домен: четыре величины, итоги
 * проёмов, стены и проёмы на них с любой стороны. Предупреждения — проёмы
 * больше стен, Д15 — считает домен по этой сборке, а не экран своим
 * правилом.
 */
export function обмерПомещения(room: MeasureRoom): RoomMeasure {
  return {
    floorArea: milliunits(room.floorArea),
    floorPerimeter: milliunits(room.floorPerimeter),
    ceilingPerimeter: milliunits(room.ceilingPerimeter),
    height: milliunits(room.height),
    openings: room.openings.map((opening) => ({
      kind: opening.kind, count: opening.count,
      area: milliunits(opening.area), reveal: milliunits(opening.reveal),
    })),
    walls: room.walls.map(стенаДомена),
    wallOpenings: проёмыСтен([room]),
  };
}

/**
 * Проёмы помещения со стенами одного вида — для плашки «Замера»: сколько,
 * площадь и откосы этой стороны. Проём, стоящий на двух стенах одного
 * помещения, служба не примет, но и при нём он сосчитался бы раз.
 */
export function проёмыВидаПоСтенам(
  room: MeasureRoom,
  kind: MeasureWallOpening["kind"],
): { count: number; area: bigint; reveal: bigint } {
  const поId = new Map<string, MeasureWallOpening>();
  for (const wall of room.walls) {
    for (const opening of wall.openings) {
      if (opening.kind === kind && !поId.has(opening.id)) поId.set(opening.id, opening);
    }
  }
  let area = 0n;
  let reveal = 0n;
  for (const opening of поId.values()) {
    area += BigInt(opening.area);
    reveal += BigInt(opening.reveal ?? "0");
  }
  return { count: поId.size, area, reveal };
}

/** Проём словами для строки стены и подтверждений: «Дверь 0,80 × 2,10 м». */
export const проёмСловами = (opening: Pick<MeasureWallOpening, "kind" | "width" | "height">): string =>
  openingText({ kind: opening.kind, width: milliunits(opening.width), height: milliunits(opening.height) });

/** Вид проёма словами — заголовок листа проёма: «Дверь · Спальня, Стена 3». */
export const ВИД_ПРОЁМА: Readonly<Record<MeasureWallOpening["kind"], string>> = {
  WINDOW: "Окно",
  DOOR: "Дверь",
};

/** Подпись органа проёма — строки стены и кнопки листа одна (раздел о глаголах). */
export const ДОБАВИТЬ_ПРОЁМ: Readonly<Record<MeasureWallOpening["kind"], string>> = {
  WINDOW: завести("окно"),
  DOOR: завести("дверь"),
};

/**
 * Какие проёмы без второй стороны строка стены соседа предлагает привязать
 * (решение Э11-2.2 «а»; П-80, вариант «а» до ответа заказчика): только
 * двери. Окно наружной стены второй стороны не получит никогда, и каждое
 * окно квартиры стояло бы предложением в каждой строке каждой стены; окно
 * между помещениями привязывается из своего листа выбором стены соседа.
 * Перечень один на строку стены и подсказку листа проёма: подсказка не
 * обещает предложения, которого строка не покажет (П-84).
 */
export const ПРЕДЛАГАЮТСЯ_К_ПРИВЯЗКЕ: readonly MeasureWallOpening["kind"][] = ["DOOR"];

/**
 * Подсказка листа проёма, когда у выбранного смежного помещения стен нет
 * (норматив 55.4): вторая сторона не привязана, сосед вычитает проём своими
 * итогами, и — что будет дальше. Дверь строка стены соседа предложит
 * привязать сама; окно — нет, его вторую сторону привязывают из листа этого
 * окна, когда у соседа появятся стены.
 */
export function подсказкаСоседБезСтен(kind: MeasureWallOpening["kind"], сосед: string): string {
  const итоги = kind === "DOOR" ? "двери" : "окна";
  const дальше = ПРЕДЛАГАЮТСЯ_К_ПРИВЯЗКЕ.includes(kind)
    ? `когда ему заведут стены, строка его стены предложит привязать ${kind === "DOOR" ? "эту дверь" : "этот проём"}.`
    : `вторую сторону привяжете из листа этого окна, когда у «${сосед}» будут стены.`;
  return `В помещении «${сосед}» стен нет — вторая сторона не привязана. «${сосед}» вычитает ${итоги} своими итогами; ${дальше}`;
}
