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
  revealLength, singleWallArea, singleWallAreaNet, wallArea, wallAreaNet,
  type MeasureTotals, type RoomMeasure, type WallMeasure,
} from "./measure.js";
import {
  ownerLevel,
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
  const internal = ownerLevel(role);

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
      ...(ownerLevel(role) ? projectEstimateItem(item, role) : projectEstimateItem(item, role)),
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

/** Что удаляют: позицию и её принятое с учётом сторно. */
export interface EstimateItemRemoval {
  readonly accepted: Milliunits;
  readonly name: string;
  readonly unit: string;
}

/**
 * Причина отказа при удалении позиции или null (план, пункт 7.3).
 *
 * Принятая позиция не удаляется: принятое начислено бригаде, вошло в транш и
 * в акт, и удаление объявило бы несделанным то, за что уже заплачено. Путь
 * назван словами — сторно приёмки. После сторно принятое равно нулю, и
 * позиция снимается со сметы; записи приёмки и сторно остаются в истории.
 */
export function estimateItemRemovalFault(removal: EstimateItemRemoval): string | null {
  if (removal.accepted <= 0n) return null;
  return `По позиции «${removal.name}» принято ${количествоТекстом(removal.accepted, removal.unit)}. `
    + "Принятую позицию удалить нельзя: принятое начислено бригаде и вошло в транш. "
    + "Сторнируйте приёмку на вкладке «Приёмка» — после сторно позиция снимается со сметы, "
    + "а записи приёмки остаются в истории.";
}

/** Что держит раздел: всё, что удаление раздела унесло бы или оборвало. */
export interface EstimateSectionRemoval {
  readonly name: string;
  /** Позиции в смете. */
  readonly items: number;
  /** Позиции, снятые со сметы: их история приёмки держится за раздел. */
  readonly removed: number;
  readonly children: number;
  readonly batches: number;
  /** Этап графика, который ведёт раздел, или null. */
  readonly stage: string | null;
  readonly expenses: number;
}

/**
 * Причина отказа при удалении раздела или null.
 *
 * Удаляется только пустой раздел. Каскад базы унёс бы позиции и вложенные
 * разделы молча, пакет приёмки держит раздел внешним ключом, а связь с
 * этапом графика и чеками оборвалась бы без следа. Отказ называет всё, что
 * держит раздел, разом: по одному пункту за попытку человек разбирал бы
 * раздел вслепую.
 */
export function estimateSectionRemovalFault(removal: EstimateSectionRemoval): string | null {
  const держит: string[] = [];
  if (removal.items > 0) держит.push(`позиций — ${String(removal.items)}`);
  if (removal.children > 0) держит.push(`вложенных разделов — ${String(removal.children)}`);
  if (removal.batches > 0) держит.push(`пакетов приёмки — ${String(removal.batches)}`);
  if (removal.removed > 0) {
    держит.push(`снятых со сметы позиций с историей приёмки — ${String(removal.removed)}`);
  }
  if (removal.stage !== null) держит.push(`этап графика «${removal.stage}»`);
  if (removal.expenses > 0) держит.push(`чеков — ${String(removal.expenses)}`);
  if (держит.length === 0) return null;
  return `Раздел «${removal.name}» не пуст: ${держит.join(", ")}. Удаляется только пустой раздел.`;
}

/**
 * Причина отказа при вложении раздела или null: разделы бывают двух уровней,
 * как в файле заказчика, и вкладывать можно только в раздел верхнего уровня.
 */
export function estimateSectionNestingFault(parentHasParent: boolean): string | null {
  return parentHasParent
    ? "Раздел вкладывается только в раздел верхнего уровня: разделов в смете два уровня, как в файле заказчика."
    : null;
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

/**
 * Величина обмера, годная в количество позиции. `wallArea` — площадь стен
 * брутто, без вычета проёмов; `wallAreaNet` — за вычетом проёмов (этап
 * Э11, шаг 1). Брутто не переименована и не заменена: по ней подставлены
 * количества прежних смет.
 */
export type MeasureSource = "floorArea" | "wallArea" | "wallAreaNet" | "floorPerimeter" | "ceilingPerimeter";

/**
 * Какие величины обмера подставляются позиции с этой единицей.
 *
 * Карта литеральная, а не выведенная из имён: «м.п.» подходит и плинтусу, и
 * карнизу, а какая из двух длин нужна — решает человек, и подставить одну за
 * него значило бы соврать. Единица, которой в карте нет, строки переноса не
 * получает: подставлять нечего, и пустой список хуже отсутствия.
 */
export const MEASURE_SOURCES: Readonly<Record<string, readonly MeasureSource[]>> = {
  /* Обе площади стен стоят рядом: какая нужна, решает работа — грунтовка
     идёт по всей стене, обои и покраска за вычетом окон и дверей. Выбрать
     за человека значило бы соврать в одном из двух случаев. */
  "м²": ["floorArea", "wallArea", "wallAreaNet"],
  "м.п.": ["floorPerimeter", "ceilingPerimeter"],
};

/**
 * Подпись величины обмера на кнопке подстановки.
 *
 * «Площадь стен нетто» — слово решения заказчика 07.11.2026 (`01_PROJECT.md`,
 * редакция 1.23, раздел 6.5; ADR-0002, п. 5): прежняя «площадь стен» остаётся
 * брутто, третья строка — нетто, за вычетом окон и дверей помещения.
 */
export const MEASURE_LABEL: Readonly<Record<MeasureSource, string>> = {
  floorArea: "площадь пола",
  wallArea: "площадь стен",
  wallAreaNet: "площадь стен нетто",
  floorPerimeter: "периметр пола",
  ceilingPerimeter: "периметр потолка",
};

/**
 * Подставленное число так, как оно легло в поле количества: до тысячной,
 * без незначащих нулей. Округление до сотых (`количествоТекстом`) назвало
 * бы копию «18,068» числом «18,07» — строка источника разошлась бы с полем
 * рядом с ней.
 */
const подставленноеЧисло = (value: Milliunits, unit: string): string => {
  const raw: bigint = value;
  const модуль = raw < 0n ? -raw : raw;
  const дробь = (модуль % 1000n).toString().padStart(3, "0").replace(/0+$/u, "");
  const целое = (модуль / 1000n).toString();
  return `${raw < 0n ? "−" : ""}${дробь === "" ? целое : `${целое},${дробь}`}\u00A0${unit}`;
};

/**
 * Конец предложения после числа с единицей. «м.п.» уже кончается точкой, и
 * вторая давала «13,2 м.п.. Это копия» — так строка источника печаталась у
 * всех позиций в погонных метрах с шага 1 (П-78).
 */
const сТочкой = (text: string): string => (text.endsWith(".") ? text : `${text}.`);

/**
 * Источник подставленного количества словами: «Подставлено из обмера
 * помещения «Спальня»: площадь стен нетто, 43,74 м²».
 *
 * Подставленное количество — копия, а не ссылка: правка обмера его не
 * меняет, и уже подставленные количества не пересчитываются (ADR-0002,
 * п. 5). Поэтому источник называется в момент подстановки: две площади
 * стен рядом неотличимы в поле количества. Число — ровно то, что
 * подставлено, до тысячной (`подставленноеЧисло`).
 *
 * `room` — имя помещения; `null` — величина объекта целиком.
 */
export function measureSourceNote(
  source: MeasureSource,
  room: string | null,
  value: Milliunits,
  unit: string,
): string {
  const откуда = room === null ? "из обмера объекта" : `из обмера помещения «${room}»`;
  return сТочкой(`Подставлено ${откуда}: ${MEASURE_LABEL[source]}, ${подставленноеЧисло(value, unit)}`)
    + " Это копия: правка обмера количество не изменит.";
}

/** Величины обмера, годные позиции с данной единицей. Пусто — переносить нечего. */
export function measureSourcesFor(unit: string): readonly MeasureSource[] {
  return MEASURE_SOURCES[unit] ?? [];
}

/* --- адрес поверхности и источник подстановки (этап Э11, шаг 2) ------------

   Позиция получает адрес — вид поверхности и стену (решение Д4; Э11-2.5 «а»):
   его ставит человек выбором, из величины он не выводится. Подстановка
   предлагает величины выбранной поверхности по единице позиции, без выбора —
   величины помещения, как на шаге 1 (Э11-2.6 «а»). Подставленное количество
   по-прежнему копия: правка обмера его не меняет. Но источник теперь
   хранится — величина с областью, помещение, стена и подставленное число, —
   и признак «обмер изменился» сравнивает подставленное с величиной сейчас
   (Э11-2.7 «в»). Количество меняет только человек. */

/** Вид поверхности: адрес работы внутри помещения. */
export type SurfaceKind = "FLOOR" | "CEILING" | "WALLS" | "WALL" | "REVEALS";

export const SURFACE_KINDS: readonly SurfaceKind[] = ["FLOOR", "CEILING", "WALLS", "WALL", "REVEALS"];

/** Вид поверхности словами — списком листа позиции и в журнале. */
export const SURFACE_LABEL: Readonly<Record<SurfaceKind, string>> = {
  FLOOR: "пол",
  CEILING: "потолок",
  WALLS: "все стены",
  WALL: "одна стена",
  REVEALS: "откосы",
};

/**
 * Источник подставленного количества: величина и её область. Область —
 * помещение позиции, одна стена помещения или итог действующего набора
 * обмера объекта. Хранится строкой целиком, а не выводится из ссылок:
 * удаление помещения обнуляет ссылку, и источник помещения выдал бы себя
 * за итог объекта.
 *
 * Перечень закрыт: «длина откосов» — только помещения (у объекта её группа
 * «из обмера объекта» не предлагает), у стены — только две площади.
 */
export const QTY_SOURCES = [
  "room:floorArea", "room:wallArea", "room:wallAreaNet",
  "room:floorPerimeter", "room:ceilingPerimeter", "room:revealLength",
  "wall:wallArea", "wall:wallAreaNet",
  "project:floorArea", "project:wallArea", "project:wallAreaNet",
  "project:floorPerimeter", "project:ceilingPerimeter",
] as const;
export type QtySource = (typeof QTY_SOURCES)[number];
export type QtySourceScope = "room" | "wall" | "project";

/** Область источника: помещение, стена или объект. */
export function qtySourceScope(source: QtySource): QtySourceScope {
  if (source.startsWith("wall:")) return "wall";
  if (source.startsWith("project:")) return "project";
  return "room";
}

/** Строка ли это перечня: значение пришло из базы или из запроса. */
export function isQtySource(value: string): value is QtySource {
  return (QTY_SOURCES as readonly string[]).includes(value);
}

/**
 * Подпись величины источника. У одной стены — «площадь стены», а не «стен»
 * (норматив, раздел 55.6); у потолка в м² — «площадь пола» под своим
 * именем: площади потолка обмер не знает (Э11-2.6 «а»).
 */
export const QTY_SOURCE_LABEL: Readonly<Record<QtySource, string>> = {
  "room:floorArea": MEASURE_LABEL.floorArea,
  "room:wallArea": MEASURE_LABEL.wallArea,
  "room:wallAreaNet": MEASURE_LABEL.wallAreaNet,
  "room:floorPerimeter": MEASURE_LABEL.floorPerimeter,
  "room:ceilingPerimeter": MEASURE_LABEL.ceilingPerimeter,
  "room:revealLength": "длина откосов",
  "wall:wallArea": "площадь стены",
  "wall:wallAreaNet": "площадь стены нетто",
  "project:floorArea": MEASURE_LABEL.floorArea,
  "project:wallArea": MEASURE_LABEL.wallArea,
  "project:wallAreaNet": MEASURE_LABEL.wallAreaNet,
  "project:floorPerimeter": MEASURE_LABEL.floorPerimeter,
  "project:ceilingPerimeter": MEASURE_LABEL.ceilingPerimeter,
};

/**
 * Величины поверхности для подстановки, по единице позиции (решение
 * Э11-2.6 «а»; ADR-0002, раздел «Решения шага 2», п. 6). Карта литеральная —
 * по доводу у `MEASURE_SOURCES`: какая из величин нужна, решает человек.
 *
 *   без выбора — величины помещения шага 1;
 *   пол        — м²: площадь пола; м.п.: периметр пола;
 *   потолок    — м²: площадь пола; м.п.: периметр потолка;
 *   все стены  — м²: площадь стен брутто и нетто;
 *   одна стена — м²: площадь стены брутто и нетто;
 *   откосы     — м.п.: длина откосов своей стороны.
 *
 * Штук окон и дверей нет — вторая очередь: пока на объекте есть помещения
 * без стен, их итоги считают межкомнатную дверь с обеих сторон.
 */
const ПО_ПОВЕРХНОСТИ: Readonly<Record<SurfaceKind, Readonly<Record<string, readonly QtySource[]>>>> = {
  FLOOR: { "м²": ["room:floorArea"], "м.п.": ["room:floorPerimeter"] },
  CEILING: { "м²": ["room:floorArea"], "м.п.": ["room:ceilingPerimeter"] },
  WALLS: { "м²": ["room:wallArea", "room:wallAreaNet"] },
  WALL: { "м²": ["wall:wallArea", "wall:wallAreaNet"] },
  REVEALS: { "м.п.": ["room:revealLength"] },
};

/** Величины «из обмера помещения» для адреса и единицы позиции. */
export function surfaceSources(surface: SurfaceKind | null, unit: string): readonly QtySource[] {
  if (surface === null) {
    return measureSourcesFor(unit).map((source): QtySource => `room:${source}`);
  }
  return ПО_ПОВЕРХНОСТИ[surface][unit] ?? [];
}

/** Величины «из обмера объекта» — итог действующего набора, как на шаге 1. */
export function projectSources(unit: string): readonly QtySource[] {
  return measureSourcesFor(unit).map((source): QtySource => `project:${source}`);
}

/** Откуда величина источника берётся сейчас. */
export interface QtySourceContext {
  /** Помещение источника; `null` — его нет. */
  readonly room: RoomMeasure | null;
  /** Стена источника внутри `room`; `null` — её нет. */
  readonly wall: WallMeasure | null;
  /** Итоги действующего набора обмера объекта. */
  readonly totals: MeasureTotals | null;
}

/**
 * Величина источника сейчас — тем же доменом, что экран обмера, чтобы
 * подставленное и показанное не могли разойтись. `null` — посчитать не из
 * чего: помещения, стены или итогов нет.
 */
export function qtySourceValue(source: QtySource, context: QtySourceContext): Milliunits | null {
  const { room, wall, totals } = context;
  switch (source) {
    case "room:floorArea": return room === null ? null : room.floorArea;
    case "room:floorPerimeter": return room === null ? null : room.floorPerimeter;
    case "room:ceilingPerimeter": return room === null ? null : room.ceilingPerimeter;
    case "room:wallArea": return room === null ? null : wallArea(room);
    case "room:wallAreaNet": return room === null ? null : wallAreaNet(room);
    case "room:revealLength": return room === null ? null : revealLength(room);
    case "wall:wallArea": return room === null || wall === null ? null : singleWallArea(room, wall);
    case "wall:wallAreaNet": return room === null || wall === null ? null : singleWallAreaNet(room, wall);
    case "project:floorArea": return totals === null ? null : totals.floorArea;
    case "project:wallArea": return totals === null ? null : totals.wallArea;
    case "project:wallAreaNet": return totals === null ? null : totals.wallAreaNet;
    case "project:floorPerimeter": return totals === null ? null : totals.floorPerimeter;
    case "project:ceilingPerimeter": return totals === null ? null : totals.ceilingPerimeter;
  }
}

/**
 * Причина отказа в адресе поверхности или `null`. Адрес — помещение, вид и
 * стена: вид без помещения не адрес, стена — только у вида «одна стена».
 */
export function surfaceFault(address: {
  readonly roomId: string | null;
  readonly surface: SurfaceKind | null;
  readonly wallId: string | null;
}): string | null {
  if (address.surface !== null && address.roomId === null) {
    return "Поверхность выбирается у помещения: сначала выберите помещение позиции.";
  }
  if (address.wallId !== null && address.surface !== "WALL") {
    return "Стена выбирается только у поверхности «одна стена».";
  }
  return null;
}

/**
 * Причина отказа в источнике подстановки или `null`: величина обязана быть
 * из тех, что лист предложил бы этому адресу и этой единице. Источник,
 * которого лист не предлагал, назвал бы основанием количества не ту
 * величину.
 */
export function qtySourceFault(source: QtySource, address: {
  readonly roomId: string | null;
  readonly surface: SurfaceKind | null;
  readonly wallId: string | null;
  readonly unit: string;
}): string | null {
  const подпись = QTY_SOURCE_LABEL[source];
  const область = qtySourceScope(source);
  if (область === "project") {
    return projectSources(address.unit).includes(source)
      ? null
      : `Величина «${подпись}» объекта не подставляется позиции в «${address.unit}».`;
  }
  if (address.roomId === null) {
    return `Величина «${подпись}» берётся из обмера помещения: выберите помещение позиции.`;
  }
  if (!surfaceSources(address.surface, address.unit).includes(source)) {
    const поверхность = address.surface === null ? "без поверхности" : `«${SURFACE_LABEL[address.surface]}»`;
    return `Величина «${подпись}» не относится к поверхности ${поверхность} позиции в «${address.unit}».`;
  }
  if (область === "wall" && address.wallId === null) {
    return `Величина «${подпись}» берётся со стены: выберите стену.`;
  }
  return null;
}

/**
 * Отказ, если подставляемое количество не совпадает с величиной источника
 * сейчас. Источник называет основание количества, и основание, которое уже
 * в момент записи с ним расходится, было бы неправдой: лист показывал
 * прежнее число, а обмер тем временем поправили.
 */
export function qtySourceMismatch(qty: Milliunits, now: Milliunits | null, unit: string): string | null {
  if (now === null) return "Величины обмера, из которой подставлено количество, больше нет. Подставьте заново.";
  if (qty === now) return null;
  return `Подставлено ${подставленноеЧисло(qty, unit)}, а в обмере сейчас ${подставленноеЧисло(now, unit)}:`
    + " обмер изменился, пока лист был открыт. Подставьте заново.";
}

/**
 * Строка источника (норматив, раздел 55.7): «Подставлено из обмера помещения
 * «Спальня», стена «Стена 1 · у окна»: площадь стены нетто, 8,7 м². Это
 * копия: правка обмера количество не изменит». Число — ровно подставленное,
 * до тысячной, как у `measureSourceNote`.
 */
export function qtySourceNote(
  source: QtySource,
  where: { readonly room: string | null; readonly wall: string | null },
  value: Milliunits,
  unit: string,
): string {
  const область = qtySourceScope(source);
  /* Удалённое помещение или стена так и называются: источник помещения без
     имени не должен выдавать себя за итог объекта. */
  const стена = область !== "wall" ? "" : where.wall === null ? ", стена удалена" : `, стена «${where.wall}»`;
  const откуда = область === "project"
    ? "из обмера объекта"
    : where.room === null
      ? "из обмера удалённого помещения"
      : `из обмера помещения «${where.room}»${стена}`;
  return сТочкой(`Подставлено ${откуда}: ${QTY_SOURCE_LABEL[source]}, ${подставленноеЧисло(value, unit)}`)
    + " Это копия: правка обмера количество не изменит.";
}

/** Хранимый источник позиции. */
export interface QtySourceRecord {
  readonly source: QtySource;
  /** Подставленное число. */
  readonly value: Milliunits;
  /** Помещение и стена источника; пусто — удалены (или итог объекта). */
  readonly roomId: string | null;
  readonly wallId: string | null;
}

/**
 * Признак «обмер изменился» (решение Э11-2.7 «в»).
 *
 * `same` — величина источника сейчас та же; `changed` — другая: «подставлено
 * X, сейчас Y»; `removed` — источника больше нет: удалено помещение или
 * стена, либо позицию перевели на помещение после перепланировки, а
 * источник остался в прежнем наборе.
 */
export type MeasureDrift =
  | { readonly state: "same"; readonly now: Milliunits }
  | { readonly state: "changed"; readonly now: Milliunits }
  | { readonly state: "removed"; readonly reason: string };

/**
 * Признак источника позиции. Чистая функция: величину сейчас считает тот же
 * домен, что экран обмера. Количество признак не трогает — его меняет
 * только человек действием «подставить заново».
 *
 * `itemRoomId` — помещение позиции сейчас. Источник помещения или стены,
 * чьё помещение — не помещение позиции, — это позиция, переведённая на
 * перепланировку: ручная смена помещения источник снимает и сюда не
 * доходит.
 */
export function measureDrift(
  record: QtySourceRecord,
  itemRoomId: string | null,
  context: QtySourceContext,
): MeasureDrift {
  const область = qtySourceScope(record.source);
  if (область !== "project") {
    if (record.roomId === null || context.room === null) {
      return { state: "removed", reason: "Помещения источника больше нет в обмере." };
    }
    if (itemRoomId !== record.roomId) {
      return {
        state: "removed",
        reason: "Позицию перевели на обмер после перепланировки: источник остался в прежнем наборе.",
      };
    }
    if (область === "wall" && (record.wallId === null || context.wall === null)) {
      return { state: "removed", reason: "Стены источника больше нет в обмере." };
    }
  }
  const now = qtySourceValue(record.source, context);
  if (now === null) return { state: "removed", reason: "Величины источника больше нет в обмере." };
  return { state: now === record.value ? "same" : "changed", now };
}

/**
 * Признак словами (норматив, раздел 55.7): «Подставлено 8,97 м², сейчас
 * 8,7 м². Количество само не меняется». `null` — расхождения нет.
 */
export function measureDriftNote(drift: MeasureDrift, substituted: Milliunits, unit: string): string | null {
  if (drift.state === "same") return null;
  if (drift.state === "removed") return `${drift.reason} Количество само не меняется.`;
  return сТочкой(`Подставлено ${подставленноеЧисло(substituted, unit)}, сейчас ${подставленноеЧисло(drift.now, unit)}`)
    + " Количество само не меняется.";
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
