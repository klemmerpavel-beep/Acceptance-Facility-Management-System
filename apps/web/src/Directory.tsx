import { useEffect, useState } from "react";
import type { ClientRow, WorkerRow } from "@priyomka/contracts";
import { formatKopecks } from "@priyomka/ui";
import { fetchClients, fetchWorkers } from "./api.js";
import { DataTable, type Column } from "./DataTable.js";

const money = (value: string): string => formatKopecks(BigInt(value));

/** Колонки заказчика. Сортируется каждая — норматив 5.14. */
const CLIENT_COLUMNS: readonly Column<ClientRow>[] = [
  {
    key: "code",
    label: "Код",
    value: (client) => client.code,
    render: (client) => <span className="code-badge">{client.code}</span>,
  },
  { key: "name", label: "Заказчик", value: (client) => client.name },
  {
    key: "requisites",
    label: "Реквизиты",
    value: (client) => client.requisites ?? (client.isCompany ? "Юридическое лицо" : "Физическое лицо"),
  },
  { key: "projects", label: "Объектов", value: (client) => client.projects, numeric: true },
  {
    key: "total",
    label: "Итог смет",
    // Сортировка по деньгам идёт по копейкам, а не по строке: «9 ₽»
    // не должно оказываться выше «1 000 ₽».
    value: (client) => BigInt(client.estimateTotal),
    render: (client) => (client.estimateTotal === "0" ? "—" : money(client.estimateTotal)),
    numeric: true,
  },
];

/**
 * Контрагенты: заказчики объектов и расчётные единицы сдельной оплаты.
 *
 * Бригада, а не мастер: расчёт по решению допроса ведётся с бригадой через
 * бригадира, состав бригады система не хранит.
 */
export function Directory(): React.JSX.Element {
  const [clients, setClients] = useState<ClientRow[] | null>(null);
  const [workers, setWorkers] = useState<WorkerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([fetchClients(), fetchWorkers()])
      .then(([clientRows, workerRows]) => {
        setClients(clientRows);
        setWorkers(workerRows);
        setError(null);
      })
      .catch((cause: Error) => setError(cause.message));
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

  return (
    <main className="container stack stack--loose">
      <DataTable
        rows={clients}
        columns={CLIENT_COLUMNS}
        rowKey={(client) => client.id}
        title="Заказчики"
        action={<span className="t-sm t-muted">видны заказчики доступных объектов</span>}
        searchLabel="Поиск по коду, имени и реквизитам"
        emptyTitle="Заказчиков нет"
        emptyText="Заказчик появляется вместе с первым объектом."
      />

      <section className="stack">
        <div className="section-head">
          <h2 className="t-h2">Бригады</h2>
          <span className="t-sm t-muted">получатели сдельного начисления</span>
        </div>
        {workers.length === 0 ? (
          <div className="empty">
            <p className="empty__title">Бригад нет</p>
            <p className="empty__text">Начисление адресуется бригаде, поэтому без бригад приёмка невозможна.</p>
          </div>
        ) : (
          // Ведомость, а не плитки: у бригады два поля, и коробка вокруг
          // двух слов добавляет к списку только рамки.
          <dl className="deflist">
            {workers.map((worker) => (
              <div className="deflist__row" key={worker.id}>
                <dt className="deflist__term">{worker.name}</dt>
                <dd className="deflist__value">
                  {worker.kind === "BRIGADE" ? "бригада" : "мастер"}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </main>
  );
}
