import type { ОтборАдреса } from "./route.js";
import { ОТБОР_ПОДПИСЬ } from "./turn.js";

/**
 * Полоса отбора над списком (этап Э8, ДР-1). Пункт очереди ведёт на список
 * с отбором ровно тех записей, что назвал числом; полоса говорит, что
 * показана часть, сколько записей в ней, и возвращает весь список одним
 * касанием. Без полосы отобранный список читался бы целым, и пропавшие
 * записи — потерянными.
 */
export function FilterBar({
  отбор,
  число,
  onReset,
}: {
  отбор: ОтборАдреса;
  число: number;
  onReset: () => void;
}): React.JSX.Element {
  return (
    <div className="filterbar" role="status" data-filter={отбор.вид} data-count={число}>
      <span className="t-sm">
        <b>Отбор:</b> {ОТБОР_ПОДПИСЬ[отбор.вид]} · {String(число)}
      </span>
      <button type="button" className="btn btn--text" onClick={onReset}>
        Показать все
      </button>
    </div>
  );
}

/** Отбор, пришедший экрану из адреса, и снятие его. */
export interface СОтбором {
  readonly отбор?: ОтборАдреса | null | undefined;
  readonly onСброситьОтбор?: (() => void) | undefined;
}

/**
 * Отобранные записи и полоса над ними. Отбор чужого экрана — `draft` на
 * вкладке актов — не отбирает ничего и полосы не даёт: адрес собран
 * руками, и показать весь список честнее, чем пустой.
 */
export function отобрать<T>(
  записи: readonly T[],
  { отбор, onСброситьОтбор }: СОтбором,
  правила: Partial<Record<ОтборАдреса["вид"], (запись: T, значение: string | null) => boolean>>,
): { записи: readonly T[]; полоса: React.JSX.Element | null } {
  const правило = отбор === undefined || отбор === null ? undefined : правила[отбор.вид];
  if (отбор === undefined || отбор === null || правило === undefined) return { записи, полоса: null };
  const отобраны = записи.filter((запись) => правило(запись, отбор.значение));
  return {
    записи: отобраны,
    полоса: <FilterBar отбор={отбор} число={отобраны.length} onReset={onСброситьОтбор ?? (() => undefined)} />,
  };
}
