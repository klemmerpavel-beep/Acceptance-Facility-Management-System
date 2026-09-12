import { useCallback, useEffect, useState } from "react";
import { Пусто, пусто } from "./empty.js";
import type { Role, Tranche, TrancheView } from "@priyomka/contracts";
import { formatKopecks, formatPercent } from "@priyomka/ui";
import { closeTranche, createTranche, errorMessage, fetchTranches, payTranche } from "./api.js";
import { TrancheSheet } from "./TrancheSheet.js";
import { TrancheStrip } from "./TrancheStrip.js";

/**
 * Вкладка «Транши».
 *
 * Вопрос экрана: сколько ещё можно выработать до следующего акта. Ключевое
 * действие — открыть транш; его выполняет руководитель.
 *
 * Читают все, кому виден объект. Внутренних величин в транше нет ни одной:
 * это сумма платежа клиента, а ставка и прибыль остались в смете. Прорабу
 * остаток говорит границу его собственной работы, и прятать её значило бы
 * заставить его принимать вслепую.
 */

/** Ведёт транши руководитель: это денежное обязательство перед заказчиком. */
const canLead = (role: Role): boolean => role === "OWNER";

/* Имена классов состояния — литеральной картой, а не подстановкой в строку:
   проверка мёртвых правил сверяет имена дословно и построенных шаблоном не
   находит, из-за чего живое правило считается мёртвым. */
const STATUS_PILL = {
  OPEN: "pill pill--warn",
  CLOSED: "pill",
  PAID: "pill pill--ok",
} as const;

const STATUS_LABEL = {
  OPEN: "Открыт",
  CLOSED: "Закрыт",
  PAID: "Оплачен",
} as const;

const день = (iso: string): string => {
  const [год = "", месяц = "", число = ""] = iso.slice(0, 10).split("-");
  return `${число}.${месяц}.${год}`;
};

/** Заголовок транша: номер и основание, если оно названо. */
const основание = (транш: Tranche): string =>
  транш.comment ?? (транш.number === 0 ? "Предоплата" : пусто("основание"));

export function Tranches({
  code,
  role,
  onEvents,
}: {
  code: string;
  role: Role;
  onEvents: () => void;
}): React.JSX.Element {
  const [view, setView] = useState<TrancheView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);

  const load = useCallback(() => {
    fetchTranches(code)
      .then((next) => { setView(next); setError(null); })
      .catch((cause: unknown) => { setError(errorMessage(cause)); });
  }, [code]);

  useEffect(() => { load(); }, [load]);

  const run = (action: Promise<TrancheView>): void => {
    setBusy(true);
    action
      .then((next) => {
        setView(next);
        setOpening(false);
        setSheetError(null);
        onEvents();
      })
      .catch((cause: unknown) => { setSheetError(errorMessage(cause)); })
      .finally(() => { setBusy(false); });
  };

  if (error !== null) return <p className="field__error" role="alert">{error}</p>;
  if (view === null) return <span className="skeleton skeleton--row" aria-hidden="true" />;

  const ведёт = canLead(role);
  const открытый = view.current;

  return (
    <div className="stack stack--loose">
      <section className="stack stack--tight">
        <div className="section-head">
          <h3 className="t-h3">
            {открытый === null
              ? Пусто("транш")
              : `Транш № ${String(открытый.number)} · открыт ${день(открытый.openedAt)}`}
          </h3>
          {ведёт && (
            <div className="row">
              {открытый !== null && (
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={busy}
                  onClick={() => { run(closeTranche(code, открытый.id, {})); }}
                >
                  Закрыть транш
                </button>
              )}
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={() => { setOpening(true); setSheetError(null); }}
              >
                Открыть транш
              </button>
            </div>
          )}
        </div>

        {открытый === null
          ? (
            <p className="empty__text">
              Приёмка идёт и без транша: выработка сохраняется и попадёт в разрез «вне транша».
              Транш назначает границу платежа — сколько выработать до следующего акта.
            </p>
          )
          : <TrancheStrip tranche={открытый} />}

        {sheetError !== null && !opening && (
          <p className="field__error" role="alert">{sheetError}</p>
        )}
      </section>

      <section className="stack stack--tight">
        <div className="section-head">
          <h3 className="t-h3">Транши объекта</h3>
          <span className="t-cap">надбавка {formatPercent(BigInt(view.supervisionShare))}</span>
        </div>

        {view.tranches.length === 0
          ? (
            <div className="empty">
              <p className="empty__title">Траншей нет</p>
              <p className="empty__text">
                Первым обычно заводят предоплату — транш № 0, сразу оплаченный.
              </p>
            </div>
          )
          : view.tranches.map((транш) => (
            <div className="tranche__row" key={транш.id}>
              <span className="t-body">
                <span className="tranche__no">№&nbsp;{транш.number}</span>
                {" "}
                {основание(транш)}
              </span>
              <span className="tranche__state">
                <span className={STATUS_PILL[транш.status]}>{STATUS_LABEL[транш.status]}</span>
                {ведёт && транш.status === "CLOSED" && (
                  <button
                    type="button"
                    className="btn btn--text"
                    disabled={busy}
                    onClick={() => { run(payTranche(code, транш.id)); }}
                  >
                    Отметить оплату
                  </button>
                )}
              </span>
              <span className="tranche__figures">
                <span>сумма <b className="num">{formatKopecks(BigInt(транш.amount))}</b></span>
                <span>выработано <b className="num">{formatKopecks(BigInt(транш.client))}</b></span>
                <span>
                  остаток{" "}
                  <b className={BigInt(транш.remainder) < 0n ? "num tranche__over" : "num"}>
                    {formatKopecks(BigInt(транш.remainder))}
                  </b>
                </span>
              </span>
            </div>
          ))}

        {view.outside.batches > 0 && (
          <p className="empty__text">
            Вне транша: {view.outside.batches} пакетов приёмки на{" "}
            {formatKopecks(BigInt(view.outside.client))}. Это приёмки, записанные до того, как
            транш завели; в транш они не переносятся — история не переписывается.
          </p>
        )}
      </section>

      {opening && (
        <TrancheSheet
          openNumber={открытый?.number ?? null}
          hasPrepayment={view.tranches.some((транш) => транш.number === 0)}
          busy={busy}
          error={sheetError}
          onSubmit={(input) => { run(createTranche(code, input)); }}
          onClose={() => { setOpening(false); setSheetError(null); }}
        />
      )}
    </div>
  );
}
