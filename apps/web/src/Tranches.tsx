import { useCallback, useEffect, useState } from "react";
import { Пусто, пусто } from "./empty.js";
import type { Role, Tranche, TranchePayment, TrancheView } from "@priyomka/contracts";
import { formatKopecks, formatPercent } from "@priyomka/ui";
import { ownerLevel } from "@priyomka/domain";
import {
  addPayment, closeTranche, createTranche, errorMessage, fetchTranches, payTranche, reversePayment,
} from "./api.js";
import { Announce } from "./Announce.js";
import { TrancheSheet } from "./TrancheSheet.js";
import { PaymentReversalSheet, PaymentSheet } from "./PaymentSheet.js";
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

/**
 * Ведут транши руководитель и бухгалтер: это денежное обязательство перед
 * заказчиком, и с 19.09.2026 деньги ведут двое (ответ на вопрос 7 квиза).
 * Предикат спрашивается у домена, а не пишется здесь сравнением: то же
 * правило спрашивает страж сервера, и второе его написание разошлось бы с
 * первым молча — экран показал бы кнопку, которой сервер откажет.
 */
const canLead = (role: Role): boolean => ownerLevel(role);

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

/**
 * Подпись расхождения отметки с платежами.
 *
 * `null` — расхождения нет. У закрытого транша непокрытое расхождением не
 * является: это обычный долг, ради которого транш и закрывают.
 */
const расхождение = (транш: Tranche): string | null => {
  const непокрыто = BigInt(транш.outstanding);
  if (непокрыто === 0n) return null;
  if (транш.status === "PAID") {
    return непокрыто > 0n
      ? `недобор ${formatKopecks(непокрыто)}`
      : `переплата ${formatKopecks(-непокрыто)}`;
  }
  return непокрыто < 0n ? `переплата ${formatKopecks(-непокрыто)}` : null;
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
  /* Закрытие и оплата меняют пилюлю состояния — перерисовку чтением с
     экрана не объявляют. */
  const [объявление, setОбъявление] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  /* Транш, по которому записывают платёж, и платёж, который сторнируют.
     Хранятся опознавателями, а не объектами: ответ сервера пересобирает вид
     целиком, и сохранённый объект стал бы копией прежнего состояния. */
  const [платёжПо, setПлатёжПо] = useState<string | null>(null);
  const [сторно, setСторно] = useState<{ trancheId: string; payment: TranchePayment } | null>(null);
  const [раскрыто, setРаскрыто] = useState<readonly string[]>([]);

  const load = useCallback(() => {
    fetchTranches(code)
      .then((next) => { setView(next); setError(null); })
      .catch((cause: unknown) => { setError(errorMessage(cause)); });
  }, [code]);

  useEffect(() => { load(); }, [load]);

  const run = (action: Promise<TrancheView>, сказать: string): void => {
    setBusy(true);
    action
      .then((next) => {
        setView(next);
        setOpening(false);
        setSheetError(null);
        setОбъявление(сказать);
        onEvents();
      })
      .catch((cause: unknown) => { setSheetError(errorMessage(cause)); })
      .finally(() => { setBusy(false); });
  };

  if (error !== null) return <p className="field__error" role="alert">{error}</p>;
  if (view === null) return <span className="skeleton skeleton--row" aria-hidden="true" />;

  const ведёт = canLead(role);
  const открытый = view.current;
  const платёжный = view.tranches.find((транш) => транш.id === платёжПо) ?? null;

  return (
    <div className="stack stack--loose">
      <Announce text={объявление} />
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
                  onClick={() => { run(closeTranche(code, открытый.id, {}), `Транш № ${String(открытый.number)} закрыт`); }}
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
                {расхождение(транш) !== null && (
                  <span className="pill pill--warn">{расхождение(транш)}</span>
                )}
                {ведёт && транш.status === "CLOSED" && (
                  <button
                    type="button"
                    className="btn btn--text"
                    disabled={busy}
                    onClick={() => { run(payTranche(code, транш.id), `Транш № ${String(транш.number)} отмечен оплаченным`); }}
                  >
                    Отметить оплату
                  </button>
                )}
                {ведёт && транш.status !== "OPEN" && (
                  <button
                    type="button"
                    className="btn btn--text"
                    disabled={busy}
                    onClick={() => { setПлатёжПо(транш.id); setSheetError(null); }}
                  >
                    Записать платёж
                  </button>
                )}
                {транш.payments.length > 0 && (
                  <button
                    type="button"
                    className="btn btn--text"
                    aria-expanded={раскрыто.includes(транш.id)}
                    onClick={() => {
                      setРаскрыто((прежде) => прежде.includes(транш.id)
                        ? прежде.filter((id) => id !== транш.id)
                        : [...прежде, транш.id]);
                    }}
                  >
                    Платежи ({транш.payments.length})
                  </button>
                )}
              </span>
              <span className="tranche__figures">
                <span>сумма <b className="num">{formatKopecks(BigInt(транш.amount))}</b></span>
                <span>выработано <b className="num">{formatKopecks(BigInt(транш.client))}</b></span>
                <span>оплачено <b className="num">{formatKopecks(BigInt(транш.paid))}</b></span>
                <span>
                  остаток{" "}
                  <b className={BigInt(транш.remainder) < 0n ? "num tranche__over" : "num"}>
                    {formatKopecks(BigInt(транш.remainder))}
                  </b>
                </span>
              </span>
              {раскрыто.includes(транш.id) && (
                <ul className="tranche__payments">
                  {транш.payments.map((платёж) => (
                    <li className="tranche__payment" key={платёж.id}>
                      <span className="t-sm">{день(платёж.paidOn)}</span>
                      <b className={BigInt(платёж.amount) < 0n ? "num tranche__over" : "num"}>
                        {formatKopecks(BigInt(платёж.amount))}
                      </b>
                      <span className="t-sm t-muted">
                        {платёж.reversalOfId !== null
                          ? `сторно: ${платёж.reason ?? пусто("причина")}`
                          : платёж.comment ?? пусто("основание")}
                      </span>
                      {ведёт && платёж.reversalOfId === null && !платёж.reversed && (
                        <button
                          type="button"
                          className="btn btn--text"
                          disabled={busy}
                          onClick={() => { setСторно({ trancheId: транш.id, payment: платёж }); setSheetError(null); }}
                        >
                          Сторно
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
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

      {платёжный !== null && (
        <PaymentSheet
          tranche={платёжный}
          busy={busy}
          error={sheetError}
          onSubmit={(input) => {
            run(
              addPayment(code, платёжный.id, input),
              `Платёж по траншу № ${String(платёжный.number)} записан`,
            );
            setПлатёжПо(null);
          }}
          onClose={() => { setПлатёжПо(null); setSheetError(null); }}
        />
      )}

      {сторно !== null && (
        <PaymentReversalSheet
          payment={сторно.payment}
          busy={busy}
          error={sheetError}
          onSubmit={(reason) => {
            run(
              reversePayment(code, сторно.trancheId, сторно.payment.id, reason),
              "Платёж сторнирован",
            );
            setСторно(null);
          }}
          onClose={() => { setСторно(null); setSheetError(null); }}
        />
      )}

      {opening && (
        <TrancheSheet
          openNumber={открытый?.number ?? null}
          hasPrepayment={view.tranches.some((транш) => транш.number === 0)}
          busy={busy}
          error={sheetError}
          onSubmit={(input) => { run(createTranche(code, input), "Транш открыт"); }}
          onClose={() => { setOpening(false); setSheetError(null); }}
        />
      )}
    </div>
  );
}
