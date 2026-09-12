import { useState } from "react";
import type { ProjectStatus, ProjectSummary } from "@priyomka/contracts";
import { acceptancePhotoUrl } from "./api.js";
import { ObjectTile } from "./ObjectTile.js";
import { STATUS_LABEL, STATUS_ORDER } from "./status.js";

/**
 * Адрес обложки объекта. Пусто — снимков нет, плитка нарисует подложку.
 *
 * Величина производная: идентификатор снимка приходит в сводке объекта из
 * приёмки, второго места хранения под обложку не заводится.
 */
const обложка = (project: ProjectSummary): string | null =>
  project.cover === null ? null : acceptancePhotoUrl(project.code, project.cover.photoId);

export function ProjectList({
  projects,
  today,
  filter,
  onFilter,
  onOpen,
  onAdd,
  onStatus,
}: {
  projects: ProjectSummary[];
  today: string;
  filter: ProjectStatus | null;
  onFilter: (status: ProjectStatus | null) => void;
  onOpen: (project: ProjectSummary) => void;
  onAdd: () => void;
  /** Смена статуса прямо из реестра. Нет обработчика — нет и органа. */
  onStatus?: (project: ProjectSummary) => void;
}): React.JSX.Element {
  // Объявляется до раннего возврата: порядок вызова хуков не должен
  // зависеть от того, пуст список или нет.
  const [query, setQuery] = useState("");

  if (projects.length === 0) {
    return (
      <div className="empty">
        <p className="empty__title">Объектов пока нет</p>
        <p className="empty__text">
          Заведите первый объект: с него начинается замер, смета и всё остальное.
        </p>
        <button type="button" className="btn btn--primary" onClick={onAdd}>
          <svg className="icon" aria-hidden="true"><use href="#i-plus" /></svg>
          Добавить объект
        </button>
      </div>
    );
  }

  const shown = filter === null ? projects : projects.filter((p) => p.status === filter);
  const needle = query.trim().toLowerCase();
  const found = needle === ""
    ? shown
    : shown.filter((project) =>
        [project.code, project.address, project.client.name, project.client.code]
          .some((field) => field.toLowerCase().includes(needle)),
      );
  const present = STATUS_ORDER.filter((status) => projects.some((p) => p.status === status));

  return (
    <div className="stack">
      {/* Кнопка заведения объекта поднята в обложку раздела. */}
      <div className="section-head">
        <h2 className="t-h2">Портфель</h2>
      </div>

      {/* Фильтр по статусу. Счётчик стоит рядом с названием: иначе выбор
          вслепую приводит к пустой таблице. */}
      <div className="segmented" role="group" aria-label="Статус объекта">
        <button
          type="button"
          className="segmented__option"
          aria-pressed={filter === null}
          onClick={() => onFilter(null)}
        >
          Все {projects.length}
        </button>
        {present.map((status) => (
          <button
            key={status}
            type="button"
            className="segmented__option"
            aria-pressed={filter === status}
            onClick={() => onFilter(status)}
          >
            {STATUS_LABEL[status]} {projects.filter((p) => p.status === status).length}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <p className="empty__title">В этом статусе объектов нет</p>
          <p className="empty__text">Снимите фильтр, чтобы увидеть весь портфель.</p>
        </div>
      ) : (
        <>
          {/* Поиск остаётся при галерее: отбор по статусу сужает портфель по
              состоянию, а найти нужный объект среди тридцати в одном
              состоянии он не помогает. Сортировки по колонкам у галереи нет
              — это объявленная цена перехода от ведомости к плиткам. */}
          <label className="datatable__search">
            <svg className="icon" aria-hidden="true"><use href="#i-search" /></svg>
            <span className="visually-hidden">Поиск по коду, адресу и заказчику</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по коду, адресу и заказчику"
            />
          </label>
          {found.length === 0 ? (
            <div className="empty">
              <p className="empty__title">Ничего не найдено</p>
              <p className="empty__text">Измените запрос.</p>
            </div>
          ) : (
            <div className="gallery">
              {found.map((project) => (
                <ObjectTile
                  key={project.id}
                  project={project}
                  today={today}
                  coverUrl={обложка(project)}
                  onOpen={onOpen}
                  {...(onStatus === undefined ? {} : { onStatus })}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
