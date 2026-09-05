import { useState } from "react";
import type { ProjectSummary } from "@priyomka/contracts";
import {
  barGeometry,
  basisPoints,
  dayOffset,
  windowAround,
  type PlanWindow,
  type StageSpan,
} from "@priyomka/domain";
import { plural } from "./status.js";

/**
 * План работ во времени.
 *
 * Отрезки этапов по объектам на общей шкале дней, текущий день отмечен
 * вертикалью. Экран отвечает на вопрос «где сейчас стоит работа», и полоса
 * отвечает на него быстрее любой таблицы: провал в графике виден раньше,
 * чем прочитано первое число.
 *
 * Форма выбрана по назначению данных, а не по вкусу. Этапы — не различимые
 * ряды, которые надо отличать друг от друга, а один вид работы, отложенный
 * во времени. Поэтому цвет один, легенды нет: она повторила бы заголовок.
 * Различает отрезки положение на шкале, а не оттенок.
 *
 * Окно строится вокруг текущего дня, а не по всему диапазону этапов
 * портфеля. Растянутая на весь диапазон полоса отдавала текущему месяцу
 * одну двенадцатую ширины, а завершённому прошлому году — половину экрана.
 *
 * Геометрия целиком приходит из `@priyomka/domain/schedule`. Считать её
 * здесь значило бы завести вторую арифметику графика — расходящуюся с той,
 * из которой сервер берёт готовность объекта.
 */

/** Столько объектов помещается в полосу, дальше идёт строка остатка. */
const LIMIT = 12;

/** Масштабы окна. Квартал по умолчанию: месяц позади, два впереди. */
const SCALES = [
  { months: 3, label: "Квартал" },
  { months: 6, label: "Полгода" },
  { months: 12, label: "Год" },
] as const;

const МЕСЯЦЫ = [
  "янв", "фев", "мар", "апр", "май", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

/** Подпись деления шкалы: «мар 26». */
const месяц = (iso: string): string => {
  const [year = "", month = "01"] = iso.split("-");
  return `${МЕСЯЦЫ[Number(month) - 1] ?? ""} ${year.slice(2)}`;
};

/** Первые числа месяцев внутри окна — деления шкалы. */
function ticks(from: string, to: string): string[] {
  const [year = "2026", month = "01"] = from.split("-");
  const метки: string[] = [];
  let y = Number(year);
  let m = Number(month);
  for (let guard = 0; guard < 120; guard += 1) {
    const iso = `${String(y)}-${String(m).padStart(2, "0")}-01`;
    if (iso > to) break;
    if (iso >= from) метки.push(iso);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return метки;
}

const toSpans = (project: ProjectSummary): StageSpan[] =>
  project.stages.map((stage) => ({
    startsOn: stage.startsOn,
    endsOn: stage.endsOn,
    progress: basisPoints(stage.progress),
  }));

/** Объект попадает в полосу, если хотя бы один его этап виден в окне. */
const виденВОкне = (project: ProjectSummary, окно: PlanWindow): boolean =>
  toSpans(project).some((span) => barGeometry(span, окно).length > 0);

export function PlanStrip({
  projects,
  today,
  onOpen,
}: {
  projects: ProjectSummary[];
  today: string;
  onOpen: (project: ProjectSummary) => void;
}): React.JSX.Element {
  const [months, setMonths] = useState<number>(3);
  const сГрафиком = projects.filter((project) => project.stages.length > 0);

  if (сГрафиком.length === 0) {
    return (
      <div className="empty">
        <p className="empty__title">График не заведён ни на одном объекте</p>
        <p className="empty__text">
          Полоса плана строится из этапов работ. Пока их нет, показывать во времени нечего —
          выдуманный отрезок от начала работ до срока сдачи не был бы графиком.
        </p>
      </div>
    );
  }

  const окно = windowAround(today, months);
  const вОкне = сГрафиком.filter((project) => виденВОкне(project, окно));
  const показаны = вОкне.slice(0, LIMIT);
  const скрыто = сГрафиком.length - показаны.length;
  const сегодня = dayOffset(today, окно);
  const метки = ticks(окно.from, окно.to);
  const деления = метки
    .map((tick) => dayOffset(tick, окно))
    .filter((at): at is number => at !== null);

  return (
    <div className="stack stack--tight">
      <div className="segmented" role="group" aria-label="Масштаб плана">
        {SCALES.map((scale) => (
          <button
            key={scale.months}
            type="button"
            className="segmented__option"
            aria-pressed={months === scale.months}
            onClick={() => { setMonths(scale.months); }}
          >
            {scale.label}
          </button>
        ))}
      </div>

      {показаны.length === 0 ? (
        /* Этапы есть, но все они вне выбранного окна. Это законное
           состояние, и оно называется, а не показывается пустой полосой. */
        <div className="empty">
          <p className="empty__title">В этом окне работ нет</p>
          <p className="empty__text">
            У {сГрафиком.length} {plural(сГрафиком.length, "объекта", "объектов", "объектов")} график
            заведён, но их этапы лежат за пределами выбранного масштаба. Расширьте окно.
          </p>
        </div>
      ) : (
        <div className="plan">
          <div className="plan__scale" aria-hidden="true">
            <span className="plan__label" />
            <div className="plan__track">
              {метки.map((tick) => {
                const at = dayOffset(tick, окно);
                return at === null ? null : (
                  <span className="plan__tick num" key={tick} style={{ insetInlineStart: `${String(at)}%` }}>
                    {месяц(tick)}
                  </span>
                );
              })}
            </div>
          </div>

          {показаны.map((project) => {
            const spans = toSpans(project);
            return (
              <div className="plan__row" key={project.id}>
                <a
                  className="plan__label"
                  href={`#${project.code}`}
                  onClick={(event) => { event.preventDefault(); onOpen(project); }}
                >
                  <span className="code-badge">{project.code}</span>
                  <span className="plan__address">{project.address}</span>
                </a>
                <div className="plan__track">
                  {деления.map((at) => (
                    <span className="plan__grid" key={at} style={{ insetInlineStart: `${String(at)}%` }} />
                  ))}
                  {сегодня !== null && (
                    <span className="plan__today" style={{ insetInlineStart: `${String(сегодня)}%` }} />
                  )}
                  {project.stages.map((stage, index) => {
                    const span = spans[index];
                    if (span === undefined) return null;
                    const { offset, length } = barGeometry(span, окно);
                    if (length === 0) return null;
                    const просрочен = stage.endsOn < today && stage.progress < 10_000;
                    const доля = Math.round(stage.progress / 100);
                    return (
                      <span
                        key={stage.id}
                        className={`plan__bar${просрочен ? " plan__bar--late" : ""}`}
                        style={{ insetInlineStart: `${String(offset)}%`, inlineSize: `${String(length)}%` }}
                        title={`${stage.name}: ${stage.startsOn} — ${stage.endsOn}, ${String(доля)} %`}
                      >
                        {/* Подписи на отрезке нет. Порог «отрезок шире стольких
                            процентов» шириной текста не является: «Черновая
                            электрика» не помещается и в четверть полосы, а
                            обрезанная подпись хуже её отсутствия. Название,
                            даты и долю несёт подсказка. */}
                        <span className="plan__done" style={{ inlineSize: `${String(доля)}%` }} />
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {скрыто > 0 && (
            <p className="plan__rest t-sm t-muted">
              Ещё {скрыто} {plural(скрыто, "объект", "объекта", "объектов")} с графиком — за
              пределами окна или ниже двенадцатой строки.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
