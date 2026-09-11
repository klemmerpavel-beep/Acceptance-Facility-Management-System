import { useState } from "react";
import type { LeadCard } from "@priyomka/contracts";
import { formatKopecks } from "@priyomka/ui";
import { convertLead, errorMessage } from "./api.js";
import { useModalDialog } from "./modal.js";

const CODE = /^[A-ZА-Я]-\d{1,4}$/u;

/**
 * Превращение заявки в заказчика и объект — одним действием, как объявлено
 * картой разделов.
 *
 * Лист называет последствие целиком: что будет заведено и что останется.
 * Заявка не удаляется — история не переписывается (БП-04), и телефон
 * остаётся именно на ней: поля телефона у заказчика в схеме нет.
 */
export function ConvertLeadSheet({
  lead,
  onClose,
  onConverted,
}: {
  lead: LeadCard;
  onClose: () => void;
  onConverted: (lead: LeadCard) => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog<HTMLInputElement>(onClose);
  const [code, setCode] = useState("");
  const [address, setAddress] = useState(lead.address ?? "");
  const [clientCode, setClientCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const кодВерен = CODE.test(code.trim().toUpperCase());
  const ready = кодВерен && address.trim().length >= 3 && clientCode.trim().length >= 1;

  const submit: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    convertLead(lead.id, {
      code: code.trim().toUpperCase(),
      address: address.trim(),
      clientCode: clientCode.trim(),
    })
      .then(onConverted)
      .catch((cause: unknown) => { setError(errorMessage(cause)); })
      .finally(() => { setBusy(false); });
  };

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Превращение заявки в объект"
        ref={dialog}
      >
        <p className="t-h3">Превратить заявку № {lead.number} в объект?</p>
        <form className="stack stack--tight" onSubmit={submit}>
          <label className="field">
            <span className="field__label">Код объекта</span>
            <input
              ref={first}
              id="convert-code"
              className="input num"
              value={code}
              aria-invalid={code !== "" && !кодВерен}
              onChange={(event) => { setCode(event.target.value); }}
              placeholder="R-42"
            />
            <span className="field__hint">Буква, дефис, номер — как на остальных объектах.</span>
          </label>
          <label className="field">
            <span className="field__label">Адрес объекта</span>
            <input
              id="convert-address"
              className="input"
              value={address}
              onChange={(event) => { setAddress(event.target.value); }}
            />
          </label>
          <label className="field">
            <span className="field__label">Код заказчика</span>
            <input
              id="convert-client"
              className="input num"
              value={clientCode}
              onChange={(event) => { setClientCode(event.target.value); }}
              placeholder="501"
            />
            <span className="field__hint">
              Короткий обиходный код, которым заказчика называют в разговоре.
              Имя берётся из заявки: {lead.name}.
            </span>
          </label>

          <p className="t-sm t-secondary">
            Будет заведён заказчик «{lead.name}» и объект с этим кодом. Заявка останется в
            воронке со стадией «Выиграна» — она не удаляется, и телефон остаётся на ней:
            у заказчика поля телефона нет.
            {lead.guideline !== null && (
              <>
                {" "}Ориентир {formatKopecks(BigInt(lead.guideline.low))} —{" "}
                {formatKopecks(BigInt(lead.guideline.high))} встанет на карточке объекта рядом
                с итогом сметы: будет видно, на сколько промахнулись.
              </>
            )}
          </p>

          {error !== null && <p className="field__error" role="alert">{error}</p>}
          <button
            type="submit"
            className="btn btn--primary btn--block btn--touch"
            data-loading={busy || undefined}
            disabled={busy || !ready}
          >
            Завести заказчика и объект
          </button>
          <button type="button" className="btn btn--text btn--block" onClick={onClose}>
            Отмена
          </button>
        </form>
      </div>
    </>
  );
}
