import { useEffect, useState } from "react";
import type {
  CurrentUser, EstimateItem, EstimateView, ImportRecord, MeasureView,
  ProjectEvent, ProjectStatus, ProjectSummary,
} from "@priyomka/contracts";
import { daysBetween, projectRange, sectionChoices, workingDaysBetween } from "@priyomka/domain";
import { formatKopecks, formatPercent } from "@priyomka/ui";
import {
  fetchEstimate, fetchEvents, fetchImports, fetchMeasure,
  setProjectStatus, updateEstimateItem, updateSupervision, errorMessage,
} from "./api.js";
import { EstimateTable } from "./EstimateTable.js";
import { EventFeed } from "./Dashboard.js";
import { ImportEstimate } from "./ImportEstimate.js";
import { Measure } from "./Measure.js";
import { Schedule } from "./Schedule.js";
import { Acceptance } from "./Acceptance.js";
import { Tranches } from "./Tranches.js";
import { EstimateItemSheet } from "./EstimateItemSheet.js";
import { SupervisionSheet } from "./SupervisionSheet.js";
import { StatusSheet } from "./StatusSheet.js";
import { tabArrowHandler } from "./tabs.js";
import { STATUS_LABEL, STATUS_PILL, formatDate, plural } from "./status.js";

const money = (value: string): string => formatKopecks(BigInt(value));

/**
 * Шкала объекта: принятое и заявленное на одной линейке.
 *
 * Не кольцо. Кольцевая диаграмма из одного значения ничего не показывает
 * сверх напечатанной внутри неё доли, зато выглядит как инфографика.
 * Линейка с делениями читается как измерение — тем же движением, каким
 * читают рулетку, и это язык предметной области продукта.
 *
 * Меряет шкала **принятое**: приёмка — единственный источник факта
 * выполнения (БП-01), и слово «принято» закреплено за ней. Заявленное
 * стоит отметкой на той же линейке, а не вторым заполнением: это не
 * измерение, а утверждение человека, и на измерительной шкале ему место
 * риски, а не полосы. Обе величины сравнимы только потому, что стоят на
 * одной шкале, и расхождение между ними — то, ради чего экран их показывает.
 */
function ReadinessScale({
  accepted,
  declared,
}: {
  /** Сотые доли процента, как их отдаёт сервер. */
  accepted: number | null;
  declared: number | null;
}): React.JSX.Element {
  /* Заполнение подрезается сотней, подпись — нет: перевыработка законна и
     должна быть видна числом, но полоса длиннее линейки сломала бы саму
     меру. Тот же приём, что у заполнения перевыработанного транша. */
  const fill = accepted === null ? 0 : Math.min(accepted / 100, 100);
  const mark = declared === null ? null : Math.min(declared / 100, 100);

  return (
    <div className="scale scale--on-accent">
      <div
        className="scale__track"
        role="img"
        aria-label={accepted === null
          ? "Сметы нет: принятое считать не по чему"
          : `Принято ${formatPercent(BigInt(accepted))} итога работ`}
      >
        <span className="scale__fill" style={{ inlineSize: `${fill}%` }} />
        {[25, 50, 75].map((tick) => (
          <span key={tick} className="scale__tick" style={{ insetInlineStart: `${tick}%` }} />
        ))}
        {mark !== null && (
          <span className="scale__claim" style={{ insetInlineStart: `${mark}%` }} />
        )}
      </div>
      <p className="scale__legend">
        <span>принято</span>
        <span className={accepted !== null && accepted > 10_000
          ? "scale__value scale__value--over"
          : "scale__value"}
        >
          {accepted === null ? "—" : formatPercent(BigInt(accepted))}
        </span>
      </p>
      {/* Заявленного нет — строки нет: график не заведён, и прочерк здесь
          сообщал бы о величине, которой никто не обещал. */}
      {declared !== null && (
        <p className="scale__legend">
          <span>заявлено</span>
          <span className="scale__value">{formatPercent(BigInt(declared))}</span>
        </p>
      )}
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
 * Вкладки карточки. Здесь то, что работает: обзор, замер, смета, работа,
 * приёмка и служебный импорт руководителю. Остальные вкладки целевого
 * состава — отчёт, чеки, документы — перечислены в «Что дальше»: три
 * заглушки подряд не сообщают ничего, кроме того, что тыкать бесполезно.
 *
 * Порядок вкладок повторяет конвейер объекта: замер даёт площади, площади
 * идут в смету, смета — в график работ, график — в приёмку.
 */
const TABS = [
  { key: "overview", label: "Обзор" },
  { key: "measure", label: "Замер" },
  { key: "estimate", label: "Смета" },
  { key: "work", label: "Работа" },
  { key: "acceptance", label: "Приёмка" },
  { key: "tranches", label: "Транши" },
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
  /* Правка сметы. Обмер и справочник единиц грузятся вместе со сметой:
     лист правки подставляет площади обмера в количество позиции, а единицу
     выбирают из канонического набора, а не пишут свободно. */
  const [editing, setEditing] = useState<EstimateItem | null>(null);
  const [supervisionOpen, setSupervisionOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [measure, setMeasure] = useState<MeasureView | null>(null);

  const load = (): void => {
    setLoading(true);
    void fetchEvents(project.code).then(setEvents).catch(() => setEvents([]));
    void fetchMeasure(project.code).then(setMeasure).catch(() => { setMeasure(null); });
    void fetchEstimate(project.code)
      .then(async (view) => {
        setEstimate(view);
        setImports(await fetchImports(project.code));
        setError(null);
      })
      .catch((cause: unknown) => {
        setEstimate(null);
        setError(errorMessage(cause));
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [project.code]);

  /* Сохранение правки. Ответ — вид сметы целиком, и он кладётся как есть:
     собирать новое состояние из частей значило бы завести вторую копию
     правил подсчёта подытогов. Приём тот же, что в обмере и графике. */
  const сохранить = (action: Promise<EstimateView>): void => {
    setEditBusy(true);
    action
      .then((view) => {
        setEstimate(view);
        setEditing(null);
        setSupervisionOpen(false);
        setEditError(null);
        void fetchEvents(project.code).then(setEvents).catch(() => setEvents([]));
      })
      .catch((cause: unknown) => { setEditError(errorMessage(cause)); })
      .finally(() => { setEditBusy(false); });
  };

  const chooseStatus = (status: ProjectStatus): void => {
    setStatusBusy(true);
    void setProjectStatus(project.code, status)
      .then((updated) => {
        onChanged(updated);
        setStatusOpen(false);
        load();
      })
      .catch((cause: unknown) => setError(errorMessage(cause)))
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

  const onTabKey = tabArrowHandler(
    tabList.map((item) => item.key),
    tab,
    setTab,
    (key) => `tab-${key}`,
  );

  /* Последний импорт. Обращение по индексу с утверждением «здесь точно есть»
     заменено проверкой: индекс на пустом списке даёт undefined, и это не
     исключение из правила, а обычный случай — импорта могло не быть. */
  const latestImport = imports[0];

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

            {/* Ориентир, названный на заявке до выезда, — рядом с итогом
                сметы: в этом соседстве весь его смысл. Видно, на сколько
                промахнулись, когда смета готова. Объект заведён руками —
                строки нет: ориентира никто не называл. */}
            {project.guideline !== null && (
              <div className="figure">
                <span className="figure__label">
                  Ориентир по заявке № {project.guideline.leadNumber}
                </span>
                <span className="figure__value figure__value--range">
                  {money(project.guideline.low)} — {money(project.guideline.high)}
                </span>
                <span className="figure__note">
                  {money(project.guideline.rate)} за м² ±
                  {formatPercent(BigInt(project.guideline.spread))}
                  {" · "}
                  {project.guideline.verdict === null
                    ? "сметы ещё нет — сверять не с чем"
                    : project.guideline.verdict.verdict === "внутри"
                      ? "смета внутри вилки"
                      : `смета ${project.guideline.verdict.verdict} вилки на ${money(project.guideline.verdict.delta)}`}
                </span>
              </div>
            )}

            {/* Остаток текущего транша — та величина, ради которой руководитель
                открывает систему вечером (объём полевого испытания, решение
                № 3). Полоса с тремя величинами живёт на своей вкладке: в
                сводке нужен ответ на один вопрос — сколько ещё можно
                выработать. Транша нет — строки нет: ноль означал бы
                «выработан ровно до копейки». */}
            {project.trancheRemainder !== null && (
              <div className="figure">
                <span className="figure__label">Остаток текущего транша</span>
                <span
                  className={
                    BigInt(project.trancheRemainder) < 0n
                      ? "figure__value tranche__over"
                      : "figure__value"
                  }
                >
                  {money(project.trancheRemainder)}
                </span>
                <span className="figure__note">
                  {BigInt(project.trancheRemainder) < 0n
                    ? "перевыработка: пора закрывать транш актом"
                    : "до следующего акта и оплаты"}
                </span>
              </div>
            )}

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
              {/* Шкала показывается, когда есть хоть одна из величин. Прежде
                  условие смотрело только на заявленную, и объект с приёмкой,
                  но без графика не показывал ничего — при том, что принятое
                  как раз и есть то, ради чего продукт заведён. */}
              {(project.acceptedShare !== null || project.readiness !== null) && (
                <ReadinessScale accepted={project.acceptedShare} declared={project.readiness} />
              )}
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

            <div role="tabpanel" id="panel-measure" aria-labelledby="tab-measure" hidden={tab !== "measure"}>
              {tab === "measure" && <Measure code={project.code} address={project.address} role={user.role} onEvents={load} />}
            </div>

            <div role="tabpanel" id="panel-work" aria-labelledby="tab-work" hidden={tab !== "work"}>
              {tab === "work" && (
                <Schedule
                  code={project.code}
                  role={user.role}
                  today={today}
                  range={projectRange(project)}
                  sections={estimate === null ? [] : sectionChoices(estimate.sections)}
                  onEvents={load}
                />
              )}
            </div>

            <div role="tabpanel" id="panel-acceptance" aria-labelledby="tab-acceptance" hidden={tab !== "acceptance"}>
              {tab === "acceptance" && (
                <Acceptance code={project.code} role={user.role} onEvents={load} />
              )}
            </div>

            <div role="tabpanel" id="panel-tranches" aria-labelledby="tab-tranches" hidden={tab !== "tranches"}>
              {tab === "tranches" && (
                <Tranches code={project.code} role={user.role} onEvents={load} />
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
                {estimate !== null && (
                  <EstimateTable
                    estimate={estimate}
                    {...(user.role === "OWNER"
                      ? {
                          onEditItem: (item: EstimateItem) => {
                            setEditing(item);
                            setEditError(null);
                          },
                          onEditSupervision: () => {
                            setSupervisionOpen(true);
                            setEditError(null);
                          },
                        }
                      : {})}
                  />
                )}
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
                {latestImport !== undefined && (
                  <div className="panel panel--pad stack stack--tight">
                    <p className="figure__label">
                      Отчёт о расхождениях · импорт от {formatDate(latestImport.importedAt)}
                    </p>
                    <hr className="rule" />
                    {latestImport.report.findings.map((finding, index) => (
                      <p className="row row--between" key={`${finding.kind}-${index}`}>
                        <span className="t-sm">{finding.title}</span>
                        <span className={finding.amount === null ? "t-sm t-muted" : "num num--danger"}>
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

      {editing !== null && (
        <EstimateItemSheet
          item={editing}
          units={units}
          measure={measure}
          busy={editBusy}
          error={editError}
          onSave={(input) => { сохранить(updateEstimateItem(project.code, editing.id, input)); }}
          onClose={() => { setEditing(null); setEditError(null); }}
        />
      )}

      {supervisionOpen && estimate !== null && (
        <SupervisionSheet
          share={estimate.totals.supervisionShare}
          works={estimate.totals.works}
          busy={editBusy}
          error={editError}
          onSave={(share) => {
            сохранить(updateSupervision(project.code, { supervisionShare: share }));
          }}
          onClose={() => { setSupervisionOpen(false); setEditError(null); }}
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
