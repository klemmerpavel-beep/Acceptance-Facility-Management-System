import { useEffect, useRef } from "react";
import type { Section } from "./sections.js";

/**
 * Меню быстрых действий из шапки.
 *
 * Семь ярлыков к тем же экранам, а не отдельные страницы. Пункт, ведущий в
 * незаконченный раздел, открывает его пустое состояние: меню не обещает
 * того, чего нет, — это прямее, чем прятать пункт и оставлять человека
 * гадать, есть действие в системе или нет.
 *
 * Лист снизу на мобильном, окно по центру на десктопе — как у смены
 * статуса (раздел 5.9 норматива).
 */
export const QUICK_ACTIONS: readonly { label: string; section: Section; icon: string }[] = [
  { label: "Добавить заявку", section: "requests", icon: "#i-request" },
  { label: "Создать смету", section: "projects", icon: "#i-estimate" },
  { label: "Сохранить замер", section: "projects", icon: "#i-object" },
  { label: "Отослать фотоотчёт", section: "projects", icon: "#i-acceptance" },
  { label: "Направить акт", section: "documents", icon: "#i-document" },
  { label: "Выставить счёт", section: "accounting", icon: "#i-money" },
  { label: "Подписать договор", section: "documents", icon: "#i-document" },
];

export function QuickActions({
  onChoose,
  onClose,
}: {
  onChoose: (section: Section) => void;
  onClose: () => void;
}): React.JSX.Element {
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Быстрые действия">
        <p className="t-h3">Быстрые действия</p>
        <div className="stack stack--tight">
          {QUICK_ACTIONS.map((action, index) => (
            <button
              key={action.label}
              ref={index === 0 ? first : undefined}
              type="button"
              className="btn btn--secondary btn--block btn--touch quickaction"
              onClick={() => onChoose(action.section)}
            >
              <svg className="icon" aria-hidden="true"><use href={action.icon} /></svg>
              {action.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--text btn--block" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </>
  );
}
