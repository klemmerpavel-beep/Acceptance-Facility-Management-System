import { useState } from "react";
import type { EstimateSectionNode, EstimateView } from "@priyomka/contracts";
import { formatKopecks, formatQty } from "@priyomka/ui";

type Projection = "internal" | "client";

const money = (value: string | undefined): string =>
  value === undefined ? "—" : formatKopecks(BigInt(value));

/**
 * Плотная таблица сметы. Строка 40 px, липкая шапка, сворачиваемые разделы,
 * отступ вложенности 16 px на уровень — 132 позиции должны помещаться на
 * экране без бесконечной прокрутки (§1 и §5.4 дизайн-системы).
 *
 * Внутренние колонки маркируются фоном и надзаголовком «Внутреннее», чтобы
 * при демонстрации экрана клиенту ошибка была заметна мгновенно. Сервер
 * прорабу этих величин не отдаёт вовсе, поэтому переключатель проекции
 * показывается только тому, у кого есть что скрывать.
 */
export function EstimateTable({ estimate }: { estimate: EstimateView }): React.JSX.Element {
  const hasInternal = estimate.totals.wage !== undefined;
  const [projection, setProjection] = useState<Projection>(hasInternal ? "internal" : "client");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const showInternal = hasInternal && projection === "internal";
  const columns = showInternal ? 10 : 7;

  const toggle = (id: string): void =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rows = (nodes: readonly EstimateSectionNode[]): React.JSX.Element[] =>
    nodes.flatMap((node) => {
      const isCollapsed = collapsed.has(node.id);
      const header = (
        <tr className="estimate__section" key={node.id}>
          <td colSpan={columns}>
            <button
              type="button"
              className="estimate__section-toggle"
              aria-expanded={!isCollapsed}
              onClick={() => toggle(node.id)}
            >
              <svg className="icon icon--sm disclosure" aria-hidden="true">
                <use href="#i-chevron" />
              </svg>
              <span className="estimate__row-name" style={{ ["--level" as string]: node.level - 1 }}>
                {node.name}
              </span>
            </button>
          </td>
        </tr>
      );
      if (isCollapsed) return [header];

      const items = node.items.map((item) => (
        <tr key={item.id}>
          <td className="estimate__num">{item.order}</td>
          <td>
            <span className="estimate__row-name" style={{ ["--level" as string]: node.level }}>
              {item.name}
            </span>
          </td>
          <td>{item.unit}</td>
          <td className="estimate__num">{formatQty(BigInt(item.qty))}</td>
          <td className="estimate__num">{money(item.unitPrice)}</td>
          <td className="estimate__num">{money(item.total)}</td>
          <td>
            <span className="pill">Ожидает</span>
          </td>
          {showInternal && (
            <>
              <td className="estimate__num estimate__internal">{money(item.unitWage)}</td>
              <td className="estimate__num estimate__internal">{money(item.wageTotal)}</td>
              <td className="estimate__num estimate__internal">{money(item.profit)}</td>
            </>
          )}
        </tr>
      ));

      const subtotal = (
        <tr key={`${node.id}-subtotal`} className="estimate__section">
          <td colSpan={5}>
            <span className="estimate__row-name t-secondary" style={{ ["--level" as string]: node.level }}>
              Итого по разделу
            </span>
          </td>
          <td className="estimate__num">{money(node.subtotal)}</td>
          <td />
          {showInternal && (
            <>
              <td className="estimate__num estimate__internal" />
              <td className="estimate__num estimate__internal">{money(node.subtotalWage)}</td>
              <td className="estimate__num estimate__internal" />
            </>
          )}
        </tr>
      );

      return [header, ...items, ...rows(node.children), subtotal];
    });

  return (
    <div className="panel panel--flush">
      <div className="panel__head">
        <div className="row">
          <p className="t-h3">
            {estimate.positions} позиц. · {estimate.sectionsTopLevel + estimate.sectionsNested} раздел.
          </p>
          {estimate.worksTotalDelta !== null && BigInt(estimate.worksTotalDelta) !== 0n && (
            <span className="pill pill--danger">
              Расхождение {money(estimate.worksTotalDelta)}
            </span>
          )}
        </div>
        {hasInternal && (
          <div className="segmented" role="group" aria-label="Проекция сметы">
            <button
              type="button"
              className="segmented__option"
              aria-pressed={projection === "internal"}
              onClick={() => setProjection("internal")}
            >
              Внутренняя
            </button>
            <button
              type="button"
              className="segmented__option"
              aria-pressed={projection === "client"}
              onClick={() => setProjection("client")}
            >
              Клиентская
            </button>
          </div>
        )}
      </div>

      <div className="table-scroll">
        <table className="estimate">
          <thead>
            {showInternal && (
              <tr>
                <th colSpan={7} />
                <th colSpan={3} className="estimate__internal estimate__internal-group">
                  Внутреннее
                </th>
              </tr>
            )}
            <tr>
              <th>№</th>
              <th>Наименование</th>
              <th>Ед.</th>
              <th className="estimate__num">Кол.</th>
              <th className="estimate__num">Цена ед.</th>
              <th className="estimate__num">Сумма</th>
              <th>Принято</th>
              {showInternal && (
                <>
                  <th className="estimate__num estimate__internal">Ставка ЗП</th>
                  <th className="estimate__num estimate__internal">ЗП</th>
                  <th className="estimate__num estimate__internal">Прибыль</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>{rows(estimate.sections)}</tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>Итого по работам</td>
              <td className="estimate__num">{money(estimate.totals.works)}</td>
              <td colSpan={showInternal ? 4 : 1} className="t-sm t-muted">
                {estimate.declaredWorksTotal === null
                  ? ""
                  : `в файле заявлено ${money(estimate.declaredWorksTotal)}`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
