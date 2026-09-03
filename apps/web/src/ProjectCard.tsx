import { useEffect, useState } from "react";
import type {
  CurrentUser, EstimateView, ImportRecord, ProjectEvent, ProjectStatus, ProjectSummary,
} from "@priyomka/contracts";
import { daysBetween, workingDaysBetween } from "@priyomka/domain";
import { formatKopecks, formatPercent } from "@priyomka/ui";
import { fetchEstimate, fetchEvents, fetchImports, setProjectStatus } from "./api.js";
import { EstimateTable } from "./EstimateTable.js";
import { EventFeed } from "./Dashboard.js";
import { ImportEstimate } from "./ImportEstimate.js";
import { StatusSheet } from "./StatusSheet.js";
import { STATUS_LABEL, STATUS_PILL, formatDate, plural } from "./status.js";

const money = (value: string): string => formatKopecks(BigInt(value));

/** Кольцо готовности. Считается по сумме принятых позиций к итогу сметы. */
/**
 * Шкала готовности: размеченная линейка с делениями по четвертям.
 *
 * Не кольцо. Кольцевая диаграмма из одного значения ничего не показывает
 * сверх напечатанной внутри неё доли, зато выглядит как инфографика.
 * Линейка с делениями читается как измерение — тем же движением, каким
 * читают рулетку, и это язык предметной области продукта.
 */
function ReadinessScale({ share }: { share: number }): React.JSX.Element {
  return (
    <div className="scale scale--on-accent">
      <div
        className="scale__track"
        role="img"
        aria-label={`Принято ${share} процентов итога сметы`}
      >
        <span className="scale__fill" style={{ inlineSize: `${share}%` }} />
        {[25, 50, 75].map((tick) => (
          <span key={tick} className="scale__tick" style={{ insetInlineStart: `${tick}%` }} />
        ))}
      </div>
      <p className="scale__legend">
        <span>принято</span>
        <span className="scale__value">{share} %</span>
      </p>
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
/**
 * Вкладки карточки. Здесь то, что работает: обзор, смета и служебный
 * импорт руководителю. Остальные вкладки целевого состава — замер, работа,
 * отчёт, приёмка, чеки, документы — перечислены в «Что дальше»: шесть
 * заглушек подряд не сообщают ничего, кроме того, что тыкать бесполезно.
 */
const TABS = [
  { key: "overview", label: "Обзор" },
  { key: "estimate", label: "Смета" },
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
  /* Состав вкладок зависит от роли: импорт доступен только руководителю.
     Список нужен целиком, чтобы стрелки переводили выбор по нему. */
  const tabList = user.role === "OWNER"
    ? [...TABS, { key: "import" as const, label: "Импорт" }]
    : [...TABS];

  const onTabKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = tabList.findIndex((item) => item.key === tab);
    const next = tabList[(index + step + tabList.length) % tabList.length];
    if (next === undefined) return;
    setTab(next.key);
    document.getElementById(`tab-${next.key}`)?.focus();
  };

  const deadline =
    project.deadline === null
      ? null
      : { date: formatDate(project.deadline), days: daysBetween(today, project.deadline) };
  const overdue = deadline !== null && deadline.days < 0;

  return (
    <>
      {/* Штамп объекта. Те же сведения, что несла цветная обложка, но
          набранные как штамп рабочего чертежа: графа, подпись, значение. */}
      <div className="container">
        <p className="stamp__crumbs">
          <a href="#" onClick={(event) => { event.preventDefault(); onBack(); }}>Объекты</a>
          <svg className="icon icon--sm" aria-hidden="true"><use href="#i-crumb" /></svg>
          <span>{project.code}</span>
        </p>
        <div className="stamp">
          <div className="stamp__cell">
            <span className="t-cap">Объект</span>
            <span className="stamp__value stamp__value--code">{project.code}</span>
          </div>
          <div className="stamp__cell stamp__cell--wide">
            <span className="t-cap">Адрес</span>
            <span className="stamp__value" title={project.address}>{project.address}</span>
          </div>
          <div className="stamp__cell">
            <span className="t-cap">Стадия</span>
            <span className="stamp__value">{STATUS_LABEL[project.status]}</span>
          </div>
          <div className="stamp__cell">
            <span className="t-cap">Срок</span>
            <span className={overdue ? "stamp__value stamp__value--code stamp__value--late" : "stamp__value stamp__value--code"}>
              {deadline === null ? "не задан" : deadline.date}
            </span>
          </div>
          <div className="stamp__cell">
            <span className="t-cap">Прораб</span>
            <span className="stamp__value">{project.foreman?.name ?? "не назначен"}</span>
          </div>
          <div className="stamp__cell">
            <span className="t-cap">Смета</span>
            <span className="stamp__value stamp__value--code">
              {project.estimateVersion === null ? "нет" : `ред. ${project.estimateVersion}`}
            </span>
          </div>
        </div>
      </div>

      <main className="container">
        <div className="project-layout">
          <aside className="stack">
            <div className="figure">
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

            {/* Стадию называет штамп; здесь она стоит только как текущее
                значение при органе управления. У прораба органа нет —
                нет и строки. Почтовый адрес для чеков снят: приёма писем
                на сервере ещё нет, а адрес на экране обещает работу. */}
            {user.role === "OWNER" && (
              <div className="row row--between summary__status">
                <span className={STATUS_PILL[project.status]}>{STATUS_LABEL[project.status]}</span>
                <button type="button" className="btn btn--text" onClick={() => setStatusOpen(true)}>
                  Изменить статус
                </button>
              </div>
            )}

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
                    : plural(deadline.days, "день", "дня", "дней")}
                </span>
              </div>
              {project.readiness > 0 && <ReadinessScale share={project.readiness / 100} />}
            </div>

            <dl className="deflist">
              <p className="deflist__head">Информация</p>
              <div className="deflist__row">
                <dt className="deflist__term">Заказчик</dt>
                <dd className="deflist__value">{project.client.name}</dd>
              </div>
              <div className="deflist__row">
                <dt className="deflist__term">Реквизиты заказчика</dt>
                <dd className="deflist__value">
                  {project.client.requisites ?? (project.client.isCompany ? "Юридическое лицо" : "Физическое лицо")}
                </dd>
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
                <dt className="deflist__term">Позиций в смете</dt>
                <dd className="deflist__value">
                  {project.estimateVersion === null ? "сметы нет" : project.positions}
                </dd>
              </div>
              <div className="deflist__row">
                <dt className="deflist__term">Сопровождение</dt>
                <dd className="deflist__value">{formatPercent(BigInt(project.supervisionShare))}</dd>
              </div>
            </dl>
          </aside>

          <div className="stack stack--loose">
            {/* Шаблон вкладок целиком: вкладка связана с панелью, панель
                названа вкладкой, стрелки переводят выбор, а Tab уводит из
                полосы вкладок в её содержимое (реестр Д-11). */}
            <div className="tabs" role="tablist" onKeyDown={onTabKey}>
              {tabList.map((item) => (
                <button
                  key={item.key}
                  id={`tab-${item.key}`}
                  type="button"
                  className="tabs__item"
                  role="tab"
                  aria-selected={tab === item.key}
                  aria-controls={`panel-${item.key}`}
                  tabIndex={tab === item.key ? 0 : -1}
                  onClick={() => setTab(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" hidden={tab !== "overview"}>
              {tab === "overview" && (
              <Overview
                project={project}
                estimate={estimate}
                events={events}
                today={today}
              />
              )}
            </div>

            <div role="tabpanel" id="panel-estimate" aria-labelledby="tab-estimate" hidden={tab !== "estimate"}>
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
            </div>

            <div role="tabpanel" id="panel-import" aria-labelledby="tab-import" hidden={tab !== "import"}>
              {tab === "import" && <ImportEstimate code={project.code} units={units} onImported={load} />}
            </div>
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

/** Вкладка «Обзор»: сроки, состав сметы и события объекта. */
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
          <h2 className="t-h2">Сроки объекта</h2>
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
              <>
                <span className="metric">
                  <span className="metric__value">{passed.working}</span>
                  <span className="metric__label">Рабочих дней прошло</span>
                </span>
                <span className="metric">
                  <span className="metric__value">{passed.calendar}</span>
                  <span className="metric__label">Календарных прошло</span>
                </span>
              </>
            )}
            {contract !== null && (
              <span className="metric">
                <span className="metric__value">{contract.calendar}</span>
                <span className="metric__label">Календарных по договору</span>
              </span>
            )}
            {estimate !== null && (
              <span className="metric">
                <span className="metric__value">{estimate.positions}</span>
                <span className="metric__label">Позиций в смете</span>
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
          <h2 className="t-h2">События объекта</h2>
        </div>
        {events.length === 0 ? (
          <div className="empty">
            <p className="empty__title">Событий нет</p>
            <p className="empty__text">Импорт сметы и смена статуса попадают сюда.</p>
          </div>
        ) : (
          <EventFeed events={events} showCode={false} />
        )}
      </section>
    </div>
  );
}
