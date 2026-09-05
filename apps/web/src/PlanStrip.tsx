import type { ProjectSummary } from "@priyomka/contracts";
import { barGeometry, dayOffset, planWindow, type StageSpan } from "@priyomka/domain";
import { basisPoints } from "@priyomka/domain";

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
 * Геометрия целиком приходит из `@priyomka/domain/schedule`. Считать её
 * здесь значило бы завести вторую арифметику графика — расходящуюся с той,
 * из которой сервер берёт готовность объекта.
 */

/** Столько объектов помещается в полосу, дальше идёт строка остатка. */
const LIMIT = 12;

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

export function PlanStrip({
  projects,
  today,
  onOpen,
}: {
  projects: ProjectSummary[];
  today: string;
  onOpen: (project: ProjectSummary) => void;
}): React.JSX.Element {
  const сГрафиком = projects.filter((project) => project.stages.length > 0);
  const окно = planWindow(сГрафиком.flatMap(toSpans));

  if (окно === null) {
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

  const показаны = сГрафиком.slice(0, LIMIT);
  const остаток = сГрафиком.length - показаны.length;
  const сегодня = dayOffset(today, окно);
  const метки = ticks(окно.from, окно.to);
  const деления = метки
    .map((tick) => dayOffset(tick, окно))
    .filter((at): at is number => at !== null);

  return (
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
                return (
                  <span
                    key={stage.id}
                    className={`plan__bar${просрочен ? " plan__bar--late" : ""}`}
                    style={{ insetInlineStart: `${String(offset)}%`, inlineSize: `${String(length)}%` }}
                    /* Подсказка вместо подписи на отрезке: этап «Черновая
                       электрика» не помещается в полосу шириной в две недели,
                       а обрезанная подпись хуже её отсутствия. */
                    title={`${stage.name}: ${stage.startsOn} — ${stage.endsOn}, ${String(Math.round(stage.progress / 100))} %`}
                  >
                    <span
                      className="plan__done"
                      style={{ inlineSize: `${String(Math.round(stage.progress / 100))}%` }}
                    />
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}

      {остаток > 0 && (
        <p className="plan__rest t-sm t-muted">
          Ещё {остаток} {остаток === 1 ? "объект" : остаток < 5 ? "объекта" : "объектов"} с
          графиком — в разделе «Проекты».
        </p>
      )}
    </div>
  );
}
