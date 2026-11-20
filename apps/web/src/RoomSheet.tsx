import { useEffect, useRef, useState } from "react";
import { завести } from "./verbs.js";
import type {
  CreateMeasureRoom, MeasureOpening, MeasureRoom, MeasureWallInput, UnboundOpening,
} from "@priyomka/contracts";
import { formatMeasure } from "@priyomka/ui";
import {
  milliunits, openingTotalsDropNote, singleWallArea, singleWallAreaNet, wallArea, wallAreaNet,
  wallAreaNetWarning, wallName, wallRemovalFault, wallsLength, wallsLengthWarning, type RoomMeasure,
  type WallMeasure,
} from "@priyomka/domain";
import { useModalDialog } from "./modal.js";
import { ДОБАВИТЬ_ПРОЁМ, ПРЕДЛАГАЮТСЯ_К_ПРИВЯЗКЕ, проёмСловами, проёмыСтен } from "./walls.js";

/**
 * Ввод и правка помещения.
 *
 * Прораб вводит четыре величины: площадь пола, периметр пола, периметр
 * потолка и высоту. Площадь стен и объём здесь не спрашиваются — они
 * выводятся. Спрашивать производную значило бы допустить обмер, в котором
 * объём не сходится с площадью и высотой.
 *
 * Площадь стен — обе величины, без вычета проёмов и нетто — лист
 * показывает по мере ввода тем же доменом, что сервер (этап Э11, шаг 1):
 * проёмы вводятся здесь же, и промах, после которого проёмы больше стен,
 * виден до сохранения, а не после.
 *
 * **Стены** (этап Э11, шаг 2; решения Э11-2.1 и Э11-2.4; норматив, раздел 55).
 * Раздел «Стены» — строки: подпись, длина, высота; пустая высота — высота
 * помещения, пустая подпись — «Стена N». С первой строкой стены поля итогов
 * проёмов уступают место заметке о том, что снимется при сохранении; сумма
 * длин сверяется с периметром потолка допуском Д15 — предупреждением, а не
 * отказом. Проём заводится со строки стены: стена и вид приходят из строки.
 * Проём живёт на сохранённой стене, поэтому касание органа проёма сначала
 * сохраняет лист, если в нём есть несохранённое, — прорабу не нужно
 * закрывать и открывать лист заново.
 *
 * Величины вводятся в метрах, а хранятся в тысячных долях. Перевод идёт
 * разбором строки в целое, а не через число с плавающей точкой: «18,4»
 * даёт 18400 посимвольно, тогда как 18.4 * 1000 в двоичной арифметике
 * даёт 18400.000000000002.
 */

/** Метры строкой → тысячные доли целым. Ноль знаков после запятой сверх трёх. */
export function toMilli(input: string): string | null {
  const cleaned = input.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(cleaned)) return null;
  const [whole = "0", fraction = ""] = cleaned.split(".");
  return String(BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0")));
}

/** Тысячные доли → метры строкой для поля ввода: 18400 → «18,4». */
export const toInput = (milli: string): string => {
  const value = BigInt(milli);
  const whole = value / 1000n;
  const fraction = (value % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole.toString()},${fraction}` : whole.toString();
};

const FIELDS = [
  { key: "floorArea", label: "Площадь пола, м²" },
  { key: "floorPerimeter", label: "Периметр пола, м.п." },
  { key: "ceilingPerimeter", label: "Периметр потолка, м.п." },
  { key: "height", label: "Высота, м" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

/**
 * Проёмы помещения (план, пункт 7.4): окна и двери, по строке на вид —
 * количество, общая площадь и откосы. Прежде лист правил только четыре
 * величины и пересылал проёмы нетронутыми: завести окно было негде, хотя
 * модель и сервер их принимали. С этапа Э11 (шаг 2) — только у помещения
 * без стен.
 */
const ВИДЫ_ПРОЁМОВ = [
  { kind: "WINDOW", label: "Окна" },
  { kind: "DOOR", label: "Двери" },
] as const;

interface ПроёмВвод { count: string; area: string; reveal: string }

const проёмВПоля = (opening: MeasureOpening | undefined): ПроёмВвод => ({
  count: opening === undefined ? "" : String(opening.count),
  area: opening === undefined ? "" : toInput(opening.area),
  reveal: opening === undefined ? "" : toInput(opening.reveal),
});

/**
 * Строка проёма из полей. Пустое или нулевое количество — проёмов этого вида
 * нет, и строки нет (так их хранит модель). При ненулевом количестве площадь
 * и откосы обязательны: окно без площади не даёт ни откосов, ни отделки.
 */
function проёмИзПолей(kind: MeasureOpening["kind"], ввод: ПроёмВвод): MeasureOpening | null | "ошибка" {
  const количество = ввод.count.trim();
  if (количество === "" || количество === "0") return null;
  if (!/^\d{1,3}$/u.test(количество)) return "ошибка";
  const area = toMilli(ввод.area === "" ? "0" : ввод.area);
  const reveal = toMilli(ввод.reveal === "" ? "0" : ввод.reveal);
  if (area === null || reveal === null) return "ошибка";
  return { kind, count: Number(количество), area, reveal };
}

/** Строка стены в листе: опознаватель есть у сохранённой, ключ — у всякой. */
interface СтенаВвод { ключ: string; id?: string; label: string; length: string; height: string }

/** Длина стены: обязательна и больше нуля; высота — пусто или число. */
const длинаСтены = (ввод: СтенаВвод): string | null => {
  const значение = toMilli(ввод.length);
  return значение === null || значение === "0" ? null : значение;
};
/** Высота стены: `{ значение: null }` — пусто, высота помещения; `null` — ошибка ввода. */
const высотаСтены = (ввод: СтенаВвод): { значение: string | null } | null => {
  if (ввод.height.trim() === "") return { значение: null };
  const значение = toMilli(ввод.height);
  return значение === null || значение === "0" ? null : { значение };
};

/**
 * Что сделать после сохранения листа. Проём, правка проёма и привязка
 * второй стороны живут на сохранённой стене; удаление сохранённой стены —
 * само сохранение без неё, после которого лист остаётся открытым.
 * `стена` — место строки, 1..N: опознавателя у новой стены до сохранения нет.
 */
export type ПослеСохранения =
  | { вид: "проём"; стена: number; kind: MeasureOpening["kind"] }
  | { вид: "правка проёма"; стена: number; openingId: string }
  | { вид: "привязать"; стена: number; openingId: string }
  | { вид: "остаться" };

/** Тело сохранения как строка: сравнением с исходным лист знает, есть ли несохранённое. */
const отпечаток = (body: CreateMeasureRoom | null): string => JSON.stringify(body);

export function RoomSheet({
  room,
  wallInView = null,
  unbound,
  busy,
  error,
  onSave,
  onDelete,
  onClearError,
  onClose,
}: {
  room: MeasureRoom | null;
  /**
   * Стена, к которой лист возвращается из листа проёма: её строка
   * прокручивается в поле зрения, и прораб продолжает с того же места.
   */
  wallInView?: string | null;
  /**
   * Двери других помещений набора без второй стороны (решение Э11-2.2 «а»):
   * строка стены предлагает привязать их одним касанием.
   */
  unbound: readonly UnboundOpening[];
  busy: boolean;
  error: string | null;
  /**
   * Сохранение помещения и, если задано, следующее действие. `null` вместо
   * тела — сохранять нечего: лист не менялся, и действие идёт сразу.
   */
  onSave: (room: CreateMeasureRoom | null, после?: ПослеСохранения) => void;
  onDelete: (() => void) | null;
  /**
   * Снять ошибку листа: отказ удаления, оставшийся после «Не удалять» или
   * «Отмена», стоял бы под формой рядом с «Сохранить» и читался бы отказом
   * сохранения (П-88).
   */
  onClearError: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog<HTMLInputElement>(onClose);
  const [name, setName] = useState(room?.name ?? "");
  const [values, setValues] = useState<Record<FieldKey, string>>(() => ({
    floorArea: room === null ? "" : toInput(room.floorArea),
    floorPerimeter: room === null ? "" : toInput(room.floorPerimeter),
    ceilingPerimeter: room === null ? "" : toInput(room.ceilingPerimeter),
    height: room === null ? "2,7" : toInput(room.height),
  }));
  const [confirming, setConfirming] = useState(false);
  const [проёмы, setПроёмы] = useState<Record<MeasureOpening["kind"], ПроёмВвод>>(() => ({
    WINDOW: проёмВПоля(room?.openings.find((opening) => opening.kind === "WINDOW")),
    DOOR: проёмВПоля(room?.openings.find((opening) => opening.kind === "DOOR")),
  }));
  const [стены, setСтены] = useState<СтенаВвод[]>(() => (room?.walls ?? []).map((wall) => ({
    ключ: wall.id,
    id: wall.id,
    label: wall.label ?? "",
    length: toInput(wall.length),
    height: wall.height === null ? "" : toInput(wall.height),
  })));
  /* Удаляемая сохранённая стена: строка показывает судьбу её проёмов и ждёт
     подтверждения (норматив, раздел 55.5). */
  const [удаляюСтену, setУдаляюСтену] = useState<string | null>(null);
  const счётчик = useRef(0);
  /* «Добавить стену» ставит фокус в поле длины новой строки: подпись
     необязательна, длина нужна всегда (решение Э11-2.4 «а»). */
  const [фокус, setФокус] = useState<string | null>(null);
  const поляДлины = useRef(new Map<string, HTMLInputElement>());
  useEffect(() => {
    if (фокус === null) return;
    поляДлины.current.get(фокус)?.focus();
    setФокус(null);
  }, [фокус]);
  useEffect(() => {
    if (wallInView === null) return;
    поляДлины.current.get(wallInView)?.closest("fieldset")?.scrollIntoView({ block: "center" });
  }, [wallInView]);

  const естьСтены = стены.length > 0;
  const строкиПроёмов = ВИДЫ_ПРОЁМОВ.map(({ kind }) => проёмИзПолей(kind, проёмы[kind]));
  /* У помещения со стенами итогов нет: поля скрыты и не проверяются. */
  const проёмыВерны = естьСтены || строкиПроёмов.every((строка) => строка !== "ошибка");
  const стеныВерны = стены.every((стена) => длинаСтены(стена) !== null && высотаСтены(стена) !== null);

  const milli = Object.fromEntries(
    FIELDS.map((field) => [field.key, toMilli(values[field.key])]),
  ) as Record<FieldKey, string | null>;
  const ready = name.trim().length > 0 && FIELDS.every((field) => milli[field.key] !== null)
    && проёмыВерны && стеныВерны;

  const итогиИзПолей = строкиПроёмов
    .filter((строка): строка is MeasureOpening => typeof строка === "object" && строка !== null);

  /* Стены листа в виде домена. Строка без разобранной длины в расчёт не
     входит: её площадь показана прочерком, а не нулём. */
  const стеныДомена: WallMeasure[] = стены.flatMap((стена) => {
    const length = длинаСтены(стена);
    const height = высотаСтены(стена);
    if (length === null || height === null) return [];
    return [{
      id: стена.id ?? стена.ключ,
      label: стена.label.trim() === "" ? null : стена.label.trim(),
      length: milliunits(length),
      height: height.значение === null ? null : milliunits(height.значение),
    }];
  });
  /* Проёмы на стенах — сохранённые, с любой стороны; проёмы стены, что
     удаляется, остаются в расчёте до подтверждения. */
  const проёмыНаСтенах = room === null ? [] : проёмыСтен([room]);

  /* Обмер по введённому: считается, когда разобраны периметр потолка, высота
     и проёмы, — площадь стен от них и только от них. */
  const обмер: RoomMeasure | null =
    milli.ceilingPerimeter === null || milli.height === null || !проёмыВерны
      ? null
      : {
          floorArea: milliunits(milli.floorArea ?? "0"),
          floorPerimeter: milliunits(milli.floorPerimeter ?? "0"),
          ceilingPerimeter: milliunits(milli.ceilingPerimeter),
          height: milliunits(milli.height),
          openings: естьСтены ? [] : итогиИзПолей.map((строка) => ({
            kind: строка.kind, count: строка.count,
            area: milliunits(строка.area), reveal: milliunits(строка.reveal),
          })),
          walls: стеныДомена,
          wallOpenings: проёмыНаСтенах,
        };
  const проёмыБольшеСтен = обмер === null ? null : wallAreaNetWarning(обмер);
  const допуск = обмер === null ? null : wallsLengthWarning(обмер);
  /* Первая стена снимает итоги проёмов (решение Э11-2.1 «а»): лист называет
     это до сохранения числами, что сейчас в полях итогов. У помещения, что
     уже считается по стенам, снимать нечего. */
  const снимется = естьСтены && (room?.walls.length ?? 0) === 0 && обмер !== null
    ? openingTotalsDropNote({ ...обмер, walls: [], wallOpenings: [], openings: итогиИзПолей.map((строка) => ({
      kind: строка.kind, count: строка.count, area: milliunits(строка.area), reveal: milliunits(строка.reveal),
    })) })
    : null;

  const тело = (безСтены: string | null = null): CreateMeasureRoom | null => {
    if (!ready) return null;
    const перечень: MeasureWallInput[] = стены
      .filter((стена) => стена.ключ !== безСтены)
      .map((стена) => {
        return {
          ...(стена.id === undefined ? {} : { id: стена.id }),
          label: стена.label.trim() === "" ? null : стена.label.trim(),
          length: длинаСтены(стена) ?? "0",
          height: высотаСтены(стена)?.значение ?? null,
        };
      });
    const былиСтены = (room?.walls.length ?? 0) > 0;
    return {
      name: name.trim(),
      floorArea: milli.floorArea ?? "",
      floorPerimeter: milli.floorPerimeter ?? "",
      ceilingPerimeter: milli.ceilingPerimeter ?? "",
      height: milli.height ?? "",
      /* Итоги и стены в одном теле сервер отвергает: о проёмах помещения
         одна запись. Пустой перечень стен уходит, только если стены были. */
      ...(перечень.length > 0 ? {} : { openings: итогиИзПолей }),
      ...(перечень.length > 0 || былиСтены ? { walls: перечень } : {}),
    };
  };
  /* Исходное тело — то, что сохранено: орган проёма сохраняет лист, только
     если в нём есть несохранённое. */
  const [исходное] = useState(() => отпечаток(тело()));
  const несохранено = room === null || отпечаток(тело()) !== исходное;

  const submit: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const body = тело();
    if (body !== null) onSave(body);
  };

  /** Действие на сохранённой стене: сначала сохранить лист, если есть что. */
  const действие = (после: ПослеСохранения): void => {
    if (!ready) return;
    onSave(несохранено ? тело() : null, после);
  };

  const добавитьСтену = (): void => {
    счётчик.current += 1;
    const ключ = `новая-${String(счётчик.current)}`;
    setСтены((current) => [...current, { ключ, label: "", length: "", height: "" }]);
    setФокус(ключ);
  };

  const удалитьСтену = (ключ: string): void => {
    const строка = стены.find((стена) => стена.ключ === ключ);
    if (строка?.id === undefined) {
      /* Несохранённую строку терять нечего, кроме набранного: подтверждение
         было бы лишним касанием. */
      setСтены((current) => current.filter((стена) => стена.ключ !== ключ));
      return;
    }
    setУдаляюСтену(ключ);
  };

  const высотаПомещения = milli.height === null ? "" : formatMeasure(BigInt(milli.height), "").trim();

  /* Судьба проёмов при удалении стены или помещения (норматив, раздел 55.5;
     решение Э11-2.3 «б»): с привязанной стороной Б проём переходит к
     соседу, без неё — удаляется; на стене соседа — снимается привязка. */
  const судьбаПроёмов = (wallIds: ReadonlySet<string>): string[] => {
    if (room === null) return [];
    const виденные = new Set<string>();
    const строки: string[] = [];
    for (const wall of room.walls) {
      if (!wallIds.has(wall.id)) continue;
      for (const opening of wall.openings) {
        if (виденные.has(opening.id)) continue;
        виденные.add(opening.id);
        const проём = проёмСловами(opening);
        if (opening.side === "B") {
          строки.push(`${проём} останется у помещения «${opening.other?.roomName ?? ""}»: привязка к этой стене снимется.`);
        } else if (opening.other === null) {
          строки.push(`${проём} удалится — второй стороны у него нет.`);
        } else if (wallIds.has(opening.other.wallId)) {
          строки.push(`${проём} удалится вместе со стеной.`);
        } else {
          строки.push(`${проём} перейдёт помещению «${opening.other.roomName}»: его сторона станет первой,`
            + " откосы сторон поменяются местами.");
        }
      }
    }
    return строки;
  };

  const удаляемая = удаляюСтену === null ? null : стены.find((стена) => стена.ключ === удаляюСтену) ?? null;

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div
        className="sheet sheet--tall"
        role="dialog"
        aria-modal="true"
        aria-label={room === null ? "Новое помещение" : `Помещение «${room.name}»`}
        ref={dialog}
      >
        <p className="t-h3">{room === null ? "Новое помещение" : room.name}</p>

        {confirming && onDelete !== null ? (
          /* Необратимое действие называет, что именно исчезнет, а не
             спрашивает «вы уверены» (норматив 15.6). */
          <div className="stack stack--tight">
            {/* У помещения со стенами проёмы не уходят с ним целиком: судьбу
                каждого называют строки ниже — переход к соседу или удаление
                (П-90). «Вместе с проёмами» говорится только о помещении без
                стен: его проёмы — итоги, и они уходят с ним. */}
            <p className="t-body">
              Помещение «{room?.name ?? ""}» будет удалено вместе с его величинами
              {(room?.walls.length ?? 0) > 0 ? " и стенами" : " и проёмами"}.
              Итоги по объекту уменьшатся на {formatMeasure(BigInt(room?.floorArea ?? "0"), "м²")} площади
              и {formatMeasure(BigInt(room?.volume ?? "0"), "м³")} объёма.
            </p>
            {судьбаПроёмов(new Set((room?.walls ?? []).map((wall) => wall.id))).map((строка, номер) => (
              <p className="t-sm" key={`${String(номер)}-${строка}`}>{строка}</p>
            ))}
            {error !== null && <p className="field__error" role="alert">{error}</p>}
            <button type="button" className="btn btn--danger btn--block" disabled={busy} onClick={onDelete}>
              Удалить помещение
            </button>
            <button
              type="button"
              className="btn btn--text btn--block"
              onClick={() => { setConfirming(false); onClearError(); }}
            >
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
                value={name}
                maxLength={60}
                onChange={(event) => { setName(event.target.value); }}
              />
            </label>

            {FIELDS.map((field) => (
              <label className="field" key={field.key}>
                <span className="field__label">{field.label}</span>
                <input
                  className="input input--num"
                  inputMode="decimal"
                  value={values[field.key]}
                  aria-invalid={values[field.key] !== "" && milli[field.key] === null}
                  onChange={(event) => {
                    const next = event.target.value;
                    setValues((current) => ({ ...current, [field.key]: next }));
                  }}
                />
              </label>
            ))}

            <p className="field__hint">
              Площадь стен и объём считаются из этих величин и здесь не вводятся.
            </p>

            {!естьСтены && ВИДЫ_ПРОЁМОВ.map(({ kind, label }, номер) => {
              const ввод = проёмы[kind];
              const строка = строкиПроёмов[номер];
              const задать = (поле: keyof ПроёмВвод) => (event: React.ChangeEvent<HTMLInputElement>): void => {
                const next = event.target.value;
                setПроёмы((current) => ({ ...current, [kind]: { ...current[kind], [поле]: next } }));
              };
              return (
                <fieldset className="openings" key={kind}>
                  <legend className="field__label">{label}</legend>
                  <div className="row">
                    <label className="field">
                      <span className="field__label">Количество, шт</span>
                      <input
                        className="input input--num"
                        inputMode="numeric"
                        value={ввод.count}
                        aria-invalid={строка === "ошибка"}
                        onChange={задать("count")}
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">Площадь, м²</span>
                      <input className="input input--num" inputMode="decimal" value={ввод.area} onChange={задать("area")} />
                    </label>
                    <label className="field">
                      <span className="field__label">Откосы, м.п.</span>
                      <input className="input input--num" inputMode="decimal" value={ввод.reveal} onChange={задать("reveal")} />
                    </label>
                  </div>
                </fieldset>
              );
            })}
            {!проёмыВерны && (
              <p className="field__error" role="alert">
                Количество проёмов — целое число; площадь и откосы — в метрах с запятой: «3,6».
              </p>
            )}

            {/* Раздел «Стены» (норматив, раздел 55.1). Заголовок говорит, что
                значит пустая высота: заполнитель поля — не значение. */}
            <div className="stack stack--tight" role="group" aria-label="Стены">
              <p className="field__label--cap">Стены</p>
              <p className="field__hint">Пустая высота — как у помещения; пустая подпись — «Стена N».</p>
              {стены.map((стена, index) => {
                const место = index + 1;
                const подпись = стена.label.trim() === "" ? null : стена.label.trim();
                const имя = wallName(место, подпись);
                const вДомене = стеныДомена.find((wall) => wall.id === (стена.id ?? стена.ключ));
                const сохранённая = стена.id === undefined ? undefined : room?.walls.find((wall) => wall.id === стена.id);
                const площадь = вДомене === undefined || обмер === null ? null : {
                  брутто: singleWallArea(обмер, вДомене),
                  нетто: singleWallAreaNet(обмер, вДомене),
                };
                /* Двери соседей без второй стороны. У новой строки касание
                   «Привязать» сначала сохраняет лист — тем же путём, что
                   органы проёма: стена появляется и тут же получает проём.
                   Предлагаются двери, а не всякий проём без второй стороны:
                   окно наружной стены остаётся без неё навсегда, и каждое
                   окно квартиры стояло бы предложением в каждой строке
                   каждой стены. Окно между помещениями привязывается из
                   своего листа выбором стены соседа. Расхождение с нормативом
                   55.1 записано находкой П-80 до решения заказчика. */
                const предложения = unbound.filter((проём) => проём.roomId !== room?.id
                  && ПРЕДЛАГАЮТСЯ_К_ПРИВЯЗКЕ.includes(проём.kind));
                const удаляется = удаляюСтену === стена.ключ;
                /* На стену ссылаются позиции сметы — отказ вместо кнопки
                   подтверждения, тем же правилом домена, что у сервера
                   (норматив 55.5; П-88): кнопка, которая заведомо получит
                   отказ, обещала бы удаление. */
                const отказУдаления = сохранённая === undefined || room === null
                  ? null
                  : wallRemovalFault(room.name, [{ name: сохранённая.name, refs: сохранённая.estimateItems }]);
                const задать = (поле: "label" | "length" | "height") =>
                  (event: React.ChangeEvent<HTMLInputElement>): void => {
                    const next = event.target.value;
                    setСтены((current) => current.map((строка) =>
                      строка.ключ === стена.ключ ? { ...строка, [поле]: next } : строка));
                  };
                return (
                  /* Строка стены — `fieldset` с именем стены в заголовке и
                     площадями брутто и нетто рядом (норматив, раздел 55.1).
                     Класс `openings` снимает рамку и минимальную ширину
                     группы и даёт полям ряда сжиматься: три поля встают в
                     ряд и на 390 px. Рамка строки — панель внутри. */
                  <fieldset className="openings" key={стена.ключ} aria-label={имя}>
                    <legend className="field__label">
                      {имя}
                      {площадь !== null && (
                        <span className="t-sm t-muted">
                          {" · "}{formatMeasure(площадь.брутто, "м²")} · нетто {formatMeasure(площадь.нетто, "м²")}
                        </span>
                      )}
                    </legend>
                    <div className="panel panel--sheet panel--pad stack stack--tight">
                    <div className="row">
                      <label className="field">
                        <span className="field__label">Подпись</span>
                        <input
                          className="input"
                          value={стена.label}
                          maxLength={40}
                          placeholder={`Стена ${String(место)}`}
                          onChange={задать("label")}
                        />
                      </label>
                      <label className="field">
                        <span className="field__label">Длина, м</span>
                        <input
                          ref={(element) => {
                            if (element === null) поляДлины.current.delete(стена.ключ);
                            else поляДлины.current.set(стена.ключ, element);
                          }}
                          className="input input--num"
                          inputMode="decimal"
                          value={стена.length}
                          aria-invalid={стена.length !== "" && длинаСтены(стена) === null}
                          onChange={задать("length")}
                        />
                      </label>
                      <label className="field">
                        <span className="field__label">Высота, м</span>
                        <input
                          className="input input--num"
                          inputMode="decimal"
                          value={стена.height}
                          placeholder={высотаПомещения}
                          aria-invalid={высотаСтены(стена) === null}
                          onChange={задать("height")}
                        />
                      </label>
                    </div>

                    {(сохранённая?.openings ?? []).map((opening) => {
                      const откосы = opening.reveal === null
                        ? "откосы не измерены"
                        : `откосы ${formatMeasure(BigInt(opening.reveal), "м.п.")}`;
                      /* Сосед — словами норматива 55.1: «в «Коридор»» или «вторая
                         сторона не привязана»; у стороны Б — откуда проём заведён. */
                      const сосед = opening.other === null
                        ? "вторая сторона не привязана"
                        : opening.side === "A"
                          ? `в «${opening.other.roomName}»`
                          : `из «${opening.other.roomName}», ${opening.other.wallName}`;
                      return (
                        <div className="row row--wrap" key={opening.id}>
                          <span className="t-sm">{проёмСловами(opening)} · {откосы} · {сосед}</span>
                          <button
                            type="button"
                            className="btn btn--text"
                            disabled={busy || !ready}
                            aria-label={`Править проём: ${проёмСловами(opening)}, ${имя}`}
                            onClick={() => { действие({ вид: "правка проёма", стена: место, openingId: opening.id }); }}
                          >
                            Править
                          </button>
                        </div>
                      );
                    })}

                    {предложения.map((проём) => (
                      <div className="row row--wrap" key={проём.id}>
                        <span className="t-sm">
                          «{проём.roomName}»: {проёмСловами(проём).toLowerCase()} — вторая сторона не привязана
                        </span>
                        <button
                          type="button"
                          className="btn btn--secondary"
                          disabled={busy || !ready}
                          onClick={() => { действие({ вид: "привязать", стена: место, openingId: проём.id }); }}
                        >
                          Привязать к этой стене
                        </button>
                      </div>
                    ))}

                    {удаляется && удаляемая !== null && отказУдаления !== null ? (
                      <div className="stack stack--tight" role="group" aria-label={`Удаление: ${имя}`}>
                        <p className="field__error" role="alert">{отказУдаления}</p>
                        <button
                          type="button"
                          className="btn btn--text btn--block"
                          onClick={() => { setУдаляюСтену(null); onClearError(); }}
                        >
                          Не удалять
                        </button>
                      </div>
                    ) : удаляется && удаляемая !== null ? (
                      <div className="stack stack--tight" role="group" aria-label={`Удаление: ${имя}`}>
                        <p className="t-sm">{имя} будет удалена.</p>
                        {судьбаПроёмов(new Set(стена.id === undefined ? [] : [стена.id])).map((строка, номер) => (
                          <p className="t-sm" key={`${String(номер)}-${строка}`}>{строка}</p>
                        ))}
                        {обмер !== null && вДомене !== undefined && (
                          <p className="t-sm">
                            Площадь стен нетто помещения: {formatMeasure(wallAreaNet(обмер), "м²")} →{" "}
                            {formatMeasure(wallAreaNet({ ...обмер, walls: стеныДомена.filter((wall) => wall.id !== вДомене.id) }), "м²")}.
                          </p>
                        )}
                        {!ready && (
                          <p className="field__hint">Сначала исправьте поля листа: удаление сохраняет помещение без этой стены.</p>
                        )}
                        {error !== null && <p className="field__error" role="alert">{error}</p>}
                        <button
                          type="button"
                          className="btn btn--danger btn--block"
                          disabled={busy || !ready}
                          onClick={() => { onSave(тело(стена.ключ), { вид: "остаться" }); }}
                        >
                          Удалить стену
                        </button>
                        <button
                          type="button"
                          className="btn btn--text btn--block"
                          onClick={() => { setУдаляюСтену(null); onClearError(); }}
                        >
                          Не удалять
                        </button>
                      </div>
                    ) : (
                      /* Органы строки — плотнее обычного ряда: «Добавить
                         окно» и «Добавить дверь» встают в одну строку и на
                         390 px, «Удалить стену» — под ними. */
                      <div className="row row--wrap" style={{ ["--row-gap" as string]: "var(--space-1)" }}>
                        {(["WINDOW", "DOOR"] as const).map((kind) => (
                          <button
                            key={kind}
                            type="button"
                            className="btn btn--text"
                            disabled={busy || !ready}
                            aria-label={`${ДОБАВИТЬ_ПРОЁМ[kind]}: ${имя}`}
                            onClick={() => { действие({ вид: "проём", стена: место, kind }); }}
                          >
                            <svg className="icon" aria-hidden="true"><use href="#i-plus" /></svg>
                            {ДОБАВИТЬ_ПРОЁМ[kind]}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="btn btn--text"
                          disabled={busy}
                          aria-label={`Удалить стену: ${имя}`}
                          onClick={() => { удалитьСтену(стена.ключ); }}
                        >
                          <svg className="icon" aria-hidden="true"><use href="#i-minus" /></svg>
                          Удалить стену
                        </button>
                      </div>
                    )}
                    </div>
                  </fieldset>
                );
              })}
              <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={добавитьСтену}>
                <svg className="icon" aria-hidden="true"><use href="#i-plus" /></svg>
                {завести("стена")}
              </button>
              {!стеныВерны && (
                <p className="field__error" role="alert">
                  Длина стены обязательна, высота — пусто или число: метры с запятой, «4,6».
                </p>
              )}
            </div>

            {/* Сумма длин против периметра потолка — допуск Д15:
                предупреждение, а не отказ (норматив, раздел 55.2). */}
            {обмер !== null && естьСтены && (
              <p className="spec">
                <span className="spec__item">
                  Сумма длин стен
                  <span className="spec__value">{formatMeasure(wallsLength(обмер) ?? 0n, "м")}</span>
                </span>
                <span className="spec__item">
                  Периметр потолка
                  <span className="spec__value">{formatMeasure(обмер.ceilingPerimeter, "м")}</span>
                </span>
              </p>
            )}
            {допуск !== null && <p className="field__hint" role="status">{допуск} Сохранить можно.</p>}

            {обмер !== null && (
              <p className="spec">
                <span className="spec__item">
                  Площадь стен<span className="spec__value">{formatMeasure(wallArea(обмер), "м²")}</span>
                </span>
                <span className="spec__item">
                  Площадь стен нетто
                  <span className="spec__value">{formatMeasure(wallAreaNet(обмер), "м²")}</span>
                </span>
              </p>
            )}
            {проёмыБольшеСтен !== null && <p className="field__hint" role="status">{проёмыБольшеСтен}</p>}

            {/* Первая стена: что снимется (норматив, раздел 55.3). */}
            {снимется !== null && (
              <p className="panel panel--sheet panel--pad t-sm" role="note">{снимется}</p>
            )}

            {error !== null && удаляюСтену === null && <p className="field__error" role="alert">{error}</p>}

            <button type="submit" className="btn btn--primary btn--block" disabled={busy || !ready}>
              {room === null ? завести("помещение") : "Сохранить"}
            </button>
            {onDelete !== null && (
              <button type="button" className="btn btn--text btn--block" onClick={() => { setConfirming(true); }}>
                Удалить помещение
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
