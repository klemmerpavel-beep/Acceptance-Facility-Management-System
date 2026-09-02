/**
 * Сборка сметы для показа.
 *
 * Разделы приходят из базы плоским списком со ссылкой на родителя; здесь
 * они собираются в дерево, к каждому разделу считается подытог, а к смете
 * целиком — итог по работам, надбавка «сопровождение объекта» и итог сметы
 * (БП-07).
 *
 * Проекция по роли выполняется здесь же: раздел, отданный прорабу, не
 * содержит внутренних величин ни в позициях, ни в подытогах. Разграничение
 * на уровне полей должно действовать на всей глубине ответа, а не только
 * в корне (`docs/02_DEV_PROMPT.md`, раздел 4).
 */

import { applyPercent, multiplyByQuantity, subtract, sum, type BasisPoints, type Kopecks } from "./money.js";
import {
  projectEstimateItem,
  type EstimateItemRecord,
  type InternalEstimateItem,
  type PublicEstimateItem,
  type Role,
} from "./projection.js";

export interface SectionRecord {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly order: number;
  readonly sourceRow: number | null;
}

export interface OtherExpenseRecord {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly unitPrice: Kopecks;
  readonly order: number;
}

export interface SectionNode {
  readonly id: string;
  readonly name: string;
  /** 1 — раздел верхнего уровня, 2 — вложенный. */
  readonly level: number;
  readonly sourceRow: number | null;
  readonly items: readonly (PublicEstimateItem | InternalEstimateItem)[];
  readonly children: readonly SectionNode[];
  /** Сумма собственных позиций и всех вложенных разделов. */
  readonly subtotal: Kopecks;
  /** Фонд оплаты труда раздела. Только для роли OWNER. */
  readonly subtotalWage?: Kopecks;
}

export interface EstimateTotals {
  readonly works: Kopecks;
  readonly supervisionShare: BasisPoints;
  readonly supervision: Kopecks;
  readonly estimate: Kopecks;
  /** Фонд оплаты и валовая прибыль — внутренние величины. */
  readonly wage?: Kopecks;
  readonly profit?: Kopecks;
}

export interface EstimateView {
  readonly positions: number;
  readonly sectionsTopLevel: number;
  readonly sectionsNested: number;
  readonly sections: readonly SectionNode[];
  readonly otherExpenses: readonly OtherExpenseRecord[];
  readonly totals: EstimateTotals;
}

export interface BuildEstimateInput {
  readonly sections: readonly SectionRecord[];
  readonly items: readonly EstimateItemRecord[];
  readonly otherExpenses: readonly OtherExpenseRecord[];
  readonly supervisionShare: BasisPoints;
  readonly role: Role;
}

export function buildEstimateView(input: BuildEstimateInput): EstimateView {
  const { sections, items, otherExpenses, supervisionShare, role } = input;
  const internal = role === "OWNER";

  const bySection = new Map<string, EstimateItemRecord[]>();
  for (const item of items) {
    const list = bySection.get(item.sectionId) ?? [];
    list.push(item);
    bySection.set(item.sectionId, list);
  }

  const children = new Map<string | null, SectionRecord[]>();
  for (const section of sections) {
    const list = children.get(section.parentId) ?? [];
    list.push(section);
    children.set(section.parentId, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.order - b.order);

  const build = (section: SectionRecord, level: number): SectionNode => {
    const own = (bySection.get(section.id) ?? []).sort((a, b) => a.order - b.order);
    const nested = (children.get(section.id) ?? []).map((child) => build(child, level + 1));

    const projected = own.map((item) =>
      internal ? projectEstimateItem(item, "OWNER") : projectEstimateItem(item, role),
    );
    const subtotal = sum([
      ...own.map((item) => multiplyByQuantity(item.unitPrice, item.qty)),
      ...nested.map((child) => child.subtotal),
    ]);

    const node: SectionNode = {
      id: section.id,
      name: section.name,
      level,
      sourceRow: section.sourceRow,
      items: projected,
      children: nested,
      subtotal,
    };
    if (!internal) return node;

    return {
      ...node,
      subtotalWage: sum([
        ...own.map((item) => multiplyByQuantity(item.unitWage, item.qty)),
        ...nested.map((child) => child.subtotalWage ?? (0n as Kopecks)),
      ]),
    };
  };

  const tree = (children.get(null) ?? []).map((section) => build(section, 1));

  const works = sum(items.map((item) => multiplyByQuantity(item.unitPrice, item.qty)));
  const supervision = applyPercent(works, supervisionShare);
  const totals: EstimateTotals = {
    works,
    supervisionShare,
    supervision,
    estimate: (works + supervision) as Kopecks,
  };

  const countNested = (nodes: readonly SectionNode[]): number =>
    nodes.reduce((total, node) => total + node.children.length + countNested(node.children), 0);

  const view: EstimateView = {
    positions: items.length,
    sectionsTopLevel: tree.length,
    sectionsNested: countNested(tree),
    sections: tree,
    otherExpenses: [...otherExpenses].sort((a, b) => a.order - b.order),
    totals,
  };
  if (!internal) return view;

  const wage = sum(items.map((item) => multiplyByQuantity(item.unitWage, item.qty)));
  return { ...view, totals: { ...totals, wage, profit: subtract(works, wage) } };
}
