/**
 * Набор иконок продукта.
 *
 * Экраны ссылаются на символы через `<use href="#i-…">`, поэтому набор
 * обязан присутствовать в документе. До появления этого узла ссылки вели
 * в пустоту: маркер раскрытия раздела сметы и стрелка хлебных крошек
 * не рисовались вовсе.
 *
 * Рисунок общий: контурная геометрия, прямые и прямые углы — тот же
 * чертёжный язык, из которого выведен акцент. Заливка применяется только
 * там, где она несёт смысл: в переключателе темы доля закраски квадрата
 * и есть обозначение режима.
 */
export function Sprite(): React.JSX.Element {
  return (
    <svg className="icon-sprite" aria-hidden="true" focusable="false">
      <defs>
        <symbol id="i-object" viewBox="0 0 20 20"><path d="M3 3h14v14H3z" /><path d="M3 11h6V3" /></symbol>
        <symbol id="i-estimate" viewBox="0 0 20 20"><path d="M3 5h9M3 10h9M3 15h9" /><path d="M15 5h2M15 10h2M15 15h2" /></symbol>
        <symbol id="i-acceptance" viewBox="0 0 20 20"><path d="M3 3h14v14H3z" /><path d="M6.5 10.5 9 13l4.5-4.5" /></symbol>
        <symbol id="i-expense" viewBox="0 0 20 20"><path d="M5 3h10v14l-2.5-1.5L10 17l-2.5-1.5L5 17z" /><path d="M8 7h4M8 10h4" /></symbol>
        <symbol id="i-schedule" viewBox="0 0 20 20"><path d="M3 5h8M6 10h9M3 15h6" /></symbol>
        <symbol id="i-back" viewBox="0 0 20 20"><path d="M12 4 6 10l6 6" /></symbol>
        <symbol id="i-crumb" viewBox="0 0 20 20"><path d="m8 5 5 5-5 5" /></symbol>
        <symbol id="i-chevron" viewBox="0 0 20 20"><path d="m5 8 5 5 5-5" /></symbol>
        <symbol id="i-copy" viewBox="0 0 20 20"><path d="M7 7h10v10H7z" /><path d="M4 13V4h9" /></symbol>

        {/* Тема: доля закраски квадрата — половина, пусто, целиком. */}
        <symbol id="i-theme-system" viewBox="0 0 20 20">
          <path d="M3 3h14v14H3z" />
          <path d="M10 3h7v14h-7z" fill="currentColor" stroke="none" />
        </symbol>
        <symbol id="i-theme-light" viewBox="0 0 20 20"><path d="M3 3h14v14H3z" /></symbol>
        <symbol id="i-theme-dark" viewBox="0 0 20 20">
          <path d="M3 3h14v14H3z" />
          <path d="M3 3h14v14H3z" fill="currentColor" stroke="none" />
        </symbol>
      </defs>
    </svg>
  );
}
