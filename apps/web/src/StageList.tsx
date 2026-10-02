import type { WorkStage } from "@priyomka/contracts";
import { currentStage } from "@priyomka/domain";
import { formatPercent } from "@priyomka/ui";
import { formatDate } from "./status.js";

/**
 * Перечень этапов графика: этап, сроки, заявлено и принято, отметка текущего.
 *
 * Один компонент в двух местах (план, пункт 7.5): блок «График работ» на
 * «Обзоре» и вид вкладки «Работа» на телефоне вместо диаграммы. Две копии
 * разошлись бы на первой правке подписей, и «Обзор» называл бы этап иначе,
 * чем вкладка, где его правят.
 *
 * На телефоне у графика другой вопрос — «когда мой этап», а не «подвинуть
 * его» (`03_DESIGN_SYSTEM.md`, 5.8): дневная сетка на 390 px оставляла
 * под дни меньше сотни пикселей, и отрезок этапа превращался в точку.
 *
 * Отметка текущего этапа выводится чистой функцией домена, а не хранится:
 * текущий — первый по порядку этап, работа которого не заявлена законченной.
 * Подпись при нём говорит, как этап стоит к сегодняшнему дню: ещё впереди,
 * идёт или вышел из срока.
 */
const ОТМЕТКА = { before: "текущий, впереди", now: "текущий, идёт", late: "текущий, срок прошёл" } as const;
export function StageList({
  stages,
  today,
  onOpen,
}: {
  stages: readonly WorkStage[];
  today: string;
  /** Открыть этап. Не задан — строки только читаются (блок на «Обзоре»). */
  onOpen?: (stage: WorkStage) => void;
}): React.JSX.Element {
  const текущий = currentStage(stages, today);
  return (
    <ol className="stagelist">
      {stages.map((stage, index) => {
        const отмечен = текущий !== null && текущий.index === index;
        const сроки = `${formatDate(stage.startsOn)} — ${formatDate(stage.endsOn)}`;
        return (
          <li
            key={stage.id}
            className={отмечен ? "stagelist__row stagelist__row--current" : "stagelist__row"}
            aria-current={отмечен ? "step" : undefined}
          >
            <span className="stagelist__num num">{index + 1}</span>
            <span className="stagelist__body">
              {onOpen === undefined ? (
                <span className="stagelist__name">{stage.name}</span>
              ) : (
                <button
                  type="button"
                  className="stagelist__name stagelist__open"
                  aria-label={`${stage.name}: ${сроки}. Открыть этап`}
                  onClick={() => { onOpen(stage); }}
                >
                  {stage.name}
                </button>
              )}
              <span className="stagelist__dates t-sm t-muted">{сроки}</span>
              {отмечен && (
                <span className={текущий.when === "late" ? "pill pill--warn stagelist__mark" : "pill pill--signal stagelist__mark"}>
                  {ОТМЕТКА[текущий.when]}
                </span>
              )}
            </span>
            {/* Обе доли рядом и обе подписаны: «принято» закреплено за
                приёмкой, и заявленная готовность под тем же словом
                сообщала бы неправду (решение от 11.09.2026). */}
            <span className="stagelist__pct t-sm">
              <span>
                <span className="t-muted">заявлено </span>
                <b className="num">{formatPercent(BigInt(stage.progress))}</b>
              </span>
              <span>
                <span className="t-muted">принято </span>
                <span
                  className="num"
                  title={stage.actualProgress === null
                    ? "Этап не связан с разделом сметы: принятое считать не по чему"
                    : "Принято по разделу сметы"}
                >
                  {stage.actualProgress === null ? "—" : formatPercent(BigInt(stage.actualProgress))}
                </span>
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
