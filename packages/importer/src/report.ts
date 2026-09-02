/**
 * Отчёт о расхождениях (БП-09).
 *
 * Импорт с расхождением допускается, но расхождение показывается явно:
 * именно оно является главным доказательством ценности системы. Поэтому
 * отчёт не выносит суждения «файл плохой», а перечисляет находки с
 * величинами, которые можно проверить руками.
 */

import {
  applyPercent, basisPoints, kopecks, multiplyByQuantity, subtract, sum,
  type Kopecks,
} from "@priyomka/domain";
import type { ParsedEstimate, ParsedItem, ParsedSection } from "./parse.js";

export type Finding =
  /** Итог раздела в файле не сходится с суммой его позиций. */
  | { kind: "section-total-mismatch"; section: string; row: number; declared: Kopecks; computed: Kopecks; delta: Kopecks }
  /** Ячейка итога раздела пуста: формулы в ней нет вовсе. */
  | { kind: "section-total-empty"; section: string; row: number; computed: Kopecks }
  /** Сумма позиции в файле не равна произведению количества на цену. */
  | { kind: "item-total-mismatch"; row: number; name: string; declared: Kopecks; computed: Kopecks; delta: Kopecks }
  /** Написание единицы не определяет физическую величину. */
  | { kind: "unit-needs-decision"; raw: string; suggestion: string; rows: readonly number[] }
  /** Написание единицы не опознано вовсе. */
  | { kind: "unit-unknown"; raw: string; rows: readonly number[] }
  /** Одинаковое наименование дважды в пределах раздела. */
  | { kind: "duplicate-name"; section: string; name: string; rows: readonly number[] }
  /** Цена есть, ставка оплаты труда пуста. */
  | { kind: "empty-wage"; rows: readonly number[] }
  /** Цена есть, количество не задано: позиция даёт нулевую стоимость. */
  | { kind: "zero-quantity"; rows: readonly number[] }
  /** Строка не отнесена ни к одному виду. */
  | { kind: "unrecognized-row"; row: number; text: string };

export interface DiscrepancyReport {
  readonly positions: number;
  readonly sectionsTotal: number;
  readonly sectionsTopLevel: number;
  readonly sectionsNested: number;
  readonly otherExpenses: number;

  readonly computedWorksTotal: Kopecks;
  readonly declaredWorksTotal: Kopecks | null;
  /** Пересчёт минус заявленное. Положительное значение — недосчёт в файле. */
  readonly worksTotalDelta: Kopecks | null;

  readonly computedWageTotal: Kopecks;
  readonly declaredWageTotal: Kopecks | null;
  readonly wageTotalDelta: Kopecks | null;

  readonly supervisionShare: number | null;
  readonly supervisionAmount: Kopecks | null;
  readonly computedEstimateTotal: Kopecks;
  readonly declaredEstimateTotal: Kopecks | null;

  readonly findings: readonly Finding[];
  /** Расхождение найдено. Импорт при этом не блокируется. */
  readonly hasDiscrepancy: boolean;
}

const itemTotal = (item: ParsedItem): Kopecks =>
  item.qty !== null && item.unitPrice !== null
    ? multiplyByQuantity(item.unitPrice, item.qty)
    : kopecks(0n);

const itemWage = (item: ParsedItem): Kopecks =>
  item.qty !== null && item.unitWage !== null
    ? multiplyByQuantity(item.unitWage, item.qty)
    : kopecks(0n);

const sectionKey = (section: ParsedSection): string => section.path.join(" · ");

export function buildDiscrepancyReport(parsed: ParsedEstimate): DiscrepancyReport {
  const findings: Finding[] = [];

  // --- итоги разделов -----------------------------------------------------
  // Раздел верхнего уровня, у которого есть вложенные подразделы, своего
  // итога не имеет: он суммируется по подразделам, и сравнивать нечего.
  for (const section of parsed.sections) {
    const own = parsed.items.filter((item) => item.sectionPath.join("·") === section.path.join("·"));
    if (own.length === 0) continue;
    const computed = sum(own.map(itemTotal));
    if (section.totalRow === null) continue;
    if (section.declaredTotal === null) {
      findings.push({ kind: "section-total-empty", section: sectionKey(section), row: section.totalRow, computed });
      continue;
    }
    const delta = subtract(computed, section.declaredTotal);
    if (delta !== 0n) {
      findings.push({
        kind: "section-total-mismatch",
        section: sectionKey(section),
        row: section.totalRow,
        declared: section.declaredTotal,
        computed,
        delta,
      });
    }
  }

  // --- суммы позиций ------------------------------------------------------
  for (const item of parsed.items) {
    if (item.declaredTotal === null || item.qty === null || item.unitPrice === null) continue;
    const computed = itemTotal(item);
    const delta = subtract(computed, item.declaredTotal);
    if (delta !== 0n) {
      findings.push({ kind: "item-total-mismatch", row: item.row, name: item.name, declared: item.declaredTotal, computed, delta });
    }
  }

  // --- единицы измерения ---------------------------------------------------
  const needsDecision = new Map<string, { suggestion: string; rows: number[] }>();
  const unknown = new Map<string, number[]>();
  for (const item of [...parsed.items, ...parsed.otherExpenses]) {
    if (item.unit.kind === "needs-decision") {
      const entry = needsDecision.get(item.unit.raw) ?? { suggestion: item.unit.suggestion, rows: [] };
      entry.rows.push(item.row);
      needsDecision.set(item.unit.raw, entry);
    } else if (item.unit.kind === "unknown") {
      unknown.set(item.unit.raw, [...(unknown.get(item.unit.raw) ?? []), item.row]);
    }
  }
  for (const [raw, entry] of needsDecision) {
    findings.push({ kind: "unit-needs-decision", raw, suggestion: entry.suggestion, rows: entry.rows });
  }
  for (const [raw, rows] of unknown) findings.push({ kind: "unit-unknown", raw, rows });

  // --- дубли наименований внутри раздела -----------------------------------
  const bySection = new Map<string, Map<string, number[]>>();
  for (const item of parsed.items) {
    const key = item.sectionPath.join(" · ");
    const names = bySection.get(key) ?? new Map<string, number[]>();
    const normalized = item.name.trim().toLowerCase().replace(/\s+/g, " ");
    names.set(normalized, [...(names.get(normalized) ?? []), item.row]);
    bySection.set(key, names);
  }
  for (const [section, names] of bySection) {
    for (const [name, rows] of names) {
      if (rows.length > 1) findings.push({ kind: "duplicate-name", section, name, rows });
    }
  }

  // --- пустые ставки и нулевые количества -----------------------------------
  const emptyWage = parsed.items.filter((i) => i.unitPrice !== null && i.unitWage === null).map((i) => i.row);
  if (emptyWage.length > 0) findings.push({ kind: "empty-wage", rows: emptyWage });

  const zeroQty = parsed.items.filter((i) => i.unitPrice !== null && i.qty === null).map((i) => i.row);
  if (zeroQty.length > 0) findings.push({ kind: "zero-quantity", rows: zeroQty });

  for (const row of parsed.unrecognizedRows) {
    findings.push({ kind: "unrecognized-row", row: row.row, text: row.text });
  }

  // --- итоги ----------------------------------------------------------------
  const computedWorksTotal = sum(parsed.items.map(itemTotal));
  const computedWageTotal = sum(parsed.items.map(itemWage));
  const supervisionAmount =
    parsed.supervisionShare === null
      ? null
      : applyPercent(computedWorksTotal, basisPoints(BigInt(parsed.supervisionShare)));

  return {
    positions: parsed.items.length,
    sectionsTotal: parsed.sections.length,
    sectionsTopLevel: parsed.sections.filter((s) => s.level === 1).length,
    sectionsNested: parsed.sections.filter((s) => s.level === 2).length,
    otherExpenses: parsed.otherExpenses.length,

    computedWorksTotal,
    declaredWorksTotal: parsed.declaredWorksTotal,
    worksTotalDelta:
      parsed.declaredWorksTotal === null ? null : subtract(computedWorksTotal, parsed.declaredWorksTotal),

    computedWageTotal,
    declaredWageTotal: parsed.declaredWageTotal,
    wageTotalDelta:
      parsed.declaredWageTotal === null ? null : subtract(computedWageTotal, parsed.declaredWageTotal),

    supervisionShare: parsed.supervisionShare,
    supervisionAmount,
    computedEstimateTotal: (computedWorksTotal + (supervisionAmount ?? 0n)) as Kopecks,
    declaredEstimateTotal: parsed.declaredEstimateTotal,

    findings,
    hasDiscrepancy: findings.length > 0,
  };
}
