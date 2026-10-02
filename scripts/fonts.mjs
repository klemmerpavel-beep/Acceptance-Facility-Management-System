/**
 * Гарнитуры для страниц вне продукта.
 *
 * Продукт и опубликованные страницы раздают гарнитуры из сборки
 * (`packages/ui/src/fonts`, решение заказчика от 01.10.2026, П-52): адрес
 * пользователя не уходит третьей стороне. Версии для артефактов
 * (`*.artifact.html`, однофайловая `design/demo.html`) сохраняют ссылку на
 * Google Fonts — среда артефактов не допускает иных внешних стилей и не
 * раздаёт файлов рядом со страницей. Публикация (`build-pages.mjs`)
 * подменяет эту ссылку своей таблицей.
 */
export const GOOGLE_FONTS =
  "https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600"
  + "&family=IBM+Plex+Mono:wght@400;500;600&display=swap";

/** Ссылки и предварительные соединения с узлами Google Fonts в разметке. */
const ССЫЛКА_GOOGLE = /[ \t]*<link\b[^>]*\bhref="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^"]*"[^>]*>\n?/gu;

/**
 * Страница с гарнитурами из сборки: ссылки на Google Fonts снимаются, вместо
 * них — одна таблица `fonts.css` публикации. `путь` — путь к ней от страницы.
 */
export function своиГарнитуры(html, путь) {
  if (!ССЫЛКА_GOOGLE.test(html)) return html;
  ССЫЛКА_GOOGLE.lastIndex = 0;
  let вставлено = false;
  return html.replace(ССЫЛКА_GOOGLE, (найдено) => {
    if (вставлено) return "";
    вставлено = true;
    const отступ = /^[ \t]*/u.exec(найдено)?.[0] ?? "";
    return `${отступ}<link rel="stylesheet" href="${путь}">\n`;
  });
}
