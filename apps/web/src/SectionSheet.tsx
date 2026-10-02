import { useState } from "react";
import type { EstimateSectionNode } from "@priyomka/contracts";
import { estimateSectionRemovalFault, sectionTitle } from "@priyomka/domain";
import { useModalDialog } from "./modal.js";
import { завести } from "./verbs.js";

/**
 * Раздел сметы: заведение, переименование, удаление (план, пункт 7.3).
 *
 * Один лист на три действия над разделом, как у помещения обмера: поле у них
 * одно — название, — а удаление идёт через подтверждение, которое называет
 * последствие (норматив 15.6). Удаляется только пустой раздел; что держит
 * непустой, лист называет до обращения к сети тем же правилом домена, что
 * применит сервер. Пакеты приёмки и чеки раздела экрану не видны — о них
 * скажет отказ сервера.
 */
export function SectionSheet({
  section,
  parents,
  parentId,
  busy,
  error,
  onCreate,
  onRename,
  onDelete,
  onClose,
}: {
  /** Правимый раздел или `null` — заведение нового. */
  section: EstimateSectionNode | null;
  /** Разделы верхнего уровня: в них вкладывается новый. */
  parents: readonly EstimateSectionNode[];
  /** Родитель нового раздела по умолчанию; `null` — раздел верхнего уровня. */
  parentId: string | null;
  busy: boolean;
  error: string | null;
  onCreate: (name: string, parentId: string | null) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog<HTMLInputElement>(onClose);
  const [name, setName] = useState(section?.name ?? "");
  const [родитель, setРодитель] = useState(parentId ?? "");
  const [удаляю, setУдаляю] = useState(false);

  const отказУдаления = section === null ? null : estimateSectionRemovalFault({
    name: section.name,
    items: section.items.length,
    removed: 0,
    children: section.children.length,
    batches: 0,
    stage: section.stage,
    expenses: 0,
  });
  const готово = name.trim() !== "" && name.trim() !== section?.name;

  const submit: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!готово) return;
    if (section === null) onCreate(name.trim(), родитель === "" ? null : родитель);
    else onRename(name.trim());
  };

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={section === null ? "Новый раздел сметы" : `Раздел «${sectionTitle(section.name)}»`}
        ref={dialog}
      >
        <p className="t-h3">{section === null ? "Новый раздел сметы" : sectionTitle(section.name)}</p>
        <form className="stack stack--tight" onSubmit={submit}>
          <label className="field">
            <span className="field__label">Название раздела</span>
            <input
              ref={first}
              className="input"
              value={name}
              maxLength={300}
              onChange={(event) => { setName(event.target.value); }}
            />
          </label>
          {section === null && (
            <label className="field">
              <span className="field__label">Где стоит</span>
              <span className="selectwrap">
                <select
                  className="input"
                  value={родитель}
                  onChange={(event) => { setРодитель(event.target.value); }}
                >
                  <option value="">Раздел верхнего уровня</option>
                  {parents.map((раздел) => (
                    <option key={раздел.id} value={раздел.id}>Внутри «{sectionTitle(раздел.name)}»</option>
                  ))}
                </select>
              </span>
            </label>
          )}
          {error !== null && <p className="field__error" role="alert">{error}</p>}
          <button type="submit" className="btn btn--primary btn--block" disabled={busy || !готово}>
            {section === null ? завести("раздел") : "Сохранить название"}
          </button>
          <button type="button" className="btn btn--text btn--block" onClick={onClose}>
            Отмена
          </button>
          {section !== null && !удаляю && (
            <button type="button" className="btn btn--text btn--block" onClick={() => { setУдаляю(true); }}>
              Удалить раздел
            </button>
          )}
          {section !== null && удаляю && (
            <div className="panel panel--pad stack stack--tight" role="group" aria-label="Удаление раздела">
              {отказУдаления !== null ? (
                <p className="field__error" role="alert">{отказУдаления}</p>
              ) : (
                <>
                  <p className="t-sm">
                    Раздел «{sectionTitle(section.name)}» уйдёт из сметы. Позиций и вложенных
                    разделов в нём нет, и итоги сметы не изменятся.
                  </p>
                  <button type="button" className="btn btn--danger btn--block" disabled={busy} onClick={onDelete}>
                    Удалить раздел
                  </button>
                </>
              )}
              <button type="button" className="btn btn--text btn--block" onClick={() => { setУдаляю(false); }}>
                Не удалять
              </button>
            </div>
          )}
        </form>
      </div>
    </>
  );
}
