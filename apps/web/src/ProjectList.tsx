import type { ProjectStatus, ProjectSummary, Role } from "@priyomka/contracts";
import { formatKopecks } from "@priyomka/ui";
import { DataTable, type Column } from "./DataTable.js";
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
 * Колонки объекта. Сортируется каждая (норматив 5.14): срок — по дате, а не
 * по её показному виду, итог сметы — по копейкам, а не по строке с
 * разрядами. Отсутствующее значение сортировкой уходит вниз.
 */
function projectColumns(today: string, onOpen: (project: ProjectSummary) => void):
  readonly Column<ProjectSummary>[] {
  return [
    {
      key: "code",
      label: "Код",
      value: (project) => project.code,
      render: (project) => <span className="code-badge">{project.code}</span>,
    },
    {
      key: "address",
      label: "Адрес",
      value: (project) => project.address,
      render: (project) => (
        // Ссылка, а не строка с обработчиком: объект открывается и
        // клавиатурой, и в новой вкладке средствами браузера.
        <a
          href={`#${project.code}`}
          onClick={(event) => { event.preventDefault(); onOpen(project); }}
        >
          {project.address}
        </a>
      ),
    },
    {
      key: "client",
      label: "Заказчик",
      value: (project) => `[${project.client.code}] ${project.client.name}`,
    },
    {
      key: "status",
      label: "Статус",
      value: (project) => STATUS_LABEL[project.status],
      render: (project) => (
        <span className={STATUS_PILL[project.status]}>{STATUS_LABEL[project.status]}</span>
      ),
    },
    {
      key: "foreman",
      label: "Прораб",
      value: (project) => project.foreman?.name ?? null,
      render: (project) => project.foreman?.name ?? "—",
    },
    {
      key: "deadline",
      label: "Срок",
      value: (project) => project.deadline,
      render: (project) => deadlineCell(project.deadline, today),
    },
    {
      key: "total",
      label: "Итог сметы",
      value: (project) => (project.estimateTotal === null ? null : BigInt(project.estimateTotal)),
      render: (project) =>
        project.estimateTotal === null ? (
          <span className="t-muted">сметы нет</span>
        ) : (
          <>
            {money(project.estimateTotal)}
            <span className="t-sm t-muted"> · {project.positions} поз.</span>
          </>
        ),
      numeric: true,
    },
  ];
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
      {/* Отсутствующее не называется в каждой карточке: восемь строк
          «прораб не назначен» и «смета не загружена» подряд — это шум,
          из-за которого не видно карточек, где прораб и смета есть. */}
      <p className="t-sm t-secondary">
        [{project.client.code}] {project.client.name}
        {project.foreman !== null && ` · ${project.foreman.name}`}
      </p>
      <p className="row row--between">
        <span className="t-sm">{deadlineCell(project.deadline, today)}</span>
        {project.estimateTotal !== null && (
          <span className="num">{money(project.estimateTotal)}</span>
        )}
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
        <DataTable
          rows={shown}
          columns={projectColumns(today, onOpen)}
          rowKey={(project) => project.id}
          title="Объекты"
          action={
            <span className="t-sm t-muted">
              {shown.length} {plural(shown.length, "объект", "объекта", "объектов")} в выборке
            </span>
          }
          searchLabel="Поиск по коду, адресу и заказчику"
          emptyTitle="Объектов нет"
          emptyText="Заведите первый объект, чтобы импортировать смету."
        />
      )}
    </div>
  );
}
