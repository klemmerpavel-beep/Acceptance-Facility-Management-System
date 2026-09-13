import { useCallback, useEffect, useState } from "react";
import { formatKopecks, formatMeasure, formatPercent } from "@priyomka/ui";
import type { ActRow, ActView, Role } from "@priyomka/contracts";
import { errorMessage, fetchAct, fetchActs, signAct } from "./api.js";

/**
 * Вкладка «Документы» карточки объекта.
 *
 * Вопрос экрана: какие бумаги по объекту. Ключевое действие — сформировать
 * акт (`07_IA.md`, раздел 4); формировать его отдельно не нужно — акт есть
 * представление закрытого транша, и список показывает по одному акту на
 * каждый закрытый транш.
 *
 * **Открытый транш акта не имеет по определению.** Показывать строку «акт
 * ещё не сформирован» значило бы занять место обещанием вместо документа.
 *
 * Два вида акта различаются составом полей, а не оформлением: в клиентском
 * внутренних величин нет вовсе — не в ответе сервера, а значит и на экране.
 * Переключатель видов есть только у руководителя: прорабу внутренний вид не
 * отдаётся, и кнопка, которая всегда отказывает, — не кнопка.
 *
 * Печатается акт браузером: отдельного вывода в PDF продукт не заводит —
 * это новая зависимость, а печать листа даёт тот же результат.
 */

const дата = (iso: string): string => {
  const [год, месяц, день] = iso.split("-");
  return `${день ?? "??"}.${месяц ?? "??"}.${год ?? "????"}`;
};

export function Acts({ code, role }: { code: string; role: Role }): React.JSX.Element {
  const [rows, setRows] = useState<ActRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [открыт, setОткрыт] = useState<string | null>(null);
  const [act, setAct] = useState<ActView | null>(null);
  const [вид, setВид] = useState<"client" | "internal">("client");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchActs(code)
      .then((next) => { setRows(next); setError(null); })
      .catch((cause: unknown) => { setError(errorMessage(cause)); });
  }, [code]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (открыт === null) { setAct(null); return; }
    fetchAct(code, открыт, вид)
      .then((next) => { setAct(next); setError(null); })
      .catch((cause: unknown) => { setError(errorMessage(cause)); });
  }, [code, открыт, вид]);

  const отметить = (trancheId: string, signedAt: string): void => {
    setBusy(true);
    void signAct(code, trancheId, signedAt)
      .then((next) => { setRows(next); setError(null); })
      .catch((cause: unknown) => { setError(errorMessage(cause)); })
      .finally(() => { setBusy(false); });
  };

  if (error !== null && rows === null) return <p className="field__error" role="alert">{error}</p>;
  if (rows === null) return <p className="t-sm t-muted">Загружаем документы…</p>;

  if (rows.length === 0) {
    return (
      <div className="empty">
        <p className="empty__title">Актов пока нет</p>
        <p className="empty__text">
          Акт составляется из принятых позиций и закрывает транш. Первый появится, когда будет
          закрыт первый транш на вкладке «Транши».
        </p>
      </div>
    );
  }

  return (
    <div className="stack stack--loose">
      <div className="acts-screen stack stack--loose">
        <ul className="checks">
          {rows.map((row) => (
            <li className="check" key={row.trancheId} data-status={row.signedAt === null ? "DRAFT" : "CONFIRMED"}>
              <span className="code-badge">№ {row.number}</span>
              <div className="check__body">
                <p className="check__head">
                  <span className="t-strong">Акт № {row.number} по объекту {code}</span>
                  {row.signedAt === null
                    ? <span className="pill pill--warn">Не подписан</span>
                    : <span className="pill pill--ok">Подписан {дата(row.signedAt)}</span>}
                  {row.paidAt !== null && <span className="pill pill--ok">Оплачен</span>}
                </p>
                <p className="t-sm t-muted">
                  закрыт {дата(row.closedAt)} · позиций {row.positions}
                </p>
              </div>
              <div className="check__side">
                <span className="check__amount num">{formatKopecks(BigInt(row.total))}</span>
                <span className="check__actions">
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => { setОткрыт(открыт === row.trancheId ? null : row.trancheId); }}
                  >
                    {открыт === row.trancheId ? "Свернуть" : "Открыть акт"}
                  </button>
                  {role === "OWNER" && row.signedAt === null && (
                    <label className="field field--inline">
                      <span className="visually-hidden">Дата подписания акта № {row.number}</span>
                      <input
                        type="date"
                        className="input"
                        disabled={busy}
                        onChange={(event) => {
                          if (event.target.value !== "") отметить(row.trancheId, event.target.value);
                        }}
                      />
                    </label>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>

        {error !== null && <p className="field__error" role="alert">{error}</p>}

        {role === "OWNER" && act !== null && (
          <div className="segmented" role="group" aria-label="Вид акта">
            <button
              type="button"
              className="segmented__option"
              aria-pressed={вид === "client"}
              onClick={() => { setВид("client"); }}
            >
              Клиентский
            </button>
            <button
              type="button"
              className="segmented__option"
              aria-pressed={вид === "internal"}
              onClick={() => { setВид("internal"); }}
            >
              Внутренний
            </button>
          </div>
        )}
      </div>

      {act !== null && <ActSheet act={act} />}
    </div>
  );
}

/**
 * Сам акт. Верстается бланком, а не экраном: шапка сторон, ведомость работ,
 * итог и подписи. На печати остаётся только он — тем же приёмом, что у
 * обмерного плана: экранная часть скрыта одним классом, а не перечислением
 * блоков, которое устаревает на первой правке.
 */
function ActSheet({ act }: { act: ActView }): React.JSX.Element {
  const внутренний = act.audience === "internal";
  return (
    <div className="act">
      <div className="act__head">
        <p className="act__title">
          Акт выполненных работ № {act.number} по объекту {act.project.code}
        </p>
        <p className="t-sm t-muted">от {дата(act.closedAt)} · {act.project.address}</p>
      </div>

      <div className="act__parties">
        <div className="act__party">
          <p className="field__label--cap">Исполнитель</p>
          <p className="t-strong">{act.contractor.name}</p>
          {act.contractor.requisites !== null && <p className="t-sm">{act.contractor.requisites}</p>}
          {act.contractor.phone !== null && <p className="t-sm t-muted">{act.contractor.phone}</p>}
        </div>
        <div className="act__party">
          <p className="field__label--cap">Заказчик</p>
          <p className="t-strong">{act.client.name}</p>
          {act.client.requisites !== null && <p className="t-sm">{act.client.requisites}</p>}
        </div>
      </div>

      <div className="table-scroll">
        <table className="estimate act__table">
          <caption className="visually-hidden">
            Работы акта № {act.number}: {внутренний ? "внутренний вид" : "клиентский вид"}
          </caption>
          <thead>
            <tr>
              <th scope="col">Работа</th>
              <th scope="col">Ед.</th>
              <th scope="col" className="num">Кол-во</th>
              <th scope="col" className="num">Цена</th>
              <th scope="col" className="num">Сумма</th>
              {внутренний && <th scope="col" className="num">Начислено</th>}
              {внутренний && <th scope="col" className="num">Прибыль</th>}
            </tr>
          </thead>
          <tbody>
            {act.lines.map((line, индекс) => (
              <tr key={`${line.name}-${String(индекс)}`}>
                <td>{line.name}</td>
                <td>{line.unit}</td>
                <td className="num">{formatMeasure(BigInt(line.qty), "")}</td>
                <td className="num">{formatKopecks(BigInt(line.unitPrice))}</td>
                <td className="num">{formatKopecks(BigInt(line.total))}</td>
                {внутренний && (
                  <td className="num">{formatKopecks(BigInt(line.wageTotal ?? "0"))}</td>
                )}
                {внутренний && (
                  <td className="num">
                    {formatKopecks(BigInt(line.profit ?? "0"))}
                    <span className="t-sm t-muted"> · {formatPercent(BigInt(line.profitShare ?? 0))}</span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={4}>Работы</th>
              <td className="num">{formatKopecks(BigInt(act.totals.works))}</td>
              {внутренний && <td className="num">{formatKopecks(BigInt(act.totals.wage ?? "0"))}</td>}
              {внутренний && <td className="num">{formatKopecks(BigInt(act.totals.profit ?? "0"))}</td>}
            </tr>
            <tr>
              <th scope="row" colSpan={4}>
                Сопровождение объекта {formatPercent(BigInt(act.totals.supervisionShare))}
              </th>
              <td className="num">{formatKopecks(BigInt(act.totals.supervision))}</td>
              {внутренний && <td colSpan={2} />}
            </tr>
            <tr>
              <th scope="row" colSpan={4}>Итого к оплате</th>
              <td className="num t-strong">{formatKopecks(BigInt(act.totals.total))}</td>
              {внутренний && <td colSpan={2} />}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Подписи печатаются в обоих видах: внутренний акт тоже подписывают —
          его подписывают между собой, а не с заказчиком. */}
      <div className="act__signs">
        <p className="act__sign">Исполнитель ____________________ / {act.contractor.name}</p>
        <p className="act__sign">Заказчик ____________________ / {act.client.name}</p>
      </div>
      {act.signedAt !== null && (
        <p className="t-sm t-muted">Отмечено подписанным {дата(act.signedAt)}.</p>
      )}
      {внутренний && (
        <p className="t-sm t-muted act__warning">
          Внутренний вид: содержит начисленное бригадам и прибыль. Заказчику не передаётся.
        </p>
      )}
    </div>
  );
}
