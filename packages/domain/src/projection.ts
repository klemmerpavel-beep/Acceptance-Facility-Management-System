/**
 * Разграничение доступа на уровне полей.
 *
 * `docs/01_PROJECT.md`, раздел 7: поля `unit_wage`, `wage_total`, `profit`,
 * `profit_pct` помечены как внутренние. `docs/02_DEV_PROMPT.md`, раздел 4:
 * разграничение на уровне полей, а не на уровне экранов — внутренние величины
 * не должны попадать в ответ сервера, а не просто скрываться на фронте.
 *
 * Кому они открыты, решает `OWNER_LEVEL`, а не сравнение с одной ролью: с
 * 19.09.2026 внутренние величины видит и бухгалтер (ответ заказчика на вопрос
 * 7 квиза).
 *
 * Проекция реализована так, что внутренние ключи **отсутствуют** в
 * результате, а не присутствуют со значением undefined: `JSON.stringify`
 * опускает undefined, но структурное сравнение и логи — нет.
 */

import {
  applyPercent, multiplyByQuantity, shareOf, subtract,
  type BasisPoints, type Kopecks, type Milliunits,
} from "./money.js";

export type Role = "OWNER" | "FOREMAN" | "ACCOUNTANT" | "CLIENT";

/** Кому предназначен документ: внутреннему обороту или клиенту. */
export type Audience = "internal" | "client";

/**
 * Роли, которым открыто всё, что открыто руководителю, кроме настроек
 * организации и выдачи входа.
 *
 * Объявлен здесь единственный раз, и этим перечнем меряются и поля, и
 * маршруты: страж сервера (`roles.guard.ts`) спрашивает его же. Перечень —
 * потому что разграничение перестало быть сравнением с одной ролью, а
 * шестьдесят с лишним сравнений `role === "OWNER"`, расставленных по
 * обработчикам порознь, разошлись бы на первой же новой роли — и разошлись
 * бы молча, отказом там, где доступ обещан.
 *
 * **Состав — решение заказчика от 19.09.2026, а не вывод.** Бухгалтеру
 * открыты внутренние величины: сдельная оплата, себестоимость и прибыль.
 * Прежняя редакция перечня `INTERNAL_FIELDS` отвечала на вопрос «что видит
 * один только руководитель»; теперь она отвечает на вопрос «чего не видят
 * прораб и заказчик». Смысл перечня изменился, состав — нет, и назвать это
 * обязательно: иначе следующая правка прочтёт его прежним.
 */
export const OWNER_LEVEL: readonly Role[] = ["OWNER", "ACCOUNTANT"];

/**
 * Наследует ли роль права руководителя. Единственная проверка на весь продукт.
 *
 * Возвращает сужение типа, а не просто «да» или «нет»: проекция сметы
 * различает роли на уровне перегрузок, и без сужения на месте вызова
 * пришлось бы писать `"OWNER"` буквой — ровно ту подмену, из-за которой
 * бухгалтер получил бы ответ руководителя не по правилу, а по совпадению.
 */
export function ownerLevel(role: Role | undefined): role is "OWNER" | "ACCOUNTANT" {
  return role !== undefined && OWNER_LEVEL.includes(role);
}

/**
 * Перечень внутренних полей. Единственное место, где он объявлен: и проекция,
 * и проверяющий тест берут его отсюда, поэтому новое внутреннее поле нельзя
 * добавить, забыв закрыть его от прораба.
 */
export const INTERNAL_FIELDS = ["unitWage", "wageTotal", "profit", "profitShare"] as const;
export type InternalField = (typeof INTERNAL_FIELDS)[number];

/**
 * Помещение, работы которого ведёт позиция.
 *
 * Внутренней величиной не является и потому приходит всем ролям: прорабу оно
 * нужнее прочих — он принимает помещение, а не позицию.
 */
export interface ItemRoom {
  id: string;
  name: string;
  set: "INITIAL" | "REPLANNED";
}

/** Позиция сметы, как она хранится. */
export interface EstimateItemRecord {
  id: string;
  sectionId: string;
  order: number;
  name: string;
  unit: string;
  qty: Milliunits;
  qtyAccepted: Milliunits;
  unitPrice: Kopecks;
  unitWage: Kopecks;
  /** Пусто — помещение не выбрано: импортированная смета комнат не знает. */
  room: ItemRoom | null;
}

/** Позиция, видимая прорабу и клиенту. */
export interface PublicEstimateItem {
  id: string;
  sectionId: string;
  order: number;
  name: string;
  unit: string;
  qty: Milliunits;
  qtyAccepted: Milliunits;
  unitPrice: Kopecks;
  total: Kopecks;
  room: ItemRoom | null;
}

/** Позиция, видимая руководителю. */
export interface InternalEstimateItem extends PublicEstimateItem {
  unitWage: Kopecks;
  wageTotal: Kopecks;
  profit: Kopecks;
  profitShare: BasisPoints;
}

export function projectEstimateItem(
  item: EstimateItemRecord,
  role: "OWNER" | "ACCOUNTANT",
): InternalEstimateItem;
export function projectEstimateItem(item: EstimateItemRecord, role: Role): PublicEstimateItem;
export function projectEstimateItem(
  item: EstimateItemRecord,
  role: Role,
): PublicEstimateItem | InternalEstimateItem {
  const total = multiplyByQuantity(item.unitPrice, item.qty);
  const visible: PublicEstimateItem = {
    id: item.id,
    sectionId: item.sectionId,
    order: item.order,
    name: item.name,
    unit: item.unit,
    qty: item.qty,
    qtyAccepted: item.qtyAccepted,
    unitPrice: item.unitPrice,
    total,
    room: item.room,
  };
  if (!ownerLevel(role)) return visible;

  const wageTotal = multiplyByQuantity(item.unitWage, item.qty);
  const profit = subtract(total, wageTotal);
  const internal: InternalEstimateItem = {
    ...visible,
    unitWage: item.unitWage,
    wageTotal,
    profit,
    profitShare: shareOf(profit, total),
  };
  return internal;
}

/** Строка акта. Клиентская проекция получает те же поля, что и прораб. */
export interface ActLineRecord extends EstimateItemRecord {
  qtyInAct: Milliunits;
}

export interface PublicActLine {
  name: string;
  unit: string;
  qty: Milliunits;
  unitPrice: Kopecks;
  total: Kopecks;
}

export interface InternalActLine extends PublicActLine {
  unitWage: Kopecks;
  wageTotal: Kopecks;
  profit: Kopecks;
  profitShare: BasisPoints;
}

export function projectActLine(line: ActLineRecord, audience: "internal"): InternalActLine;
export function projectActLine(line: ActLineRecord, audience: Audience): PublicActLine;
export function projectActLine(
  line: ActLineRecord,
  audience: Audience,
): PublicActLine | InternalActLine {
  const total = multiplyByQuantity(line.unitPrice, line.qtyInAct);
  const visible: PublicActLine = {
    name: line.name,
    unit: line.unit,
    qty: line.qtyInAct,
    unitPrice: line.unitPrice,
    total,
  };
  if (audience === "client") return visible;

  const wageTotal = multiplyByQuantity(line.unitWage, line.qtyInAct);
  const profit = subtract(total, wageTotal);
  const internal: InternalActLine = {
    ...visible,
    unitWage: line.unitWage,
    wageTotal,
    profit,
    profitShare: shareOf(profit, total),
  };
  return internal;
}

/**
 * Итог, отдаваемый клиенту: сумма работ и надбавка «сопровождение объекта»
 * отдельной строкой (БП-07). Внутренних величин в этом объекте нет по составу.
 */
export interface ClientTotals {
  works: Kopecks;
  supervision: Kopecks;
  supervisionShare: BasisPoints;
  total: Kopecks;
}

export function clientTotals(works: Kopecks, supervisionShare: BasisPoints): ClientTotals {
  const supervision = applyPercent(works, supervisionShare);
  return { works, supervision, supervisionShare, total: (works + supervision) as Kopecks };
}

/**
 * Проверка полезной нагрузки на утечку внутренних полей. Обходит структуру
 * целиком, включая вложенные объекты и массивы: внутреннее поле, спрятанное
 * в третьем уровне ответа, — такая же утечка, как и в корне.
 *
 * @returns пути найденных внутренних полей; пустой список означает, что
 *          нагрузку можно отдавать роли, отличной от OWNER.
 */
export function findInternalFields(payload: unknown, path = "$"): string[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((entry, index) => findInternalFields(entry, `${path}[${index}]`));
  }
  if (payload === null || typeof payload !== "object") return [];

  const found: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if ((INTERNAL_FIELDS as readonly string[]).includes(key)) found.push(`${path}.${key}`);
    found.push(...findInternalFields(value, `${path}.${key}`));
  }
  return found;
}
