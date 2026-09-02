import type { ProjectStatus, ProjectSummary, Role } from "@priyomka/contracts";
import { formatKopecks } from "@priyomka/ui";
import { MOBILE, useMediaQuery } from "./media.js";
import { STATUS_LABEL, STATUS_ORDER, STATUS_PILL, formatDate, plural } from "./status.js";

const money = (value: string): string => formatKopecks(BigInt(value));

/** Срок объекта в человеческом виде: просрочка называется просрочкой. */
function deadlineCell(deadline: string | null, today: string): React.JSX.Element {
  if (deadline === null) return <span className="t-muted">не задан</span>;
  const days = Math.round(
    (Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  return (
    <span className={days < 0 ? "num--danger" : undefined}>
      {formatDate(deadline)}
      <span className="t-sm t-muted">
        {days < 0
          ? ` · просрочен на ${Math.abs(days)} ${plural(days, "день", "дня", "дней")}`
          : ` · ${days} ${plural(days, "день", "дня", "дней")}`}
      </span>
    </span>
  );
}

/**
 * Объект на телефоне — карточка, а не строка таблицы. Таблица из семи
 * колонок на ширине 360 px прокручивается вбок, и половина сведений об
 * объекте оказывается за краем экрана: именно там, где с системой работает
 * прораб. Набор сведений тот же, что в таблице.
 */
function ProjectCardRow({
  project,
  today,
  onOpen,
}: {
  project: ProjectSummary;
  today: string;
  onOpen: (project: ProjectSummary) => void;
}): React.JSX.Element {
  return (
    <div className="panel panel--pad stack stack--tight">
      <div className="row row--between">
        <span className="code-badge">{project.code}</span>
        <span className={STATUS_PILL[project.status]}>{STATUS_LABEL[project.status]}</span>
      </div>
      <a
        className="t-h3"
        href={`#${project.code}`}
        onClick={(event) => { event.preventDefault(); onOpen(project); }}
      >
        {project.address}
      </a>
      <p className="t-sm t-secondary">
        [{project.client.code}] {project.client.name}
        {project.foreman === null ? " · прораб не назначен" : ` · ${project.foreman.name}`}
      </p>
      <p className="t-sm">{deadlineCell(project.deadline, today)}</p>
      <p className="row row--between">
        <span className="t-sm t-muted">
          {project.estimateTotal === null ? "смета не загружена" : `позиций ${project.positions}`}
        </span>
        {project.estimateTotal !== null && <span className="num">{money(project.estimateTotal)}</span>}
      </p>
    </div>
  );
}

export function ProjectList({
  projects,
  role,
  today,
  filter,
  onFilter,
  onOpen,
}: {
  projects: ProjectSummary[];
  role: Role;
  today: string;
  filter: ProjectStatus | null;
  onFilter: (status: ProjectStatus | null) => void;
  onOpen: (project: ProjectSummary) => void;
}): React.JSX.Element {
  // Подписка объявляется до раннего возврата: порядок вызова хуков не
  // должен зависеть от того, пуст список или нет.
  const mobile = useMediaQuery(MOBILE);

  if (projects.length === 0) {
    return (
      <div className="empty">
        <p className="empty__title">Объектов пока нет</p>
        <p className="empty__text">
          {role === "FOREMAN"
            ? "Вас не назначили прорабом ни на один объект."
            : "Заведите первый объект, чтобы импортировать смету."}
        </p>
      </div>
    );
  }

  const shown = filter === null ? projects : projects.filter((p) => p.status === filter);
  const present = STATUS_ORDER.filter((status) => projects.some((p) => p.status === status));

  return (
    <div className="stack">
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
      ) : mobile ? (
        <div className="stack">
          {shown.map((project) => (
            <ProjectCardRow key={project.id} project={project} today={today} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <div className="panel panel--flush">
          <div className="table-scroll">
            <table className="estimate">
              <thead>
                <tr>
                  <th>Код</th>
                  <th>Адрес</th>
                  <th>Заказчик</th>
                  <th>Статус</th>
                  <th>Прораб</th>
                  <th>Срок</th>
                  <th className="estimate__num">Итог сметы</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <span className="code-badge">{project.code}</span>
                    </td>
                    <td>
                      {/* Ссылка, а не строка с обработчиком: объект открывается
                          и клавиатурой, и в новой вкладке средствами браузера. */}
                      <a
                        href={`#${project.code}`}
                        onClick={(event) => {
                          event.preventDefault();
                          onOpen(project);
                        }}
                      >
                        {project.address}
                      </a>
                    </td>
                    <td className="t-sm">[{project.client.code}] {project.client.name}</td>
                    <td>
                      <span className={STATUS_PILL[project.status]}>{STATUS_LABEL[project.status]}</span>
                    </td>
                    <td>{project.foreman?.name ?? "—"}</td>
                    <td>{deadlineCell(project.deadline, today)}</td>
                    <td className="estimate__num">
                      {project.estimateTotal === null ? (
                        <span className="t-muted">сметы нет</span>
                      ) : (
                        <>
                          {money(project.estimateTotal)}
                          <span className="t-sm t-muted"> · {project.positions} поз.</span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
