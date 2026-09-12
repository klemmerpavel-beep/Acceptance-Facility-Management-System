import type { ProjectStatus } from "@priyomka/contracts";

/**
 * Тон обложки объекта по его статусу.
 *
 * Классы перечислены literally, а не собираются из шаблона. Проверка мёртвых
 * правил дизайн-системы читает разметку и ищет в ней каждый объявленный
 * класс; класс, склеенный на ходу из имени и ключа статуса, она не находит
 * и объявляет правило мёртвым — а следом его снимают как ненужное. Тот же
 * приём уже принят для пилюль статуса и полосы портфеля.
 *
 * Тон берётся из тех же токенов, что и пилюля рядом: два разных вида одного
 * состояния на одной плитке сообщали бы о разнице, которой нет.
 */
export const ОБЛОЖКА_СТАТУСА: Record<ProjectStatus, string> = {
  NEW: "objecttile__cover objecttile__cover--new",
  IN_PROGRESS: "objecttile__cover objecttile__cover--work",
  WAITING_CLIENT: "objecttile__cover objecttile__cover--wait",
  PAUSED: "objecttile__cover objecttile__cover--pause",
  DONE: "objecttile__cover objecttile__cover--done",
  ARCHIVED: "objecttile__cover objecttile__cover--archive",
};

/** То же для крупной обложки на вкладке «Обзор» карточки объекта. */
export const КРУПНАЯ_ОБЛОЖКА: Record<ProjectStatus, string> = {
  NEW: "objectcover objectcover--new",
  IN_PROGRESS: "objectcover objectcover--work",
  WAITING_CLIENT: "objectcover objectcover--wait",
  PAUSED: "objectcover objectcover--pause",
  DONE: "objectcover objectcover--done",
  ARCHIVED: "objectcover objectcover--archive",
};
