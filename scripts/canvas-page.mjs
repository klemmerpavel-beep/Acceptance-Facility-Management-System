/**
 * Сборка обычной страницы из артборда дизайн-канвы.
 *
 * Артборд `.dc.html` — не страница: содержимое `<helmet>` предназначено
 * заголовку документа, а обёртки `<x-dc>` расставляет редактор канвы.
 * Собирают такую страницу двое — проверка артбордов и сборка публикации,
 * — и второе написание разошлось бы с первым на первой же правке разметки
 * артборда: проверка тогда стерегла бы одну страницу, а заказчик смотрел
 * бы другую. Поэтому сборка одна и живёт отдельно.
 */
export function artboardPage(source) {
  const helmet = source.match(/<helmet>([\s\S]*?)<\/helmet>/);
  const body = source.slice(source.indexOf("</helmet>") + "</helmet>".length)
    .replace(/<\/?x-dc>/g, "")
    .replace(/<\/body>[\s\S]*$/, "");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">${helmet ? helmet[1] : ""}</head><body>${body}</body></html>`;
}
