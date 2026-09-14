import { groupByStageRoom, sectionTitle, type GroupNode } from "@priyomka/domain";
import { useMemo, useState } from "react";
import type { EstimateItem, EstimateSectionNode, EstimateView } from "@priyomka/contracts";
import { formatKopecks, formatPercent, formatQty } from "@priyomka/ui";
import { plural } from "./status.js";

type Projection = "internal" | "client";
/**
 * Способ показать те же позиции, а не вторая правда о них.
 *
 * «По смете» — дерево из файла заказчика: так смету сверяют с исходником,
 * и потому это вид по умолчанию. «По этапам» — дерево «Этап → Помещение →
 * Категория»: так по ней работают на объекте. Хранилище одно; второе дерево
 * в базе завело бы второй ответ на вопрос «где позиция», а приёмка, график
 * и готовность считают по первому.
 */
type Grouping = "sections" | "stages";

/** Выше этого числа строк отрисовка таблицы целиком перестаёт быть уместной. */
const ROW_LIMIT = 400;

/** Подписи уровней группировки: заголовок без подписи не называет своего рода. */
const УРОВЕНЬ: Readonly<Record<"stage" | "room" | "category", string>> = {
  stage: "Этап",
  room: "Помещение",
  category: "Категория",
};
const ИТОГ: Readonly<Record<"stage" | "room" | "category", string>> = {
  stage: "по этапу",
  room: "по помещению",
  category: "по категории",
};

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
 *
 * Колонки «Принято» здесь пока нет. Приёмка появится на стадии D, а до неё
 * колонка печатает одну и ту же пилюлю «Ожидает» во всех 132 строках:
 * место занято, сведений ноль. Колонка вернётся вместе с действием, которое
 * её меняет.
 */
export function EstimateTable({
  estimate,
  onEditItem,
  onEditSupervision,
  onMoveItem,
  busy = false,
}: {
  estimate: EstimateView;
  /**
   * Перестановка позиции внутри своего раздела на `шагов` мест.
   *
   * Перенос в другой раздел идёт полем в листе правки, а не перетаскиванием
   * через всю таблицу: разделов двадцать два, и тащить строку сквозь
   * свёрнутые заголовки — движение, которое не заканчивается.
   */
  onMoveItem?: (item: EstimateItem, шагов: number) => void;
  busy?: boolean;
  /* Правит руководитель. Обработчиков нет — колонки правки нет: у прораба
     во внутренней проекции и так ничего нет, и гасить кнопку было бы
     обещанием действия, которого ему не дадут. */
  onEditItem?: (item: EstimateItem) => void;
  onEditSupervision?: () => void;
}): React.JSX.Element {
  const hasInternal = estimate.totals.wage !== undefined;
  const [projection, setProjection] = useState<Projection>(hasInternal ? "internal" : "client");
  /**
   * Опознаватели всех разделов сметы, включая вложенные.
   *
   * Нужны дважды: начальным состоянием свёрнутости и органом «Развернуть
   * все». Считаются от самой сметы, поэтому смена редакции (новый импорт)
   * пересчитывает их сама собой.
   */
  const всеРазделы = useMemo(() => {
    const собрать = (узлы: readonly EstimateSectionNode[]): string[] =>
      узлы.flatMap((узел) => [узел.id, ...собрать(узел.children)]);
    return new Set(собрать(estimate.sections));
  }, [estimate.sections]);

  /**
   * Свёрнутые разделы. По умолчанию свёрнуты все.
   *
   * Прежде множество было пустым, и вкладка открывалась полотном в 176
   * строк и 9 627 px: 132 позиции и 44 строки заголовков с подытогами
   * (аудит Г-5). Свёрнутый вид — не «ничего», а ведомость по разделам:
   * имя и сумма, 22 строки, и каждая строка — вход в свою подробность.
   * Это и есть прогрессивное раскрытие: сведение сразу, подробность по
   * запросу. Решение заказчика от 12.09.2026.
   */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(всеРазделы);

  const showInternal = hasInternal && projection === "internal";
  const editable = onEditItem !== undefined;
  const sections = estimate.sectionsTopLevel + estimate.sectionsNested;
  /* Заголовок и подытог на раздел плюс позиции — столько строк уходит в DOM. */
  const rendered = estimate.positions + sections * 2;
  const columns = (showInternal ? 9 : 6) + (editable ? 1 : 0);

  /** Деньги приходят строкой: JSON не имеет целых произвольной длины. */
  const дерево = useMemo(
    () => groupByStageRoom<EstimateItem>(estimate.sections, (item) => ({
      total: BigInt(item.total),
      wage: item.wageTotal === undefined ? undefined : BigInt(item.wageTotal),
    })),
    [estimate.sections],
  );
  const всеУзлы = useMemo(() => {
    const собрать = (узлы: readonly GroupNode<EstimateItem>[]): string[] =>
      узлы.flatMap((узел) => [узел.key, ...собрать(узел.children)]);
    return new Set(собрать(дерево));
  }, [дерево]);
  const [grouping, setGrouping] = useState<Grouping>("sections");
  /* Группировка открывается свёрнутой по тому же доводу, что и разделы:
     три уровня заголовков на 132 позициях выносят таблицу далеко за порог
     отрисовки, а свёрнутый вид — это ведомость по этапам, а не «ничего». */
  const [свёрнутыеУзлы, setСвёрнутыеУзлы] = useState<ReadonlySet<string>>(всеУзлы);
  /* Жест перестановки: запросов во время движения нет ни одного — иначе
     каждый пиксель давал бы обращение, а отказ приходил бы посреди жеста.
     Тот же приём, что у отрезка графика. */
  const [взятая, setВзятая] = useState<{ id: string; fromY: number; height: number } | null>(null);

  const toggle = (id: string): void =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /**
   * Строка позиции. Общая для обеих группировок: две копии разошлись бы на
   * первой же правке колонок, и одна из группировок начала бы показывать
   * позицию иначе, чем другая.
   *
   * Пометка «из начального обмера» стоит рядом с помещением и только там,
   * где она правда: набор позиции `INITIAL` при существующей перепланировке.
   * Количество такой позиции считалось по площади, которой больше нет.
   */
  const строкаПозиции = (item: EstimateItem, level: number): React.JSX.Element => {
    const отстало = estimate.replanned && item.room !== null && item.room.set === "INITIAL";
    /* Принятая позиция раздела не меняет, но внутри своего переставляется:
       порядок в приёмке не участвует вовсе. Ручка у неё есть. */
    const переносим = onMoveItem !== undefined;
    return (
      <tr key={item.id}>
        <td className="estimate__num estimate__place">
          {переносим && (
            <button
              type="button"
              className="estimate__move"
              aria-label={`Переместить позицию «${item.name}»`}
              aria-pressed={взятая !== null && взятая.id === item.id}
              disabled={busy}
              onPointerDown={(event) => {
                if (busy) return;
                const высота = event.currentTarget.closest("tr")?.getBoundingClientRect().height ?? 0;
                if (высота === 0) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                setВзятая({ id: item.id, fromY: event.clientY, height: высота });
              }}
              onPointerUp={(event) => {
                if (взятая?.id !== item.id) return;
                event.currentTarget.releasePointerCapture(event.pointerId);
                /* Округление, симметричное нулю: полшага в любую сторону
                   не двигает строку самовольно. */
                const шагов = Math.round((event.clientY - взятая.fromY) / взятая.height);
                setВзятая(null);
                if (шагов !== 0) onMoveItem(item, шагов);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowUp") { event.preventDefault(); onMoveItem(item, -1); }
                if (event.key === "ArrowDown") { event.preventDefault(); onMoveItem(item, 1); }
              }}
            >
              <svg className="icon icon--sm" aria-hidden="true"><use href="#i-move" /></svg>
            </button>
          )}
          {item.order}
        </td>
        <td>
          <span className="estimate__row-name" style={{ ["--level" as string]: level }}>
            {item.name}
            {item.room !== null && (
              <span className={отстало ? "pill pill--warn" : "t-sm t-muted"}>
                {отстало ? `${item.room.name} · из начального обмера` : item.room.name}
              </span>
            )}
          </span>
        </td>
        <td>{item.unit}</td>
        <td className="estimate__num">{formatQty(BigInt(item.qty))}</td>
        <td className="estimate__num">{money(item.unitPrice)}</td>
        <td className="estimate__num">{money(item.total)}</td>
        {showInternal && (
          <>
            <td className="estimate__num estimate__internal">{money(item.unitWage)}</td>
            <td className="estimate__num estimate__internal">{money(item.wageTotal)}</td>
            <td className="estimate__num estimate__internal">{money(item.profit)}</td>
          </>
        )}
        {editable && (
          <td className="estimate__act">
            <button
              type="button"
              className="btn btn--text"
              onClick={() => { onEditItem(item); }}
            >
              Править
            </button>
          </td>
        )}
      </tr>
    );
  };

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
                {sectionTitle(node.name)}
              </span>
            </button>
          </td>
        </tr>
      );
      const items = node.items.map((item) => строкаПозиции(item, node.level));

      const subtotal = (
        <tr key={`${node.id}-subtotal`} className="estimate__section">
          <td colSpan={5}>
            <span className="estimate__row-name t-secondary" style={{ ["--level" as string]: node.level }}>
              Итого по разделу
            </span>
          </td>
          <td className="estimate__num">{money(node.subtotal)}</td>
          {showInternal && (
            <>
              <td className="estimate__num estimate__internal" />
              <td className="estimate__num estimate__internal">{money(node.subtotalWage)}</td>
              <td className="estimate__num estimate__internal" />
            </>
          )}
        </tr>
      );

      /* Свёрнутый раздел несёт свою сумму. Прежде возвращался один
         заголовок, и вместе с позициями пропадал подытог — сворачивание
         уничтожало сведение вместо того, чтобы скрыть подробность. */
      if (isCollapsed) return [header, subtotal];

      return [header, ...items, ...rows(node.children), subtotal];
    });

  /** Те же строки, собранные деревом «Этап → Помещение → Категория». */
  const узлы = (nodes: readonly GroupNode<EstimateItem>[], level = 0): React.JSX.Element[] =>
    nodes.flatMap((node) => {
      const свёрнут = свёрнутыеУзлы.has(node.key);
      const шапка = (
        <tr className="estimate__section" key={node.key}>
          <td colSpan={columns}>
            <button
              type="button"
              className="estimate__section-toggle"
              aria-expanded={!свёрнут}
              onClick={() => {
                setСвёрнутыеУзлы((текущие) => {
                  const дальше = new Set(текущие);
                  if (дальше.has(node.key)) дальше.delete(node.key);
                  else дальше.add(node.key);
                  return дальше;
                });
              }}
            >
              <svg className="icon icon--sm disclosure" aria-hidden="true">
                <use href="#i-chevron" />
              </svg>
              <span className="estimate__row-name" style={{ ["--level" as string]: level }}>
                {/* Уровень назван словом: три вложенных заголовка без подписи
                    читаются как три раздела одного рода. */}
                <span className="t-cap">{УРОВЕНЬ[node.kind]}</span>
                {" "}
                {node.label}
                {" "}
                <span className="t-sm t-muted">
                  {node.positions} {plural(node.positions, "позиция", "позиции", "позиций")}
                </span>
              </span>
            </button>
          </td>
        </tr>
      );

      const подытог = (
        <tr key={`${node.key}-итог`} className="estimate__section">
          <td colSpan={5}>
            <span className="estimate__row-name t-secondary" style={{ ["--level" as string]: level }}>
              Итого {ИТОГ[node.kind]}
            </span>
          </td>
          <td className="estimate__num">{formatKopecks(node.subtotal)}</td>
          {showInternal && (
            <>
              <td className="estimate__num estimate__internal" />
              <td className="estimate__num estimate__internal">
                {node.subtotalWage === undefined ? "—" : formatKopecks(node.subtotalWage)}
              </td>
              <td className="estimate__num estimate__internal" />
            </>
          )}
          {editable && <td className="estimate__act" />}
        </tr>
      );

      if (свёрнут) return [шапка, подытог];
      return [
        шапка,
        ...node.items.map((item) => строкаПозиции(item, level + 1)),
        ...узлы(node.children, level + 1),
        подытог,
      ];
    });

  return (
    <div className="panel panel--sheet panel--flush">
      <div className="panel__head">
        <div className="row">
          <p className="t-h3">
            {estimate.positions} {plural(estimate.positions, "позиция", "позиции", "позиций")}
            {" · "}
            {sections} {plural(sections, "раздел", "раздела", "разделов")}
          </p>
          {estimate.worksTotalDelta !== null && BigInt(estimate.worksTotalDelta) !== 0n && (
            <span className="pill pill--danger">
              Расхождение {money(estimate.worksTotalDelta)}
            </span>
          )}
          {/* Один орган с двумя состояниями, а не два рядом: «свернуть» и
              «развернуть» взаимоисключающи, и показывать оба значит
              предлагать выбор там, где его нет. Подпись называет то, что
              произойдёт, а не то, что сейчас. */}
          {всеРазделы.size > 0 && (
            <button
              type="button"
              className="btn btn--text"
              onClick={() => {
                setCollapsed((current) => (current.size === 0 ? всеРазделы : new Set()));
              }}
            >
              {collapsed.size === 0 ? "Свернуть все" : "Развернуть все"}
            </button>
          )}
        </div>
        {/* Два переключателя рядом: способ показать и кому показать. Один
            орган с четырьмя состояниями смешал бы независимые решения. */}
        <div className="segmented" role="group" aria-label="Группировка сметы">
          <button
            type="button"
            className="segmented__option"
            aria-pressed={grouping === "sections"}
            onClick={() => { setGrouping("sections"); }}
          >
            По смете
          </button>
          <button
            type="button"
            className="segmented__option"
            aria-pressed={grouping === "stages"}
            onClick={() => { setGrouping("stages"); }}
          >
            По этапам
          </button>
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

      <div className="table-scroll table-scroll--view">
        <table className="estimate">
          {/* Подпись таблицы. Прежде её не было вовсе: смета — самая крупная
              таблица продукта и единственная, у которой шапка двухрядная. */}
          <caption className="visually-hidden">Смета объекта</caption>
          <thead>
            {showInternal && (
              <tr>
                <td colSpan={6} />
                {/* Надзаголовок группы. `colspan` у него объявлен, а области —
                    нет, и без неё связь с тремя колонками ниже держалась только
                    видом. Пустые ячейки рядом — `td`, а не `th`: заголовком без
                    содержимого они не были, а числом заголовков считались. */}
                <th colSpan={3} scope="colgroup" className="estimate__internal estimate__internal-group">
                  Внутреннее
                </th>
                {editable && <td />}
              </tr>
            )}
            <tr>
              <th scope="col">№</th>
              <th scope="col">Наименование</th>
              <th scope="col">Ед.</th>
              <th scope="col" className="estimate__num">Кол.</th>
              <th scope="col" className="estimate__num">Цена ед.</th>
              <th scope="col" className="estimate__num">Сумма</th>
              {showInternal && (
                <>
                  <th scope="col" className="estimate__num estimate__internal">Ставка ЗП</th>
                  <th scope="col" className="estimate__num estimate__internal">ЗП</th>
                  <th scope="col" className="estimate__num estimate__internal">Прибыль</th>
                </>
              )}
              {editable && <th scope="col"><span className="visually-hidden">Правка</span></th>}
            </tr>
          </thead>
          <tbody>{grouping === "sections" ? rows(estimate.sections) : узлы(дерево)}</tbody>
          {/* Ведомость закрывается своими итогами, как закрывается смета:
              работы, надбавка за сопровождение, итог для заказчика. Внутренние
              итоги стоят в своих колонках и уходят вместе с ними в клиентской
              проекции. */}
          <tfoot>
            <tr>
              {/* Подпись итога — заголовок строки, а не ячейка. Прежде все
                  три итога стояли `td`, и ни один не был связан со своей
                  подписью разметкой: число читалось без имени. */}
              <th scope="row" colSpan={5}>
                Итого по работам
                {estimate.declaredWorksTotal !== null && (
                  <span className="t-sm t-muted"> · в файле заявлено {money(estimate.declaredWorksTotal)}</span>
                )}
              </th>
              <td className="estimate__num">{money(estimate.totals.works)}</td>
              {showInternal && (
                <>
                  <td className="estimate__num estimate__internal" />
                  <td className="estimate__num estimate__internal">{money(estimate.totals.wage)}</td>
                  <td className="estimate__num estimate__internal">{money(estimate.totals.profit)}</td>
                </>
              )}
              {editable && <td className="estimate__act" />}
            </tr>
            <tr>
              <th scope="row" colSpan={5}>
                Сопровождение объекта {formatPercent(BigInt(estimate.totals.supervisionShare))}
                {onEditSupervision !== undefined && (
                  <button type="button" className="btn btn--text" onClick={onEditSupervision}>
                    Изменить надбавку
                  </button>
                )}
              </th>
              <td className="estimate__num">{money(estimate.totals.supervision)}</td>
              {showInternal && <td className="estimate__internal" colSpan={3} />}
              {editable && <td className="estimate__act" />}
            </tr>
            <tr>
              <th scope="row" colSpan={5}>Итого для заказчика</th>
              <td className="estimate__num">{money(estimate.totals.estimate)}</td>
              {showInternal && <td className="estimate__internal" colSpan={3} />}
              {editable && <td className="estimate__act" />}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Порог назван, чтобы переход на виртуализацию был решением, а не
          авралом. Виртуализация тела с липкой шапкой, сворачиваемыми
          разделами и подытогами — отдельная работа (реестр Д-25). */}
      {rendered > ROW_LIMIT && (
        <p className="field__hint">
          В смете {rendered} строк — больше порога в {ROW_LIMIT}. Таблица отрисовывается целиком,
          и на таком объёме это уже заметно.
        </p>
      )}
    </div>
  );
}
