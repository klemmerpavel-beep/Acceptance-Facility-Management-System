import { useState } from "react";
import { formatKopecks } from "@priyomka/ui";
import { trancheFault, kopecks } from "@priyomka/domain";
import { useModalDialog } from "./modal.js";

/**
 * Открытие транша — действие руководителя.
 *
 * Сумма вводится в рублях и переводится в копейки здесь: в поле человек
 * пишет «450 000», а деньги в системе целые копейки (БП-08). Разбор
 * повторяет `parseRubles` домена по смыслу, но принимает незавершённый
 * ввод: поле правится посимвольно, и отказ на каждом промежуточном
 * состоянии сделал бы ввод невозможным.
 *
 * Отказ показывается до обращения к сети — тем же `trancheFault`, что
 * применит сервер. Два независимых свода разошлись бы на третьей правке.
 */

/** «450 000,50» → 45000050 копеек. Возвращает null на незавершённом вводе. */
export function toKopecks(input: string): bigint | null {
  // \u00A0 — неразрывный пробел: браузер вставляет его при вводе разрядов.
  const очищено = input.replace(/[\s\u00A0]/g, "").replace(",", ".");
  if (очищено === "") return null;
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(очищено);
  if (!match) return null;
  const [, целое = "0", дробь = ""] = match;
  return BigInt(целое) * 100n + BigInt(дробь.padEnd(2, "0") || "0");
}

export function TrancheSheet({
  openNumber,
  hasPrepayment,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  openNumber: number | null;
  hasPrepayment: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (input: { amount: string; prepayment: boolean; comment?: string }) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog<HTMLInputElement>(onClose);
  const [amount, setAmount] = useState("");
  const [prepayment, setPrepayment] = useState(false);
  const [comment, setComment] = useState("");

  const копейки = toKopecks(amount);
  const fault = копейки === null
    ? null
    : trancheFault({ amount: kopecks(копейки), prepayment, openNumber, hasPrepayment });
  const ready = копейки !== null && fault === null;

  const submit: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!ready) return;
    onSubmit({
      amount: копейки.toString(),
      prepayment,
      ...(comment.trim() === "" ? {} : { comment: comment.trim() }),
    });
  };

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Открыть транш" ref={dialog}>
        <p className="t-h3">Открыть транш</p>
        <form className="stack stack--tight" onSubmit={submit}>
          <label className="field">
            <span className="field__label">Сумма платежа клиента, ₽</span>
            <input
              ref={first}
              className="input input--num input--touch"
              inputMode="decimal"
              value={amount}
              onChange={(event) => { setAmount(event.target.value); }}
            />
            <span className="field__hint">
              {копейки === null
                ? "Транш есть сумма, которую платит клиент: смета с надбавкой за сопровождение."
                : `${formatKopecks(копейки)} — сумма, которую платит клиент.`}
            </span>
          </label>

          <label className="row">
            <input
              type="checkbox"
              className="accept__check"
              checked={prepayment}
              onChange={(event) => { setPrepayment(event.target.checked); }}
            />
            <span className="t-body">Предоплата: транш № 0, сразу оплаченный</span>
          </label>

          <label className="field">
            <span className="field__label">Основание</span>
            <input
              className="input"
              value={comment}
              maxLength={280}
              placeholder="Черновые работы"
              onChange={(event) => { setComment(event.target.value); }}
            />
          </label>

          {fault !== null && <p className="field__error" role="alert">{fault}</p>}
          {error !== null && <p className="field__error" role="alert">{error}</p>}

          <button
            type="submit"
            className="btn btn--primary btn--touch btn--block"
            disabled={busy || !ready}
            data-loading={busy}
          >
            Открыть
          </button>
          <button type="button" className="btn btn--text btn--block" onClick={onClose}>
            Отмена
          </button>
        </form>
      </div>
    </>
  );
}
