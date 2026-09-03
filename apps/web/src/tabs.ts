import type { KeyboardEvent } from "react";

/**
 * Управление полосой вкладок с клавиатуры.
 *
 * Написано дважды — в карточке объекта и в настройках, — и второе написание
 * разойдётся с первым на третьей правке, поэтому вынесено сюда (вынос по
 * этапу 4.1; сам шаблон вкладок — реестр Д-11).
 *
 * Шаблон вкладок требует, чтобы стрелки переводили выбор, а Tab уводил из
 * полосы в её содержимое. Второе обеспечивается разметкой: `tabIndex` равен
 * нулю только у выбранной вкладки. Первое — этой функцией.
 */
export function tabArrowHandler<Key extends string>(
  keys: readonly Key[],
  current: Key,
  choose: (next: Key) => void,
  domId: (key: Key) => string,
): (event: KeyboardEvent<HTMLDivElement>) => void {
  return (event) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = keys.indexOf(current);
    const next = keys[(index + step + keys.length) % keys.length];
    if (next === undefined) return;
    choose(next);
    document.getElementById(domId(next))?.focus();
  };
}
