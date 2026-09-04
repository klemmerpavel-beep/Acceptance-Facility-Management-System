import { useState } from "react";
import type { CreateMeasureRoom, MeasureRoom } from "@priyomka/contracts";
import { formatMeasure } from "@priyomka/ui";
import { useModalDialog } from "./modal.js";

/**
 * Ввод и правка помещения.
 *
 * Прораб вводит четыре величины: площадь пола, периметр пола, периметр
 * потолка и высоту. Площадь стен и объём здесь не спрашиваются — они
 * выводятся и показываются на экране после сохранения. Спрашивать
 * производную значило бы допустить обмер, в котором объём не сходится с
 * площадью и высотой.
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
const toInput = (milli: string): string => {
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

export function RoomSheet({
  room,
  busy,
  error,
  onSave,
  onDelete,
  onClose,
}: {
  room: MeasureRoom | null;
  busy: boolean;
  error: string | null;
  onSave: (room: CreateMeasureRoom) => void;
  onDelete: (() => void) | null;
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

  const milli = Object.fromEntries(
    FIELDS.map((field) => [field.key, toMilli(values[field.key])]),
  ) as Record<FieldKey, string | null>;
  const ready = name.trim().length > 0 && FIELDS.every((field) => milli[field.key] !== null);

  const submit: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!ready) return;
    onSave({
      name: name.trim(),
      floorArea: milli.floorArea ?? "",
      floorPerimeter: milli.floorPerimeter ?? "",
      ceilingPerimeter: milli.ceilingPerimeter ?? "",
      height: milli.height ?? "",
      ...(room === null ? {} : { openings: room.openings }),
    });
  };

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div
        className="sheet"
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
            <p className="t-body">
              Помещение «{room?.name ?? ""}» будет удалено вместе с его величинами и проёмами.
              Итоги по объекту уменьшатся на {formatMeasure(BigInt(room?.floorArea ?? "0"), "м²")} площади
              и {formatMeasure(BigInt(room?.volume ?? "0"), "м³")} объёма.
            </p>
            <button type="button" className="btn btn--danger btn--block" disabled={busy} onClick={onDelete}>
              Удалить помещение
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

            {error !== null && <p className="field__error" role="alert">{error}</p>}

            <button type="submit" className="btn btn--primary btn--block" disabled={busy || !ready}>
              {room === null ? "Внести помещение" : "Сохранить"}
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
