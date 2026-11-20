/**
 * Обмер помещений.
 *
 * Единственное место, где живут формулы обмерного плана. Экран их не
 * повторяет и сервер не повторяет: обе стороны зовут отсюда, поэтому
 * сводка на карточке объекта и число, ушедшее в смету, не могут разойтись.
 *
 * Что измеряется, а что выводится
 * -------------------------------
 * Прораб на объекте вносит четыре величины на помещение: площадь пола,
 * периметр пола, периметр потолка и высоту. Площадь стен и объём выводятся
 * из них. Разделение не произвольно — оно следует из того, чем эти числа
 * являются на стройке:
 *
 *   периметр потолка — линия примыкания стен к потолку, она замкнута;
 *   периметр пола    — длина плинтуса, то есть та же линия за вычетом
 *                      дверных проёмов и того, что закрыто встроенной
 *                      мебелью.
 *
 * Поэтому периметр пола меньше периметра потолка (в обмере «Московского
 * проспекта 116» — 86,07 против 97,39) и **не является периметром
 * многоугольника**: выводить его из площади нельзя ни при каких условиях.
 * Проверка: для семи прямоугольных помещений общей площадью 80,53 м²
 * изопериметрический минимум суммы периметров составляет около 89,4 м —
 * больше измеренных 86,07. Обе величины измеряются, ни одна не выводится.
 *
 * Отсюда же формула площади стен: она идёт по периметру ПОТОЛКА, потому
 * что штукатурится и красится вся стена, включая участки над дверными
 * проёмами. По периметру пола итог дал бы 232,39 м² вместо 262,95 —
 * недосчёт в тринадцать процентов оплачиваемой работы.
 *
 * Площадь стен двух видов (этап Э11, шаг 1; ADR-0002, вариант «б»)
 * ------------------------------------------------------------------
 * Прежняя величина остаётся как была — площадь стен без вычета проёмов,
 * «брутто». Рядом с ней — площадь стен за вычетом проёмов, «нетто»: брутто
 * минус суммарная площадь окон и дверей помещения. Вычитаются площади
 * проёмов, а не их откосы: откос — отдельная поверхность и считается
 * отдельной позицией. Брутто не заменяется нетто: по ней считались уже
 * подставленные количества сметы, и обе величины нужны работам разного
 * рода — грунтовка идёт по всей стене, обои и покраска — за вычетом окон.
 *
 * Стены и проёмы двух помещений (этап Э11, шаг 2; ADR-0002, вариант «в»)
 * ----------------------------------------------------------------------
 * Помещению можно завести стены: длина и необязательная высота (пусто —
 * высота помещения). С первой стеной помещение считается **только** по
 * стенам: площадь стен брутто и нетто — суммы по стенам, а итоги проёмов
 * помещения в расчёт не входят — сохранение со стенами их снимает (решение
 * Э11-2.1 «а»). Помещение без стен считается, как на шаге 1, — это запасной
 * расчёт, а не устаревший.
 *
 * Проём на стене — одна запись на два помещения: сторона А — стена, со
 * строки которой его завели, сторона Б — стена соседа, необязательна.
 * Площадь проёма вычитается из нетто каждой стены, на которой он стоит, с
 * любой стороны; откосы — измеренные величины своей стороны. В итогах
 * объекта проём между помещениями считается один раз.
 *
 * Сумма длин стен сверяется с измеренным периметром потолка по допуску Д15:
 * большее из 2 % периметра и 10 см. Сверх допуска — предупреждение, а не
 * отказ: обмер измеряет, а не выводит, и ниша, которую периметр потолка
 * обходит иначе, законна. По той же причине ни одна стена не выводится из
 * других величин: прямоугольника «по двум длинам» в продукте нет.
 *
 * Единицы
 * -------
 * Все величины — тысячные доли, целым числом (`Milliunits`), по тому же
 * правилу, что количества сметы: площадь в тысячных м², периметры в
 * тысячных м.п., высота в тысячных м, объём в тысячных м³. Число с
 * плавающей точкой не применяется: площади отсюда становятся количествами
 * позиций сметы, а количества умножаются на цены.
 */

import { divideRoundHalfUp, milliunits, type Milliunits } from "./money.js";
import { количествоТекстом } from "./acceptance.js";

/** Множитель тысячных долей — тот же, что у количеств сметы. */
const MILLI = 1000n;

/** Помещение в том виде, в каком его измерил прораб. */
export interface RoomMeasure {
  /** Площадь пола, тысячных м². */
  readonly floorArea: Milliunits;
  /** Периметр пола — длина плинтуса, тысячных м.п. */
  readonly floorPerimeter: Milliunits;
  /** Периметр потолка — замкнутая линия примыкания, тысячных м.п. */
  readonly ceilingPerimeter: Milliunits;
  /** Высота помещения, тысячных м. */
  readonly height: Milliunits;
  /**
   * Проёмы помещения: не больше строки на вид. Необязательны — помещение
   * без окон и дверей законно, и отсутствие строки значит «нет», а не ноль.
   *
   * Только у помещения без стен: у помещения со стенами итоги в расчёт не
   * входят, даже если переданы (решение Э11-2.1 «а»).
   */
  readonly openings?: readonly RoomOpening[];
  /**
   * Стены помещения в порядке строк листа (этап Э11, шаг 2). Нет или пусто —
   * помещение считается по четырём величинам, как на шаге 1.
   */
  readonly walls?: readonly WallMeasure[];
  /**
   * Проёмы, стоящие на стенах этого помещения с любой стороны — и свои
   * (сторона А), и соседей, привязанные к его стене стороной Б.
   */
  readonly wallOpenings?: readonly WallOpeningMeasure[];
}

/** Вид проёма: окна или двери. */
export type OpeningKind = "WINDOW" | "DOOR";

/**
 * Стена помещения, как её измерил прораб (этап Э11, шаг 2; ADR-0002, п. 1).
 */
export interface WallMeasure {
  readonly id: string;
  /** Подпись прораба: «у окна». Пусто — стена называется по порядку. */
  readonly label?: string | null;
  /** Длина, тысячных м. */
  readonly length: Milliunits;
  /** Высота стены, тысячных м; `null` — высота помещения. */
  readonly height: Milliunits | null;
}

/**
 * Проём на стене — одна запись на два помещения (ADR-0002, п. 2).
 *
 * Сторона А — стена `wallId`, сторона Б — стена соседа `adjoiningWallId`,
 * пусто — проём односторонний. Откосы — измеренные величины каждой
 * стороны, а не вывод из размеров: откосы двери трёхсторонние и меряются по
 * месту.
 */
export interface WallOpeningMeasure {
  readonly id: string;
  readonly kind: OpeningKind;
  /** Ширина и высота проёма, тысячных м. */
  readonly width: Milliunits;
  readonly height: Milliunits;
  readonly wallId: string;
  readonly adjoiningWallId: string | null;
  /** Откосы стороны А и стороны Б, тысячных м.п.; `null` — не измерены. */
  readonly reveal: Milliunits | null;
  readonly adjoiningReveal: Milliunits | null;
}

/** Проёмы одного вида в помещении: сколько, общая площадь и длина откосов. */
export interface RoomOpening {
  readonly kind: OpeningKind;
  readonly count: number;
  /** Площадь всех проёмов вида, тысячных м². */
  readonly area: Milliunits;
  /** Откосы по всем проёмам вида, тысячных м.п. */
  readonly reveal: Milliunits;
}

/** Итог проёмов одного вида по объекту. */
export interface OpeningTotals {
  readonly count: number;
  readonly area: Milliunits;
  readonly reveal: Milliunits;
}

/**
 * Произведение двух величин в тысячных долях. Результат тоже в тысячных,
 * поэтому произведение делится на 1000 по единственному правилу
 * округления системы.
 */
const product = (a: Milliunits, b: Milliunits): Milliunits =>
  divideRoundHalfUp(a * b, MILLI) as Milliunits;

/** Есть ли у помещения стены: с первой стеной оно считается только по ним. */
export function hasWalls(room: RoomMeasure): boolean {
  return (room.walls ?? []).length > 0;
}

/**
 * Имя стены на экране и в журнале: «Стена 2» по месту в помещении, а с
 * подписью — «Стена 1 · у окна» (норматив, раздел 55.1). Место — плотное
 * 1..N: подпись необязательна, и номер — единственное, чем стену без неё
 * назвать.
 */
export function wallName(position: number, label?: string | null): string {
  const подпись = label?.trim() ?? "";
  return подпись === "" ? `Стена ${String(position)}` : `Стена ${String(position)} · ${подпись}`;
}

/** Высота стены: своя, если измерена, иначе — высота помещения. */
export function wallHeight(room: RoomMeasure, wall: WallMeasure): Milliunits {
  return wall.height ?? room.height;
}

/** Площадь одной стены брутто: длина × высота стены. Проёмы не вычитаются. */
export function singleWallArea(room: RoomMeasure, wall: WallMeasure): Milliunits {
  return product(wall.length, wallHeight(room, wall));
}

/** Площадь проёма: ширина × высота, по единственному правилу округления. */
export function openingArea(opening: Pick<WallOpeningMeasure, "width" | "height">): Milliunits {
  return product(opening.width, opening.height);
}

/** Проёмы на стене — с любой стороны: и свои, и соседа, привязанные к ней. */
export function openingsOnWall(room: RoomMeasure, wallId: string): readonly WallOpeningMeasure[] {
  return (room.wallOpenings ?? []).filter(
    (opening) => opening.wallId === wallId || opening.adjoiningWallId === wallId,
  );
}

/** Площадь проёмов на стене, тысячных м². */
const openingsOnWallArea = (room: RoomMeasure, wallId: string): bigint =>
  openingsOnWall(room, wallId).reduce((всего, opening) => всего + openingArea(opening), 0n);

/**
 * Площадь одной стены нетто: брутто за вычетом проёмов, стоящих на ней с
 * любой стороны (ADR-0002, п. 4). Не ниже нуля — довод у `wallAreaNet`:
 * отрицательная площадь ушла бы количеством в смету, а лишек проёмов одной
 * стены не вычитается из соседних.
 */
export function singleWallAreaNet(room: RoomMeasure, wall: WallMeasure): Milliunits {
  const net = singleWallArea(room, wall) - openingsOnWallArea(room, wall.id);
  return (net > 0n ? net : 0n) as Milliunits;
}

/**
 * Предупреждение, если проёмы на стене больше её площади: нетто стены тогда
 * принята нулём. `position` — место стены в помещении, для её имени.
 */
export function singleWallNetWarning(room: RoomMeasure, wall: WallMeasure, position: number): string | null {
  const стена = singleWallArea(room, wall);
  const проёмы = openingsOnWallArea(room, wall.id);
  if (проёмы <= стена) return null;
  return `Проёмы на стене «${wallName(position, wall.label)}» (${количествоТекстом(milliunits(проёмы), "м²")})`
    + ` больше её площади (${количествоТекстом(стена, "м²")}): площадь стены нетто принята равной нулю.`
    + " Проверьте ширину и высоту проёмов, длину и высоту стены.";
}

/**
 * Площадь стен брутто.
 *
 * Помещение без стен — периметр потолка × высота, проёмы не вычитаются
 * (шаг 1). Помещение со стенами — сумма площадей стен брутто: стена ниже
 * помещения (антресоль) даёт меньше, чем дал бы периметр, и это правда
 * обмера, а не расхождение.
 */
export function wallArea(room: RoomMeasure): Milliunits {
  if (!hasWalls(room)) return product(room.ceilingPerimeter, room.height);
  let area = 0n;
  for (const wall of room.walls ?? []) area += singleWallArea(room, wall);
  return area as Milliunits;
}

/**
 * Проёмы помещения со стенами без повторов: проём, привязанный обеими
 * сторонами к стенам одного помещения, служба не примет, но и при нём
 * площадь не вычлась бы дважды.
 */
const проёмыНаСтенах = (room: RoomMeasure): readonly WallOpeningMeasure[] => {
  const свои = new Set((room.walls ?? []).map((wall) => wall.id));
  const поId = new Map<string, WallOpeningMeasure>();
  for (const opening of room.wallOpenings ?? []) {
    const наСтене = свои.has(opening.wallId)
      || (opening.adjoiningWallId !== null && свои.has(opening.adjoiningWallId));
    if (наСтене) поId.set(opening.id, opening);
  }
  return [...поId.values()];
};

/**
 * Суммарная площадь проёмов помещения — окон и дверей вместе, тысячных м².
 * Нет строки проёмов — нет и вычета: ноль, а не пропуск. У помещения со
 * стенами — проёмы на его стенах с любой стороны, итоги в расчёт не входят.
 */
export function openingsArea(room: RoomMeasure): Milliunits {
  let area = 0n;
  if (hasWalls(room)) {
    for (const opening of проёмыНаСтенах(room)) area += openingArea(opening);
    return area as Milliunits;
  }
  for (const opening of room.openings ?? []) area += opening.area;
  return area as Milliunits;
}

/**
 * Площадь стен нетто: брутто за вычетом суммарной площади проёмов.
 *
 * Не ниже нуля. Проёмы больше стен — почти наверняка промах ввода
 * (площадь двери в сантиметрах, высота помещения не та), но отказывать
 * здесь нельзя: проёмы вводятся тем же листом, что величины помещения, и
 * отказ запер бы обмер целиком. Отрицательная площадь ушла бы количеством
 * в смету и уменьшила бы её итог; поэтому ноль — и предупреждение
 * `wallAreaNetWarning`, которое экран обязан показать.
 *
 * Деления нет: брутто уже округлена по единственному правилу системы
 * (`product`), площади проёмов — измеренные тысячные. Разность целых
 * тысячных округления не требует.
 *
 * Помещение со стенами — сумма нетто стен (ADR-0002, п. 4), каждая не ниже
 * нуля: лишек проёмов одной стены не вычитается из соседних, по тому же
 * доводу, по которому лишек помещения не вычитается из итога объекта.
 */
export function wallAreaNet(room: RoomMeasure): Milliunits {
  if (hasWalls(room)) {
    let net = 0n;
    for (const wall of room.walls ?? []) net += singleWallAreaNet(room, wall);
    return net as Milliunits;
  }
  const net = wallArea(room) - openingsArea(room);
  return (net > 0n ? net : 0n) as Milliunits;
}

/**
 * Предупреждение, если проёмы помещения больше площади его стен: нетто
 * тогда принята нулём (`wallAreaNet`). Равенство законно — предупреждения
 * нет. Предупреждение, а не отказ — довод у `wallAreaNet`.
 *
 * У помещения со стенами — по стенам: называется каждая стена, у которой
 * проёмы больше её площади.
 */
export function wallAreaNetWarning(room: RoomMeasure): string | null {
  if (hasWalls(room)) {
    const поСтенам = (room.walls ?? [])
      .map((wall, index) => singleWallNetWarning(room, wall, index + 1))
      .filter((текст): текст is string => текст !== null);
    return поСтенам.length === 0 ? null : поСтенам.join(" ");
  }
  const стены = wallArea(room);
  const проёмы = openingsArea(room);
  if (проёмы <= стены) return null;
  return `Проёмы помещения (${количествоТекстом(проёмы, "м²")}) больше площади его стен`
    + ` (${количествоТекстом(стены, "м²")}): площадь стен нетто принята равной нулю.`
    + " Проверьте площадь окон и дверей, периметр потолка и высоту.";
}

/** Сумма длин стен, тысячных м; `null` — стен нет, сверять нечего. */
export function wallsLength(room: RoomMeasure): Milliunits | null {
  if (!hasWalls(room)) return null;
  let length = 0n;
  for (const wall of room.walls ?? []) length += wall.length;
  return length as Milliunits;
}

/** Нижняя граница допуска Д15 — 10 см, тысячных м. */
const ДОПУСК_НЕ_МЕНЬШЕ = 100n;

/**
 * Допуск Д15 расхождения суммы длин стен с периметром потолка: большее из
 * 2 % периметра и 10 см (решение заказчика от 07.11.2026). Процент — через
 * `divideRoundHalfUp`: правило округления одно.
 */
export function wallsTolerance(ceilingPerimeter: Milliunits): Milliunits {
  const процент = divideRoundHalfUp(ceilingPerimeter * 2n, 100n);
  return milliunits(процент > ДОПУСК_НЕ_МЕНЬШЕ ? процент : ДОПУСК_НЕ_МЕНЬШЕ);
}

/**
 * Предупреждение Д15: сумма длин стен расходится с измеренным периметром
 * потолка больше допуска (`wallsTolerance`). Расхождение ровно в допуск
 * законно. Предупреждение, а не отказ: отказ запер бы правильный обмер с
 * нишей, которую периметр потолка обходит иначе (норматив, раздел 55.2).
 */
export function wallsLengthWarning(room: RoomMeasure): string | null {
  const сумма = wallsLength(room);
  if (сумма === null) return null;
  const периметр = room.ceilingPerimeter;
  const допуск = wallsTolerance(периметр);
  const меньше = сумма < периметр;
  const расхождение = milliunits(меньше ? периметр - сумма : сумма - периметр);
  if (расхождение <= допуск) return null;
  return `Сумма длин стен ${количествоТекстом(сумма, "м")} ${меньше ? "меньше" : "больше"}`
    + ` периметра потолка ${количествоТекстом(периметр, "м")} на ${количествоТекстом(расхождение, "м")}`
    + ` — больше допуска ${количествоТекстом(допуск, "м")}.`
    + (меньше ? " Проверьте, не пропущена ли стена или ниша." : " Проверьте, не введена ли стена дважды.");
}

/**
 * Длина откосов своей стороны помещения, тысячных м.п. — величина
 * подстановки для поверхности «откосы» (решение Э11-2.6 «а»).
 *
 * Помещение без стен — сумма откосов его итогов. Помещение со стенами —
 * откосы той стороны каждого проёма на его стенах, что смотрит в это
 * помещение: стороны А у своих проёмов, стороны Б у проёмов соседа.
 * Неизмеренный откос — ноль, а не пропуск.
 */
export function revealLength(room: RoomMeasure): Milliunits {
  let length = 0n;
  if (!hasWalls(room)) {
    for (const opening of room.openings ?? []) length += opening.reveal;
    return length as Milliunits;
  }
  const свои = new Set((room.walls ?? []).map((wall) => wall.id));
  for (const opening of проёмыНаСтенах(room)) {
    if (свои.has(opening.wallId)) length += opening.reveal ?? 0n;
    else length += opening.adjoiningReveal ?? 0n;
  }
  return length as Milliunits;
}

/**
 * Проём, у которого удаляют стену стороны А (её саму или помещение целиком),
 * — решение Э11-2.3 «б» вместо прежнего ADR-0002, п. 7.
 *
 * Привязана сторона Б — проём переходит к соседу: сторона Б становится
 * стороной А, откосы сторон меняются местами. Дверь физически остаётся, и
 * удаление записи одного помещения не вправе молча менять нетто соседнего.
 * Стороны Б нет — проёму остаться негде: `null`, проём удаляется.
 *
 * Откос прежней стороны А остаётся во второй половине пары: стороны Б у
 * перешедшего проёма нет, и в расчёт он не входит, пока проём не привяжут
 * заново — тогда откосы новой стороны вводятся заново.
 */
export function transferOpening(opening: WallOpeningMeasure): WallOpeningMeasure | null {
  if (opening.adjoiningWallId === null) return null;
  return {
    ...opening,
    wallId: opening.adjoiningWallId,
    adjoiningWallId: null,
    reveal: opening.adjoiningReveal,
    adjoiningReveal: opening.reveal,
  };
}

/**
 * Проём словами: «Дверь 0,80 × 2,10 м» — вид и размеры, как в строке стены
 * и в журнале (норматив, разделы 55.1 и 55.5).
 */
export function openingText(opening: Pick<WallOpeningMeasure, "kind" | "width" | "height">): string {
  /* Число без единицы: единица одна на оба размера, в конце. */
  const число = (value: Milliunits): string => количествоТекстом(value, "").trimEnd();
  return `${opening.kind === "WINDOW" ? "Окно" : "Дверь"} ${число(opening.width)} × ${число(opening.height)}\u00A0м`;
}

/** Вид проёма словами во множественном числе: строки итогов. */
const ВИД_ИТОГОВ: Readonly<Record<OpeningKind, string>> = { WINDOW: "окна", DOOR: "двери" };

/**
 * Итоги проёмов помещения словами: «окна — 1 шт, 2,10 м², откосы 5,80 м.п.;
 * двери — …». Окна раньше дверей, как в листе. `null` — итогов нет.
 */
export function openingTotalsText(openings: readonly RoomOpening[]): string | null {
  const строки = (["WINDOW", "DOOR"] as const)
    .flatMap((вид) => openings.filter((opening) => opening.kind === вид))
    .map((opening) => `${ВИД_ИТОГОВ[opening.kind]} — ${String(opening.count)} шт,`
      + ` ${количествоТекстом(opening.area, "м²")}, откосы ${количествоТекстом(opening.reveal, "м.п.")}`);
  return строки.length === 0 ? null : строки.join("; ");
}

/**
 * Что снимет первая сохранённая стена (решение Э11-2.1 «а»; норматив,
 * раздел 55.3): с первой стеной помещение считается только по стенам, и его
 * итоги проёмов снимаются тем же сохранением. Лист называет это до
 * сохранения — числами, что сейчас в полях итогов. `null` — снимать нечего:
 * итогов нет или стены уже были.
 */
export function openingTotalsDropNote(room: RoomMeasure): string | null {
  if (hasWalls(room)) return null;
  const итоги = openingTotalsText(room.openings ?? []);
  if (итоги === null) return null;
  return "С первой стеной помещение считается по стенам."
    /* Итоги кончаются единицей «м.п.» с точкой: вторая точка не нужна. */
    + ` При сохранении снимутся итоги проёмов: ${итоги} Заведите эти проёмы на стенах.`;
}

/** Объём помещения: площадь пола × высота. */
export function roomVolume(room: RoomMeasure): Milliunits {
  return product(room.floorArea, room.height);
}

/** Итоги по объекту. Все величины в тысячных долях, кроме счётчика. */
export interface MeasureTotals {
  readonly rooms: number;
  readonly floorArea: Milliunits;
  /** Площадь стен брутто — без вычета проёмов. */
  readonly wallArea: Milliunits;
  /**
   * Площадь стен нетто — сумма нетто помещений. Не «брутто объекта минус
   * проёмы объекта»: у помещения, чьи проёмы больше стен, нетто — ноль, и
   * его лишек не вычитается из стен соседних помещений.
   */
  readonly wallAreaNet: Milliunits;
  readonly floorPerimeter: Milliunits;
  readonly ceilingPerimeter: Milliunits;
  readonly volume: Milliunits;
  /** Окна по объекту (план, пункт 7.4). */
  readonly windows: OpeningTotals;
  /** Двери по объекту (план, пункт 7.4). */
  readonly doors: OpeningTotals;
}

/**
 * Итоги проёмов одного вида: суммы по помещениям. Помещение без строки
 * этого вида даёт ноль — отсутствие проёмов, а не пропуск.
 *
 * Этап Э11, шаг 2 (решение Э11-2.1 «а»): итоги складываются из проёмов по
 * стенам — каждый проём один раз, даже если он стоит на стенах двух
 * помещений, — и итогов помещений без стен. Итоги помещения со стенами в
 * сумму не входят. Откосы проёма по стенам — откосы обеих сторон, но
 * стороны Б только привязанной: отделывается каждая сторона.
 *
 * Пока на объекте есть помещения без стен, их итоги считают межкомнатную
 * дверь с обеих сторон, — так было и на шаге 1; проём по стенам этого
 * повтора не добавляет, но и не снимает его у соседа без стен.
 */
function openingTotals(rooms: readonly RoomMeasure[], kind: OpeningKind): OpeningTotals {
  let count = 0;
  let area = 0n;
  let reveal = 0n;
  const поСтенам = new Map<string, WallOpeningMeasure>();
  for (const room of rooms) {
    if (hasWalls(room)) {
      for (const opening of проёмыНаСтенах(room)) {
        if (opening.kind === kind) поСтенам.set(opening.id, opening);
      }
      continue;
    }
    for (const opening of room.openings ?? []) {
      if (opening.kind !== kind) continue;
      count += opening.count;
      area += opening.area;
      reveal += opening.reveal;
    }
  }
  for (const opening of поСтенам.values()) {
    count += 1;
    area += openingArea(opening);
    reveal += (opening.reveal ?? 0n)
      + (opening.adjoiningWallId === null ? 0n : opening.adjoiningReveal ?? 0n);
  }
  return { count, area: area as Milliunits, reveal: reveal as Milliunits };
}

/**
 * Итоги по объекту.
 *
 * Производные величины считаются по каждому помещению и суммируются в
 * тысячных долях; округление до сотых происходит один раз, при выводе на
 * экран. Обратный порядок — округлить каждое помещение, потом сложить —
 * даёт на этом обмере объём 217,44 м³ вместо 217,43. Это тот же класс
 * ошибки, ради которого в системе одно правило округления и одно место
 * его применения.
 *
 * Пустой список даёт нули, а не отказ: объект без обмера — законное
 * состояние, и экран показывает по нему честный ноль.
 */
export function measureTotals(rooms: readonly RoomMeasure[]): MeasureTotals {
  let floorArea = 0n;
  let walls = 0n;
  let wallsNet = 0n;
  let floorPerimeter = 0n;
  let ceilingPerimeter = 0n;
  let volume = 0n;

  for (const room of rooms) {
    floorArea += room.floorArea;
    floorPerimeter += room.floorPerimeter;
    ceilingPerimeter += room.ceilingPerimeter;
    walls += wallArea(room);
    wallsNet += wallAreaNet(room);
    volume += roomVolume(room);
  }

  return {
    rooms: rooms.length,
    floorArea: floorArea as Milliunits,
    wallArea: walls as Milliunits,
    wallAreaNet: wallsNet as Milliunits,
    floorPerimeter: floorPerimeter as Milliunits,
    ceilingPerimeter: ceilingPerimeter as Milliunits,
    volume: volume as Milliunits,
    windows: openingTotals(rooms, "WINDOW"),
    doors: openingTotals(rooms, "DOOR"),
  };
}
