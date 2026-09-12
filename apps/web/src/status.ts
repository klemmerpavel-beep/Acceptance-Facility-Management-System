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
 * Ключ статуса в разметке. Один и тот же в пилюле реестра, сегменте полосы
 * портфеля и метке её легенды: вид статуса берётся из одной тройки токенов
 * `--status-<ключ>-bar/-soft/-ink`, и совпадение кодировок держится общим
 * токеном, а не соглашением между тремя файлами.
 *
 * До 12.09.2026 кодировок было две и обе неполные: пилюли брали сигнальные
 * токены и сводили шесть статусов к трём видам («в работе» и «завершён» —
 * одна зелёная, «пауза» и «ждёт ответа» — одна жёлтая, «новый» и «архив» —
 * одна серая), а полоса первого экрана красила те же статусы порядковой
 * шкалой индиго. Один объект был двух цветов на одном экране.
 */
export const STATUS_KEY: Record<ProjectStatus, string> = {
  NEW: "new",
  IN_PROGRESS: "work",
  WAITING_CLIENT: "wait",
  PAUSED: "pause",
  DONE: "done",
  ARCHIVED: "archive",
};

/**
 * Пилюля статуса. Цвет — второй канал: рядом всегда слово (раздел 7
 * дизайн-системы). Но шесть разных состояний обязаны иметь шесть разных
 * видов: одинаковый вид у двух статусов сообщает о равенстве, которого нет.
 */
export const STATUS_PILL: Record<ProjectStatus, string> = {
  NEW: "pill pill--status-new",
  IN_PROGRESS: "pill pill--status-work",
  WAITING_CLIENT: "pill pill--status-wait",
  PAUSED: "pill pill--status-pause",
  DONE: "pill pill--status-done",
  ARCHIVED: "pill pill--status-archive",
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
