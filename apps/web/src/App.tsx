import { useEffect, useRef, useState } from "react";
import { завести } from "./verbs.js";
import type { CurrentUser, Inbox, ProjectEvent, ProjectStatus, ProjectSummary, Role } from "@priyomka/contracts";
import { ownerLevel } from "@priyomka/domain";
import {
  fetchCanonicalUnits, fetchCurrentUser, fetchDashboard, fetchInbox, fetchProjects, logout, markInboxSeen,
  setProjectStatus, errorMessage,
} from "./api.js";
import { SignIn } from "./SignIn.js";
import { Dashboard } from "./Dashboard.js";
import { FilteredEventFeed } from "./FeedFilter.js";
import { Contacts } from "./Contacts.js";
import { Leads } from "./Leads.js";
import { Accounting } from "./Accounting.js";
import { NewProjectSheet } from "./NewProjectSheet.js";
import { Roadmap } from "./Roadmap.js";
import { ProjectList } from "./ProjectList.js";
import { StatusSheet } from "./StatusSheet.js";
import { ProjectCard } from "./ProjectCard.js";
import { PLANNED_SECTIONS, SECTIONS, type Section } from "./sections.js";
import { Documents } from "./Documents.js";
import { Settings } from "./Settings.js";
import { ClientGuide } from "./ClientGuide.js";
import { useModalDialog } from "./modal.js";
import { MoreMenu, type ПунктЕщё } from "./MoreMenu.js";
import { адрес, простойЩелчок, разобрать, type Вкладка, type ОтборАдреса } from "./route.js";

type State =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "signed"; user: CurrentUser; projects: ProjectSummary[]; units: string[] };

/**
 * Раздел, открытый роли. Повторяет шапку: заказчику — только его объекты,
 * бухгалтеру — всё, кроме настроек. Адрес, назвавший закрытый раздел,
 * экрана не меняет: показанный раздел с отказом читался бы поломкой.
 */
const разделДоступен = (role: CurrentUser["role"], section: Section): boolean =>
  role === "CLIENT" ? section === "projects" : !(role === "ACCOUNTANT" && section === "settings");

/**
 * Перенос адреса в состояние оболочки (П-50). Объект ищется в списке,
 * который сервер отдал этой роли: адрес доступа не даёт. Адрес, который
 * пришлось поправить, — неизвестная вкладка, чужой объект, закрытый раздел —
 * заменяет запись истории, а не добавляет новую: иначе «Назад» возвращал бы
 * на него снова.
 */
function применитьАдрес(hash: string, среда: {
  user: CurrentUser;
  projects: readonly ProjectSummary[];
  /** Адрес экрана, который сейчас на месте; `null` — экрана ещё нет. */
  текущий: string | null;
  заменить: { current: boolean };
  setSection: (section: Section) => void;
  setOpened: (project: ProjectSummary | null) => void;
  setВкладка: (tab: Вкладка) => void;
  setОтбор: (отбор: ОтборАдреса | null) => void;
}): void {
  const маршрут = разобрать(hash);
  const остаться = (): void => {
    if (среда.текущий !== null) window.history.replaceState(null, "", среда.текущий);
  };
  if (маршрут === null) { остаться(); return; }
  if (маршрут.kind === "section") {
    if (!разделДоступен(среда.user.role, маршрут.section)) { остаться(); return; }
    среда.setOpened(null);
    среда.setSection(маршрут.section);
    среда.setОтбор(маршрут.отбор ?? null);
    return;
  }
  const найден = среда.projects.find((project) => project.code === маршрут.code);
  среда.заменить.current = найден === undefined || адрес(маршрут) !== hash;
  if (найден === undefined) {
    среда.setOpened(null);
    среда.setSection("projects");
    return;
  }
  среда.setSection("projects");
  среда.setOpened(найден);
  среда.setВкладка(маршрут.tab);
  среда.setОтбор(маршрут.отбор ?? null);
}

export function App(): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });
  /** Раздел, открытый объект и его вкладка хранятся состоянием, а адрес
   *  `#R-99/estimate` выводится из них (`route.ts`, П-50): роутер не
   *  вводится, хватает истории браузера. */
  /* Раздел по умолчанию — «Главная», но не для всякой роли: она есть в
     навигации не у всех, и вошедший не должен стоять на разделе, которого
     в его шапке нет. Начальное значение здесь, поправка по роли — ниже,
     когда роль уже известна: до загрузки пользователя её знать неоткуда. */
  const [section, setSection] = useState<Section>("home");
  const [opened, setOpened] = useState<ProjectSummary | null>(null);
  const [вкладка, setВкладка] = useState<Вкладка>("overview");
  /* Отбор экрана из адреса (этап Э8, ДР-1): пункт очереди ведёт на список
     ровно тех записей, что назвал числом. Живёт рядом с вкладкой и
     снимается, как только человек сам сменил экран. */
  const [отбор, setОтбор] = useState<ОтборАдреса | null>(null);
  /* Очередь заказчика грузится один раз за заход и держится до следующего:
     следом за ней приложение переставляет отметку захода, и повторный
     запрос нового уже не показал бы (решение допроса Э8-2). */
  const [очередьЗаказчика, setОчередьЗаказчика] = useState<Inbox | null>(null);
  const [ошибкаОчереди, setОшибкаОчереди] = useState<string | null>(null);
  /* Экран «Как пользоваться» заказчика (ДР-11): сам — при первом входе,
     пока отметки захода нет; повторно — из «Ещё». */
  const [памятка, setПамятка] = useState<"первый" | "повтор" | null>(null);
  /** Следующая запись адреса заменяет текущую, а не добавляется: первый
   *  адрес сеанса и адрес, поправленный после разбора. */
  const заменитьАдрес = useRef(true);
  const [filter, setFilter] = useState<ProjectStatus | null>(null);
  /** Лента событий за колоколом. Грузится по первому открытию, не раньше. */
  const [feedOpen, setFeedOpen] = useState(false);
  const [events, setEvents] = useState<ProjectEvent[] | null>(null);
  const [adding, setAdding] = useState(false);
  /** Объект, которому меняют статус из реестра. Лист тот же, что на карточке. */
  const [статусУ, setСтатусУ] = useState<ProjectSummary | null>(null);
  const [статусИдёт, setСтатусИдёт] = useState(false);
  /* Отказ смены статуса из реестра — в листе, рядом с полем «Ждём» (ДР-4).
     Прежде отказ здесь не ловился вовсе: лист молча оставался открытым. */
  const [статусОшибка, setСтатусОшибка] = useState<string | null>(null);

  /** Сегодняшний день считается один раз на сеанс и передаётся вниз:
   *  два экрана не должны разойтись на границе суток. */
  const today = new Date().toISOString().slice(0, 10);


  const load = (): void => {
    void (async () => {
      /* Вход устанавливается ответом о самом вошедшем и ничем больше.
         
         Прежде вся загрузка стояла под одним `try`, и отказ любой
         вспомогательной выборки объявлял человека неизвестным. Заказчик из-за
         этого не входил вовсе: справочник единиц измерения нужен одному
         экрану импорта, закрытому для него, и его отказ выбрасывал заказчика
         обратно на экран входа — вход был, а продукта не было.
         
         Правило общее, а не про заказчика: вспомогательная выборка не
         отменяет сессию. Следующая роль и любой временный отказ сети иначе
         повторили бы то же самое. */
      let user;
      try {
        user = await fetchCurrentUser();
      } catch {
        setState({ kind: "anonymous" });
        return;
      }

      const projects = await fetchProjects().catch(() => []);
      /* Справочник единиц нужен экрану импорта сметы, а импорт есть только у
         руководителя. Спрашивать его у прочих — это отказ на каждом входе:
         в журнале сервера он неотличим от попытки залезть не в своё. */
      const first = projects[0];
      const units = ownerLevel(user.role) && first !== undefined
        ? await fetchCanonicalUnits(first.code).catch(() => [])
        : [];

      /* Раздел выбирается здесь, до первой отрисовки вошедшего, а не
         поправкой следом. Поправка следом означала бы, что заказчик успевает
         увидеть «Главную» — и запросить закрытую ему сводку портфеля. */
      if (user.role === "CLIENT") setSection("projects");
      /* Адрес читается при входе: перезагрузка и переданная ссылка
         открывают тот экран, который назван, а не «Главную». */
      применитьАдрес(window.location.hash, {
        user, projects, текущий: null, заменить: заменитьАдрес, setSection, setOpened, setВкладка, setОтбор,
      });
      setState({ kind: "signed", user, projects, units });
      /* Заход заказчика: сперва новое с прошлой отметки, затем отметка
         «сейчас». Порядок обязателен — обратный стёр бы новое до показа. */
      if (user.role === "CLIENT") {
        void fetchInbox()
          .then((очередь) => {
            setОчередьЗаказчика(очередь);
            if (очередь.seenAt === null) setПамятка("первый");
            return markInboxSeen();
          })
          .catch((cause: unknown) => { setОшибкаОчереди(errorMessage(cause)); });
      }
    })();
  };

  useEffect(load, []);

  /* Адрес — следствие состояния. Переход внутри продукта кладёт запись в
     историю браузера, и «Назад» ведёт на прежний экран продукта, а не прочь
     из него (П-50, решение заказчика от 01.10.2026). */
  const нужныйАдрес = state.kind === "signed"
    ? адрес(opened === null
      ? { kind: "section", section, ...(отбор === null ? {} : { отбор }) }
      : { kind: "project", code: opened.code, tab: вкладка, ...(отбор === null ? {} : { отбор }) })
    : null;
  useEffect(() => {
    if (нужныйАдрес === null) return;
    if (window.location.hash !== нужныйАдрес) {
      if (заменитьАдрес.current) window.history.replaceState(null, "", нужныйАдрес);
      else window.history.pushState(null, "", нужныйАдрес);
    }
    заменитьАдрес.current = false;
  }, [нужныйАдрес]);

  /* «Назад», «Вперёд» и адрес, набранный руками, возвращают экран из адреса. */
  useEffect(() => {
    if (state.kind !== "signed") return undefined;
    const слушать = (): void => {
      применитьАдрес(window.location.hash, {
        user: state.user, projects: state.projects, текущий: нужныйАдрес,
        заменить: заменитьАдрес, setSection, setOpened, setВкладка, setОтбор,
      });
    };
    window.addEventListener("popstate", слушать);
    window.addEventListener("hashchange", слушать);
    return () => {
      window.removeEventListener("popstate", слушать);
      window.removeEventListener("hashchange", слушать);
    };
  }, [state, нужныйАдрес]);



  // Лента грузится по первому открытию колокола, а не вместе с приложением:
  // на главной её больше нет, и платить за неё каждым заходом незачем.
  useEffect(() => {
    if (!feedOpen || events !== null) return;
    /* Лента берётся из сводки портфеля, а сводка — раздел компании. Заказчику
       она закрыта, и колокол у него не показывается вовсе (ниже по шапке);
       проверка здесь — вторая, на случай если орган всё же нажали. */
    void fetchDashboard()
      .then((summary) => { setEvents(summary.feed); })
      .catch(() => { setEvents([]); });
  }, [feedOpen, events]);

  if (state.kind === "loading") {
    return (
      <main className="container stack" aria-busy="true">
        <span className="skeleton skeleton--row" />
        <span className="skeleton skeleton--row" />
      </main>
    );
  }

  if (state.kind === "anonymous") return <SignIn onSignedIn={load} />;

  const go = (next: Section): void => {
    setOpened(null);
    setОтбор(null);
    setПамятка(null);
    setSection(next);
  };

  const openProjects = (status: ProjectStatus | null): void => {
    setFilter(status);
    go("projects");
  };

  /** Объект открывается с «Обзора»: вкладка прежнего объекта к новому не
   *  относится. */
  const открыть = (project: ProjectSummary): void => {
    setOpened(project);
    setОтбор(null);
    setПамятка(null);
    setВкладка("overview");
  };

  /** Обновлённый объект заменяет свою строку в списке: после смены статуса
   *  список не должен показывать прежнее значение. */
  const replaceProject = (updated: ProjectSummary): void => {
    setState((current) =>
      current.kind === "signed"
        ? {
            ...current,
            projects: current.projects.map((project) =>
              project.id === updated.id ? updated : project,
            ),
          }
        : current,
    );
    setOpened(updated);
  };

  /**
   * Открытие объекта по коду. Нужно воронке: превращённая заявка ведёт на
   * заведённый объект, а список объектов к этому моменту уже устарел —
   * объекта в нём ещё нет.
   */
  const открытьОбъект = (code: string): void => {
    fetchProjects()
      .then((projects) => {
        const найден = projects.find((project) => project.code === code) ?? null;
        if (найден === null) return;
        setState((current) => (current.kind === "signed" ? { ...current, projects } : current));
        setSection("projects");
        открыть(найден);
      })
      .catch(() => {
        /* Объект заведён, но список не обновился: раздел всё равно
           открывается — оттуда объект достижим руками. */
        setSection("projects");
      });
  };

  /**
   * Шапка: знак слева, разделы пилюлями по центру, блок пользователя и
   * колокол справа. Раскладка эталона.
   *
   * Знак несёт название продукта, а не знак эталона: раскладка и палитра
   * заимствуются, товарный знак — нет.
   *
   * Колокол открывает ленту событий портфеля. Он не украшение: события у
   * продукта есть — смена статуса, импорт сметы, правка обмера, — и это
   * ровно то, что человек ищет, вернувшись после выходных. Колокол без
   * содержимого нарушал бы правило «показываем только работающее».
   */
  /**
   * Шапка по эталону: слева лока́п из знака и слова, по центру одна капсула
   * со всеми пунктами и «Ещё», справа блок работающего, переключатель темы
   * и колокол.
   *
   * Слева знак и двухстрочный лока́п: имя продукта основной строкой, имя
   * студии подписью. Продукт называется «Приёмка» — его и читают; студия
   * стоит ниже, одним написанием на весь продукт.
   *
   * Знак — свой, в языке набора значков. Знак и слово эталона не
   * воспроизводятся: это чужой товарный знак.
   */
  /* Разделы по роли. Заказчику открыт один — его объекты; прочие ведут
     внутреннюю работу компании, и показанный раздел, отвечающий отказом,
     был бы обещанием доступа, которого нет.

     Состав повторяет разметку маршрутов сервера, но её не заменяет: скрытый
     раздел — удобство, а запрет стоит в страже ролей. */
  const разделы = state.user.role === "CLIENT"
    ? SECTIONS.filter((item) => item.key === "projects")
    : SECTIONS;

  /* Служебные экраны и выход — один перечень на шапку и на таб-панель.
     Две копии разошлись бы на первой же правке состава. */
  const служебные: readonly ПунктЕщё[] = [
    /* Настройки компании и выдача входа — руководителю. Бухгалтеру решением
       заказчика от 19.09.2026 открыто всё, кроме них, и пункт, отвечающий
       отказом, читался бы поломкой продукта: то же правило, по которому
       прорабу не показывают кнопку заведения объекта. */
    ...(state.user.role === "ACCOUNTANT"
      ? []
      : [{ label: "Настройки", onSelect: () => { setOpened(null); setSection("settings"); } }]),
    { label: "Документы", onSelect: () => { setOpened(null); setSection("documents"); } },
    { label: "Что дальше", onSelect: () => { setOpened(null); setSection("roadmap"); } },
  ];
  /* Заказчику из служебного открыт только выход: настройки организации,
     шаблоны её документов и дорожная карта продукта — внутренняя работа
     компании, а не сведения о его объекте. */
  const ещё: readonly ПунктЕщё[] = state.user.role === "CLIENT"
    ? [
      { label: "Как пользоваться", onSelect: () => { setПамятка("повтор"); } },
      { label: "Выйти", onSelect: () => { void logout().then(load); } },
    ]
    : [...служебные, { label: "Выйти", onSelect: () => { void logout().then(load); } }];

  const header = (
    <header className="appbar">
      <span className="appbar__brand">
        <svg className="icon appbar__mark" aria-hidden="true"><use href="#i-mark" /></svg>
        <span className="appbar__lockup">
          <span className="appbar__product">Приёмка</span>
          <span className="appbar__org">DOLGIY STUDIO</span>
        </span>
      </span>
      <nav className="appbar__nav" aria-label="Разделы">
        <div className="appbar__nav-scroll">
          {разделы.map((item) => (
            <a
              key={item.key}
              className="appbar__link"
              aria-current={opened === null && section === item.key ? "page" : undefined}
              href={`#${item.key}`}
              onClick={(event) => {
                if (!простойЩелчок(event)) return;
                event.preventDefault();
                go(item.key);
              }}
            >
              {item.label}
            </a>
          ))}
        </div>
        {/* «Ещё» — не раздел, а список служебных экранов. Тот же список
            стоит шестым пунктом таб-панели: на телефоне полоса разделов
            скрыта целиком, и без него из продукта не было выхода. */}
        <MoreMenu
          пункты={ещё}
          className="appbar__more"
          классКнопки="appbar__link"
          классСписка="appbar__menu"
        >
          Ещё
          <svg className="icon icon--sm" aria-hidden="true"><use href="#i-chevron" /></svg>
        </MoreMenu>
      </nav>
      {/* Имя ведёт в настройки, а у бухгалтера настроек нет — и оно перестаёт
          быть органом вовсе, а не становится органом с отказом. */}
      {state.user.role === "ACCOUNTANT" ? (
        <span className="appbar__user">
          <span className="appbar__name">{state.user.name}</span>
          <svg className="icon appbar__avatar" aria-hidden="true"><use href="#i-avatar" /></svg>
        </span>
      ) : (
        <button
          type="button"
          className="appbar__user"
          aria-current={section === "settings" || section === "roadmap" || section === "documents"
            ? "page"
            : undefined}
          onClick={() => { setOpened(null); setSection("settings"); }}
        >
          <span className="appbar__name">{state.user.name}</span>
          <svg className="icon appbar__avatar" aria-hidden="true"><use href="#i-avatar" /></svg>
        </button>
      )}
      {/* Колокол ведёт в события портфеля — раздел компании. Заказчику он
          не показывается: орган, отвечающий отказом, читается как поломка
          продукта, а не как граница роли. */}
      {state.user.role !== "CLIENT" && (
        <button
          type="button"
          className="appbar__bell"
          aria-label={`События портфеля${events === null ? "" : `: ${String(events.length)}`}`}
          aria-expanded={feedOpen}
          onClick={() => { setFeedOpen(true); }}
        >
          <svg className="icon" aria-hidden="true"><use href="#i-bell" /></svg>
        </button>
      )}
    </header>
  );

  const tabbar = (
    <nav className="tabbar" aria-label="Разделы">
      {разделы.map((item) => (
        <a
          key={item.key}
          className="tabbar__item"
          aria-current={opened === null && section === item.key ? "page" : undefined}
          href={`#${item.key}`}
          onClick={(event) => {
                if (!простойЩелчок(event)) return;
                event.preventDefault();
                go(item.key);
              }}
        >
          <svg className="icon" aria-hidden="true"><use href={item.icon} /></svg>
          {item.label}
        </a>
      ))}
      {/* Шестой пункт. Стили таб-панели его уже ждали: колонки объявлены
          `grid-auto-columns: 1fr` с оговоркой «пунктов столько, сколько их в
          разметке», а сброс кнопочных значений подписан «пункт „Ещё“ —
          кнопка, остальные ссылки». Не хватало самой разметки, и из-за этого
          на телефоне не было выхода. */}
      <MoreMenu
        пункты={ещё}
        className="tabbar__more"
        классКнопки="tabbar__item"
        классСписка="tabbar__menu"
      >
        <svg className="icon" aria-hidden="true"><use href="#i-chevron" /></svg>
        Ещё
      </MoreMenu>
    </nav>
  );

  /**
   * Обложка раздела: название организации крошкой и заголовок.
   *
   * Ни поясняющей подписи, ни счётчика. «Сводка по портфелю на сегодня» под
   * словом «Главная» ничего не добавляет к тому, что человек и так видит,
   * а число объектов в обложке — это то же число, что стоит в переключателе
   * статусов и в подвале таблицы.
   *
   * Третьим доводом — первичное действие раздела. Прежде оно стояло в
   * заголовке рабочего полотна, и на главной это второй-третий экран
   * прокрутки: чтобы завести объект, человек сперва пролистывал портфель,
   * воронку и графики.
   *
   * Действие поднимается только там, где его состояние принадлежит оболочке
   * (`adding` живёт здесь). «Новая заявка» и «Добавить контакт» остаются на
   * своих экранах: их состояние живёт в дочернем компоненте, а подъём
   * состояния ради места кнопки — правка устройства, а не обложки.
   */
  const cover = (
    title: string,
    crumbs: readonly string[] = [],
    action?: React.JSX.Element | null,
  ): React.JSX.Element => (
    <div className="cover">
      <div className="container">
        <p className="cover__crumbs">
          {crumbs.map((crumb, index) => (
            <span key={crumb}>
              {index > 0 && <svg className="icon icon--sm" aria-hidden="true"><use href="#i-crumb" /></svg>}
              {crumb}
            </span>
          ))}
        </p>
        <div className="cover__head">
          <h1 className="t-h1">{title}</h1>
          {action}
        </div>
      </div>
    </div>
  );

  /* Памятка заказчика стоит поверх раздела и объекта: «Перейти к объекту»
     открывает его единственный объект, а при нескольких — их перечень. */
  if (памятка !== null && state.user.role === "CLIENT") {
    return (
      <>
        {header}
        {cover(памятка === "первый" ? "Добро пожаловать в «Приёмку»" : "Как пользоваться «Приёмкой»", ["Проекты"])}
        <ClientGuide
          projects={state.projects}
          onOpen={() => {
            setПамятка(null);
            const [один, ...прочие] = state.projects;
            if (один !== undefined && прочие.length === 0) открыть(один);
            else go("projects");
          }}
        />
        {tabbar}
      </>
    );
  }

  if (opened !== null) {
    return (
      <>
        {header}
        <ProjectCard
          key={opened.code}
          project={opened}
          user={state.user}
          units={state.units}
          today={today}
          откуда={разделы.find((item) => item.key === section)?.label ?? "Проекты"}
          tab={вкладка}
          onTab={(next) => { setОтбор(null); setВкладка(next); }}
          отбор={отбор}
          onСброситьОтбор={() => { setОтбор(null); }}
          очередь={state.user.role === "CLIENT" ? { inbox: очередьЗаказчика, error: ошибкаОчереди } : null}
          onBack={() => { setОтбор(null); setOpened(null); }}
          onChanged={replaceProject}
        />
        {tabbar}
      </>
    );
  }


  /** Заведённый объект встаёт в список и открывается сразу: подтверждение
   *  действия — это сама запись на экране, а не всплывающее сообщение. */
  const projectAdded = (created: ProjectSummary): void => {
    setState((current) =>
      current.kind === "signed"
        ? { ...current, projects: [...current.projects, created].sort((a, b) => a.code.localeCompare(b.code)) }
        : current,
    );
    setAdding(false);
    setFilter(null);
  };

  return (
    <>
      {header}
      {section === "home" && (
        <>
          {/* Заводит объекты руководитель. Показанная прорабу кнопка вела в
              лист, который отказывал первым же запросом: первичное действие,
              оканчивающееся отказом, хуже отсутствующего — оно выглядит
              поломкой продукта, а не границей роли. */}
          {cover("Главная", [], ownerLevel(state.user.role) ? (
            <button type="button" className="btn btn--primary" onClick={() => { setAdding(true); }}>
              <svg className="icon" aria-hidden="true"><use href="#i-plus" /></svg>
              {завести("объект")}
            </button>
          ) : null)}
          <Dashboard
            projects={state.projects}
            today={today}
            onOpenProjects={openProjects}
            onOpenLeads={() => { setSection("requests"); }}
            onOpen={открыть}
            onAdd={() => { setAdding(true); }}
          />
        </>
      )}
      {section === "projects" && (
        <>
          {cover("Проекты", ["Главная", "Проекты"], ownerLevel(state.user.role) ? (
            <button type="button" className="btn btn--primary" onClick={() => { setAdding(true); }}>
              <svg className="icon" aria-hidden="true"><use href="#i-plus" /></svg>
              {завести("объект")}
            </button>
          ) : null)}
          <main className="container stack stack--loose">
            <ProjectList
              projects={state.projects}
              today={today}
              filter={filter}
              onFilter={setFilter}
              onOpen={открыть}
              onAdd={() => { setAdding(true); }}
              /* Статус меняется из реестра, а не только из карточки: путь
                 через карточку стоил четырёх нажатий при правиле «три
                 касания до действия». Лист тот же, что на карточке, и
                 запрос тот же — меняется место вызова, не логика. */
              {...(ownerLevel(state.user.role) ? { onStatus: setСтатусУ } : {})}
            />
          </main>
        </>
      )}
      {/* Заявки — раздел руководителя: прорабу маршруты закрыты ролью, и
          показывать ему доску, которая ответит отказом, незачем. */}
      {section === "requests" && (
        <>
          {cover("Заявки", ["Главная", "Заявки"])}
          {/* Доска живёт в общем контейнере, как и прочие разделы. Без него
              она прижималась к краю окна полем в ноль вместо 24 px, не имела
              предельной ширины и не получала отбивку от обложки: правило
              `.cover + main` стоит на элементе, а за обложкой шёл `section`
              (аудит Г-3). */}
          <main className="container stack stack--loose">
            {ownerLevel(state.user.role) ? (
              <Leads onOpenProject={открытьОбъект} />
            ) : (
              <div className="empty">
                <p className="empty__title">Раздел ведёт руководитель</p>
                <p className="empty__text">
                  Воронка заявок — коммерческий контур. Ваша работа начинается с объекта.
                </p>
              </div>
            )}
          </main>
        </>
      )}
      {/* Бухгалтерия — раздел руководителя по тому же правилу, что и
          заявки: прорабу маршрут закрыт ролью, и показывать ему экран,
          который ответит отказом, незачем. */}
      {section === "accounting" && (
        <>
          {cover("Бухгалтерия", ["Главная", "Бухгалтерия"])}
          {ownerLevel(state.user.role) ? (
            <Accounting onOpenProject={открытьОбъект} />
          ) : (
            <div className="empty">
              <p className="empty__title">Раздел ведёт руководитель</p>
              <p className="empty__text">
                Деньги заказчика — не ваш контур. Ваша работа кончается принятой позицией.
              </p>
            </div>
          )}
        </>
      )}
      {section === "contacts" && (
        <>
          {cover("Контакты", ["Главная", "Контакты"])}
          <Contacts role={state.user.role} />
        </>
      )}
      {/* Разделы без своего экрана ведут на «Что дальше»: там названа
          стадия, на которой раздел появится. Пустая заглушка сообщила бы
          «здесь ничего нет», а этот экран сообщает «здесь будет и когда». */}
      {PLANNED_SECTIONS.some((key) => key === section) && (
        <>
          {cover(SECTIONS.find((item) => item.key === section)?.label ?? "Что дальше", [
            "Главная",
            SECTIONS.find((item) => item.key === section)?.label ?? "Что дальше",
          ])}
          <Roadmap />
        </>
      )}
      {section === "settings" && (
        <>
          {cover("Настройки", ["Главная", "Настройки"])}
          <Settings
            onRoadmap={() => { setSection("roadmap"); }}
            onSignedOut={load}
            отбор={отбор}
            onСброситьОтбор={() => { setОтбор(null); }}
          />
        </>
      )}
      {section === "roadmap" && (
        <>
          {cover("Что дальше", ["Главная", "Настройки", "Что дальше"])}
          <Roadmap />
        </>
      )}
      {section === "documents" && (
        <>
          {cover("Документы организации", ["Главная", "Настройки", "Документы"])}
          <Documents role={state.user.role} projects={state.projects} />
        </>
      )}
      {adding && (
        <NewProjectSheet onClose={() => { setAdding(false); }} onCreated={projectAdded} />
      )}
      {/* Смена статуса из реестра. Лист и запрос те же, что на карточке
          объекта; меняется только место вызова. Строка реестра обновляется
          на месте — перезапрашивать весь список ради одного поля значило бы
          отдать человеку моргнувшую таблицу вместо изменившейся пилюли. */}
      {статусУ !== null && (
        <StatusSheet
          current={статусУ.status}
          waitingFor={статусУ.waitingFor}
          busy={статусИдёт}
          error={статусОшибка}
          onClose={() => { setСтатусУ(null); setСтатусОшибка(null); }}
          onChoose={(status, waitingFor) => {
            setСтатусИдёт(true);
            setСтатусОшибка(null);
            void setProjectStatus(статусУ.code, status, waitingFor)
              .then((обновлённый) => {
                setState((current) =>
                  current.kind === "signed"
                    ? {
                        ...current,
                        projects: current.projects.map((project) =>
                          project.code === обновлённый.code ? обновлённый : project),
                      }
                    : current);
                setСтатусУ(null);
              })
              .catch((cause: unknown) => { setСтатусОшибка(errorMessage(cause)); })
              .finally(() => { setСтатусИдёт(false); });
          }}
        />
      )}
      {feedOpen && (
        <FeedSheet events={events} role={state.user.role} onClose={() => { setFeedOpen(false); }} />
      )}
      {tabbar}
    </>
  );
}

/**
 * Лента событий портфеля за колоколом шапки.
 *
 * Своего запроса не заводит: события уже приходят в сводке главной, и
 * второе обращение за теми же строками отличалось бы от первого только
 * временем ответа.
 */
function FeedSheet({
  events,
  role,
  onClose,
}: {
  events: ProjectEvent[] | null;
  role: Role;
  onClose: () => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog(onClose);
  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="События портфеля" ref={dialog}>
        <p className="t-h3">События портфеля</p>
        {events === null ? (
          <span className="skeleton skeleton--row" />
        ) : events.length === 0 ? (
          <div className="empty">
            <p className="empty__title">Событий пока нет</p>
            <p className="empty__text">Здесь появятся смены статуса, импорт смет и правки обмера.</p>
          </div>
        ) : (
          <FilteredEventFeed events={events} role={role} />
        )}
        <button type="button" className="btn btn--text btn--block" ref={first} onClick={onClose}>
          Закрыть
        </button>
      </div>
    </>
  );
}
