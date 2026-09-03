#!/usr/bin/env node
/**
 * Пересобирает страницу дизайн-канвы из файлов `design/canvas`.
 *
 * Опубликованная страница `priyomka-ekrany-platformy.html` несёт в себе и
 * редактор канвы, и содержимое: содержимое лежит в блоке
 * `<script type="application/json" id="appifact-doc">` как
 * `content.files` — по одному исходнику `.dc.html` на артборд плюс
 * `canvas.json` с раскладкой. Скрипт заменяет только эту запись, оставляя
 * код редактора без изменений: собирать страницу заново неоткуда, а
 * поддерживать копии артбордов в двух местах — тот же дефект расхождения,
 * от которого уже избавились в витрине.
 *
 * `--check` ничего не пишет и завершается кодом 1, если страница отстала
 * от файлов на диске.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const canvasDir = join(dirname(fileURLToPath(import.meta.url)), "..", "design", "canvas");
const page = join(canvasDir, "priyomka-ekrany-platformy.html");
const OPEN = '<script type="application/json" id="appifact-doc">';
const CLOSE = "</script>";
const check = process.argv.includes("--check");

const source = readFileSync(page, "utf8");
const from = source.indexOf(OPEN);
if (from === -1) throw new Error(`В ${page} не найден блок ${OPEN}`);
const start = from + OPEN.length;
const end = source.indexOf(CLOSE, start);
if (end === -1) throw new Error("Блок appifact-doc не закрыт");

const doc = JSON.parse(source.slice(start, end));

const entry = "Main.dc.html";
const names = readdirSync(canvasDir)
  .filter((name) => name.endsWith(".dc.html"))
  .sort((a, b) => (a === entry ? -1 : b === entry ? 1 : a.localeCompare(b, "ru")));

const files = {};
for (const name of names) files[name] = readFileSync(join(canvasDir, name), "utf8");
files["canvas.json"] = readFileSync(join(canvasDir, "canvas.json"), "utf8");

// Раскладка обязана называть ровно те файлы, что лежат рядом.
const layout = JSON.parse(files["canvas.json"]);
const declared = new Set(layout.artboards.map((board) => board.file));
for (const name of names) {
  if (!declared.has(name)) throw new Error(`${name} нет в canvas.json`);
}
for (const name of declared) {
  if (!(name in files)) throw new Error(`canvas.json называет ${name}, которого нет на диске`);
}

doc.content = { files };

// `</script>` внутри исходников закрыл бы блок раньше времени.
const payload = JSON.stringify(doc).replaceAll("</script>", "<\\/script>");
const next = source.slice(0, start) + payload + source.slice(end);

if (check) {
  if (next !== source) {
    console.error("Страница канвы отстала от файлов в design/canvas.");
    process.exit(1);
  }
  console.log(`Страница канвы совпадает с ${names.length} артбордами и раскладкой.`);
} else {
  writeFileSync(page, next);
  const kb = (Buffer.byteLength(next) / 1024).toFixed(0);
  console.log(`Собрано: артбордов ${names.length}, страница ${kb} КБ.`);
}
