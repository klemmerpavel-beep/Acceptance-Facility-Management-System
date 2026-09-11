import { useState } from "react";
import { planFromSections, shiftDay, stageDateFault, stageDateWarning,
  type ProjectRange, type SectionWeight } from "@priyomka/domain";
import { useModalDialog } from "./modal.js";
import { formatDate, plural } from "./status.js";

/**
 * Заведение графика из разделов сметы (стадия C.3).
 *
 * Лист показывает предложенные этапы до записи, а не после: график —
 * обязательство перед заказчиком, и узнавать, что именно система завела,
 * по факту записи поздно. Раскладка считается тем же доменным правилом,
 * которым её считает сервер (`planFromSections`): второй свод правил на
 * экране разошёлся бы с серверным на первой правке.
 *
 * Окно спрашивается, а не выводится. Срок сдачи заполняется при заведении
 * объекта и после не правится — вывод на сервере оставил бы объект без
 * срока без графика навсегда.
 */
export function PlanSheet({
  sections,
  range,
  after,
  busy,
  error,
  onPlan,
  onClose,
}: {
  /** Разделы без этапа, в порядке сметы. Занятые отсеяны вызывающим. */
  sections: readonly SectionWeight[];
  range: ProjectRange;
  /** Последний день уже заведённых этапов: новые встают за ним. */
  after: string | null;
  busy: boolean;
  error: string | null;
  onPlan: (from: string, to: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog<HTMLInputElement>(onClose);
  /* Начало — день после последнего заведённого этапа: новые этапы не
     накладываются на то, что человек уже расставил. Графика нет — начало
     работ по договору. */
  const начало = after === null ? range.from : shiftDay(after, 1);
  /* Окончание — срок сдачи, пока он впереди начала. Когда заведённые этапы
     уже дошли до срока (или перешли его), срок сдачи в качестве окончания
     дал бы вывернутый отрезок и лист, отказывающий при открытии. Тогда
     предлагается кратчайшее окно, в которое раскладка вообще помещается, —
     по дню на раздел. Это не выдуманная величина, а нижняя граница самой
     раскладки; человек растянет её, увидев сроки. */
  /* Считаются разделы с работами: заголовок сметы этапом не становится, и
     обещать его в подписи значило бы обещать этап, которого не будет. */
  const сРаботами = sections.filter((section) => section.positions > 0);
  const окончание = range.to > начало
    ? range.to
    : shiftDay(начало, Math.max(0, сРаботами.length - 1));
  const [from, setFrom] = useState(начало);
  const [to, setTo] = useState(окончание);

  const fault = stageDateFault({ startsOn: from, endsOn: to }, range);
  const предложены = fault === null ? planFromSections(sections, { from, to }) : [];
  const последний = предложены[предложены.length - 1]?.endsOn ?? null;
  /* Раскладка длиннее окна возможна: раздел получает не меньше дня, и
     разделов может быть больше, чем в окне дней. Предупреждение то же, что
     у отдельного этапа, — срыв показывается, а не отвергается. */
  const warning = последний === null
    ? null
    : stageDateWarning({ startsOn: from, endsOn: последний }, range);

  const submit: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (fault !== null || предложены.length === 0) return;
    onPlan(from, to);
  };

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div
        className="sheet sheet--tall"
        role="dialog"
        aria-modal="true"
        aria-label="График из сметы"
        ref={dialog}
      >
        <p className="t-h3">График из сметы</p>
        <p className="t-sm t-muted">
          {сРаботами.length} {plural(сРаботами.length, "раздел", "раздела", "разделов")} станут
          этапами. Сроки разложены по стоимости работ: дорогой раздел получает больше дней.
          Дальше их тянут указателем, как любой этап.
        </p>

        <form className="stack stack--tight" onSubmit={submit}>
          <label className="field">
            <span className="field__label">Начало работ</span>
            <input
              ref={first}
              className="input"
              type="date"
              value={from}
              onChange={(event) => { setFrom(event.target.value); }}
            />
          </label>

          <label className="field">
            <span className="field__label">Окончание работ</span>
            <input
              className="input"
              type="date"
              value={to}
              aria-invalid={fault !== null}
              onChange={(event) => { setTo(event.target.value); }}
            />
          </label>

          {fault !== null && <p className="field__error" role="alert">{fault}</p>}
          {warning !== null && <p className="field__hint" role="status">{warning}</p>}

          {предложены.length > 0 && (
            <ol className="planlist">
              {предложены.map((stage) => (
                <li className="planlist__row" key={stage.sectionId}>
                  <span className="planlist__name">{stage.name}</span>
                  <span className="planlist__dates num t-sm">
                    {formatDate(stage.startsOn)} — {formatDate(stage.endsOn)}
                  </span>
                  <span className="planlist__days num t-sm t-muted">
                    {stage.days} {plural(stage.days, "день", "дня", "дней")}
                  </span>
                </li>
              ))}
            </ol>
          )}

          {/* Названо последствие, а не задан вопрос «вы уверены» (норматив 15.6).
              Сказано и то, чего действие не делает: заведённые этапы оно не
              трогает, а бригаду не назначает — исполнителя выбирает человек. */}
          <p className="t-sm t-muted">
            Будет заведено {предложены.length} {plural(предложены.length, "этап", "этапа", "этапов")}
            {последний === null ? "" : ` до ${formatDate(последний)}`}. Заведённые этапы
            останутся как есть. Бригады не назначаются: приёмка берёт бригаду из этапа,
            и угаданная отправила бы начисление не тому.
          </p>

          {error !== null && <p className="field__error" role="alert">{error}</p>}

          <button
            type="submit"
            className="btn btn--primary btn--block"
            disabled={busy || fault !== null || предложены.length === 0}
          >
            Завести {предложены.length} {plural(предложены.length, "этап", "этапа", "этапов")}
          </button>
          <button type="button" className="btn btn--text btn--block" onClick={onClose}>
            Отмена
          </button>
        </form>
      </div>
    </>
  );
}
