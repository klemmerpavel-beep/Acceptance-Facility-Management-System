import { useState } from "react";
import type { ActView } from "@priyomka/contracts";
import { correctionTotal, kopecks, milliunits } from "@priyomka/domain";
import { formatKopecks, formatMeasure } from "@priyomka/ui";
import { useModalDialog } from "./modal.js";
import { вПоле, количествоВТысячные, рублиВКопейки } from "./EstimateItemSheet.js";

/**
 * Поправка к подписанному акту (этап Э9, ДР-3; решение допроса 07.10.2026).
 *
 * Подписанный акт не меняется: ошибка в нём — неверная цена или лишний
 * объём — исправляется строкой акта текущего транша, «было → стало» и
 * разница суммой. Лист называет, куда поправка войдёт, и не отправляется без
 * причины: заказчик прочтёт её в акте.
 *
 * «Было» — строка акта с учётом прежних поправок к ней: вторая поправка той
 * же строки начинается с того, чем кончилась первая. Сервер считает его сам
 * под блокировкой строки; лист показывает то же число, чтобы разница на
 * экране совпала с разницей в акте.
 */
export function CorrectionSheet({
  act,
  current,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  act: ActView;
  /** Номер открытого транша, в акт которого войдёт поправка; `null` — открытого нет. */
  current: number | null;
  busy: boolean;
  error: string | null;
  onSubmit: (input: { lineId: string; qty: string; unitPrice: string; reason: string }) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog<HTMLSelectElement>(onClose);
  const строки = act.lines.filter((line): line is typeof line & { id: string } => line.id !== null);
  /* Состояние строки после прежних поправок: последняя поправка к ней. */
  const текущее = (id: string): { qty: bigint; unitPrice: bigint } => {
    const строка = строки.find((line) => line.id === id);
    const последняя = act.amendments.filter((поправка) => поправка.lineId === id).at(-1);
    return последняя === undefined
      ? { qty: BigInt(строка?.qty ?? "0"), unitPrice: BigInt(строка?.unitPrice ?? "0") }
      : { qty: BigInt(последняя.qtyAfter), unitPrice: BigInt(последняя.priceAfter) };
  };

  const [lineId, setLineId] = useState(строки[0]?.id ?? "");
  const было = текущее(lineId);
  const [qty, setQty] = useState(вПоле(было.qty, 3));
  const [price, setPrice] = useState(вПоле(было.unitPrice, 2));
  const [reason, setReason] = useState("");

  const выбрать = (id: string): void => {
    setLineId(id);
    const состояние = текущее(id);
    setQty(вПоле(состояние.qty, 3));
    setPrice(вПоле(состояние.unitPrice, 2));
  };

  const новоеКоличество = количествоВТысячные(qty);
  const новаяЦена = рублиВКопейки(price);
  const единица = строки.find((line) => line.id === lineId)?.unit ?? "";
  const разница = новоеКоличество === null || новаяЦена === null
    ? null
    : correctionTotal({
      было: { qty: milliunits(было.qty), unitPrice: kopecks(было.unitPrice) },
      стало: { qty: milliunits(новоеКоличество), unitPrice: kopecks(новаяЦена) },
    });
  const ready = current !== null && lineId !== "" && reason.trim().length > 0
    && новоеКоличество !== null && новаяЦена !== null;

  const submit: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!ready) return;
    onSubmit({
      lineId,
      qty: новоеКоличество.toString(),
      unitPrice: новаяЦена.toString(),
      reason: reason.trim(),
    });
  };

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Поправка к акту" ref={dialog}>
        <p className="t-h3">Поправка к акту № {act.number}</p>
        <form className="stack stack--tight" onSubmit={submit}>
          <p className="t-body">
            Акт № {act.number} подписан и не меняется.{" "}
            {current === null
              ? "Поправка входит в акт текущего транша, а открытого транша у объекта нет: откройте его на вкладке «Транши»."
              : `Поправка войдёт строкой в акт № ${String(current)} — он составится закрытием транша № ${String(current)}, и заказчик подпишет её вместе с ним.`}
          </p>

          <label className="field">
            <span className="field__label">Строка акта</span>
            <select
              ref={first}
              className="input"
              value={lineId}
              onChange={(event) => { выбрать(event.target.value); }}
            >
              {строки.map((line) => (
                <option key={line.id} value={line.id}>{line.name}</option>
              ))}
            </select>
            <span className="field__hint">
              Было: {formatMeasure(было.qty, единица)} × {formatKopecks(было.unitPrice)}
            </span>
          </label>

          <div className="row">
            <label className="field">
              <span className="field__label">Количество, {единица}</span>
              <input
                className="input"
                inputMode="decimal"
                value={qty}
                onChange={(event) => { setQty(event.target.value); }}
              />
            </label>
            <label className="field">
              <span className="field__label">Цена, ₽</span>
              <input
                className="input"
                inputMode="decimal"
                value={price}
                onChange={(event) => { setPrice(event.target.value); }}
              />
            </label>
          </div>

          <label className="field">
            <span className="field__label">Причина</span>
            <input
              className="input"
              value={reason}
              maxLength={280}
              onChange={(event) => { setReason(event.target.value); }}
            />
            <span className="field__hint">Печатается в акте: заказчик подписывает и её.</span>
          </label>

          {разница !== null && (
            <p className="t-sm" role="status">
              Разница по работам: {formatKopecks(разница)}
            </p>
          )}
          {error !== null && <p className="field__error" role="alert">{error}</p>}

          <button type="submit" className="btn btn--primary btn--block" disabled={busy || !ready}>
            Записать поправку
          </button>
          <button type="button" className="btn btn--text btn--block" onClick={onClose}>
            Отмена
          </button>
        </form>
      </div>
    </>
  );
}
