/**
 * Сборка демонстрации в одну публикуемую страницу.
 *
 * Публикация принимает содержимое без обёртки html/head/body: скрипт
 * снимает её и встраивает собранные стили и код внутрь страницы.
 * Подключение гарнитур выносится отдельной ссылкой: внешние стили
 * допускаются только с fonts.googleapis.com, и правило @import внутри
 * встроенного блока там не срабатывает.
 *
 * С 02.10.2026 продукт раздаёт гарнитуры из сборки (П-52): в стилях стоят
 * объявления @font-face с файлами рядом. Однофайловой версии файлов рядом
 * нет, поэтому объявления снимаются, а гарнитуры подключаются ссылкой на
 * Google Fonts — версия для артефактов её сохраняет (`fonts.mjs`).
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { GOOGLE_FONTS } from "./fonts.mjs";

const root = new URL("..", import.meta.url).pathname;
const assets = join(root, "apps/web/dist-demo/assets");

const files = readdirSync(assets);
const cssFile = files.find((name) => name.endsWith(".css"));
const jsFile = files.find((name) => name.endsWith(".js"));
if (cssFile === undefined || jsFile === undefined) {
  throw new Error("В сборке нет ожидаемых файлов стилей и кода. Выполните build:demo.");
}

/**
 * Устаревшая сборка — молчаливый дефект. `pnpm -r build` собирает обычную
 * версию клиента и каталога `dist-demo` не трогает: этот скрипт брал
 * вчерашний код, писал файл с прежним содержимым и рапортовал об успехе.
 * Дальше в публикацию уходила страница, не отвечающая ни исходникам, ни
 * слепку. Проверяется по времени изменения.
 */
const newest = (directory) => {
  let latest = 0;
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) walk(child);
      else latest = Math.max(latest, statSync(child).mtimeMs);
    }
  };
  walk(directory);
  return latest;
};
const built = statSync(join(assets, jsFile)).mtimeMs;
for (const source of ["apps/web/src", "packages/ui/src"]) {
  const changed = newest(join(root, source));
  if (changed > built) {
    throw new Error(
      `Сборка старше исходников (${source} изменён позже). Выполните ` +
      "`pnpm --filter @priyomka/web run build:demo` и повторите.",
    );
  }
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

/* Объявления гарнитур из сборки ссылаются на файлы рядом со стилями —
   в одном файле их нет. Снимаются целиком; гарнитуры приходят ссылкой. */
const объявлений = (css.match(/@font-face\s*\{[^}]*\}/gu) ?? []).length;
css = css.replace(/@font-face\s*\{[^}]*\}/gu, "");
if (объявлений > 0) fontUrls.push(GOOGLE_FONTS);

const js = readFileSync(join(assets, jsFile), "utf8").replaceAll("</script", "<\\/script");
const fontLinks = fontUrls.map((url) => `<link rel="stylesheet" href="${url}">`).join("\n");

const page = `<title>Приёмка — DOLGIY STUDIO</title>
${fontLinks}
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`;

/**
 * Два файла, как у витрины дизайн-системы. Публикуемый фрагмент идёт без
 * обёртки `html/head/body` — её ставит служба публикации. Самостоятельная
 * страница нужна затем, чтобы демонстрацию можно было просто открыть
 * файлом: браузер разберёт и фрагмент, но отдавать человеку документ без
 * объявления кодировки и языка — значит перекладывать на него угадывание.
 */
const standalone = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${page}</html>
`;

writeFileSync(join(root, "design/demo.artifact.html"), page, "utf8");
writeFileSync(join(root, "design/demo.html"), standalone, "utf8");
console.log("Демонстрация собрана: design/demo.html и design/demo.artifact.html");
console.log(`  стили ${Math.round(css.length / 1024)} КБ, код ${Math.round(js.length / 1024)} КБ`);
console.log(`  гарнитуры вынесены ссылкой: ${fontUrls.length}`);
