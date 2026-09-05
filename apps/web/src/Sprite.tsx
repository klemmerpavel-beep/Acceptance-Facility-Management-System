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
        <symbol id="i-mark" viewBox="0 0 20 20"><path d="M4 3h7l5 5v4l-5 5H4z"/><path d="M8 7h4"/></symbol>
        <symbol id="i-object" viewBox="0 0 20 20"><path d="M3 3h14v14H3z" /><path d="M3 11h6V3" /></symbol>
        <symbol id="i-estimate" viewBox="0 0 20 20"><path d="M3 5h9M3 10h9M3 15h9" /><path d="M15 5h2M15 10h2M15 15h2" /></symbol>
        <symbol id="i-acceptance" viewBox="0 0 20 20"><path d="M3 3h14v14H3z" /><path d="M6.5 10.5 9 13l4.5-4.5" /></symbol>
        <symbol id="i-expense" viewBox="0 0 20 20"><path d="M5 3h10v14l-2.5-1.5L10 17l-2.5-1.5L5 17z" /><path d="M8 7h4M8 10h4" /></symbol>
        <symbol id="i-schedule" viewBox="0 0 20 20"><path d="M3 5h8M6 10h9M3 15h6" /></symbol>
        <symbol id="i-back" viewBox="0 0 20 20"><path d="M12 4 6 10l6 6" /></symbol>
        <symbol id="i-crumb" viewBox="0 0 20 20"><path d="m8 5 5 5-5 5" /></symbol>
        <symbol id="i-chevron" viewBox="0 0 20 20"><path d="m5 8 5 5 5-5" /></symbol>
        <symbol id="i-copy" viewBox="0 0 20 20"><path d="M7 7h10v10H7z" /><path d="M4 13V4h9" /></symbol>

        {/* Разделы шапки. Рисунок тот же чертёжный: прямые и прямые углы. */}
        <symbol id="i-home" viewBox="0 0 20 20"><path d="M3 9 10 3l7 6v8H3z" /><path d="M8 17v-5h4v5" /></symbol>
        <symbol id="i-request" viewBox="0 0 20 20"><path d="M4 3h9l3 3v11H4z" /><path d="M7 8h6M7 11h6M7 14h3" /></symbol>
        <symbol id="i-people" viewBox="0 0 20 20"><path d="M4 4h4v3H4z" /><path d="M2 13v-2h8v2" /><path d="M12 7h4v3h-4z" /><path d="M10 16v-2h8v2" /></symbol>
        <symbol id="i-badge" viewBox="0 0 20 20"><path d="M4 5h12v11H4z" /><path d="M8 8h4v3H8z" /><path d="M7 14h6" /></symbol>
        <symbol id="i-money" viewBox="0 0 20 20"><path d="M3 6h14v8H3z" /><path d="M8 10h4" /></symbol>
        <symbol id="i-document" viewBox="0 0 20 20"><path d="M5 3h7l3 3v11H5z" /><path d="M12 3v3h3" /><path d="M8 11h5M8 14h5" /></symbol>
        <symbol id="i-settings" viewBox="0 0 20 20"><path d="M4 6h12M4 10h12M4 14h12" /><path d="M8 4v4M13 8v4M6 12v4" /></symbol>
        <symbol id="i-more" viewBox="0 0 20 20"><path d="M4 10h.01M10 10h.01M16 10h.01" /></symbol>

        {/* Действия и списки. */}
        <symbol id="i-plus" viewBox="0 0 20 20"><path d="M10 4v12M4 10h12" /></symbol>
        {/* Колокол уведомлений и знак просрочки — редакция 2.0. Рисунок тот
            же чертёжный: контур, прямые, прямые углы. */}
        <symbol id="i-bell" viewBox="0 0 20 20"><path d="M5 14V9a5 5 0 0 1 10 0v5" /><path d="M3 14h14" /><path d="M8 17h4" /></symbol>
        <symbol id="i-alert" viewBox="0 0 20 20"><path d="M10 3 3 16h14z" /><path d="M10 8v4M10 14h.01" /></symbol>
        <symbol id="i-calendar" viewBox="0 0 20 20"><path d="M3 5h14v12H3z" /><path d="M3 9h14M7 3v4M13 3v4" /></symbol>
        {/* Аватар работающего в шапке. Геометрический силуэт без черт лица:
            сотрудник стенда вымышлен, и портрет выдавал бы его за настоящего
            человека. Рисунок тот же контурный, что у прочих иконок. */}
        <symbol id="i-avatar" viewBox="0 0 20 20"><path d="M10 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6z" /><path d="M4 17v-1a6 6 0 0 1 12 0v1" /></symbol>
        <symbol id="i-search" viewBox="0 0 20 20"><path d="M9 3a6 6 0 1 0 0 12A6 6 0 0 0 9 3z" /><path d="M13.5 13.5 17 17" /></symbol>
        <symbol id="i-sort" viewBox="0 0 20 20"><path d="M6 8 10 4l4 4" /><path d="M6 12l4 4 4-4" /></symbol>
        <symbol id="i-sort-asc" viewBox="0 0 20 20"><path d="M6 12 10 8l4 4" /></symbol>
        <symbol id="i-sort-desc" viewBox="0 0 20 20"><path d="M6 8l4 4 4-4" /></symbol>

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
