/**
 * Обезличивание сметы заказчика для фикстуры тестов.
 *
 * 152-ФЗ и коммерческая тайна: реальный файл в репозиторий не попадает.
 * Сохраняется всё, что нужно для проверки импортёра, — 141 позиция,
 * единицы, цены, ставки, структура разделов, заявленные итоги и все
 * арифметические дефекты. Удаляются: имя компании и номер договора в
 * шапке, имена мастеров в графике, строка подписей сторон.
 *
 * Использование:
 *   node scripts/anonymise-estimate.mjs <исходный.xlsx> <фикстура.xlsx>
 */
import ExcelJS from "exceljs";

const [, , source, target] = process.argv;
if (!source || !target) {
  console.error("Укажите путь к исходному файлу и путь к фикстуре");
  process.exit(1);
}

const book = new ExcelJS.Workbook();
await book.xlsx.readFile(source);

const calc = book.getWorksheet("Расчет");
if (!calc) throw new Error("Лист «Расчет» не найден");
calc.getCell("A1").value = "Приложение 1  Предворительный расчет                    12.11.2025";
calc.getCell("A2").value = "                ПОДРЯДЧИК               №0/00";
// Строка подписей сторон в конце сметы.
for (let row = calc.rowCount; row > calc.rowCount - 8; row -= 1) {
  const value = calc.getCell(row, 1).value;
  if (typeof value === "string" && value.includes("Заказчик")) {
    calc.getCell(row, 1).value = "Заказчик                                        Подрядчик";
  }
}

const schedule = book.getWorksheet("График");
if (schedule) {
  // Имена мастеров — персональные данные. Заменяются устойчивыми кодами,
  // чтобы проверка привязки этапа к мастеру осталась осмысленной.
  const codes = new Map();
  schedule.eachRow((row, index) => {
    if (index === 1) return;
    const cell = row.getCell(3);
    const name = typeof cell.value === "string" ? cell.value.trim() : "";
    if (!name) return;
    if (!codes.has(name)) codes.set(name, `Мастер ${codes.size + 1}`);
    cell.value = codes.get(name);
  });
  console.log("Мастеров обезличено:", codes.size);
}

await book.xlsx.writeFile(target);
console.log("Фикстура записана:", target);
