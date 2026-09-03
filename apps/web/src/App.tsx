import { useEffect, useState } from "react";
import type { CurrentUser, ProjectStatus, ProjectSummary } from "@priyomka/contracts";
import { fetchCanonicalUnits, fetchCurrentUser, fetchProjects, logout } from "./api.js";
import { SignIn } from "./SignIn.js";
import { Dashboard } from "./Dashboard.js";
import { Directory } from "./Directory.js";
import { Roadmap } from "./Roadmap.js";
import { ProjectList } from "./ProjectList.js";
import { ProjectCard } from "./ProjectCard.js";
import { SECTIONS, type Section } from "./sections.js";
import { Settings } from "./Settings.js";
import { ThemeSwitch } from "./ThemeSwitch.js";

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

  /** Сегодняшний день считается один раз на сеанс и передаётся вниз:
   *  два экрана не должны разойтись на границе суток. */
  const today = new Date().toISOString().slice(0, 10);

  const load = (): void => {
    void (async () => {
      try {
        const user = await fetchCurrentUser();
        const projects = await fetchProjects();
        // Справочник единиц нужен экрану импорта; у прораба импорта нет.
        const first = projects[0];
        const units =
          user.role === "OWNER" && first !== undefined ? await fetchCanonicalUnits(first.code) : [];
        setState({ kind: "signed", user, projects, units });
      } catch {
        setState({ kind: "anonymous" });
      }
    })();
  };

  useEffect(load, []);

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

  const header = (
    <header className="appbar">
      <span className="appbar__brand">Приёмка</span>
      <nav className="appbar__nav">
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
      <span className="appbar__user">{state.user.name}</span>
      <ThemeSwitch />
      <button type="button" className="btn btn--secondary" onClick={() => void logout().then(load)}>
        Выйти
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
  const cover = (title: string): React.JSX.Element => (
    <div className="cover">
      <div className="container">
        <p className="cover__crumbs">{state.user.organization.name}</p>
        <h1 className="t-h1">{title}</h1>
      </div>
    </div>
  );

  return (
    <>
      {header}
      {section === "home" && (
        <>
          {cover("Главная")}
          <Dashboard onOpenProjects={openProjects} />
        </>
      )}
      {section === "projects" && (
        <>
          {cover("Объекты")}
          <main className="container stack stack--loose">
            <ProjectList
              projects={state.projects}
              role={state.user.role}
              today={today}
              filter={filter}
              onFilter={setFilter}
              onOpen={setOpened}
            />
          </main>
        </>
      )}
      {section === "clients" && (
        <>
          {cover("Контрагенты")}
          <Directory />
        </>
      )}
      {section === "settings" && (
        <>
          {cover("Настройки")}
          <Settings role={state.user.role} onRoadmap={() => setSection("roadmap")} />
        </>
      )}
      {section === "roadmap" && (
        <>
          {cover("Что дальше")}
          <Roadmap />
        </>
      )}
      {tabbar}
    </>
  );
}
