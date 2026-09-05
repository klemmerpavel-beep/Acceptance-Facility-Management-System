import type { ProjectSummary } from "@priyomka/contracts";
import { formatKopecks } from "@priyomka/ui";
import { DataTable, type Column } from "./DataTable.js";
import { STATUS_LABEL, STATUS_PILL, formatDate, plural } from "./status.js";

/**
 * Объекты таблицей — один набор колонок на главную и на раздел «Проекты».
 *
 * Общий, а не два похожих: колонка, добавленная в одном месте и забытая в
 * другом, — это два разных ответа на один вопрос, и человек не знает,
 * какому верить. Разделяются экраны не составом колонок, а тем, что вокруг:
 * на главной таблица идёт третьим блоком, в разделе — с фильтром статуса.
 */

const money = (value: string): string => formatKopecks(BigInt(value));

/** Срок объекта в человеческом виде: просрочка называется просрочкой. */
export function deadlineCell(deadline: string | null, today: string): React.JSX.Element {
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
 * Готовность объекта.
 *
 * «Не задано» и «0 %» — разные утверждения, и колонка их различает: первое
 * означает, что графика нет, второе — что работа по нему не начата. Процент
 * округляется до целого: сотые доли в столбце из двадцати строк не читают,
 * а точное значение живёт в домене и уходит в расчёты.
 */
export function readinessCell(readiness: number | null): React.JSX.Element {
  if (readiness === null) return <span className="t-muted">не задано</span>;
  return <>{Math.round(readiness / 100)} %</>;
}

/**
 * Колонки объекта. Сортируется каждая (норматив 5.14): срок — по дате, а не
 * по её показному виду, итог сметы — по копейкам, а не по строке с
 * разрядами. Отсутствующее значение сортировкой уходит вниз.
 */
export function projectColumns(
  today: string,
  onOpen: (project: ProjectSummary) => void,
  shown: readonly ProjectSummary[],
): readonly Column<ProjectSummary>[] {
  /* Колонка, пустая во всей выборке, места не занимает: «Прораб» стоял
     прочерком в шести строках из восьми, «Итог сметы» — «сметы нет» в семи
     из восьми, и вдвоём они держали 15 % ширины (реестр Д-15). */
  const anyForeman = shown.some((project) => project.foreman !== null);
  const anyEstimate = shown.some((project) => project.estimateTotal !== null);
  const columns: Column<ProjectSummary>[] = [
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
      // Ищется и по коду, показывается именем: код заказчика — служебная
      // величина справочника, в списке объектов её читать не нужно.
      value: (project) => `${project.client.name} ${project.client.code}`,
      render: (project) => project.client.name,
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
      key: "readiness",
      label: "Готовность",
      value: (project) => project.readiness,
      render: (project) => readinessCell(project.readiness),
      numeric: true,
    },
    {
      key: "deadline",
      label: "Срок",
      value: (project) => project.deadline,
      render: (project) => deadlineCell(project.deadline, today),
    },
  ];

  if (anyForeman) {
    columns.push({
      key: "foreman",
      label: "Прораб",
      value: (project) => project.foreman?.name ?? null,
      render: (project) => project.foreman?.name ?? "—",
    });
  }
  if (anyEstimate) {
    columns.push({
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
    });
  }
  return columns;
}

/**
 * Таблица объектов главной.
 *
 * Постраничная выдача, поиск и сортировка — из `DataTable`, того же
 * движка, на котором стоят все реестры продукта. На сотне объектов на
 * экран приходит одна страница, а не сотня строк: обещание про две секунды
 * держится тем, что лишнее не рисуется, а не тем, что данных мало.
 */
export function ProjectTable({
  projects,
  today,
  limit,
  onOpen,
  onAll,
}: {
  projects: ProjectSummary[];
  today: string;
  limit: number;
  onOpen: (project: ProjectSummary) => void;
  onAll: () => void;
}): React.JSX.Element {
  const shown = projects.slice(0, limit);
  const rest = projects.length - shown.length;

  return (
    <>
      <DataTable
        rows={shown}
        columns={projectColumns(today, onOpen, shown)}
        rowKey={(project) => project.id}
        searchLabel="Поиск по коду, адресу и заказчику"
        emptyTitle="Объектов нет"
        emptyText="Заведите первый объект — с него начинается всё остальное."
      />
      {rest > 0 && (
        <p className="t-sm t-muted">
          Показаны первые {limit} объектов портфеля.{" "}
          <a
            href="#projects"
            onClick={(event) => { event.preventDefault(); onAll(); }}
          >
            Открыть все {projects.length}
          </a>
        </p>
      )}
    </>
  );
}
