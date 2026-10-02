/**
 * Сборка витрины трёх экранов для приёмки.
 *
 * Витрина показывает Главную, Проекты и Контакты со статичными данными и
 * три обязательных состояния — пустое, загрузку, подтверждение добавления.
 * Она нужна для просмотра и разметки замечаний и реализацию не подменяет:
 * работающие экраны живут в `apps/web`, проверяются на стенде и собираются
 * в демонстрацию `design/demo.artifact.html`.
 *
 * Слой стилей встраивается из `packages/ui`, а не пишется копией. Это тот
 * же довод, что у витрины дизайн-системы: копия расходится с продуктом при
 * первой правке, и заказчик размечает замечания по странице, которой в
 * продукте уже нет.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GOOGLE_FONTS } from "./fonts.mjs";

const root = new URL("..", import.meta.url).pathname;
const styles = join(root, "packages/ui/src/styles");
const design = join(root, "design");

/* Ссылка на Google Fonts — для версии артефакта и исходника публикации;
   публикация подменяет её гарнитурами из сборки (`fonts.mjs`, П-52). */
const FONTS = GOOGLE_FONTS;
const TITLE = "Приёмка: три экрана";

// Порядок тот же, что в index.css: токены, база, сетка, компоненты.
const layer = ["tokens.css", "base.css", "layout.css", "components.css"]
  .map((name) => readFileSync(join(styles, name), "utf8").trim())
  .join("\n\n");
const body = readFileSync(join(design, "crm.body.html"), "utf8").trim();

const page = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE}</title>
<link rel="stylesheet" href="${FONTS}">
<style>
${layer}
</style>
</head>
<body>

${body}

</body>
</html>
`;

const artifact = `<title>${TITLE}</title>
<link rel="stylesheet" href="${FONTS}">
<style>
${layer}
</style>

${body}
`;

writeFileSync(join(design, "crm.html"), page, "utf8");
writeFileSync(join(design, "crm.artifact.html"), artifact, "utf8");
console.log("Витрина трёх экранов собрана: design/crm.html и design/crm.artifact.html");
console.log(`  правил слоя стилей ${Math.round(layer.length / 1024)} КБ,`,
  `разметки ${Math.round(body.length / 1024)} КБ`);
