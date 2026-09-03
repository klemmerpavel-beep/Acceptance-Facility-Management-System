import { useEffect, useState } from "react";

/**
 * Подписка на медиазапрос. Нужна там, где разница между экранами не
 * сводится к раскладке: список объектов на телефоне — не та же таблица в
 * одну колонку, а другой набор строк. Держать в разметке обе версии и
 * прятать одну стилями значило бы отдавать браузеру вдвое больше узлов.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = (): void => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

/**
 * Граница, за которой список объектов показывается ведомостью, а не
 * таблицей. Она проходит по 1023 px, а не по 767: на планшете таблица из
 * семи колонок не складывалась, а сжималась — адрес рвался на три строки,
 * срок на четыре, высота строки росла с 49 до 90 px, а планшет заявлен как
 * рабочее устройство прораба (реестр Д-04).
 *
 * Это не то же самое, что граница навигации: разделы уходят в нижнюю
 * таб-панель по-прежнему на 767 px.
 */
export const MOBILE = "(max-width: 1023px)";
