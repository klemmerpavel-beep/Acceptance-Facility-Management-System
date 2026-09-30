import { useEffect, useState } from "react";
import { завести } from "./verbs.js";
import type { CurrentUser, ProjectEvent, ProjectStatus, ProjectSummary } from "@priyomka/contracts";
import { ownerLevel } from "@priyomka/domain";
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
import { Documents } from "./Documents.js";
import { Settings } from "./Settings.js";
import { useModalDialog } from "./modal.js";
import { MoreMenu, type ПунктЕщё } from "./MoreMenu.js";

type State =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "signed"; user: CurrentUser; projects: ProjectSummary[]; units: string[] };

export function App(): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });
  /** Раздел и открытый объект хранятся состоянием: роутер не вводится,
   *  адресная строка в первой версии не участвует. */
  /* Раздел по умолчанию — «Главная», но не для всякой роли: она есть в
     навигации не у всех, и вошедший не должен стоять на разделе, которого
     в его шапке нет. Начальное значение здесь, поправка по роли — ниже,
     когда роль уже известна: до загрузки пользователя её знать неоткуда. */
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
      setState({ kind: "signed", user, projects, units });
    })();
  };

  useEffect(load, []);



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
    ? [{ label: "Выйти", onSelect: () => { void logout().then(load); } }]
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
              onClick={(event) => { event.preventDefault(); go(item.key); }}
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
          onClick={(event) => { event.preventDefault(); go(item.key); }}
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

  if (opened !== null) {
    return (
      <>
        {header}
        <ProjectCard
          project={opened}
          user={state.user}
          units={state.units}
          today={today}
          откуда={разделы.find((item) => item.key === section)?.label ?? "Проекты"}
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
            onOpen={setOpened}
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
              onOpen={setOpened}
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
          <Settings onRoadmap={() => { setSection("roadmap"); }} onSignedOut={load} />
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
