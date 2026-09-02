/**
 * Сборка витрины дизайн-системы.
 *
 * Витрина существовала тремя копиями: страница целиком, публикуемая версия
 * без обёртки и разметка отдельно. Слой стилей в двух из них был встроен
 * копией и расходился с `packages/ui` при каждой правке — новый компонент
 * появлялся в продукте и не появлялся в витрине.
 *
 * Источники ровно два: правила слоя стилей и разметка витрины. Остальное
 * собирается отсюда.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const styles = join(root, "packages/ui/src/styles");
const design = join(root, "design");

const FONTS =
  "https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600" +
  "&family=IBM+Plex+Mono:wght@400;500;600&display=swap";
const TITLE = "Дизайн-система Приёмки";

// Порядок тот же, что в index.css: токены, база, сетка, компоненты.
// Гарнитуры подключаются ссылкой, а не правилом @import: внутри
// встроенного блока оно не срабатывает в публикации.
const layer = ["tokens.css", "base.css", "layout.css", "components.css"]
  .map((name) => readFileSync(join(styles, name), "utf8").trim())
  .join("\n\n");
const own = readFileSync(join(design, "showcase.css"), "utf8").trim();
const body = readFileSync(join(design, "showcase.body.html"), "utf8").trim();

const css = `${layer}\n\n${own}\n`;

const page = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE}</title>
<link rel="stylesheet" href="${FONTS}">
<style>
${css}</style>
</head>
<body>

${body}

</body>
</html>
`;

const artifact = `<title>${TITLE}</title>
<link rel="stylesheet" href="${FONTS}">
<style>
${css}</style>

${body}
`;

writeFileSync(join(design, "showcase.html"), page, "utf8");
writeFileSync(join(design, "showcase.artifact.html"), artifact, "utf8");
console.log("Витрина собрана: design/showcase.html и design/showcase.artifact.html");
console.log(`  правил слоя стилей ${Math.round(layer.length / 1024)} КБ,`,
  `витринных ${Math.round(own.length / 1024)} КБ, разметки ${Math.round(body.length / 1024)} КБ`);
