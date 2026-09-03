#!/usr/bin/env node
/**
 * Рассылает единый заголовок артбордов канвы из `design/canvas/_head.txt`.
 *
 * Артборды — самостоятельные файлы: каждый несёт свою копию `<helmet>` со
 * слоем токенов и компонентов. Копий двенадцать, и они уже расходились —
 * ровно так же, как расходилась встроенная копия CSS в витрине. Единственный
 * источник — `_head.txt`; этот скрипт переписывает в каждом артборде всё до
 * закрывающего `</helmet>` включительно, ничего не трогая ниже.
 *
 * Запуск без аргументов правит файлы. С `--check` только проверяет, что
 * расхождений нет, и завершается кодом 1, если они есть.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const canvasDir = join(dirname(fileURLToPath(import.meta.url)), "..", "design", "canvas");
const MARK = "</helmet>";
const head = readFileSync(join(canvasDir, "_head.txt"), "utf8");
const check = process.argv.includes("--check");

const artboards = readdirSync(canvasDir).filter((name) => name.endsWith(".dc.html")).sort();
let changed = 0;

for (const name of artboards) {
  const path = join(canvasDir, name);
  const source = readFileSync(path, "utf8");
  const at = source.indexOf(MARK);
  if (at === -1) {
    console.error(`${name}: не найден ${MARK}`);
    process.exit(1);
  }
  const body = source.slice(at + MARK.length);
  const next = head + body;
  if (next === source) continue;
  changed += 1;
  if (check) console.error(`${name}: заголовок расходится с _head.txt`);
  else writeFileSync(path, next);
}

if (check) {
  if (changed > 0) {
    console.error(`Расхождений: ${changed}. Запустите scripts/sync-canvas-head.mjs без --check.`);
    process.exit(1);
  }
  console.log(`Заголовок совпадает во всех ${artboards.length} артбордах.`);
} else {
  console.log(`Артбордов: ${artboards.length}, обновлено: ${changed}.`);
}
