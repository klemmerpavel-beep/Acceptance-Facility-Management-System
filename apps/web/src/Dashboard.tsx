import { useEffect, useState } from "react";
import type {
  Dashboard as DashboardData,
  ProjectEvent,
  ProjectStatus,
  ProjectSummary,
} from "@priyomka/contracts";
import { formatKopecks } from "@priyomka/ui";
import { fetchDashboard, errorMessage } from "./api.js";
import { ProjectTable } from "./ProjectTable.js";
import { formatDay, formatTime, plural } from "./status.js";
import { dueByDays } from "./due.js";
import { ReadinessChart, StatusBar } from "./HomeCharts.js";

/** Порог ленты объектов в таблице главной: дальше — раздел «Проекты». */
const TABLE_LIMIT = 25;

/**
 * Мера: доля величины к своему пределу одной дорожкой.
 *
 * Форма выбрана по задаче, а не по вкусу: «одно значение к пределу» —
 * это мера, а не диаграмма. Круговая из двух долей на 180 пикселях
 * читается медленнее и занимает вчетверо больше места.
 *
 * Предел нулевой означает, что делить не на что: дорожка остаётся пустой,
 * а не заполняется на сто процентов.
 */
const METER_CLASS = {
  plain: "meter",
  danger: "meter meter--danger",
  quiet: "meter meter--quiet",
} as const;

function Meter({
  value,
  limit,
  tone,
  label,
}: {
  value: number;
  limit: number;
  tone?: "danger" | "quiet";
  label: string;
}): React.JSX.Element {
  const share = limit > 0 ? Math.min(100, Math.max(0, (value / limit) * 100)) : 0;
  // Классы перечислены целиком, а не собираются строкой: проверка мёртвых
  // правил ищет имя в разметке, и собранное имя она не видит.
  const className = METER_CLASS[tone ?? "plain"];
  return (
    <div className={className} role="img" aria-label={label}>
      <span className="meter__fill" style={{ inlineSize: `${share.toFixed(1)}%` }} />
    </div>
  );
}

/**
 * Числовая карточка эталона: линейная иконка, надзаголовок капсом, крупное
 * число, подпись под ним.
 *
 * Число набрано пропорциональными цифрами, а не табличными: `tabular-nums`
 * даёт каждой цифре ширину нуля, и «12» на 28 пикселях выглядит разреженной.
 * Табличные цифры остаются там, где числа стоят столбцом, — в таблице ниже.
 */
function StatCard({
  icon,
  label,
  value,
  limit,
  note,
  tone,
  onOpen,
}: {
  icon: string;
  label: string;
  value: number;
  /** Предел меры: размер портфеля. Число без него отвечает «сколько», но не «много ли». */
  limit: number;
  note: string;
  tone?: "danger";
  onOpen?: () => void;
}): React.JSX.Element {
  const body = (
    <>
      <svg className="icon statcard__icon" aria-hidden="true"><use href={icon} /></svg>
      <span className="statcard__label">{label}</span>
      <span className={`statcard__value${tone === undefined ? "" : " statcard__value--danger"}`}>
        {value}
      </span>
      <div className="statcard__meter">
        <Meter
          value={value}
          limit={limit}
          label={`${String(value)} из ${String(limit)}`}
          {...(tone === undefined ? {} : { tone: "danger" as const })}
        />
      </div>
      <span className="statcard__note">{note}</span>
    </>
  );
  return onOpen === undefined ? (
    <div className="statcard">{body}</div>
  ) : (
    <button type="button" className="statcard statcard--link" onClick={onOpen}>
      {body}
    </button>
  );
}

/**
 * Лента событий: последние восемь, сгруппированные по дню.
 *
 * Без ограничения лента вырастает длиннее всей остальной страницы и
 * состоит из почти одинаковых строк — смена статуса и импорт повторяются
 * десятками. Читают в ней последнее, а не всё; остальное показывает
 * журнал объекта.
 */
const FEED_LIMIT = 8;

/** Сколько записей видно на главной до раскрытия. */
const FEED_PREVIEW = 4;

export function EventFeed({
  events,
  showCode = true,
  preview = false,
}: {
  events: ProjectEvent[];
  /** В журнале самого объекта код в каждой строке — повтор заголовка страницы. */
  showCode?: boolean;
  /**
   * Свёрнутый вид: видны четыре свежие записи, остальные открываются
   * кнопкой. Главная отвечает на вопрос «что нового», а не «что было»:
   * два десятка почти одинаковых строк отодвигают таблицу объектов за
   * сгиб и читаются как шум. Раскрытие идёт на том же экране — уводить за
   * новостями на другую страницу значит терять контекст.
   */
  preview?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  /* Раскрытая лента показывает всё, что пришло: кнопка обещала остальные
     записи, а не следующие четыре. В журнале объекта предел прежний. */
  const предел = preview ? (open ? events.length : FEED_PREVIEW) : FEED_LIMIT;
  const shown = events.slice(0, предел);
  const rest = events.length - shown.length;
  const days: { day: string; rows: ProjectEvent[] }[] = [];
  for (const event of shown) {
    const day = event.at.slice(0, 10);
    const last = days.at(-1);
    if (last?.day === day) last.rows.push(event);
    else days.push({ day, rows: [event] });
  }

  return (
    <div className="feed feed--byday">
      {days.map((group) => (
        <div key={group.day}>
          <p className="feed__day">{formatDay(group.day)}</p>
          {group.rows.map((event, index) => (
            <div className="feed__item" key={`${event.at}-${index}`}>
              <span className="feed__time">{formatTime(event.at)}</span>
              <span>
                <span className="feed__title">
                  <svg className={FEED_MARK[event.kind].className} aria-hidden="true">
                    <use href={FEED_MARK[event.kind].icon} />
                  </svg>
                  {showCode && event.projectCode !== null ? `${event.projectCode} · ` : ""}
                  {event.title}
                </span>
                {event.detail !== null && <span className="feed__detail"> {event.detail}</span>}
              </span>
            </div>
          ))}
        </div>
      ))}
      {preview && !open && rest > 0 && (
        /* Кнопка называет число: «показать ещё» не говорит, сколько за ней,
           и человек жмёт вслепую. */
        <button
          type="button"
          className="btn btn--text btn--block"
          aria-expanded={false}
          onClick={() => { setOpen(true); }}
        >
          Показать ещё {rest} {plural(rest, "событие", "события", "событий")}
        </button>
      )}
      {!preview && rest > 0 && (
        <p className="feed__item t-sm t-muted">
          <span className="feed__time" />
          <span>Ещё {rest} {plural(rest, "событие", "события", "событий")} — в журнале объекта</span>
        </p>
      )}
      {preview && open && (
        <p className="feed__item t-sm t-muted">
          <span className="feed__time" />
          <span>Раньше этого — в журнале объекта.</span>
        </p>
      )}
    </div>
  );
}

/**
 * Вид события значком. Диаграммы здесь нет намеренно: сводка отдаёт восемь
 * последних записей, и распределение по дням, построенное на восьми, врёт
 * о том, когда шла работа. Значок различает вид, ничего не выдумывая.
 */
const FEED_MARK: Record<ProjectEvent["kind"], { icon: string; className: string }> = {
  status: { icon: "#i-badge", className: "icon icon--sm feed__mark feed__mark--status" },
  import: { icon: "#i-estimate", className: "icon icon--sm feed__mark feed__mark--import" },
  field: { icon: "#i-document", className: "icon icon--sm feed__mark" },
};

const SCORE_CLASS = {
  plain: "score",
  danger: "score score--danger",
} as const;

/**
 * Плитка счётчика: крупное число и подпись под ним.
 *
 * Пришла на смену полосе с долей (решение заказчика от 11.09.2026: главная
 * перегружена диаграммами). Полоса отвечала на вопрос «много ли это
 * относительно соседей» — вопрос второго порядка, который на первом экране
 * никто не задаёт. Спрашивают «сколько», и ответ на него — число, а число
 * читается быстрее любой дорожки.
 *
 * Плитка — кнопка целиком: число, по которому нельзя перейти, заставляет
 * искать руками то, что система уже посчитала (норматив 07_IA, правило 4).
 */
function Score({
  value,
  label,
  note,
  tone,
  onClick,
}: {
  value: number | string;
  label: string;
  /** Подпись под числом: что это за величина на деле. Необязательна. */
  note?: string;
  tone?: "danger";
  onClick?: () => void;
}): React.JSX.Element {
  const body = (
    <>
      <span className={tone === undefined ? "score__value" : "score__value score__value--danger"}>
        {value}
      </span>
      <span className="score__label">{label}</span>
      {note !== undefined && <span className="score__note">{note}</span>}
    </>
  );
  if (onClick === undefined) return <div className={SCORE_CLASS[tone ?? "plain"]}>{body}</div>;
  return (
    <button type="button" className={SCORE_CLASS[tone ?? "plain"]} onClick={onClick}>
      {body}
    </button>
  );
}

/**
 * Срок словами и пилюлей срочности.
 *
 * Число дней само по себе не говорит, что делать: «34» и «−27» человек
 * сравнивает в уме. Слово называет положение, цвет — срочность: красный
 * значит «срок прошёл», жёлтый — «на этой неделе», обычный — «дальше».
 * Три состояния, а не шкала: шкала мерила бы, насколько один объект
 * просрочен сильнее другого, а распоряжаются не этим.
 */
/** Статусы, при которых объект считается активным: работа по нему идёт или вот-вот пойдёт. */
const ACTIVE: readonly ProjectStatus[] = ["NEW", "IN_PROGRESS", "WAITING_CLIENT"];

export function Dashboard({
  projects,
  today,
  onOpenProjects,
  onOpenLeads,
  onOpen,
  onAdd,
}: {
  projects: ProjectSummary[];
  today: string;
  onOpenProjects: (status: ProjectStatus | null) => void;
  onOpenLeads: () => void;
  onOpen: (project: ProjectSummary) => void;
  onAdd: () => void;
}): React.JSX.Element {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchDashboard()
      .then(setData)
      .catch((cause: unknown) => { setError(errorMessage(cause)); });
  }, []);

  if (error !== null) {
    return (
      <main className="container">
        <div className="empty">
          <p className="empty__title">Сводка недоступна</p>
          <p className="empty__text">{error}</p>
        </div>
      </main>
    );
  }

  /**
   * Загрузка показывает форму того, что придёт: четыре плашки карточек и
   * три полосы под ними. Скелет в форме будущей разметки не даёт экрану
   * дёрнуться, когда данные приедут.
   */
  if (data === null) {
    return (
      <main className="container stack stack--loose" aria-busy="true">
        <div className="statrow">
          {[0, 1, 2, 3].map((index) => (
            <span className="skeleton skeleton--card" key={index} />
          ))}
        </div>
        <span className="skeleton skeleton--row" />
        <span className="skeleton skeleton--row" />
        <span className="skeleton skeleton--row" />
      </main>
    );
  }

  /**
   * Портфеля нет вовсе. Экран называет работу, а не показывает четыре нуля:
   * ряд нулей в карточках читается как поломка, а не как пустота.
   */
  if (data.projects.total === 0) {
    return (
      <main className="container">
        <div className="empty">
          <p className="empty__title">Объектов пока нет</p>
          <p className="empty__text">
            Заведите первый объект — и здесь появятся сроки, план работ во времени и то,
            что требует внимания сегодня.
          </p>
          <button type="button" className="btn btn--primary" onClick={onAdd}>
            <svg className="icon" aria-hidden="true"><use href="#i-plus" /></svg>
            Добавить объект
          </button>
        </div>
      </main>
    );
  }

  const активные = data.statuses
    .filter((row) => ACTIVE.includes(row.status))
    .reduce((total, row) => total + row.count, 0);

  return (
    <main className="container stack stack--loose">
      <section className="statrow">
        <StatCard
          icon="#i-object"
          label="Активные объекты"
          limit={data.projects.total}
          value={активные}
          note={`всего в портфеле ${String(data.projects.total)}`}
          onOpen={() => { onOpenProjects(null); }}
        />
        <StatCard
          icon="#i-alert"
          label="Просрочены"
          limit={data.projects.total}
          value={data.projects.overdue}
          note={data.projects.overdue === 0 ? "срок не нарушен ни на одном" : "срок сдачи прошёл"}
          {...(data.projects.overdue > 0 ? { tone: "danger" as const } : {})}
        />
        <StatCard
          icon="#i-schedule"
          label="Срок сегодня"
          limit={data.projects.total}
          value={data.projects.dueToday}
          note={data.projects.dueToday === 0 ? "на сегодня сроков нет" : "сдать до конца дня"}
        />
        <StatCard
          icon="#i-calendar"
          label="Срок на неделе"
          limit={data.projects.total}
          value={data.projects.dueWeek}
          note="ближайшие семь дней"
        />
      </section>

      {/* Два небольших графика сразу под рядом чисел: из чего состоит
          портфель и где какая работа стоит. Оба — срез на сегодня; периода
          в них нет, полоса плана работ снята с главной решением заказчика,
          и возвращать время через заднюю дверь эти блоки не должны. */}
      <section className="split">
        <div className="stack">
          <div className="section-head">
            <h2 className="t-h2">Портфель по статусам</h2>
            <p className="t-sm t-muted">всего {data.projects.total}</p>
          </div>
          <StatusBar statuses={data.statuses} onOpenProjects={onOpenProjects} />
        </div>

        <div className="stack">
          <div className="section-head">
            <h2 className="t-h2">Готовность работ</h2>
            <p className="t-sm t-muted">где отстаёт — сверху</p>
          </div>
          <ReadinessChart
            projects={projects.filter((project) => ACTIVE.includes(project.status))}
            onOpen={onOpen}
            onAll={() => { onOpenProjects(null); }}
          />
        </div>
      </section>

      {/* Воронка на первом экране. Первый экран отвечает на вопрос «что горит
          сегодня», и заявка с просроченной задачей горит сильнее объекта со
          сроком через неделю. Прорабу блок не приходит вовсе — как и сам
          раздел: пустые счётчики сообщали бы «заявок нет» вместо «это не
          ваш контур».

          Стадии стоят цепочкой плиток, а не столбиками долей: воронка —
          это последовательность, и читается она как путь заявки слева
          направо. Доля от наибольшей стадии отвечала на вопрос, которого
          на первом экране не задают. */}
      {data.leads !== undefined && (
        <section className="stack">
          <div className="section-head">
            <h2 className="t-h2">Воронка заявок</h2>
            <p className="t-sm t-muted">
              {data.leads.open} {plural(data.leads.open, "открытая", "открытые", "открытых")}
              {data.leads.quoted > 0 && (
                <>
                  {" · "}
                  {data.leads.quoted} с ориентиром на {formatKopecks(BigInt(data.leads.quotedMid))} по серединам вилок
                </>
              )}
            </p>
          </div>
          <div className="scores scores--chain">
            {data.leads.stages.map((row) => (
              <Score key={row.stage} label={row.label} value={row.count} onClick={onOpenLeads} />
            ))}
          </div>
          {/* Просрочка вынесена из ряда отдельной строкой: это единственное в
              воронке, что требует действия сегодня, а не наблюдения. В ряду
              плиток она читалась бы как ещё одна стадия. */}
          {data.leads.overdueTasks > 0 && (
            <button type="button" className="alertline" onClick={onOpenLeads}>
              <svg className="icon" aria-hidden="true"><use href="#i-alert" /></svg>
              {/* Сказуемое склоняется вместе с числом: «1 задача просрочено»
                  читается как недоделка, а недоделанному продукту не верят
                  и в числах рядом. */}
              <span className="alertline__text">
                {plural(data.leads.overdueTasks, "Просрочена", "Просрочено", "Просрочено")}
                {" "}{data.leads.overdueTasks}
                {" "}{plural(data.leads.overdueTasks, "задача", "задачи", "задач")} по заявкам
              </span>
              <span className="alertline__go">Открыть заявки</span>
            </button>
          )}
        </section>
      )}

      {/* Ближайшие сроки и последние события — два коротких списка в ряд.
          Плитки «Объекты по статусам» сняты: полоса состава портфеля выше
          отвечает на тот же вопрос, а два представления одних чисел
          заставляют выбирать, какому верить. */}
      <section className="split">
        <div className="stack">
          <div className="section-head">
            <h2 className="t-h2">Ближайшие сроки</h2>
          </div>
          {data.deadlines.length === 0 ? (
            <div className="empty">
              <p className="empty__title">Сроков нет</p>
              <p className="empty__text">Ни у одного действующего объекта не задан срок сдачи.</p>
            </div>
          ) : (
            /* Шкала с отрезком влево-вправо от нуля снята: она показывала,
               насколько один объект просрочен сильнее другого, — величину,
               которой никто не распоряжается. Распоряжаются словами «через
               столько-то», и они стоят пилюлей срочности: красная —
               просрочен, жёлтая — на неделе, обычная — дальше. */
            <ul className="duelist">
              {data.deadlines.map((row) => (
                <li className="duelist__row" key={row.code}>
                  {/* Строка ведёт в объект. Объект ищется среди уже
                      загруженных: строка срока, по которой нельзя перейти,
                      заставляет искать его руками в таблице ниже. */}
                  <button
                    type="button"
                    className="duelist__project"
                    onClick={() => {
                      const объект = projects.find((project) => project.code === row.code);
                      if (объект !== undefined) onOpen(объект);
                    }}
                  >
                    <span className="code-badge">{row.code}</span>
                    <span className="duelist__address">{row.address}</span>
                  </button>
                  {/* Слова и ступень срочности выдаёт `due.ts` — одна шкала
                      на реестр, первый экран и карточку. */}
                  <span className={dueByDays(row.days).pill}>{dueByDays(row.days).words}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="stack">
          <div className="section-head">
            <h2 className="t-h2">Последние события</h2>
            <p className="t-sm t-muted">четыре свежих</p>
          </div>
          {data.feed.length === 0 ? (
            <div className="empty">
              <p className="empty__title">Событий пока нет</p>
              <p className="empty__text">Здесь появятся смены статуса, импорт смет и правки обмера.</p>
            </div>
          ) : (
            <EventFeed events={data.feed} preview />
          )}
        </div>
      </section>

      <section className="stack">
        <div className="section-head">
          <h2 className="t-h2">Объекты</h2>
          <button type="button" className="btn btn--primary" onClick={onAdd}>
            <svg className="icon" aria-hidden="true"><use href="#i-plus" /></svg>
            Добавить объект
          </button>
        </div>
        <ProjectTable
          projects={projects}
          today={today}
          limit={TABLE_LIMIT}
          onOpen={onOpen}
          onAll={() => { onOpenProjects(null); }}
        />
      </section>
    </main>
  );
}
