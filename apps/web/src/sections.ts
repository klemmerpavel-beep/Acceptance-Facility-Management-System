/**
 * Разделы верхнего уровня. Состав и порядок — по утверждённой карте
 * `docs/07_IA.md`, раздел 3: он повторяет устройство референса, слово
 * «Объекты» вместо «Проекты» — терминология заказчика.
 *
 * Раздел, до которого работа не дошла, из шапки не убирается: он
 * показывает пустое состояние с названием стадии. Спрятанный раздел
 * заставляет гадать, есть он в системе или нет.
 */
export const SECTIONS = [
  { key: "home", label: "Главная", icon: "#i-home" },
  { key: "requests", label: "Заявки", icon: "#i-request" },
  { key: "projects", label: "Объекты", icon: "#i-object" },
  { key: "clients", label: "Контрагенты", icon: "#i-people" },
  { key: "staff", label: "Персонал", icon: "#i-badge" },
  { key: "accounting", label: "Бухгалтерия", icon: "#i-money" },
  { key: "documents", label: "Документы", icon: "#i-document" },
  { key: "settings", label: "Настройки", icon: "#i-settings" },
] as const;

export type Section = (typeof SECTIONS)[number]["key"];

/**
 * Что видно в шапке: пять пилюль и «Ещё». Восемь пилюль занимают 707 px и
 * вместе с блоком пользователя выталкивают страницу за край экрана уже на
 * 768 px — проверено измерением, а не на глаз. Референс устроен так же:
 * пять разделов и «Ещё».
 */
export const HEADER: readonly Section[] = ["home", "requests", "projects", "clients", "staff"];

/**
 * Нижняя панель на телефоне: четыре пункта и «Ещё». Пять подписей в 360 px
 * не помещаются, а прятать «Объекты» нельзя — это рабочий раздел прораба.
 */
export const TABBAR: readonly Section[] = ["home", "requests", "projects", "clients"];

/** Разделы, не поместившиеся в видимый набор поверхности. */
export const restOf = (visible: readonly Section[]): typeof SECTIONS[number][] =>
  SECTIONS.filter((item) => !visible.includes(item.key));
