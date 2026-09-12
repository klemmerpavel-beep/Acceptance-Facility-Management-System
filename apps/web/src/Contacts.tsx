import { useEffect, useState } from "react";
import { завести } from "./verbs.js";
import type { ClientRow, WorkerRow } from "@priyomka/contracts";
import { formatKopecks } from "@priyomka/ui";
import { errorMessage, fetchClients, fetchWorkers } from "./api.js";
import { DataTable, type Column } from "./DataTable.js";
import { tabArrowHandler } from "./tabs.js";
import { NewContactSheet } from "./NewContactSheet.js";

/**
 * Контакты — заказчики и бригады двумя вкладками одного экрана.
 *
 * Прежде оба вида стояли в одной таблице, а различала их колонка «Тип».
 * Цена этого решения видна в самих данных: у заказчика всегда пусто
 * «Начислено», у бригады — «Код» и «Итог смет». Треть таблицы была
 * гарантированными прочерками, и заголовок врал половине строк (аудит Г-6).
 * Вкладка называет вид, и колонки в ней — только те, что этот вид имеет.
 *
 * Решение заказчика от 12.09.2026. Названная цена — сквозной поиск сразу по
 * обоим спискам: поиск работает внутри вкладки. Принято сознательно.
 *
 * Полоса вкладок — тот же шаблон, что в карточке объекта и настройках
 * (`tabs.ts`): стрелки переводят выбор, Tab уводит в содержимое.
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
    /* Ноль не подменяется пустотой. Прежде «0» превращался в null, и в
       колонке «Итог смет» «смет нет» становилось неотличимо от «смет на ноль
       рублей» — два разных утверждения одним видом. Ноль есть факт: заказчик
       заведён, объекты на нём есть, а сумма пока нулевая. */
    total: client.estimateTotal,
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

/** Заказчик: код, имя, реквизиты, объекты, итог смет. Начисления ему не идут. */
const CLIENT_COLUMNS: readonly Column<Contact>[] = [
  {
    key: "code",
    label: "Код",
    value: (row) => row.code,
    render: (row) => (row.code === null
      ? <span className="t-muted">—</span>
      : <span className="code-badge">{row.code}</span>),
  },
  { key: "name", label: "Заказчик", value: (row) => row.name, render: (row) => row.name },
  { key: "note", label: "Реквизиты", value: (row) => row.note, render: (row) => row.note },
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
];

/** Бригада: имя, вид расчётной единицы, объекты, начислено. Кода и смет у неё нет. */
const WORKER_COLUMNS: readonly Column<Contact>[] = [
  { key: "name", label: "Бригада", value: (row) => row.name, render: (row) => row.name },
  /* Вид расчётной единицы — бригада или мастер. Прежде он уходил в
     «Сведения», а колонка «Тип» печатала «Бригада» и мастеру тоже: подпись
     противоречила данным в соседней клетке. */
  { key: "note", label: "Вид", value: (row) => row.note, render: (row) => row.note },
  {
    key: "projects",
    label: "Объектов",
    value: (row) => row.projects,
    render: (row) => (row.projects === null ? <span className="t-muted">—</span> : <>{row.projects}</>),
    numeric: true,
  },
  {
    key: "wage",
    label: "Начислено",
    value: (row) => (row.wage === null ? null : BigInt(row.wage)),
    render: (row) => (row.wage === null ? <span className="t-muted">—</span> : <>{money(row.wage)}</>),
    numeric: true,
  },
];

const ВКЛАДКИ = [
  { key: "clients", label: "Заказчики" },
  { key: "workers", label: "Бригады" },
] as const;

type Вкладка = (typeof ВКЛАДКИ)[number]["key"];

export function Contacts(): React.JSX.Element {
  const [clients, setClients] = useState<ClientRow[] | null>(null);
  const [workers, setWorkers] = useState<WorkerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [вкладка, setВкладка] = useState<Вкладка>("clients");
  const поКлавише = tabArrowHandler(
    ВКЛАДКИ.map((item) => item.key),
    вкладка,
    setВкладка,
    (key) => `tab-${key}`,
  );
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
          <p className="empty__title">Контакты недоступны</p>
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
  const строки = rows.filter((row) => (вкладка === "clients" ? row.kind === "client" : row.kind === "worker"));
  const колонки = вкладка === "clients" ? CLIENT_COLUMNS : WORKER_COLUMNS;

  return (
    <main className="container stack stack--loose">
      {/* Заголовка полотна нет: раздел назван обложкой, вкладки ниже
          называют содержимое, и третье имя того же экрана — «Справочник» —
          ничего не добавляло. Ряд держит одно действие. */}
      <div className="section-head section-head--action">
        <button type="button" className="btn btn--primary" onClick={() => { setAdding(true); }}>
          <svg className="icon" aria-hidden="true"><use href="#i-plus" /></svg>
          {завести("контакт")}
        </button>
      </div>

      {added !== null && (
        <p className="t-sm" role="status">
          Добавлено: {added}. Запись стоит в списке ниже.
        </p>
      )}

      <div className="tabs" role="tablist" onKeyDown={поКлавише}>
        {ВКЛАДКИ.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={`tab-${item.key}`}
            className="tabs__item"
            aria-selected={вкладка === item.key}
            aria-controls={`panel-${item.key}`}
            tabIndex={вкладка === item.key ? 0 : -1}
            onClick={() => { setВкладка(item.key); }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${вкладка}`} aria-labelledby={`tab-${вкладка}`}>
        {rows.length === 0 ? (
          <div className="empty">
            <p className="empty__title">Контактов пока нет</p>
            <p className="empty__text">
              Заказчик нужен, чтобы добавить объект; бригада — чтобы начислить за принятую работу.
              Начните с заказчика.
            </p>
          </div>
        ) : (
          <DataTable
            rows={строки}
            columns={колонки}
            rowKey={(row) => row.id}
            searchLabel={вкладка === "clients"
              ? "Поиск по имени, коду и реквизитам"
              : "Поиск по имени бригады"}
            emptyTitle={вкладка === "clients" ? "Заказчиков нет" : "Бригад нет"}
            emptyText={вкладка === "clients"
              ? "Заказчик нужен, чтобы добавить объект."
              : "Бригада нужна, чтобы начислить за принятую работу."}
          />
        )}
      </div>

      {adding && (
        <NewContactSheet
          onClose={() => { setAdding(false); }}
          onCreated={(next) => {
            setClients(next.clients);
            setWorkers(next.workers);
            setAdded(next.name);
            setAdding(false);
            /* Справочник открывается на той вкладке, куда попала запись:
               обещание «запись стоит в списке ниже» иначе не держится —
               заведённая бригада легла бы в скрытую вкладку. */
            setВкладка(next.kind === "client" ? "clients" : "workers");
          }}
        />
      )}
    </main>
  );
}
