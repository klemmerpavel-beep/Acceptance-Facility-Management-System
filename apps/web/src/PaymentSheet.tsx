import { useState } from "react";
import type { Tranche } from "@priyomka/contracts";
import { formatKopecks } from "@priyomka/ui";
import { kopecks, paymentFault, subtract } from "@priyomka/domain";
import { useModalDialog } from "./modal.js";
import { toKopecks } from "./TrancheSheet.js";

/**
 * Запись платежа заказчика.
 *
 * Лист не ставит отметку «оплачен» и не предлагает её поставить — решение
 * заказчика от 19.09.2026 оставило отметку за руководителем, отдельным
 * действием. Соблазн «раз деньги пришли целиком, отметим заодно» назван
 * здесь именно затем, чтобы следующая правка его не приняла за упущение:
 * два способа назначить одно состояние расходятся на первом же сторно.
 *
 * Отказ показывается до обращения к сети тем же `paymentFault`, что применит
 * сервер, — приём общий с `TrancheSheet`.
 */

/** Сегодняшний день в виде ГГГГ-ММ-ДД по часам браузера. */
const сегодня = (): string => {
  const now = new Date();
  const двумя = (число: number): string => String(число).padStart(2, "0");
  return `${String(now.getFullYear())}-${двумя(now.getMonth() + 1)}-${двумя(now.getDate())}`;
};

export function PaymentSheet({
  tranche,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  tranche: Tranche;
  busy: boolean;
  error: string | null;
  onSubmit: (input: { amount: string; paidOn: string; comment?: string }) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog<HTMLInputElement>(onClose);
  const день = сегодня();
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(день);
  const [comment, setComment] = useState("");

  const копейки = toKopecks(amount);
  const непокрыто = subtract(kopecks(BigInt(tranche.amount)), kopecks(BigInt(tranche.paid)));
  const fault = копейки === null
    ? null
    : paymentFault({
      amount: kopecks(копейки),
      paidOn,
      today: день,
      status: tranche.status,
      openedOn: tranche.openedAt.slice(0, 10),
    });
  const ready = копейки !== null && fault === null;

  const submit: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!ready) return;
    onSubmit({
      amount: копейки.toString(),
      paidOn,
      ...(comment.trim() === "" ? {} : { comment: comment.trim() }),
    });
  };

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Записать платёж" ref={dialog}>
        <p className="t-h3">Платёж по траншу № {tranche.number}</p>
        <form className="stack stack--tight" onSubmit={submit}>
          <p className="t-body">
            Сумма транша {formatKopecks(BigInt(tranche.amount))}, оплачено{" "}
            {formatKopecks(BigInt(tranche.paid))}. Не покрыто{" "}
            <b className="num">{formatKopecks(непокрыто)}</b>.
          </p>

          <label className="field">
            <span className="field__label">Сумма платежа, ₽</span>
            <input
              ref={first}
              className="input input--num input--touch"
              inputMode="decimal"
              value={amount}
              onChange={(event) => { setAmount(event.target.value); }}
            />
            <span className="field__hint">
              {копейки === null
                ? "Пришедшие деньги, а не обещанные: платёж пишется по выписке."
                : `${formatKopecks(копейки)} — столько пришло по этому платежу.`}
            </span>
          </label>

          <label className="field">
            <span className="field__label">Дата платежа</span>
            <input
              type="date"
              className="input input--touch"
              value={paidOn}
              max={день}
              onChange={(event) => { setPaidOn(event.target.value); }}
            />
            <span className="field__hint">
              День прихода денег по выписке, а не день записи в систему.
            </span>
          </label>

          <label className="field">
            <span className="field__label">Основание</span>
            <input
              className="input"
              value={comment}
              maxLength={280}
              placeholder="Частичная оплата по акту"
              onChange={(event) => { setComment(event.target.value); }}
            />
          </label>

          <p className="field__hint">
            Отметку «оплачен» платёж не ставит: её ставит руководитель отдельно.
          </p>

          {fault !== null && <p className="field__error" role="alert">{fault}</p>}
          {error !== null && <p className="field__error" role="alert">{error}</p>}

          <button
            type="submit"
            className="btn btn--primary btn--touch btn--block"
            disabled={busy || !ready}
            data-loading={busy}
          >
            Записать платёж
          </button>
          <button type="button" className="btn btn--text btn--block" onClick={onClose}>
            Отмена
          </button>
        </form>
      </div>
    </>
  );
}

/**
 * Сторно платежа — обратная запись с обязательной причиной (БП-04).
 *
 * Устроено как сторно приёмки и по тому же доводу: лист называет
 * последствие, а не спрашивает «вы уверены».
 */
export function PaymentReversalSheet({
  payment,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  payment: { id: string; amount: string; paidOn: string };
  busy: boolean;
  error: string | null;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog<HTMLInputElement>(onClose);
  const [reason, setReason] = useState("");
  const ready = reason.trim().length > 0;

  const submit: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (ready) onSubmit(reason.trim());
  };

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Сторно платежа" ref={dialog}>
        <p className="t-h3">Сторнировать платёж</p>
        <form className="stack stack--tight" onSubmit={submit}>
          <p className="t-body">
            Платёж {formatKopecks(BigInt(payment.amount))} от{" "}
            {payment.paidOn.split("-").reverse().join(".")} будет отменён обратной записью.
            Оплаченное по траншу уменьшится на эту сумму, обе записи останутся в истории.
          </p>

          <label className="field">
            <span className="field__label">Причина</span>
            <input
              ref={first}
              className="input"
              value={reason}
              maxLength={280}
              onChange={(event) => { setReason(event.target.value); }}
            />
            <span className="field__hint">
              Через месяц спрашивают не что отменили, а почему.
            </span>
          </label>

          {error !== null && <p className="field__error" role="alert">{error}</p>}

          <button type="submit" className="btn btn--danger btn--block" disabled={busy || !ready}>
            Сторнировать
          </button>
          <button type="button" className="btn btn--text btn--block" onClick={onClose}>
            Отмена
          </button>
        </form>
      </div>
    </>
  );
}
