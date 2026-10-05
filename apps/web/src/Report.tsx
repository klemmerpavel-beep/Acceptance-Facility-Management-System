import { sectionTitle, новоеПосле } from "@priyomka/domain";
import { useCallback, useEffect, useState } from "react";
import type { PhotoReport } from "@priyomka/contracts";
import { formatMeasure } from "@priyomka/ui";
import { acceptancePhotoUrl, errorMessage, fetchReport } from "./api.js";
import { formatDate, plural } from "./status.js";
import { PhotoViewer, type СнимокПросмотра } from "./PhotoViewer.js";
import { FilterBar, type СОтбором } from "./FilterBar.js";

/** Класс коллажа по числу показанных снимков — готовыми именами, а не сборкой строки. */
const КОЛЛАЖ: Readonly<Record<number, string>> = {
  1: "collage collage--1",
  2: "collage collage--2",
  3: "collage collage--3",
};

/**
 * Коллаж дня (план, пункт 7.7): «1 крупный + 2 мелких», на последнем — «+N».
 *
 * Прежде карточка пакета показывала только первый снимок пакета, а день из
 * пяти приёмок — пятью одинаковыми по весу карточками без связи. Коллаж
 * собирает снимки всех пакетов дня; каждый открывает просмотр во весь экран
 * с того места, где на него нажали.
 */
function Коллаж({
  снимки,
  onOpen,
}: {
  снимки: readonly СнимокПросмотра[];
  onOpen: (номер: number) => void;
}): React.JSX.Element {
  const видно = снимки.slice(0, 3);
  const ещё = снимки.length - видно.length;
  return (
    <div className={КОЛЛАЖ[видно.length] ?? "collage"}>
      {видно.map((снимок, номер) => (
        <button
          key={снимок.id}
          type="button"
          className={номер === 0 ? "collage__tile collage__tile--main" : "collage__tile"}
          aria-label={`Открыть снимок ${String(номер + 1)} из ${String(снимки.length)}: ${снимок.подпись}`
            + (номер === видно.length - 1 && ещё > 0 ? `, ещё ${String(ещё)}` : "")}
          onClick={() => { onOpen(номер); }}
        >
          <img className="report__photo" src={снимок.src} alt="" loading="lazy" draggable={false} />
          {номер === видно.length - 1 && ещё > 0 && (
            <span className="collage__more" aria-hidden="true">+{ещё}</span>
          )}
        </button>
      ))}
    </div>
  );
}

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
export function Report({ code, отбор, onСброситьОтбор }: { code: string } & СОтбором): React.JSX.Element {
  const [report, setReport] = useState<PhotoReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<string | null>(null);
  const [просмотр, setПросмотр] = useState<{ снимки: readonly СнимокПросмотра[]; начало: number } | null>(null);

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
  /* Отбор пункта очереди заказчика (ДР-1): снимки, появившиеся после его
     прошлого захода, — тем же правилом домена, которым посчитано число
     пункта. Запись здесь — снимок, а не приёмка: пункт считает снимки. */
  const после = отбор?.вид === "since" ? отбор.значение : null;
  const дни = report.days
    .map((день) => ({
      ...день,
      batches: день.batches
        .filter((пакет) => section === null || пакет.sectionName === section)
        .filter((пакет) => после === null || (пакет.photos.length > 0 && новоеПосле(пакет.at, после))),
    }))
    .filter((день) => день.batches.length > 0);
  const полоса = после === null || отбор === undefined || отбор === null ? null : (
    <FilterBar
      отбор={отбор}
      число={дни.reduce((всего, день) => всего + день.batches.reduce((снимков, пакет) => снимков + пакет.photos.length, 0), 0)}
      onReset={onСброситьОтбор ?? (() => undefined)}
    />
  );

  return (
    <section className="stack">
      {полоса}
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
            <span className="segmented__label">{sectionTitle(раздел.name)}</span>
            <span className="num t-sm">{раздел.photos}</span>
          </button>
        ))}
      </div>

      {дни.map((день) => {
        /* Снимки дня — всех его пакетов подряд. Подпись называет раздел и
           дату: по ним снимок и ищут; сторно названо, а не спрятано. */
        const снимкиДня: СнимокПросмотра[] = день.batches.flatMap((пакет) => пакет.photos.map((id) => ({
          id,
          src: acceptancePhotoUrl(code, id),
          подпись: `${sectionTitle(пакет.sectionName)} · ${formatDate(день.day)}`
            + (пакет.reversed ? " · сторнировано" : ""),
        })));
        return (
        <section className="stack stack--tight daycard" key={день.day}>
          <div className="section-head">
            <h2 className="t-h3">{formatDate(день.day)}</h2>
            <p className="t-sm t-muted">
              {день.batches.length} {plural(день.batches.length, "приёмка", "приёмки", "приёмок")}
              {" · "}
              {снимкиДня.length} {plural(снимкиДня.length, "снимок", "снимка", "снимков")}
            </p>
          </div>
          {снимкиДня.length > 0 && (
            <Коллаж снимки={снимкиДня} onOpen={(начало) => { setПросмотр({ снимки: снимкиДня, начало }); }} />
          )}
          <div className="report__grid">
            {день.batches.map((пакет) => (
              <figure
                className={пакет.reversed ? "report__card report__card--reversed" : "report__card"}
                key={пакет.id}
              >
                <figcaption className="stack stack--tight">
                  <p className="t-sm">
                    {sectionTitle(пакет.sectionName)} · {пакет.brigade}
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
        );
      })}

      {просмотр !== null && (
        <PhotoViewer
          снимки={просмотр.снимки}
          начало={просмотр.начало}
          onClose={() => { setПросмотр(null); }}
        />
      )}
    </section>
  );
}
