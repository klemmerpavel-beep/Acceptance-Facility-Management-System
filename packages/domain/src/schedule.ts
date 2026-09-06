/**
 * График производства работ.
 *
 * Единственное место, где живёт арифметика этапов. Сервер зовёт отсюда для
 * поля `readiness` в списке объектов, экран — для полосы плана на главной.
 * Обе стороны считают одним кодом, поэтому число в таблице и длина отрезка
 * над ней не могут разойтись.
 *
 * Почему готовность взвешивается по длительности
 * ----------------------------------------------
 * Простое среднее по этапам считает демонтаж на три дня равным чистовой
 * отделке на два месяца. На обмерном объекте R-99 это даёт 88,57 % против
 * 85,57 % — три процента, взятые из воздуха. Взвешивание по длительности
 * не идеально (день штукатурки и день уборки стоят разного), но оно хотя
 * бы опирается на измеренную величину, а не на порядковый номер строки.
 *
 * Почему пустой список даёт null, а не ноль
 * -----------------------------------------
 * Ноль означает «работа не начата». Отсутствие этапов означает «график не
 * заведён». Показать второе первым значит соврать про объект, у которого
 * работа идёт, а график ведут в тетради. Тип это и закрепляет: `null`
 * нельзя случайно сложить или показать процентом.
 *
 * Единицы: прогресс — базисные пункты (`BasisPoints`, 10000 = 100,00 %),
 * как надбавка сопровождения. Доля с плавающей точкой не применяется.
 * Геометрия полосы — обычные числа: это проценты раскладки, а не величина.
 */

import { basisPoints, divideRoundHalfUp, type BasisPoints } from "./money.js";
import { daysBetween } from "./portfolio.js";

/** Этап в том виде, в каком его читает арифметика. Имя и порядок ей не нужны. */
export interface StageSpan {
  /** ГГГГ-ММ-ДД. */
  readonly startsOn: string;
  /** ГГГГ-ММ-ДД, включительно: этап, идущий один день, длится один день. */
  readonly endsOn: string;
  readonly progress: BasisPoints;
}

/**
 * Длительность этапа в днях, обе границы включительно.
 *
 * Этап 02.03 — 02.03 длится один день, а не ноль: иначе однодневная
 * приёмка получила бы нулевой вес и выпала из готовности целиком.
 * Перевёрнутый отрезок (конец раньше начала) даёт один день, а не
 * отрицательный вес: отказывать здесь нечему — данные уже в базе, а
 * отрицательный вес испортил бы итог по всему объекту.
 */
export function stageDays(stage: StageSpan): number {
  return Math.max(1, daysBetween(stage.startsOn, stage.endsOn) + 1);
}

/**
 * Готовность объекта в базисных пунктах, средневзвешенная по длительности
 * этапов. `null` — этапов нет, готовность не задана.
 */
export function projectReadiness(stages: readonly StageSpan[]): BasisPoints | null {
  if (stages.length === 0) return null;

  let weighted = 0n;
  let total = 0n;
  for (const stage of stages) {
    const days = BigInt(stageDays(stage));
    weighted += days * (stage.progress as bigint);
    total += days;
  }

  return basisPoints(divideRoundHalfUp(weighted, total));
}

/** Окно графика: крайние даты и длина в днях, обе границы включительно. */
/**
 * Идёт ли работа по этапу в этот день. Границы включены: этап, начатый
 * сегодня, сегодня же и идёт.
 *
 * Нужна недельной полосе главной: день без событий сам по себе ничего не
 * сообщает, а «в работе четыре объекта» сообщает. Величина считается из
 * тех же этапов, что и план работ, — иначе неделя и план разошлись бы.
 *
 * Тип сужен до двух дат намеренно: предикат не смотрит на прогресс, и
 * требовать его значило бы заставлять вызывающего строить величину,
 * которая здесь не нужна.
 */
export function coversDay(stage: Pick<StageSpan, "startsOn" | "endsOn">, day: string): boolean {
  return stage.startsOn <= day && day <= stage.endsOn;
}

export interface PlanWindow {
  readonly from: string;
  readonly to: string;
  readonly days: number;
}

/**
 * Окно, вмещающее все переданные этапы. `null` — этапов нет ни одного.
 *
 * Окно строится по этапам, а не по срокам договора: объект, у которого
 * работы начались раньше подписания или уехали за срок, обязан помещаться
 * в полосу целиком. Полоса, обрезающая просроченный хвост, скрывает ровно
 * то, ради чего на неё смотрят.
 */
export function planWindow(
  stages: readonly Pick<StageSpan, "startsOn" | "endsOn">[],
): PlanWindow | null {
  const first = stages[0];
  if (first === undefined) return null;

  let from = first.startsOn;
  let to = first.endsOn;
  for (const stage of stages) {
    if (stage.startsOn < from) from = stage.startsOn;
    if (stage.endsOn > to) to = stage.endsOn;
  }

  return { from, to, days: Math.max(1, daysBetween(from, to) + 1) };
}

/**
 * Окно вокруг дня: `months` месяцев, считая с предыдущего.
 *
 * Полоса, растянутая на весь диапазон этапов портфеля, отдаёт текущему
 * месяцу одну двенадцатую ширины, а завершённому прошлому году — половину
 * экрана. Смотрят на неё ради того, что горит сейчас, и окно строится
 * вокруг сегодняшнего дня.
 *
 * Назад отсчитывается ровно один месяц, а не половина срока: прошлое нужно
 * затем, чтобы увидеть хвост просрочки, и одного месяца для этого хватает.
 * Остальная ширина уходит вперёд, где лежит работа, которую ещё можно
 * успеть сделать.
 */
export function windowAround(day: string, months: number): PlanWindow {
  const [year, month] = day.split("-").map(Number);
  if (year === undefined || month === undefined) {
    throw new Error(`Дата ${day} не в формате ГГГГ-ММ-ДД`);
  }

  const начало = new Date(Date.UTC(year, month - 2, 1));
  // Нулевой день следующего месяца — последний день текущего.
  const конец = new Date(Date.UTC(year, month - 2 + months, 0));
  const iso = (value: Date): string => value.toISOString().slice(0, 10);
  const from = iso(начало);
  const to = iso(конец);

  return { from, to, days: Math.max(1, daysBetween(from, to) + 1) };
}

/* ---------------------------------------------------------------------------
   Календарная арифметика окна правки
   --------------------------------------------------------------------------
   Экран правки графика считает не в процентах, а в днях: отрезок тянут
   указателем, и смещение обязано ложиться на границу дня. Проценты для
   этого не годятся — обратный перевод даёт то 3,999, то 4,001 дня, и
   отрезок «прилипает» через раз. Арифметика живёт здесь, рядом с остальной
   работой над датами: два места, считающие дни, разойдутся на високосном
   годе, и разойдутся молча. */

/** День, сдвинутый на `delta` суток. Переход через месяц и год — по календарю. */
export function shiftDay(day: string, delta: number): string {
  const moment = new Date(`${day}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() + delta);
  return moment.toISOString().slice(0, 10);
}

/** Номер дня в окне от нуля. Отрицательный и запредельный не отсекаются. */
export function dayIndex(day: string, window: PlanWindow): number {
  return daysBetween(window.from, day);
}

/** Дни окна подряд, включая обе границы. */
export function windowDays(window: PlanWindow): readonly string[] {
  const days: string[] = [];
  for (let index = 0; index < window.days; index += 1) days.push(shiftDay(window.from, index));
  return days;
}

/** Календарный месяц, в который попадает день. */
export function monthWindow(day: string): PlanWindow {
  const [year, month] = day.split("-").map(Number);
  if (year === undefined || month === undefined) {
    throw new Error(`Дата ${day} не в формате ГГГГ-ММ-ДД`);
  }
  const iso = (value: Date): string => value.toISOString().slice(0, 10);
  const from = iso(new Date(Date.UTC(year, month - 1, 1)));
  // Нулевой день следующего месяца — последний день текущего.
  const to = iso(new Date(Date.UTC(year, month, 0)));
  return { from, to, days: daysBetween(from, to) + 1 };
}

/**
 * Первый день месяца, сдвинутого на `delta` месяцев.
 *
 * Считается от первого числа, а не от переданного дня: сдвиг 31 марта на
 * месяц назад дал бы 3 марта — февраль короче, и лишние дни переполняются
 * в следующий месяц.
 */
export function shiftMonth(day: string, delta: number): string {
  const [year, month] = day.split("-").map(Number);
  if (year === undefined || month === undefined) {
    throw new Error(`Дата ${day} не в формате ГГГГ-ММ-ДД`);
  }
  return new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 10);
}

/** Суббота или воскресенье. Производственный календарь праздников не учитывается. */
export function isDayOff(day: string): boolean {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/** Отступ и длина отрезка в процентах ширины окна. */
export interface BarGeometry {
  readonly offset: number;
  readonly length: number;
}

/** Округление до сотых: сотая доля процента на полосе в 1000 px — десятая пикселя. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Геометрия отрезка этапа внутри окна.
 *
 * Этап, целиком выпавший из окна, даёт нулевую длину, а не отрицательный
 * отступ: вызывающий волен его не рисовать. Отрезок, начавшийся до окна,
 * прижимается к левому краю — обрезается ровно то, чего в окне нет.
 */
export function barGeometry(stage: StageSpan, window: PlanWindow): BarGeometry {
  const start = Math.max(0, daysBetween(window.from, stage.startsOn));
  const end = Math.min(window.days, daysBetween(window.from, stage.endsOn) + 1);
  const length = Math.max(0, end - start);

  return {
    offset: round2((start / window.days) * 100),
    length: round2((length / window.days) * 100),
  };
}

/**
 * Положение дня в окне, в процентах. `null` — день вне окна.
 *
 * Отсчёт идёт от середины дня, а не от его начала: вертикаль текущего дня
 * должна стоять посреди своей клетки, иначе она сольётся со стыком
 * вчерашнего и сегодняшнего.
 */
export function dayOffset(day: string, window: PlanWindow): number | null {
  const index = daysBetween(window.from, day);
  if (index < 0 || index >= window.days) return null;
  return round2(((index + 0.5) / window.days) * 100);
}

/* ---------------------------------------------------------------------------
   Валидатор дат этапа
   -------------------------------------------------------------------------- */

/** Пара дат этапа, которую проверяет валидатор. Прогресс ему не нужен. */
export interface StageDates {
  /** ГГГГ-ММ-ДД. */
  readonly startsOn: string;
  /** ГГГГ-ММ-ДД. */
  readonly endsOn: string;
}

/** Сроки объекта по договору: границы, вне которых этап стоять не может. */
export interface ProjectRange {
  /** ГГГГ-ММ-ДД. */
  readonly from: string;
  /** ГГГГ-ММ-ДД. */
  readonly to: string;
}

/** ДД.ММ.ГГГГ — вид, в котором дата называется человеку. */
const день = (iso: string): string => {
  const [год, месяц, число] = iso.split("-");
  return `${число ?? "??"}.${месяц ?? "??"}.${год ?? "????"}`;
};

/**
 * Существует ли дата в календаре.
 *
 * `new Date("2028-02-30")` не бросает исключения — он молча даёт 1 марта.
 * Поэтому дата собирается обратно и сверяется со строкой: несуществующее
 * число само себя выдаёт сдвигом.
 */
const существует = (iso: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(iso)) return false;
  const дата = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(дата.getTime()) && дата.toISOString().slice(0, 10) === iso;
};

const год = (iso: string): number => Number.parseInt(iso.slice(0, 4), 10);

/**
 * Причина, по которой даты этапа нельзя записать, или `null`.
 *
 * Свод правил один на сервер и на экран (БП-11 норматива проекта): два
 * независимых свода расходятся на третьей правке, и тогда экран показывает
 * подсказку там, где сервер пропускает, — или наоборот.
 *
 * Правила проверяются в объявленном порядке, и первый отказ возвращается
 * сразу: человеку нужна одна причина, а не список из трёх. Порядок выбран
 * от грубого к тонкому — несуществующая дата делает бессмысленным и
 * сравнение с началом, и проверку года.
 *
 * Материал для проверки не выдуман: в графике заказчика восемь дефектных
 * дат на семнадцать строк, включая 30 февраля и четыре года за пределами
 * проекта. Каждая из восьми стоит отдельным случаем в тестах.
 *
 * Почему отказов только два вида, а третий — предупреждение
 * --------------------------------------------------------
 * Несуществующая дата и перевёрнутый отрезок невозможны: такой этап не
 * бывает ни при каком стечении обстоятельств, и записывать его нельзя.
 * Год за пределами договора ±1 — тоже отказ: это опечатка в разряде года,
 * а не срок.
 *
 * А вот дата позже срока сдачи — не дефект. Работы срываются, и система,
 * отказавшаяся записать реальное отставание, заставит вести график в
 * тетради. Поэтому такая дата принимается и сопровождается предупреждением
 * (`stageDateWarning`): человек видит, на сколько этап выходит за договор,
 * и решает сам. Перечень дефектных дат заказчика относит `26.02.27` и
 * `24.07.27` к дефектам; валидатор их не отклоняет — по этому правилу они
 * попадают в предупреждение, потому что отличить срыв от опечатки система
 * не может, а человек может.
 */
/**
 * Диапазон объекта из трёх его дат.
 *
 * Ни начала работ, ни срока сдачи может не быть — тогда границей служит
 * дата заведения. Отказаться проверять вовсе было бы хуже: именно на
 * объекте без срока опечатка в годе и остаётся незамеченной.
 *
 * Выводится здесь, а не на сервере и на экране порознь: два вывода
 * разойдутся, и человек получит отказ там, где экран обещал согласие.
 */
export function projectRange(dates: {
  readonly startedAt: string | null;
  readonly deadline: string | null;
  readonly createdAt: string;
}): ProjectRange {
  const from = dates.startedAt ?? dates.createdAt;
  const to = dates.deadline ?? dates.startedAt ?? dates.createdAt;
  return from <= to ? { from, to } : { from: to, to: from };
}

export function stageDateFault(dates: StageDates, range: ProjectRange): string | null {
  for (const [iso, что] of [[dates.startsOn, "начала"], [dates.endsOn, "окончания"]] as const) {
    if (!существует(iso)) {
      return `${день(iso)} не существует. Укажите существующую дату ${что}.`;
    }
  }

  if (dates.endsOn < dates.startsOn) {
    return `Окончание ${день(dates.endsOn)} раньше начала ${день(dates.startsOn)}. Проверьте порядок дат.`;
  }

  /* Год в пределах договора ±1. Допуск в год нужен затем, что этап может
     начаться до подписания и закончиться после сдачи; всё, что дальше, —
     опечатка в годе, а не срок. */
  const снизу = год(range.from) - 1;
  const сверху = год(range.to) + 1;
  for (const iso of [dates.startsOn, dates.endsOn]) {
    if (год(iso) < снизу || год(iso) > сверху) {
      return `Год ${String(год(iso))} за пределами проекта ${день(range.from)} — ${день(range.to)}.`;
    }
  }

  return null;
}

/**
 * Предупреждение о сроке, выходящем за договор, или `null`.
 *
 * Отдельно от отказа: отказ означает «так не бывает», предупреждение —
 * «так бывает, но посмотрите». Смешать их значит либо блокировать
 * настоящее отставание, либо молча пропускать опечатку.
 */
export function stageDateWarning(dates: StageDates, range: ProjectRange): string | null {
  if (stageDateFault(dates, range) !== null) return null;
  if (dates.endsOn <= range.to) return null;
  const дней = daysBetween(range.to, dates.endsOn);
  return `Окончание ${день(dates.endsOn)} позже срока сдачи ${день(range.to)} на ${String(дней)} дн.`;
}
