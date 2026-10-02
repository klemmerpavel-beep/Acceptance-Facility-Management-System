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
 *   — не выпускает фокус за пределы диалога по Tab и Shift+Tab, а потерянный
 *     нажатием мыши на неактивное место — возвращает;
 *   — закрывает по Escape;
 *   — возвращает фокус элементу, который диалог открыл.
 */
/**
 * Первый орган управления — не обязательно кнопка: в листе смены статуса
 * это кнопка, а в форме помещения — поле названия. Параметр типа избавляет
 * от утверждения типа на месте вызова.
 */
export function useModalDialog<First extends HTMLElement = HTMLButtonElement>(
  onClose: () => void,
): {
  dialog: RefObject<HTMLDivElement | null>;
  first: RefObject<First | null>;
} {
  const dialog = useRef<HTMLDivElement>(null);
  const first = useRef<First>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    first.current?.focus();

    const stops = (): HTMLElement[] => {
      const node = dialog.current;
      if (node === null) return [];
      /* Ссылка — `a[href]`, а не любой `[href]`: значок кнопки — это `<use
         href>` внутри SVG, и он становился «последним органом» окна, на
         котором Tab никогда не стоит, — ловушка не срабатывала. */
      const found = node.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea");
      return [...found].filter((element) => !element.hasAttribute("disabled"));
    };

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "Tab") return;
      const list = stops();
      if (list.length === 0) return;
      /* Потерянный фокус: после нажатия мышью на неактивное место окна
         (снимок, текст) он уходит на `body`, и Tab повёл бы по странице под
         окном. Такой Tab возвращается в окно, как и Tab с крайнего органа.
         Фокус в другом окне, открытом поверх, не трогается. */
      const потерян = document.activeElement === null || document.activeElement === document.body;
      const edge = event.shiftKey ? list[0] : list.at(-1);
      if (!потерян && document.activeElement !== edge) return;
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
