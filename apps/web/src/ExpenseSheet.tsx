import { useEffect, useState } from "react";
import { завести } from "./verbs.js";
import { expenseFault, kopecks, parseRubles } from "@priyomka/domain";
import type { CreateExpense, EstimateView, ExpenseKind, ExpenseView } from "@priyomka/contracts";
import { createExpense, errorMessage, fetchEstimate } from "./api.js";
import { useModalDialog } from "./modal.js";

/**
 * Заведение чека на материалы.
 *
 * **Снимок обязателен.** Расход без свидетельства нельзя предъявить
 * заказчику, а предъявление и есть назначение вкладки: материалы
 * возмещаются по факту. Тот же довод, по которому обязателен снимок у
 * пакета приёмки.
 *
 * Отказ проверяется тем же правилом домена (`expenseFault`), что и на
 * сервере: человек узнаёт о промахе до обращения к сети, а правило остаётся
 * одно на два места применения.
 *
 * Раздел сметы необязателен намеренно: не всякая покупка ложится на раздел,
 * и принуждение к выбору дало бы неверный раздел вместо пустого.
 */

const ВИДЫ = [
  ["MATERIALS", "Материалы"],
  ["DELIVERY", "Доставка"],
  ["TOOLS", "Инструмент"],
  ["OTHER", "Прочее"],
] as const;

const сегодня = (): string => new Date().toISOString().slice(0, 10);

export function ExpenseSheet({
  code,
  onClose,
  onCreated,
}: {
  code: string;
  onClose: () => void;
  onCreated: (view: ExpenseView) => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog<HTMLInputElement>(onClose);
  const [kind, setKind] = useState<ExpenseKind>("MATERIALS");
  const [сумма, setСумма] = useState("");
  const [seller, setSeller] = useState("");
  const [spentAt, setSpentAt] = useState(сегодня());
  const [reimbursable, setReimbursable] = useState(true);
  const [sectionId, setSectionId] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [разделы, setРазделы] = useState<EstimateView["sections"]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Разделы берутся у действующей сметы. Сметы может не быть вовсе — тогда
     поле остаётся с единственным «не отнесён», а не отказывает. */
  useEffect(() => {
    void fetchEstimate(code)
      .then((вид) => { setРазделы(вид.sections); })
      .catch(() => { setРазделы([]); });
  }, [code]);

  const копейки = сумма.trim() === "" ? null : безопасно(сумма);
  const отказ = копейки === null
    ? null
    : expenseFault({ amount: копейки, seller, spentAt }, сегодня());
  const готово = копейки !== null && отказ === null && photo !== null;

  const submit: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    /* Проверка одна: `готово` уже сужает сумму и снимок к непустым —
       TypeScript выводит это по псевдониму условия, и повтор проверки был
       бы мёртвым кодом, а не защитой. */
    if (!готово || busy) return;
    setBusy(true);
    setError(null);
    const чек: CreateExpense = {
      kind,
      amount: копейки.toString(),
      reimbursable,
      seller: seller.trim(),
      spentAt,
      sectionId: sectionId === "" ? null : sectionId,
      note: note.trim() === "" ? null : note.trim(),
    };
    void createExpense(code, чек, photo)
      .then(onCreated)
      .catch((cause: unknown) => { setError(errorMessage(cause)); })
      .finally(() => { setBusy(false); });
  };

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div
        className="sheet sheet--tall"
        role="dialog"
        aria-modal="true"
        aria-label="Новый чек"
        ref={dialog}
      >
        <p className="t-h3">Новый чек</p>

        <form className="stack stack--tight" onSubmit={submit}>
          <label className="field">
            <span className="field__label">Сумма по чеку, ₽</span>
            <input
              ref={first}
              className="input input--num"
              value={сумма}
              inputMode="decimal"
              placeholder="48 700,00"
              onChange={(event) => { setСумма(event.target.value); }}
            />
          </label>

          <label className="field">
            <span className="field__label">Где куплено</span>
            <input
              className="input"
              value={seller}
              maxLength={120}
              placeholder="Петрович"
              onChange={(event) => { setSeller(event.target.value); }}
            />
          </label>

          <div className="formrow">
            <label className="field">
              <span className="field__label">Дата покупки</span>
              <input
                type="date"
                className="input"
                value={spentAt}
                onChange={(event) => { setSpentAt(event.target.value); }}
              />
              <span className="field__hint">С чека, а не сегодняшняя.</span>
            </label>

            <label className="field">
              <span className="field__label">Вид расхода</span>
              <span className="selectwrap">
                <select
                  className="input"
                  value={kind}
                  onChange={(event) => { setKind(event.target.value as ExpenseKind); }}
                >
                  {ВИДЫ.map(([значение, подпись]) => (
                    <option key={значение} value={значение}>{подпись}</option>
                  ))}
                </select>
                <svg className="icon selectwrap__chevron" aria-hidden="true"><use href="#i-chevron" /></svg>
              </span>
            </label>
          </div>

          <label className="field">
            <span className="field__label">Раздел сметы</span>
            <span className="selectwrap">
              <select
                className="input"
                value={sectionId}
                onChange={(event) => { setSectionId(event.target.value); }}
              >
                <option value="">Не отнесён</option>
                {разделы.map((раздел) => (
                  <option key={раздел.id} value={раздел.id}>{раздел.name}</option>
                ))}
              </select>
              <svg className="icon selectwrap__chevron" aria-hidden="true"><use href="#i-chevron" /></svg>
            </span>
            <span className="field__hint">Необязательно: не всякая покупка ложится на раздел.</span>
          </label>

          {/* Возмещение — переключатель, а не выбор из двух: по умолчанию
              материалы возмещаются, и человек снимает пометку в редком
              случае, а не подтверждает обычный. */}
          <label className="checkline">
            <input
              type="checkbox"
              className="checkbox"
              checked={reimbursable}
              onChange={(event) => { setReimbursable(event.target.checked); }}
            />
            <span>Возмещается заказчиком</span>
          </label>

          <label className="field">
            <span className="field__label">Снимок чека</span>
            <span className="filefield">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => { setPhoto(event.target.files?.[0] ?? null); }}
              />
              <span className="filefield__button">
                <svg className="icon" aria-hidden="true"><use href="#i-expense" /></svg>
                Выбрать снимок
              </span>
              <span className="filefield__name">{photo?.name ?? "файл не выбран"}</span>
            </span>
            <span className="field__hint">
              Обязателен: расход без свидетельства нечем предъявить заказчику.
            </span>
          </label>

          <label className="field">
            <span className="field__label">Комментарий</span>
            <input
              className="input"
              value={note}
              maxLength={280}
              placeholder="Гипсокартон, профиль, крепёж"
              onChange={(event) => { setNote(event.target.value); }}
            />
          </label>

          {отказ !== null && <p className="field__error" role="alert">{отказ}</p>}
          {error !== null && <p className="field__error" role="alert">{error}</p>}

          <button
            type="submit"
            className="btn btn--primary btn--block"
            data-loading={busy || undefined}
            disabled={busy || !готово}
          >
            {завести("чек")}
          </button>
          <button type="button" className="btn btn--text btn--block" onClick={onClose}>
            Отмена
          </button>
        </form>
      </div>
    </>
  );
}

/**
 * Разбор рублей в копейки без падения на полуслове.
 *
 * `parseRubles` бросает на негодной строке, а поле правится посимвольно:
 * «48 7» — не ошибка человека, а середина ввода. Отказ показывается тогда,
 * когда сумма разобрана и не устраивает правило, а не тогда, когда её ещё
 * дописывают.
 */
function безопасно(ввод: string): ReturnType<typeof kopecks> | null {
  try {
    return parseRubles(ввод);
  } catch {
    return null;
  }
}
