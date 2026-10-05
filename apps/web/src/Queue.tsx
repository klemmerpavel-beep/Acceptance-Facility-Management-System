import type { Inbox } from "@priyomka/contracts";
import { ждётС } from "./due.js";
import { Пусто } from "./empty.js";
import { ОЧЕРЕДЬ, ПУНКТ, пунктов } from "./turn.js";

/**
 * Очередь «Ждёт вашего действия» (этап Э8, ДР-1) — первый блок главной, а у
 * заказчика — первый блок «Обзора».
 *
 * Ни у одной роли не было списка того, что ждёт именно её: руководитель
 * собирал его обходом вкладок, прораб — звонком. Строка — вид, объект,
 * число и день, с которого ждёт; кнопка ведёт на список с отбором ровно
 * этих записей одним касанием (решение допроса Э8-4). Переход — ссылкой:
 * это навигация, и адрес с отбором открывается и в новой вкладке.
 *
 * Пустая очередь не исчезает: пустота на месте первого блока читалась бы
 * сбоем загрузки, а слово закрытого словаря говорит, что проверено и ждать
 * нечего.
 */
export function Queue({
  inbox,
  error,
  объект,
}: {
  /** `null` — очередь ещё грузится. */
  inbox: Inbox | null;
  error: string | null;
  /** Код объекта на его «Обзоре»: пункты только его, и код в строке не повторяется. */
  объект?: string;
}): React.JSX.Element {
  const пункты = inbox === null
    ? []
    : inbox.items.filter((пункт) => объект === undefined || пункт.projectCode === объект);

  return (
    <section className="queue" aria-labelledby="queue-title" aria-busy={inbox === null && error === null}>
      <div className="section-head">
        <h2 className="t-h3" id="queue-title">{ОЧЕРЕДЬ}</h2>
        {inbox !== null && пункты.length > 0 && <span className="t-sm t-muted">{пунктов(пункты.length)}</span>}
      </div>
      {error !== null && <p className="field__error" role="alert">{error}</p>}
      {error === null && inbox === null && <span className="skeleton skeleton--row" />}
      {inbox !== null && пункты.length === 0 && <p className="queue__empty t-body">{Пусто("очередь")}</p>}
      {inbox !== null && пункты.length > 0 && (
        <ul className="queue__list">
          {пункты.map((пункт) => {
            const фраза = ПУНКТ[пункт.kind];
            return (
              <li className="queue__row" key={`${пункт.kind}:${пункт.projectCode}`} data-kind={пункт.kind}>
                <p className="queue__what t-body">
                  <b>{фраза.раздел}:</b> {фраза.что(пункт.count)}
                </p>
                {объект === undefined && <span className="code-badge">{пункт.projectCode}</span>}
                <span className="queue__since t-sm t-muted">{ждётС(пункт.since, inbox.today)}</span>
                <a className="btn btn--secondary queue__go" href={пункт.href} data-count={пункт.count}>
                  {фраза.кнопка}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
