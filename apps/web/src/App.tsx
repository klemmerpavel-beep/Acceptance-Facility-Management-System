import { useEffect, useRef, useState } from "react";
import { завести } from "./verbs.js";
import type { CurrentUser, ProjectEvent, ProjectStatus, ProjectSummary } from "@priyomka/contracts";
import {
  fetchCanonicalUnits, fetchCurrentUser, fetchDashboard, fetchProjects, logout, setProjectStatus,
} from "./api.js";
import { SignIn } from "./SignIn.js";
import { Dashboard, EventFeed } from "./Dashboard.js";
import { Contacts } from "./Contacts.js";
import { Leads } from "./Leads.js";
import { Accounting } from "./Accounting.js";
import { NewProjectSheet } from "./NewProjectSheet.js";
import { Roadmap } from "./Roadmap.js";
import { ProjectList } from "./ProjectList.js";
import { StatusSheet } from "./StatusSheet.js";
import { ProjectCard } from "./ProjectCard.js";
import { PLANNED_SECTIONS, SECTIONS, type Section } from "./sections.js";
import { Settings } from "./Settings.js";
import { useModalDialog } from "./modal.js";

type State =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "signed"; user: CurrentUser; projects: ProjectSummary[]; units: string[] };

export function App(): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });
  /** Раздел и открытый объект хранятся состоянием: роутер не вводится,
   *  адресная строка в первой версии не участвует. */
  const [section, setSection] = useState<Section>("home");
  const [opened, setOpened] = useState<ProjectSummary | null>(null);
  const [filter, setFilter] = useState<ProjectStatus | null>(null);
  /** Лента событий за колоколом. Грузится по первому открытию, не раньше. */
  const [feedOpen, setFeedOpen] = useState(false);
  const [events, setEvents] = useState<ProjectEvent[] | null>(null);
  const [adding, setAdding] = useState(false);
  /** Объект, которому меняют статус из реестра. Лист тот же, что на карточке. */
  const [статусУ, setСтатусУ] = useState<ProjectSummary | null>(null);
  const [статусИдёт, setСтатусИдёт] = useState(false);

  /** Сегодняшний день считается один раз на сеанс и передаётся вниз:
   *  два экрана не должны разойтись на границе суток. */
  const today = new Date().toISOString().slice(0, 10);

  /* Список «Ещё» закрывается сам после выбора: раскрытый список поверх
     нового экрана — забытое состояние, а не подсказка. */
  const moreRef = useRef<HTMLDetailsElement>(null);
  const closeMore = (): void => {
    if (moreRef.current !== null) moreRef.current.open = false;
  };

  const load = (): void => {
    void (async () => {
      try {
        const user = await fetchCurrentUser();
        const projects = await fetchProjects();
        // Справочник единиц нужен экрану импорта сметы.
        const first = projects[0];
        const units = first === undefined ? [] : await fetchCanonicalUnits(first.code);
        setState({ kind: "signed", user, projects, units });
      } catch {
        setState({ kind: "anonymous" });
      }
    })();
  };

  useEffect(load, []);

  // Лента грузится по первому открытию колокола, а не вместе с приложением:
  // на главной её больше нет, и платить за неё каждым заходом незачем.
  useEffect(() => {
    if (!feedOpen || events !== null) return;
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
    setSection(next);
  };

  const openProjects = (status: ProjectStatus | null): void => {
    setFilter(status);
    go("projects");
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
        setOpened(найден);
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
          {SECTIONS.map((item) => (
            <a
              key={item.key}
              className="appbar__link"
              aria-current={opened === null && section === item.key ? "page" : undefined}
              href={`#${item.key}`}
              onClick={(event) => { event.preventDefault(); go(item.key); }}
            >
              {item.label}
            </a>
          ))}
        </div>
        {/* «Ещё» — не раздел, а список служебных экранов. Собран на
            <details>: раскрытие, закрытие по Esc и обход с клавиатуры
            браузер берёт на себя, и своего состояния для этого не нужно. */}
        <details className="appbar__more" ref={moreRef}>
          <summary className="appbar__link">
            Ещё
            <svg className="icon icon--sm" aria-hidden="true"><use href="#i-chevron" /></svg>
          </summary>
          <div className="appbar__menu">
            <button type="button" className="appbar__menu-item" onClick={() => { closeMore(); setOpened(null); setSection("settings"); }}>
              Настройки
            </button>
            <button type="button" className="appbar__menu-item" onClick={() => { closeMore(); setOpened(null); setSection("roadmap"); }}>
              Что дальше
            </button>
            <button type="button" className="appbar__menu-item" onClick={() => { closeMore(); void logout().then(load); }}>
              Выйти
            </button>
          </div>
        </details>
      </nav>
      <button
        type="button"
        className="appbar__user"
        aria-current={section === "settings" || section === "roadmap" ? "page" : undefined}
        onClick={() => { setOpened(null); setSection("settings"); }}
      >
        <span className="appbar__name">{state.user.name}</span>
        <svg className="icon appbar__avatar" aria-hidden="true"><use href="#i-avatar" /></svg>
      </button>
      <button
        type="button"
        className="appbar__bell"
        aria-label={`События портфеля${events === null ? "" : `: ${String(events.length)}`}`}
        aria-expanded={feedOpen}
        onClick={() => { setFeedOpen(true); }}
      >
        <svg className="icon" aria-hidden="true"><use href="#i-bell" /></svg>
      </button>
    </header>
  );

  const tabbar = (
    <nav className="tabbar" aria-label="Разделы">
      {SECTIONS.map((item) => (
        <a
          key={item.key}
          className="tabbar__item"
          aria-current={opened === null && section === item.key ? "page" : undefined}
          href={`#${item.key}`}
          onClick={(event) => { event.preventDefault(); go(item.key); }}
        >
          <svg className="icon" aria-hidden="true"><use href={item.icon} /></svg>
          {item.label}
        </a>
      ))}
    </nav>
  );

  if (opened !== null) {
    return (
      <>
        {header}
        <ProjectCard
          project={opened}
          user={state.user}
          units={state.units}
          today={today}
          откуда={SECTIONS.find((item) => item.key === section)?.label ?? "Главная"}
          onBack={() => setOpened(null)}
          onChanged={replaceProject}
        />
        {tabbar}
      </>
    );
  }

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
    action?: React.JSX.Element,
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
          {cover("Главная", [], (
            <button type="button" className="btn btn--primary" onClick={() => { setAdding(true); }}>
              <svg className="icon" aria-hidden="true"><use href="#i-plus" /></svg>
              {завести("объект")}
            </button>
          ))}
          <Dashboard
            projects={state.projects}
            today={today}
            onOpenProjects={openProjects}
            onOpenLeads={() => { setSection("requests"); }}
            onOpen={setOpened}
            onAdd={() => { setAdding(true); }}
          />
        </>
      )}
      {section === "projects" && (
        <>
          {cover("Проекты", ["Главная", "Проекты"], (
            <button type="button" className="btn btn--primary" onClick={() => { setAdding(true); }}>
              <svg className="icon" aria-hidden="true"><use href="#i-plus" /></svg>
              {завести("объект")}
            </button>
          ))}
          <main className="container stack stack--loose">
            <ProjectList
              projects={state.projects}
              today={today}
              filter={filter}
              onFilter={setFilter}
              onOpen={setOpened}
              onAdd={() => { setAdding(true); }}
              /* Статус меняется из реестра, а не только из карточки: путь
                 через карточку стоил четырёх нажатий при правиле «три
                 касания до действия». Лист тот же, что на карточке, и
                 запрос тот же — меняется место вызова, не логика. */
              {...(state.user.role === "OWNER" ? { onStatus: setСтатусУ } : {})}
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
            {state.user.role === "OWNER" ? (
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
          {state.user.role === "OWNER" ? (
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
          <Contacts />
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
          <Settings onRoadmap={() => { setSection("roadmap"); }} onSignedOut={load} />
        </>
      )}
      {section === "roadmap" && (
        <>
          {cover("Что дальше", ["Главная", "Настройки", "Что дальше"])}
          <Roadmap />
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
          busy={статусИдёт}
          onClose={() => { setСтатусУ(null); }}
          onChoose={(status) => {
            setСтатусИдёт(true);
            void setProjectStatus(статусУ.code, status)
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
              .finally(() => { setСтатусИдёт(false); });
          }}
        />
      )}
      {feedOpen && (
        <FeedSheet events={events} onClose={() => { setFeedOpen(false); }} />
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
  onClose,
}: {
  events: ProjectEvent[] | null;
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
          <EventFeed events={events} />
        )}
        <button type="button" className="btn btn--text btn--block" ref={first} onClick={onClose}>
          Закрыть
        </button>
      </div>
    </>
  );
}
