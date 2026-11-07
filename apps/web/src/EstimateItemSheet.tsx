import { useState } from "react";
import type {
  ClosedTranches, CreateEstimateItem, EstimateItem, EstimateItemRoom, MeasureView, UpdateEstimateItem,
} from "@priyomka/contracts";
import { formatKopecks, formatQty } from "@priyomka/ui";
import {
  estimateItemFault, estimateItemMoveFault, estimateItemRemovalFault, estimateItemWarning, measureSourcesFor,
  MEASURE_LABEL, kopecks, milliunits, multiplyByQuantity, type MeasureSource,
} from "@priyomka/domain";
import { useModalDialog } from "./modal.js";
import { предупреждениеОЗакрытых } from "./closed-tranches.js";
import { завести } from "./verbs.js";

/**
 * Правка позиции сметы — действие руководителя.
 *
 * Отказ показывается до обращения к сети тем же `estimateItemFault`, что
 * применит сервер: два независимых свода разошлись бы на третьей правке, и
 * человек получал бы отказ там, где экран обещал согласие.
 *
 * Правка на месте, новой редакции не порождает. Редакция растёт только при
 * импорте — решение заказчика от 09.09.2026, причина изложена в постановке.
 */

/** «1 150,50» → 115050 копеек. Возвращает null на незавершённом вводе. */
export function рублиВКопейки(input: string): bigint | null {
  // \u00A0 — неразрывный пробел: браузер вставляет его при вводе разрядов.
  const очищено = input.replace(/[\s\u00A0]/g, "").replace(",", ".");
  if (очищено === "") return null;
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(очищено);
  if (!match) return null;
  const [, целое = "0", дробь = ""] = match;
  return BigInt(целое) * 100n + BigInt(дробь.padEnd(2, "0") || "0");
}

/** «406,91» → 406910 тысячных. Возвращает null на незавершённом вводе. */
export function количествоВТысячные(input: string): bigint | null {
  const очищено = input.replace(/[\s\u00A0]/g, "").replace(",", ".");
  if (очищено === "") return null;
  const match = /^(\d+)(?:\.(\d{0,3}))?$/.exec(очищено);
  if (!match) return null;
  const [, целое = "0", дробь = ""] = match;
  return BigInt(целое) * 1000n + BigInt(дробь.padEnd(3, "0") || "0");
}

/** Тысячные в строку поля: 406910 → «406,91», незначащие нули отброшены. */
export const вПоле = (value: bigint, знаков: number): string => {
  const делитель = 10n ** BigInt(знаков);
  const дробь = (value % делитель).toString().padStart(знаков, "0").replace(/0+$/, "");
  const целое = (value / делитель).toString();
  return дробь === "" ? целое : `${целое},${дробь}`;
};

export function EstimateItemSheet({
  item,
  units,
  rooms,
  replanned,
  sections,
  sectionId,
  measure,
  closed,
  busy,
  error,
  onSave,
  onCreate,
  onDelete,
  onClose,
}: {
  /**
   * Правимая позиция или `null` — заведение новой (план, пункт 7.3). Лист
   * один на оба действия: поля, правила и подстановка из обмера у них общие,
   * и два листа разошлись бы на первой правке подписи.
   */
  item: EstimateItem | null;
  units: readonly string[];
  /** Помещения действующего набора обмера. Пусто — обмера ещё не делали. */
  rooms: readonly EstimateItemRoom[];
  /** Есть ли у объекта набор после перепланировки. */
  replanned: boolean;
  /**
   * Разделы действующей редакции — плоским списком с отступом по уровню.
   *
   * Перенос между разделами живёт здесь, а не только в перетаскивании:
   * разделов двадцать два, тащить строку сквозь свёрнутые заголовки —
   * движение, которое не заканчивается, а у человека без указателя его нет
   * вовсе.
   */
  sections: readonly { id: string; name: string; level: number }[];
  /** Раздел, в котором позиция стоит сейчас. */
  sectionId: string;
  measure: MeasureView | null;
  /** Закрытые транши объекта: лист называет те, что изменит правка (П-27). */
  closed: ClosedTranches["tranches"];
  busy: boolean;
  error: string | null;
  /** `раздел` пуст, когда его не меняли: «не трогал» — не «перенеси сюда». */
  onSave: (input: UpdateEstimateItem, раздел: string | null) => void;
  /** Заведение позиции; задаётся, когда `item` пуст. */
  onCreate?: (input: CreateEstimateItem) => void;
  /** Удаление позиции; задаётся у правимой. Идёт через подтверждение. */
  onDelete?: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog<HTMLInputElement>(onClose);
  const [name, setName] = useState(item?.name ?? "");
  const [unit, setUnit] = useState(item?.unit ?? units[0] ?? "");
  const [qty, setQty] = useState(item === null ? "" : вПоле(BigInt(item.qty), 3));
  const [price, setPrice] = useState(item === null ? "" : вПоле(BigInt(item.unitPrice), 2));
  const [wage, setWage] = useState(item === null ? "0" : вПоле(BigInt(item.unitWage ?? "0"), 2));
  const [roomId, setRoomId] = useState(item?.room?.id ?? "");
  const [разделПозиции, setРазделПозиции] = useState(sectionId);
  const [удаляю, setУдаляю] = useState(false);
  const принято = item === null ? "0" : item.qtyAccepted;

  const предупреждение = item === null ? null : предупреждениеОЗакрытых(closed, { позиция: item.id });
  const тысячные = количествоВТысячные(qty);
  const цена = рублиВКопейки(price);
  const ставка = рублиВКопейки(wage);
  const разобрано = тысячные !== null && цена !== null && ставка !== null;

  const правка = разобрано
    ? {
        qty: milliunits(тысячные),
        accepted: milliunits(принято),
        unit,
        unitPrice: kopecks(цена),
        unitWage: kopecks(ставка),
      }
    : null;
  const fault = правка === null ? null : estimateItemFault(правка);
  /* Отказ показывается до обращения к сети тем же правилом, что применит
     сервер: два независимых свода разошлись бы на третьей правке. */
  const отказПереноса = item === null ? null : estimateItemMoveFault({
    accepted: milliunits(item.qtyAccepted),
    name: item.name,
    unit: item.unit,
    changesSection: разделПозиции !== sectionId,
    section: sections.find((раздел) => раздел.id === sectionId)?.name ?? "прежнем",
  });
  const warning = правка === null ? null : estimateItemWarning(правка);
  const ready = разобрано && fault === null && отказПереноса === null && name.trim() !== "";

  /* Величины обмера подставляются только те, что подходят единице позиции:
     «м.п.» годится и плинтусу, и карнизу, а какая из двух длин нужна —
     решает человек. Карта живёт в домене, экран своей не заводит. */
  const источники = measureSourcesFor(unit);

  /* Подстановка идёт от помещения позиции, а не от объекта.
     Прежде здесь стоял `measure.totals`, то есть итог по всей квартире: на
     позицию «плитка пола, санузел» подставлялись 80,53 м² вместо 1,80.
     Величины объекта остались рядом — работа вроде вывоза мусора и правда
     меряется объектом, — но подписаны своим источником, и перепутать их
     больше нельзя. */
  const комната = measure?.rooms.find((строка) => строка.id === roomId) ?? null;
  const поПомещению: readonly { source: MeasureSource; value: bigint }[] =
    комната === null
      ? []
      : источники.map((source) => ({ source, value: BigInt(комната[source]) }));
  const поОбъекту: readonly { source: MeasureSource; value: bigint }[] =
    measure === null
      ? []
      : источники.map((source) => ({ source, value: BigInt(measure.totals[source]) }));

  /* Помещение позиции осталось на начальном обмере, а объект перепланирован:
     одноимённого помещения в новом наборе не завели — кухня и гостиная стали
     кухней-гостиной. Молчать об этом нельзя: количество позиции считалось по
     площади, которой больше нет. */
  const отсталоОтПерепланировки = replanned && item !== null && item.room !== null && item.room.set === "INITIAL";
  /* Помещение позиции вне действующего набора показывается отдельной строкой
     списка — тем же приёмом, что единица измерения вне справочника: иначе
     выбор молча съехал бы на первое попавшееся. */
  const своё = item?.room ?? null;
  /* Принятую позицию удалить нельзя — отказ тем же правилом, что у сервера,
     до обращения к сети; путь назван словами: сторно приёмки. */
  const отказУдаления = item === null ? null : estimateItemRemovalFault({
    accepted: milliunits(item.qtyAccepted), name: item.name, unit: item.unit,
  });
  const вСписке = своё !== null && rooms.some((строка) => строка.id === своё.id);

  const submit: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!ready) return;
    if (item === null) {
      onCreate?.({
        sectionId: разделПозиции,
        name: name.trim(),
        unit,
        qty: тысячные.toString(),
        unitPrice: цена.toString(),
        unitWage: ставка.toString(),
        roomId: roomId === "" ? null : roomId,
      });
      return;
    }
    onSave({
      name: name.trim(),
      unit,
      qty: тысячные.toString(),
      unitPrice: цена.toString(),
      unitWage: ставка.toString(),
      roomId: roomId === "" ? null : roomId,
    }, разделПозиции === sectionId ? null : разделПозиции);
  };

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={item === null ? "Новая позиция сметы" : "Правка позиции"}
        ref={dialog}
      >
        <p className="t-h3">{item === null ? "Новая позиция сметы" : "Позиция сметы"}</p>
        {предупреждение !== null && <p className="panel panel--pad t-sm" role="note">{предупреждение}</p>}
        <form className="stack stack--tight" onSubmit={submit}>
          <label className="field">
            <span className="field__label">Наименование</span>
            <input
              ref={first}
              className="input"
              value={name}
              maxLength={300}
              onChange={(event) => { setName(event.target.value); }}
            />
          </label>

          <div className="row">
            <label className="field" style={{ flex: "1 1 auto" }}>
              <span className="field__label">Количество</span>
              <input
                className="input input--num"
                inputMode="decimal"
                value={qty}
                aria-invalid={fault !== null}
                onChange={(event) => { setQty(event.target.value); }}
              />
            </label>
            <label className="field">
              <span className="field__label">Единица</span>
              <span className="selectwrap">
                <select
                  className="input"
                  value={unit}
                  onChange={(event) => { setUnit(event.target.value); }}
                >
                  {units.includes(unit) ? null : <option value={unit}>{unit}</option>}
                  {units.map((code) => <option key={code} value={code}>{code}</option>)}
                </select>
              </span>
            </label>
          </div>

          <label className="field">
            <span className="field__label">Раздел</span>
            <span className="selectwrap">
              <select
                className="input"
                value={разделПозиции}
                aria-invalid={отказПереноса !== null}
                onChange={(event) => { setРазделПозиции(event.target.value); }}
              >
                {sections.map((раздел) => (
                  <option key={раздел.id} value={раздел.id}>
                    {раздел.level > 1 ? "— " : ""}{раздел.name}
                  </option>
                ))}
              </select>
            </span>
            {отказПереноса !== null && (
              <span className="field__error" role="alert">{отказПереноса}</span>
            )}
          </label>

          <label className="field">
            <span className="field__label">Помещение</span>
            <span className="selectwrap">
              <select
                className="input"
                value={roomId}
                onChange={(event) => { setRoomId(event.target.value); }}
              >
                <option value="">Не выбрано</option>
                {своё !== null && !вСписке && (
                  <option value={своё.id}>{своё.name} — начальный обмер</option>
                )}
                {rooms.map((строка) => (
                  <option key={строка.id} value={строка.id}>{строка.name}</option>
                ))}
              </select>
            </span>
            {отсталоОтПерепланировки ? (
              <span className="field__hint">
                Помещение из начального обмера: одноимённого в перепланировке нет.
                Выберите помещение нового набора — количество считалось по площади,
                которой больше нет.
              </span>
            ) : (
              rooms.length === 0 && (
                <span className="field__hint">
                  Обмер объекта ещё не сделан: выбирать нечего.
                </span>
              )
            )}
          </label>

          {поПомещению.length > 0 && (
            <div className="estimate__from-measure">
              <span className="t-cap">из обмера помещения</span>
              {поПомещению.map(({ source, value }) => (
                <button
                  key={source}
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => { setQty(вПоле(value, 3)); }}
                >
                  {MEASURE_LABEL[source]} {formatQty(value)}
                </button>
              ))}
            </div>
          )}

          {поОбъекту.length > 0 && (
            <div className="estimate__from-measure">
              {/* Величины объекта подписаны своим источником. Прежде они
                  стояли под подписью «из обмера» — и читались как величины
                  помещения, которого позиция тогда не знала вовсе. */}
              <span className="t-cap">из обмера объекта</span>
              {поОбъекту.map(({ source, value }) => (
                <button
                  key={source}
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => { setQty(вПоле(value, 3)); }}
                >
                  {MEASURE_LABEL[source]} {formatQty(value)}
                </button>
              ))}
            </div>
          )}

          <div className="row">
            <label className="field" style={{ flex: "1 1 auto" }}>
              <span className="field__label">Цена единицы, ₽</span>
              <input
                className="input input--num"
                inputMode="decimal"
                value={price}
                onChange={(event) => { setPrice(event.target.value); }}
              />
            </label>
            <label className="field" style={{ flex: "1 1 auto" }}>
              <span className="field__label">Ставка оплаты труда, ₽</span>
              <input
                className="input input--num"
                inputMode="decimal"
                value={wage}
                onChange={(event) => { setWage(event.target.value); }}
              />
            </label>
          </div>

          {/* Сумма позиции — тем же умножением, что у сервера. Прежде здесь
              стояло второе написание правила, `(цена × тысячные + 500) / 1000`
              (полный аудит 30.09.2026, П-35). */}
          <p className="field__hint">
            {разобрано
              ? `Сумма позиции ${formatKopecks(multiplyByQuantity(kopecks(цена), milliunits(тысячные)))}`
              : "Количество и деньги вводятся с запятой: «406,91» и «1 150,50»."}
          </p>

          {warning !== null && <p className="field__hint" role="status">{warning}</p>}
          {fault !== null && <p className="field__error" role="alert">{fault}</p>}
          {error !== null && <p className="field__error" role="alert">{error}</p>}

          <button
            type="submit"
            className="btn btn--primary btn--block"
            disabled={busy || !ready}
            data-loading={busy}
          >
            {item === null ? завести("позиция") : "Сохранить"}
          </button>
          <button type="button" className="btn btn--text btn--block" onClick={onClose}>
            Отмена
          </button>
          {/* Удаление — через подтверждение, которое называет последствие:
              позиция уходит из сметы, итог по работам уменьшается (норматив
              15.6). Принятую позицию лист не удаляет вовсе — отказ стоит
              словами на месте кнопки подтверждения. */}
          {item !== null && onDelete !== undefined && !удаляю && (
            <button type="button" className="btn btn--text btn--block" onClick={() => { setУдаляю(true); }}>
              Удалить позицию
            </button>
          )}
          {item !== null && onDelete !== undefined && удаляю && (
            <div className="panel panel--pad stack stack--tight" role="group" aria-label="Удаление позиции">
              {отказУдаления !== null ? (
                <p className="field__error" role="alert">{отказУдаления}</p>
              ) : (
                <>
                  <p className="t-sm">
                    Позиция «{item.name}» уйдёт из сметы: итог по работам уменьшится на{" "}
                    {formatKopecks(kopecks(item.total))}, подытог раздела — на ту же сумму.
                  </p>
                  <button type="button" className="btn btn--danger btn--block" disabled={busy} onClick={onDelete}>
                    Удалить позицию
                  </button>
                </>
              )}
              <button type="button" className="btn btn--text btn--block" onClick={() => { setУдаляю(false); }}>
                Не удалять
              </button>
            </div>
          )}
        </form>
      </div>
    </>
  );
}
