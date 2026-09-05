/**
 * Режим цветовой темы.
 *
 * Состояний три, а не два. «Системная» — не синоним «светлой»: пользователь,
 * который тему не выбирал, обязан следовать настройке операционной системы,
 * и вернуться в это состояние он должен уметь явно. Двухпозиционный
 * переключатель такой возврат отнимает.
 */
export type ThemeMode = "system" | "light" | "dark";

/** Ключ хранилища. Пространство имён нужно: демонстрация и продукт могут
 *  оказаться на одном источнике. */
const STORAGE_KEY = "priyomka.theme";

const isMode = (value: unknown): value is ThemeMode =>
  value === "system" || value === "light" || value === "dark";

/**
 * Чтение сохранённого выбора. Хранилище недоступно в приватном режиме и при
 * запрещённых данных сайта — обращение к нему бросает исключение, а не
 * возвращает пустое значение, поэтому оно обёрнуто целиком.
 */
export function readThemeMode(): ThemeMode {
  try {
    const stored: unknown = window.localStorage.getItem(STORAGE_KEY);
    return isMode(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

/**
 * Подписка на смену режима. Переключателей в интерфейсе два — в шапке и в
 * настройках, — и на экране настроек они видны одновременно. Собственное
 * состояние в каждом расходилось бы: нажатие в шапке оставляло бы копию в
 * настройках показывать прежний выбор.
 */
const listeners = new Set<() => void>();

export function subscribeThemeMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Применение режима к документу. Системный режим снимает признак: правила
 * тёмной темы в этом состоянии включает медиазапрос, а не атрибут.
 */
export function applyThemeMode(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);

  try {
    if (mode === "system") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Выбор не сохранится до перезагрузки. Это допустимо: тема — удобство,
    // а не данные, и падать из-за неё страница не должна.
  }

  for (const listener of listeners) listener();
}
