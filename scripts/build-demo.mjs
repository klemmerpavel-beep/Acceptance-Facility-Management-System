/**
 * Сборка демонстрации в одну публикуемую страницу.
 *
 * Публикация принимает содержимое без обёртки html/head/body: скрипт
 * снимает её и встраивает собранные стили и код внутрь страницы.
 * Подключение гарнитур выносится отдельной ссылкой: внешние стили
 * допускаются только с fonts.googleapis.com, и правило @import внутри
 * встроенного блока там не срабатывает.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const assets = join(root, "apps/web/dist-demo/assets");

const files = readdirSync(assets);
const cssFile = files.find((name) => name.endsWith(".css"));
const jsFile = files.find((name) => name.endsWith(".js"));
if (cssFile === undefined || jsFile === undefined) {
  throw new Error("В сборке нет ожидаемых файлов стилей и кода. Выполните build:demo.");
}

let css = readFileSync(join(assets, cssFile), "utf8");

/**
 * Сборщик оставляет правило и как `@import url("…")`, и как `@import"…"`.
 * Разбор идёт по границам правила, а не шаблоном: так он не зависит от
 * формы, которую выберет следующая версия сборщика.
 */
const fontUrls = [];
for (;;) {
  const at = css.indexOf("@import");
  if (at === -1) break;

  // Адрес Google Fonts содержит точку с запятой в списке начертаний
  // (wght@400;500;600), поэтому граница правила ищется по кавычке,
  // а не по первой встреченной точке с запятой.
  const quote = css.slice(at).search(/["']/);
  let ruleEnd;
  if (quote !== -1) {
    const quoteChar = css[at + quote];
    const closing = css.indexOf(quoteChar, at + quote + 1);
    const url = css.slice(at + quote + 1, closing);
    if (url.startsWith("https://fonts.googleapis.com")) fontUrls.push(url);
    const semicolon = css.indexOf(";", closing);
    ruleEnd = semicolon === -1 ? css.length : semicolon + 1;
  } else {
    const semicolon = css.indexOf(";", at);
    ruleEnd = semicolon === -1 ? css.length : semicolon + 1;
  }
  css = css.slice(0, at) + css.slice(ruleEnd);
}

const js = readFileSync(join(assets, jsFile), "utf8").replaceAll("</script", "<\\/script");
const fontLinks = fontUrls.map((url) => `<link rel="stylesheet" href="${url}">`).join("\n");

const page = `<title>Приёмка</title>
${fontLinks}
<script>
  // Тема применяется до первой отрисовки: разметка появляется только после
  // загрузки модуля, и без этого выбранная светлая тема мигнула бы тёмной.
  try {
    var stored = localStorage.getItem("priyomka.theme");
    if (stored === "light" || stored === "dark") {
      document.documentElement.setAttribute("data-theme", stored);
    }
  } catch (error) {
    // Хранилище недоступно: остаётся системная тема.
  }
<\/script>
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`;

const target = join(root, "design/demo.artifact.html");
writeFileSync(target, page, "utf8");
console.log(`Страница собрана: ${target}`);
console.log(`  стили ${Math.round(css.length / 1024)} КБ, код ${Math.round(js.length / 1024)} КБ`);
console.log(`  гарнитуры вынесены ссылкой: ${fontUrls.length}`);
