/**
 * Книга находок полного аудита: `docs/13_FULL_AUDIT.xlsx` из реестра
 * `docs/13_FULL_AUDIT.md`.
 *
 * Реестр — источник, книга — его выгрузка для заказчика, который работает
 * в таблицах: отбор по степени, сортировка, пометки. Руками книга не
 * правится; после правки реестра она пересобирается этим скриптом, а
 * отставание ловит `verify-docs.mjs`.
 *
 * ExcelJS берётся зависимостью импортёра смет: новой зависимости сборка
 * не вводит.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const ExcelJS = createRequire(new URL("../packages/importer/package.json", import.meta.url))("exceljs");
const md = readFileSync(new URL("../docs/13_FULL_AUDIT.md", import.meta.url), "utf8");

const простой = (текст) => текст.replace(/\*\*/gu, "").replace(/`/gu, "").replace(/~~/gu, "").trim();
const ячейки = (строка) => строка.split("|").slice(1, -1).map(простой);
const раздел = (заголовок) => {
  const начало = md.indexOf(заголовок);
  if (начало === -1) throw new Error(`В реестре нет раздела «${заголовок}»`);
  const конец = md.indexOf("\n## ", начало + 3);
  return md.slice(начало, конец === -1 ? undefined : конец);
};
const таблица = (текст) => текст.split("\n")
  .filter((строка) => строка.startsWith("|") && !/^\|\s*-/u.test(строка))
  .map(ячейки);

const книга = new ExcelJS.Workbook();
книга.creator = "Полный аудит «Приёмки»";
книга.created = new Date("2026-09-30T12:00:00Z");

const оформить = (лист, ширины) => {
  лист.columns.forEach((колонка, номер) => { колонка.width = ширины[номер] ?? 20; });
  лист.getRow(1).font = { bold: true };
  лист.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDF0F4" } };
  лист.eachRow((строка) => { строка.alignment = { vertical: "top", wrapText: true }; });
  лист.views = [{ state: "frozen", ySplit: 1 }];
  лист.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: лист.columnCount } };
};

const ТОН = {
  "критическое": "FFFBE4E2", "среднее": "FFFAF0D7", "лёгкое": "FFE1F0E8", "решение заказчика": "FFF0EEFD",
};

const реестр = таблица(раздел("## 2. Реестр"));
const лист1 = книга.addWorksheet("Реестр");
for (const строка of реестр) лист1.addRow(строка);
лист1.eachRow((строка, номер) => {
  if (номер === 1) return;
  const степень = строка.getCell(2);
  степень.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ТОН[степень.value] ?? "FFFFFFFF" } };
});
оформить(лист1, [8, 18, 40, 70, 40, 70, 20]);

const решения = таблица(раздел("## 3. Решения заказчика"));
const лист2 = книга.addWorksheet("Решения заказчика");
лист2.addRow(["№", ...(решения[0] ?? [])]);
for (const строка of решения.slice(1)) {
  const найдено = /^(П-\d+)\.\s*(.*)$/u.exec(строка[0] ?? "");
  лист2.addRow([найдено?.[1] ?? "", найдено?.[2] ?? строка[0], строка[1], строка[2]]);
}
оформить(лист2, [8, 50, 80, 40]);

for (const [заголовок, имя, ширины] of [
  ["## 4. Заблокированное", "Заблокированное", [40, 60, 40]],
  ["## 5. Метрики захода", "Метрики", [40, 20, 60, 30]],
  ["## 6. Спорное", "Спорное", [50, 40, 70]],
]) {
  const лист = книга.addWorksheet(имя);
  for (const строка of таблица(раздел(заголовок))) лист.addRow(строка);
  оформить(лист, ширины);
}

await книга.xlsx.writeFile(new URL("../docs/13_FULL_AUDIT.xlsx", import.meta.url).pathname);
console.log(`Книга находок: ${String(реестр.length - 1)} замечаний, ${String(решения.length - 1)} решений заказчика.`);
