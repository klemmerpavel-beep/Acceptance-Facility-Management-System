import { useCallback, useEffect, useState } from "react";
import type { AccountingRow, AccountingView, MoneyState } from "@priyomka/contracts";
import { formatKopecks } from "@priyomka/ui";
import { errorMessage, fetchAccounting, payTranche } from "./api.js";
import { Announce } from "./Announce.js";
import { formatDate, plural } from "./status.js";

/**
 * Раздел «Бухгалтерия»: деньги заказчиков по всему портфелю.
 *
 * Вопрос экрана: сколько нам должны и сколько уже заплатили. Ключевое
 * действие — отметить оплату.
 *
 * Раздел ведёт запись о деньгах, а не распоряжается ими. Налоги, страховые
 * взносы, зарплаты по графику, касса и банковские связи письменно
 * исключены из объёма, и раздел с таким названием не повод возвращать их
 * туда: здесь нет ни одного поля, которого не было бы в транше.
 *
 * Единица учёта — транш. Он и есть то, что предъявляется заказчику и
 * оплачивается целиком; вторая сущность платежа завела бы два учёта одних
 * денег, и на первой частичной оплате они разошлись бы.
 */

const STATE_PILL: Record<MoneyState, string> = {
  "в работе": "pill",
  "ждёт оплаты": "pill pill--warn",
  "оплачено": "pill pill--ok",
};

/**
 * Просроченный транш называется просроченным.
 *
 * Прежде строка ведомости несла только состояние: транш, закрытый вчера, и
 * транш, закрытый месяц назад, стояли под одной пилюлей «ждёт оплаты» и
 * различались единственно подписью «ждёт 30 дней» — числом, которое нужно
 * сличать с порогом в уме. Просрочка при этом объявлена числом наверху
 * раздела и пилюлей в своде по заказчикам, а в самой ведомости, где
 * решают, кому звонить, её не было. Опознание идёт словом, цвет — второй
 * канал.
 */
function ПИЛЮЛЯ(row: AccountingRow): { className: string; label: string } {
  if (row.overdue) return { className: "pill pill--danger", label: "просрочено" };
  return { className: STATE_PILL[row.state], label: row.state };
}

const ФИЛЬТРЫ: readonly { key: MoneyState | "все"; label: string }[] = [
  { key: "все", label: "Все" },
  { key: "ждёт оплаты", label: "Ждут оплаты" },
  { key: "в работе", label: "В работе" },
  { key: "оплачено", label: "Оплачены" },
];

export function Accounting({
  onOpenProject,
}: {
  onOpenProject: (code: string) => void;
}): React.JSX.Element {
  const [view, setView] = useState<AccountingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [объявление, setОбъявление] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [фильтр, setФильтр] = useState<MoneyState | "все">("все");

  const load = useCallback(() => {
    fetchAccounting()
      .then((next) => { setView(next); setError(null); })
      .catch((cause: unknown) => { setError(errorMessage(cause)); });
  }, []);

  useEffect(load, [load]);

  if (error !== null) {
    return (
      <div className="empty">
        <p className="empty__title">Бухгалтерия недоступна</p>
        <p className="empty__text">{error}</p>
      </div>
    );
  }
  if (view === null) {
    return <div className="stack" aria-busy="true"><span className="skeleton skeleton--row" /></div>;
  }
  if (view.rows.length === 0) {
    return (
      <div className="empty">
        <p className="empty__title">Денег по объектам пока нет</p>
        <p className="empty__text">
          Здесь появятся транши объектов: сколько предъявлено заказчику, сколько ждёт
          оплаты и сколько получено. Транш заводится на вкладке «Транши» объекта.
        </p>
      </div>
    );
  }

  /* Отметить оплату можно только у закрытого транша — то же правило, что на
     карточке объекта. Открытый транш ещё копит выработку, и сумма к оплате
     по нему не определена. */
  const отметить = (row: AccountingRow): void => {
    setBusy(row.id);
    payTranche(row.projectCode, row.id)
      .then(() => {
        load();
        setError(null);
        setОбъявление(`Транш № ${String(row.number)} по объекту ${row.projectCode} отмечен оплаченным`);
      })
      .catch((cause: unknown) => { setError(errorMessage(cause)); })
      .finally(() => { setBusy(null); });
  };

  const строки = фильтр === "все" ? view.rows : view.rows.filter((row) => row.state === фильтр);
  const просрочено = view.rows.filter((row) => row.overdue).length;

  return (
    <main className="container stack stack--loose">
      <Announce text={объявление} />
      <section className="statrow">
        <MoneyCard label="Оплачено" value={view.totals.paid} note="получено от заказчиков" />
        <MoneyCard
          label="Ждёт оплаты"
          value={view.totals.awaiting}
          note={`предъявлено и не получено`}
          {...(просрочено > 0 ? { tone: "warn" as const } : {})}
        />
        <MoneyCard
          label="Просрочено"
          value={view.totals.overdue}
          note={`дольше ${view.totals.graceDays} ${plural(view.totals.graceDays, "дня", "дней", "дней")} без оплаты`}
          {...(view.totals.overdue !== "0" ? { tone: "danger" as const } : {})}
        />
        <MoneyCard label="В работе" value={view.totals.inWork} note="сумма к оплате не определена" />
      </section>

      <section className="stack">
        <div className="section-head">
          <h2 className="t-h2">Транши по объектам</h2>
          <div className="segmented" role="group" aria-label="Состояние денег">
            {ФИЛЬТРЫ.map((item) => (
              <button
                key={item.key}
                type="button"
                className="segmented__option"
                aria-pressed={фильтр === item.key}
                onClick={() => { setФильтр(item.key); }}
              >
                <span className="segmented__label">{item.label}</span>
              </button>
            ))}
          </div>
        </div>

        {строки.length === 0 ? (
          <p className="t-sm t-muted">В этом состоянии траншей нет — отбор сузил список до пустого.</p>
        ) : (
          <ul className="money">
            {строки.map((row) => (
              <li className="money__row" key={row.id}>
                <button
                  type="button"
                  className="money__project"
                  onClick={() => { onOpenProject(row.projectCode); }}
                >
                  <span className="code-badge">{row.projectCode}</span>
                  <span className="money__address" title={row.address}>{row.address}</span>
                </button>
                <span className="money__client t-sm t-muted" title={row.clientName}>{row.clientName}</span>
                <span className="money__num num">№ {row.number}</span>
                <span className="money__sum num">{formatKopecks(BigInt(row.amount))}</span>
                <span className={ПИЛЮЛЯ(row).className}>{ПИЛЮЛЯ(row).label}</span>
                <span className="money__when t-sm t-muted">{ПОДПИСЬ_СРОКА(row)}</span>
                <span className="money__act">
                  {row.state === "ждёт оплаты" && (
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled={busy !== null}
                      onClick={() => { отметить(row); }}
                    >
                      Отметить оплату
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {view.expenses.length > 0 && (
        <section className="stack">
          <div className="section-head">
            <h2 className="t-h2">Расходы на материалы</h2>
            <p className="t-sm t-muted">деньги студии, а не заказчиков</p>
          </div>
          {/* Раздел стоит ОТДЕЛЬНО от четырёх величин наверху и слагаемым им
              не является. Реестр отвечает на вопрос «сколько должны
              заказчики»; материалы — деньги студии, и сложенные вместе они
              дали бы число, которым никто не распоряжается. Подпись раздела
              говорит это словами, а не оставляет догадываться по вёрстке. */}
          <p className="spec">
            <span className="spec__item">
              Потрачено
              <span className="spec__value">{formatKopecks(BigInt(view.materials.spent))}</span>
            </span>
            <span className="spec__item">
              К возмещению заказчиками
              <span className="spec__value">
                {formatKopecks(BigInt(view.materials.reimbursable))}
              </span>
            </span>
          </p>
          {/* Свой класс, а не `money__row`: у строки расхода нет состояния
              оплаты, и правило «состояние названо словом» к ней не
              относится. Чужой класс сделал бы её девятой строкой реестра
              клиентских денег — для проверки и для читателя одинаково. */}
          <ul className="money spend">
            {view.expenses.map((строка) => (
              <li className="money__row spend__row" key={строка.projectCode}>
                <span className="code-badge">{строка.projectCode}</span>
                <span className="money__address" title={строка.address}>{строка.address}</span>
                <span className="money__when t-sm t-muted">потрачено</span>
                <span className="money__sum num">{formatKopecks(BigInt(строка.spent))}</span>
                <span className="money__when t-sm t-muted">к возмещению</span>
                <span className="money__sum num t-muted">
                  {formatKopecks(BigInt(строка.reimbursable))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.clients.length > 0 && (
        <section className="stack">
          <div className="section-head">
            <h2 className="t-h2">По заказчикам</h2>
            <p className="t-sm t-muted">от большего долга к меньшему</p>
          </div>
          {/* Подпись стоит перед числом: «ждёт оплаты 0,00 ₽» читается слева
              направо, а число с подписью после него заставляет возвращаться
              глазом. */}
          <ul className="money money--clients">
            {view.clients.map((client) => (
              <li className="money__row money__row--client" key={client.clientId}>
                <span className="money__address" title={client.name}>{client.name}</span>
                <span className="money__when t-sm t-muted">ждёт оплаты</span>
                <span className="money__sum num">
                  {formatKopecks(BigInt(client.awaiting))}
                </span>
                <span className="money__when t-sm t-muted">получено</span>
                <span className="money__sum num t-muted">
                  {formatKopecks(BigInt(client.paid))}
                </span>
                <span className="money__act">
                  {client.overdue && <span className="pill pill--danger">есть просрочка</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

/**
 * Подпись срока: что произошло с деньгами последним и когда.
 *
 * Для ждущего транша названо не событие, а ожидание: «ждёт 12 дней» —
 * величина, которой распоряжаются, а дата закрытия требует вычитания в уме.
 */
function ПОДПИСЬ_СРОКА(row: AccountingRow): string {
  if (row.state === "оплачено") {
    return row.paidAt === null ? "оплачено" : `оплачен ${formatDate(row.paidAt.slice(0, 10))}`;
  }
  if (row.state === "ждёт оплаты") {
    const дней = row.awaitingDays ?? 0;
    return дней === 0 ? "закрыт сегодня" : `ждёт ${дней} ${plural(дней, "день", "дня", "дней")}`;
  }
  return `открыт ${formatDate(row.openedAt.slice(0, 10))}`;
}

/** Денежное число раздела. Тон сигнальный только там, где требуется действие. */
function MoneyCard({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "warn" | "danger";
}): React.JSX.Element {
  const классЧисла = tone === undefined
    ? "statcard__value"
    : tone === "warn" ? "statcard__value statcard__value--warn" : "statcard__value statcard__value--danger";
  return (
    <div className="statcard">
      <span className="statcard__label">{label}</span>
      <span className={классЧисла}>{formatKopecks(BigInt(value))}</span>
      <span className="statcard__note">{note}</span>
    </div>
  );
}
