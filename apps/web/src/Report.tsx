import { useCallback, useEffect, useState } from "react";
import type { PhotoReport } from "@priyomka/contracts";
import { formatMeasure } from "@priyomka/ui";
import { acceptancePhotoUrl, errorMessage, fetchReport } from "./api.js";
import { formatDate, plural } from "./status.js";

/**
 * Фотоотчёт объекта (стадия C.4).
 *
 * Снимки приёмки попадают сюда сами: прораб фотографирует один раз, и
 * второго места, куда их складывать, продукт не заводит.
 *
 * Отчёт отвечает на вопрос «что сделано на объекте», а вкладка приёмки — на
 * вопрос «что принято по действующей смете». Поэтому отбора по редакции
 * здесь нет: повторный импорт не отменяет сделанного.
 */
export function Report({ code }: { code: string }): React.JSX.Element {
  const [report, setReport] = useState<PhotoReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchReport(code)
      .then((next) => { setReport(next); setError(null); })
      .catch((cause: unknown) => { setError(errorMessage(cause)); });
  }, [code]);

  useEffect(load, [load]);

  if (error !== null) {
    return (
      <div className="empty">
        <p className="empty__title">Отчёт недоступен</p>
        <p className="empty__text">{error}</p>
      </div>
    );
  }
  if (report === null) {
    return <div className="stack" aria-busy="true"><span className="skeleton skeleton--row" /></div>;
  }
  if (report.totals.photos === 0) {
    return (
      <div className="empty">
        <p className="empty__title">Снимков пока нет</p>
        <p className="empty__text">
          Отчёт собирается сам: каждая приёмка требует фотографии, и она попадает сюда.
        </p>
      </div>
    );
  }

  /* Отбор «по этапу» — тот же раздел сметы, по которому идёт приёмка.
     Дни, в которых после отбора ничего не осталось, не показываются: пустая
     дата сообщала бы, что в этот день работали и не сняли. */
  const дни = report.days
    .map((день) => ({
      ...день,
      batches: section === null
        ? день.batches
        : день.batches.filter((пакет) => пакет.sectionName === section),
    }))
    .filter((день) => день.batches.length > 0);

  return (
    <section className="stack">
      <div className="row row--wrap">
        <span className="metric">
          <span className="metric__value">{report.totals.photos}</span>
          <span className="metric__label">{plural(report.totals.photos, "снимок", "снимка", "снимков")}</span>
        </span>
        <span className="metric">
          <span className="metric__value">{report.totals.days}</span>
          <span className="metric__label">
            {plural(report.totals.days, "день", "дня", "дней")} со съёмкой
          </span>
        </span>
      </div>

      <div className="segmented" role="group" aria-label="Отбор по разделу">
        <button
          type="button"
          className="segmented__option"
          aria-pressed={section === null}
          onClick={() => { setSection(null); }}
        >
          <span className="segmented__label">Весь объект</span>
          <span className="num t-sm">{report.totals.photos}</span>
        </button>
        {report.sections.map((раздел) => (
          <button
            key={раздел.name}
            type="button"
            className="segmented__option"
            aria-pressed={section === раздел.name}
            onClick={() => { setSection(раздел.name); }}
          >
            <span className="segmented__label">{раздел.name}</span>
            <span className="num t-sm">{раздел.photos}</span>
          </button>
        ))}
      </div>

      {дни.map((день) => (
        <section className="stack stack--tight" key={день.day}>
          <div className="section-head">
            <h3 className="t-h3">{formatDate(день.day)}</h3>
            <p className="t-sm t-muted">
              {день.batches.length} {plural(день.batches.length, "приёмка", "приёмки", "приёмок")}
            </p>
          </div>
          <div className="report__grid">
            {день.batches.map((пакет) => (
              <figure
                className={пакет.reversed ? "report__card report__card--reversed" : "report__card"}
                key={пакет.id}
              >
                {пакет.photos[0] === undefined ? (
                  <span className="report__photo" />
                ) : (
                  <img
                    className="report__photo"
                    src={acceptancePhotoUrl(code, пакет.photos[0])}
                    alt={`Приёмка: ${пакет.sectionName}, ${formatDate(пакет.at.slice(0, 10))}`}
                    loading="lazy"
                  />
                )}
                <figcaption className="stack stack--tight">
                  <p className="t-sm">
                    {пакет.sectionName} · {пакет.brigade}
                    {пакет.author === null ? "" : ` · принял ${пакет.author}`}
                  </p>
                  {/* Отменённая приёмка не прячется — история не
                      переписывается, — но и не выдаётся за сделанное:
                      показать её как работу значило бы солгать заказчику. */}
                  {пакет.reversed && <span className="pill pill--danger">Сторнировано</span>}
                  <ul className="report__lines">
                    {пакет.lines.map((строка) => (
                      <li
                        key={`${пакет.id}-${строка.positionName}`}
                        className={строка.reversed ? "report__line report__line--reversed" : "report__line"}
                      >
                        {строка.positionName}
                        {" — "}
                        <span className="num">{formatMeasure(BigInt(строка.qty), строка.unit)}</span>
                      </li>
                    ))}
                  </ul>
                  {пакет.comment !== null && (
                    <p className="t-sm t-muted">{пакет.comment}</p>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}
