import { useEffect, useState } from "react";
import type { CurrentUser, ProjectEvent, ProjectStatus, ProjectSummary } from "@priyomka/contracts";
import { fetchCanonicalUnits, fetchCurrentUser, fetchDashboard, fetchProjects } from "./api.js";
import { SignIn } from "./SignIn.js";
import { Dashboard, EventFeed } from "./Dashboard.js";
import { Contacts } from "./Contacts.js";
import { NewProjectSheet } from "./NewProjectSheet.js";
import { Roadmap } from "./Roadmap.js";
import { ProjectList } from "./ProjectList.js";
import { ProjectCard } from "./ProjectCard.js";
import { SECTIONS, type Section } from "./sections.js";
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

  /** Сегодняшний день считается один раз на сеанс и передаётся вниз:
   *  два экрана не должны разойтись на границе суток. */
  const today = new Date().toISOString().slice(0, 10);

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
  const header = (
    <header className="appbar">
      <span className="appbar__brand">Приёмка</span>
      <nav className="appbar__nav" aria-label="Разделы">
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
   */
  const cover = (title: string, crumbs: readonly string[]): React.JSX.Element => (
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
        <h1 className="t-h1">{title}</h1>
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
          {cover("Главная", ["Главная"])}
          <Dashboard
            projects={state.projects}
            today={today}
            onOpenProjects={openProjects}
            onOpen={setOpened}
            onAdd={() => { setAdding(true); }}
          />
        </>
      )}
      {section === "projects" && (
        <>
          {cover("Проекты", ["Главная", "Проекты"])}
          <main className="container stack stack--loose">
            <ProjectList
              projects={state.projects}
              today={today}
              filter={filter}
              onFilter={setFilter}
              onOpen={setOpened}
              onAdd={() => { setAdding(true); }}
            />
          </main>
        </>
      )}
      {section === "contacts" && (
        <>
          {cover("Контакты", ["Главная", "Контакты"])}
          <Contacts />
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
