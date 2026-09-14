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
  applyPercent, kopecks, multiplyByQuantity, subtract, sum,
  type BasisPoints, type Kopecks, type Milliunits,
} from "./money.js";
import type { SectionWeight } from "./plan.js";
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
  /**
   * Имя этапа графика, который ведёт работы раздела. Пусто — раздел вне
   * графика; на стенде таких четыре, и это не изъян данных, а состояние:
   * этап назначают позже, а до того принимать по разделу нечем.
   *
   * Раздел ведёт не более одного этапа — `@@unique([sectionId])` в схеме.
   */
  readonly stage?: string | null;
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
  /** Имя этапа графика у раздела верхнего уровня. */
  readonly stage: string | null;
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

  /**
   * Сквозной номер строки документа.
   *
   * В хранении `order` — место позиции ВНУТРИ своего раздела: перенос
   * трогает два раздела, а не всю смету. Номер же, который человек читает
   * в колонке «№», сквозной по документу и потому считается здесь, обходом
   * дерева в порядке показа. Храни его — и каждая перестановка
   * перенумеровывала бы все сто тридцать две строки.
   */
  let номер = 0;

  const build = (section: SectionRecord, level: number): SectionNode => {
    const own = (bySection.get(section.id) ?? []).sort((a, b) => a.order - b.order);

    /* Позиции раздела нумеруются до вложенных разделов: так они и
       показываются, и номер обязан совпадать с порядком чтения. */
    const projected = own.map((item) => ({
      ...(internal ? projectEstimateItem(item, "OWNER") : projectEstimateItem(item, role)),
      order: (номер += 1),
    }));
    const nested = (children.get(section.id) ?? []).map((child) => build(child, level + 1));
    const subtotal = sum([
      ...own.map((item) => multiplyByQuantity(item.unitPrice, item.qty)),
      ...nested.map((child) => child.subtotal),
    ]);

    const node: SectionNode = {
      id: section.id,
      name: section.name,
      level,
      sourceRow: section.sourceRow,
      stage: section.stage ?? null,
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

/** Что переносят: позицию, её принятое и то, меняется ли раздел. */
export interface EstimateItemMove {
  /** Принято по позиции с учётом сторно. */
  readonly accepted: Milliunits;
  readonly name: string;
  readonly unit: string;
  /** Меняется ли раздел позиции. Перестановка внутри своего — не смена. */
  readonly changesSection: boolean;
  /** Имя раздела, в котором позиция стоит сейчас. */
  readonly section: string;
}

/**
 * Причина отказа при переносе позиции или null.
 *
 * Принятая позиция не меняет раздела. Довод структурный, а не вкусовой:
 * пакет приёмки хранит раздел снимком, а получатель начисления выведен из
 * пары «раздел → этап → бригада». Перенос развёл бы пакет и позицию по
 * разным разделам, и отчёт по разделу перестал бы сходиться, а фотография
 * помещения осталась бы свидетельством о работах, которых в этом разделе
 * больше нет.
 *
 * Перестановка внутри своего раздела принятой позиции разрешена: порядок в
 * приёмке не участвует вовсе.
 *
 * Сторно возвращает принятое к нулю, и позиция снова становится переносимой.
 * Пакет при этом сохраняет свой раздел — он свидетельство о том, что было.
 */
export function estimateItemMoveFault(move: EstimateItemMove): string | null {
  if (!move.changesSection) return null;
  if (move.accepted <= 0n) return null;
  return `По позиции «${move.name}» принято ${количествоТекстом(move.accepted, move.unit)}. `
    + "Перенос сменил бы раздел, по которому начислена оплата и выписан акт. "
    + `Сторнируйте приёмку или оставьте позицию в разделе «${move.section}».`;
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

/* --- разделы для выбора (пункт плана 5.2, решение Р19) ---------------------

   Этап графика ведёт работы раздела сметы: через пару «раздел → этап →
   бригада» приёмка узнаёт, кому начислять. Выбор раздела нужен и листу
   этапа, и — вторым срезом — сборке этапов по разделам, поэтому список
   строится в домене, а не в разметке экрана. */

/** Узел дерева разделов в том минимуме, который нужен списку выбора. */
export interface SectionTreeNode {
  readonly id: string;
  readonly name: string;
  /**
   * Итог раздела вместе с вложенными, копейки. Нужен раскладке графика по
   * стоимости работ; выбору раздела в листе этапа не нужен вовсе, поэтому
   * поле необязательно.
   */
  readonly subtotal?: string;
  /** Позиции раздела и вложенных: по ним раскладка отличает работу от заголовка. */
  readonly items?: readonly unknown[];
  readonly children?: readonly SectionTreeNode[];
}

/** Строка выбора раздела: имя и опознаватель. */
export interface SectionChoice {
  readonly id: string;
  readonly name: string;
}

/**
 * Разделы, которые может вести этап графика, — только верхнего уровня, с
 * именем и стоимостью работ.
 *
 * Ограничение не вкусовое: приёмка работает разделами верхнего уровня,
 * складывая позиции вложенных в родительский («прораб на объекте различает
 * электрику, а не электрику / штробление»), и этап ищет по опознавателю
 * верхнего раздела. Этап, привязанный к вложенному разделу, приёмке не
 * виден вовсе: связь есть в базе, а начислять по ней некому — молчаливое
 * расхождение того же рода, что закрыто стадией D. Проверка страницы это и
 * показала, выбрав «Мастер ванная».
 *
 * Отсюда же следует Р19: предзаполнение идёт по разделам первого уровня,
 * потому что других в этом списке и нет. И по ним же идёт раскладка сроков
 * (стадия C.3): разложить график по одному дереву, а принимать работы по
 * другому значило бы завести расхождение своими руками.
 *
 * Стоимость берётся готовой из `subtotal`: она уже свёрнута по вложенным
 * разделам на сервере. Пересчёт здесь завёл бы второе место, где
 * складывается смета.
 */
export function sectionWeights(
  sections: readonly SectionTreeNode[],
): readonly SectionWeight[] {
  const позиций = (section: SectionTreeNode): number =>
    (section.items?.length ?? 0)
    + (section.children ?? []).reduce((всего, child) => всего + позиций(child), 0);

  return sections.map((section) => ({
    id: section.id,
    name: section.name,
    total: kopecks(section.subtotal ?? "0"),
    positions: позиций(section),
  }));
}

/* --- группировка «Этап → Помещение → Категория» (второй срез) --------------

   Второе дерево в хранилище завело бы второй ответ на вопрос «где позиция»:
   приёмка идёт разделами, этап графика ведёт раздел, готовность считается по
   разделу. Поэтому группировка — способ показать те же позиции, а не вторая
   правда о них.

   Все три уровня уже есть в данных: этап — у раздела верхнего уровня
   (`@@unique([sectionId])` делает связь однозначной), помещение — у позиции,
   категория — это сам раздел, в котором позиция лежит.
   -------------------------------------------------------------------------- */

/** Узел группировки. Один вид для всех трёх уровней: различает `kind`. */
export interface GroupNode<T> {
  /** Опознаватель для состояния свёрнутости. Уникален в пределах дерева. */
  readonly key: string;
  readonly kind: "stage" | "room" | "category";
  readonly label: string;
  readonly items: readonly T[];
  readonly children: readonly GroupNode<T>[];
  readonly subtotal: bigint;
  readonly subtotalWage?: bigint;
  /** Позиций в узле вместе со вложенными. */
  readonly positions: number;
}

/** Подписи разрезов, называющие пробел словом, а не прячущие его. */
export const ВНЕ_ГРАФИКА = "Вне графика";
export const БЕЗ_ПОМЕЩЕНИЯ = "Помещение не выбрано";

/** Минимум, который группировка требует от позиции. */
export interface GroupItem {
  readonly room: { readonly name: string } | null;
}

/** Минимум, который группировка требует от раздела. */
export interface GroupSection<T> {
  readonly name: string;
  readonly level: number;
  readonly stage: string | null;
  readonly items: readonly T[];
  readonly children: readonly GroupSection<T>[];
}

/**
 * Те же позиции, собранные деревом «Этап → Помещение → Категория».
 *
 * Общая по виду позиции намеренно. Домен держит деньги целыми копейками,
 * а через HTTP они идут строкой; заведи экран свою группировку — правило
 * разошлось бы надвое на первой же правке. Здесь правило одно, а
 * преобразование величин отдано вызывающему одной функцией.
 *
 * Порядок уровней — порядок первого появления: этапы идут в порядке
 * разделов верхнего уровня, помещения — в порядке встречи позиций,
 * категории — в порядке разделов. Своего поля порядка группировка не
 * заводит: второе поле порядка разошлось бы с первым на первой перестановке.
 *
 * Разрезы «Вне графика» и «Помещение не выбрано» — обычные узлы со своими
 * числами. Отбросить их значило бы потерять позиции молча: итог группировки
 * перестал бы сходиться с итогом работ, и заметить это было бы нечем.
 */
export function groupByStageRoom<T extends GroupItem>(
  sections: readonly GroupSection<T>[],
  деньги: (item: T) => { readonly total: bigint; readonly wage: bigint | undefined },
): readonly GroupNode<T>[] {
  interface Строка {
    readonly stage: string;
    readonly room: string;
    readonly category: string;
    readonly item: T;
  }
  const строки: Строка[] = [];
  const обойти = (узлы: readonly GroupSection<T>[], stage: string): void => {
    for (const узел of узлы) {
      /* Этап объявлен только у раздела верхнего уровня: вложенный наследует
         его от корня своей ветви — приёмка сворачивает разделы туда же. */
      const этап = узел.level === 1 ? (узел.stage ?? ВНЕ_ГРАФИКА) : stage;
      for (const item of узел.items) {
        строки.push({
          stage: этап,
          room: item.room?.name ?? БЕЗ_ПОМЕЩЕНИЯ,
          category: узел.name,
          item,
        });
      }
      обойти(узел.children, этап);
    }
  };
  обойти(sections, ВНЕ_ГРАФИКА);

  /* Фонд оплаты показывается, только если он есть у позиций: у прораба и
     заказчика его нет вовсе, и нулевой подытог соврал бы числом. */
  const внутренние = строки.length > 0
    && строки.every((строка) => деньги(строка.item).wage !== undefined);

  /** Сборка уровня: порядок ключей — порядок первого появления. */
  const разложить = (
    список: readonly Строка[],
    ключ: (строка: Строка) => string,
  ): [string, Строка[]][] => {
    const карта = new Map<string, Строка[]>();
    for (const строка of список) {
      const имя = ключ(строка);
      const набор = карта.get(имя) ?? [];
      набор.push(строка);
      карта.set(имя, набор);
    }
    return [...карта.entries()];
  };

  const итог = (список: readonly Строка[]): bigint =>
    список.reduce((всего, строка) => всего + деньги(строка.item).total, 0n);
  const фот = (список: readonly Строка[]): bigint =>
    список.reduce((всего, строка) => всего + (деньги(строка.item).wage ?? 0n), 0n);

  const узел = (
    kind: GroupNode<T>["kind"],
    key: string,
    label: string,
    список: readonly Строка[],
    children: readonly GroupNode<T>[],
    items: readonly T[],
  ): GroupNode<T> => {
    const основа: GroupNode<T> = {
      key, kind, label, items, children,
      subtotal: итог(список),
      positions: список.length,
    };
    return внутренние ? { ...основа, subtotalWage: фот(список) } : основа;
  };

  return разложить(строки, (строка) => строка.stage).map(([этап, поЭтапу]) =>
    узел("stage", `этап·${этап}`, этап, поЭтапу,
      разложить(поЭтапу, (строка) => строка.room).map(([помещение, поПомещению]) =>
        узел("room", `этап·${этап}·комната·${помещение}`, помещение, поПомещению,
          разложить(поПомещению, (строка) => строка.category).map(([категория, поКатегории]) =>
            узел(
              "category",
              `этап·${этап}·комната·${помещение}·категория·${категория}`,
              категория,
              поКатегории,
              [],
              поКатегории.map((строка) => строка.item),
            )),
          [])),
      []));
}
