import { useCallback, useEffect, useState } from "react";
import { завести } from "./verbs.js";
import type {
  CreateMeasureRoom, MeasureRoom, MeasureSetKind, MeasureView, MeasureWallOpening, Role,
} from "@priyomka/contracts";
import { ownerLevel, wallAreaNetWarning } from "@priyomka/domain";
import { formatMeasure } from "@priyomka/ui";
import {
  createOpening, createRoom, deleteOpening, deletePlan, deleteRoom, errorMessage, fetchMeasure, planUrl,
  updateOpening, updateRoom, uploadPlan,
} from "./api.js";
import { RoomSheet, type ПослеСохранения } from "./RoomSheet.js";
import { OpeningSheet } from "./OpeningSheet.js";
import { Announce } from "./Announce.js";
import { обмерПомещения, проёмыВидаПоСтенам } from "./walls.js";

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

/* Площадь стен — двумя величинами рядом (этап Э11, шаг 1): прежняя, без
   вычета проёмов, и нетто — за вычетом площади окон и дверей. Прежняя
   подпись не меняется: по этой величине подставлены количества прежних
   смет, и переименование выдало бы её за другую. «Площадь стен нетто» —
   слово решения заказчика 07.11.2026 (`01_PROJECT.md`, редакция 1.23). */
const TOTALS = [
  { key: "floorArea", label: "Площадь", unit: "м²" },
  { key: "wallArea", label: "Площадь стен", unit: "м²" },
  { key: "wallAreaNet", label: "Площадь стен нетто", unit: "м²" },
  { key: "ceilingPerimeter", label: "Периметр потолка", unit: "м.п." },
  { key: "floorPerimeter", label: "Периметр пола", unit: "м.п." },
  { key: "volume", label: "Объём", unit: "м³" },
] as const;

const ROOM_BASE = [
  { key: "floorArea", label: "Площадь", unit: "м²" },
  { key: "wallArea", label: "Площадь стен", unit: "м²" },
  { key: "wallAreaNet", label: "Площадь стен нетто", unit: "м²" },
  { key: "height", label: "Высота", unit: "м" },
  { key: "volume", label: "Объём", unit: "м³" },
] as const;

const ROOM_DETAIL = [
  { key: "ceilingPerimeter", label: "Периметр потолка", unit: "м.п." },
  { key: "floorPerimeter", label: "Периметр пола", unit: "м.п." },
] as const;

const KIND_LABEL = { WINDOW: "Окна", DOOR: "Двери" } as const;

/**
 * Открытый лист вкладки. Лист проёма открывается со строки стены листа
 * помещения и возвращает в него (`07_IA.md`, раздел 11.2): после сохранения
 * проёма прораб продолжает с той же стеной, а не ищет помещение заново.
 * `ключ` пересоздаёт лист помещения из сохранённого: после сохранения его
 * поля равны ответу сервера, а не набранному.
 */
type Лист =
  | { вид: "помещение"; room: MeasureRoom | null; ключ: number; стена?: string }
  | {
      вид: "проём";
      roomId: string;
      wallId: string;
      kind: MeasureWallOpening["kind"];
      openingId: string | null;
      откосы: boolean;
    };

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
  const [лист, setЛист] = useState<Лист | null>(null);
  const [busy, setBusy] = useState(false);
  /* Добавленное и удалённое помещение видно перерисовкой списка —
     перерисовка чтением с экрана не объявляется. */
  const [объявление, setОбъявление] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  /* Снятие плана удаляет файл: вернуть его можно только новой загрузкой.
     Действие называет последствие до того, как случится (норматив 15.6;
     полный аудит 30.09.2026, П-46). */
  const [снимаюПлан, setСнимаюПлан] = useState(false);

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

  const apply = (next: MeasureView, затем: Лист | null = null): void => {
    setView(next);
    setЛист(затем);
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

  /** Лист помещения заново из сохранённого — после проёма и удаления стены. */
  const кПомещению = (next: MeasureView, roomId: string, стена?: string): Лист | null => {
    const room = next.rooms.find((строка) => строка.id === roomId);
    return room === undefined ? null : { вид: "помещение", room, ключ: Date.now(), ...(стена === undefined ? {} : { стена }) };
  };

  /**
   * Сохранение листа помещения и следующее действие (этап Э11, шаг 2).
   * Проём, его правка и привязка второй стороны живут на сохранённой стене:
   * лист с несохранённым сначала сохраняется, затем открывается лист проёма
   * той стены — по месту строки, опознавателя у новой стены до сохранения нет.
   */
  const сохранитьПомещение = (
    прежнее: MeasureRoom | null,
    body: CreateMeasureRoom | null,
    после: ПослеСохранения | undefined,
  ): void => {
    if (view === null) return;
    setBusy(true);
    const сохранено: Promise<MeasureView> = body === null
      ? Promise.resolve(view)
      : прежнее === null ? createRoom(code, set, body) : updateRoom(code, прежнее.id, body);
    const сказано = body === null
      ? null
      : прежнее === null ? `Помещение «${body.name}» добавлено` : `Помещение «${body.name}» изменено`;
    сохранено
      .then(async (next) => {
        const room = прежнее === null
          ? next.rooms.find((строка) => строка.name === body?.name)
          : next.rooms.find((строка) => строка.id === прежнее.id);
        if (после === undefined || room === undefined) {
          apply(next);
          setОбъявление(сказано);
          return;
        }
        if (после.вид === "остаться") {
          apply(next, кПомещению(next, room.id));
          setОбъявление(сказано);
          return;
        }
        const wall = room.walls.find((стена) => стена.order === после.стена);
        if (wall === undefined) {
          apply(next, кПомещению(next, room.id));
          return;
        }
        if (после.вид === "проём") {
          apply(next, { вид: "проём", roomId: room.id, wallId: wall.id, kind: после.kind, openingId: null, откосы: false });
          return;
        }
        if (после.вид === "правка проёма") {
          const проём = wall.openings.find((строка) => строка.id === после.openingId);
          apply(next, проём === undefined ? кПомещению(next, room.id) : {
            вид: "проём", roomId: room.id, wallId: wall.id, kind: проём.kind, openingId: проём.id, откосы: false,
          });
          return;
        }
        /* Привязка второй стороны одним касанием (решение Э11-2.2 «а»): проём
           соседа встаёт на эту стену, и лист открывается на откосах этой
           стороны — их меряют по месту.

           Сохранённое помещение применяется до привязки: это второй запрос,
           и если он откажет — проём удалили в другой сессии, оборвалась
           сеть, — лист остаётся на сохранённом помещении с отказом, а не на
           «Новом помещении», повторное заведение которого получило бы отказ
           «уже есть», и не на несохранённой строке, повторное сохранение
           которой завело бы стену второй раз (П-89). */
        if (body !== null) {
          apply(next, кПомещению(next, room.id));
          setОбъявление(сказано);
        }
        const привязано = await updateOpening(code, после.openingId, { adjoiningWallId: wall.id });
        const проём = привязано.rooms.find((строка) => строка.id === room.id)?.walls
          .find((стена) => стена.id === wall.id)?.openings.find((строка) => строка.id === после.openingId);
        apply(привязано, проём === undefined ? кПомещению(привязано, room.id) : {
          вид: "проём", roomId: room.id, wallId: wall.id, kind: проём.kind, openingId: проём.id, откосы: true,
        });
        setОбъявление(`Проём привязан к стене «${wall.name}»`);
      })
      .catch((cause: unknown) => { setSheetError(errorMessage(cause)); })
      .finally(() => { setBusy(false); });
  };

  /** Действие листа проёма: после него — снова лист помещения. */
  const проёмом = (action: Promise<MeasureView>, roomId: string, wallId: string, сказать: string): void => {
    setBusy(true);
    action
      .then((next) => { apply(next, кПомещению(next, roomId, wallId)); setОбъявление(сказать); })
      .catch((cause: unknown) => { setSheetError(errorMessage(cause)); })
      .finally(() => { setBusy(false); });
  };

  if (error !== null) return <p className="field__error" role="alert">{error}</p>;
  if (view === null) return <p className="t-sm t-muted">Загружаем обмер…</p>;

  const editable = canEdit(role);
  const rooms = view.rooms;
  const selected = rooms.find((room) => room.id === current) ?? rooms[0] ?? null;
  /* Проёмы больше стен: нетто показана нулём, и молчать об этом нельзя —
     ноль уйдёт в смету подстановкой (`wallAreaNet`, предупреждение, а не отказ). */
  const проёмыБольшеСтен = selected === null ? null : wallAreaNetWarning(обмерПомещения(selected));

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
          {editable && !снимаюПлан && (
            <button
              type="button"
              className="btn btn--text"
              disabled={busy}
              onClick={() => { setСнимаюПлан(true); }}
            >
              Снять план
            </button>
          )}
          {editable && снимаюПлан && (
            <div className="stack stack--tight" role="group" aria-label="Снятие плана">
              <p className="t-body">
                Снимок «{view.plan.fileName}» удалится с объекта и с диска. Помещения и их величины
                останутся; вернуть план можно только новой загрузкой.
              </p>
              <div className="row">
                <button
                  type="button"
                  className="btn btn--danger"
                  disabled={busy}
                  onClick={() => { setСнимаюПлан(false); run(deletePlan(code, set), "Обмерный план снят"); }}
                >
                  Снять план
                </button>
                <button type="button" className="btn btn--text" onClick={() => { setСнимаюПлан(false); }}>
                  Не снимать
                </button>
              </div>
            </div>
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
        {/* Итоги проёмов (план, пункт 7.4): окна и двери по объекту — тем же
            строем, что у помещения. Подпись «Площадь» здесь не голая, а с
            видом проёма: «Площадь окон» не спутать с площадью пола. */}
        <p className="spec measure__openings">
          {/* Три пары на вид, а не одна строка: строкой итог окон не
              помещался в 390 px и уводил страницу вбок. */}
          {([["windows", "Окна", "окон"], ["doors", "Двери", "дверей"]] as const).flatMap(([ключ, имя, чего]) => [
            <span className="spec__item" key={`${ключ}-count`}>
              {имя}<span className="spec__value">{view.totals[ключ].count} шт</span>
            </span>,
            <span className="spec__item" key={`${ключ}-area`}>
              Площадь {чего}
              <span className="spec__value">{formatMeasure(BigInt(view.totals[ключ].area), "м²")}</span>
            </span>,
            <span className="spec__item" key={`${ключ}-reveal`}>
              Откосы {чего}
              <span className="spec__value">{formatMeasure(BigInt(view.totals[ключ].reveal), "м.п.")}</span>
            </span>,
          ])}
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
              <button type="button" className="btn btn--primary" onClick={() => { setЛист({ вид: "помещение", room: null, ключ: Date.now() }); }}>
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
                      {/* Помещение со стенами считается по стенам (этап Э11,
                          шаг 2): плашка называет, сколько их и какова сумма
                          длин — против неё сверяется периметр потолка. */}
                      {selected.walls.length > 0 && (
                        <span className="spec__item">
                          Стен
                          <span className="spec__value">{selected.walls.length}</span>
                        </span>
                      )}
                      {detailed && selected.wallsLength !== null && (
                        <span className="spec__item">
                          Сумма длин стен
                          <span className="spec__value">{formatMeasure(BigInt(selected.wallsLength), "м")}</span>
                        </span>
                      )}
                    </p>
                  </div>

                  {(["WINDOW", "DOOR"] as const).map((kind) => {
                    /* У помещения со стенами итогов проёмов нет: окна и двери —
                       проёмы на его стенах с любой стороны, откосы — этой
                       стороны (решение Э11-2.1 «а»). */
                    const поСтенам = проёмыВидаПоСтенам(selected, kind);
                    const opening = selected.walls.length > 0
                      ? (поСтенам.count === 0 ? undefined : {
                        count: поСтенам.count, area: поСтенам.area.toString(), reveal: поСтенам.reveal.toString(),
                      })
                      : selected.openings.find((item) => item.kind === kind);
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

            {проёмыБольшеСтен !== null && (
              <p className="panel panel--pad t-sm" role="note">{проёмыБольшеСтен}</p>
            )}
            {/* Допуск Д15 — предупреждение, а не отказ: обмер сохранён, но
                сумма длин стен расходится с периметром потолка. */}
            {selected.wallsWarning !== null && (
              <p className="panel panel--pad t-sm" role="note">{selected.wallsWarning}</p>
            )}

            {editable && (
              <div className="row row--wrap">
                <button type="button" className="btn btn--primary" onClick={() => { setЛист({ вид: "помещение", room: null, ключ: Date.now() }); }}>
                  {завести("помещение")}
                </button>
                <button type="button" className="btn btn--secondary" onClick={() => { setЛист({ вид: "помещение", room: selected, ключ: Date.now() }); }}>
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
              <th>Площадь стен, м²</th><th>Площадь стен нетто, м²</th><th>Объём, м³</th>
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
                <td>{formatMeasure(BigInt(room.wallAreaNet), "")}</td>
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
              <td>{formatMeasure(BigInt(view.totals.wallAreaNet), "")}</td>
              <td>{formatMeasure(BigInt(view.totals.volume), "")}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      {лист?.вид === "помещение" && (
        <RoomSheet
          key={`${лист.room?.id ?? "новое"}-${String(лист.ключ)}`}
          room={лист.room}
          wallInView={лист.стена ?? null}
          unbound={view.unboundOpenings}
          busy={busy}
          error={sheetError}
          onSave={(room, после) => { сохранитьПомещение(лист.room, room, после); }}
          onDelete={лист.room === null ? null : () => {
            const id = лист.room?.id;
            if (id !== undefined) { setCurrent(null); run(deleteRoom(code, id), "Помещение удалено"); }
          }}
          onClearError={() => { setSheetError(null); }}
          onClose={() => { setЛист(null); setSheetError(null); }}
        />
      )}

      {лист?.вид === "проём" && (() => {
        const room = rooms.find((строка) => строка.id === лист.roomId);
        const wall = room?.walls.find((стена) => стена.id === лист.wallId);
        if (room === undefined || wall === undefined) return null;
        const opening = лист.openingId === null
          ? null
          : wall.openings.find((строка) => строка.id === лист.openingId) ?? null;
        const назад = (): void => { setЛист(кПомещению(view, room.id, wall.id)); setSheetError(null); };
        return (
          <OpeningSheet
            key={`${wall.id}-${лист.openingId ?? "новый"}`}
            room={room}
            wall={wall}
            kind={лист.kind}
            opening={opening}
            neighbours={rooms.filter((строка) => строка.id !== room.id)}
            revealFirst={лист.откосы}
            busy={busy}
            error={sheetError}
            onCreate={(input) => {
              проёмом(createOpening(code, wall.id, input), room.id, wall.id,
                `${input.kind === "WINDOW" ? "Окно добавлено" : "Дверь добавлена"} на «${wall.name}»`);
            }}
            onUpdate={(input) => {
              проёмом(updateOpening(code, opening?.id ?? "", input), room.id, wall.id, "Проём сохранён");
            }}
            onDelete={() => { проёмом(deleteOpening(code, opening?.id ?? ""), room.id, wall.id, "Проём удалён"); }}
            onClose={назад}
          />
        );
      })()}
    </div>
  );
}
