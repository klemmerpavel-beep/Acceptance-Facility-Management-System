import { useState } from "react";
import type {
  CreateWallOpening, MeasureRoom, MeasureWall, MeasureWallOpening, UpdateWallOpening,
} from "@priyomka/contracts";
import { formatMeasure } from "@priyomka/ui";
import { milliunits, openingArea, singleWallAreaNet, type WallOpeningMeasure } from "@priyomka/domain";
import { useModalDialog } from "./modal.js";
import { toInput, toMilli } from "./RoomSheet.js";
import {
  ВИД_ПРОЁМА, ДОБАВИТЬ_ПРОЁМ, обмерПомещения, подсказкаСоседБезСтен, проёмДомена, проёмСловами, стенаДомена,
} from "./walls.js";

/**
 * Лист проёма (этап Э11, шаг 2; решения Э11-2.2 и Э11-2.4; норматив,
 * раздел 55.4).
 *
 * Открывается со строки стены: стена и вид пришли из строки и не
 * переспрашиваются. Поля — ширина, высота, откосы этой стороны; ниже —
 * необязательная вторая сторона: смежное помещение того же набора, его
 * стена и откосы той стороны. Сторона Б — только стена соседа: если у
 * выбранного помещения стен нет, полей стены и откосов нет, и лист говорит
 * словами, что проём остаётся односторонним.
 *
 * Открытый со стены соседа — стороны Б — лист показывает первую сторону
 * текстом: она заведена в другом помещении, и переставить её отсюда значило
 * бы править чужую стену из листа этой.
 */
export function OpeningSheet({
  room,
  wall,
  kind,
  opening,
  neighbours,
  revealFirst,
  busy,
  error,
  onCreate,
  onUpdate,
  onDelete,
  onClose,
}: {
  /** Помещение стены, с которой открыт лист. */
  room: MeasureRoom;
  wall: MeasureWall;
  kind: MeasureWallOpening["kind"];
  /** Заведённый проём глазами этой стены; `null` — новый. */
  opening: MeasureWallOpening | null;
  /** Другие помещения того же набора — кандидаты второй стороны. */
  neighbours: readonly MeasureRoom[];
  /** Фокус в откосы этой стороны: лист открыт привязкой со стены соседа. */
  revealFirst: boolean;
  busy: boolean;
  error: string | null;
  onCreate: (input: CreateWallOpening) => void;
  onUpdate: (input: UpdateWallOpening) => void;
  onDelete: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog<HTMLInputElement>(onClose);
  /* Первая сторона проёма, открытого со стены соседа; `null` — лист
     открыт со стороны А или проём новый. */
  const перваяСторона = opening?.side === "B" ? opening.other : null;
  const сторонаБ = перваяСторона !== null;
  const [width, setWidth] = useState(opening === null ? "" : toInput(opening.width));
  const [height, setHeight] = useState(opening === null ? "" : toInput(opening.height));
  const [reveal, setReveal] = useState(opening?.reveal == null ? "" : toInput(opening.reveal));
  const [соседId, setСоседId] = useState(opening?.other?.roomId ?? "");
  const [стенаСоседа, setСтенаСоседа] = useState(opening?.other?.wallId ?? "");
  const [откосыСоседа, setОткосыСоседа] = useState(opening?.other?.reveal == null ? "" : toInput(opening.other.reveal));
  const [удаляю, setУдаляю] = useState(false);

  const ширина = toMilli(width);
  const высота = toMilli(height);
  const откосы = reveal.trim() === "" ? null : toMilli(reveal);
  const откосыТой = откосыСоседа.trim() === "" ? null : toMilli(откосыСоседа);
  const размерыВерны = ширина !== null && ширина !== "0" && высота !== null && высота !== "0";
  const ready = размерыВерны && (reveal.trim() === "" || откосы !== null)
    && (откосыСоседа.trim() === "" || откосыТой !== null);

  const сосед = neighbours.find((комната) => комната.id === соседId) ?? null;
  const стенаБ = сосед?.walls.find((стена) => стена.id === стенаСоседа) ?? null;

  /* Площадь проёма и что станет с нетто этой стены — тем же доменом, что
     сервер: проём на стене вычитается с любой стороны. */
  const обмер = обмерПомещения(room);
  const своя = стенаДомена(wall);
  const прежние = (обмер.wallOpenings ?? []).filter((проём) => проём.id !== opening?.id);
  const новый: WallOpeningMeasure | null = !размерыВерны ? null : {
    ...(opening === null
      ? { id: "новый", kind, wallId: wall.id, adjoiningWallId: null, reveal: null, adjoiningReveal: null }
      : проёмДомена(wall, opening)),
    width: milliunits(ширина),
    height: milliunits(высота),
  };
  const нетто = singleWallAreaNet(обмер, своя);
  const неттоПосле = singleWallAreaNet({ ...обмер, wallOpenings: новый === null ? прежние : [...прежние, новый] }, своя);

  const submit: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!ready) return;
    const размеры = { width: ширина, height: высота };
    if (сторонаБ) {
      /* Эта стена — сторона Б: её откосы — `adjoiningReveal`, откосы первой
         стороны — `reveal`. Привязка не трогается. */
      onUpdate({ ...размеры, reveal: откосыТой, adjoiningReveal: откосы });
      return;
    }
    const привязка = стенаБ === null
      ? { adjoiningWallId: null, adjoiningReveal: null }
      : { adjoiningWallId: стенаБ.id, adjoiningReveal: откосыТой };
    if (opening === null) onCreate({ kind, ...размеры, reveal: откосы, ...привязка });
    else onUpdate({ ...размеры, reveal: откосы, ...привязка });
  };

  const высотаСтены = wall.height === null
    ? `${formatMeasure(BigInt(room.height), "м")}, высота как у помещения`
    : formatMeasure(BigInt(wall.height), "м");

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div
        className="sheet sheet--tall"
        role="dialog"
        aria-modal="true"
        aria-label={opening === null ? `${ВИД_ПРОЁМА[kind]}: новый проём` : `Проём: ${проёмСловами(opening)}`}
        ref={dialog}
      >
        <div>
          <p className="t-h3">{ВИД_ПРОЁМА[kind]} · {room.name}, {wall.name}</p>
          <p className="t-sm t-muted">
            {wall.name} — {formatMeasure(BigInt(wall.length), "м").replace(/\u00A0м$/u, "")} × {высотаСтены}
          </p>
        </div>

        {удаляю && opening !== null ? (
          <div className="stack stack--tight" role="group" aria-label="Удаление проёма">
            <p className="t-body">
              {проёмСловами(opening)} удалится с обеих сторон: у помещения «{room.name}»
              {opening.other === null ? "" : ` и у помещения «${opening.other.roomName}»`}.
              Площадь стены нетто «{wall.name}»: {formatMeasure(нетто, "м²")} →{" "}
              {formatMeasure(singleWallAreaNet({ ...обмер, wallOpenings: прежние }, своя), "м²")}.
            </p>
            {error !== null && <p className="field__error" role="alert">{error}</p>}
            <button type="button" className="btn btn--danger btn--block" disabled={busy} onClick={onDelete}>
              Удалить проём
            </button>
            <button type="button" className="btn btn--text btn--block" onClick={() => { setУдаляю(false); }}>
              Не удалять
            </button>
          </div>
        ) : (
          <form className="stack stack--tight" onSubmit={submit}>
            <div className="openings">
              <div className="row">
                <label className="field">
                  <span className="field__label">Ширина, м</span>
                  <input
                    ref={revealFirst ? undefined : first}
                    className="input input--num"
                    inputMode="decimal"
                    value={width}
                    aria-invalid={width !== "" && (ширина === null || ширина === "0")}
                    onChange={(event) => { setWidth(event.target.value); }}
                  />
                </label>
                <label className="field">
                  <span className="field__label">Высота, м</span>
                  <input
                    className="input input--num"
                    inputMode="decimal"
                    value={height}
                    aria-invalid={height !== "" && (высота === null || высота === "0")}
                    onChange={(event) => { setHeight(event.target.value); }}
                  />
                </label>
              </div>
            </div>
            {новый !== null && (
              <p className="spec spec--col">
                <span className="spec__item">
                  Площадь проёма<span className="spec__value">{formatMeasure(openingArea(новый), "м²")}</span>
                </span>
                <span className="spec__item">
                  Площадь стены нетто
                  <span className="spec__value">{formatMeasure(нетто, "")}→ {formatMeasure(неттоПосле, "м²")}</span>
                </span>
              </p>
            )}

            <label className="field">
              <span className="field__label">Откосы этой стороны, м.п.</span>
              <input
                ref={revealFirst ? first : undefined}
                className="input input--num"
                inputMode="decimal"
                value={reveal}
                aria-invalid={reveal.trim() !== "" && откосы === null}
                onChange={(event) => { setReveal(event.target.value); }}
              />
            </label>

            {/* Вторая сторона — необязательна (решение Э11-2.2 «а»). */}
            <fieldset className="openings stack stack--tight">
              <legend className="field__label--cap">Вторая сторона — необязательно</legend>
              {перваяСторона !== null ? (
                <>
                  <p className="t-sm">
                    Первая сторона — помещение «{перваяСторона.roomName}», {перваяСторона.wallName}: проём заведён там.
                  </p>
                  <label className="field">
                    <span className="field__label">Откосы той стороны, м.п.</span>
                    <input
                      className="input input--num"
                      inputMode="decimal"
                      value={откосыСоседа}
                      aria-invalid={откосыСоседа.trim() !== "" && откосыТой === null}
                      onChange={(event) => { setОткосыСоседа(event.target.value); }}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="field">
                    <span className="field__label">Смежное помещение</span>
                    <span className="selectwrap">
                      <select
                        className="input"
                        value={соседId}
                        onChange={(event) => {
                          setСоседId(event.target.value);
                          setСтенаСоседа("");
                          setОткосыСоседа("");
                        }}
                      >
                        <option value="">Не выбрано</option>
                        {neighbours.map((комната) => (
                          <option key={комната.id} value={комната.id}>{комната.name}</option>
                        ))}
                      </select>
                      <svg className="icon selectwrap__chevron" aria-hidden="true"><use href="#i-chevron" /></svg>
                    </span>
                  </label>
                  {сосед !== null && сосед.walls.length === 0 && (
                    <p className="field__hint" role="status">{подсказкаСоседБезСтен(kind, сосед.name)}</p>
                  )}
                  {сосед !== null && сосед.walls.length > 0 && (
                    <>
                      <label className="field">
                        <span className="field__label">Стена</span>
                        <span className="selectwrap">
                          <select
                            className="input"
                            value={стенаСоседа}
                            onChange={(event) => { setСтенаСоседа(event.target.value); }}
                          >
                            <option value="">Не выбрано</option>
                            {сосед.walls.map((стена) => (
                              <option key={стена.id} value={стена.id}>{стена.name}</option>
                            ))}
                          </select>
                          <svg className="icon selectwrap__chevron" aria-hidden="true"><use href="#i-chevron" /></svg>
                        </span>
                        {стенаБ === null && (
                          <span className="field__hint">Без стены соседа вторая сторона не привязана.</span>
                        )}
                      </label>
                      {стенаБ !== null && (
                        <label className="field">
                          <span className="field__label">Откосы той стороны, м.п.</span>
                          <input
                            className="input input--num"
                            inputMode="decimal"
                            value={откосыСоседа}
                            aria-invalid={откосыСоседа.trim() !== "" && откосыТой === null}
                            onChange={(event) => { setОткосыСоседа(event.target.value); }}
                          />
                        </label>
                      )}
                    </>
                  )}
                </>
              )}
            </fieldset>

            {!ready && (width !== "" || height !== "") && (
              <p className="field__hint">Ширина и высота — в метрах с запятой, «0,8»; откосы — пусто или число.</p>
            )}
            {error !== null && <p className="field__error" role="alert">{error}</p>}

            <button type="submit" className="btn btn--primary btn--block" disabled={busy || !ready}>
              {opening === null ? ДОБАВИТЬ_ПРОЁМ[kind] : "Сохранить"}
            </button>
            {opening !== null && (
              <button type="button" className="btn btn--text btn--block" onClick={() => { setУдаляю(true); }}>
                Удалить проём
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
