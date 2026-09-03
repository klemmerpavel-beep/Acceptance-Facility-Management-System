import { useState } from "react";
import type { ImportReport } from "@priyomka/contracts";
import { formatKopecks } from "@priyomka/ui";
import { plural } from "./status.js";
import { useModalDialog } from "./modal.js";
import { importEstimate, previewEstimate, errorMessage } from "./api.js";

/**
 * Импорт сметы. Два шага намеренно: сначала разбор без записи с отчётом о
 * расхождениях, затем запись. Отчёт показывается до того, как что-либо
 * сохранено, — именно расхождение является главным доказательством
 * ценности системы (БП-09).
 */
export function ImportEstimate({
  code,
  units,
  onImported,
}: {
  code: string;
  units: string[];
  onImported?: () => void;
}): React.JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ version: number; positions: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = (action: () => Promise<void>): void => {
    setBusy(true);
    setError(null);
    void action().catch((cause: unknown) => setError(errorMessage(cause))).finally(() => setBusy(false));
  };

  const onPreview = (chosen: File): void => {
    setFile(chosen);
    setDone(null);
    run(async () => {
      const result = await previewEstimate(code, chosen);
      setReport(result.report);
      setOverrides(
        Object.fromEntries(
          result.report.unitDecisions.map((decision) => [decision.raw, decision.suggestion !== "" ? decision.suggestion : (units[0] ?? "шт")]),
        ),
      );
    });
  };

  const onImport = (): void => {
    if (file === null) return;
    setConfirming(false);
    run(async () => {
      const result = await importEstimate(code, file, overrides);
      setDone({ version: result.version, positions: result.report.positions });
      setReport(result.report);
      onImported?.();
    });
  };

  const money = (value: string | null): string => (value === null ? "—" : formatKopecks(BigInt(value)));

  return (
    <section className="stack stack--loose">
      <div className="section-head">
        <h2 className="t-h2">Импорт сметы</h2>
        <p className="t-sm t-muted">разбор без записи, затем запись новой редакции</p>
      </div>

      <div className="field">
        <span className="field__label">Книга Excel со сметой</span>
        <label className="filefield">
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-describedby={error === null ? undefined : "import-error"}
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (chosen) onPreview(chosen);
            }}
          />
          <span className="filefield__button">
            <svg className="icon" aria-hidden="true"><use href="#i-expense" /></svg>
            Выбрать файл
          </span>
          <span className="filefield__name">{file?.name ?? "файл не выбран"}</span>
        </label>
      </div>

      {error !== null && <p className="field__error" id="import-error" role="alert">{error}</p>}
      {/* Д-23: загрузка объявляется, а не только рисуется. */}
      {busy && <span className="skeleton skeleton--row" aria-busy="true" aria-label="Идёт разбор файла" />}

      {report !== null && (
        <>
          <div className="row row--wrap">
            <span className="metric"><span className="metric__value">{report.positions}</span><span className="metric__label">позиций работ</span></span>
            <span className="metric"><span className="metric__value">{report.sectionsTopLevel} / {report.sectionsNested}</span><span className="metric__label">разделов и вложенных</span></span>
            <span className="metric"><span className="metric__value">{report.otherExpenses}</span><span className="metric__label">прочих расходов</span></span>
          </div>

          <div className="panel panel--pad stack stack--tight">
            <p className="figure__label">Отчёт о расхождениях</p>
            <hr className="rule" />
            <p className="row row--between">
              <span className="t-sm">Пересчёт по позициям</span>
              <span className="num">{money(report.computedWorksTotal)}</span>
            </p>
            <p className="row row--between">
              <span className="t-sm">Заявлено в файле</span>
              <span className="num">{money(report.declaredWorksTotal)}</span>
            </p>
            {report.findings.map((finding, index) => (
              <div className="stack stack--tight" key={`${finding.kind}-${index}`}>
                <p className="row row--between">
                  <span className="t-sm">{finding.title}</span>
                  {/* Справа стоит величина находки. Перечень строк — не
                      денежная величина и в эту колонку не помещается:
                      четырнадцать номеров дают 569 px при окне 360. */}
                  <span className={finding.amount === null ? "t-sm t-muted" : "num num--danger"}>
                    {finding.amount === null ? `строк: ${finding.rows.length}` : money(finding.amount)}
                  </span>
                </p>
                {finding.rows.length > 0 && (
                  // Д-22: четырнадцать номеров строк сплошной строкой — стена
                  // цифр; раскрытие оставляет её тем, кому она нужна.
                  <details className="finding__rows">
                    <summary className="t-sm t-muted">
                      {finding.rows.length} {plural(finding.rows.length, "строка", "строки", "строк")} файла
                    </summary>
                    <p className="t-sm t-muted">строки {finding.rows.join(", ")}</p>
                  </details>
                )}
              </div>
            ))}
            <hr className="rule" />
            <p className="row row--between">
              <span className="t-body">Недосчёт итога по работам</span>
              <span className="num num--h2 num--danger">{money(report.worksTotalDelta)}</span>
            </p>
          </div>

          {report.unitDecisions.length > 0 && done === null && (
            <div className="panel panel--pad stack stack--tight">
              <p className="figure__label">Единицы измерения, требующие решения</p>
              <p className="t-sm t-muted">
                Написание не определяет физическую величину. Система предлагает значение,
                но выбор за вами: он меняет объём работ по этим позициям.
              </p>
              <hr className="rule" />
              {report.unitDecisions.map((decision) => (
                // Д-22: подпись и орган управления в одной строке ведомости,
                // а не по разным краям экрана в 900 px друг от друга.
                <p className="unitdecision" key={decision.raw}>
                  <span className="t-sm">
                    «{decision.raw.trim() || "пусто"}» — {decision.positions} позиц.
                  </span>
                  <span className="selectwrap">
                  <select
                    className="input"
                    aria-label={`Единица для написания «${decision.raw.trim() || "пусто"}»`}
                    value={overrides[decision.raw] ?? ""}
                    onChange={(event) =>
                      setOverrides((current) => ({ ...current, [decision.raw]: event.target.value }))
                    }
                  >
                    {units.map((unit) => (
                      <option key={unit} value={unit}>{unit}</option>
                    ))}
                  </select>
                  <svg className="icon selectwrap__chevron" aria-hidden="true"><use href="#i-chevron" /></svg>
                  </span>
                </p>
              ))}
            </div>
          )}

          {done === null ? (
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => setConfirming(true)}
              data-loading={busy || undefined}
            >
              Создать редакцию сметы
            </button>
          ) : (
            // Д-10: результат объявляется, а не только показывается.
            <p className="toast" role="status">
              <span className="pill pill--ok">Импортировано</span>
              <span className="t-sm">
                Редакция {done.version}, позиций {done.positions}. Расхождение сохранено в протоколе импорта.
              </span>
            </p>
          )}
        </>
      )}

      {/* Д-01: смета — основание расчётов с заказчиком и бригадой. Запись
          новой редакции называет последствия до того, как что-то изменится. */}
      {confirming && report !== null && (
        <ConfirmImport
          positions={report.positions}
          delta={money(report.worksTotalDelta)}
          decisions={report.unitDecisions.length}
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={onImport}
        />
      )}
    </section>
  );
}

/** Подтверждение записи сметы. Перечисляет ровно то, что изменится. */
function ConfirmImport({
  positions,
  delta,
  decisions,
  busy,
  onCancel,
  onConfirm,
}: {
  positions: number;
  delta: string;
  decisions: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog(onCancel);

  return (
    <>
      <button type="button" className="scrim" aria-label="Отменить" onClick={onCancel} />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="confirm-import-title" ref={dialog}>
        <p className="t-h3" id="confirm-import-title">Записать смету в объект?</p>
        <dl className="deflist">
          <div className="deflist__row">
            <dt className="deflist__term">Позиций будет записано</dt>
            <dd className="deflist__value">{positions}</dd>
          </div>
          <div className="deflist__row">
            <dt className="deflist__term">Недосчёт итога по файлу</dt>
            <dd className="deflist__value">{delta}</dd>
          </div>
          <div className="deflist__row">
            <dt className="deflist__term">Решений по единицам применится</dt>
            <dd className="deflist__value">{decisions}</dd>
          </div>
        </dl>
        <p className="t-sm t-secondary">
          Новая редакция станет действующей. Прежняя останется в протоколе импорта и в журнале
          объекта — история не переписывается.
        </p>
        <div className="stack stack--tight">
          <button
            ref={first}
            type="button"
            className="btn btn--primary btn--block btn--touch"
            disabled={busy}
            onClick={onConfirm}
          >
            Записать смету
          </button>
          <button type="button" className="btn btn--text btn--block" onClick={onCancel}>
            Отмена
          </button>
        </div>
      </div>
    </>
  );
}
