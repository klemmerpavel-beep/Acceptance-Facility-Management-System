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

import {
  applyPercent, multiplyByQuantity, subtract, sum,
  type BasisPoints, type Kopecks, type Milliunits,
} from "./money.js";
import { minimumQty, количествоТекстом } from "./acceptance.js";
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

/* --- правка позиции (пункты плана 2.5 и 3.9) -----------------------------

   Правила живут здесь, а не у маршрута: сервер зовёт их, чтобы отказать до
   записи, экран — чтобы отказать до обращения к сети. Тот же приём, что у
   `acceptanceFault` и `stageDateFault`.

   Правка цены и ставки идёт на месте и новой редакции не порождает. Прежняя
   формулировка Р11 («цены порождают новую версию») несовместима с
   устройством приёмки: приёмка ссылается на позицию конкретной редакции,
   связи между редакциями позиции нет, и правка одной цены унесла бы всё
   принятое из вида приёмки, оставив его в выработке транша. Начисленное при
   этом защищено снимком ставки (БП-03), а прежнее значение цены уходит в
   журнал объекта (БП-10). */

/** Что правят: новое количество и цены, плюс уже принятое по позиции. */
export interface EstimateItemEdit {
  readonly qty: Milliunits;
  /** Принято по позиции с учётом сторно. */
  readonly accepted: Milliunits;
  readonly unit: string;
  readonly unitPrice: Kopecks;
  readonly unitWage: Kopecks;
}

/**
 * Причина отказа при правке позиции или null.
 *
 * Порядок проверок — от грубого к тонкому: сперва количество вообще, затем
 * его отношение к принятому, затем деньги. Человек получает первое по
 * существу замечание, а не последнее по коду.
 */
export function estimateItemFault(edit: EstimateItemEdit): string | null {
  if (edit.qty <= 0n) {
    return "Количество должно быть больше нуля. Ненужная позиция удаляется, а не обнуляется.";
  }

  /* Р17: уменьшить позицию ниже принятого значит объявить непринятым то, что
     уже принято и начислено. Правило написано в `acceptance.ts` вместе с
     приёмкой; здесь его точка применения. */
  const наименьшее = minimumQty(edit.accepted);
  if (edit.qty < наименьшее) {
    /* Запрошенное количество в тексте не называется. Величины показаны с
       двумя знаками, а разница бывает в тысячных: 11,999 и 12,000 печатаются
       одинаково, и отказ читался бы как «нельзя уменьшить до 12,00 м², потому
       что принято 12,00 м²». Названо принятое — то, ниже чего нельзя. */
    return `По этой позиции уже принято ${количествоТекстом(наименьшее, edit.unit)}. `
      + "Уменьшить количество ниже принятого нельзя: сторнируйте приёмку "
      + "или оставьте количество не ниже принятого.";
  }

  if (edit.unitPrice < 0n) return "Цена единицы не может быть отрицательной.";
  if (edit.unitWage < 0n) return "Ставка оплаты труда не может быть отрицательной.";

  return null;
}

/**
 * Мягкое предупреждение: ставка выше цены, то есть работа в убыток.
 *
 * Предупреждение, а не отказ — по доводу `stageDateWarning`: убыточная
 * позиция бывает (она закрывает обязательство по договору), и запрет здесь
 * мешал бы записать состоявшееся решение. Показать его обязательно: разброс
 * маржи по смете заказчика от 20 % до 100 %, и отрицательная выпадает из
 * ряда настолько, что почти всегда означает опечатку.
 */
export function estimateItemWarning(edit: EstimateItemEdit): string | null {
  if (edit.unitWage <= edit.unitPrice) return null;
  return "Ставка выше цены единицы: позиция уйдёт в убыток. Проверьте, не опечатка ли это.";
}

/* --- перенос величин обмера в количество позиции --------------------------

   Числового преобразования не требуется: обмер и смета хранят целые тысячные
   доли (`schema.prisma`, `MeasureRoom.floorArea` — «Тысячные доли единицы,
   как количества сметы»). Требуется одно — соответствие «единица позиции ↔
   величина обмера», и оно объявлено здесь, чтобы экран не завёл своё. */

/** Величина обмера, годная в количество позиции. */
export type MeasureSource = "floorArea" | "wallArea" | "floorPerimeter" | "ceilingPerimeter";

/**
 * Какие величины обмера подставляются позиции с этой единицей.
 *
 * Карта литеральная, а не выведенная из имён: «м.п.» подходит и плинтусу, и
 * карнизу, а какая из двух длин нужна — решает человек, и подставить одну за
 * него значило бы соврать. Единица, которой в карте нет, строки переноса не
 * получает: подставлять нечего, и пустой список хуже отсутствия.
 */
export const MEASURE_SOURCES: Readonly<Record<string, readonly MeasureSource[]>> = {
  "м²": ["floorArea", "wallArea"],
  "м.п.": ["floorPerimeter", "ceilingPerimeter"],
};

/** Подпись величины обмера на кнопке подстановки. */
export const MEASURE_LABEL: Readonly<Record<MeasureSource, string>> = {
  floorArea: "площадь пола",
  wallArea: "площадь стен",
  floorPerimeter: "периметр пола",
  ceilingPerimeter: "периметр потолка",
};

/** Величины обмера, годные позиции с данной единицей. Пусто — переносить нечего. */
export function measureSourcesFor(unit: string): readonly MeasureSource[] {
  return MEASURE_SOURCES[unit] ?? [];
}
