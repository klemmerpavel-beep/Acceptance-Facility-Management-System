import { useEffect, useState } from "react";
import type {
  CurrentUser, EstimateView, ImportRecord, ProjectEvent, ProjectStatus, ProjectSummary,
} from "@priyomka/contracts";
import { daysBetween, workingDaysBetween } from "@priyomka/domain";
import { formatKopecks, formatPercent } from "@priyomka/ui";
import { fetchEstimate, fetchEvents, fetchImports, setProjectStatus } from "./api.js";
import { EstimateTable } from "./EstimateTable.js";
import { Planned } from "./Planned.js";
import { ImportEstimate } from "./ImportEstimate.js";
import { StatusSheet } from "./StatusSheet.js";
import { STATUS_LABEL, STATUS_PILL, formatDate, formatDateTime, plural } from "./status.js";

const money = (value: string): string => formatKopecks(BigInt(value));

/** Кольцо готовности. Считается по сумме принятых позиций к итогу сметы. */
function ReadinessRing({ share }: { share: number }): React.JSX.Element {
  const circumference = 2 * Math.PI * 32;
  return (
    <div className="ring ring--on-accent">
      <svg viewBox="0 0 72 72" width="72" height="72" aria-hidden="true">
        <circle className="ring__track" cx="36" cy="36" r="32" fill="none" strokeWidth="8" />
        <circle
          className="ring__arc"
          cx="36" cy="36" r="32" fill="none" strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - share / 100)}
          transform="rotate(-90 36 36)"
        />
      </svg>
      <span className="ring__value">{share} %</span>
    </div>
  );
}

/** Пустое состояние вкладки, которой ещё нет. Этап называется прямо. */
/**
 * Вкладки карточки. Состав и порядок — по карте `docs/07_IA.md`, раздел 4:
 * они повторяют путь работы на объекте, от замера до документов. Названия
 * тоже оттуда: «Работа», а не «График», «Чеки», а не «Расходы»,
 * «Документы», а не «Акты» — в акте документы не исчерпываются.
 */
const TABS = [
  { key: "overview", label: "Обзор" },
  { key: "measure", label: "Замер" },
  { key: "estimate", label: "Смета" },
  { key: "work", label: "Работа" },
  { key: "report", label: "Отчёт" },
  { key: "acceptance", label: "Приёмка" },
  { key: "checks", label: "Чеки" },
  { key: "documents", label: "Документы" },
] as const;

type Tab = (typeof TABS)[number]["key"] | "import";

export function ProjectCard({
  project,
  user,
  units,
  today,
  onBack,
  onChanged,
}: {
  project: ProjectSummary;
  user: CurrentUser;
  units: string[];
  today: string;
  onBack: () => void;
  onChanged: (project: ProjectSummary) => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("overview");
  const [estimate, setEstimate] = useState<EstimateView | null>(null);
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [events, setEvents] = useState<ProjectEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  const load = (): void => {
    setLoading(true);
    void fetchEvents(project.code).then(setEvents).catch(() => setEvents([]));
    void fetchEstimate(project.code)
      .then(async (view) => {
        setEstimate(view);
        setImports(await fetchImports(project.code));
        setError(null);
      })
      .catch((cause: Error) => {
        setEstimate(null);
        setError(cause.message);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [project.code]);

  const chooseStatus = (status: ProjectStatus): void => {
    setStatusBusy(true);
    void setProjectStatus(project.code, status)
      .then((updated) => {
        onChanged(updated);
        setStatusOpen(false);
        load();
      })
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setStatusBusy(false));
  };

  /**
   * Срок объекта. Дедлайн в прошлом — обычное дело на ремонте, и подпись
   * должна называть это просрочкой, а не «осталось минус восемнадцать дней».
   */
  const deadline =
    project.deadline === null
      ? null
      : { date: formatDate(project.deadline), days: daysBetween(today, project.deadline) };
  const overdue = deadline !== null && deadline.days < 0;

  return (
    <>
      <div className="cover">
        <div className="container">
          <p className="cover__crumbs">
            <a href="#" onClick={(event) => { event.preventDefault(); onBack(); }}>Объекты</a>
            <svg className="icon icon--sm" aria-hidden="true"><use href="#i-crumb" /></svg>
            <span>{project.address}</span>
          </p>
          <div className="cover__title">
            <span className="code-badge code-badge--lg">{project.code}</span>
            <h1 className="t-h1">{project.address}</h1>
          </div>
        </div>
      </div>

      <main className="container">
        <div className="project-layout">
          <aside className="stack">
            <div className="figure figure--framed">
              <span className="figure__label">Итог сметы для клиента</span>
              <span className="figure__value">
                {project.estimateTotal === null ? "—" : money(project.estimateTotal)}
              </span>
              <span className="figure__note">
                {estimate === null
                  ? "смета не загружена"
                  : `включая сопровождение объекта ${formatPercent(BigInt(estimate.totals.supervisionShare))} — ${money(estimate.totals.supervision)}`}
              </span>
            </div>

            <div className="panel panel--pad row row--between">
              <span className={STATUS_PILL[project.status]}>{STATUS_LABEL[project.status]}</span>
              {user.role === "OWNER" && (
                <button type="button" className="btn btn--text" onClick={() => setStatusOpen(true)}>
                  Изменить статус
                </button>
              )}
            </div>

            <div className="tile stack stack--tight">
              <span className="figure__label">Чеки на материалы</span>
              <p className="mail-gateway">
                checks+<span className="code-badge">{project.code.replace("-", "")}</span>@dolgiy.studio
              </p>
              <p className="t-sm t-muted">Код объекта ищется и в теме письма. Письмо без кода не теряется.</p>
            </div>

            <div className="tile tile--accent row row--between">
              <div className="figure">
                <span className="figure__label">
                  {deadline === null ? "Срок" : overdue ? "Просрочено на" : "Осталось"}
                </span>
                <span className="figure__value">
                  {deadline === null ? "—" : Math.abs(deadline.days)}
                </span>
                <span className="figure__note">
                  {deadline === null
                    ? "дедлайн не задан"
                    : `${plural(deadline.days, "день", "дня", "дней")} · дедлайн ${deadline.date}`}
                </span>
              </div>
              <ReadinessRing share={project.readiness / 100} />
            </div>

            <dl className="deflist">
              <p className="deflist__head">Информация</p>
              <div className="deflist__row">
                <dt className="deflist__term">Заказчик</dt>
                <dd className="deflist__value">[{project.client.code}] {project.client.name}</dd>
              </div>
              <div className="deflist__row">
                <dt className="deflist__term">Реквизиты заказчика</dt>
                <dd className="deflist__value">
                  {project.client.requisites ?? (project.client.isCompany ? "Юридическое лицо" : "Физическое лицо")}
                </dd>
              </div>
              <div className="deflist__row">
                <dt className="deflist__term">Адрес</dt>
                <dd className="deflist__value">{project.address}</dd>
              </div>
              <div className="deflist__row">
                <dt className="deflist__term">Прораб</dt>
                <dd className="deflist__value">{project.foreman?.name ?? "не назначен"}</dd>
              </div>
              <div className="deflist__row">
                <dt className="deflist__term">Начало работ</dt>
                <dd className="deflist__value">
                  {project.startedAt === null ? "не начаты" : formatDate(project.startedAt)}
                </dd>
              </div>
              <div className="deflist__row">
                <dt className="deflist__term">Ключи</dt>
                <dd className="deflist__value">{project.keysCount} компл.</dd>
              </div>
              <div className="deflist__row">
                <dt className="deflist__term">Сопровождение</dt>
                <dd className="deflist__value">{formatPercent(BigInt(project.supervisionShare))}</dd>
              </div>
              <div className="deflist__row">
                <dt className="deflist__term">Смета</dt>
                <dd className="deflist__value">
                  {project.estimateVersion === null
                    ? "не загружена"
                    : `редакция ${project.estimateVersion} · ${project.positions} поз.`}
                </dd>
              </div>
            </dl>
          </aside>

          <div className="stack stack--loose">
            <div className="tabs" role="tablist">
              {TABS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="tabs__item"
                  role="tab"
                  aria-selected={tab === item.key}
                  onClick={() => setTab(item.key)}
                >
                  {item.label}
                </button>
              ))}
              {user.role === "OWNER" && (
                <button
                  type="button"
                  className="tabs__item"
                  role="tab"
                  aria-selected={tab === "import"}
                  onClick={() => setTab("import")}
                >
                  Импорт
                </button>
              )}
            </div>

            {tab === "overview" && (
              <Overview
                project={project}
                estimate={estimate}
                events={events}
                today={today}
              />
            )}

            {tab === "estimate" && (
              <>
                {/* Скелет показывается, пока показывать нечего. Условие по
                    признаку загрузки давало полосу поверх уже отрисованной
                    таблицы: смета приходит раньше протоколов импорта. */}
                {loading && estimate === null && error === null && (
                  <span className="skeleton skeleton--row" />
                )}
                {error !== null && !loading && (
                  <div className="empty">
                    <p className="empty__title">Сметы пока нет</p>
                    <p className="empty__text">{error}</p>
                    {user.role === "OWNER" && (
                      <button type="button" className="btn btn--primary" onClick={() => setTab("import")}>
                        Импортировать смету
                      </button>
                    )}
                  </div>
                )}
                {estimate !== null && <EstimateTable estimate={estimate} />}
                {estimate !== null && estimate.otherExpenses.length > 0 && (
                  <div className="panel panel--pad stack stack--tight">
                    <p className="figure__label">Прочие расходы · цена без объёма, приёмке не подлежат</p>
                    <hr className="rule" />
                    {estimate.otherExpenses.map((expense) => (
                      <p className="row row--between" key={expense.id}>
                        <span className="t-sm">{expense.name}</span>
                        <span className="num">{money(expense.unitPrice)} / {expense.unit}</span>
                      </p>
                    ))}
                  </div>
                )}
                {imports.length > 0 && (
                  <div className="panel panel--pad stack stack--tight">
                    <p className="figure__label">
                      Отчёт о расхождениях · импорт от {formatDate(imports[0]!.importedAt)}
                    </p>
                    <hr className="rule" />
                    {imports[0]!.report.findings.map((finding, index) => (
                      <p className="row row--between" key={`${finding.kind}-${index}`}>
                        <span className="t-sm">{finding.title}</span>
                        <span className={finding.amount === null ? "num t-muted" : "num num--danger"}>
                          {finding.amount === null ? `строк: ${finding.rows.length}` : money(finding.amount)}
                        </span>
                      </p>
                    ))}
                  </div>
                )}
              </>
            )}

            {tab === "acceptance" && (
              <Planned
                title="Приёмок пока нет"
                stage="этап Э3"
                text={
                  "Здесь прораб отмечает принятые позиции раздела и тем же действием начисляет " +
                  "сдельную оплату по ставке позиции. Экран строится на этапе приёмки; до него " +
                  "показывать список позиций как «принятые» было бы враньём."
                }
              />
            )}
            {tab === "measure" && (
              <Planned
                title="Замера пока нет"
                stage="стадия C.1"
                text={
                  "Интерактивный обмерный план: помещения, площади, периметры, окна и двери. " +
                  "Площади отсюда попадают в смету количествами позиций, а не переписываются руками."
                }
              />
            )}
            {tab === "work" && (
              <Planned
                title="График не составлен"
                stage="стадия C.3"
                text={
                  "Разделы сметы группируются в этапы работ с датами и мастером. Валидатор дат " +
                  "отклоняет несуществующие и вывернутые сроки: в исходном файле заказчика их восемь."
                }
              />
            )}
            {tab === "report" && (
              <Planned
                title="Отчётов пока нет"
                stage="стадия C.4"
                text={
                  "Фотоотчёт по объекту и по этапу. Снимки приёмки попадают сюда сами: " +
                  "прораб фотографирует один раз, а не отдельно для отчёта и отдельно для акта."
                }
              />
            )}
            {tab === "checks" && (
              <Planned
                title="Чеков пока нет"
                stage="этап Э4"
                text={
                  "Чеки на материалы приходят письмом на адрес объекта и попадают сюда черновиками " +
                  "до подтверждения руководителем. Почтовый шлюз указан в левой колонке."
                }
              />
            )}
            {tab === "documents" && (
              <Planned
                title="Документов пока нет"
                stage="этап Э4"
                text={
                  "Акт собирается только из принятых позиций и выгружается в двух видах: " +
                  "клиентском и внутреннем. В клиентском внутренних величин нет по составу документа."
                }
              />
            )}
            {tab === "import" && <ImportEstimate code={project.code} units={units} onImported={load} />}
          </div>
        </div>
      </main>

      {statusOpen && (
        <StatusSheet
          current={project.status}
          busy={statusBusy}
          onChoose={chooseStatus}
          onClose={() => setStatusOpen(false)}
        />
      )}
    </>
  );
}

/** Вкладка «Обзор»: сроки, состав сметы, транши и события объекта. */
function Overview({
  project,
  estimate,
  events,
  today,
}: {
  project: ProjectSummary;
  estimate: EstimateView | null;
  events: ProjectEvent[];
  today: string;
}): React.JSX.Element {
  const started = project.startedAt;
  const contract =
    started !== null && project.deadline !== null
      ? {
          calendar: daysBetween(started, project.deadline),
          working: workingDaysBetween(started, project.deadline),
        }
      : null;
  const passed =
    started !== null
      ? { calendar: daysBetween(started, today), working: workingDaysBetween(started, today) }
      : null;

  return (
    <div className="stack stack--loose">
      <section className="stack">
        <div className="section-head">
          <h2 className="t-h2">График производства работ</h2>
          <span className="t-sm t-muted">
            {started === null ? "работы не начаты" : `начало ${formatDate(started)}`}
          </span>
        </div>
        {contract === null && passed === null ? (
          <div className="empty">
            <p className="empty__title">Сроки не заданы</p>
            <p className="empty__text">
              Укажите дату начала работ и дедлайн — тогда появится счёт рабочих и календарных дней.
            </p>
          </div>
        ) : (
          <div className="row row--wrap">
            {passed !== null && (
              <span className="metric">
                <span className="metric__value">{passed.working} / {passed.calendar}</span>
                <span className="metric__label">Прошло · рабочих / календарных</span>
              </span>
            )}
            {contract !== null && (
              <span className="metric">
                <span className="metric__value">{contract.working} / {contract.calendar}</span>
                <span className="metric__label">По договору · рабочих / календарных</span>
              </span>
            )}
            {estimate !== null && (
              <span className="metric">
                <span className="metric__value">{estimate.positions}</span>
                <span className="metric__label">Позиций к приёмке</span>
              </span>
            )}
          </div>
        )}
      </section>

      <section className="stack">
        <div className="section-head">
          <h2 className="t-h2">Состав сметы</h2>
          {estimate !== null && (
            <span className="t-sm t-muted">
              разделов {estimate.sectionsTopLevel} + {estimate.sectionsNested} вложенных
            </span>
          )}
        </div>
        {estimate === null ? (
          <div className="empty">
            <p className="empty__title">Смета не загружена</p>
            <p className="empty__text">
              Импорт разбирает книгу Excel и показывает отчёт о расхождениях до записи в базу.
            </p>
          </div>
        ) : (
          <dl className="deflist">
            {estimate.sections.map((section) => (
              <div className="deflist__row" key={section.id}>
                <dt className="deflist__term">{section.name}</dt>
                <dd className="deflist__value num">{money(section.subtotal)}</dd>
              </div>
            ))}
            <hr className="rule" />
            <div className="deflist__row">
              <dt className="deflist__term">Итого по работам</dt>
              <dd className="deflist__value num">{money(estimate.totals.works)}</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="stack">
        <div className="section-head">
          <h2 className="t-h2">Транши</h2>
          <span className="pill">этап Э4</span>
        </div>
        <div className="empty">
          <p className="empty__title">Траншей пока нет</p>
          <p className="empty__text prose">
            Транш открывается на сумму аванса и уменьшается по мере приёмки. Остаток считается по
            клиентской сумме с надбавкой сопровождения, перевыработка показывается сигнальным
            цветом, а не ошибкой.
          </p>
        </div>
      </section>

      <section className="stack">
        <div className="section-head">
          <h2 className="t-h2">События объекта</h2>
        </div>
        {events.length === 0 ? (
          <div className="empty">
            <p className="empty__title">Событий нет</p>
            <p className="empty__text">Импорт сметы и смена статуса попадают сюда.</p>
          </div>
        ) : (
          <div className="feed">
            {events.map((event, index) => (
              <div className="feed__item" key={`${event.at}-${index}`}>
                <span className="feed__time">{formatDateTime(event.at)}</span>
                <span>
                  <span className="feed__title">{event.title}</span>
                  {event.detail !== null && <span className="feed__detail"> {event.detail}</span>}
                  {event.actor !== null && <span className="feed__detail"> · {event.actor}</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
