import { useCallback, useEffect, useRef, useState } from "react";
import type { CreateWorkStage, Role, WorkerRow, WorkStage } from "@priyomka/contracts";
import {
  dayIndex, isDayOff, monthWindow, planWindow, shiftDay, shiftMonth, stageDateFault, windowDays,
  type PlanWindow, type ProjectRange, type SectionWeight,
} from "@priyomka/domain";
import { formatPercent } from "@priyomka/ui";
import {
  createStage, deleteStage, errorMessage, fetchStages, fetchWorkers, planStages, reorderStages,
  updateStage,
} from "./api.js";
import { StageSheet, type StageSection } from "./StageSheet.js";
import { PlanSheet } from "./PlanSheet.js";

/**
 * Вкладка «Работа» карточки объекта — правка графика производства работ.
 *
 * Вопрос экрана: что и когда делается на объекте. Ключевое действие —
 * завести этап; оно единственное первичное.
 *
 * Масштаб — дни. Отрезок тянется указателем с привязкой к дню, а те же
 * даты правятся полями в листе: перетаскивание недоступно с клавиатуры,
 * и один путь к действию норматив не считает путём.
 *
 * Готовность здесь заявленная. До приёмки (стадия D) подтвердить её
 * нечем, и экран говорит это словами, а не оставляет число без пояснения.
 */

/**
 * Занятость разделов: какой раздел уже ведёт другой этап.
 *
 * Считается на экране, а не приходит с сервером: этапы у экрана уже есть,
 * и лишний запрос ради того, что лежит в соседней переменной, добавил бы
 * состояние, способное разойтись со списком после первой же правки.
 * Раздел самого правимого этапа занятым не считается — иначе человек не
 * смог бы сохранить этап, ничего в нём не меняя.
 */
function занятость(
  sections: readonly SectionWeight[],
  stages: readonly WorkStage[],
  editing: WorkStage | null,
): readonly StageSection[] {
  const ведёт = new Map(
    stages
      .filter((stage) => stage.sectionId !== null && stage.id !== editing?.id)
      .map((stage) => [stage.sectionId ?? "", stage.name]),
  );
  return sections.map((section) => ({ ...section, takenBy: ведёт.get(section.id) ?? null }));
}

/** График ведёт руководитель — как и статус объекта. Прораб его читает. */
const canEdit = (role: Role): boolean => role === "OWNER";

/** Три ступени масштаба. Ширина дня — то же значение, что в токене --day-w. */
const SCALES = [
  { width: 24, label: "Месяц" },
  { width: 32, label: "Обычный" },
  { width: 48, label: "Крупный" },
] as const;

const МЕСЯЦЫ = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

/** Короткая подпись для метки увода: «март». */
const короткийМесяц = (iso: string): string =>
  (МЕСЯЦЫ[Number(iso.slice(5, 7)) - 1] ?? "").toLowerCase();

/** Подпись окна: «Сентябрь 2026». */
const подписьМесяца = (iso: string): string => {
  const [year = "", month = "01"] = iso.split("-");
  return `${МЕСЯЦЫ[Number(month) - 1] ?? ""} ${year}`;
};

/**
 * Месяц, с которого открывается график.
 *
 * Не текущий: на объекте, где работы шли весной, текущий месяц показал бы
 * пустое полотно — экран открывался бы на том, чего нет. Открывается тот
 * месяц, где работа есть: сегодняшний, если он внутри графика, иначе
 * ближайший его край.
 */
function firstMonth(
  stages: readonly { startsOn: string; endsOn: string }[],
  today: string,
): string {
  const окно = planWindow(stages);
  if (окно === null) return shiftMonth(today, 0);
  if (today < окно.from) return shiftMonth(окно.from, 0);
  if (today > окно.to) return shiftMonth(окно.to, 0);
  return shiftMonth(today, 0);
}

/**
 * Метка увода — двумя готовыми именами, а не сборкой строки.
 * Проверка мёртвых правил ищет имя класса в разметке буквально: имя,
 * собранное подстановкой, для неё не существует, и правило считается
 * мёртвым (тот же приём, что у METER_CLASS на главной).
 */
const AWAY_CLASS = {
  before: "gantt__away gantt__away--before",
  after: "gantt__away gantt__away--after",
} as const;

/** Перетаскивание: что именно взято за отрезок. */
type Grip = "move" | "start" | "end";

interface Drag {
  readonly id: string;
  readonly grip: Grip;
  readonly fromX: number;
  readonly startsOn: string;
  readonly endsOn: string;
}

/** Новые даты этапа при смещении на `days` суток тем или иным захватом. */
function dragged(drag: Drag, days: number): { startsOn: string; endsOn: string } {
  if (drag.grip === "move") {
    return { startsOn: shiftDay(drag.startsOn, days), endsOn: shiftDay(drag.endsOn, days) };
  }
  if (drag.grip === "start") {
    return { startsOn: shiftDay(drag.startsOn, days), endsOn: drag.endsOn };
  }
  return { startsOn: drag.startsOn, endsOn: shiftDay(drag.endsOn, days) };
}

export function Schedule({
  code,
  role,
  today,
  range,
  sections,
  onEvents,
}: {
  code: string;
  role: Role;
  today: string;
  range: ProjectRange;
  sections: readonly SectionWeight[];
  onEvents: () => void;
}): React.JSX.Element {
  const [stages, setStages] = useState<WorkStage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ stage: WorkStage | null } | null>(null);
  const [planning, setPlanning] = useState(false);
  /* Справочник бригад тянется здесь, а не приходит сверху: он нужен одному
     листу этого экрана. Отказ справочника не мешает править сроки, поэтому
     пустой список — не ошибка экрана, а отсутствие получателей. */
  const [brigades, setBrigades] = useState<readonly WorkerRow[]>([]);
  /* Месяц выбирается при первом показе графика: до загрузки этапов
     выбирать не из чего, а после — незачем спрашивать снова. */
  const [anchor, setAnchor] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [shift, setShift] = useState(0);
  const [fault, setFault] = useState<{ id: string; text: string } | null>(null);
  const [row, setRow] = useState<{ id: string; fromY: number; height: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    fetchStages(code)
      .then((next) => { setStages(next); setError(null); })
      .catch((cause: unknown) => { setError(errorMessage(cause)); });
  }, [code]);

  useEffect(() => { load(); }, [load]);

  /* Только руководителю: прораб график читает, назначать получателя ему
     нечем, и справочник организации ему в этом экране не нужен. */
  useEffect(() => {
    if (!canEdit(role)) return;
    fetchWorkers()
      .then((rows) => { setBrigades(rows.filter((row) => row.kind === "BRIGADE")); })
      .catch(() => { setBrigades([]); });
  }, [role]);

  const apply = (next: WorkStage[]): void => {
    setStages(next);
    setEditing(null);
    setPlanning(false);
    setSheetError(null);
    onEvents();
  };

  const run = (action: Promise<WorkStage[]>): void => {
    setBusy(true);
    action
      .then(apply)
      .catch((cause: unknown) => { setSheetError(errorMessage(cause)); })
      .finally(() => { setBusy(false); });
  };

  if (error !== null) return <p className="field__error" role="alert">{error}</p>;
  if (stages === null) return <p className="t-sm t-muted">Загружаем график…</p>;

  const editable = canEdit(role);

  /* Разделы, которые ещё не ведёт ни один этап, и последний день графика.
     Считаются здесь, а не приходят с сервером: этапы у экрана уже есть, и
     лишний запрос ради того, что лежит в соседней переменной, добавил бы
     состояние, способное разойтись со списком после первой же правки. */
  const ведут = new Set(stages.flatMap((stage) =>
    stage.sectionId === null ? [] : [stage.sectionId]));
  const свободные = sections.filter((section) => !ведут.has(section.id));
  const последнийДень = stages.reduce<string | null>(
    (поздний, stage) => (поздний === null || stage.endsOn > поздний ? stage.endsOn : поздний),
    null,
  );

  const width = SCALES[scale]?.width ?? 32;
  const месяц = anchor ?? firstMonth(stages, today);
  const window_: PlanWindow = monthWindow(месяц);
  const days = windowDays(window_);

  /* Перетаскивание идёт по локальному состоянию: запись уходит на
     pointerup. Иначе каждый пиксель движения давал бы запрос, а отказ
     валидатора приходил бы посреди жеста. */
  const shown = (stage: WorkStage): { startsOn: string; endsOn: string } =>
    drag !== null && drag.id === stage.id ? dragged(drag, shift) : stage;

  const startDrag = (stage: WorkStage, grip: Grip) =>
    (event: React.PointerEvent<HTMLElement>): void => {
      if (!editable || busy) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({ id: stage.id, grip, fromX: event.clientX, startsOn: stage.startsOn, endsOn: stage.endsOn });
      setShift(0);
      setFault(null);
    };

  /* Округление симметрично нулю. Math.round округляет половину к плюс
     бесконечности: −4,5 даёт −4, а +4,5 даёт +5, и отрезок, отведённый
     вправо и возвращённый на то же расстояние, встаёт на день дальше,
     чем стоял. На жесте «передумал» это выглядит как самовольный сдвиг. */
  const moveDrag = (event: React.PointerEvent<HTMLElement>): void => {
    if (drag === null) return;
    const дней = (event.clientX - drag.fromX) / width;
    setShift(Math.sign(дней) * Math.round(Math.abs(дней)));
  };

  const endDrag = (event: React.PointerEvent<HTMLElement>): void => {
    if (drag === null) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const next = dragged(drag, shift);
    const текущий = drag;
    setDrag(null);
    setShift(0);
    if (shift === 0) return;
    /* Тот же валидатор, что на сервере: отказ виден до обращения к сети. */
    const отказ = stageDateFault(next, range);
    if (отказ !== null) { setFault({ id: текущий.id, text: отказ }); return; }
    run(updateStage(code, текущий.id, next));
  };

  const move = (id: string, delta: number): void => {
    const order = stages.map((stage) => stage.id);
    const at = order.indexOf(id);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= order.length) return;
    const next = [...order];
    const [taken] = next.splice(at, 1);
    if (taken === undefined) return;
    next.splice(to, 0, taken);
    run(reorderStages(code, next));
  };

  /* Ручка перестановки работает и указателем, и с клавиатуры. Мышью
     строку тянут вертикально — так это устроено везде, и подсказки не
     требует; стрелки нужны тем, у кого указателя нет. */
  const startRow = (stage: WorkStage) =>
    (event: React.PointerEvent<HTMLButtonElement>): void => {
      if (!editable || busy) return;
      const высота = event.currentTarget.closest(".gantt__row")?.getBoundingClientRect().height ?? 0;
      if (высота === 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setRow({ id: stage.id, fromY: event.clientY, height: высота });
    };

  const endRow = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (row === null) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const шагов = Math.round((event.clientY - row.fromY) / row.height);
    const взятая = row.id;
    setRow(null);
    if (шагов !== 0) move(взятая, шагов);
  };

  const fullscreen = (): void => {
    const node = panel.current;
    if (node === null) return;
    if (document.fullscreenElement !== null) { void document.exitFullscreen(); return; }
    /* Браузер вправе отказать — обещать полный экран нечем, поэтому отказ
       превращается в обычное сообщение, а не в молчание. */
    node.requestFullscreen().catch(() => {
      setError("Браузер не дал развернуть график на весь экран.");
    });
  };

  const head = (
    <div className="section-head">
      <h3 className="t-h3">График производства работ</h3>
      {/* Перенос обязателен: в ряду четыре органа управления — два
          переключателя и две кнопки, — и на 390 px они занимают 717 px.
          Переполнялся при этом сам документ, а не дорожка графика: страница
          уезжала вбок целиком, вместе с шапкой и вкладками. */}
      <div className="row row--wrap">
        <div className="segmented" role="group" aria-label="Месяц">
          <button type="button" className="segmented__option" onClick={() => { setAnchor(shiftMonth(месяц, -1)); }}>
            <svg className="icon icon--sm" aria-hidden="true"><use href="#i-back" /></svg>
            Назад
          </button>
          <span className="segmented__label">{подписьМесяца(месяц)}</span>
          <button type="button" className="segmented__option" onClick={() => { setAnchor(shiftMonth(месяц, 1)); }}>
            Вперёд
            <svg className="icon icon--sm" aria-hidden="true"><use href="#i-crumb" /></svg>
          </button>
        </div>
        <div className="segmented" role="group" aria-label="Масштаб">
          <button
            type="button"
            className="segmented__option"
            aria-label="Мельче"
            disabled={scale === 0}
            onClick={() => { setScale(scale - 1); }}
          >
            <svg className="icon icon--sm" aria-hidden="true"><use href="#i-minus" /></svg>
          </button>
          <span className="segmented__label">{SCALES[scale]?.label ?? ""}</span>
          <button
            type="button"
            className="segmented__option"
            aria-label="Крупнее"
            disabled={scale === SCALES.length - 1}
            onClick={() => { setScale(scale + 1); }}
          >
            <svg className="icon icon--sm" aria-hidden="true"><use href="#i-plus" /></svg>
          </button>
        </div>
        <button type="button" className="btn btn--secondary" onClick={fullscreen}>
          <svg className="icon" aria-hidden="true"><use href="#i-expand" /></svg>
          На весь экран
        </button>
        {editable && свободные.length > 0 && (
          /* Показывается, только когда есть что раскладывать. Погашенная
             кнопка не объясняет, почему она погашена, а исчезнувшая хотя бы
             не обещает действия, которого нет. */
          <button type="button" className="btn btn--secondary" onClick={() => { setPlanning(true); }}>
            <svg className="icon" aria-hidden="true"><use href="#i-estimate" /></svg>
            График из сметы
          </button>
        )}
        {editable && (
          <button type="button" className="btn btn--primary" onClick={() => { setEditing({ stage: null }); }}>
            <svg className="icon" aria-hidden="true"><use href="#i-plus" /></svg>
            Добавить этап
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="stack" ref={panel}>
      {head}

      {stages.length === 0 ? (
        <p className="t-sm t-muted">
          {editable
            ? "График не заведён. Первый этап задаёт срок, от которого считается готовность объекта."
            : "График не заведён."}
        </p>
      ) : (
        <div
          className="panel"
          style={{ "--day-w": `${String(width)}px`, "--gantt-days": window_.days } as React.CSSProperties}
        >
          <div className="gantt__canvas">
            <div className="gantt__scale">
              <span className="gantt__name t-cap">Этап</span>
              <div>
                <p className="gantt__month t-cap">{подписьМесяца(месяц)}</p>
                <div className="gantt__days">
                  {days.map((day) => (
                    <span
                      key={day}
                      className={`gantt__day${isDayOff(day) ? " gantt__day--off" : ""}${day === today ? " gantt__day--today" : ""}`}
                    >
                      {Number(day.slice(8))}
                    </span>
                  ))}
                </div>
              </div>
              {/* Подписи столбцом, по одной над своим числом: строкой они не
                  помещались и обрезались на середине первого слова. */}
              <span className="gantt__pct t-cap">
                <span>Заявлено</span>
                <span>Принято</span>
              </span>
            </div>

            <div className="gantt__body">
              <div className="gantt__grid" aria-hidden="true">
                <div className="gantt__days">
                  {days.map((day) => (
                    <span
                      key={day}
                      className={`gantt__day${isDayOff(day) ? " gantt__day--off" : ""}${day === today ? " gantt__day--today" : ""}`}
                    />
                  ))}
                </div>
              </div>

              {stages.map((stage, index) => {
                const dates = shown(stage);
                const from = dayIndex(dates.startsOn, window_);
                const to = dayIndex(dates.endsOn, window_);
                const left = Math.max(0, from);
                const right = Math.min(window_.days, to + 1);
                const внутри = right > left;
                const просрочен = dates.endsOn > range.to;
                const тянут = drag !== null && drag.id === stage.id;

                return (
                  <div className="gantt__row" key={stage.id}>
                    <div className="gantt__name">
                      <button
                        type="button"
                        className="gantt__move"
                        aria-label={`Переместить этап «${stage.name}»`}
                        aria-pressed={row !== null && row.id === stage.id}
                        disabled={!editable || busy}
                        onPointerDown={startRow(stage)}
                        onPointerUp={endRow}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowUp") { event.preventDefault(); move(stage.id, -1); }
                          if (event.key === "ArrowDown") { event.preventDefault(); move(stage.id, 1); }
                        }}
                      >
                        <svg className="icon icon--sm" aria-hidden="true"><use href="#i-move" /></svg>
                      </button>
                      <span className="gantt__num">{index + 1}</span>
                      <button
                        type="button"
                        className="gantt__title"
                        title={`${stage.name}: ${stage.startsOn} — ${stage.endsOn}`}
                        onClick={() => { setEditing({ stage }); }}
                      >
                        {stage.name}
                      </button>
                    </div>

                    <div className="gantt__track">
                      {!внутри && (
                        <button
                          type="button"
                          className={to < 0 ? AWAY_CLASS.before : AWAY_CLASS.after}
                          onClick={() => { setAnchor(shiftMonth(to < 0 ? dates.endsOn : dates.startsOn, 0)); }}
                        >
                          {to < 0 && <svg className="icon icon--sm" aria-hidden="true"><use href="#i-back" /></svg>}
                          {короткийМесяц(to < 0 ? dates.endsOn : dates.startsOn)}
                          {to >= 0 && <svg className="icon icon--sm" aria-hidden="true"><use href="#i-crumb" /></svg>}
                        </button>
                      )}
                      {внутри && (
                        <div
                          className={`gantt__bar${просрочен ? " gantt__bar--late" : ""}${тянут ? " gantt__bar--drag" : ""}`}
                          style={{ "--gantt-from": left, "--gantt-span": right - left } as React.CSSProperties}
                          onPointerDown={startDrag(stage, "move")}
                          onPointerMove={moveDrag}
                          onPointerUp={endDrag}
                        >
                          <span
                            className="gantt__handle"
                            onPointerDown={startDrag(stage, "start")}
                            onPointerMove={moveDrag}
                            onPointerUp={endDrag}
                          />
                          <span
                            className="gantt__handle"
                            onPointerDown={startDrag(stage, "end")}
                            onPointerMove={moveDrag}
                            onPointerUp={endDrag}
                          />
                        </div>
                      )}
                    </div>

                    <span className="gantt__pct">
                      <b className="num">{formatPercent(BigInt(stage.progress))}</b>
                      {/* Фактическая — доля принятого в итоге раздела. Прочерк,
                          когда раздела нет: ноль означал бы «ничего не принято»,
                          а это иное утверждение. Перевыработка сигнальным цветом,
                          тем же правилом, что отрицательный остаток транша. */}
                      <span
                        className={stage.actualProgress !== null && stage.actualProgress > 10_000
                          ? "gantt__fact num gantt__fact--over"
                          : "gantt__fact num"}
                        title={stage.actualProgress === null
                          ? "Этап не связан с разделом сметы: принятое считать не по чему"
                          : "Принято по разделу сметы"}
                      >
                        {stage.actualProgress === null
                          ? "—"
                          : formatPercent(BigInt(stage.actualProgress))}
                      </span>
                    </span>

                    {fault !== null && fault.id === stage.id && (
                      <p className="gantt__hint" role="alert">{fault.text}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {sheetError !== null && editing === null && (
        <p className="field__error" role="alert">{sheetError}</p>
      )}

      {editing !== null && (
        <StageSheet
          stage={editing.stage}
          range={range}
          place={editing.stage === null ? stages.length + 1 : stages.indexOf(editing.stage) + 1}
          places={editing.stage === null ? stages.length + 1 : stages.length}
          sections={занятость(sections, stages, editing.stage)}
          brigades={brigades}
          busy={busy}
          error={sheetError}
          onSave={(stage: CreateWorkStage) => {
            run(editing.stage === null
              ? createStage(code, stage)
              : updateStage(code, editing.stage.id, stage));
          }}
          onMove={editing.stage === null ? null : (place: number) => {
            const текущий = editing.stage;
            if (текущий === null) return;
            move(текущий.id, place - 1 - stages.indexOf(текущий));
          }}
          onDelete={editing.stage === null ? null : () => {
            const текущий = editing.stage;
            if (текущий === null) return;
            run(deleteStage(code, текущий.id));
          }}
          onClose={() => { setEditing(null); setSheetError(null); }}
        />
      )}

      {planning && (
        <PlanSheet
          sections={свободные}
          range={range}
          after={последнийДень}
          busy={busy}
          error={sheetError}
          onPlan={(from, to) => { run(planStages(code, from, to)); }}
          onClose={() => { setPlanning(false); setSheetError(null); }}
        />
      )}
    </div>
  );
}
