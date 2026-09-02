import { useEffect, useState } from "react";
import type { CurrentUser, ProjectSummary } from "@priyomka/contracts";
import { fetchCurrentUser, fetchProjects, logout } from "./api.js";
import { SignIn } from "./SignIn.js";
import { ProjectList } from "./ProjectList.js";

type State =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "signed"; user: CurrentUser; projects: ProjectSummary[] };

export function App(): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = (): void => {
    void (async () => {
      try {
        const user = await fetchCurrentUser();
        setState({ kind: "signed", user, projects: await fetchProjects() });
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

  return (
    <>
      <header className="appbar">
        <span className="appbar__brand">Приёмка</span>
        <nav className="appbar__nav">
          <a className="appbar__link" aria-current="page" href="#">
            Объекты
          </a>
        </nav>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => void logout().then(load)}
        >
          Выйти
        </button>
      </header>
      <div className="cover">
        <div className="container">
          <p className="cover__crumbs">{state.user.organization.name}</p>
          <div className="cover__title">
            <h1 className="t-h1">Объекты</h1>
          </div>
        </div>
      </div>
      <main className="container stack stack--loose">
        <ProjectList projects={state.projects} role={state.user.role} />
      </main>
    </>
  );
}
