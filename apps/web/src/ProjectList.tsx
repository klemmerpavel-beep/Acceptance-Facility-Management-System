import type { ProjectSummary, Role } from "@priyomka/contracts";

const STATUS_LABEL: Record<ProjectSummary["status"], string> = {
  NEW: "Новый",
  IN_PROGRESS: "В работе",
  PAUSED: "Пауза",
  WAITING_CLIENT: "Ждёт ответа",
  DONE: "Завершён",
  ARCHIVED: "Архив",
};

const STATUS_PILL: Record<ProjectSummary["status"], string> = {
  NEW: "pill",
  IN_PROGRESS: "pill pill--ok",
  PAUSED: "pill pill--warn",
  WAITING_CLIENT: "pill pill--warn",
  DONE: "pill pill--ok",
  ARCHIVED: "pill",
};

export function ProjectList({
  projects,
  role,
}: {
  projects: ProjectSummary[];
  role: Role;
}): React.JSX.Element {
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

  return (
    <div className="panel panel--flush">
      <div className="table-scroll">
        <table className="estimate">
          <thead>
            <tr>
              <th>Код</th>
              <th>Адрес</th>
              <th>Статус</th>
              <th>Прораб</th>
              <th>Дедлайн</th>
              <th className="estimate__num">Ключи</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.id}>
                <td>
                  <span className="code-badge">{project.code}</span>
                </td>
                <td>{project.address}</td>
                <td>
                  <span className={STATUS_PILL[project.status]}>{STATUS_LABEL[project.status]}</span>
                </td>
                <td>{project.foreman?.name ?? "—"}</td>
                <td>{project.deadline ?? "не задан"}</td>
                <td className="estimate__num">{project.keysCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
