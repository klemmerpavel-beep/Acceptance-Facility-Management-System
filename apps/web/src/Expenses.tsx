import { useCallback, useEffect, useState } from "react";
import { завести } from "./verbs.js";
import { formatKopecks } from "@priyomka/ui";
import type { ExpenseView, MaterialExpense, Role } from "@priyomka/contracts";
import {
  decideExpense, deleteExpense, errorMessage, expensePhotoUrl, fetchExpenses,
} from "./api.js";
import { ExpenseSheet } from "./ExpenseSheet.js";

/**
 * Вкладка «Чеки» карточки объекта.
 *
 * Вопрос экрана: сколько ушло на материалы. Ключевое действие руководителя —
 * подтвердить черновик расхода (`07_IA.md`, раздел 4).
 *
 * Заказчик назвал утрату чеков одной из главных потерь: бухгалтера в
 * компании нет, материалы возмещаются по факту предъявления, и чек, которого
 * нет в системе, — это деньги, которых студия не получит.
 *
 * **Почтового адреса здесь нет.** Бизнес-правило 12 описывает приём писем на
 * `checks+<код>@<домен>`; приёма на сервере не существует, и показанный
 * адрес обещал бы работу, которой нет (правило допуска, `07_IA.md`,
 * раздел 7). Он вернётся вместе с почтовым шлюзом, не раньше.
 *
 * Черновики стоят впереди подтверждённых: их надо разобрать, и это
 * единственная работа на экране. Порядок задаёт сервер — второе правило
 * сортировки разошлось бы с первым.
 */

const ВИД: Readonly<Record<string, string>> = {
  MATERIALS: "Материалы",
  DELIVERY: "Доставка",
  TOOLS: "Инструмент",
  OTHER: "Прочее",
};

/** Кто заводит чек. Материалы покупает тот, кто на объекте. */
const canAdd = (role: Role): boolean => role === "OWNER" || role === "FOREMAN";

const дата = (iso: string): string => {
  const [год, месяц, день] = iso.split("-");
  return `${день ?? "??"}.${месяц ?? "??"}.${год ?? "????"}`;
};

export function Expenses({
  code,
  role,
  onEvents,
}: {
  code: string;
  role: Role;
  onEvents: () => void;
}): React.JSX.Element {
  const [view, setView] = useState<ExpenseView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchExpenses(code)
      .then((next) => { setView(next); setError(null); })
      .catch((cause: unknown) => { setError(errorMessage(cause)); });
  }, [code]);

  useEffect(() => { load(); }, [load]);

  const run = (id: string, action: Promise<ExpenseView>): void => {
    setBusy(id);
    action
      .then((next) => { setView(next); setError(null); onEvents(); })
      .catch((cause: unknown) => { setError(errorMessage(cause)); })
      .finally(() => { setBusy(null); });
  };

  if (error !== null && view === null) return <p className="field__error" role="alert">{error}</p>;
  if (view === null) return <p className="t-sm t-muted">Загружаем чеки…</p>;

  const добавляет = canAdd(role);

  return (
    <div className="stack stack--loose">
      <div className="section-head">
        <p className="spec">
          <span className="spec__item">
            Потрачено<span className="spec__value">{formatKopecks(BigInt(view.totals.spent))}</span>
          </span>
          <span className="spec__item">
            К возмещению
            <span className="spec__value">{formatKopecks(BigInt(view.totals.reimbursable))}</span>
          </span>
          <span className="spec__item">
            Своё<span className="spec__value">{formatKopecks(BigInt(view.totals.own))}</span>
          </span>
        </p>
        {добавляет && (
          <button type="button" className="btn btn--primary" onClick={() => { setAdding(true); }}>
            {завести("чек")}
          </button>
        )}
      </div>

      {/* Число черновиков объявляется отдельно: это не итог, а работа.
          Ноль черновиков строкой не показывается — сообщать «разбирать
          нечего» значит занимать место тем, что не меняется. */}
      {view.totals.drafts > 0 && (
        <p className="t-sm" role="status">
          Ждут разбора: {view.totals.drafts}.
          {role === "OWNER"
            ? " Подтвердите или отклоните — до этого расход в деньгах не считается."
            : " Подтверждает руководитель — до этого расход в деньгах не считается."}
        </p>
      )}

      {error !== null && <p className="field__error" role="alert">{error}</p>}

      {view.rows.length === 0 ? (
        <div className="empty">
          <p className="empty__title">Чеки не поступали</p>
          <p className="empty__text">
            {добавляет
              ? "Чек на материалы со снимком: сумма, продавец, дата покупки. Отсюда расход уходит в итог объекта и предъявляется заказчику."
              : "Чеки заводят руководитель и прораб."}
          </p>
          {добавляет && (
            <button type="button" className="btn btn--primary" onClick={() => { setAdding(true); }}>
              {завести("чек")}
            </button>
          )}
        </div>
      ) : (
        <ul className="checks">
          {view.rows.map((row) => (
            <Чек
              key={row.id}
              code={code}
              row={row}
              role={role}
              busy={busy === row.id}
              onDecide={(решение) => { run(row.id, decideExpense(code, row.id, решение)); }}
              onDelete={() => { run(row.id, deleteExpense(code, row.id)); }}
            />
          ))}
        </ul>
      )}

      {adding && (
        <ExpenseSheet
          code={code}
          onClose={() => { setAdding(false); }}
          onCreated={(next) => { setView(next); setAdding(false); onEvents(); }}
        />
      )}
    </div>
  );
}

function Чек({
  code,
  row,
  role,
  busy,
  onDecide,
  onDelete,
}: {
  code: string;
  row: MaterialExpense;
  role: Role;
  busy: boolean;
  onDecide: (решение: "confirm" | "reject") => void;
  onDelete: () => void;
}): React.JSX.Element {
  const черновик = row.status === "DRAFT";
  const отклонён = row.status === "REJECTED";
  return (
    <li className="check" data-status={row.status}>
      {/* Снимок — само свидетельство расхода, поэтому он в строке, а не за
          ссылкой: чек, ради которого надо куда-то перейти, не смотрят. */}
      <img
        className="check__photo"
        src={expensePhotoUrl(code, row.id)}
        alt={`Чек ${row.seller} от ${дата(row.spentAt)}`}
      />
      <div className="check__body">
        <p className="check__head">
          <span className="t-strong">{row.seller}</span>
          {черновик && <span className="pill pill--warn">Черновик</span>}
          {отклонён && <span className="pill pill--danger">Отклонён</span>}
          {!row.reimbursable && <span className="pill">Не возмещается</span>}
        </p>
        <p className="t-sm t-muted">
          {дата(row.spentAt)} · {ВИД[row.kind] ?? row.kind}
          {row.section === null ? "" : ` · ${row.section.name}`}
          {row.createdBy === null ? "" : ` · завёл ${row.createdBy}`}
        </p>
        {row.note !== null && <p className="t-sm">{row.note}</p>}
      </div>
      <div className="check__side">
        <span className="check__amount num">{formatKopecks(BigInt(row.amount))}</span>
        {черновик && role === "OWNER" && (
          <span className="check__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              data-loading={busy || undefined}
              onClick={() => { onDecide("confirm"); }}
            >
              Подтвердить
            </button>
            <button
              type="button"
              className="btn btn--text"
              disabled={busy}
              onClick={() => { onDecide("reject"); }}
            >
              Отклонить
            </button>
          </span>
        )}
        {черновик && role !== "OWNER" && (
          <button type="button" className="btn btn--text" disabled={busy} onClick={onDelete}>
            Удалить
          </button>
        )}
      </div>
    </li>
  );
}
