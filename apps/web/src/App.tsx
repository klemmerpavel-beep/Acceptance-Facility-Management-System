import { useEffect, useState } from "react";
import type { CurrentUser, ProjectStatus, ProjectSummary } from "@priyomka/contracts";
import { fetchCanonicalUnits, fetchCurrentUser, fetchProjects, logout } from "./api.js";
import { SignIn } from "./SignIn.js";
import { Dashboard } from "./Dashboard.js";
import { Directory } from "./Directory.js";
import { Planned } from "./Planned.js";
import { ProjectList } from "./ProjectList.js";
import { ProjectCard } from "./ProjectCard.js";
import { QuickActions } from "./QuickActions.js";
import { HEADER, SECTIONS, TABBAR, restOf, type Section } from "./sections.js";
import { Settings } from "./Settings.js";
import { ThemeSwitch } from "./ThemeSwitch.js";

type State =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "signed"; user: CurrentUser; projects: ProjectSummary[]; units: string[] };

/**
 * Пустые состояния отложенных разделов. Текст называет стадию и то, что
 * раздел будет делать: раздел, о котором нечего сказать, не заводят.
 */
const PLANNED: Partial<Record<Section, { title: string; stage: string; text: string }>> = {
  requests: {
    title: "Заявок пока нет",
    stage: "отложенный контур",
    text:
      "Воронка заявок: первичный контакт, знакомство, принимают решение, согласование договора. " +
      "Заявка превращается в заказчика и объект одним действием. Макет утверждён на дизайн-канве.",
  },
  staff: {
    title: "Персонала пока нет",
    stage: "стадия D",
    text:
      "Свод начислений по бригадам. Начисление появляется при приёмке позиции, поэтому раздел " +
      "наполняется вместе с экраном приёмки, а не раньше.",
  },
  accounting: {
    title: "Бухгалтерии пока нет",
    stage: "отложенный контур",
    text:
      "Счета и платежи по объектам. Транши и остаток по ним ведутся на вкладке «Приёмка» " +
      "карточки объекта. Учёт налогов и зарплат в объём не входит — раздел 6.2 файла 01_PROJECT.md.",
  },
  documents: {
    title: "Документов пока нет",
    stage: "отложенный контур",
    text:
      "Шаблоны договоров и актов с переменными и конструктор документа. Акты по принятым " +
      "позициям формируются на вкладке «Документы» карточки объекта.",
  },
};

export function App(): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });
  /** Раздел и открытый объект хранятся состоянием: роутер не вводится,
   *  адресная строка в первой версии не участвует. */
  const [section, setSection] = useState<Section>("home");
  const [opened, setOpened] = useState<ProjectSummary | null>(null);
  const [filter, setFilter] = useState<ProjectStatus | null>(null);
  const [quick, setQuick] = useState(false);
  /** «Ещё» на телефоне: разделы, не поместившиеся в нижнюю панель. */
  const [more, setMore] = useState<"header" | "tabbar" | null>(null);

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
        {SECTIONS.filter((item) => HEADER.includes(item.key)).map((item) => (
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
        <button
          type="button"
          className="appbar__link"
          aria-current={
            opened === null && restOf(HEADER).some((item) => item.key === section) ? "page" : undefined
          }
          onClick={() => setMore("header")}
        >
          Ещё
          <svg className="icon icon--sm" aria-hidden="true"><use href="#i-chevron" /></svg>
        </button>
      </nav>
      <button
        type="button"
        className="btn btn--secondary appbar__action"
        onClick={() => setQuick(true)}
      >
        <svg className="icon" aria-hidden="true"><use href="#i-plus" /></svg>
        <span>Действие</span>
      </button>
      <span className="appbar__user">{state.user.name}</span>
      <ThemeSwitch />
      <button type="button" className="btn btn--secondary" onClick={() => void logout().then(load)}>
        Выйти
      </button>
    </header>
  );

  const rest = more === null ? [] : restOf(more === "header" ? HEADER : TABBAR);

  const tabbar = (
    <nav className="tabbar" aria-label="Разделы">
      {SECTIONS.filter((item) => TABBAR.includes(item.key)).map((item) => (
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
      <button
        type="button"
        className="tabbar__item"
        aria-current={
          opened === null && restOf(TABBAR).some((item) => item.key === section) ? "page" : undefined
        }
        onClick={() => setMore("tabbar")}
      >
        <svg className="icon" aria-hidden="true"><use href="#i-more" /></svg>
        Ещё
      </button>
    </nav>
  );

  const sheets = (
    <>
      {quick && (
        <QuickActions
          onChoose={(next) => { setQuick(false); go(next); }}
          onClose={() => setQuick(false)}
        />
      )}
      {more !== null && (
        <>
          <button type="button" className="scrim" aria-label="Закрыть" onClick={() => setMore(null)} />
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Остальные разделы">
            <p className="t-h3">Разделы</p>
            <div className="stack stack--tight">
              {rest.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="btn btn--secondary btn--block btn--touch quickaction"
                  aria-pressed={section === item.key}
                  onClick={() => { setMore(null); go(item.key); }}
                >
                  <svg className="icon" aria-hidden="true"><use href={item.icon} /></svg>
                  {item.label}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn--text btn--block" onClick={() => setMore(null)}>
              Закрыть
            </button>
          </div>
        </>
      )}
    </>
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
        {sheets}
      </>
    );
  }

  /**
   * Обложка раздела: название организации крошкой, заголовок и счётчик.
   * Поясняющей подписи под заголовком нет: «сводка по портфелю на сегодня»
   * под словом «Главная» ничего не добавляет к тому, что человек и так
   * видит на экране.
   */
  const cover = (title: string, count?: number): React.JSX.Element => (
    <div className="cover">
      <div className="container">
        <p className="cover__crumbs">{state.user.organization.name}</p>
        <div className="cover__title">
          <h1 className="t-h1">{title}</h1>
          {count !== undefined && <span className="pill">{count}</span>}
        </div>
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
          {cover("Объекты", state.projects.length)}
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
          <Settings role={state.user.role} />
        </>
      )}
      {PLANNED[section] !== undefined && (
        <>
          {cover(SECTIONS.find((item) => item.key === section)?.label ?? "")}
          <main className="container">
            <Planned {...PLANNED[section]} />
          </main>
        </>
      )}
      {tabbar}
      {sheets}
    </>
  );
}
