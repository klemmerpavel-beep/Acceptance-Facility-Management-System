import type { EstimateSectionNode, EstimateView as EstimateViewDto } from "@priyomka/contracts";
import type { EstimateView, SectionNode } from "@priyomka/domain";

/**
 * Перевод собранной сметы в форму, пригодную для HTTP.
 *
 * Денежные величины и количества уходят строкой: JSON не имеет целых
 * произвольной длины (БП-08). Отсутствующее внутреннее поле не превращается
 * в `undefined`, а не включается вовсе — иначе ключ виден и в журнале, и
 * при структурном сравнении.
 */
const money = (value: bigint | null | undefined): string | undefined =>
  value === null || value === undefined ? undefined : value.toString();

const section = (node: SectionNode): EstimateSectionNode => ({
  id: node.id,
  name: node.name,
  level: node.level,
  sourceRow: node.sourceRow,
  items: node.items.map((item) => ({
    id: item.id,
    order: item.order,
    name: item.name,
    unit: item.unit,
    qty: item.qty.toString(),
    qtyAccepted: item.qtyAccepted.toString(),
    unitPrice: item.unitPrice.toString(),
    total: item.total.toString(),
    ...("unitWage" in item
      ? {
          unitWage: item.unitWage.toString(),
          wageTotal: item.wageTotal.toString(),
          profit: item.profit.toString(),
          profitShare: Number(item.profitShare),
        }
      : {}),
  })),
  children: node.children.map(section),
  subtotal: node.subtotal.toString(),
  ...(node.subtotalWage === undefined ? {} : { subtotalWage: node.subtotalWage.toString() }),
});

export function toEstimateViewDto(
  view: EstimateView,
  meta: { version: number; importedAt: Date | null; declaredWorksTotal: bigint | null },
): EstimateViewDto {
  const delta =
    meta.declaredWorksTotal === null ? null : (view.totals.works - meta.declaredWorksTotal).toString();

  /* Внутренние итоги приходят только роли OWNER: у прораба их нет в
     доменном виде, и в ответе их не должно быть вовсе, а не как null. */
  const wage = money(view.totals.wage);
  const profit = money(view.totals.profit);

  return {
    version: meta.version,
    importedAt: meta.importedAt === null ? null : meta.importedAt.toISOString(),
    positions: view.positions,
    sectionsTopLevel: view.sectionsTopLevel,
    sectionsNested: view.sectionsNested,
    sections: view.sections.map(section),
    otherExpenses: view.otherExpenses.map((expense) => ({
      id: expense.id,
      name: expense.name,
      unit: expense.unit,
      unitPrice: expense.unitPrice.toString(),
      order: expense.order,
    })),
    totals: {
      works: view.totals.works.toString(),
      supervisionShare: Number(view.totals.supervisionShare),
      supervision: view.totals.supervision.toString(),
      estimate: view.totals.estimate.toString(),
      ...(wage === undefined ? {} : { wage }),
      ...(profit === undefined ? {} : { profit }),
    },
    declaredWorksTotal: money(meta.declaredWorksTotal) ?? null,
    worksTotalDelta: delta,
  };
}
