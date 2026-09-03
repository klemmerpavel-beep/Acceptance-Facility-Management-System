import type { ProjectStatus } from "@priyomka/contracts";
import { STATUS_LABEL, STATUS_ORDER } from "./status.js";
import { useModalDialog } from "./modal.js";

/**
 * Смена статуса объекта. Лист снизу на мобильном, окно по центру на
 * десктопе — тот же компонент, разное расположение (раздел 5.9 норматива).
 *
 * Статус — не поле формы: его меняют одним касанием и сразу видят результат,
 * поэтому подтверждения «Сохранить» здесь нет.
 */
export function StatusSheet({
  current,
  busy,
  onChoose,
  onClose,
}: {
  current: ProjectStatus;
  busy: boolean;
  onChoose: (status: ProjectStatus) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog(onClose);

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
              aria-pressed={status === current}
              disabled={busy}
              onClick={() => onChoose(status)}
            >
              {STATUS_LABEL[status]}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--text btn--block" onClick={onClose}>
          Отмена
        </button>
      </div>
    </>
  );
}
