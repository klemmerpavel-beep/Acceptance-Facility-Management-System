import { useEffect, useState } from "react";
import type { CurrentUser, ProjectSummary } from "@priyomka/contracts";
import { fetchCanonicalUnits, fetchCurrentUser, fetchProjects, logout } from "./api.js";
import { SignIn } from "./SignIn.js";
import { ProjectList } from "./ProjectList.js";
import { ProjectCard } from "./ProjectCard.js";
import { ThemeSwitch } from "./ThemeSwitch.js";

type State =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "signed"; user: CurrentUser; projects: ProjectSummary[]; units: string[] };

export function App(): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });
  /** Открытый объект. Роутер не вводится: адресная строка в первой версии
   *  не участвует, переход хранится состоянием. */
  const [opened, setOpened] = useState<ProjectSummary | null>(null);

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

  const header = (
    <header className="appbar">
      <span className="appbar__brand">Приёмка</span>
      <nav className="appbar__nav">
        <a
          className="appbar__link"
          aria-current={opened === null ? "page" : undefined}
          href="#"
          onClick={(event) => { event.preventDefault(); setOpened(null); }}
        >
          Объекты
        </a>
      </nav>
      <ThemeSwitch />
      <button type="button" className="btn btn--secondary" onClick={() => void logout().then(load)}>
        Выйти
      </button>
    </header>
  );

  if (opened !== null) {
    return (
      <>
        {header}
        <ProjectCard
          project={opened}
          user={state.user}
          units={state.units}
          onBack={() => setOpened(null)}
        />
      </>
    );
  }

  return (
    <>
      {header}
      <div className="cover">
        <div className="container">
          <p className="cover__crumbs">{state.user.organization.name}</p>
          <div className="cover__title">
            <h1 className="t-h1">Объекты</h1>
            <span className="pill">{state.projects.length}</span>
          </div>
        </div>
      </div>
      <main className="container stack stack--loose">
        <ProjectList projects={state.projects} role={state.user.role} onOpen={setOpened} />
      </main>
    </>
  );
}
