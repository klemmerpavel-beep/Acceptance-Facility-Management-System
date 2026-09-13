import { useCallback, useEffect, useState } from "react";
import { завести } from "./verbs.js";
import type { LeadBoard, LeadCard, LeadStage } from "@priyomka/contracts";
import { formatKopecks } from "@priyomka/ui";
import { errorMessage, fetchLeads } from "./api.js";
import { LeadSheet } from "./LeadSheet.js";
import { NewLeadSheet } from "./NewLeadSheet.js";
import { MOBILE, useMediaQuery } from "./media.js";
import { formatDate, plural } from "./status.js";
import { tabArrowHandler } from "./tabs.js";

/**
 * Доска воронки заявок.
 *
 * Колонки показываются все четыре, даже пустые: колонка, исчезающая вместе
 * с последней заявкой, ломает картину воронки — человек перестаёт видеть
 * стадию, на которой у него ничего нет, а именно она и есть новость.
 *
 * До 1023 px четыре колонки в ширину не помещаются, и доска становится
 * лентой стадий со списком выбранной — тем же приёмом, что лента разделов
 * приёмки. Прокручивается лента, а не документ: документ шире окна
 * запрещён нормативом интерфейса на всех ширинах.
 */
export function Leads({ onOpenProject }: { onOpenProject: (code: string) => void }): React.JSX.Element {
  const [board, setBoard] = useState<LeadBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openOnly, setOpenOnly] = useState(true);
  const [current, setCurrent] = useState<LeadStage>("FIRST_CONTACT");
  const [opened, setOpened] = useState<LeadCard | null>(null);
  const [adding, setAdding] = useState(false);
  /** Что именно только что заведено. Подтверждение действия — сама запись. */
  const [заведена, setЗаведена] = useState<string | null>(null);
  const mobile = useMediaQuery(MOBILE);

  const load = useCallback(() => {
    fetchLeads(openOnly)
      .then((next) => { setBoard(next); setError(null); })
      .catch((cause: unknown) => { setError(errorMessage(cause)); });
  }, [openOnly]);

  useEffect(load, [load]);

  if (error !== null) {
    return (
      <div className="empty">
        <p className="empty__title">Воронка недоступна</p>
        <p className="empty__text">{error}</p>
      </div>
    );
  }
  if (board === null) {
    return <div className="stack" aria-busy="true"><span className="skeleton skeleton--row" /></div>;
  }

  const колонки = board.columns;
  const выбранная = колонки.find((column) => column.stage === current) ?? колонки[0];

  /* Обновление после правки листа: карточка приходит целиком, но доска
     перестраивается запросом — смена стадии переносит карточку в другую
     колонку, и пересобирать это на экране значило бы завести вторую копию
     правил воронки. */
  const после = (lead: LeadCard): void => { setOpened(lead); load(); };

  return (
    <section className="stack">
      <div className="leads__head row row--between row--wrap">
        <button type="button" className="btn btn--primary" onClick={() => { setAdding(true); }}>
          <svg className="icon" aria-hidden="true"><use href="#i-plus" /></svg>
          {завести("заявка")}
        </button>
        <label className="selectwrap">
          <span className="visually-hidden">Показывать заявки</span>
          <select
            id="leads-scope"
            className="input"
            value={openOnly ? "open" : "all"}
            onChange={(event) => { setOpenOnly(event.target.value === "open"); }}
          >
            <option value="open">Открытые — {board.totals.open}</option>
            <option value="all">
              Все — {board.totals.open + board.totals.won + board.totals.lost}
            </option>
          </select>
          <svg className="icon selectwrap__chevron" aria-hidden="true"><use href="#i-chevron" /></svg>
        </label>
      </div>

      {заведена !== null && (
        <p className="t-sm" role="status">
          Заведена заявка {заведена}. Карточка стоит в первой стадии воронки.
        </p>
      )}

      {mobile ? (
        <>
          {/* Лента стадий: счётчики сохраняют картину воронки целиком —
              видно, где затор, не листая колонки. */}
          <div
            className="leads__stages"
            role="tablist"
            aria-label="Стадии воронки"
            onKeyDown={tabArrowHandler(
              колонки.map((column) => column.stage),
              выбранная?.stage ?? "FIRST_CONTACT",
              setCurrent,
              (stage) => `leads-stage-${stage}`,
            )}
          >
            {колонки.map((column) => (
              <button
                key={column.stage}
                id={`leads-stage-${column.stage}`}
                type="button"
                role="tab"
                aria-selected={column.stage === выбранная?.stage}
                aria-controls="leads-stage-panel"
                tabIndex={column.stage === выбранная?.stage ? 0 : -1}
                className="leads__stage"
                onClick={() => { setCurrent(column.stage); }}
              >
                <span>{column.label}</span>
                <span className="num t-sm">{column.leads.length}</span>
              </button>
            ))}
          </div>
          {/* Панель названа вкладкой: без неё «aria-controls» ссылается в
              пустоту, и чтение с экрана объявляет выбор, за которым ничего
              не стоит. */}
          <div id="leads-stage-panel" role="tabpanel">
            <Column leads={выбранная?.leads ?? []} opened={opened} onOpen={setOpened} />
          </div>
        </>
      ) : (
        <div className="leadboard">
          {колонки.map((column) => (
            <section key={column.stage} className="leadboard__column">
              {/* Черта под заголовком нейтральная у всех четырёх стадий.
                  Макет красил её сигнальными цветами, но `--danger` в этом
                  продукте закреплён за сторно, просрочкой и расхождением, и
                  на карточках под чертой стоит красная пилюля просрочки:
                  один цвет означал бы разное в двух сантиметрах друг от
                  друга. Положение в воронке называет порядок колонок. */}
              <p className="leadboard__title t-cap">{column.label}</p>
              <p className="leadboard__count t-sm t-muted">
                {column.leads.length} {plural(column.leads.length, "заявка", "заявки", "заявок")}
              </p>
              <Column leads={column.leads} opened={opened} onOpen={setOpened} />
            </section>
          ))}
        </div>
      )}

      {adding && (
        <NewLeadSheet
          onClose={() => { setAdding(false); }}
          /* Заведённая заявка встаёт на доску, а не открывает второй лист.
             Прежде `onCreated` вызывал `после`, и тот ставил заявку
             открытой: пользователь, заведя карточку, оказывался в её листе
             и тратил третье нажатие на выход. Подтверждением служит сама
             запись на доске и строка с номером — тем же приёмом, что в
             справочнике контрагентов (аудит, сокращение шагов). */
          onCreated={(lead) => {
            setAdding(false);
            setЗаведена(`№ ${String(lead.number)} · ${lead.name}`);
            load();
          }}
        />
      )}
      {opened !== null && (
        <LeadSheet
          lead={opened}
          onClose={() => { setOpened(null); }}
          onChanged={после}
          onOpenProject={(code) => { setOpened(null); onOpenProject(code); }}
        />
      )}
    </section>
  );
}

/** Колонка карточек. Пустая говорит словами, а не пустотой. */
function Column({
  leads,
  opened,
  onOpen,
}: {
  leads: readonly LeadCard[];
  opened: LeadCard | null;
  onOpen: (lead: LeadCard) => void;
}): React.JSX.Element {
  if (leads.length === 0) {
    return <p className="t-sm t-muted leadboard__empty">В этой стадии заявок нет.</p>;
  }
  return (
    <div className="leadboard__cards">
      {leads.map((lead) => {
        const просрочено = lead.tasks.filter((task) => task.state === "просрочена").length;
        const открытые = lead.tasks.filter((task) => task.state !== "выполнена").length;
        return (
          <button
            key={lead.id}
            type="button"
            className="leadcard"
            aria-current={lead.id === opened?.id ? "true" : undefined}
            onClick={() => { onOpen(lead); }}
          >
            <span className="leadcard__head">
              <span className="num leadcard__number">№ {lead.number}</span>
              <span className="t-sm t-muted">{formatDate(lead.createdAt.slice(0, 10))}</span>
            </span>
            <span className="t-h3 leadcard__name">{lead.name}, {lead.phone}</span>
            {/* Вилка ориентира на карточке — отступление продукта от
                артборда: макет её не показывает. Она здесь потому, что
                воронку открывают ради вопроса «сколько это стоит», и
                гонять за ответом в лист по каждой карточке значит не
                отвечать на него доской вовсе. */}
            {lead.guideline !== null && (
              <span className="t-sm t-secondary num leadcard__guide">
                {formatKopecks(BigInt(lead.guideline.low))} — {formatKopecks(BigInt(lead.guideline.high))}
              </span>
            )}
            <span className="row row--wrap leadcard__pills">
              {lead.outcome === "WON" && <span className="pill pill--ok">Выиграна</span>}
              {lead.outcome === "LOST" && <span className="pill">Отказ</span>}
              {открытые > 0 && (
                <span className="pill">
                  {открытые} {plural(открытые, "задача", "задачи", "задач")}
                </span>
              )}
              {просрочено > 0 && (
                <span className="pill pill--danger">
                  {просрочено} {plural(просрочено, "просроченная", "просроченные", "просроченных")}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
