import { useEffect, useRef } from "react";
import type { ProjectStatus } from "@priyomka/contracts";
import { STATUS_LABEL, STATUS_ORDER } from "./status.js";

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
  const first = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    /* Диалог удерживает фокус и возвращает его открывшей кнопке. Без этого
       Tab уводит на элементы под подложкой, а после закрытия фокус падает
       на начало документа (реестр Д-12). */
    const opener = document.activeElement as HTMLElement | null;
    first.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "Tab" || dialog.current === null) return;
      const stops = dialog.current.querySelectorAll<HTMLElement>("button, [href], input, select, textarea");
      const list = [...stops].filter((node) => !node.hasAttribute("disabled"));
      const edge = event.shiftKey ? list[0] : list.at(-1);
      if (document.activeElement === edge) {
        event.preventDefault();
        (event.shiftKey ? list.at(-1) : list[0])?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); opener?.focus(); };
  }, [onClose]);

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
