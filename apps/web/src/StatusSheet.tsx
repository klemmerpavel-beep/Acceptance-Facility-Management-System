import { useState } from "react";
import { WAITING_FOR_MAX, type ProjectStatus } from "@priyomka/contracts";
import { STATUS_LABEL, STATUS_ORDER, STATUS_PILL } from "./status.js";
import { useModalDialog } from "./modal.js";

/**
 * Смена статуса объекта. Лист снизу на мобильном, окно по центру на
 * десктопе — тот же компонент, разное расположение (раздел 5.9 норматива).
 *
 * Статус — не поле формы: его меняют одним касанием и сразу видят результат,
 * поэтому подтверждения «Сохранить» здесь нет. Исключение одно — «Ждёт
 * ответа» (этап Э8, ДР-4): он выбирается только вместе с полем «Ждём», что
 * и от кого. Статус называл ожидание, но не его предмет, и через неделю
 * никто не помнил, чего ждали. Выбор «Ждёт ответа» раскрывает поле и
 * кнопку «Сохранить»; пока статус «Ждёт ответа», тем же путём правится
 * текст.
 *
 * Пустое поле не останавливается на экране: отказ приходит от сервера и
 * называет поле. Правило одно и живёт в контракте — второе, экранное, его
 * написание разошлось бы с первым на первой правке.
 */
export function StatusSheet({
  current,
  waitingFor,
  busy,
  error,
  onChoose,
  onClose,
}: {
  current: ProjectStatus;
  /** Текущий текст поля «Ждём»; `null` — поля нет. */
  waitingFor: string | null;
  busy: boolean;
  /** Отказ сервера — показывается в листе, рядом с полем, которое он называет. */
  error: string | null;
  onChoose: (status: ProjectStatus, waitingFor?: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog(onClose);
  const [ждём, setЖдём] = useState<string | null>(current === "WAITING_CLIENT" ? (waitingFor ?? "") : null);

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Статус объекта" ref={dialog}>
        <p className="t-h3">Статус объекта</p>
        <div className="stack stack--tight">
          {STATUS_ORDER.map((status, index) => (
            <button
              key={status}
              ref={index === 0 ? first : undefined}
              type="button"
              className="btn btn--secondary btn--block btn--touch"
              aria-pressed={status === "WAITING_CLIENT" ? ждём !== null : status === current && ждём === null}
              disabled={busy}
              onClick={() => {
                if (status === "WAITING_CLIENT") { setЖдём(ждём ?? waitingFor ?? ""); return; }
                onChoose(status);
              }}
            >
              <span className={STATUS_PILL[status]}>{STATUS_LABEL[status]}</span>
            </button>
          ))}
        </div>
        {ждём !== null && (
          <form
            className="stack stack--tight"
            onSubmit={(event) => {
              event.preventDefault();
              onChoose("WAITING_CLIENT", ждём);
            }}
          >
            <label className="field">
              <span className="field__label">Ждём: что и от кого</span>
              <textarea
                className="input statussheet__waiting"
                rows={2}
                maxLength={WAITING_FOR_MAX}
                value={ждём}
                placeholder="От заказчика: выбор плитки для санузла"
                aria-invalid={error !== null}
                aria-describedby={error === null ? undefined : "status-error"}
                onChange={(event) => { setЖдём(event.target.value); }}
              />
              <span className="field__hint">До {WAITING_FOR_MAX} знаков. Видно всем на объекте, включая заказчика.</span>
            </label>
            {error !== null && <p className="field__error" id="status-error" role="alert">{error}</p>}
            <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
              Сохранить
            </button>
          </form>
        )}
        {ждём === null && error !== null && <p className="field__error" role="alert">{error}</p>}
        <button type="button" className="btn btn--text btn--block" onClick={onClose}>
          Отмена
        </button>
      </div>
    </>
  );
}
