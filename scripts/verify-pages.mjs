/**
 * Проверка каталога публикации `site/`.
 *
 * Публикация тем и опасна, что дефект в ней виден только заказчику и
 * только по ссылке: локально страница открывается из корня и работает,
 * а на Pages живёт в подкаталоге. Проверяются четыре утверждения, каждое
 * из которых уже однажды ломало бы сайт молча.
 *
 * Запускается сразу после `build-pages.mjs`, до отправки артефакта.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const site = join(root, "site");

const problems = [];
const note = (detail) => problems.push(detail);

if (!existsSync(site)) {
  console.error("Каталога site/ нет: сборка публикации не выполнялась.");
  process.exit(1);
}

/* 1. Состав. Страниц ровно шесть, и каждая — ответ на отдельный вопрос
      заказчика. Недостача означает, что источник переименовали, а сборку
      не поправили: на сайте вместо страницы будет 404. */
const REQUIRED = [
  "index.html", "showcase.html", "screens.html", "canvas.html", "audit.html", "version.txt",
];
for (const name of REQUIRED) {
  const path = join(site, name);
  if (!existsSync(path)) { note(`нет файла site/${name}`); continue; }
  if (statSync(path).size === 0) note(`файл site/${name} пуст`);
}

const assets = existsSync(join(site, "assets")) ? readdirSync(join(site, "assets")) : [];
if (!assets.some((n) => n.endsWith(".js"))) note("в site/assets нет ни одного скрипта");
if (!assets.some((n) => n.endsWith(".css"))) note("в site/assets нет ни одного стиля");

const index = existsSync(join(site, "index.html"))
  ? readFileSync(join(site, "index.html"), "utf8")
  : "";

/* 2. Корневые ссылки. Pages раздаёт проект из подкаталога: `/assets/…`
      уйдёт в корень домена, где ничего нет, и страница откроется белой.
      Стережёт `base: "./"` в vite.demo.config.ts. */
for (const [, attribute, value] of index.matchAll(/\b(src|href)="([^"]*)"/g)) {
  if (value.startsWith("/")) note(`ссылка от корня домена в index.html: ${attribute}="${value}"`);
}

/* 3. Подмена слоя данных. Демонстрация работает без сервера: экраны
      импортируют `./api.js`, а сборка разрешает этот запрос в
      `api.demo.ts`. Сорвись подмена — в бандл попал бы продуктовый
      клиент, и заказчик увидел бы вечную загрузку вместо объекта.
      Обе строки принадлежат только `api.ts` и в двойнике не встречаются. */
const bundle = assets
  .filter((n) => n.endsWith(".js"))
  .map((n) => readFileSync(join(site, "assets", n), "utf8"))
  .join("\n");
if (bundle.includes('"/api"')) note("в бандле адрес \"/api\": подставлен продуктовый клиент");
if (bundle.includes("Нет связи с сервером")) {
  note("в бандле сообщение об отсутствии сети: подставлен продуктовый клиент");
}

/* 3-а. Записи проверок в слепке. Слепок бандлится в скрипт демонстрации,
      и след проверок в нём означает, что снимали со стенда после прогона:
      заказчик увидит объект «Проверочный адрес 1», заказчика «Проверка API»
      и транш на рубль. Съёмку стережёт `capture-demo.mjs`, но слепок живёт
      в индексе и правится руками — проверка стоит и здесь, на публикуемом
      файле. */
for (const [признак, что] of [
  [/Проверка API/u, "«Проверка API»"],
  [/Проверочный адрес/u, "«Проверочный адрес»"],
  /* Слепок бандлится в скрипт и минифицируется: кавычки у имени ключа
     пропадают, и правило, писанное под JSON, до него не достаёт. */
  [/\bcode:\s*"T-\d+"|"code":\s*"T-\d+"/u, "код вида T-…"],
]) {
  if (признак.test(bundle)) note(`в слепке демонстрации запись проверок: ${что}`);
}

/* 4. Отметка версии. Ссылка вида `?v=<коммит>` самодокументируема лишь
      тогда, когда страница и вправду собрана из этого коммита. */
const commit = process.env.GITHUB_SHA
  ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const version = existsSync(join(site, "version.txt"))
  ? readFileSync(join(site, "version.txt"), "utf8")
  : "";
if (!version.includes(commit)) note(`version.txt не содержит текущий коммит ${commit.slice(0, 7)}`);
if (!index.includes(`content="${commit.slice(0, 7)}"`)) {
  note("в index.html нет отметки сборки <meta name=\"build\">");
}

/* 5. Канва. Файл `design/canvas/priyomka-ekrany-platformy.html` — публикация
      редактора канвы: вне среды артефактов он показывает пустой экран, и
      однажды в этом виде уже был назначен на сайт. Обзор собирается из
      артбордов, и проверка сверяет его с объявленным составом канвы. */
const canvas = existsSync(join(site, "canvas.html"))
  ? readFileSync(join(site, "canvas.html"), "utf8")
  : "";
if (canvas.includes("appifact-capabilities")) {
  note("на сайт попала публикация редактора канвы: вне среды артефактов она пуста");
}
const layout = JSON.parse(
  readFileSync(join(root, "design/canvas/canvas.json"), "utf8"),
);
for (const board of layout.artboards) {
  const file = board.file.replace(".dc.html", ".html");
  if (!existsSync(join(site, "canvas", file))) note(`нет страницы артборда site/canvas/${file}`);
  if (!canvas.includes(`canvas/${file}`)) note(`артборд ${board.file} не показан в обзоре канвы`);
}

/* 6. Квиз. Двенадцать вопросов — не украшение страницы, а то, ради чего
      она опубликована: ответы назначают очередь работ. Страница, потерявшая
      вопросы при правке, выглядит целой. */
const аудит = existsSync(join(site, "audit.html"))
  ? readFileSync(join(site, "audit.html"), "utf8")
  : "";
const вопросов = (аудит.match(/<fieldset>/gu) ?? []).length;
if (вопросов !== 12) note(`на странице аудита ${вопросов} вопросов вместо двенадцати`);
if (!аудит.includes("Скопировать")) note("на странице аудита нет кнопки переноса ответов");

if (problems.length > 0) {
  console.error(`Дефектов публикации: ${problems.length}\n`
    + problems.map((p) => `  ${p}`).join("\n"));
  process.exit(1);
}
console.log(`Публикация проверена: ${REQUIRED.length} файлов, ${assets.length} ресурсов, `
  + `${layout.artboards.length} артбордов, ${вопросов} вопросов квиза. Дефектов нет.`);
