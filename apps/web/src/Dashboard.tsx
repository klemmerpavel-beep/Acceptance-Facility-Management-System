import { useEffect, useState } from "react";
import type {
  Dashboard as DashboardData,
  ProjectEvent,
  ProjectStatus,
  ProjectSummary,
} from "@priyomka/contracts";
import { fetchDashboard, errorMessage } from "./api.js";
import { PlanStrip } from "./PlanStrip.js";
import { ProjectTable } from "./ProjectTable.js";
import { STATUS_LABEL, formatDay, formatTime, plural } from "./status.js";

/**
 * Главная — первый экран при запуске.
 *
 * Единственный пользователь продукта открывает его утром перед выездом на
 * две-три минуты и решает по первому экрану, никуда не кликая.
 *
 * Состав, сверху вниз, в порядке убывания срочности:
 *
 *   1. четыре числа — что горит сегодня;
 *   2. неделя днями с чипами событий — что будет по дням;
 *   3. план работ во времени — где стоит работа;
 *   4. счётчики статусов, ближайшие сроки, последние события;
 *   5. объекты таблицей.
 *
 * Блоки 2 и 4 вернулись решением заказчика от 05.09.2026: экран из трёх
 * блоков отвечал на свой вопрос, но заставлял искать просрочку в таблице,
 * а события — за колоколом. Плотность взята у эталона, порядок — свой.
 *
 * Чего здесь нет и почему
 * -----------------------
 * Плиток объектов с прогрессом нет: таблица под ними показывала бы те же
 * данные вторым способом, и человеку пришлось бы решать, какому из двух
 * представлений верить.
 *
 * Денежных величин портфеля нет. Они по-прежнему считаются и приходят в
 * ответе сводки, но экран отвечает на вопрос о работе, а не о деньгах, и
 * четыре денежных числа наверху сдвинули бы сроки под сгиб.
 */

/** Порог ленты объектов в таблице главной: дальше — раздел «Проекты». */
const TABLE_LIMIT = 25;

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
  note,
  tone,
  onOpen,
}: {
  icon: string;
  label: string;
  value: number;
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

export function EventFeed({
  events,
  showCode = true,
}: {
  events: ProjectEvent[];
  /** В журнале самого объекта код в каждой строке — повтор заголовка страницы. */
  showCode?: boolean;
}): React.JSX.Element {
  const shown = events.slice(0, FEED_LIMIT);
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
                  {showCode && event.projectCode !== null ? `${event.projectCode} · ` : ""}
                  {event.title}
                </span>
                {event.detail !== null && <span className="feed__detail"> {event.detail}</span>}
              </span>
            </div>
          ))}
        </div>
      ))}
      {rest > 0 && (
        <p className="feed__item t-sm t-muted">
          <span className="feed__time" />
          <span>Ещё {rest} {plural(rest, "событие", "события", "событий")} — в журнале объекта</span>
        </p>
      )}
    </div>
  );
}

const WEEKDAY = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];

const EVENT_CLASS = {
  neutral: "daycard__event",
  ok: "daycard__event daycard__event--ok",
  warn: "daycard__event daycard__event--warn",
  danger: "daycard__event daycard__event--danger",
} as const;

const COUNTER_CLASS = {
  plain: "counterstrip__count",
  danger: "counterstrip__count counterstrip__count--danger",
} as const;

/**
 * Строка полосы счётчиков: подпись слева, число справа.
 *
 * Строка, ведущая в отфильтрованный список, — кнопка целиком: число, по
 * которому нельзя перейти, заставляет искать руками то, что система уже
 * посчитала (норматив 07_IA, правило 4).
 */
function Counter({
  value,
  label,
  tone,
  onClick,
}: {
  value: number | string;
  label: string;
  tone?: "danger";
  onClick?: () => void;
}): React.JSX.Element {
  const body = (
    <>
      <span>{label}</span>
      <span className={tone === undefined ? COUNTER_CLASS.plain : COUNTER_CLASS.danger}>{value}</span>
    </>
  );
  if (onClick === undefined) return <div className="counterstrip__item">{body}</div>;
  return (
    <button type="button" className="counterstrip__item" onClick={onClick}>
      {body}
    </button>
  );
}

/** Статусы, при которых объект считается активным: работа по нему идёт или вот-вот пойдёт. */
const ACTIVE: readonly ProjectStatus[] = ["NEW", "IN_PROGRESS", "WAITING_CLIENT"];

export function Dashboard({
  projects,
  today,
  onOpenProjects,
  onOpen,
  onAdd,
}: {
  projects: ProjectSummary[];
  today: string;
  onOpenProjects: (status: ProjectStatus | null) => void;
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
          value={активные}
          note={`всего в портфеле ${String(data.projects.total)}`}
          onOpen={() => { onOpenProjects(null); }}
        />
        <StatCard
          icon="#i-alert"
          label="Просрочены"
          value={data.projects.overdue}
          note={data.projects.overdue === 0 ? "срок не нарушен ни на одном" : "срок сдачи прошёл"}
          {...(data.projects.overdue > 0 ? { tone: "danger" as const } : {})}
        />
        <StatCard
          icon="#i-schedule"
          label="Срок сегодня"
          value={data.projects.dueToday}
          note={data.projects.dueToday === 0 ? "на сегодня сроков нет" : "сдать до конца дня"}
        />
        <StatCard
          icon="#i-calendar"
          label="Срок на неделе"
          value={data.projects.dueWeek}
          note="ближайшие семь дней"
        />
      </section>

      <section className="stack">
        <div className="section-head">
          <h2 className="t-h2">Неделя</h2>
          <p className="t-sm t-muted">сроки и импорт по дням · неделя от понедельника</p>
        </div>
        <div className="weekstrip">
          {data.week.map((day) => {
            const date = new Date(day.date);
            const weekday = WEEKDAY[(date.getUTCDay() + 6) % 7];
            return (
              <div
                className={
                  day.isToday
                    ? "daycard daycard--today"
                    : day.events.length === 0
                      ? "daycard daycard--empty"
                      : "daycard"
                }
                key={day.date}
              >
                <p className="daycard__head">
                  <span className="daycard__date">{day.date.slice(8)}</span>
                  <span className="daycard__weekday">{weekday}</span>
                </p>
                {day.events.map((event, index) => (
                  <span className={EVENT_CLASS[event.tone]} key={`${event.kind}-${index}`}>
                    {event.title}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
        {/* Пустота названа один раз строкой под полосой, а не пять раз
            повторённой фразой в пустых днях: повтор одной и той же подписи
            читается как шум и мешает увидеть день, где событие есть. */}
        {data.week.every((day) => day.events.length === 0) && (
          <p className="t-sm t-muted">На этой неделе событий нет.</p>
        )}
      </section>

      <section className="stack">
        <div className="section-head">
          <h2 className="t-h2">План работ</h2>
          <p className="t-sm t-muted">
            этапы объектов во времени, текущий день отмечен · прогресс заявленный
          </p>
        </div>
        <PlanStrip projects={projects} today={today} onOpen={onOpen} />
      </section>

      <section className="split">
        <div className="stack">
          <div className="section-head">
            <h2 className="t-h2">Объекты по статусам</h2>
          </div>
          <div className="counterstrip">
            {data.statuses.map((row) => (
              <Counter
                key={row.status}
                label={STATUS_LABEL[row.status]}
                value={row.count}
                onClick={() => { onOpenProjects(row.status); }}
              />
            ))}
          </div>
        </div>

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
            <dl className="deflist">
              {data.deadlines.map((row) => (
                <div className="deflist__row" key={row.code}>
                  <dt className="deflist__term">
                    <span className="code-badge">{row.code}</span> {row.address}
                  </dt>
                  <dd className={row.days < 0 ? "deflist__value num--danger" : "deflist__value"}>
                    {row.days < 0
                      ? `просрочен на ${Math.abs(row.days)} ${plural(row.days, "день", "дня", "дней")}`
                      : `${row.days} ${plural(row.days, "день", "дня", "дней")}`}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </section>

      <section className="stack">
        <div className="section-head">
          <h2 className="t-h2">Последние события</h2>
          <p className="t-sm t-muted">смена статуса, импорт сметы, правка обмера</p>
        </div>
        {data.feed.length === 0 ? (
          <div className="empty">
            <p className="empty__title">Событий пока нет</p>
            <p className="empty__text">Здесь появятся смены статуса, импорт смет и правки обмера.</p>
          </div>
        ) : (
          <EventFeed events={data.feed} />
        )}
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
