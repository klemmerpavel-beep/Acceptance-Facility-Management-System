import type { ProjectSummary } from "@priyomka/contracts";

export type ProjectStatus = ProjectSummary["status"];

/** Названия статусов. Одно место на весь клиент: список, карточка, сводка. */
export const STATUS_LABEL: Record<ProjectStatus, string> = {
  NEW: "Новый",
  IN_PROGRESS: "В работе",
  PAUSED: "Пауза",
  WAITING_CLIENT: "Ждёт ответа",
  DONE: "Завершён",
  ARCHIVED: "Архив",
};

/**
 * Пилюля статуса. Цвет — усиление, не носитель смысла: рядом всегда текст
 * (раздел 7 дизайн-системы), поэтому нейтральный вид здесь не проблема.
 */
export const STATUS_PILL: Record<ProjectStatus, string> = {
  NEW: "pill",
  IN_PROGRESS: "pill pill--ok",
  PAUSED: "pill pill--warn",
  WAITING_CLIENT: "pill pill--warn",
  DONE: "pill pill--ok",
  ARCHIVED: "pill",
};

/** Порядок статусов в переключателе и сводке: от начала жизни объекта к её концу. */
export const STATUS_ORDER: readonly ProjectStatus[] = [
  "NEW", "IN_PROGRESS", "WAITING_CLIENT", "PAUSED", "DONE", "ARCHIVED",
];

/** Дата в русском написании. ISO-строка в интерфейсе не показывается. */
export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Только время. Дата в сгруппированной по дням ленте стоит заголовком группы. */
export const formatTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

/** Дата с днём недели: заголовок группы в ленте событий. */
export const formatDay = (iso: string): string =>
  new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit", month: "long", weekday: "short",
  });

export const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });

/**
 * Согласование числа с существительным. «1 день», «2 дня», «5 дней» —
 * без этого подпись срока читается как машинный вывод.
 */
export function plural(count: number, one: string, few: string, many: string): string {
  const absolute = Math.abs(count) % 100;
  const last = absolute % 10;
  if (absolute > 10 && absolute < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}
