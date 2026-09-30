/**
 * Согласование числа с существительным: «1 день», «2 дня», «5 дней».
 *
 * Правило живёт в домене, а не на экране: число со словом пишут и экраны,
 * и сервер — в журнал объекта и в тексты отказов. Прежде правило было
 * только у клиента, и сервер писал «1 позиций», «2 этапов», «1 пунктов»;
 * на экране несогласованными оставались «1 пакетов приёмки» и доступное
 * имя полосы портфеля «2 объектов» (полный аудит 30.09.2026, П-48).
 */
export function plural(count: number, one: string, few: string, many: string): string {
  const absolute = Math.abs(count) % 100;
  const last = absolute % 10;
  if (absolute > 10 && absolute < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

/** Число со словом в согласованной форме: `сколько(21, "позиция", …)` → «21 позиция». */
export const сколько = (count: number, one: string, few: string, many: string): string =>
  `${String(count)} ${plural(count, one, few, many)}`;
