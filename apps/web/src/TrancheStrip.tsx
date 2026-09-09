import type { Tranche } from "@priyomka/contracts";
import { formatKopecks } from "@priyomka/ui";

/**
 * Полоса транша — компонент 5.6 дизайн-системы.
 *
 * Стоит и на вкладке «Транши», и в сводке карточки объекта: остаток транша
 * есть та картина, ради которой руководитель открывает систему вечером
 * (объём полевого испытания, решение № 3). Отдельным файлом, потому что
 * второе написание той же полосы разошлось бы с первым на первой же правке.
 *
 * Перевыработка показывается сигнальным цветом, а не ошибкой: превышение
 * есть нормальное событие, требующее закрытия акта. Ширина заливки
 * ограничена сотней процентов — полоса не может вылезти за свою дорожку, —
 * но число остатка при этом отрицательное и не обрезается.
 */
export function TrancheStrip({ tranche }: { tranche: Tranche }): React.JSX.Element {
  const перевыработка = tranche.fill > 10_000;
  const доля = Math.min(tranche.fill, 10_000) / 100;

  return (
    <div className="tranche">
      <div className="tranche__bar">
        <span
          className={перевыработка ? "tranche__fill tranche__fill--over" : "tranche__fill"}
          style={{ inlineSize: `${доля.toFixed(2)}%` }}
        />
      </div>
      <p className="tranche__legend">
        <span>сумма транша <b className="num">{formatKopecks(BigInt(tranche.amount))}</b></span>
        <span>выработано <b className="num">{formatKopecks(BigInt(tranche.client))}</b></span>
        <span>
          остаток{" "}
          <b className={перевыработка ? "num tranche__over" : "num"}>
            {formatKopecks(BigInt(tranche.remainder))}
          </b>
        </span>
      </p>
    </div>
  );
}
