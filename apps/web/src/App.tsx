import { useEffect, useState } from "react";
import type { CurrentUser, ProjectStatus, ProjectSummary } from "@priyomka/contracts";
import { fetchCanonicalUnits, fetchCurrentUser, fetchProjects, logout } from "./api.js";
import { SignIn } from "./SignIn.js";
import { Dashboard } from "./Dashboard.js";
import { Directory } from "./Directory.js";
import { ProjectList } from "./ProjectList.js";
import { ProjectCard } from "./ProjectCard.js";
import { ThemeSwitch } from "./ThemeSwitch.js";

type State =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "signed"; user: CurrentUser; projects: ProjectSummary[]; units: string[] };

/** Разделы верхнего уровня. Порядок повторяет порядок работы: сводка,
 *  объекты, контрагенты. Раздел выбирается и в шапке, и в нижней панели. */
const SECTIONS = [
  { key: "home", label: "Главная", icon: "#i-object" },
  { key: "projects", label: "Объекты", icon: "#i-estimate" },
  { key: "clients", label: "Контрагенты", icon: "#i-acceptance" },
] as const;

type Section = (typeof SECTIONS)[number]["key"];

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

  if (state.kind === "anonymous") return <SignIn />;

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

  const cover = (title: string, note: string, count?: number): React.JSX.Element => (
    <div className="cover">
      <div className="container">
        <p className="cover__crumbs">{state.user.organization.name}</p>
        <div className="cover__title">
          <h1 className="t-h1">{title}</h1>
          {count !== undefined && <span className="pill">{count}</span>}
          <span className="t-sm">{note}</span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {header}
      {section === "home" && (
        <>
          {cover("Главная", "сводка по портфелю на сегодня")}
          <Dashboard user={state.user} onOpenProjects={openProjects} />
        </>
      )}
      {section === "projects" && (
        <>
          {cover("Объекты", "портфель студии", state.projects.length)}
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
          {cover("Контрагенты", "заказчики и бригады")}
          <Directory />
        </>
      )}
      {tabbar}
    </>
  );
}
