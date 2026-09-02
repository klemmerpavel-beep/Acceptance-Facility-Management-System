import type { ImportReport } from "@priyomka/contracts";
import type { DiscrepancyReport, Finding } from "@priyomka/importer";

/**
 * Перевод отчёта домена в форму, пригодную для HTTP.
 *
 * Денежные величины уходят строкой: JSON не имеет целых произвольной длины,
 * а округление до double на 141 позиции — ровно та ошибка, ради которой
 * деньги хранятся в копейках (БП-08).
 */
const money = (value: bigint | null): string | null => (value === null ? null : value.toString());

/** Человекочитаемое название находки. Ошибка объясняет, что произошло. */
function describe(finding: Finding): { title: string; amount: bigint | null; rows: number[] } {
  switch (finding.kind) {
    case "section-total-mismatch":
      return {
        title: `Итог раздела «${finding.section}» не сходится с суммой его позиций`,
        amount: finding.delta,
        rows: [finding.row],
      };
    case "section-total-empty":
      return {
        title: `У раздела «${finding.section}» ячейка итога пуста: формулы в ней нет`,
        amount: finding.computed,
        rows: [finding.row],
      };
    case "item-total-mismatch":
      return {
        title: `Сумма позиции «${finding.name}» не равна количеству, умноженному на цену`,
        amount: finding.delta,
        rows: [finding.row],
      };
    case "unit-needs-decision":
      return {
        title: `Написание «${finding.raw}» не определяет физическую величину. Предложено: ${finding.suggestion}`,
        amount: null,
        rows: [...finding.rows],
      };
    case "unit-unknown":
      return {
        title: `Написание единицы «${finding.raw}» не опознано`,
        amount: null,
        rows: [...finding.rows],
      };
    case "duplicate-name":
      return {
        title: `В разделе «${finding.section}» наименование «${finding.name}» встречается дважды`,
        amount: null,
        rows: [...finding.rows],
      };
    case "empty-wage":
      return { title: "Цена есть, ставка оплаты труда не задана", amount: null, rows: [...finding.rows] };
    case "zero-quantity":
      return { title: "Цена есть, количество не задано: позиция даёт нулевую стоимость", amount: null, rows: [...finding.rows] };
    case "unrecognized-row":
      return { title: `Строка не отнесена ни к одному виду: «${finding.text.trim()}»`, amount: null, rows: [finding.row] };
  }
}

export function toImportReport(report: DiscrepancyReport): ImportReport {
  return {
    positions: report.positions,
    sectionsTopLevel: report.sectionsTopLevel,
    sectionsNested: report.sectionsNested,
    otherExpenses: report.otherExpenses,
    computedWorksTotal: report.computedWorksTotal.toString(),
    declaredWorksTotal: money(report.declaredWorksTotal),
    worksTotalDelta: money(report.worksTotalDelta),
    computedWageTotal: report.computedWageTotal.toString(),
    declaredWageTotal: money(report.declaredWageTotal),
    wageTotalDelta: money(report.wageTotalDelta),
    supervisionShare: report.supervisionShare,
    supervisionAmount: money(report.supervisionAmount),
    computedEstimateTotal: report.computedEstimateTotal.toString(),
    declaredEstimateTotal: money(report.declaredEstimateTotal),
    hasDiscrepancy: report.hasDiscrepancy,
    unitDecisions: report.findings
      .filter((f) => f.kind === "unit-needs-decision" || f.kind === "unit-unknown")
      .map((f) => ({
        raw: f.raw,
        suggestion: f.kind === "unit-needs-decision" ? f.suggestion : "",
        rows: [...f.rows],
        positions: f.rows.length,
      })),
    findings: report.findings.map((finding) => {
      const described = describe(finding);
      return {
        kind: finding.kind,
        title: described.title,
        amount: money(described.amount),
        rows: described.rows,
      };
    }),
  };
}
