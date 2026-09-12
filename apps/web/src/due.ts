import { plural } from "./status.js";

/**
 * Срочность срока объекта — одна шкала на весь продукт.
 *
 * Прежде срок считали и красили три места по трём своим правилам: реестр
 * печатал дату красным при просрочке и нейтральным иначе, первый экран
 * ставил пилюлю трёх тонов с порогом в неделю, карточка — сплошную плашку
 * со словом «Просрочено на» либо «Осталось». Слова расходились там же:
 * «сдать сегодня» против «0 дней», «через 34 дня» против «34 дня» (аудит
 * интерфейса, Б-4).
 *
 * Ступеней четыре, и порог недели взят не с потолка: недельным ритмом
 * меряются сроки объектов и порог оплаты транша.
 */
export type DueLevel = "overdue" | "today" | "soon" | "later" | "none";

export interface Due {
  /** Ступень шкалы. */
  readonly level: DueLevel;
  /** Дней до срока; отрицательное — просрочка. `null` — срок не задан. */
  readonly days: number | null;
  /** Срок словами: «просрочен на 27 дней», «сдать сегодня», «через 34 дня». */
  readonly words: string;
  /** Класс пилюли срочности. */
  readonly pill: string;
}

const ДЕНЬ = 86_400_000;

/** Разница в календарных днях между двумя датами вида ГГГГ-ММ-ДД. */
export const daysUntil = (deadline: string, today: string): number =>
  Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / ДЕНЬ);

const СЛОВА = (days: number): string => {
  if (days < 0) {
    const прошло = Math.abs(days);
    return `просрочен на ${String(прошло)} ${plural(прошло, "день", "дня", "дней")}`;
  }
  if (days === 0) return "сдать сегодня";
  if (days === 1) return "сдать завтра";
  return `через ${String(days)} ${plural(days, "день", "дня", "дней")}`;
};

/**
 * Класс пилюли по ступени. Записан именами целиком, а не собран строкой:
 * механическая проверка мёртвых правил ищет объявленный класс в разметке
 * обычным поиском, и класс, собранный на ходу, она считает неиспользуемым
 * — правило либо снимут как мёртвое, либо проверку ослабят. Оба исхода
 * хуже перечисления из пяти строк.
 */
const ПИЛЮЛЯ: Record<DueLevel, string> = {
  overdue: "duepill duepill--overdue",
  today: "duepill duepill--today",
  soon: "duepill duepill--soon",
  later: "duepill duepill--later",
  none: "duepill duepill--none",
};

const СТУПЕНЬ = (days: number): DueLevel => {
  if (days < 0) return "overdue";
  if (days <= 1) return "today";
  if (days <= 7) return "soon";
  return "later";
};

/**
 * Срочность по числу дней. Отдельный вход нужен потому, что сводка
 * портфеля отдаёт дни, а не дату: разворачивать их обратно в дату ради
 * общей подписи значило бы считать одно и то же дважды и разойтись на
 * переходе через полночь.
 */
export function dueByDays(days: number | null): Due {
  if (days === null) {
    return { level: "none", days: null, words: "срок не задан", pill: ПИЛЮЛЯ.none };
  }
  const level = СТУПЕНЬ(days);
  return { level, days, words: СЛОВА(days), pill: ПИЛЮЛЯ[level] };
}

export function due(deadline: string | null, today: string): Due {
  return dueByDays(deadline === null ? null : daysUntil(deadline, today));
}
