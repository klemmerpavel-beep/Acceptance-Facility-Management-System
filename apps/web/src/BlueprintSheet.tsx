import { useEffect, useState } from "react";
import type { BlueprintRow } from "@priyomka/contracts";
import { formatKopecks } from "@priyomka/ui";
import { errorMessage, fetchBlueprints } from "./api.js";
import { useModalDialog } from "./modal.js";
import { plural } from "./status.js";

/**
 * Два действия одной вещи: сохранить смету объекта как типовую и взять
 * типовую в объект без сметы.
 *
 * Один лист, а не два: вещь одна — типовая смета, — и разводить её по двум
 * органам в разных местах значило бы учить человека двум путям к одному
 * понятию.
 */
export function BlueprintSheet({
  режим,
  code,
  busy,
  error,
  onSave,
  onApply,
  onClose,
}: {
  режим: "save" | "apply";
  code: string;
  busy: boolean;
  error: string | null;
  onSave: (name: string) => void;
  onApply: (id: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog<HTMLInputElement>(onClose);
  const [name, setName] = useState("");
  const [строки, setСтроки] = useState<readonly BlueprintRow[] | null>(null);
  const [беда, setБеда] = useState<string | null>(null);

  useEffect(() => {
    if (режим !== "apply") return;
    void fetchBlueprints()
      .then(setСтроки)
      .catch((cause: unknown) => { setБеда(errorMessage(cause)); });
  }, [режим]);

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={режим === "save" ? "Сохранить как типовую смету" : "Взять типовую смету"}
        ref={dialog}
      >
        {режим === "save" ? (
          <form
            className="stack stack--tight"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim() === "") return;
              onSave(name.trim());
            }}
          >
            <p className="t-h3">Сохранить как типовую смету</p>
            <p className="prose t-secondary">
              В заготовку уйдут разделы, наименования, единицы, цены, ставки и количества
              сметы {code}. Помещения не уйдут: помещение принадлежит объекту, а не типу
              ремонта.
            </p>
            <label className="field">
              <span className="field__label">Название</span>
              <input
                ref={first}
                className="input"
                value={name}
                maxLength={120}
                placeholder="Типовая двушка"
                onChange={(event) => { setName(event.target.value); }}
              />
            </label>
            {error !== null && <p className="field__error" role="alert">{error}</p>}
            <div className="row">
              <button type="submit" className="btn btn--primary" disabled={busy || name.trim() === ""}>
                Сохранить
              </button>
              <button type="button" className="btn btn--text" onClick={onClose}>Отмена</button>
            </div>
          </form>
        ) : (
          <div className="stack stack--tight">
            <p className="t-h3">Взять типовую смету</p>
            <p className="prose t-secondary">
              Заготовка станет сметой объекта {code} редакции 1. Количества и цены правятся
              после — заготовка полная, а не каркас.
            </p>
            {беда !== null && <p className="field__error" role="alert">{беда}</p>}
            {error !== null && <p className="field__error" role="alert">{error}</p>}
            {строки !== null && строки.length === 0 && (
              <p className="prose t-secondary">
                Типовых смет в организации нет. Заведите первую из объекта с готовой сметой.
              </p>
            )}
            {строки?.map((строка) => (
              <button
                key={строка.id}
                type="button"
                className="btn btn--secondary btn--block"
                disabled={busy}
                onClick={() => { onApply(строка.id); }}
              >
                {строка.name}
                {" · "}
                {строка.positions} {plural(строка.positions, "позиция", "позиции", "позиций")}
                {" · "}
                {formatKopecks(BigInt(строка.works))}
              </button>
            ))}
            <button type="button" className="btn btn--text" onClick={onClose}>Отмена</button>
          </div>
        )}
      </div>
    </>
  );
}
