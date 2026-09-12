import { useState } from "react";
import { пусто } from "./empty.js";
import type { AcceptancePosition, AcceptanceSection } from "@priyomka/contracts";
import { sectionTitle, acceptanceFault, milliunits } from "@priyomka/domain";
import { formatMeasure } from "@priyomka/ui";
import { useModalDialog } from "./modal.js";

/**
 * Лист подтверждения пакета приёмки.
 *
 * Количества подставлены остатком: чаще всего принимают всё, что осталось,
 * и заполненное поле экономит касание на каждой позиции пакета.
 *
 * Снимок обязателен. Камера открывается сразу — `capture="environment"`
 * говорит телефону взять заднюю камеру, а не показать выбор источника: на
 * объекте снимают стену, а не выбирают файл.
 *
 * Валидатор тот же, что на сервере: отказ виден до обращения к сети.
 */

/** Строка ввода в тысячные доли: «18,4» → 18400. Пусто и мусор дают null. */
export function toMilli(input: string): bigint | null {
  const cleaned = input.trim().replace(",", ".");
  if (!/^\d{1,7}(\.\d{1,3})?$/.test(cleaned)) return null;
  const [whole = "0", fraction = ""] = cleaned.split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
}

/** Тысячные доли в строку поля: 18400 → «18,4». */
const toInput = (value: bigint): string => {
  const whole = value / 1000n;
  const fraction = (value % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${String(whole)},${fraction}` : String(whole);
};

export function AcceptSheet({
  section,
  picked,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  section: AcceptanceSection;
  picked: readonly AcceptancePosition[];
  busy: boolean;
  error: string | null;
  onSubmit: (input: {
    positions: { itemId: string; qty: string }[];
    comment: string;
    photo: File;
  }) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog<HTMLInputElement>(onClose);
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(picked.map((position) => [position.id, toInput(BigInt(position.remaining))])));
  const [comment, setComment] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);

  /* Отказ ищется по первой нарушившей позиции: человеку нужна одна причина,
     а не список из двенадцати. */
  const отказ = picked.reduce<string | null>((найденный, position) => {
    if (найденный !== null) return найденный;
    const введено = toMilli(amounts[position.id] ?? "");
    if (введено === null) return `${position.name}. Количество не разобрано.`;
    const fault = acceptanceFault({
      requested: milliunits(введено),
      qty: milliunits(position.qty),
      accepted: milliunits(position.accepted),
      unit: position.unit,
    });
    return fault === null ? null : `${position.name}. ${fault}`;
  }, null);

  const submit: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    /* Проверка повторяется здесь, а не берётся из `ready`: сужение типа
       снимка до непустого нужно самому вызову, и признак готовности его
       не даёт. */
    if (отказ !== null || photo === null) return;
    onSubmit({
      positions: picked.map((position) => ({
        itemId: position.id,
        qty: (toMilli(amounts[position.id] ?? "") ?? 0n).toString(),
      })),
      comment: comment.trim(),
      photo,
    });
  };

  const ready = отказ === null && photo !== null;

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Подтверждение приёмки" ref={dialog}>
        <p className="t-h3">Принять {picked.length} поз.</p>
        <p className="t-sm t-secondary">
          {sectionTitle(section.name)} · {section.stage?.brigade?.name ?? пусто("бригада")}
        </p>

        <form className="stack stack--tight" onSubmit={submit}>
          {picked.map((position, index) => (
            <label className="field" key={position.id}>
              <span className="field__label">{position.name}</span>
              <input
                {...(index === 0 ? { ref: first } : {})}
                className="input input--num"
                inputMode="decimal"
                value={amounts[position.id] ?? ""}
                aria-invalid={toMilli(amounts[position.id] ?? "") === null}
                onChange={(event) => {
                  const next = event.target.value;
                  setAmounts((current) => ({ ...current, [position.id]: next }));
                }}
              />
              <span className="field__hint">
                осталось {formatMeasure(BigInt(position.remaining), position.unit)}
              </span>
            </label>
          ))}

          <label className="filefield">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              disabled={busy}
              onChange={(event) => { setPhoto(event.target.files?.[0] ?? null); }}
            />
            <span className="filefield__button">
              <svg className="icon" aria-hidden="true"><use href="#i-acceptance" /></svg>
              Снять помещение
            </span>
            <span className="filefield__name">{photo?.name ?? "снимок обязателен"}</span>
          </label>

          <label className="field">
            <span className="field__label">Комментарий</span>
            <input
              className="input"
              value={comment}
              maxLength={280}
              onChange={(event) => { setComment(event.target.value); }}
            />
          </label>

          {отказ !== null && <p className="field__error" role="alert">{отказ}</p>}
          {error !== null && <p className="field__error" role="alert">{error}</p>}

          {/* Отключённая кнопка обязана называть, чего ждёт. Прежде она просто
              бледнела: человек видел половинную яркость и не знал, что
              недостающее — снимок, а не заполненное поле и не право доступа.
              Отказ по составу пакета уже назван выше своим сообщением и здесь
              не повторяется. */}
          {отказ === null && photo === null && (
            <p className="field__hint" id="accept-why" role="status">
              Кнопка ждёт снимок: пакет без фотографии свидетельством не является.
            </p>
          )}
          <button
            type="submit"
            className="btn btn--primary btn--block"
            disabled={busy || !ready}
            {...(отказ === null && photo === null ? { "aria-describedby": "accept-why" } : {})}
          >
            Подтвердить
          </button>
          <button type="button" className="btn btn--text btn--block" onClick={onClose}>
            Отмена
          </button>
        </form>
      </div>
    </>
  );
}
