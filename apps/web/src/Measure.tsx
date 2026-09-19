import { useCallback, useEffect, useState } from "react";
import { завести } from "./verbs.js";
import type {
  CreateMeasureRoom, MeasureRoom, MeasureSetKind, MeasureView, Role,
} from "@priyomka/contracts";
import { ownerLevel } from "@priyomka/domain";
import { formatMeasure } from "@priyomka/ui";
import {
  createRoom, deletePlan, deleteRoom, errorMessage, fetchMeasure, planUrl, updateRoom, uploadPlan,
} from "./api.js";
import { RoomSheet } from "./RoomSheet.js";
import { Announce } from "./Announce.js";

/**
 * Вкладка «Замер» карточки объекта.
 *
 * Вопрос экрана: сколько чего в помещениях. Ключевое действие: внести
 * помещение — единственная первичная кнопка.
 *
 * Величины показываются с двумя знаками после запятой всегда: обмерный
 * план читается столбцом, и «18,4» рядом с «18,40» заставляет проверять,
 * одно ли это число.
 *
 * **Наборов обмера два: начальный и после перепланировки.** Переключатель
 * между ними появился 13.09.2026; до того набор был один, и переключателя
 * не было по правилу допуска (`07_IA.md`, раздел 7) — показывать нечего.
 *
 * Второй набор стоит рядом с первым, а не поверх него. Довод: по начальному
 * обмеру считалась смета, и вопрос «почему в смете 18,40, а в обмере 22,10»
 * задают через месяц. Перепись начального набора поверх стёрла бы ответ.
 *
 * Переключатель показывается не всегда. Читателю, у которого объект без
 * перепланировки, переключать нечего — и пустая вторая вкладка сообщала бы
 * о существовании того, чего нет. Правящему он нужен всегда: иначе завести
 * второй набор не с чего начать.
 */

/** Подписи наборов. Порядок — хронологический, а не алфавитный. */
const НАБОРЫ = [
  ["INITIAL", "Начальный"],
  ["REPLANNED", "После перепланировки"],
] as const;

/** Кто вправе править обмер. Замер снимается на объекте — это работа прораба. */
const canEdit = (role: Role): boolean => ownerLevel(role) || role === "FOREMAN";

const TOTALS = [
  { key: "floorArea", label: "Площадь", unit: "м²" },
  { key: "wallArea", label: "Площадь стен", unit: "м²" },
  { key: "ceilingPerimeter", label: "Периметр потолка", unit: "м.п." },
  { key: "floorPerimeter", label: "Периметр пола", unit: "м.п." },
  { key: "volume", label: "Объём", unit: "м³" },
] as const;

const ROOM_BASE = [
  { key: "floorArea", label: "Площадь", unit: "м²" },
  { key: "wallArea", label: "Площадь стен", unit: "м²" },
  { key: "height", label: "Высота", unit: "м" },
  { key: "volume", label: "Объём", unit: "м³" },
] as const;

const ROOM_DETAIL = [
  { key: "ceilingPerimeter", label: "Периметр потолка", unit: "м.п." },
  { key: "floorPerimeter", label: "Периметр пола", unit: "м.п." },
] as const;

const KIND_LABEL = { WINDOW: "Окна", DOOR: "Двери" } as const;

export function Measure({
  code,
  address,
  role,
  onEvents,
}: {
  code: string;
  address: string;
  role: Role;
  onEvents: () => void;
}): React.JSX.Element {
  const [view, setView] = useState<MeasureView | null>(null);
  const [set, setSet] = useState<MeasureSetKind>("INITIAL");
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [detailed, setDetailed] = useState(false);
  const [editing, setEditing] = useState<{ room: MeasureRoom | null } | null>(null);
  const [busy, setBusy] = useState(false);
  /* Добавленное и удалённое помещение видно перерисовкой списка —
     перерисовка чтением с экрана не объявляется. */
  const [объявление, setОбъявление] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchMeasure(code, set)
      .then((next) => { setView(next); setError(null); })
      .catch((cause: unknown) => { setError(errorMessage(cause)); });
  }, [code, set]);

  useEffect(() => { load(); }, [load]);

  /* Смена набора снимает выбор помещения: «Кухня» начального набора и
     «Кухня» после перепланировки — разные записи, и оставленный
     опознаватель показал бы пустую карточку. */
  const выбратьНабор = (следующий: MeasureSetKind): void => {
    setSet(следующий);
    setCurrent(null);
    setView(null);
  };

  const apply = (next: MeasureView): void => {
    setView(next);
    setEditing(null);
    setSheetError(null);
    onEvents();
  };

  const run = (action: Promise<MeasureView>, сказать: string): void => {
    setBusy(true);
    action
      .then((next) => { apply(next); setОбъявление(сказать); })
      .catch((cause: unknown) => { setSheetError(errorMessage(cause)); })
      .finally(() => { setBusy(false); });
  };

  if (error !== null) return <p className="field__error" role="alert">{error}</p>;
  if (view === null) return <p className="t-sm t-muted">Загружаем обмер…</p>;

  const editable = canEdit(role);
  const rooms = view.rooms;
  const selected = rooms.find((room) => room.id === current) ?? rooms[0] ?? null;

  const plan = (
    <div className="stack stack--tight">
      <p className="field__label--cap">План объекта</p>
      {view.plan === null ? (
        <>
          <p className="t-sm t-muted">
            {editable
              ? "Снимок плана не загружен. Приложите фотографию или изображение — JPEG, PNG или WebP."
              : "Снимок плана не загружен."}
          </p>
          {editable && (
            /* Тот же образец выбора файла, что у импорта сметы: браузерная
               кнопка «Choose file» стоит на английском и не подчиняется
               оформлению продукта. */
            <label className="filefield">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file !== undefined) run(uploadPlan(code, set, file), "Обмерный план загружен");
                }}
              />
              <span className="filefield__button">
                <svg className="icon" aria-hidden="true"><use href="#i-expense" /></svg>
                Выбрать снимок
              </span>
              <span className="filefield__name">файл не выбран</span>
            </label>
          )}
        </>
      ) : (
        <>
          <img className="measure__plan" src={planUrl(code, set)} alt={`План объекта ${code}`} />
          <p className="t-sm t-muted">
            {view.plan.fileName}
            {view.plan.uploadedBy === null ? "" : `, загрузил ${view.plan.uploadedBy}`}
          </p>
          {editable && (
            <button
              type="button"
              className="btn btn--text"
              disabled={busy}
              onClick={() => { run(deletePlan(code, set), "Обмерный план снят"); }}
            >
              Снять план
            </button>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="stack stack--loose">
      {/* Экранная часть отделена классом, чтобы печать прятала её целиком.
          Перечислять на листе всё, чего там не должно быть, — значит
          забыть очередной блок на следующей правке. */}
      <div className="measure-screen stack stack--loose">
      <Announce text={объявление} />
      {(editable || view.filled.includes("REPLANNED")) && (
        <div className="segmented" role="group" aria-label="Набор обмера">
          {НАБОРЫ.map(([значение, подпись]) => (
            <button
              key={значение}
              type="button"
              className="segmented__option"
              aria-pressed={set === значение}
              onClick={() => { выбратьНабор(значение); }}
            >
              {подпись}
            </button>
          ))}
        </div>
      )}

      <div className="stack stack--tight">
        <p className="field__label--cap">Общее</p>
        <p className="spec">
          <span className="spec__item">
            Помещений<span className="spec__value">{view.totals.rooms}</span>
          </span>
          {TOTALS.map((line) => (
            <span className="spec__item" key={line.key}>
              {line.label}
              <span className="spec__value">{formatMeasure(BigInt(view.totals[line.key]), line.unit)}</span>
            </span>
          ))}
        </p>
      </div>

      {rooms.length === 0 || selected === null ? (
          <div className="empty">
            <p className="empty__title">
              {set === "REPLANNED" ? "Перепланировку не обмеряли" : "Обмер не внесён"}
            </p>
            {/* У второго набора довод свой: он заводится не «потому что
                пусто», а тогда, когда перегородки уже снесены. Приглашать
                внести его на объекте без перепланировки было бы указанием
                сделать то, чего не делали. */}
            <p className="empty__text">
              {set === "REPLANNED"
                ? (editable
                  ? "Второй набор заводят после того, как перегородки сняты и площади изменились. Начальный обмер остаётся на месте: по нему считалась смета."
                  : "Перепланировку обмеряет прораб или руководитель на объекте.")
                : (editable
                  ? "Помещения, их площади, периметры и высоты. Отсюда площади уйдут в смету количествами позиций."
                  : "Помещения вносит прораб или руководитель на объекте.")}
            </p>
            {editable && (
              <button type="button" className="btn btn--primary" onClick={() => { setEditing({ room: null }); }}>
                {завести("помещение")}
              </button>
            )}
          </div>
        ) : (
          <div className="stack stack--tight">
            <div className="measure">
              {/* Список помещений — навигация, а не вкладки: «aria-selected»
                  вне «role="tab"» недействителен, и чтение с экрана его
                  молча теряет. Выбранное помещение помечается «aria-current»
                  — тем же атрибутом, что выбранный раздел в шапке. */}
              <nav className="measure__nav" aria-label="Помещения">
                {rooms.map((room) => (
                  <button
                    key={room.id}
                    type="button"
                    className="measure__item"
                    aria-current={room.id === selected.id ? "true" : undefined}
                    onClick={() => { setCurrent(room.id); }}
                  >
                    {room.name}
                  </button>
                ))}
              </nav>

              <div>
                <div className="measure__head">
                  <span className="t-h2">{selected.name}</span>
                  <button
                    type="button"
                    className="toggle toggle--inv"
                    role="switch"
                    aria-checked={detailed}
                    onClick={() => { setDetailed((on) => !on); }}
                  >
                    <span className="toggle__track"><span className="toggle__knob" /></span>
                    <span className="toggle__name">Подробный</span>
                  </button>
                </div>

                <div className="measure__grid">
                  <div>
                    <p className="measure__cap">Основное</p>
                    <p className="spec spec--col spec--inv">
                      {ROOM_BASE.map((line) => (
                        <span className="spec__item" key={line.key}>
                          {line.label}
                          <span className="spec__value">{formatMeasure(BigInt(selected[line.key]), line.unit)}</span>
                        </span>
                      ))}
                      {detailed && ROOM_DETAIL.map((line) => (
                        <span className="spec__item" key={line.key}>
                          {line.label}
                          <span className="spec__value">{formatMeasure(BigInt(selected[line.key]), line.unit)}</span>
                        </span>
                      ))}
                    </p>
                  </div>

                  {(["WINDOW", "DOOR"] as const).map((kind) => {
                    const opening = selected.openings.find((item) => item.kind === kind);
                    return (
                      <div key={kind}>
                        <p className="measure__cap">{KIND_LABEL[kind]}</p>
                        {opening === undefined ? (
                          <p className="spec spec--col spec--inv">
                            <span className="spec__item">Количество<span className="spec__value">0</span></span>
                          </p>
                        ) : (
                          <p className="spec spec--col spec--inv">
                            <span className="spec__item">
                              Количество<span className="spec__value">{opening.count}</span>
                            </span>
                            <span className="spec__item">
                              Площадь<span className="spec__value">{formatMeasure(BigInt(opening.area), "м²")}</span>
                            </span>
                            {detailed && (
                              <span className="spec__item">
                                Откосы<span className="spec__value">{formatMeasure(BigInt(opening.reveal), "м.п.")}</span>
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {editable && (
              <div className="row row--wrap">
                <button type="button" className="btn btn--primary" onClick={() => { setEditing({ room: null }); }}>
                  {завести("помещение")}
                </button>
                <button type="button" className="btn btn--secondary" onClick={() => { setEditing({ room: selected }); }}>
                  Править помещение
                </button>
              </div>
            )}
        </div>
      )}

      {rooms.length > 0 && (
        <div className="stack stack--tight">
          <button type="button" className="btn btn--secondary" onClick={() => { window.print(); }}>
            Печать обмера
          </button>
          <p className="t-sm t-muted">
            Печатный вид открывается в браузере: PDF сохраняется его средствами, без выгрузки на сервер.
          </p>
        </div>
      )}

      {plan}
      </div>

      {/* Ведомость печати: на экране её нет, в печати нет всего остального.
          Лист обмера — таблица помещений, а не снимок интерфейса. */}
      <section className="measure-print" aria-hidden="true">
        <div className="measure-print__head">
          <p className="t-h2">Обмерный план объекта {code}</p>
          <p className="t-sm t-muted">
            {address}. Лист сформирован {new Date().toLocaleDateString("ru-RU")}.
          </p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Помещение</th><th>Площадь, м²</th><th>Периметр пола, м.п.</th>
              <th>Периметр потолка, м.п.</th><th>Высота, м</th>
              <th>Площадь стен, м²</th><th>Объём, м³</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((room) => (
              <tr key={room.id}>
                <td>{room.name}</td>
                <td>{formatMeasure(BigInt(room.floorArea), "")}</td>
                <td>{formatMeasure(BigInt(room.floorPerimeter), "")}</td>
                <td>{formatMeasure(BigInt(room.ceilingPerimeter), "")}</td>
                <td>{formatMeasure(BigInt(room.height), "")}</td>
                <td>{formatMeasure(BigInt(room.wallArea), "")}</td>
                <td>{formatMeasure(BigInt(room.volume), "")}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Итого, помещений {view.totals.rooms}</td>
              <td>{formatMeasure(BigInt(view.totals.floorArea), "")}</td>
              <td>{formatMeasure(BigInt(view.totals.floorPerimeter), "")}</td>
              <td>{formatMeasure(BigInt(view.totals.ceilingPerimeter), "")}</td>
              <td>—</td>
              <td>{formatMeasure(BigInt(view.totals.wallArea), "")}</td>
              <td>{formatMeasure(BigInt(view.totals.volume), "")}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      {editing !== null && (
        <RoomSheet
          room={editing.room}
          busy={busy}
          error={sheetError}
          onSave={(room: CreateMeasureRoom) => {
            run(editing.room === null ? createRoom(code, set, room) : updateRoom(code, editing.room.id, room),
              editing.room === null ? `Помещение «${room.name}» добавлено` : `Помещение «${room.name}» изменено`);
          }}
          onDelete={editing.room === null ? null : () => {
            const id = editing.room?.id;
            if (id !== undefined) { setCurrent(null); run(deleteRoom(code, id), "Помещение удалено"); }
          }}
          onClose={() => { setEditing(null); setSheetError(null); }}
        />
      )}
    </div>
  );
}
