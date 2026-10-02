import { SECTIONS, type Section } from "./sections.js";

/**
 * Адрес экрана в строке браузера: `#projects`, `#R-99`, `#R-99/estimate`.
 *
 * Первая версия адресную строку не вела: «Назад» уводил из продукта,
 * перезагрузка возвращала на главную, а ссылку на объект нельзя было
 * передать — ссылки несли `href="#R-99"`, но переход гасился (полный аудит
 * 30.09.2026, П-50). Решение заказчика от 01.10.2026 — адреса вида `#R-99`
 * без новой зависимости: хватает истории браузера и разбора одной строки.
 *
 * Адрес — следствие состояния, а не его источник: оболочка держит раздел,
 * объект и вкладку, пишет из них адрес и читает его при входе и при
 * «Назад»/«Вперёд». Доступ адрес не даёт: объект ищется в списке, который
 * сервер отдал этой роли.
 */
export const ВКЛАДКИ = [
  "overview", "measure", "estimate", "work", "acceptance",
  "expenses", "report", "tranches", "documents", "import",
] as const;
export type Вкладка = (typeof ВКЛАДКИ)[number];

export type Маршрут =
  | { kind: "section"; section: Section }
  | { kind: "project"; code: string; tab: Вкладка };

const РАЗДЕЛЫ: readonly string[] = [...SECTIONS.map((item) => item.key), "settings", "roadmap", "documents"];
/** Тот же вид кода, что у контракта: латинская буква, дефис, до четырёх цифр. */
const ОБЪЕКТ = /^([A-Z]-\d{1,4})(?:\/([a-z]+))?$/u;

const этоВкладка = (значение: string): значение is Вкладка =>
  (ВКЛАДКИ as readonly string[]).includes(значение);
const этоРаздел = (значение: string): значение is Section => РАЗДЕЛЫ.includes(значение);

/**
 * Разбор адреса. `null` — адрес пуст или ничего не называет: оболочка
 * остаётся на своём экране. Неизвестная вкладка объекта — «Обзор»: объект
 * назван верно, и открыть его полезнее, чем промолчать.
 */
export function разобрать(hash: string): Маршрут | null {
  let тело: string;
  try {
    тело = decodeURIComponent(hash.replace(/^#/u, ""));
  } catch {
    return null;
  }
  if (тело === "") return null;
  const объект = ОБЪЕКТ.exec(тело);
  if (объект !== null) {
    const [, code = "", вкладка = "overview"] = объект;
    return { kind: "project", code, tab: этоВкладка(вкладка) ? вкладка : "overview" };
  }
  return этоРаздел(тело) ? { kind: "section", section: тело } : null;
}

/** Сборка адреса. «Обзор» в адрес не пишется: `#R-99` и есть объект. */
export function адрес(маршрут: Маршрут): string {
  if (маршрут.kind === "section") return `#${маршрут.section}`;
  return маршрут.tab === "overview" ? `#${маршрут.code}` : `#${маршрут.code}/${маршрут.tab}`;
}

/**
 * Простой щелчок: левая кнопка без клавиш-модификаторов. Только его
 * перехватывает продукт; щелчок с Ctrl, Cmd, Shift или средней кнопкой
 * остаётся браузеру — ссылка открывается в новой вкладке по своему адресу.
 */
export const простойЩелчок = (event: React.MouseEvent): boolean =>
  event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
