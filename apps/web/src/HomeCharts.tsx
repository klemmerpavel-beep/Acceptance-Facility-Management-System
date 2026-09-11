import type { ProjectStatus, ProjectSummary } from "@priyomka/contracts";
import { readinessRows, statusSlices } from "@priyomka/domain";
import { formatPercent } from "@priyomka/ui";
import { STATUS_LABEL, plural } from "./status.js";

/**
 * Два небольших графика первого экрана: состав портфеля и готовность работ.
 *
 * Оба — срез на сегодня. Периода в них нет намеренно: полоса плана работ и
 * недельная лента сняты с главной решением заказчика, и возвращать время
 * через заднюю дверь эти блоки не должны.
 *
 * Ни одной библиотеки: обе формы — разметка с токенами. Диаграмма из шести
 * долей и пять дорожек не стоят зависимости, которую придётся обновлять,
 * а правило продукта требует отдельного решения на каждую новую.
 */

/**
 * Вид сегмента и метки берётся из ключа статуса — того же, которым
 * окрашена пилюля этого статуса в реестре и на карточке. Отдельного
 * набора цветов у графика нет намеренно: два набора на одни статусы и
 * были находкой Б-2 аудита.
 */
const STAGE_TONE: Record<ProjectStatus, string> = {
  NEW: "statusbar__part statusbar__part--new",
  IN_PROGRESS: "statusbar__part statusbar__part--work",
  WAITING_CLIENT: "statusbar__part statusbar__part--wait",
  PAUSED: "statusbar__part statusbar__part--pause",
  DONE: "statusbar__part statusbar__part--done",
  ARCHIVED: "statusbar__part statusbar__part--archive",
};

const MARK_TONE: Record<ProjectStatus, string> = {
  NEW: "statusbar__mark statusbar__mark--new",
  IN_PROGRESS: "statusbar__mark statusbar__mark--work",
  WAITING_CLIENT: "statusbar__mark statusbar__mark--wait",
  PAUSED: "statusbar__mark statusbar__mark--pause",
  DONE: "statusbar__mark statusbar__mark--done",
  ARCHIVED: "statusbar__mark statusbar__mark--archive",
};

/** Доля в сотых процента → ширина в процентах строкой: 4444 → «44.44%». */
const ширина = (share: number): string => `${(share / 100).toFixed(2)}%`;

/**
 * Состав портфеля одной полосой долей.
 *
 * Отвечает на вопрос «из чего состоит портфель» — тот, ради которого
 * раньше стояли плитки статусов. Плитки называли числа порознь; полоса
 * показывает их отношение, и одно другого не дублирует: плитки сняты.
 *
 * Опознание сегмента держится на подписи и числе под полосой, а не на
 * цвете: цвет — второй канал. Сегмент и строка подписи ведут в один и тот
 * же отфильтрованный реестр, и нажать можно на любое из двух.
 */
export function StatusBar({
  statuses,
  onOpenProjects,
}: {
  statuses: readonly { status: ProjectStatus; count: number }[];
  onOpenProjects: (status: ProjectStatus) => void;
}): React.JSX.Element | null {
  const доли = statusSlices(statuses);
  if (доли.length === 0) return null;
  const всего = доли.reduce((итог, доля) => итог + доля.count, 0);

  return (
    <div className="stack stack--tight">
      <div className="statusbar" role="img" aria-label={`Портфель: ${String(всего)} объектов`}>
        {доли.map((доля) => (
          <button
            key={доля.status}
            type="button"
            className={STAGE_TONE[доля.status]}
            style={{ inlineSize: ширина(доля.share) }}
            title={`${STATUS_LABEL[доля.status]} — ${String(доля.count)} `
              + `${plural(доля.count, "объект", "объекта", "объектов")}, `
              + formatPercent(BigInt(доля.share))}
            aria-label={`${STATUS_LABEL[доля.status]}: ${String(доля.count)}`}
            onClick={() => { onOpenProjects(доля.status); }}
          />
        ))}
      </div>
      {/* Подписи столбцом, а не строкой: строкой они набираются мелко и
          жмутся друг к другу, а доля рядом с числом отвечает на вопрос
          «много ли это» — тот самый, ради которого полоса и заведена. */}
      <ul className="statusbar__legend">
        {доли.map((доля) => (
          <li key={доля.status}>
            <button
              type="button"
              className="statusbar__item"
              onClick={() => { onOpenProjects(доля.status); }}
            >
              <span className={MARK_TONE[доля.status]} aria-hidden="true" />
              <span className="statusbar__name">{STATUS_LABEL[доля.status]}</span>
              <span className="num">{доля.count}</span>
              <span className="statusbar__share num t-sm t-muted">
                {formatPercent(BigInt(доля.share))}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Сколько строк готовности показывает первый экран. Шестая — уже список. */
const READINESS_ROWS = 5;

/**
 * Готовность по действующим объектам: заявленное и принятое одной дорожкой.
 *
 * Две величины на одной шкале и в одной дорожке, а не двумя полосами рядом:
 * содержание — в разрыве между ними, и разведённые по двум дорожкам они
 * заставляли бы сравнивать глазом две длины вместо одной.
 *
 * Порядок — по возрастанию заявленной: сверху то, где работа отстаёт.
 * Объект без графика в список не попадает: у него нечего показывать, а ноль
 * означал бы «работа не начата».
 *
 * Принятое законно обгоняет заявленное — это перевыработка, и она
 * показывается сигнальным цветом, а не обрезается по заявленному: обрезка
 * скрыла бы ровно то, ради чего две величины стоят рядом.
 */
export function ReadinessChart({
  projects,
  onOpen,
  onAll,
}: {
  projects: readonly ProjectSummary[];
  onOpen: (project: ProjectSummary) => void;
  onAll: () => void;
}): React.JSX.Element {
  const { shown: показаны, rest: ещё } = readinessRows(projects, READINESS_ROWS);

  if (показаны.length === 0) {
    return (
      <p className="t-sm t-muted">
        Готовность не задана ни у одного действующего объекта: график работ не заведён.
      </p>
    );
  }

  return (
    <div className="stack stack--tight">
      <p className="readiness__legend t-sm t-muted">
        <span className="readiness__mark readiness__mark--claim" aria-hidden="true" />
        заявлено
        <span className="readiness__mark readiness__mark--fact" aria-hidden="true" />
        принято по приёмке
      </p>
      <ul className="readiness">
        {показаны.map((row) => {
          const заявлено = row.claim;
          const принято = row.fact ?? 0;
          const перевыработка = принято > заявлено;
          return (
            <li key={row.code}>
              <button
                type="button"
                className="readiness__row"
                title={`${row.code}: заявлено ${formatPercent(BigInt(заявлено))}, `
                  + (row.fact === null
                    ? "приёмки нет"
                    : `принято ${formatPercent(BigInt(принято))}`)}
                onClick={() => {
                  const объект = projects.find((project) => project.code === row.code);
                  if (объект !== undefined) onOpen(объект);
                }}
              >
                <span className="code-badge">{row.code}</span>
                <span className="readiness__track">
                  <span className="readiness__claim" style={{ inlineSize: ширина(заявлено) }} />
                  {принято > 0 && (
                    <span
                      className={перевыработка ? "readiness__fact readiness__fact--over" : "readiness__fact"}
                      style={{ inlineSize: ширина(принято) }}
                    />
                  )}
                </span>
                <span className="readiness__value num t-sm">{formatPercent(BigInt(заявлено))}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {ещё > 0 && (
        <button type="button" className="btn btn--text" onClick={onAll}>
          Ещё {ещё} {plural(ещё, "объект", "объекта", "объектов")} — в реестре
        </button>
      )}
    </div>
  );
}
