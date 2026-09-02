import { useEffect, useState } from "react";
import type { CurrentUser, Dashboard as DashboardData, ProjectStatus } from "@priyomka/contracts";
import { formatKopecks } from "@priyomka/ui";
import { fetchDashboard } from "./api.js";
import { STATUS_LABEL, formatDateTime, plural } from "./status.js";

const money = (value: string): string => formatKopecks(BigInt(value));

const WEEKDAY = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];

/** Карточка ряда сводки: заголовок и две величины с подписями. */
function SummaryCard({
  label,
  rows,
}: {
  label: string;
  rows: { value: string; caption: string; tone?: "danger" | "ok" }[];
}): React.JSX.Element {
  return (
    <div className="panel panel--pad stack stack--tight">
      <span className="figure__label">{label}</span>
      {rows.map((row) => (
        <div key={row.caption}>
          <p className={row.tone === "danger" ? "num num--start num--danger" : "num num--start"}>
            {row.value}
          </p>
          <p className="t-sm t-muted">{row.caption}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * Классы пишутся целиком, а не собираются шаблоном из кусков: собранный
 * класс не находится поиском по разметке, и механическая проверка мёртвых
 * правил дизайн-системы становится слепой.
 */
const COUNTER_CLASS = { plain: "counter", danger: "counter counter--danger" } as const;

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
  const className = tone === undefined ? COUNTER_CLASS.plain : COUNTER_CLASS.danger;
  const body = (
    <>
      <span className="counter__value">{value}</span>
      <span className="counter__label">{label}</span>
    </>
  );
  if (onClick === undefined) return <div className={className}>{body}</div>;
  return (
    <button type="button" className={className} onClick={onClick}>
      {body}
    </button>
  );
}

export function Dashboard({
  user,
  onOpenProjects,
}: {
  user: CurrentUser;
  onOpenProjects: (status: ProjectStatus | null) => void;
}): React.JSX.Element {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchDashboard()
      .then((result) => { setData(result); setError(null); })
      .catch((cause: Error) => setError(cause.message));
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

  const remaining = BigInt(data.money.estimate) - BigInt(data.money.accepted);

  return (
    <main className="container stack stack--loose">
      <section className="cards">
        <SummaryCard
          label="Портфель"
          rows={[
            { value: money(data.money.estimate), caption: "итог смет для клиентов" },
            { value: money(data.money.supervision), caption: "сопровождение объектов" },
          ]}
        />
        <SummaryCard
          label="Приёмка"
          rows={[
            { value: money(data.money.accepted), caption: "принято по актам" },
            { value: money(remaining.toString()), caption: "остаётся принять" },
          ]}
        />
        <SummaryCard
          label="Расхождения смет"
          rows={[
            { value: money(data.money.works), caption: "пересчёт по позициям" },
            {
              value: money(data.estimate.discrepancy),
              caption: `недосчёт в файлах · объектов: ${data.estimate.projectsWithDiscrepancy}`,
              tone: "danger",
            },
          ]}
        />
        {/* Фонд оплаты труда приходит только руководителю: у прораба этого
            поля нет в ответе сервера, и карточка не рисуется вовсе. */}
        {data.money.wage !== undefined && (
          <SummaryCard
            label="Фонд оплаты труда"
            rows={[
              { value: money(data.money.wage), caption: "по действующим сметам" },
              {
                value: money((BigInt(data.money.works) - BigInt(data.money.wage)).toString()),
                caption: "валовая разница к работам",
              },
            ]}
          />
        )}
      </section>

      <section className="stack">
        <div className="section-head">
          <h2 className="t-h2">Неделя</h2>
          <span className="t-sm t-muted">сроки объектов и импорты смет</span>
        </div>
        <div className="weekstrip">
          {data.week.map((day) => {
            const date = new Date(day.date);
            const weekday = WEEKDAY[(date.getUTCDay() + 6) % 7];
            return (
              <div className={day.isToday ? "daycard daycard--today" : "daycard"} key={day.date}>
                <p className="daycard__head">
                  <span className="daycard__date">{day.date.slice(8)}</span>
                  <span className="daycard__weekday">{weekday}</span>
                </p>
                {day.events.length === 0 ? (
                  <span className="daycard__empty">событий нет</span>
                ) : (
                  day.events.map((event, index) => (
                    <span className={EVENT_CLASS[event.tone]} key={`${event.kind}-${index}`}>
                      {event.title}
                    </span>
                  ))
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="split">
        <div className="stack">
          <div className="section-head">
            <h2 className="t-h2">Объекты</h2>
            <button type="button" className="btn btn--text" onClick={() => onOpenProjects(null)}>
              Все объекты
            </button>
          </div>
          <div className="cards">
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
              <Counter value={data.projects.dueSoon} label="Срок в две недели" />
            )}
          </div>
        </div>

        <div className="stack">
          <div className="section-head">
            <h2 className="t-h2">Сметы и приёмка</h2>
            <span className="t-sm t-muted">
              смет загружено: {data.projects.withEstimate} из {data.projects.total}
            </span>
          </div>
          <div className="cards">
            <Counter value={data.estimate.positions} label="Позиций в сметах" />
            <Counter value={data.estimate.findings} label="Находок в отчётах" tone="danger" />
            <Counter value={data.acceptance.accepted} label="Принято позиций" />
            <Counter value={data.acceptance.acts} label="Актов" />
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
            <span className="t-sm t-muted">{user.organization.name}</span>
          </div>
          {data.feed.length === 0 ? (
            <div className="empty">
              <p className="empty__title">Событий пока нет</p>
              <p className="empty__text">Импорт сметы и смена статуса объекта попадают сюда.</p>
            </div>
          ) : (
            <div className="feed">
              {data.feed.map((event, index) => (
                <div className="feed__item" key={`${event.at}-${index}`}>
                  <span className="feed__time">{formatDateTime(event.at)}</span>
                  <span>
                    <span className="feed__title">
                      {event.projectCode === null ? "" : `${event.projectCode} · `}
                      {event.title}
                    </span>
                    {event.detail !== null && <span className="feed__detail"> {event.detail}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
