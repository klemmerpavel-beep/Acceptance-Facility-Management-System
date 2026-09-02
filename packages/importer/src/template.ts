/**
 * Эталонный шаблон сметы.
 *
 * Система выдаёт книгу с известной шапкой, в которую смета переносится
 * перед импортом. Ключевое поле — «Заявленный итог по работам»: если
 * итог считает система, расхождение исчезает вместе с доказательством.
 * Поэтому в шаблон переносится строка итога из исходного файла как есть,
 * а система сравнивает с ней свой пересчёт (БП-09).
 */

import ExcelJS from "exceljs";
import { CANONICAL_UNITS } from "./units.js";

export interface TemplateOptions {
  readonly projectCode: string;
  readonly address: string;
  /** Надбавка «сопровождение объекта» в сотых долях процента. */
  readonly supervisionShare: number;
}

const COLUMNS = [
  { header: "Наименование работ", width: 54 },
  { header: "Ед. изм.", width: 10 },
  { header: "Кол.", width: 10 },
  { header: "Стоимость единицы", width: 16 },
  { header: "З/П единицы", width: 14 },
  { header: "Общая стоимость", width: 16 },
  { header: "З/П рабочих", width: 14 },
  { header: "Прибыль", width: 14 },
] as const;

export async function buildTemplate(options: TemplateOptions): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "Приёмка";
  book.created = new Date();

  const sheet = book.addWorksheet("Расчет");
  sheet.getCell("A1").value = `Смета объекта ${options.projectCode} — ${options.address}`;
  sheet.getCell("A1").font = { bold: true, size: 12 };
  sheet.getCell("A2").value =
    "Заполните позиции под заголовками разделов. Раздел верхнего уровня пишется ПРОПИСНЫМИ, " +
    "подраздел — обычным начертанием. Строку «Итого» оставьте как в исходной смете.";
  sheet.getCell("A2").font = { size: 9, color: { argb: "FF7C8DA0" } };

  const headerRow = sheet.getRow(4);
  COLUMNS.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.header;
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDF0F4" } };
    sheet.getColumn(index + 1).width = column.width;
  });

  // Пример раздела и позиции: показывает ожидаемый формат, но не является
  // данными. Строки помечены, чтобы их удалили перед импортом.
  const example = sheet.getRow(5);
  example.getCell(1).value = "ПРИМЕР РАЗДЕЛА — УДАЛИТЕ ПЕРЕД ИМПОРТОМ";
  example.getCell(1).font = { bold: true };
  sheet.mergeCells(5, 1, 5, 6);

  const exampleItem = sheet.getRow(6);
  exampleItem.getCell(1).value = "Штукатурка стен по маякам (до 2,5 см)";
  exampleItem.getCell(2).value = "м²";
  exampleItem.getCell(3).value = 406.91;
  exampleItem.getCell(4).value = 900;
  exampleItem.getCell(5).value = 350;
  exampleItem.getCell(6).value = { formula: "C6*D6", result: 366219 };
  exampleItem.getCell(7).value = { formula: "C6*E6", result: 142418.5 };
  exampleItem.getCell(8).value = { formula: "F6-G6", result: 223800.5 };

  const exampleTotal = sheet.getRow(7);
  exampleTotal.getCell(1).value = "Итого:";
  exampleTotal.getCell(1).font = { bold: true };
  exampleTotal.getCell(6).value = { formula: "SUM(F6:F6)", result: 366219 };

  // Контрольный блок. Значения переносятся из исходной сметы как есть:
  // расхождение между ними и пересчётом системы и есть предмет отчёта.
  const control = sheet.getRow(10);
  control.getCell(1).value = "ЗАЯВЛЕННЫЙ ИТОГ ПО РАБОТАМ (перенесите из исходной сметы)";
  control.getCell(1).font = { bold: true };
  control.getCell(6).value = 0;
  control.getCell(6).numFmt = "# ##0.00";

  const supervision = sheet.getRow(11);
  supervision.getCell(1).value = "Сопровождение объекта прорабом и топливные расходы (% от сметы)";
  supervision.getCell(2).value = "%";
  supervision.getCell(4).value = options.supervisionShare / 10_000;
  supervision.getCell(4).numFmt = "0%";

  const units = book.addWorksheet("Единицы");
  units.getCell("A1").value = "Допустимые единицы измерения";
  units.getCell("A1").font = { bold: true };
  CANONICAL_UNITS.forEach((unit, index) => {
    units.getCell(index + 2, 1).value = unit;
  });
  units.getColumn(1).width = 14;

  const buffer = await book.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
