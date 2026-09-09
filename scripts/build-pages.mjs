/**
 * Сборка каталога публикации `site/` для GitHub Pages.
 *
 * Заказчик смотрит результат итерации по постоянной ссылке, а не по
 * артефакту, живущему внутри переписки. Ссылка обязана открываться из
 * подкаталога — Pages раздаёт проект по адресу вида
 * `<пользователь>.github.io/<репозиторий>/`, — поэтому демонстрационная
 * сборка собирается с `base: "./"` (`apps/web/vite.demo.config.ts`), и
 * переименование `index.demo.html` в `index.html` относительные ссылки на
 * ресурсы не ломает.
 *
 * Новых зависимостей не вводится (требование `docs/02_DEV_PROMPT.md`):
 * копирование и запись делает штатный Node.
 *
 * Каталог `site/` — производное, в индекс не попадает.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { artboardPage } from "./canvas-page.mjs";

const root = new URL("..", import.meta.url).pathname;
const demo = join(root, "apps/web/dist-demo");
const design = join(root, "design");
const site = join(root, "site");

/** Готовые самодостаточные страницы: имя в репозитории → имя на сайте. */
const PAGES = {
  "showcase.html": "showcase.html",
  "crm.html": "screens.html",
};

/** Ширина колонки, под которую артборд ужимается на обзорной странице. */
const COLUMN = 620;

/**
 * Отметка версии. В GitHub Actions `git` доступен после checkout, но
 * сведения о ветке приходят из окружения: при сборке по событию push
 * HEAD отсоединён, и `git branch --show-current` вернул бы пустоту.
 */
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

const commit = process.env.GITHUB_SHA ?? git("rev-parse", "HEAD");
const short = commit.slice(0, 7);
const branch = process.env.GITHUB_REF_NAME ?? git("rev-parse", "--abbrev-ref", "HEAD");
const built = new Date().toISOString();

if (!existsSync(join(demo, "index.demo.html"))) {
  throw new Error(
    "Нет сборки демонстрации: выполните `pnpm --filter @priyomka/web run build:demo` "
    + "до сборки публикации.",
  );
}

rmSync(site, { recursive: true, force: true });
mkdirSync(site, { recursive: true });

// Сборка целиком, вместе с каталогом assets: имена файлов ресурсов несут
// отпечаток содержимого и перечислению по одному не подлежат.
cpSync(demo, site, { recursive: true });
rmSync(join(site, "index.demo.html"));

/* Отметка версии в самой странице. Запрос `?v=<коммит>` браузер
   игнорирует и до разметки не доходит, поэтому по одной ссылке нельзя
   сказать, какую именно сборку она открыла: адрес можно набрать любой.
   Мета-строка отвечает на этот вопрос содержимым страницы. */
const index = readFileSync(join(demo, "index.demo.html"), "utf8")
  .replace("</head>", `  <meta name="build" content="${short}">\n  </head>`);
writeFileSync(join(site, "index.html"), index);

for (const [source, target] of Object.entries(PAGES)) {
  cpSync(join(design, source), join(site, target));
}

buildCanvas();

writeFileSync(
  join(site, "version.txt"),
  `коммит: ${commit}\nкратко: ${short}\nветка:  ${branch}\nсобрано: ${built}\n`,
);

console.log(`site/ собран: ${short}, ветка ${branch}`);

/**
 * Канва — статической страницей, а не файлом редактора.
 *
 * `design/canvas/priyomka-ekrany-platformy.html` есть публикация редактора
 * канвы: страница объявляет возможности среды артефактов и вне её
 * показывает пустой экран. Сверка браузером это и намерила — ноль знаков
 * текста. Отдать заказчику пустую страницу хуже, чем не отдать никакой,
 * поэтому обзор собирается из тех же артбордов, по которым идёт
 * `verify-canvas.mjs`, и общей сборкой страницы (`canvas-page.mjs`).
 *
 * Каждый артборд живёт отдельной страницей в натуральную величину, а обзор
 * показывает их через `iframe`: у артбордов свои объявления стилей, и в
 * одном документе они наложились бы друг на друга.
 */
function buildCanvas() {
  const canvasDir = join(design, "canvas");
  const layout = JSON.parse(readFileSync(join(canvasDir, "canvas.json"), "utf8"));
  const names = new Map(layout.pages.map((page) => [page.id, page.name]));
  mkdirSync(join(site, "canvas"), { recursive: true });

  const blocks = [];
  for (const page of layout.pages) {
    const boards = layout.artboards.filter((board) => board.page === page.id);
    if (boards.length === 0) continue;
    blocks.push(`<h2>${names.get(page.id) ?? page.id}</h2>`);
    for (const board of boards) {
      const file = board.file.replace(".dc.html", ".html");
      writeFileSync(
        join(site, "canvas", file),
        artboardPage(readFileSync(join(canvasDir, board.file), "utf8")),
      );
      /* Масштаб считается здесь, а не на странице: обзор обходится без
         скриптов, и место под артборд известно до его загрузки. */
      const scale = Math.min(1, COLUMN / board.w);
      blocks.push(
        `<figure>\n<figcaption>${board.title}`
        + ` <span>${board.w}\u00A0\u00D7\u00A0${board.h}</span>`
        + ` <a href="canvas/${file}">в натуральную величину</a></figcaption>\n`
        + `<div class="frame" style="height:${Math.round(board.h * scale)}px">`
        + `<iframe src="canvas/${file}" title="${board.title}" loading="lazy"`
        + ` width="${board.w}" height="${board.h}"`
        + ` style="transform:scale(${scale.toFixed(4)})"></iframe></div>\n</figure>`,
      );
    }
  }

  /* Цвета и гарнитуры берутся из слоя стилей, а не пишутся здесь: вторая
     палитра, набранная от руки, разошлась бы с продуктом на первой же
     правке токенов — тем же путём, каким артборды пережили отмену шкалы
     скруглений. Подключение гарнитур идёт первым: правило @import
     действует только в начале таблицы стилей. */
  const styles = join(root, "packages/ui/src/styles");
  const layer = ["fonts.css", "tokens.css"]
    .map((name) => readFileSync(join(styles, name), "utf8").trim())
    .join("\n\n");

  writeFileSync(join(site, "canvas.html"), `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Приёмка — экраны платформы</title>
<meta name="build" content="${short}">
<style>
${layer}

body { margin: 0; padding: var(--space-6) var(--space-5) var(--space-7);
  background: var(--bg); color: var(--ink);
  font: var(--fw-body) var(--fs-body)/var(--lh-body) var(--font-ui); }
h1 { font: var(--fw-h1) var(--fs-h1)/var(--lh-h1) var(--font-ui); margin: 0 0 var(--space-1); }
h2 { font: var(--fw-h2) var(--fs-h2)/var(--lh-h2) var(--font-ui);
  margin: var(--space-6) 0 var(--space-3); color: var(--ink-2); }
p.lead { margin: 0 0 var(--space-2); max-width: var(--measure); color: var(--ink-2); }
figure { margin: 0 0 var(--space-5); }
figcaption { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: baseline;
  margin-block-end: var(--space-2); font-weight: var(--fw-h3); }
figcaption span { font: var(--fw-sm) var(--fs-sm)/1 var(--font-mono); color: var(--ink-3); }
figcaption a { font-weight: var(--fw-body); font-size: var(--fs-sm); color: var(--ink); }
.frame { inline-size: ${COLUMN}px; max-inline-size: 100%; overflow: hidden;
  border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
iframe { border: 0; transform-origin: top left; display: block; }
</style>
</head>
<body>
<h1>Приёмка — экраны платформы</h1>
<p class="lead">Пятнадцать артбордов дизайн-канвы, собранных статически из тех же
исходников, по которым идёт механическая проверка раскладки. Артборд показан
в уменьшении; ссылка рядом открывает его в натуральную величину.</p>
${blocks.join("\n")}
</body>
</html>
`);
}
