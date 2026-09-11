import { useEffect, useState } from "react";
import type { ClientRow, WorkerRow } from "@priyomka/contracts";
import { formatKopecks } from "@priyomka/ui";
import { errorMessage, fetchClients, fetchWorkers } from "./api.js";
import { DataTable, type Column } from "./DataTable.js";
import { NewContactSheet } from "./NewContactSheet.js";

/**
 * Контакты — заказчики и работники в одном справочнике.
 *
 * Прежде это были два разных места: «Контрагенты» с таблицей заказчиков и
 * обещанная строкой «Персонал». Разделение шло от учётной системы, а не от
 * человека: руководитель ищет «телефон Фархата» и «кто заказчик на
 * Никитинской» одним движением и в одном списке.
 *
 * Различает записи колонка «Тип», а не раздел. Она же сортируется, так что
 * список сводится к одним заказчикам или одним бригадам одним нажатием на
 * заголовок — без фильтра, который пришлось бы объяснять.
 */

type Contact =
  | { kind: "client"; id: string; name: string; code: string; note: string;
      projects: number; total: string | null; wage: null }
  | { kind: "worker"; id: string; name: string; code: null; note: string;
      projects: number | null; total: null; wage: string | null };

const money = (value: string): string => formatKopecks(BigInt(value));

const toContacts = (clients: ClientRow[], workers: WorkerRow[]): Contact[] => [
  ...clients.map<Contact>((client) => ({
    kind: "client",
    id: `client-${client.id}`,
    name: client.name,
    code: client.code,
    note: client.requisites ?? (client.isCompany ? "Юридическое лицо" : "Физическое лицо"),
    projects: client.projects,
    total: client.estimateTotal === "0" ? null : client.estimateTotal,
    wage: null,
  })),
  ...workers.map<Contact>((worker) => ({
    kind: "worker",
    id: `worker-${worker.id}`,
    name: worker.name,
    code: null,
    note: worker.kind === "BRIGADE" ? "Расчётная единица сдельной оплаты" : "Мастер",
    /* Свод по рабочему приходит только руководителю: у прораба этих полей в
       ответе нет вовсе, и строка честно показывает прочерк, а не ноль. */
    projects: worker.projects ?? null,
    total: null,
    wage: worker.wageTotal ?? null,
  })),
];

const COLUMNS: readonly Column<Contact>[] = [
  {
    key: "name",
    label: "Контакт",
    value: (row) => row.name,
    render: (row) => row.name,
  },
  {
    key: "kind",
    label: "Тип",
    value: (row) => (row.kind === "client" ? "Заказчик" : "Бригада"),
    /* Обе пилюли нейтральные. Зелёный в системе означает «принято», и
       окрасить им вид контакта значило бы занять сигнальный цвет под
       категорию: после этого зелёная пилюля перестаёт что-либо значить.
       Различает виды слово, а не цвет. */
    render: (row) => <span className="pill">{row.kind === "client" ? "Заказчик" : "Бригада"}</span>,
  },
  {
    key: "code",
    label: "Код",
    value: (row) => row.code,
    render: (row) => (row.code === null ? <span className="t-muted">—</span> : <span className="code-badge">{row.code}</span>),
  },
  {
    key: "note",
    label: "Сведения",
    value: (row) => row.note,
    render: (row) => row.note,
  },
  {
    key: "projects",
    label: "Объектов",
    value: (row) => row.projects,
    render: (row) => (row.projects === null ? <span className="t-muted">—</span> : <>{row.projects}</>),
    numeric: true,
  },
  {
    key: "total",
    label: "Итог смет",
    value: (row) => (row.total === null ? null : BigInt(row.total)),
    render: (row) => (row.total === null ? <span className="t-muted">—</span> : <>{money(row.total)}</>),
    numeric: true,
  },
  /* Начисленное стоит своей колонкой, а не делит колонку с итогом смет.
     Итог сметы и начисление бригаде — разные величины; в одной колонке их
     сортировка сравнивала бы несравнимое, а заголовок врал бы половине
     строк. Пустая клетка честнее общего имени. */
  {
    key: "wage",
    label: "Начислено",
    value: (row) => (row.wage === null ? null : BigInt(row.wage)),
    render: (row) => (row.wage === null ? <span className="t-muted">—</span> : <>{money(row.wage)}</>),
    numeric: true,
  },
];

export function Contacts(): React.JSX.Element {
  const [clients, setClients] = useState<ClientRow[] | null>(null);
  const [workers, setWorkers] = useState<WorkerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  /** Что именно только что добавлено. Подтверждение действия — словами. */
  const [added, setAdded] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([fetchClients(), fetchWorkers()])
      .then(([c, w]) => { setClients(c); setWorkers(w); })
      .catch((cause: unknown) => { setError(errorMessage(cause)); });
  }, []);

  if (error !== null) {
    return (
      <main className="container">
        <div className="empty">
          <p className="empty__title">Справочник недоступен</p>
          <p className="empty__text">{error}</p>
        </div>
      </main>
    );
  }

  if (clients === null || workers === null) {
    return (
      <main className="container stack" aria-busy="true">
        <span className="skeleton skeleton--row" />
        <span className="skeleton skeleton--row" />
      </main>
    );
  }

  const rows = toContacts(clients, workers);

  return (
    <main className="container stack stack--loose">
      <div className="section-head">
        <h2 className="t-h2">Справочник</h2>
        <button type="button" className="btn btn--primary" onClick={() => { setAdding(true); }}>
          <svg className="icon" aria-hidden="true"><use href="#i-plus" /></svg>
          Добавить контакт
        </button>
      </div>

      {added !== null && (
        <p className="t-sm" role="status">
          Добавлено: {added}. Запись стоит в списке ниже.
        </p>
      )}

      {rows.length === 0 ? (
        <div className="empty">
          <p className="empty__title">Справочник пуст</p>
          <p className="empty__text">
            Заказчик нужен, чтобы завести объект; бригада — чтобы начислить за принятую работу.
            Начните с заказчика.
          </p>
        </div>
      ) : (
        <DataTable
          rows={rows}
          columns={COLUMNS}
          rowKey={(row) => row.id}
          searchLabel="Поиск по имени, коду и сведениям"
          emptyTitle="Контактов нет"
          emptyText="Заведите заказчика или бригаду."
        />
      )}

      {adding && (
        <NewContactSheet
          onClose={() => { setAdding(false); }}
          onCreated={(next) => {
            setClients(next.clients);
            setWorkers(next.workers);
            setAdded(next.name);
            setAdding(false);
          }}
        />
      )}
    </main>
  );
}
