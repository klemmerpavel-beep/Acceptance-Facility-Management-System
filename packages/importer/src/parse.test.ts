import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { formatKopecks } from "@priyomka/ui";
import { parseWorkbook, type ParsedEstimate } from "./parse.js";
import { buildDiscrepancyReport, type DiscrepancyReport } from "./report.js";
import { buildTemplate } from "./template.js";

/**
 * Обезличенная производная действующего файла «Московский проспект 116»
 * от 25.08.2026. Сохранены все позиции, единицы, цены, ставки, структура
 * разделов, заявленные итоги и арифметические дефекты; удалены имя
 * компании, номер договора и имена мастеров.
 */
const FIXTURE = join(import.meta.dirname, "..", "fixtures", "smeta-obezlichennaya.xlsx");

/**
 * Ожидаемая сумма. Разряды в ожидании записаны обычным пробелом, а
 * форматтер ставит неразрывный (§3.1 дизайн-системы): помощник убирает
 * расхождение, которое иначе читается как «строки одинаковы, но не равны».
 */
const rub = (value: string): string => `${value.replace(/ /g, "\u00A0")}\u00A0₽`;

let parsed: ParsedEstimate;
let report: DiscrepancyReport;

beforeAll(async () => {
  parsed = await parseWorkbook(readFileSync(FIXTURE));
  report = buildDiscrepancyReport(parsed);
});

describe("разбор структуры файла заказчика", () => {
  it("шапка найдена по подписям колонок, а не по буквам", () => {
    expect(parsed.sheetName).toBe("Расчет");
    expect(parsed.headerRow).toBe(3);
    expect(parsed.columns).toMatchObject({
      name: 1, unit: 2, qty: 3, unitPrice: 4, unitWage: 5, total: 6, wageTotal: 7, profit: 8,
    });
  });

  it("переносится 132 позиции работ", () => {
    // Документация называет 141. Разбор показывает, что в это число входят
    // 132 позиции работ, 7 строк блока дополнительных расходов, строка
    // надбавки «сопровождение объекта» и подытог кондиционирования,
    // стоящий в колонке D. Приёмке подлежат именно 132 позиции.
    expect(report.positions).toBe(132);
    expect(report.positions + report.otherExpenses + 1 + 1).toBe(141);
  });

  it("разделы разделены на два уровня по начертанию и регистру", () => {
    expect(report.sectionsTopLevel).toBe(11);
    expect(report.sectionsNested).toBe(11);
    expect(report.sectionsTotal).toBe(22);
  });

  it("вложенность отражена в пути позиции", () => {
    const item = parsed.items.find((i) => i.name.startsWith("Сквозное отверстие"));
    expect(item?.sectionPath).toEqual(["КОНДИЦИОНИРОВАНИЕ (ПО ФАКТУ)", "Черной монтаж"]);
  });

  it("блок дополнительных расходов отделён от работ", () => {
    expect(report.otherExpenses).toBe(7);
    expect(parsed.otherExpenses.every((i) => i.qty === null)).toBe(true);
  });

  it("надбавка «сопровождение объекта» распознана как 12 %", () => {
    expect(parsed.supervisionShare).toBe(1200);
  });
});

describe("БП-09: отчёт о расхождениях", () => {
  it("пересчёт по позициям расходится с заявленным итогом на 438 800,00 ₽", () => {
    expect(formatKopecks(report.computedWorksTotal)).toBe(rub("3 794 852,10"));
    expect(formatKopecks(report.declaredWorksTotal!)).toBe(rub("3 356 052,10"));
    expect(formatKopecks(report.worksTotalDelta!)).toBe(rub("438 800,00"));
  });

  it("находит раздел с пустой ячейкой итога на 143 800,00 ₽", () => {
    const empty = report.findings.filter((f) => f.kind === "section-total-empty");
    expect(empty).toHaveLength(1);
    expect(empty[0]).toMatchObject({ section: "МОНТАЖНЫЕ РАБОТЫ" });
    expect(formatKopecks(empty[0]!.computed)).toBe(rub("143 800,00"));
  });

  it("итог сметы с надбавкой совпадает с файлом при исправном итоге по работам", () => {
    // Надбавка в файле считается от заявленного итога по работам, поэтому
    // при исправлении недосчёта итог сметы вырастет вместе с ней.
    expect(report.supervisionShare).toBe(1200);
    expect(formatKopecks(report.supervisionAmount!)).toBe(rub("455 382,25"));
    expect(formatKopecks(report.computedEstimateTotal)).toBe(rub("4 250 234,35"));
    expect(formatKopecks(report.declaredEstimateTotal!)).toBe(rub("3 758 778,35"));
  });

  it("выносит написания единиц, требующие решения человека", () => {
    const decisions = report.findings.filter((f) => f.kind === "unit-needs-decision");
    const byRaw = Object.fromEntries(decisions.map((f) => [f.raw.trim(), f.rows.length]));
    expect(byRaw).toEqual({ "м2/мп": 14, "м2/пм": 4, "уп": 1 });
    expect(decisions.every((f) => f.suggestion !== "")).toBe(true);
  });

  it("сообщает о позициях с ценой без количества и без ставки", () => {
    const zero = report.findings.find((f) => f.kind === "zero-quantity");
    const wage = report.findings.find((f) => f.kind === "empty-wage");
    expect(zero?.rows).toHaveLength(5);
    expect(wage?.rows).toEqual([161, 162]);
  });

  it("фонд оплаты труда в файле занижен на 220 735,00 ₽", () => {
    // Та же причина, что и у недосчёта итога: выпавший раздел и пустая
    // ячейка, за вычетом подытога кондиционирования, учтённого дважды.
    expect(formatKopecks(report.computedWageTotal)).toBe(rub("2 224 343,30"));
    expect(formatKopecks(report.declaredWageTotal!)).toBe(rub("2 003 608,30"));
    expect(formatKopecks(report.wageTotalDelta!)).toBe(rub("220 735,00"));
  });

  it("строка без данных выносится в отчёт, шапка и подписи — нет", () => {
    const rows = report.findings.filter((f) => f.kind === "unrecognized-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ row: 43, text: "ВЫВОД ПОД СЛАБОТОЧКУ ( ОБСУДИТЬ)" });
  });

  it("расхождение найдено, но импорт не блокируется", () => {
    expect(report.hasDiscrepancy).toBe(true);
    expect(report.positions).toBe(132);
  });
});

describe("эталонный шаблон выгрузки", () => {
  it("шаблон разбирается тем же импортёром, что и файл заказчика", async () => {
    const buffer = await buildTemplate({
      projectCode: "R-99",
      address: "Московский проспект 116",
      supervisionShare: 1200,
    });
    const template = await parseWorkbook(buffer);
    expect(template.columns).toMatchObject({ name: 1, unit: 2, qty: 3, unitPrice: 4, unitWage: 5, total: 6 });
    expect(template.supervisionShare).toBe(1200);
  });
});
