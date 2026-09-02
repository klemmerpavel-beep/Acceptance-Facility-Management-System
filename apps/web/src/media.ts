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

/** Граница мобильной раскладки — та же, что в сетке дизайн-системы. */
export const MOBILE = "(max-width: 767px)";
