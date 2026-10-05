import { useEffect, useState } from "react";
import { Пусто, пусто } from "./empty.js";
import type {
  ClosedTranches, CurrentUser, EstimateItem, EstimateSectionNode, EstimateView, ImportRecord, MeasureView,
  ProjectEvent, ProjectFacts, ProjectStatus, ProjectSummary, UpdateProject, Foreman, WorkStage,
} from "@priyomka/contracts";
import { sectionTitle, daysBetween, nextAction, ownerLevel, projectRange, sectionWeights,
  type ШагОбъекта,
  workingDaysBetween, безСметы } from "@priyomka/domain";
import { formatKopecks, formatPercent } from "@priyomka/ui";
import {
  applyBlueprint, createBlueprint, fetchClosedTranches,
  fetchEstimate, fetchEvents, fetchImports, fetchMeasure, moveEstimateItem,
  setProjectStatus, updateEstimateItem, updateSupervision, errorMessage, fetchProject,
  acceptancePhotoUrl, updateProject, fetchForemen, fetchStages, planStages,
  createEstimateItem, removeEstimateItem, createEstimateSection, renameEstimateSection,
  removeEstimateSection, fetchProjectFacts,
} from "./api.js";
import { SectionSheet } from "./SectionSheet.js";
import { PlanSheet } from "./PlanSheet.js";
import { StageList } from "./StageList.js";
import { useNarrow } from "./media.js";
import { FieldEdit } from "./FieldEdit.js";
import { EstimateTable } from "./EstimateTable.js";
import { EventFeed } from "./Dashboard.js";
import { ImportEstimate } from "./ImportEstimate.js";
import { Measure } from "./Measure.js";
import { Schedule } from "./Schedule.js";
import { Acceptance } from "./Acceptance.js";
import { Expenses } from "./Expenses.js";
import { Acts } from "./Acts.js";
import { Report } from "./Report.js";
import { Tranches } from "./Tranches.js";
import { BlueprintSheet } from "./BlueprintSheet.js";
import { EstimateItemSheet } from "./EstimateItemSheet.js";
import { SupervisionSheet } from "./SupervisionSheet.js";
import { StatusSheet } from "./StatusSheet.js";
import { tabArrowHandler } from "./tabs.js";
import type { Вкладка } from "./route.js";
import { STATUS_LABEL, STATUS_PILL, formatDate, plural } from "./status.js";
import { КРУПНАЯ_ОБЛОЖКА } from "./coverTone.js";
import { due, type DueLevel } from "./due.js";

const money = (value: string): string => formatKopecks(BigInt(value));

/** Разделы сметы плоским списком: дерево с уровнем, а не с отступом строкой. */
function разделыСписком(
  узлы: readonly EstimateSectionNode[],
): { id: string; name: string; level: number }[] {
  return узлы.flatMap((узел) => [
    { id: узел.id, name: узел.name, level: узел.level },
    ...разделыСписком(узел.children),
  ]);
}

/** Раздел, в котором стоит позиция. */
function разделПозиции(
  узлы: readonly EstimateSectionNode[],
  itemId: string,
): EstimateSectionNode | null {
  for (const узел of узлы) {
    if (узел.items.some((строка) => строка.id === itemId)) return узел;
    const глубже = разделПозиции(узел.children, itemId);
    if (глубже !== null) return глубже;
  }
  return null;
}

/**
 * Перестановка позиции внутри своего раздела на `шагов` мест.
 *
 * Соседа, за которым встать, считает экран: сервер принимает «встань за
 * этой позицией», а не «сдвинься на два». Шаги — язык жеста, соседство —
 * язык данных, и перевод одного в другое живёт там, где виден порядок.
 */
function переставить(
  estimate: EstimateView,
  code: string,
  item: EstimateItem,
  шагов: number,
  сохранить: (работа: Promise<EstimateView>) => void,
  назватьОшибку: (текст: string | null) => void,
): void {
  const раздел = разделПозиции(estimate.sections, item.id);
  if (раздел === null) {
    назватьОшибку("Позиция не найдена в действующей редакции сметы.");
    return;
  }
  const было = раздел.items.findIndex((строка) => строка.id === item.id);
  const без = раздел.items.filter((строка) => строка.id !== item.id);
  const стало = Math.max(0, Math.min(без.length, было + шагов));
  /* Упор в край — не ошибка и не действие: строка уже первая или уже
     последняя, и запрос, ничего не меняющий, был бы шумом в журнале. */
  if (стало === было) return;
  const after = стало === 0 ? null : (без[стало - 1]?.id ?? null);
  сохранить(moveEstimateItem(code, item.id, { sectionId: раздел.id, after }));
}

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
/** Тон плашки срока по ступени шкалы срочности. */
const ТОН_СРОКА: Record<DueLevel, string> = {
  overdue: "tile--overdue",
  today: "tile--today",
  soon: "tile--accent",
  later: "tile--accent",
  none: "tile--accent",
};

const TABS = [
  { key: "overview", label: "Обзор" },
  { key: "measure", label: "Замер" },
  { key: "estimate", label: "Смета" },
  { key: "work", label: "Работа" },
  { key: "acceptance", label: "Приёмка" },
  { key: "expenses", label: "Чеки" },
  { key: "report", label: "Отчёт" },
  { key: "tranches", label: "Транши" },
  { key: "documents", label: "Документы" },
] as const;

type Tab = (typeof TABS)[number]["key"] | "import";

export function ProjectCard({
  project,
  user,
  units,
  today,
  откуда,
  tab,
  onTab,
  onBack,
  onChanged,
}: {
  project: ProjectSummary;
  user: CurrentUser;
  units: string[];
  today: string;
  /** Подпись раздела, куда возвращает крошка. Крошка называет место, а не вещь. */
  откуда: string;
  /** Вкладка живёт в адресе (`#R-99/estimate`) и потому у оболочки (П-50). */
  tab: Вкладка;
  onTab: (tab: Вкладка) => void;
  onBack: () => void;
  onChanged: (project: ProjectSummary) => void;
}): React.JSX.Element {
  const setTab = onTab;
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
  /* Заведение позиции — раздел, куда она встанет; лист раздела — правимый
     раздел или заведение нового (план, пункт 7.3). */
  const [новаяВ, setНоваяВ] = useState<string | null>(null);
  const [раздел, setРаздел] = useState<{ section: EstimateSectionNode | null } | null>(null);
  const [supervisionOpen, setSupervisionOpen] = useState(false);
  /* Закрытые транши читаются при открытии листа правки, а не со сметой:
     транш закрывают на другой вкладке, и снятый заранее перечень молчал бы
     о закрытом минуту назад (П-27). Отказ чтения листа не блокирует —
     предупреждение молчит, правка остаётся доступной. */
  const [закрытые, setЗакрытые] = useState<ClosedTranches["tranches"]>([]);
  const прочестьЗакрытые = (): void => {
    setЗакрытые([]);
    fetchClosedTranches(project.code)
      .then((ответ) => { setЗакрытые(ответ.tranches); })
      .catch(() => { setЗакрытые([]); });
  };
  /* Лист типовой сметы: «save» — сохранить смету объекта заготовкой,
     «apply» — взять заготовку в объект без сметы. Одна вещь, два действия. */
  const [заготовка, setЗаготовка] = useState<"save" | "apply" | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [measure, setMeasure] = useState<MeasureView | null>(null);
  /* Прорабы тянутся только тому, кто правит: роль, которой поля не
     принадлежат, органов правки не видит, и список ей незачем. */
  const [прорабы, setПрорабы] = useState<Foreman[]>([]);
  const правит = ownerLevel(user.role);

  useEffect(() => {
    if (!правит) return;
    void fetchForemen().then(setПрорабы).catch(() => { setПрорабы([]); });
  }, [правит]);

  /**
   * Правка поля объекта. Одна на все графы: ответ сервера — карточка целиком,
   * и поднимать его наверх надо одним способом, иначе после правки адреса
   * плитка в портфеле останется со старым.
   *
   * Отказ не глотается: он всплывает к органу правки, который показывает его
   * рядом с полем. Общее сообщение наверху заставило бы искать, какое поле
   * не принято.
   */
  const правитель = правит
    ? async (patch: UpdateProject): Promise<void> => {
      const обновлён = await updateProject(project.code, patch);
      onChanged(обновлён);
      void fetchEvents(project.code).then(setEvents).catch(() => { /* журнал не обязателен */ });
    }
    : undefined;

  const load = (): void => {
    setLoading(true);
    void fetchEvents(project.code).then(setEvents).catch(() => setEvents([]));
    /* Обмер спрашивается только теми, у кого есть его вкладка. Отказ здесь
       и прежде проглатывался, но запрос уходил: в журнале сервера он
       неотличим от попытки залезть не в своё, а площади из обмера нужны
       вкладке «Замер» и переносу в смету — ни того ни другого у заказчика
       нет. */
    if (user.role !== "CLIENT") {
      void fetchMeasure(project.code).then(setMeasure).catch(() => { setMeasure(null); });
    }
    /* Отчёт импорта спрашивается отдельно от сметы и заказчиком не
       спрашивается вовсе: маршрут ему закрыт. Прежде отчёт ждали внутри
       цепочки сметы, и отказ в нём попадал в общий `catch` — уже полученная
       смета обнулялась, и заказчик R-99 видел «Сметы пока нет» рядом с
       итогом 4 250 234,35 ₽ (полный аудит 30.09.2026, П-18). */
    if (user.role !== "CLIENT") {
      void fetchImports(project.code).then(setImports).catch(() => { setImports([]); });
    }
    void fetchEstimate(project.code)
      .then((view) => {
        setEstimate(view);
        setError(null);
      })
      .catch((cause: unknown) => {
        setEstimate(null);
        setError(errorMessage(cause));
      })
      .finally(() => setLoading(false));
  };

  /* Роль в списке зависимостей: с её появлением в `load` состав выборок
     стал от неё зависеть, и перезагрузка при смене роли — не прихоть
     правила линта, а верное поведение. */
  useEffect(load, [project.code, user.role]);

  /* Сохранение правки. Ответ — вид сметы целиком, и он кладётся как есть:
     собирать новое состояние из частей значило бы завести вторую копию
     правил подсчёта подытогов. Приём тот же, что в обмере и графике. */
  const сохранить = (action: Promise<EstimateView>): void => {
    setEditBusy(true);
    action
      .then((view) => {
        setEstimate(view);
        setEditing(null);
        setНоваяВ(null);
        setРаздел(null);
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
  /* Состав вкладок зависит от роли.
     
     Заказчику открыты ход работ и бумаги по его объекту: обзор, график,
     смета клиентской проекцией, фотоотчёт и акты. Приёмки, чеков и траншей
     у него нет — там стоит начисленное бригаде и движение денег студии,
     а он сторона вне компании.
     
     Состав повторяет разметку маршрутов сервера, но её не заменяет:
     спрятанная вкладка — это удобство, а не запрет. Запрет стоит в страже
     ролей, где заказчику закрыто всё, что не названо прямо. */
  const ЗАКАЗЧИКУ: readonly Tab[] = ["overview", "work", "estimate", "report", "documents"];
  const tabList = ownerLevel(user.role)
    ? [...TABS, { key: "import" as const, label: "Импорт" }]
    : user.role === "CLIENT"
      ? TABS.filter((item) => ЗАКАЗЧИКУ.includes(item.key))
      : [...TABS];

  /* Вкладка из адреса может быть закрыта роли: прорабу «Импорт», заказчику
     «Чеки». Такой адрес открывает «Обзор», а не пустую карточку. */
  useEffect(() => {
    if (!tabList.some((item) => item.key === tab)) onTab("overview");
  });

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
  const срок = due(project.deadline, today);
  /* Телефон: компактная шапка и свёрнутая сводка (план, пункт 7.2). */
  const узко = useNarrow();
  const [сводкаОткрыта, setСводкаОткрыта] = useState(false);

  const штамп = (
    <div className="stamp">
      <div className="stamp__cell">
        <span className="t-cap">Объект</span>
        <span className="stamp__value stamp__value--code">{project.code}</span>
      </div>
      <div className="stamp__cell stamp__cell--wide">
        <span className="t-cap">Адрес</span>
        {правитель === undefined ? (
          <span className="stamp__value" title={project.address}>{project.address}</span>
        ) : (
          <FieldEdit
            подпись="Адрес объекта"
            значение={project.address}
            показ={<span className="stamp__value" title={project.address}>{project.address}</span>}
            onSave={(новое) => правитель({ address: новое })}
          />
        )}
      </div>
      <div className="stamp__cell">
        {/* Графа называет то поле, которое печатает. «Стадия» была
            неверной подписью дважды: значение берётся из status — того
            же поля и того же словаря, что пилюля рядом, — а слово
            «стадия» в предметной области занято воронкой заявок
            (LeadStage) и этапом графика (WorkStage). Одно слово на три
            разные вещи заставляет читателя гадать, о чём речь. */}
        <span className="t-cap">Статус</span>
        <span className="stamp__value">{STATUS_LABEL[project.status]}</span>
      </div>
      <div className="stamp__cell">
        <span className="t-cap">Срок</span>
        {(() => {
          const вид = (
            <span className={overdue ? "stamp__value stamp__value--code stamp__value--late" : "stamp__value stamp__value--code"}>
              {deadline === null ? пусто("срок", "краткое") : deadline.date}
            </span>
          );
          if (правитель === undefined) return вид;
          return (
            <FieldEdit
              подпись="Срок сдачи"
              вид="date"
              значение={project.deadline ?? ""}
              показ={вид}
              onSave={(новое) => правитель({ deadline: новое === "" ? null : новое })}
            />
          );
        })()}
      </div>
      <div className="stamp__cell" id="card-foreman">
        <span className="t-cap">Прораб</span>
        {(() => {
          const имя = project.foreman?.name ?? пусто("прораб", "краткое");
          const вид = <span className="stamp__value" title={имя}>{имя}</span>;
          if (правитель === undefined) return вид;
          return (
            <FieldEdit
              подпись="Прораб объекта"
              вид="select"
              значение={project.foreman?.id ?? ""}
              показ={вид}
              варианты={прорабы.map((п) => ({ значение: п.id, подпись: п.name }))}
              onSave={(новое) => правитель({ foremanId: новое === "" ? null : новое })}
            />
          );
        })()}
      </div>
      <div className="stamp__cell">
        <span className="t-cap">Смета</span>
        {/* Объект без сметы помечается пилюлей, а не строчным «нет» тем же
            видом, что и редакция рядом: ответ заказчика на вопрос 8 квиза
            от 14.09.2026 требует, чтобы продукт называл незавершённое
            заведение, а значение, набранное как все прочие значения
            штампа, ничего не называет — его прочитывают как заполненную
            графу. Пометка выводится из итога сметы: второе поле под то же
            утверждение разошлось бы с первым на первой правке. */}
        {безСметы(project.estimateTotal) ? (
          <span className="pill pill--warn">{Пусто("смета")}</span>
        ) : (
          <span className="stamp__value stamp__value--code">
            ред. {project.estimateVersion}
          </span>
        )}
      </div>
    </div>
  );

  const сводкаОбъекта = (
    <>
      <div className="figure">
        <span className="figure__label">Итог сметы для заказчика</span>
        {/* Сметы нет — величину не завели, а не «её нет в природе»:
            слово словаря, а не прочерк (правило 6 `07_IA.md`). Прежде
            здесь стояли «—» и «смета не загружена» рядом со словарным
            «Сметы нет» в штампе того же экрана (полный аудит
            30.09.2026, П-9). */}
        <span className="figure__value">
          {project.estimateTotal === null ? пусто("смета", "краткое") : money(project.estimateTotal)}
        </span>
        {estimate !== null && (
          <span className="figure__note">
            {`включая сопровождение объекта ${formatPercent(BigInt(estimate.totals.supervisionShare))} — ${money(estimate.totals.supervision)}`}
          </span>
        )}
      </div>

      {/* Ориентир, названный на заявке до выезда, — рядом с итогом
          сметы: в этом соседстве весь его смысл. Видно, на сколько
          промахнулись, когда смета готова. Объект заведён руками —
          строки нет: ориентира никто не называл. Прорабу и заказчику
          поля нет в ответе сервера (ДР-0, П-56): блок следует за
          ответом, а не за ролью, — второе правило рядом с серверным
          разошлось бы с ним на первой правке. */}
      {project.guideline !== undefined && project.guideline !== null && (
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

      {/* Потрачено на материалы. Стоит рядом с итогом сметы и остатком
          транша — тремя величинами, ради которых карточку открывают
          вечером (модуль 1 объёма). Показывается всегда, включая ноль:
          ноль здесь настоящий — чеков нет, потрачено ноль, и пустоты
          у этой величины не бывает.

          Считается только по подтверждённым: черновик — заявка, а не
          расход, и вечерний вопрос «сколько ушло» не должен зависеть
          от того, разобрал ли руководитель черновики. */}
      {/* Заказчику величины нет в ответе (ДР-0): деньги в его вид не
          добавляются до решения о них. */}
      {project.spentMaterials !== undefined && (
        <div className="figure">
          <span className="figure__label">Потрачено на материалы</span>
          <span className="figure__value">{money(project.spentMaterials)}</span>
          <span className="figure__note">по подтверждённым чекам</span>
        </div>
      )}

      {/* Остаток текущего транша — та величина, ради которой руководитель
          открывает систему вечером (объём полевого испытания, решение
          № 3). Полоса с тремя величинами живёт на своей вкладке: в
          сводке нужен ответ на один вопрос — сколько ещё можно
          выработать. Транша нет — строки нет: ноль означал бы
          «выработан ровно до копейки». Заказчику поля нет в ответе
          (ДР-0): транши ему закрыты. */}
      {project.trancheRemainder !== undefined && project.trancheRemainder !== null && (
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
      {ownerLevel(user.role) && (
        <div className="row row--between summary__status">
          <span className={STATUS_PILL[project.status]}>{STATUS_LABEL[project.status]}</span>
          <button type="button" className="btn btn--text" onClick={() => setStatusOpen(true)}>
            Изменить статус
          </button>
        </div>
      )}

      {/* Тон плашки — ступень общей шкалы срочности, а не постоянный
          акцент: слово «просрочено» при спокойном цвете сообщало
          разное двумя каналами сразу (аудит Б-4). */}
      <div className={`tile tile--due ${ТОН_СРОКА[срок.level]} row row--between`}>
        <div className="figure">
          <span className="figure__label">
            {deadline === null ? "Срок" : overdue ? "Просрочено на" : "Осталось"}
          </span>
          <span className="figure__value">
            {deadline === null ? "—" : Math.abs(deadline.days)}
          </span>
          <span className="figure__note">
            {deadline === null
              ? пусто("срок")
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

      {/* Заголовок вынесен из списка: прямым потомком «dl» допустимы
          только «dt», «dd» и «div», и абзац внутри списка определений
          браузер разбирает по-своему. Список назван заголовком через
          «aria-labelledby» — связь остаётся, разметка становится
          действительной. */}
      <div className="deflist">
        <p className="deflist__head" id="card-info-head">Информация</p>
        <dl className="deflist__body" aria-labelledby="card-info-head">
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
            {правитель === undefined ? (
              project.startedAt === null ? пусто("началоРабот", "краткое") : formatDate(project.startedAt)
            ) : (
              <FieldEdit
                подпись="Начало работ"
                вид="date"
                значение={project.startedAt ?? ""}
                показ={project.startedAt === null ? пусто("началоРабот", "краткое") : formatDate(project.startedAt)}
                onSave={(новое) => правитель({ startedAt: новое === "" ? null : новое })}
              />
            )}
          </dd>
        </div>
        <div className="deflist__row">
          <dt className="deflist__term">Ключи</dt>
          <dd className="deflist__value">
            {правитель === undefined ? `${String(project.keysCount)} компл.` : (
              <FieldEdit
                подпись="Комплектов ключей"
                вид="number"
                значение={String(project.keysCount)}
                показ={`${String(project.keysCount)} компл.`}
                onSave={(новое) => правитель({ keysCount: Number.parseInt(новое, 10) })}
              />
            )}
          </dd>
        </div>
        <div className="deflist__row">
          <dt className="deflist__term">Позиций в смете</dt>
          <dd className="deflist__value">
            {project.estimateVersion === null ? пусто("смета", "краткое") : project.positions}
          </dd>
        </div>
        {/* Строки «Сопровождение» здесь нет: та же величина стоит
            примечанием к итогу сметы выше — «включая сопровождение
            объекта 12 % — 455 382,25 ₽», и там она названа вместе с
            суммой, которую объясняет. Сводка липкая и живёт в высоту
            окна: каждая лишняя строка отнимает место у нужной. */}
        </dl>
      </div>
    </>
  );

  return (
    <>
      {/* Штамп объекта. Те же сведения, что несла цветная обложка, но
          набранные как штамп рабочего чертежа: графа, подпись, значение. */}
      <div className="container" data-project-code={project.code}>
        {/* Имя экрана для того, кто его не видит: у карточки нет обложки, и
            заголовка первого уровня на ней не было вовсе — перейти к началу
            экрана по заголовкам было не к чему (полный аудит 30.09.2026,
            П-31). Глазом штамп называет объект и без него. */}
        <h1 className="visually-hidden">Объект {project.code}, {project.address}</h1>
        {узко ? (
          /* Телефон (план, пункт 7.2): шапка «‹ код адрес» в одну строку.
             Крошки и штамп из шести граф занимали первый экран целиком, и
             до вкладок прораб листал 983 px. Штамп не пропал — он в сводке
             ниже, свёрнутой под одну строку. */
          <div className="cardhead">
            <button
              type="button"
              className="cardhead__back"
              aria-label={`Назад: ${откуда}`}
              onClick={onBack}
            >
              <svg className="icon" aria-hidden="true"><use href="#i-back" /></svg>
            </button>
            <span className="code-badge">{project.code}</span>
            <span className="cardhead__address" title={project.address}>{project.address}</span>
          </div>
        ) : (
          <>
          <p className="stamp__crumbs">
            {/* Крошка называет раздел, в который возвращает, а не сущность, которая
                в нём лежит. Прежде здесь стояли «Объекты» — слово, которого нет ни
                в одном пункте навигации: карточка открывается и с «Главной», и с
                «Проектов», и возвращала крошка туда, откуда пришли, обещая третье
                место. Находка Е-1: раздел зовётся «Проекты», вещь в нём — объект,
                и смешаны они были именно здесь. */}
            <a href="#" onClick={(event) => { event.preventDefault(); onBack(); }}>{откуда}</a>
            <svg className="icon icon--sm" aria-hidden="true"><use href="#i-crumb" /></svg>
            <span>{project.code}</span>
          </p>
            {штамп}
          </>
        )}
      </div>

      <main className="container">
        <div className="project-layout">
          {узко ? (
            /* Сводка на телефоне свёрнута под одну строку (план, пункт
               7.2): штамп, деньги, срок и сведения стояли над вкладками
               высотой около 700 px, и полоса вкладок уходила ниже первого
               экрана у всех ролей. Строка-заголовок несёт статус и итог —
               два ответа, ради которых сводку открывают чаще всего. */
            <section className="cardsummary">
              <button
                type="button"
                className="cardsummary__toggle"
                aria-expanded={сводкаОткрыта}
                /* Ссылка — только на то, что есть в документе: свёрнутая
                   сводка не рисуется вовсе (норматив 5.12). */
                aria-controls={сводкаОткрыта ? "card-summary" : undefined}
                onClick={() => { setСводкаОткрыта(!сводкаОткрыта); }}
              >
                <span className="cardsummary__title">Сводка объекта</span>
                <span className="cardsummary__hint t-sm t-muted">
                  {STATUS_LABEL[project.status]}
                  {" · "}
                  {project.estimateTotal === null ? пусто("смета", "краткое") : money(project.estimateTotal)}
                </span>
                <svg className="icon icon--sm disclosure" aria-hidden="true"><use href="#i-chevron" /></svg>
              </button>
              {сводкаОткрыта && (
                <div className="stack" id="card-summary">
                  {штамп}
                  {сводкаОбъекта}
                </div>
              )}
            </section>
          ) : (
            <aside className="stack">{сводкаОбъекта}</aside>
          )}

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
                заводитСмету={ownerLevel(user.role)}
                onReport={() => { setTab("report"); }}
                onWork={() => { setTab("work"); }}
                выдаётВход={user.role === "OWNER"}
                onStep={(шаг) => {
                  /* Переход к шагу — туда, где его делают. Прораб назначается
                     в штампе: на телефоне штамп свёрнут в сводку, и она
                     раскрывается, прежде чем принять фокус. */
                  const ВКЛАДКА: Partial<Record<ШагОбъекта, Вкладка>> = {
                    rooms: "measure", estimate: "import", schedule: "work", prepayment: "tranches",
                    acceptance: "acceptance", act: "tranches", signed: "documents",
                  };
                  const вкладка = ВКЛАДКА[шаг];
                  if (вкладка !== undefined) { setTab(вкладка); return; }
                  if (шаг === "clientAccess") { window.location.hash = "#settings"; return; }
                  setСводкаОткрыта(true);
                  window.requestAnimationFrame(() => {
                    const ячейка = document.getElementById("card-foreman");
                    ячейка?.scrollIntoView({ block: "center" });
                    ячейка?.querySelector<HTMLElement>("button, select")?.focus();
                  });
                }}
                onPlanned={() => {
                  load();
                  void fetchProject(project.code).then(onChanged).catch(() => { /* сводка не обязательна */ });
                }}
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
                  sections={estimate === null ? [] : sectionWeights(estimate.sections)}
                  onEvents={load}
                />
              )}
            </div>

            <div role="tabpanel" id="panel-acceptance" aria-labelledby="tab-acceptance" hidden={tab !== "acceptance"}>
              {tab === "acceptance" && (
                <Acceptance code={project.code} role={user.role} onEvents={load} />
              )}
            </div>

            <div role="tabpanel" id="panel-expenses" aria-labelledby="tab-expenses" hidden={tab !== "expenses"}>
              {tab === "expenses" && (
                /* Сводка перечитывается вместе с журналом: подтверждённый
                   чек меняет «Потрачено на материалы» на «Обзоре», а сводка
                   приходит снаружи и сама себя не обновляет. Без этого два
                   места одной величины показывали бы разные числа, и
                   заметить расхождение можно было бы только переключив
                   вкладку. */
                <Expenses
                  code={project.code}
                  role={user.role}
                  onEvents={() => {
                    load();
                    void fetchProject(project.code).then(onChanged).catch(() => { /* сводка не обязательна */ });
                  }}
                />
              )}
            </div>

            <div role="tabpanel" id="panel-documents" aria-labelledby="tab-documents" hidden={tab !== "documents"}>
              {tab === "documents" && <Acts code={project.code} role={user.role} />}
            </div>

            <div role="tabpanel" id="panel-report" aria-labelledby="tab-report" hidden={tab !== "report"}>
              {tab === "report" && <Report code={project.code} />}
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
                    {ownerLevel(user.role) && (
                      <div className="row">
                        <button type="button" className="btn btn--primary" onClick={() => setTab("import")}>
                          Импортировать смету
                        </button>
                        {/* Второй путь к той же цели: типовая смета уже
                            лежит в организации, и заводить её файлом заново
                            — лишняя работа. Типовые сметы — настройка
                            компании и бухгалтеру закрыты сервером
                            (`@OwnerOnly`); показанная ему кнопка вела в
                            отказ (полный аудит 30.09.2026, П-23). */}
                        {user.role === "OWNER" && (
                          <button
                            type="button"
                            className="btn btn--secondary"
                            onClick={() => { setЗаготовка("apply"); setEditError(null); }}
                          >
                            Взять типовую
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {estimate !== null && user.role === "OWNER" && (
                  <div className="row">
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => { setЗаготовка("save"); setEditError(null); }}
                    >
                      Сохранить как типовую
                    </button>
                  </div>
                )}
                {estimate !== null && (
                  <EstimateTable
                    estimate={estimate}
                    {...(ownerLevel(user.role)
                      ? {
                          onEditItem: (item: EstimateItem) => {
                            setEditing(item);
                            setEditError(null);
                            прочестьЗакрытые();
                          },
                          onEditSupervision: () => {
                            setSupervisionOpen(true);
                            setEditError(null);
                            прочестьЗакрытые();
                          },
                          onMoveItem: (item: EstimateItem, шагов: number) => {
                            переставить(estimate, project.code, item, шагов, сохранить, setEditError);
                          },
                          onAddItem: (sectionId: string) => { setНоваяВ(sectionId); setEditError(null); },
                          onEditSection: (section: EstimateSectionNode) => {
                            setРаздел({ section });
                            setEditError(null);
                          },
                          onAddSection: () => { setРаздел({ section: null }); setEditError(null); },
                          busy: editBusy,
                        }
                      : {})}
                  />
                )}
                {estimate !== null && estimate.otherExpenses.length > 0 && (
                  <div className="panel panel--pad stack stack--tight">
                    <p className="figure__label">Прочие расходы · цена без объёма, приёмке не подлежат</p>
                    <hr className="rule" />
                    {/* Единица — своим элементом, а не хвостом цены: на
                        телефоне она уходит строкой под цену (план, пункт
                        7.6), и «13 500,00 ₽ / этаж» не рвётся посреди суммы. */}
                    {estimate.otherExpenses.map((expense) => (
                      <p className="otherexp" key={expense.id}>
                        <span className="t-sm">{expense.name}</span>
                        <span className="otherexp__price">
                          <span className="num">{money(expense.unitPrice)}</span>
                          {" "}
                          <span className="otherexp__unit t-sm t-muted">за {expense.unit}</span>
                        </span>
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
          rooms={estimate?.rooms ?? []}
          replanned={estimate?.replanned ?? false}
          sections={estimate === null ? [] : разделыСписком(estimate.sections)}
          sectionId={
            estimate === null
              ? ""
              : разделПозиции(estimate.sections, editing.id)?.id ?? ""
          }
          measure={measure}
          closed={закрытые}
          busy={editBusy}
          error={editError}
          onSave={(input, раздел) => {
            /* Перенос идёт первым: он отвергается по другому правилу, и
               применить правку цены, а следом получить отказ о приёмке
               значило бы оставить позицию наполовину изменённой. */
            const работа = раздел === null
              ? updateEstimateItem(project.code, editing.id, input)
              : moveEstimateItem(project.code, editing.id, { sectionId: раздел, after: null })
                .then(() => updateEstimateItem(project.code, editing.id, input));
            сохранить(работа);
          }}
          onDelete={() => { сохранить(removeEstimateItem(project.code, editing.id)); }}
          onClose={() => { setEditing(null); setEditError(null); }}
        />
      )}

      {новаяВ !== null && estimate !== null && (
        <EstimateItemSheet
          item={null}
          units={units}
          rooms={estimate.rooms}
          replanned={estimate.replanned}
          sections={разделыСписком(estimate.sections)}
          sectionId={новаяВ}
          measure={measure}
          closed={[]}
          busy={editBusy}
          error={editError}
          onSave={() => { /* правки у новой позиции нет */ }}
          onCreate={(input) => { сохранить(createEstimateItem(project.code, input)); }}
          onClose={() => { setНоваяВ(null); setEditError(null); }}
        />
      )}

      {раздел !== null && estimate !== null && (
        <SectionSheet
          section={раздел.section}
          parents={estimate.sections}
          parentId={null}
          busy={editBusy}
          error={editError}
          onCreate={(name, parentId) => { сохранить(createEstimateSection(project.code, { name, parentId })); }}
          onRename={(name) => {
            if (раздел.section === null) return;
            сохранить(renameEstimateSection(project.code, раздел.section.id, { name }));
          }}
          onDelete={() => {
            if (раздел.section === null) return;
            сохранить(removeEstimateSection(project.code, раздел.section.id));
          }}
          onClose={() => { setРаздел(null); setEditError(null); }}
        />
      )}

      {заготовка !== null && (
        <BlueprintSheet
          режим={заготовка}
          code={project.code}
          busy={editBusy}
          error={editError}
          onSave={(name) => {
            setEditBusy(true);
            setEditError(null);
            void createBlueprint({ fromProject: project.code, name })
              .then(() => { setЗаготовка(null); })
              .catch((cause: unknown) => { setEditError(errorMessage(cause)); })
              .finally(() => { setEditBusy(false); });
          }}
          onApply={(id) => {
            setEditBusy(true);
            setEditError(null);
            void applyBlueprint(project.code, id)
              .then(() => { setЗаготовка(null); load(); })
              .catch((cause: unknown) => { setEditError(errorMessage(cause)); })
              .finally(() => { setEditBusy(false); });
          }}
          onClose={() => { setЗаготовка(null); setEditError(null); }}
        />
      )}

      {supervisionOpen && estimate !== null && (
        <SupervisionSheet
          share={estimate.totals.supervisionShare}
          works={estimate.totals.works}
          closed={закрытые}
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
  заводитСмету,
  onReport,
  onWork,
  onPlanned,
  выдаётВход,
  onStep,
}: {
  project: ProjectSummary;
  estimate: EstimateView | null;
  events: ProjectEvent[];
  today: string;
  /** Может ли вошедший завести смету: от этого зависит, куда зовёт пустое состояние. */
  заводитСмету: boolean;
  /** Переход на фотоотчёт: обложка ведёт туда, откуда она взята. */
  onReport: () => void;
  /** Переход во вкладку «Работа», где график правят. */
  onWork: () => void;
  /** График разложен из сметы: сводка и журнал перечитываются. */
  onPlanned: () => void;
  /** Может ли вошедший выдать вход заказчику: бухгалтеру настройки закрыты. */
  выдаётВход: boolean;
  /** Переход к шагу «Следующего действия». */
  onStep: (шаг: ШагОбъекта) => void;
}): React.JSX.Element {
  /* Факты для «Выполнено N из M» (пункт 7.8) — только уровню руководителя:
     маршрут прорабу и заказчику закрыт, и блок им не рисуется. Отказ
     чтения блок прячет — «Обзор» остаётся рабочим. */
  const [факты, setФакты] = useState<ProjectFacts | null>(null);
  useEffect(() => {
    setФакты(null);
    if (!заводитСмету) return;
    fetchProjectFacts(project.code).then(setФакты).catch(() => { setФакты(null); });
  }, [project.code, заводитСмету]);
  const действие = факты === null ? null : nextAction(факты);
  /* Этапы графика читаются здесь, а не приходят со сводкой: в сводке нет
     принятой доли этапа (она стоит двух выборок на объект и на портфеле не
     нужна), а перечень без неё называл бы заявленное принятым. */
  const [этапы, setЭтапы] = useState<WorkStage[] | null>(null);
  const [этапыОтказ, setЭтапыОтказ] = useState<string | null>(null);
  const [раскладка, setРаскладка] = useState(false);
  const [раскладкаИдёт, setРаскладкаИдёт] = useState(false);
  const [раскладкаОтказ, setРаскладкаОтказ] = useState<string | null>(null);
  useEffect(() => {
    setЭтапы(null);
    fetchStages(project.code)
      .then((next) => { setЭтапы(next); setЭтапыОтказ(null); })
      .catch((cause: unknown) => { setЭтапыОтказ(errorMessage(cause)); });
  }, [project.code]);

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
      {/* «Следующее действие» (план, пункт 7.8): сколько шагов объекта
          выполнено и один следующий — с переходом туда, где его делают.
          Один шаг, а не перечень: блок отвечает на «что делать», а не на
          «чего не хватает». Видят руководитель и бухгалтер. */}
      {действие !== null && (
        <section className="nextstep" aria-labelledby="overview-next-head">
          <div className="nextstep__head">
            <h2 className="t-h3" id="overview-next-head">
              Выполнено {действие.done} из {действие.total}
            </h2>
            <span className="nextstep__bar" aria-hidden="true">
              <span
                className="nextstep__fill"
                style={{ "--nextstep-share": действие.done / действие.total } as React.CSSProperties}
              />
            </span>
          </div>
          {действие.next === null ? (
            <p className="t-sm">Все шаги объекта выполнены.</p>
          ) : (
            <div className="nextstep__step">
              <p className="t-sm">
                <span className="t-muted">Следующий шаг: </span>
                <span className="nextstep__label">{действие.next.label}</span>
              </p>
              {действие.next.key === "clientAccess" && !выдаётВход ? (
                <span className="t-sm t-muted">Вход выдаёт руководитель в настройках</span>
              ) : (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => { if (действие.next !== null) onStep(действие.next.key); }}
                >
                  Перейти к шагу
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {/* Обложка объекта первым блоком: карточку открывают, чтобы вспомнить,
          что это за объект, и снимок отвечает на это быстрее шести чисел.
          Видео не вводится — его нет ни в схеме, ни в объёме работ, а кнопка
          воспроизведения без воспроизведения есть обман.

          Ведёт на вкладку «Отчёт»: обложка взята оттуда, и переход к
          остальным снимкам — единственное осмысленное продолжение нажатия. */}
      <button type="button" className={КРУПНАЯ_ОБЛОЖКА[project.status]} onClick={onReport}>
        {project.cover === null ? (
          <span className="objectcover__plate" aria-hidden="true">{project.code}</span>
        ) : (
          <img
            className="objectcover__photo"
            src={acceptancePhotoUrl(project.code, project.cover.photoId)}
            alt=""
          />
        )}
        <span className="objectcover__label">
          {project.cover === null ? Пусто("снимки") : "Все снимки объекта"}
        </span>
      </button>

      {/* График работ — тот же перечень, что на вкладке «Работа» телефона
          (план, пункт 7.5): этап, сроки, заявлено и принято, отметка
          текущего. Здесь он только читается: правят график там, куда ведёт
          ссылка. */}
      <section className="stack" aria-labelledby="overview-plan-head">
        <div className="section-head">
          <h2 className="t-h2" id="overview-plan-head">График работ</h2>
          {этапы !== null && этапы.length > 0 && (
            <button type="button" className="btn btn--text" onClick={onWork}>
              Открыть во вкладке «Работа»
            </button>
          )}
        </div>
        {этапыОтказ !== null ? (
          <p className="field__error" role="alert">{этапыОтказ}</p>
        ) : этапы === null ? (
          <span className="skeleton skeleton--row" />
        ) : этапы.length === 0 ? (
          <div className="empty">
            <p className="empty__title">График не составлен</p>
            <p className="empty__text">
              {!заводитСмету
                ? "График составляет руководитель. Этапы появятся здесь, как только он будет готов."
                : estimate === null
                  ? "Этапы раскладываются из разделов сметы, а сметы у объекта ещё нет."
                  : "Этапы раскладываются из разделов сметы одним действием; сроки потом правятся во вкладке «Работа»."}
            </p>
            {заводитСмету && estimate !== null && (
              <div className="row">
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => { setРаскладка(true); setРаскладкаОтказ(null); }}
                >
                  <svg className="icon" aria-hidden="true"><use href="#i-estimate" /></svg>
                  График из сметы
                </button>
              </div>
            )}
          </div>
        ) : (
          <StageList stages={этапы} today={today} />
        )}
      </section>

      {раскладка && estimate !== null && (
        <PlanSheet
          sections={sectionWeights(estimate.sections)}
          range={projectRange(project)}
          after={null}
          busy={раскладкаИдёт}
          error={раскладкаОтказ}
          onPlan={(from, to) => {
            setРаскладкаИдёт(true);
            planStages(project.code, from, to)
              .then((next) => {
                setЭтапы(next);
                setРаскладка(false);
                setРаскладкаОтказ(null);
                onPlanned();
              })
              .catch((cause: unknown) => { setРаскладкаОтказ(errorMessage(cause)); })
              .finally(() => { setРаскладкаИдёт(false); });
          }}
          onClose={() => { setРаскладка(false); setРаскладкаОтказ(null); }}
        />
      )}

      <section className="stack">
        <div className="section-head">
          <h2 className="t-h2">Сроки объекта</h2>
          <span className="t-sm t-muted">
            {started === null ? пусто("началоРабот") : `начало ${formatDate(started)}`}
          </span>
        </div>
        {contract === null && passed === null ? (
          <div className="empty">
            <p className="empty__title">{Пусто("сроки")}</p>
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
                  {/* Подпись согласуется с числом: «152 рабочих дней прошло»
                      стояло на карточке R-99 (полный аудит 30.09.2026, П-29). */}
                  <span className="metric__label">
                    {plural(passed.working, "Рабочий день прошёл", "Рабочих дня прошло", "Рабочих дней прошло")}
                  </span>
                </span>
                <span className="metric">
                  <span className="metric__value">{passed.calendar}</span>
                  <span className="metric__label">
                    {plural(passed.calendar, "Календарный прошёл", "Календарных прошло", "Календарных прошло")}
                  </span>
                </span>
              </>
            )}
            {contract !== null && (
              <span className="metric">
                <span className="metric__value">{contract.calendar}</span>
                <span className="metric__label">
                  {plural(contract.calendar, "Календарный по договору", "Календарных по договору", "Календарных по договору")}
                </span>
              </span>
            )}
            {/* Плитки «Позиций в смете» здесь нет намеренно: ряд назван
                сроками и держит три меры времени, а счёт позиций среди них
                читается как ещё один срок. Величина не теряется — она стоит
                в сведениях слева, среди свойств объекта, и до 12.09.2026
                печаталась дважды на одном экране (аудит Г-4). */}
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
            <p className="empty__title">{Пусто("смета")}</p>
            {/* Пустое состояние зовёт к действию того, кто его читает. Прежде
                оно описывало устройство импорта — и заказчику, и прорабу,
                которым импорт недоступен (полный аудит 30.09.2026, П-9). */}
            <p className="empty__text">
              {заводитСмету
                ? "Импортируйте книгу Excel на вкладке «Импорт»: отчёт о расхождениях покажется до записи."
                : "Смету заводит руководитель. Она появится здесь, как только будет готова."}
            </p>
          </div>
        ) : (
          <dl className="deflist">
            {estimate.sections.map((section) => (
              <div className="deflist__row" key={section.id}>
                <dt className="deflist__term">{sectionTitle(section.name)}</dt>
                <dd className="deflist__value num">{money(section.subtotal)}</dd>
              </div>
            ))}
            {/* Черта перед итогом — не отдельный элемент внутри списка
                («hr» прямым потомком «dl» недопустим), а граница самой
                строки итога. Она и по смыслу принадлежит итогу: отделяет
                его от слагаемых, а не разрывает список надвое. */}
            <div className="deflist__row deflist__row--total">
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
