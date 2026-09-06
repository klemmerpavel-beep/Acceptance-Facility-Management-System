import { useState } from "react";
import type { CreateWorkStage, WorkStage } from "@priyomka/contracts";
import { stageDateFault, type ProjectRange } from "@priyomka/domain";
import { useModalDialog } from "./modal.js";
import { STAGE_NAMES } from "./stageNames.js";

/**
 * Ввод и правка этапа графика.
 *
 * Лист — не дубль перетаскивания, а второй путь к тому же действию.
 * Перетаскивание недоступно с клавиатуры и неточно на касании, поэтому
 * даты правятся ещё и полями; место в графике меняется выбором номера, а
 * не только ручкой в строке (норматив раздела 7: у каждого действия есть
 * путь без указателя).
 *
 * Валидатор дат тот же, что на сервере: `stageDateFault` из домена.
 * Второй свод правил на экране разошёлся бы с серверным на первой правке,
 * и человек получал бы отказ там, где экран обещал согласие.
 */

/** Проценты строкой → базисные пункты целым: «85,57» → 8557. */
export function toBasisPoints(input: string): number | null {
  const cleaned = input.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole = "0", fraction = ""] = cleaned.split(".");
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return value > 10_000 ? null : value;
}

/** Базисные пункты → проценты строкой для поля: 8557 → «85,57». */
const toPercent = (points: number): string => {
  const whole = Math.trunc(points / 100);
  const fraction = String(points % 100).padStart(2, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${String(whole)},${fraction}` : String(whole);
};

export function StageSheet({
  stage,
  range,
  place,
  places,
  busy,
  error,
  onSave,
  onMove,
  onDelete,
  onClose,
}: {
  stage: WorkStage | null;
  range: ProjectRange;
  place: number;
  places: number;
  busy: boolean;
  error: string | null;
  onSave: (stage: CreateWorkStage) => void;
  onMove: ((place: number) => void) | null;
  onDelete: (() => void) | null;
  onClose: () => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog<HTMLInputElement>(onClose);
  const [name, setName] = useState(stage?.name ?? "");
  const [startsOn, setStartsOn] = useState(stage?.startsOn ?? range.from);
  const [endsOn, setEndsOn] = useState(stage?.endsOn ?? range.from);
  const [progress, setProgress] = useState(stage === null ? "0" : toPercent(stage.progress));
  const [confirming, setConfirming] = useState(false);

  const points = toBasisPoints(progress);
  const fault = stageDateFault({ startsOn, endsOn }, range);
  const ready = name.trim().length > 0 && points !== null && fault === null;

  const submit: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!ready) return;
    onSave({ name: name.trim(), startsOn, endsOn, progress: points });
  };

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={stage === null ? "Новый этап" : `Этап «${stage.name}»`}
        ref={dialog}
      >
        <p className="t-h3">{stage === null ? "Новый этап" : stage.name}</p>

        {confirming && onDelete !== null ? (
          /* Названо последствие, а не задан вопрос «вы уверены» (норматив 15.6).
             Готовность объекта считается взвешиванием по длительности этапов,
             поэтому снятие этапа её меняет — об этом сказано прямо. */
          <div className="stack stack--tight">
            <p className="t-body">
              Этап «{stage?.name ?? ""}» будет снят с графика вместе со своими сроками
              и заявленной готовностью. Готовность объекта пересчитается по оставшимся
              этапам. Записанное в журнале объекта останется.
            </p>
            <button type="button" className="btn btn--danger btn--block" disabled={busy} onClick={onDelete}>
              Снять этап
            </button>
            <button type="button" className="btn btn--text btn--block" onClick={() => { setConfirming(false); }}>
              Отмена
            </button>
          </div>
        ) : (
          <form className="stack stack--tight" onSubmit={submit}>
            <label className="field">
              <span className="field__label">Название</span>
              <input
                ref={first}
                className="input"
                list="stage-names"
                value={name}
                maxLength={60}
                onChange={(event) => { setName(event.target.value); }}
              />
            </label>
            <datalist id="stage-names">
              {STAGE_NAMES.map((typical) => <option key={typical} value={typical} />)}
            </datalist>

            <label className="field">
              <span className="field__label">Начало</span>
              <input
                className="input"
                type="date"
                value={startsOn}
                onChange={(event) => { setStartsOn(event.target.value); }}
              />
            </label>

            <label className="field">
              <span className="field__label">Окончание</span>
              <input
                className="input"
                type="date"
                value={endsOn}
                aria-invalid={fault !== null}
                onChange={(event) => { setEndsOn(event.target.value); }}
              />
            </label>

            <label className="field">
              <span className="field__label">Заявленная готовность, %</span>
              <input
                className="input input--num"
                inputMode="decimal"
                value={progress}
                aria-invalid={progress !== "" && points === null}
                onChange={(event) => { setProgress(event.target.value); }}
              />
            </label>

            <p className="field__hint">
              Готовность заявленная: до приёмки подтвердить её нечем.
            </p>

            {onMove !== null && (
              <label className="field">
                <span className="field__label">Место в графике</span>
                <select
                  className="input"
                  value={place}
                  disabled={busy}
                  onChange={(event) => { onMove(Number(event.target.value)); }}
                >
                  {[...Array(places).keys()].map((index) => index + 1).map((number) => (
                    <option key={number} value={number}>{number}</option>
                  ))}
                </select>
              </label>
            )}

            {fault !== null && <p className="field__error" role="alert">{fault}</p>}
            {error !== null && <p className="field__error" role="alert">{error}</p>}

            <button type="submit" className="btn btn--primary btn--block" disabled={busy || !ready}>
              {stage === null ? "Завести этап" : "Сохранить"}
            </button>
            {onDelete !== null && (
              <button type="button" className="btn btn--text btn--block" onClick={() => { setConfirming(true); }}>
                Снять этап
              </button>
            )}
            <button type="button" className="btn btn--text btn--block" onClick={onClose}>
              Отмена
            </button>
          </form>
        )}
      </div>
    </>
  );
}
