import { useEffect, useState } from "react";
import type { Dashboard as DashboardData, ProjectEvent, ProjectStatus } from "@priyomka/contracts";
import { formatKopecks } from "@priyomka/ui";
import { fetchDashboard, errorMessage } from "./api.js";
import { STATUS_LABEL, formatDay, formatTime, plural } from "./status.js";

const money = (value: string): string => formatKopecks(BigInt(value));

const WEEKDAY = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];

/**
 * Величина ряда сводки: подпись, число, вторая величина под ним.
 *
 * Не карточка. Четыре одинаковые рамки на первом экране уравнивают величины
 * в весе, и главную приходится искать. Здесь числа лежат на полотне,
 * разделяются волосяной линией, а ведущая величина крупнее прочих.
 */
function SummaryFigure({
  label,
  value,
  caption,
  second,
  lead,
}: {
  label: string;
  value: string;
  caption: string;
  second: { value: string; caption: string; tone?: "danger" };
  lead?: boolean;
}): React.JSX.Element {
  return (
    <div className={lead === true ? "figure figrow__lead" : "figure"}>
      <span className="figure__label">{label}</span>
      <span className="figure__value">{value}</span>
      <span className="figure__note">{caption}</span>
      <span className="figrow__second">
        <span className={second.tone === "danger" ? "num num--start num--danger" : "num num--start"}>
          {second.value}
        </span>
        <span className="figure__note">{second.caption}</span>
      </span>
    </div>
  );
}

/**
 * Классы пишутся целиком, а не собираются шаблоном из кусков: собранный
 * класс не находится поиском по разметке, и механическая проверка мёртвых
 * правил дизайн-системы становится слепой.
 */
const COUNTER_CLASS = {
  plain: "counterstrip__count",
  danger: "counterstrip__count counterstrip__count--danger",
} as const;

const EVENT_CLASS = {
  neutral: "daycard__event",
  ok: "daycard__event daycard__event--ok",
  warn: "daycard__event daycard__event--warn",
  danger: "daycard__event daycard__event--danger",
} as const;

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

export function Dashboard({
  onOpenProjects,
}: {
  onOpenProjects: (status: ProjectStatus | null) => void;
}): React.JSX.Element {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchDashboard()
      .then((result) => { setData(result); setError(null); })
      .catch((cause: unknown) => setError(errorMessage(cause)));
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

  if (data === null) {
    return (
      <main className="container stack" aria-busy="true">
        <span className="skeleton skeleton--row" />
        <span className="skeleton skeleton--row" />
        <span className="skeleton skeleton--row" />
      </main>
    );
  }

  const discrepancy = BigInt(data.estimate.discrepancy);

  return (
    <main className="container stack stack--loose">
      <section className="figrow">
        <SummaryFigure
          lead
          label="Портфель"
          value={money(data.money.estimate)}
          caption="итог смет для клиентов"
          second={{ value: money(data.money.supervision), caption: "в том числе сопровождение" }}
        />
        {/* Подпись величины называет число под собой, а не второе рядом:
            иначе крупная сумма читается как расхождение. Ведущее здесь —
            работы, недосчёт импорта идёт второй величиной. */}
        <SummaryFigure
          label="Работы"
          value={money(data.money.works)}
          caption="без надбавки за сопровождение"
          second={{
            value: money(data.estimate.discrepancy),
            caption:
              discrepancy === 0n
                ? "пересчёт сошёлся с итогом файлов"
                : `недосчёт в файлах · объектов: ${data.estimate.projectsWithDiscrepancy}`,
            ...(discrepancy === 0n ? {} : { tone: "danger" as const }),
          }}
        />
        {/* Фонд оплаты труда приходит только руководителю: у прораба этого
            поля нет в ответе сервера, и величина не рисуется вовсе. */}
        {data.money.wage !== undefined && (
          <SummaryFigure
            label="Фонд оплаты труда"
            value={money(data.money.wage)}
            caption="по действующим сметам"
            second={{
              value: money((BigInt(data.money.works) - BigInt(data.money.wage)).toString()),
              caption: "валовая разница к работам",
            }}
          />
        )}
      </section>

      <section className="stack">
        <div className="section-head">
          <h2 className="t-h2">Неделя</h2>
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

      <section className="split">
        <div className="stack">
          <div className="section-head">
            <h2 className="t-h2">Объекты</h2>
            <button type="button" className="btn btn--text" onClick={() => onOpenProjects(null)}>
              Все объекты
            </button>
          </div>
          <div className="counterstrip">
            {data.statuses.map((row) => (
              <Counter
                key={row.status}
                value={row.count}
                label={STATUS_LABEL[row.status]}
                onClick={() => onOpenProjects(row.status)}
              />
            ))}
            {data.projects.overdue > 0 && (
              <Counter value={data.projects.overdue} label="Просрочены" tone="danger" />
            )}
            {data.projects.dueSoon > 0 && (
              <Counter value={data.projects.dueSoon} label="Срок ближе двух недель" />
            )}
          </div>
        </div>

        {/* Принятых позиций и актов здесь нет: до стадии D эти величины
            структурно нулевые, а ноль, который не может стать другим
            числом, — украшение. Строка о приёмке живёт в «Что дальше». */}
        <div className="stack">
          <div className="section-head">
            <h2 className="t-h2">Сметы</h2>
            <span className="t-sm t-muted">
              загружено: {data.projects.withEstimate} из {data.projects.total}{" "}
              {plural(data.projects.total, "объекта", "объектов", "объектов")}
            </span>
          </div>
          <div className="counterstrip">
            <Counter value={data.estimate.positions} label="Позиций" />
            <Counter
              value={data.estimate.findings}
              label="Находок в отчётах импорта"
              {...(data.estimate.findings > 0 ? { tone: "danger" as const } : {})}
            />
          </div>
        </div>
      </section>

      <section className="split">
        <div className="stack">
          <div className="section-head">
            <h2 className="t-h2">Ближайшие сроки</h2>
          </div>
          {data.deadlines.length === 0 ? (
            <div className="empty">
              <p className="empty__title">Сроков нет</p>
              <p className="empty__text">Ни у одного действующего объекта не задан дедлайн.</p>
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

        <div className="stack">
          <div className="section-head">
            <h2 className="t-h2">Последние события</h2>
          </div>
          {data.feed.length === 0 ? (
            <div className="empty">
              <p className="empty__title">Событий пока нет</p>
              <p className="empty__text">Импорт сметы и смена статуса объекта попадают сюда.</p>
            </div>
          ) : (
            <EventFeed events={data.feed} />
          )}
        </div>
      </section>
    </main>
  );
}
