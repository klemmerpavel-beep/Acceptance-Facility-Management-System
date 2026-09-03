import { useEffect, useRef, type RefObject } from "react";

/**
 * Поведение модального диалога, общее для всех окон продукта.
 *
 * Появилось дублированием: ловушка фокуса, Escape и возврат фокуса были
 * написаны дважды — в листе смены статуса и в подтверждении записи сметы.
 * Второе написание того же поведения расходится с первым на третьей правке,
 * поэтому оно вынесено сюда (реестр Д-12, вынос по этапу 4.1).
 *
 * Что делает:
 *   — ставит фокус на первый орган управления при открытии;
 *   — не выпускает фокус за пределы диалога по Tab и Shift+Tab;
 *   — закрывает по Escape;
 *   — возвращает фокус элементу, который диалог открыл.
 */
export function useModalDialog(onClose: () => void): {
  dialog: RefObject<HTMLDivElement | null>;
  first: RefObject<HTMLButtonElement | null>;
} {
  const dialog = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    first.current?.focus();

    const stops = (): HTMLElement[] => {
      const node = dialog.current;
      if (node === null) return [];
      const found = node.querySelectorAll<HTMLElement>("button, [href], input, select, textarea");
      return [...found].filter((element) => !element.hasAttribute("disabled"));
    };

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "Tab") return;
      const list = stops();
      if (list.length === 0) return;
      const edge = event.shiftKey ? list[0] : list.at(-1);
      if (document.activeElement !== edge) return;
      event.preventDefault();
      (event.shiftKey ? list.at(-1) : list[0])?.focus();
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [onClose]);

  return { dialog, first };
}
