import { useState } from "react";
import { formatKopecks, formatPercent } from "@priyomka/ui";
import { applyPercent, basisPoints, kopecks } from "@priyomka/domain";
import { useModalDialog } from "./modal.js";

/**
 * Надбавка «сопровождение объекта» — процент, который клиент платит поверх
 * работ (БП-07).
 *
 * Правится у сметы, а не у объекта: надбавка объекта есть значение по
 * умолчанию для новой сметы, а считают по надбавке той, которая действует.
 * Лист показывает будущий итог для клиента до подтверждения: надбавка —
 * единственное поле продукта, которое одним движением меняет всю сумму
 * договора, и увидеть последствие человек должен до нажатия.
 */

/** «12,5» → 1250 сотых долей процента. Возвращает null на незавершённом вводе. */
export function процентВБазисные(input: string): number | null {
  const очищено = input.replace(/[\s\u00A0%]/g, "").replace(",", ".");
  if (очищено === "") return null;
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(очищено);
  if (!match) return null;
  const [, целое = "0", дробь = ""] = match;
  return Number(целое) * 100 + Number(дробь.padEnd(2, "0") || "0");
}

export function SupervisionSheet({
  share,
  works,
  busy,
  error,
  onSave,
  onClose,
}: {
  share: number;
  works: string;
  busy: boolean;
  error: string | null;
  onSave: (share: number) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog<HTMLInputElement>(onClose);
  const [value, setValue] = useState(formatPercent(BigInt(share)).replace(/\s*%$/u, "").trim());

  const базисные = процентВБазисные(value);
  const выше100 = базисные !== null && базисные > 10_000;
  const ready = базисные !== null && !выше100;
  const надбавка = базисные === null
    ? null
    : applyPercent(kopecks(works), basisPoints(базисные));

  const submit: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (ready) onSave(базисные);
  };

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Надбавка" ref={dialog}>
        <p className="t-h3">Сопровождение объекта</p>
        <form className="stack stack--tight" onSubmit={submit}>
          <label className="field">
            <span className="field__label">Надбавка, %</span>
            <input
              ref={first}
              className="input input--num"
              inputMode="decimal"
              value={value}
              aria-invalid={выше100}
              onChange={(event) => { setValue(event.target.value); }}
            />
          </label>

          <p className="field__hint">
            {надбавка === null
              ? "Надбавка применяется к итогу по работам одним умножением."
              : `Сопровождение ${formatKopecks(надбавка)}, итог для заказчика `
                + `${formatKopecks(kopecks(BigInt(works) + надбавка))}.`}
          </p>

          {выше100 && (
            <p className="field__error" role="alert">
              Надбавка выше 100 % — проверьте, не введены ли рубли вместо процентов.
            </p>
          )}
          {error !== null && <p className="field__error" role="alert">{error}</p>}

          <button
            type="submit"
            className="btn btn--primary btn--block"
            disabled={busy || !ready}
            data-loading={busy}
          >
            Сохранить
          </button>
          <button type="button" className="btn btn--text btn--block" onClick={onClose}>
            Отмена
          </button>
        </form>
      </div>
    </>
  );
}
