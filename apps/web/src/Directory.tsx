import { useEffect, useState } from "react";
import type { ClientRow, WorkerRow } from "@priyomka/contracts";
import { formatKopecks } from "@priyomka/ui";
import { fetchClients, fetchWorkers } from "./api.js";

const money = (value: string): string => formatKopecks(BigInt(value));

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
      <section className="stack">
        <div className="section-head">
          <h2 className="t-h2">Заказчики</h2>
          <span className="t-sm t-muted">видны заказчики доступных объектов</span>
        </div>
        {clients.length === 0 ? (
          <div className="empty">
            <p className="empty__title">Заказчиков нет</p>
            <p className="empty__text">Заказчик появляется вместе с первым объектом.</p>
          </div>
        ) : (
          <div className="panel panel--flush">
            <div className="table-scroll">
              <table className="estimate">
                <thead>
                  <tr>
                    <th>Код</th>
                    <th>Заказчик</th>
                    <th>Реквизиты</th>
                    <th className="estimate__num">Объектов</th>
                    <th className="estimate__num">Итог смет</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((client) => (
                    <tr key={client.id}>
                      <td><span className="code-badge">{client.code}</span></td>
                      <td>{client.name}</td>
                      <td>
                        {client.requisites ?? (client.isCompany ? "Юридическое лицо" : "Физическое лицо")}
                      </td>
                      <td className="estimate__num">{client.projects}</td>
                      <td className="estimate__num">
                        {client.estimateTotal === "0" ? "—" : money(client.estimateTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

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
          <div className="cards">
            {workers.map((worker) => (
              <div className="tile stack stack--tight" key={worker.id}>
                <span className="t-body">{worker.name}</span>
                <span className="t-sm t-muted">
                  {worker.kind === "BRIGADE" ? "бригада" : "мастер"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
