import { useEffect, useState } from "react";
import type { ClientRow, ProjectSummary } from "@priyomka/contracts";
import { createProject, errorMessage, fetchClients } from "./api.js";
import { useModalDialog } from "./modal.js";

/**
 * Заведение объекта.
 *
 * Спрашивается ровно то, без чего объект не существует: код, адрес,
 * заказчик. Срок необязателен — его часто не знают в момент заведения, и
 * поле со звёздочкой рядом с пустой головой ничего не улучшает.
 *
 * Прораб, дата начала, надбавка и ключи не спрашиваются намеренно. Их
 * назначают позже и в другом месте; форма из восьми полей на входе стоит
 * дороже, чем правка карточки потом.
 */

/** Код объекта: буква, дефис, цифры. То же выражение, что в контракте. */
const CODE = /^[A-ZА-Я]-\d{1,4}$/u;

export function NewProjectSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (project: ProjectSummary) => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog<HTMLInputElement>(onClose);
  const [clients, setClients] = useState<ClientRow[] | null>(null);
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [clientId, setClientId] = useState("");
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchClients()
      .then((rows) => {
        setClients(rows);
        setClientId(rows[0]?.id ?? "");
      })
      .catch((cause: unknown) => { setError(errorMessage(cause)); });
  }, []);

  const codeOk = CODE.test(code.trim().toUpperCase());
  const ready = codeOk && address.trim().length >= 3 && clientId !== "";

  const submit: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    void createProject({
      code: code.trim().toUpperCase(),
      address: address.trim(),
      clientId,
      deadline: deadline === "" ? null : deadline,
    })
      .then(onCreated)
      .catch((cause: unknown) => { setError(errorMessage(cause)); })
      .finally(() => { setBusy(false); });
  };

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Новый объект" ref={dialog}>
        <p className="t-h3">Новый объект</p>

        {clients !== null && clients.length === 0 ? (
          /* Объект без заказчика не бьётся ни со сметой, ни со счётом.
             Форма не предлагает завести его «пока без заказчика», а
             называет, чего не хватает. */
          <div className="stack stack--tight">
            <p className="t-body">
              Сначала нужен заказчик: объект заводится на него, и без этого не собрать ни смету,
              ни счёт. Заведите заказчика в разделе «Контакты».
            </p>
            <button type="button" className="btn btn--secondary btn--block" onClick={onClose}>
              Понятно
            </button>
          </div>
        ) : (
          <form className="stack stack--tight" onSubmit={submit}>
            <label className="field">
              <span className="field__label">Код объекта</span>
              <input
                ref={first}
                className="input"
                value={code}
                maxLength={6}
                placeholder="R-42"
                aria-invalid={code !== "" && !codeOk}
                onChange={(event) => { setCode(event.target.value); }}
              />
              <span className="field__hint">
                Сквозной код: он же в теме письма с чеками, в акте и в разговоре на объекте.
              </span>
            </label>

            <label className="field">
              <span className="field__label">Адрес</span>
              <input
                className="input"
                value={address}
                maxLength={200}
                placeholder="Московский проспект 116, кв. 12"
                onChange={(event) => { setAddress(event.target.value); }}
              />
            </label>

            <label className="field">
              <span className="field__label">Заказчик</span>
              <span className="selectwrap">
                <select
                  className="input"
                  value={clientId}
                  disabled={clients === null}
                  onChange={(event) => { setClientId(event.target.value); }}
                >
                  {(clients ?? []).map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.code} · {client.name}
                    </option>
                  ))}
                </select>
                <svg className="icon selectwrap__chevron" aria-hidden="true"><use href="#i-chevron" /></svg>
              </span>
            </label>

            <label className="field">
              <span className="field__label">Срок сдачи</span>
              <input
                type="date"
                className="input"
                value={deadline}
                onChange={(event) => { setDeadline(event.target.value); }}
              />
              <span className="field__hint">Необязательно: срок часто уточняют после замера.</span>
            </label>

            {error !== null && <p className="field__error" role="alert">{error}</p>}

            <button
              type="submit"
              className="btn btn--primary btn--block"
              data-loading={busy || undefined}
              disabled={busy || !ready}
            >
              Завести объект
            </button>
            <button type="button" className="btn btn--text btn--block" onClick={onClose}>
              Отмена
            </button>
          </form>
        )}
      </div>
    </>
  );
}
