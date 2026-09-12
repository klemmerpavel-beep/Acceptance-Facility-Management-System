import { useState } from "react";
import { завести } from "./verbs.js";
import type { LeadCard } from "@priyomka/contracts";
import { createLead, errorMessage } from "./api.js";
import { useModalDialog } from "./modal.js";

/**
 * Заведение заявки.
 *
 * Спрашивается минимум: имя и телефон. Обращение приходит звонком, и
 * заполнять форму из семи полей, держа трубку, никто не станет — остальное
 * дописывают в листе заявки, когда разговор закончен.
 *
 * Номер не спрашивается: его выводит сервер из уже заведённых, тем же
 * правилом, что номер транша.
 */
export function NewLeadSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (lead: LeadCard) => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog<HTMLInputElement>(onClose);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = name.trim().length >= 2 && phone.trim().length >= 10;

  const submit: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    createLead({
      name: name.trim(),
      phone: phone.trim(),
      ...(address.trim() === "" ? {} : { address: address.trim() }),
      ...(note.trim() === "" ? {} : { note: note.trim() }),
    })
      .then(onCreated)
      .catch((cause: unknown) => { setError(errorMessage(cause)); })
      .finally(() => { setBusy(false); });
  };

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Новая заявка" ref={dialog}>
        <p className="t-h3">Новая заявка</p>
        <form className="stack stack--tight" onSubmit={submit}>
          <label className="field">
            <span className="field__label">Имя</span>
            <input
              ref={first}
              className="input"
              value={name}
              onChange={(event) => { setName(event.target.value); }}
              placeholder="Как представился"
            />
          </label>
          <label className="field">
            <span className="field__label">Телефон</span>
            <input
              className="input"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(event) => { setPhone(event.target.value); }}
              placeholder="+7 900 000-00-00"
            />
          </label>
          <label className="field">
            <span className="field__label">Адрес объекта</span>
            <input
              className="input"
              value={address}
              onChange={(event) => { setAddress(event.target.value); }}
              placeholder="Если назвали на первом звонке"
            />
            <span className="field__hint">
              Понадобится при превращении заявки в объект. Можно дописать позже.
            </span>
          </label>
          <label className="field">
            <span className="field__label">Примечание</span>
            <input
              className="input"
              value={note}
              onChange={(event) => { setNote(event.target.value); }}
              placeholder="Откуда пришли, о чём договорились"
            />
          </label>
          {error !== null && <p className="field__error" role="alert">{error}</p>}
          <button
            type="submit"
            className="btn btn--primary btn--block btn--touch"
            data-loading={busy || undefined}
            disabled={busy || !ready}
          >
            {завести("заявка")}
          </button>
          <button type="button" className="btn btn--text btn--block" onClick={onClose}>
            Отмена
          </button>
        </form>
      </div>
    </>
  );
}
