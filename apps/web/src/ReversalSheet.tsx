import { useState } from "react";
import type { AcceptanceLine } from "@priyomka/contracts";
import { formatMeasure } from "@priyomka/ui";
import { useModalDialog } from "./modal.js";

/**
 * Сторно приёмки — право руководителя и только с причиной.
 *
 * Лист называет последствие, а не спрашивает «вы уверены» (норматив 15.6):
 * обратная запись отменит начисление и вернёт остаток, но обе записи
 * останутся в истории — она не переписывается никогда (БП-04).
 */
export function ReversalSheet({
  line,
  brigade,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  line: AcceptanceLine;
  brigade: string;
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
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Сторно приёмки" ref={dialog}>
        <p className="t-h3">Сторнировать приёмку</p>
        <form className="stack stack--tight" onSubmit={submit}>
          <p className="t-body">
            Приёмка {formatMeasure(BigInt(line.qty), line.unit)} по позиции «{line.positionName}»
            будет отменена обратной записью. Начисление бригаде «{brigade}» отменится,
            остаток по смете вернётся. Обе записи останутся в истории объекта.
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
              Обратная запись без причины неотличима от ошибки ввода.
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
