import { useMemo, useState } from "react";

/**
 * Список по единому образцу. Норматив: `docs/03_DESIGN_SYSTEM.md`, §5.14.
 *
 * Все табличные разделы — объекты, контрагенты, платежи — устроены
 * одинаково: заголовок и действие слева, число записей и поиск справа,
 * сортировка по каждой колонке, чередование строк, счётчик показанного.
 * Разное устройство списков заставляет вспоминать, где искать поиск.
 *
 * Сортировка и фильтрация — на клиенте: в разделе меньше двухсот строк.
 * Порог назван, чтобы переход на серверную страницу был решением, а не
 * авралом.
 */

/** Величина, по которой колонка сортируется и ищется. */
export type CellValue = string | number | bigint | null;

export interface Column<Row> {
  key: string;
  label: string;
  /** Что сравнивать при сортировке и что искать. */
  value: (row: Row) => CellValue;
  /** Что показывать. По умолчанию — само значение. */
  render?: (row: Row) => React.ReactNode;
  /** Числовая колонка выравнивается по правому краю. */
  numeric?: boolean;
  /** Колонка, по которой не ищут: код статуса, служебный признак. */
  unsearchable?: boolean;
}

const PAGE_SIZES = [10, 25, 50] as const;
/** Выше этого порога клиентская сортировка перестаёт быть уместной. */
const CLIENT_LIMIT = 200;

/** Сравнение: числа по величине, строки по правилам русского алфавита. */
function compare(a: CellValue, b: CellValue): number {
  // Пусто всегда внизу: «сметы нет» не должно вытеснять объекты со сметой.
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  if (typeof a === "string" || typeof b === "string") {
    return String(a).localeCompare(String(b), "ru");
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

const haystack = (value: CellValue): string => (value === null ? "" : String(value).toLowerCase());

export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  title,
  action,
  searchLabel,
  emptyTitle,
  emptyText,
}: {
  rows: readonly Row[];
  columns: readonly Column<Row>[];
  rowKey: (row: Row) => string;
  /** Заголовок подраздела. Не задаётся, когда список — единственное
   *  содержимое страницы: обложка уже назвала его, и второй заголовок с тем
   *  же словом читается как ошибка вёрстки. */
  title?: string;
  action?: React.ReactNode;
  searchLabel: string;
  emptyTitle: string;
  emptyText: string;
}): React.JSX.Element {
  const [sort, setSort] = useState<{ key: string; descending: boolean } | null>(null);
  const [query, setQuery] = useState("");
  const [size, setSize] = useState<number>(PAGE_SIZES[0]);
  const [page, setPage] = useState(0);

  const found = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return rows;
    const searched = columns.filter((column) => column.unsearchable !== true);
    return rows.filter((row) => searched.some((column) => haystack(column.value(row)).includes(needle)));
  }, [rows, columns, query]);

  const ordered = useMemo(() => {
    if (sort === null) return found;
    const column = columns.find((candidate) => candidate.key === sort.key);
    if (column === undefined) return found;
    const sorted = [...found].sort((a, b) => compare(column.value(a), column.value(b)));
    return sort.descending ? sorted.reverse() : sorted;
  }, [found, columns, sort]);

  const pages = Math.max(1, Math.ceil(ordered.length / size));
  const current = Math.min(page, pages - 1);
  const from = current * size;
  const shown = ordered.slice(from, from + size);

  const toggle = (key: string): void => {
    setPage(0);
    setSort((previous) =>
      previous === null || previous.key !== key
        ? { key, descending: false }
        : previous.descending
          ? null
          : { key, descending: true },
    );
  };

  return (
    <div className="datatable">
      <div className="datatable__head">
        {(title !== undefined || action !== undefined) && (
          <div className="datatable__title">
            {title !== undefined && <h2 className="t-h2">{title}</h2>}
            {action}
          </div>
        )}
        <div className="datatable__controls">
          <label className="datatable__size">
            <span className="field__label">Записей</span>
            <span className="selectwrap">
              <select
                className="input"
                value={size}
                onChange={(event) => { setSize(Number(event.target.value)); setPage(0); }}
              >
                {PAGE_SIZES.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <svg className="icon selectwrap__chevron" aria-hidden="true"><use href="#i-chevron" /></svg>
            </span>
          </label>
          <label className="datatable__search">
            <svg className="icon" aria-hidden="true"><use href="#i-search" /></svg>
            <span className="visually-hidden">{searchLabel}</span>
            <input
              type="search"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(0); }}
              placeholder={searchLabel}
            />
          </label>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <p className="empty__title">{emptyTitle}</p>
          <p className="empty__text">{query.trim() === "" ? emptyText : "Поиск ничего не нашёл. Измените запрос."}</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="datatable__table">
            <thead>
              <tr>
                {columns.map((column) => {
                  const active = sort?.key === column.key;
                  return (
                    <th
                      key={column.key}
                      className={column.numeric === true ? "datatable__num" : undefined}
                      aria-sort={active ? (sort.descending ? "descending" : "ascending") : undefined}
                    >
                      <button type="button" className="datatable__sort" onClick={() => toggle(column.key)}>
                        {column.label}
                        <svg className="icon icon--sm" aria-hidden="true">
                          <use href={active ? (sort.descending ? "#i-sort-desc" : "#i-sort-asc") : "#i-sort"} />
                        </svg>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={column.numeric === true ? "datatable__num" : undefined}
                    >
                      {column.render === undefined ? column.value(row) : column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="datatable__foot">
        <p className="t-sm t-muted">
          {ordered.length === 0
            ? "Записей нет"
            : `Показано с ${from + 1} по ${from + shown.length} из ${ordered.length} ${
                ordered.length === rows.length ? "записей" : `найденных, всего ${rows.length}`
              }`}
        </p>
        {pages > 1 && (
          <div className="datatable__pager">
            <button
              type="button"
              className="btn btn--secondary"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              Назад
            </button>
            <span className="t-sm t-muted">{current + 1} из {pages}</span>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}
            >
              Дальше
            </button>
          </div>
        )}
      </div>

      {rows.length > CLIENT_LIMIT && (
        // Порог из норматива 5.14: дальше сортировка уходит на сервер.
        <p className="field__hint">
          В разделе {rows.length} строк — больше порога в {CLIENT_LIMIT}. Сортировка и поиск
          выполняются в браузере и на таком объёме уже заметны.
        </p>
      )}
    </div>
  );
}
