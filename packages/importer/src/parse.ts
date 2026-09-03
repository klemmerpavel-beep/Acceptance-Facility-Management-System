/**
 * Разбор сметы заказчика из книги Excel.
 *
 * Признаки строк установлены по действующему файлу «Московский проспект 116»,
 * а не приняты на веру:
 *
 *   раздел верхнего уровня — жирный, объединённый по строке, без количества
 *                            и цены, буквы вне скобок целиком прописные;
 *   подраздел              — то же, но со строчными буквами;
 *   позиция                — есть количество, либо цена, либо сумма;
 *   строка итога           — начинается со слова «итого» в любой из первых
 *                            пяти колонок (в файле встречается и в колонке D);
 *   прочий расход          — позиция в разделе дополнительных расходов:
 *                            цена есть, количества нет.
 *
 * Колонки определяются по подписям шапки, а не по буквам: смета, свёрстанная
 * с переставленными колонками, не должна ломать импорт молча.
 */

import ExcelJS from "exceljs";
import { parseQuantity, parseRubles, type Kopecks, type Milliunits } from "@priyomka/domain";
import { resolveUnitWith, type UnitOverrides, type UnitResolution } from "./units.js";

export type ColumnRole = "name" | "unit" | "qty" | "unitPrice" | "unitWage" | "total" | "wageTotal" | "profit" | "profitShare";

/** Подписи шапки действующего файла и их синонимы. */
const HEADER_SYNONYMS: readonly (readonly [ColumnRole, readonly string[]])[] = [
  ["name", ["наименование работ", "наименование", "работы"]],
  ["unit", ["ед. изм.", "ед.изм.", "единица", "ед"]],
  ["qty", ["кол.", "кол-во", "количество"]],
  ["unitPrice", ["стоимость единицы", "цена единицы", "цена за единицу", "цена ед."]],
  ["unitWage", ["з/п единицы", "зп единицы", "ставка з/п", "ставка зп"]],
  ["total", ["общая стоимость", "сумма", "стоимость"]],
  ["wageTotal", ["з/п рабочих", "зп рабочих", "фот"]],
  ["profit", ["прибыль"]],
  ["profitShare", ["прибыль в %", "прибыль, %", "маржа"]],
];

export interface ParsedItem {
  readonly row: number;
  readonly sectionPath: readonly string[];
  readonly name: string;
  readonly rawUnit: string;
  readonly unit: UnitResolution;
  readonly qty: Milliunits | null;
  readonly unitPrice: Kopecks | null;
  readonly unitWage: Kopecks | null;
  /** Сумма, как она посчитана в файле. Своя сумма считается отдельно. */
  readonly declaredTotal: Kopecks | null;
}

export interface ParsedSection {
  readonly row: number;
  readonly level: 1 | 2;
  readonly name: string;
  readonly path: readonly string[];
  /** Итог раздела, как он стоит в файле. Пусто, если ячейка итога пуста. */
  readonly declaredTotal: Kopecks | null;
  readonly declaredWageTotal: Kopecks | null;
  readonly totalRow: number | null;
}

export interface ParsedEstimate {
  readonly sheetName: string;
  readonly headerRow: number;
  readonly columns: Readonly<Partial<Record<ColumnRole, number>>>;
  readonly sections: readonly ParsedSection[];
  readonly items: readonly ParsedItem[];
  /** Позиции блока дополнительных расходов: цена без объёма. */
  readonly otherExpenses: readonly ParsedItem[];
  /** «ИТОГО ПО РАБОТАМ» из файла. */
  readonly declaredWorksTotal: Kopecks | null;
  readonly declaredWageTotal: Kopecks | null;
  /** Итог сметы с надбавкой из файла. */
  readonly declaredEstimateTotal: Kopecks | null;
  /** Надбавка «сопровождение объекта» в сотых долях процента. */
  readonly supervisionShare: number | null;
  /** Строки, которые не удалось отнести ни к одному виду. */
  readonly unrecognizedRows: readonly { readonly row: number; readonly text: string }[];
}

/**
 * Примитив ячейки в строку. Всё, что не примитив, даёт пустую строку, а не
 * «[object Object]»: у ячейки с ошибкой формулы и у гиперссылки при слепом
 * String() получалась именно эта надпись, и она уезжала в название позиции.
 */
const primitive = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return "";
};

const text = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("result" in value) return primitive(value.result).trim();
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    // Гиперссылка несёт видимый текст отдельным полем.
    if ("text" in value) return primitive(value.text).trim();
    // Ячейка с ошибкой формулы: показывать «#REF!» в названии позиции нечего.
    return "";
  }
  return primitive(value).trim();
};

const numeric = (value: ExcelJS.CellValue): number | null => {
  if (typeof value === "number") return value;
  if (typeof value === "object" && value !== null && "result" in value) {
    return typeof value.result === "number" ? value.result : null;
  }
  return null;
};

const toKopecks = (value: ExcelJS.CellValue): Kopecks | null => {
  const raw = numeric(value);
  return raw === null ? null : parseRubles(raw.toFixed(2));
};

const toMilliunits = (value: ExcelJS.CellValue): Milliunits | null => {
  const raw = numeric(value);
  return raw === null ? null : parseQuantity(raw.toFixed(3));
};

/** Доля прописных букв вне скобок. Разделяет уровни разделов. */
export function uppercaseRatio(value: string): number {
  // Названия позиций сметы — кириллица и латиница; составных эмодзи там нет,
  // и разбор по кодовым точкам их не рассыплет.
  // eslint-disable-next-line @typescript-eslint/no-misused-spread
  const letters = [...value.replace(/\(.*?\)/g, "")].filter((c) => /\p{L}/u.test(c));
  if (letters.length === 0) return 0;
  return letters.filter((c) => c === c.toUpperCase()).length / letters.length;
}

const isMergedAcrossRow = (sheet: ExcelJS.Worksheet, row: number): boolean => {
  const cell = sheet.getCell(row, 1);
  // ExcelJS объявляет номер строки строкой, а возвращает число: сравнение
  // без приведения проходит проверку типов только по случайности.
  return cell.isMerged && Number(cell.master.row) === row;
};

/** Ищет строку шапки по подписям колонок и строит соответствие ролей. */
export function locateHeader(sheet: ExcelJS.Worksheet): {
  headerRow: number;
  /** Последняя строка шапки: подписи бывают объединены по двум строкам. */
  headerEndRow: number;
  columns: Partial<Record<ColumnRole, number>>;
} {
  for (let row = 1; row <= Math.min(sheet.rowCount, 20); row += 1) {
    const columns: Partial<Record<ColumnRole, number>> = {};
    for (let column = 1; column <= Math.min(sheet.columnCount, 20); column += 1) {
      const caption = text(sheet.getCell(row, column).value).toLowerCase().replace(/\s+/g, " ").trim();
      if (caption === "") continue;
      for (const [role, synonyms] of HEADER_SYNONYMS) {
        if (columns[role] === undefined && synonyms.includes(caption)) columns[role] = column;
      }
    }
    if (columns.name !== undefined && columns.qty !== undefined && columns.unitPrice !== undefined) {
      // Подпись «Наименование работ» объединена по строкам 3–4: без этого
      // вторая строка шапки попадала в отчёт как нераспознанная.
      let headerEndRow = row;
      for (const column of Object.values(columns)) {
        const cell = sheet.getCell(row, column);
        if (!cell.isMerged) continue;
        const range = sheet.model.merges?.find((m) => m.startsWith(`${cell.address}:`));
        const bottom = range === undefined ? null : Number(/\d+$/.exec(range)?.[0] ?? "");
        if (bottom !== null && Number.isFinite(bottom)) headerEndRow = Math.max(headerEndRow, bottom);
      }
      return { headerRow: row, headerEndRow, columns };
    }
  }
  throw new Error(
    "Шапка таблицы не найдена: нужны колонки «Наименование работ», «Кол.» и «Стоимость единицы». " +
      "Проверьте, что импортируется лист со сметой.",
  );
}

export function parseEstimate(
  sheet: ExcelJS.Worksheet,
  overrides: UnitOverrides = new Map(),
): ParsedEstimate {
  const { headerRow, headerEndRow, columns } = locateHeader(sheet);
  const at = (row: number, role: ColumnRole): ExcelJS.CellValue => {
    const column = columns[role];
    return column === undefined ? null : sheet.getCell(row, column).value;
  };

  const sections: ParsedSection[] = [];
  const items: ParsedItem[] = [];
  const otherExpenses: ParsedItem[] = [];
  const unrecognizedRows: { row: number; text: string }[] = [];

  let path: string[] = [];
  let declaredWorksTotal: Kopecks | null = null;
  let declaredWageTotal: Kopecks | null = null;
  let declaredEstimateTotal: Kopecks | null = null;
  let supervisionShare: number | null = null;
  let inOtherExpenses = false;

  for (let row = headerEndRow + 1; row <= sheet.rowCount; row += 1) {
    const name = text(at(row, "name"));
    const qty = toMilliunits(at(row, "qty"));
    const unitPrice = toKopecks(at(row, "unitPrice"));
    const declaredTotal = toKopecks(at(row, "total"));

    // Слово «итого» встречается и не в первой колонке: в разделе
    // кондиционирования подытог стоит в колонке D.
    const totalsLabel = [1, 2, 3, 4, 5]
      .map((column) => text(sheet.getCell(row, column).value))
      .find((value) => value.toLowerCase().startsWith("итого"));

    if (totalsLabel !== undefined) {
      const isWorksGrandTotal = totalsLabel.toLowerCase().includes("по работам");
      if (isWorksGrandTotal) {
        declaredWorksTotal = declaredTotal;
        declaredWageTotal = toKopecks(at(row, "wageTotal"));
      } else if (inOtherExpenses) {
        declaredEstimateTotal = declaredTotal;
        // Ниже итога сметы идут подписи сторон, а не данные.
        break;
      } else {
        const last = sections.at(-1);
        if (last) {
          sections[sections.length - 1] = {
            ...last,
            declaredTotal,
            declaredWageTotal: toKopecks(at(row, "wageTotal")),
            totalRow: row,
          };
        }
      }
      continue;
    }

    if (name === "" && qty === null && unitPrice === null && declaredTotal === null) continue;

    const isSectionHeader =
      name !== "" &&
      qty === null &&
      unitPrice === null &&
      declaredTotal === null &&
      sheet.getCell(row, 1).font?.bold === true &&
      isMergedAcrossRow(sheet, row);

    if (isSectionHeader) {
      const level: 1 | 2 = uppercaseRatio(name) === 1 ? 1 : 2;
      path = level === 1 ? [name] : [...path.slice(0, 1), name];
      inOtherExpenses = level === 1 && /дополнительн/i.test(name);
      sections.push({
        row, level, name, path: [...path],
        declaredTotal: null, declaredWageTotal: null, totalRow: null,
      });
      continue;
    }

    if (qty !== null || unitPrice !== null || declaredTotal !== null) {
      const rawUnit = text(at(row, "unit"));
      const item: ParsedItem = {
        row,
        sectionPath: [...path],
        name,
        rawUnit,
        unit: resolveUnitWith(rawUnit, overrides),
        qty,
        unitPrice,
        unitWage: toKopecks(at(row, "unitWage")),
        declaredTotal,
      };
      // Строка надбавки: единица «%», в колонке цены доля, а не рубли.
      if (rawUnit.trim() === "%" && unitPrice !== null) {
        const share = numeric(at(row, "unitPrice"));
        supervisionShare = share === null ? null : Math.round(share * 10_000);
        continue;
      }
      if (inOtherExpenses) otherExpenses.push(item);
      else items.push(item);
      continue;
    }

    unrecognizedRows.push({ row, text: name });
  }

  return {
    sheetName: sheet.name,
    headerRow,
    columns,
    sections,
    items,
    otherExpenses,
    declaredWorksTotal,
    declaredWageTotal,
    declaredEstimateTotal,
    supervisionShare,
    unrecognizedRows,
  };
}

/** Открывает книгу и разбирает первый лист, где находится шапка сметы. */
export async function parseWorkbook(
  buffer: ArrayBuffer | Buffer,
  overrides: UnitOverrides = new Map(),
): Promise<ParsedEstimate> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer as ArrayBuffer);
  const failures: string[] = [];
  for (const sheet of book.worksheets) {
    try {
      return parseEstimate(sheet, overrides);
    } catch (cause) {
      failures.push(`${sheet.name}: ${(cause as Error).message}`);
    }
  }
  throw new Error(`Смета не найдена ни на одном листе книги.\n${failures.join("\n")}`);
}
