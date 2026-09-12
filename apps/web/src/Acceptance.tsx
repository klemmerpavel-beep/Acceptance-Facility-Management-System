import { sectionTitle } from "@priyomka/domain";
import { useCallback, useEffect, useState } from "react";
import type {
  AcceptanceLine, AcceptanceView, Role,
} from "@priyomka/contracts";
import { formatKopecks, formatMeasure } from "@priyomka/ui";
import {
  acceptancePhotoUrl, createAcceptance, errorMessage, fetchAcceptance, reverseAcceptance,
} from "./api.js";
import { AcceptSheet } from "./AcceptSheet.js";
import { ReversalSheet } from "./ReversalSheet.js";

/**
 * Вкладка «Приёмка» — ядро продукта.
 *
 * Вопрос экрана: что принято и сколько начислено. Ключевое действие —
 * принять пакет позиций; оно единственное первичное.
 *
 * Одно действие прораба порождает три следствия сразу: принятое количество,
 * начисление бригаде и рост выполненного на сумму. Это единственное место
 * продукта, где так происходит.
 *
 * Прораб не видит денег своей бригады. Начисление есть ставка, умноженная на
 * количество, и сумма при известном количестве выдала бы ставку — закрытую
 * от него на уровне полей. Норматив дизайн-системы обещал показывать её в
 * подтверждении; обещание снято, причина записана в редакции 2.8.
 */

/** Отмечает прораб: это его ежедневная работа и единственный источник факта. */
const canAccept = (role: Role): boolean => role === "OWNER" || role === "FOREMAN";

/** Сторнирует руководитель: право отменять начисленное шире права его создавать. */
const canReverse = (role: Role): boolean => role === "OWNER";

const день = (iso: string): string => {
  const [год = "", месяц = "", число = ""] = iso.slice(0, 10).split("-");
  return `${число}.${месяц}.${год}`;
};

export function Acceptance({
  code,
  role,
  onEvents,
}: {
  code: string;
  role: Role;
  onEvents: () => void;
}): React.JSX.Element {
  const [view, setView] = useState<AcceptanceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [picked, setPicked] = useState<readonly string[]>([]);
  /* Поиск и фильтр — состояние вида, а не данных: сервер их не знает и
     перезагрузка вкладки их не трогает. */
  const [запрос, setЗапрос] = useState("");
  const [толькоОстаток, setТолькоОстаток] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reversing, setReversing] = useState<{ line: AcceptanceLine; brigade: string } | null>(null);

  const load = useCallback(() => {
    fetchAcceptance(code)
      .then((next) => { setView(next); setError(null); })
      .catch((cause: unknown) => { setError(errorMessage(cause)); });
  }, [code]);

  useEffect(() => { load(); }, [load]);

  const apply = (next: AcceptanceView): void => {
    setView(next);
    setPicked([]);
    setConfirming(false);
    setReversing(null);
    setSheetError(null);
    onEvents();
  };

  const run = (action: Promise<AcceptanceView>): void => {
    setBusy(true);
    action
      .then(apply)
      .catch((cause: unknown) => { setSheetError(errorMessage(cause)); })
      .finally(() => { setBusy(false); });
  };

  if (error !== null) return <p className="field__error" role="alert">{error}</p>;
  if (view === null) return <p className="t-sm t-muted">Загружаем приёмку…</p>;

  const editable = canAccept(role);
  const sections = view.sections;

  if (sections.length === 0) {
    return (
      <div className="empty">
        <p className="empty__title">Принимать нечего</p>
        <p className="empty__text">
          Приёмке подлежат позиции сметы. Загрузите смету на вкладке «Импорт» — после этого
          её разделы появятся здесь.
        </p>
      </div>
    );
  }

  const selected = sections.find((section) => section.id === current) ?? sections[0] ?? null;
  const выбранные = selected === null
    ? []
    : selected.positions.filter((position) => picked.includes(position.id));

  /*
   * Раздел сметы держит до нескольких десятков позиций, и прораб ищет в нём
   * одну — стоя на объекте, с телефона в руке. Прокрутка списка большим
   * пальцем была единственным способом её найти.
   *
   * Отбор идёт по подстроке без учёта регистра: названия в смете писаны как
   * попало («Штукатурка стен» и «ШТУКАТУРКА ОТКОСОВ» в одном разделе), и
   * точное совпадение не нашло бы ничего.
   */
  const искомое = запрос.trim().toLowerCase();
  const видимые = (selected?.positions ?? []).filter((position) => {
    if (толькоОстаток && BigInt(position.remaining) === 0n) return false;
    return искомое === "" || position.name.toLowerCase().includes(искомое);
  });
  /* Отметка переживает отбор: фильтр — это взгляд, а не снятие отметки.
     Но молчать об отмеченном, которого не видно, нельзя — полоса называет
     число, и человек обязан понимать, откуда оно взялось. */
  const скрытоОтмеченных = выбранные.length
    - видимые.filter((position) => picked.includes(position.id)).length;

  return (
    <div className="accept">
      <div className="row">
        <span className="metric">
          <span className="metric__value">{view.totals.acceptedPositions} / {view.totals.positions}</span>
          <span className="metric__label">принято позиций</span>
        </span>
        <span className="metric">
          <span className="metric__value">{formatKopecks(BigInt(view.totals.accepted))}</span>
          <span className="metric__label">выполнено на сумму</span>
        </span>
        {view.totals.accrued !== undefined && (
          <span className="metric">
            <span className="metric__value">{formatKopecks(BigInt(view.totals.accrued))}</span>
            <span className="metric__label">начислено бригадам</span>
          </span>
        )}
      </div>

      <div className="accept__work">
      <div className="accept__sections" role="tablist" aria-label="Разделы сметы">
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            role="tab"
            aria-selected={section.id === selected?.id}
            className={section.stage === null ? "accept__section accept__section--idle" : "accept__section"}
            onClick={() => { setCurrent(section.id); setPicked([]); }}
          >
            <span>{sectionTitle(section.name)}</span>
            <span className="num t-sm">
              {section.positions.filter((position) => BigInt(position.accepted) > 0n).length}
              {" / "}
              {section.positions.length}
            </span>
          </button>
        ))}
      </div>

      {selected !== null && (
        <div className="accept__list">
          {selected.stage === null && (
            <p className="field__error" role="alert">
              У раздела «{sectionTitle(selected.name)}» нет этапа графика с бригадой. Свяжите раздел с этапом
              на вкладке «Работа»: начисление адресуется бригаде этапа.
            </p>
          )}
          {/* Органы отбора стоят над списком, а не над разделами: ищут внутри
              раздела, и поле, оторванное от того, что оно отбирает, читается
              как поиск по всему объекту. */}
          <div className="accept__filter">
            <label className="datatable__search">
              <svg className="icon" aria-hidden="true"><use href="#i-search" /></svg>
              <span className="visually-hidden">Поиск позиции в разделе</span>
              <input
                id="accept-search"
                type="search"
                value={запрос}
                onChange={(event) => { setЗапрос(event.target.value); }}
                placeholder="Поиск позиции в разделе"
              />
            </label>
            <label className="checkline">
              <input
                id="accept-remaining-only"
                type="checkbox"
                className="checkbox"
                checked={толькоОстаток}
                onChange={(event) => { setТолькоОстаток(event.target.checked); }}
              />
              <span className="t-sm">Только с остатком</span>
            </label>
            <span className="t-sm t-secondary num">
              {видимые.length} / {selected.positions.length}
            </span>
          </div>

          {видимые.length === 0 && (
            /* Пустой отбор объясняется, а не показывается пустотой: человек
               должен понимать, это раздел пуст или запрос ничего не нашёл. */
            <p className="empty__text">
              {selected.positions.length === 0
                ? "В разделе нет позиций."
                : "Ни одна позиция раздела не подходит под отбор. Измените запрос или снимите фильтр."}
            </p>
          )}

          {видимые.map((position) => {
            const остаток = BigInt(position.remaining);
            const отмечена = picked.includes(position.id);
            const можно = editable && selected.stage?.brigade != null && остаток > 0n;
            return (
              <div
                className={отмечена ? "accept__row accept__row--picked" : "accept__row"}
                key={position.id}
              >
                <div>
                  <p className="accept__name">{position.name}</p>
                  <p className="accept__figures">
                    по смете {formatMeasure(BigInt(position.qty), position.unit)}
                    {" · принято "}
                    {formatMeasure(BigInt(position.accepted), position.unit)}
                  </p>
                  {остаток === 0n && <span className="pill pill--ok">Принято полностью</span>}
                </div>
                <button
                  type="button"
                  className="accept__check"
                  aria-pressed={отмечена}
                  aria-label={`Отметить «${position.name}»`}
                  disabled={!можно || busy}
                  onClick={() => {
                    setPicked((current_) => отмечена
                      ? current_.filter((id) => id !== position.id)
                      : [...current_, position.id]);
                  }}
                >
                  <svg className="icon" aria-hidden="true"><use href="#i-acceptance" /></svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      </div>

      {выбранные.length > 0 && (
        <div className="accept__bar">
          <span className="t-sm">
            Отмечено позиций: {выбранные.length}
            {скрытоОтмеченных > 0 && ` · ${скрытоОтмеченных} не видно из-за отбора`}
          </span>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => { setConfirming(true); }}
          >
            Принять
          </button>
        </div>
      )}

      {view.batches.length > 0 && (
        <div className="panel">
          <div className="section-head">
            <h3 className="t-h3">Что принято</h3>
          </div>
          {view.batches.map((batch) => (
            <div className="accept__batch" key={batch.id}>
              {batch.photos[0] === undefined ? <span className="accept__photo" /> : (
                <img
                  className="accept__photo"
                  src={acceptancePhotoUrl(code, batch.photos[0])}
                  alt={`Свидетельство приёмки: ${batch.sectionName}`}
                />
              )}
              <div>
                <p className="t-sm">
                  {sectionTitle(batch.sectionName)} · {batch.brigade.name} · {день(batch.createdAt)}
                  {batch.author === null ? "" : ` · ${batch.author}`}
                </p>
                {batch.comment !== null && <p className="t-sm t-secondary">{batch.comment}</p>}
                {batch.lines.map((line) => (
                  <div
                    className={line.reversedAt === null ? "accept__line" : "accept__line accept__line--reversed"}
                    key={line.id}
                  >
                    <span>{line.positionName}</span>
                    <span className="num t-sm">{formatMeasure(BigInt(line.qty), line.unit)}</span>
                    {line.amount !== undefined && (
                      <span className="num t-sm">{formatKopecks(BigInt(line.amount))}</span>
                    )}
                    {line.reversedAt === null && canReverse(role) ? (
                      <button
                        type="button"
                        className="btn btn--text"
                        disabled={busy}
                        onClick={() => { setReversing({ line, brigade: batch.brigade.name }); }}
                      >
                        Сторнировать
                      </button>
                    ) : line.reason === null ? null : (
                      <span className="accept__reason">сторно: {line.reason}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {view.accruals !== undefined && view.accruals.length > 0 && (
        <div className="panel">
          <div className="section-head">
            <h3 className="t-h3">Начислено бригадам</h3>
            <p className="t-sm t-secondary">за неделю · всего по объекту</p>
          </div>
          <div className="accrual">
            {view.accruals.map((row) => (
              <div className="accrual__row" key={row.brigadeId}>
                <span className="t-sm">{row.brigadeName}</span>
                <span className="accrual__sum t-secondary">{formatKopecks(BigInt(row.week))}</span>
                <span className="accrual__sum">{formatKopecks(BigInt(row.total))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {sheetError !== null && !confirming && reversing === null && (
        <p className="field__error" role="alert">{sheetError}</p>
      )}

      {confirming && selected !== null && (
        <AcceptSheet
          section={selected}
          picked={выбранные}
          busy={busy}
          error={sheetError}
          onSubmit={(input) => {
            run(createAcceptance(code, {
              sectionId: selected.id,
              positions: input.positions,
              ...(input.comment === "" ? {} : { comment: input.comment }),
            }, input.photo));
          }}
          onClose={() => { setConfirming(false); setSheetError(null); }}
        />
      )}

      {reversing !== null && (
        <ReversalSheet
          line={reversing.line}
          brigade={reversing.brigade}
          busy={busy}
          error={sheetError}
          onSubmit={(reason) => { run(reverseAcceptance(code, reversing.line.id, { reason })); }}
          onClose={() => { setReversing(null); setSheetError(null); }}
        />
      )}
    </div>
  );
}
