import type { ProjectSummary } from "@priyomka/contracts";
import { пусто } from "./empty.js";
import { formatKopecks } from "@priyomka/ui";
import { DataTable, type Column } from "./DataTable.js";
import { STATUS_LABEL, STATUS_PILL, formatDate } from "./status.js";
import { due } from "./due.js";

/**
 * Объекты таблицей — один набор колонок на главную и на раздел «Проекты».
 *
 * Общий, а не два похожих: колонка, добавленная в одном месте и забытая в
 * другом, — это два разных ответа на один вопрос, и человек не знает,
 * какому верить. Разделяются экраны не составом колонок, а тем, что вокруг:
 * на главной таблица идёт третьим блоком, в разделе — с фильтром статуса.
 */

const money = (value: string): string => formatKopecks(BigInt(value));

/**
 * Срок объекта в человеческом виде: дата и словами, сколько до неё.
 *
 * Ступень и слова берутся из общей шкалы срочности (`due.ts`), а не
 * считаются здесь второй формулой: до 12.09.2026 реестр звал срок «34 дня»,
 * первый экран — «через 34 дня», а карточка — «Осталось 34 дня», и три
 * места расходились в словах, порогах и цвете (аудит Б-4).
 */
export function deadlineCell(deadline: string | null, today: string): React.JSX.Element {
  const срок = due(deadline, today);
  if (deadline === null) return <span className="t-muted">{срок.words}</span>;
  return (
    <span className={срок.level === "overdue" ? "num--danger" : undefined}>
      {formatDate(deadline)}
      <span className="t-sm t-muted"> · {срок.words}</span>
    </span>
  );
}

/**
 * Заявленная готовность объекта — та, которую поставил человек.
 *
 * «Не задано» и «0 %» — разные утверждения, и колонка их различает: первое
 * означает, что графика нет, второе — что работа по нему не начата. Процент
 * округляется до целого: сотые доли в столбце из двадцати строк не читают,
 * а точное значение живёт в домене и уходит в расчёты.
 */
export function readinessCell(readiness: number | null): React.JSX.Element {
  if (readiness === null) return <span className="t-muted">{пусто("готовность", "краткое")}</span>;
  return <>{Math.round(readiness / 100)} %</>;
}

/**
 * Принятое по приёмке: доля выполненной суммы в итоге работ.
 *
 * Стоит отдельной колонкой рядом с заявленной, а не вместо неё. Реестр —
 * то место, где расхождение видно по всему портфелю сразу: объект, где
 * заявлено девяносто, а принято три, виден строкой, а не обходом вкладок.
 *
 * «Нет сметы» отличается от нуля: ноль означает «ничего не принято», а это
 * иное утверждение. Перевыработка сигнальным цветом — законное состояние,
 * которое должно быть заметно.
 */
export function acceptedCell(share: number | null): React.JSX.Element {
  if (share === null) return <span className="t-muted">нет сметы</span>;
  /* Начатая работа не округляется до нуля. Столбец показывает целые
     проценты — сотые доли в списке из двадцати строк не читают, — но ноль
     здесь означает «не принято ничего», и объект с первым принятым пакетом
     обязан отличаться от объекта, где не принято ни позиции. */
  if (share > 0 && share < 50) return <>{"<"}&nbsp;1&nbsp;%</>;
  const целых = Math.round(share / 100);
  return share > 10_000
    ? <span className="num--over">{целых}&nbsp;%</span>
    : <>{целых}&nbsp;%</>;
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
  /* Смена статуса прямо из реестра. Обработчик необязателен тем же приёмом,
     что правка позиции в смете: есть — пилюля становится органом, нет —
     колонка ровно та же, что была. Без него путь к смене статуса шёл через
     карточку и стоил на нажатие больше, чем позволяет правило «три касания
     до действия» с запасом (07_IA, правило 3). */
  onStatus?: (project: ProjectSummary) => void,
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
      /* Сортируется подпись, а не орган: с обработчиком и без него колонка
         сортируется одинаково. */
      value: (project) => STATUS_LABEL[project.status],
      render: (project) => (onStatus === undefined ? (
        <span className={STATUS_PILL[project.status]}>{STATUS_LABEL[project.status]}</span>
      ) : (
        <button
          type="button"
          className="pillbutton"
          aria-label={`Статус объекта ${project.code}: ${STATUS_LABEL[project.status]}. Изменить`}
          onClick={() => { onStatus(project); }}
        >
          <span className={STATUS_PILL[project.status]}>{STATUS_LABEL[project.status]}</span>
        </button>
      )),
    },
    /* Две величины двумя колонками, а не одной «готовностью»: их складывает
       разный источник — первую человек, вторую приёмка, — и одна колонка на
       обе заставляла бы читателя гадать, чьё перед ним число. Сортируется
       каждая: «где заявлено больше принятого» — это сортировка по второй. */
    {
      key: "readiness",
      label: "Заявлено",
      value: (project) => project.readiness,
      render: (project) => readinessCell(project.readiness),
      numeric: true,
    },
    {
      key: "accepted",
      label: "Принято",
      value: (project) => project.acceptedShare,
      render: (project) => acceptedCell(project.acceptedShare),
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
          <span className="t-muted">{пусто("смета", "краткое")}</span>
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
        подпись="Объекты портфеля"
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
