import { useState } from "react";
import type { ClientRow, WorkerRow } from "@priyomka/contracts";
import { createClient, createWorker, errorMessage, fetchClients, fetchWorkers } from "./api.js";
import { useModalDialog } from "./modal.js";

/**
 * Заведение контакта — заказчика или бригады.
 *
 * Одна форма на два вида, потому что и справочник один. Вид выбирается
 * первым: от него зависит, какие поля вообще имеют смысл — у заказчика есть
 * код и реквизиты, у бригады нет ни того, ни другого.
 *
 * Ставка бригады не спрашивается: начисление идёт по ставке позиции сметы,
 * а поле, которое ни на что не влияет, вводить незачем.
 */

type Kind = "client" | "brigade" | "person";

export function NewContactSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  /* Вид заведённой записи возвращается вместе с ней: справочник разведён
     вкладками, и обещание «запись стоит в списке ниже» держится только
     тогда, когда открыта та вкладка, где запись лежит. */
  onCreated: (next: {
    clients: ClientRow[]; workers: WorkerRow[]; name: string; kind: "client" | "worker";
  }) => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog(onClose);
  const [kind, setKind] = useState<Kind>("client");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [requisites, setRequisites] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isClient = kind === "client";
  const ready = name.trim().length >= 2 && (!isClient || code.trim().length >= 1);

  const submit: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);

    const заведено = isClient
      ? createClient({
          code: code.trim(),
          name: name.trim(),
          // Юридическое лицо распознаётся по названию, а не отдельной
          // галочкой: «ООО «Гранит-Строй»» и «Анна Мещерякова» различаются
          // без вопроса к человеку.
          isCompany: /^(ООО|АО|ЗАО|ПАО|ИП)\b/u.test(name.trim()),
          requisites: requisites.trim() === "" ? null : requisites.trim(),
        }).then(async (clients) => ({ clients, workers: await fetchWorkers() }))
      : createWorker({ name: name.trim(), kind: kind === "brigade" ? "BRIGADE" : "PERSON" }).then(
          async (workers) => ({ clients: await fetchClients(), workers }),
        );

    void заведено
      .then((next) => { onCreated({ ...next, name: name.trim(), kind: kind === "client" ? "client" : "worker" }); })
      .catch((cause: unknown) => { setError(errorMessage(cause)); })
      .finally(() => { setBusy(false); });
  };

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Новый контакт" ref={dialog}>
        <p className="t-h3">Новый контакт</p>

        <form className="stack stack--tight" onSubmit={submit}>
          <div className="field">
            <span className="field__label">Кто это</span>
            <div className="segmented" role="group" aria-label="Вид контакта">
              {(
                [
                  ["client", "Заказчик"],
                  ["brigade", "Бригада"],
                  ["person", "Мастер"],
                ] as const
              ).map(([value, label], index) => (
                <button
                  key={value}
                  ref={index === 0 ? first : undefined}
                  type="button"
                  className="segmented__option"
                  aria-pressed={kind === value}
                  onClick={() => { setKind(value); }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span className="field__label">{isClient ? "Имя или название" : "Название"}</span>
            <input
              className="input"
              value={name}
              maxLength={120}
              placeholder={isClient ? "Ирина Ковалёва" : "Бригада Фархата"}
              onChange={(event) => { setName(event.target.value); }}
            />
          </label>

          {isClient && (
            <>
              <label className="field">
                <span className="field__label">Код</span>
                <input
                  className="input"
                  value={code}
                  maxLength={20}
                  placeholder="300"
                  onChange={(event) => { setCode(event.target.value); }}
                />
                <span className="field__hint">
                  Короткий обиходный код: им заказчика называют в разговоре и в теме письма.
                </span>
              </label>

              <label className="field">
                <span className="field__label">Реквизиты</span>
                <input
                  className="input"
                  value={requisites}
                  maxLength={400}
                  placeholder="ИНН 3666000000"
                  onChange={(event) => { setRequisites(event.target.value); }}
                />
                <span className="field__hint">Необязательно. Понадобятся при выпуске счёта.</span>
              </label>
            </>
          )}

          {error !== null && <p className="field__error" role="alert">{error}</p>}

          <button
            type="submit"
            className="btn btn--primary btn--block"
            data-loading={busy || undefined}
            disabled={busy || !ready}
          >
            {isClient ? "Завести заказчика" : kind === "brigade" ? "Завести бригаду" : "Завести мастера"}
          </button>
          <button type="button" className="btn btn--text btn--block" onClick={onClose}>
            Отмена
          </button>
        </form>
      </div>
    </>
  );
}
