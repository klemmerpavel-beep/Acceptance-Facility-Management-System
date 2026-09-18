import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DocumentTemplate, IssuedDocument, ProjectSummary, Role, SaveTemplate, TemplateRow,
} from "@priyomka/contracts";
import { templateFault, unknownVariables, VARIABLES, VARIABLE_GROUPS } from "@priyomka/domain";
import {
  createTemplate, deleteTemplate, errorMessage, fetchTemplate, fetchTemplates, issueDocument,
  updateTemplate,
} from "./api.js";
import { Announce } from "./Announce.js";
import { имяЛиста, печать } from "./print.js";
import { завести } from "./verbs.js";

/**
 * Раздел «Документы организации».
 *
 * Вопрос экрана: какими бумагами работает компания. Ключевое действие —
 * выпустить документ по объекту.
 *
 * **Оформления в шаблоне нет.** Панель стилизации из утверждённого макета не
 * делается (решение заказчика от 13.09.2026): бланк задаёт система — тот же,
 * что у акта. Отдать оформление пользователю значило бы вывести вид документа
 * из-под дизайн-системы к тому, кто последним правил шаблон.
 *
 * **Акта среди видов нет.** Он собирается из принятых позиций и шаблоном не
 * правится: редактируемый текст смог бы вынести ставку оплаты труда в
 * клиентский документ.
 *
 * Метка остаётся видимой в шаблоне и заменяется значением при выпуске — так
 * записано на макете. Разбор и подстановка живут в домене (`template.ts`) и
 * зовутся и отсюда, и сервером: одно правило, два места применения.
 */

const ВИДЫ: Readonly<Record<string, string>> = {
  CONTRACT: "Договор",
  ANNEX: "Дополнительное соглашение",
  OTHER: "Прочее",
};

const дата = (iso: string): string => {
  const [год, месяц, день] = iso.slice(0, 10).split("-");
  return год === undefined ? iso : `${день ?? ""}.${месяц ?? ""}.${год}`;
};

interface Пункт { title: string; body: string }

export function Documents({
  role, projects,
}: {
  role: Role;
  projects: readonly ProjectSummary[];
}): React.JSX.Element {
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [открыт, setОткрыт] = useState<string | null>(null);
  const [шаблон, setШаблон] = useState<DocumentTemplate | null>(null);
  const [документ, setДокумент] = useState<IssuedDocument | null>(null);
  const [правка, setПравка] = useState<{ id: string | null; name: string; kind: string; clauses: Пункт[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [объявление, setОбъявление] = useState<string | null>(null);
  /* Бланк появляется ниже перечня — за сгибом на любом экране. Нажавший
     «выпустить» видит прежнюю картину и решает, что ничего не вышло.
     Документ уводится в поле зрения; живая область объявляет то же самое
     тому, кто экрана не видит. */
  const бланк = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    fetchTemplates()
      .then((next) => { setRows(next); setError(null); })
      .catch((cause: unknown) => { setError(errorMessage(cause)); });
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (открыт === null) { setШаблон(null); return; }
    fetchTemplate(открыт)
      .then((next) => { setШаблон(next); setError(null); })
      .catch((cause: unknown) => { setError(errorMessage(cause)); });
  }, [открыт]);

  const правит = role === "OWNER";

  const выпустить = (id: string, projectCode: string): void => {
    setBusy(true);
    issueDocument(id, projectCode)
      .then((next) => {
        setДокумент(next);
        setError(null);
        setОбъявление(`Документ «${next.name}» выпущен по объекту ${next.project.code}`);
        window.requestAnimationFrame(() => {
          бланк.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      })
      .catch((cause: unknown) => { setError(errorMessage(cause)); })
      .finally(() => { setBusy(false); });
  };

  const сохранить = (): void => {
    if (правка === null) return;
    const тело: SaveTemplate = {
      name: правка.name,
      kind: правка.kind as SaveTemplate["kind"],
      clauses: правка.clauses,
    };
    const отказ = templateFault(тело);
    if (отказ !== null) { setError(отказ); return; }
    setBusy(true);
    const действие = правка.id === null
      ? createTemplate(тело)
      : updateTemplate(правка.id, тело);
    действие
      .then((next) => {
        setRows(next);
        setПравка(null);
        setError(null);
        setОбъявление(`Шаблон «${тело.name}» сохранён`);
      })
      .catch((cause: unknown) => { setError(errorMessage(cause)); })
      .finally(() => { setBusy(false); });
  };

  const удалить = (row: TemplateRow): void => {
    setBusy(true);
    deleteTemplate(row.id)
      .then((next) => {
        setRows(next);
        if (открыт === row.id) setОткрыт(null);
        setError(null);
        setОбъявление(`Шаблон «${row.name}» удалён`);
      })
      .catch((cause: unknown) => { setError(errorMessage(cause)); })
      .finally(() => { setBusy(false); });
  };

  if (rows === null) {
    return (
      <main className="container stack stack--loose">
        <p className="t-sm t-muted">Загружаем шаблоны…</p>
      </main>
    );
  }

  return (
    <main className="container stack stack--loose">
      <Announce text={объявление} />

      <div className="docs-screen stack stack--loose">
        <div className="section-head">
          <h1 className="t-h1">Документы организации</h1>
          {правит && (
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => {
                setПравка({ id: null, name: "", kind: "CONTRACT", clauses: [{ title: "", body: "" }] });
              }}
            >
              {завести("шаблон")}
            </button>
          )}
        </div>

        {error !== null && <p className="field__error" role="alert">{error}</p>}

        {rows.length === 0 ? (
          <div className="empty">
            <p className="empty__title">Шаблонов пока нет</p>
            <p className="empty__text">
              Шаблон — это текст документа с переменными: {"{{объект.код}}"}, {"{{контрагент.наименование}}"}.
              При выпуске переменные заменяются данными выбранного объекта.
            </p>
          </div>
        ) : (
          <ul className="records">
            {rows.map((row) => (
              <li className="record" key={row.id}>
                <span className="pill">{ВИДЫ[row.kind] ?? row.kind}</span>
                <div className="record__body">
                  <p className="record__head"><span className="t-strong">{row.name}</span></p>
                  <p className="t-sm t-muted">
                    пунктов {row.clauses} · правлен {дата(row.updatedAt)}
                  </p>
                </div>
                <div className="record__side">
                  <span className="record__actions">
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => { setОткрыт(открыт === row.id ? null : row.id); setДокумент(null); }}
                    >
                      {открыт === row.id ? "Свернуть" : "Открыть"}
                    </button>
                    {правит && (
                      <button
                        type="button"
                        className="btn btn--text"
                        disabled={busy}
                        onClick={() => { удалить(row); }}
                      >
                        Удалить
                      </button>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {шаблон !== null && (
          <section className="stack stack--tight">
            <div className="section-head">
              <h2 className="t-h2">{шаблон.name}</h2>
              {правит && (
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => {
                    setПравка({
                      id: шаблон.id, name: шаблон.name, kind: шаблон.kind,
                      clauses: шаблон.clauses.map((пункт) => ({ ...пункт })),
                    });
                  }}
                >
                  Править
                </button>
              )}
            </div>

            {/* Метки в шаблоне остаются метками: это и есть шаблон. */}
            <ol className="doc__clauses">
              {шаблон.clauses.map((пункт, индекс) => (
                <li className="doc__clause" key={`${пункт.title}-${String(индекс)}`}>
                  <p className="t-strong">{пункт.title}</p>
                  <p className="t-sm">{пункт.body}</p>
                </li>
              ))}
            </ol>

            <label className="field">
              <span className="field__label">Выпустить по объекту</span>
              <select
                className="input"
                disabled={busy}
                defaultValue=""
                onChange={(event) => {
                  if (event.target.value !== "") выпустить(шаблон.id, event.target.value);
                }}
              >
                <option value="">Выберите объект</option>
                {projects.map((project) => (
                  <option key={project.code} value={project.code}>
                    {project.code} — {project.address}
                  </option>
                ))}
              </select>
            </label>
          </section>
        )}

        {/* Орган печати стоит в экранной части, а не на бланке: на листе ему
            не место, а экранная часть скрывается печатью одним классом. */}
        {документ !== null && (
          <div className="sheet-actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => { печать(имяЛиста(документ.name, документ.project.code)); }}
            >
              Печать документа
            </button>
            <p className="t-sm t-muted sheet-actions__hint">
              В диалоге печати выберите «Сохранить как PDF», чтобы получить файл.
            </p>
          </div>
        )}
      </div>

      <div ref={бланк}>
        {документ !== null && <IssuedSheet документ={документ} />}
      </div>

      {правка !== null && (
        <TemplateSheet
          правка={правка}
          busy={busy}
          onChange={setПравка}
          onSave={сохранить}
          onClose={() => { setПравка(null); setError(null); }}
        />
      )}
    </main>
  );
}

/**
 * Выпущенный документ бланком. На печати остаётся только он — тем же приёмом,
 * что у акта и обмерного плана: экранная часть скрыта одним классом, а не
 * перечислением блоков, которое устаревает на первой правке.
 */
function IssuedSheet({ документ }: { документ: IssuedDocument }): React.JSX.Element {
  return (
    <div className="act doc">
      <div className="act__head">
        <p className="act__title">{документ.name}</p>
        <p className="t-sm t-muted">
          от {дата(документ.issuedAt)} · объект {документ.project.code}, {документ.project.address}
        </p>
      </div>

      <div className="act__parties">
        <div className="act__party">
          <p className="field__label--cap">Исполнитель</p>
          <p className="t-strong">{документ.contractor.name}</p>
          {документ.contractor.requisites !== null && (
            <p className="t-sm">{документ.contractor.requisites}</p>
          )}
        </div>
        <div className="act__party">
          <p className="field__label--cap">Заказчик</p>
          <p className="t-strong">{документ.client.name}</p>
          {документ.client.requisites !== null && <p className="t-sm">{документ.client.requisites}</p>}
        </div>
      </div>

      <ol className="doc__clauses">
        {документ.clauses.map((пункт, индекс) => (
          <li className="doc__clause" key={`${пункт.title}-${String(индекс)}`}>
            <p className="t-strong">{пункт.title}</p>
            <p>{пункт.body}</p>
          </li>
        ))}
      </ol>

      <div className="act__signs">
        <p className="t-sm t-muted">Исполнитель ____________________</p>
        <p className="t-sm t-muted">Заказчик ____________________</p>
      </div>
    </div>
  );
}

/** Лист правки шаблона: пункты и палитра переменных рядом с текстом. */
function TemplateSheet({
  правка, busy, onChange, onSave, onClose,
}: {
  правка: { id: string | null; name: string; kind: string; clauses: Пункт[] };
  busy: boolean;
  onChange: (следующая: { id: string | null; name: string; kind: string; clauses: Пункт[] }) => void;
  onSave: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const правь = (изменение: Partial<typeof правка>): void => { onChange({ ...правка, ...изменение }); };
  const чужие = unknownVariables(
    правка.clauses.map((пункт) => `${пункт.title}\n${пункт.body}`).join("\n"));

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Шаблон документа">
      <div className="sheet__body stack stack--tight">
        <h2 className="t-h2">{правка.id === null ? "Новый шаблон" : "Правка шаблона"}</h2>

        <label className="field">
          <span className="field__label">Наименование</span>
          <input
            className="input"
            value={правка.name}
            onChange={(event) => { правь({ name: event.target.value }); }}
          />
        </label>

        <label className="field">
          <span className="field__label">Вид</span>
          <select
            className="input"
            value={правка.kind}
            onChange={(event) => { правь({ kind: event.target.value }); }}
          >
            {Object.entries(ВИДЫ).map(([код, подпись]) => (
              <option key={код} value={код}>{подпись}</option>
            ))}
          </select>
        </label>

        {правка.clauses.map((пункт, индекс) => (
          <div className="formgroup" key={индекс}>
            <label className="field">
              <span className="field__label">Заголовок пункта {индекс + 1}</span>
              <input
                className="input"
                value={пункт.title}
                onChange={(event) => {
                  const следующие = [...правка.clauses];
                  следующие[индекс] = { ...пункт, title: event.target.value };
                  правь({ clauses: следующие });
                }}
              />
            </label>
            <label className="field">
              <span className="field__label">Текст пункта {индекс + 1}</span>
              <textarea
                className="input doc__body"
                value={пункт.body}
                onChange={(event) => {
                  const следующие = [...правка.clauses];
                  следующие[индекс] = { ...пункт, body: event.target.value };
                  правь({ clauses: следующие });
                }}
              />
            </label>
            {правка.clauses.length > 1 && (
              <button
                type="button"
                className="btn btn--text"
                onClick={() => {
                  правь({ clauses: правка.clauses.filter((_, номер) => номер !== индекс) });
                }}
              >
                Снять пункт {индекс + 1}
              </button>
            )}
          </div>
        ))}

        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => { правь({ clauses: [...правка.clauses, { title: "", body: "" }] }); }}
        >
          Добавить пункт
        </button>

        {/* Палитра переменных: метка вписывается руками, и без перечня её
            пришлось бы помнить наизусть. Неизвестная метка названа сразу, а
            не при сохранении: отказ в конце длинной формы дороже подсказки. */}
        <details className="doc__palette">
          <summary className="t-sm">Переменные</summary>
          {VARIABLE_GROUPS.map((группа) => (
            <div className="doc__group" key={группа}>
              <p className="field__label--cap">{группа}</p>
              <ul className="doc__vars">
                {VARIABLES.filter((переменная) => переменная.group === группа).map((переменная) => (
                  <li key={переменная.name}>
                    <code className="doc__var">{`{{${переменная.name}}}`}</code>
                    <span className="t-sm t-muted"> — {переменная.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </details>

        {чужие.length > 0 && (
          <p className="field__error" role="alert">
            Неизвестные переменные: {чужие.join(", ")}. Подставить их нечем, и в документе они
            останутся меткой.
          </p>
        )}

        <div className="sheet__actions">
          <button type="button" className="btn btn--secondary" onClick={onClose}>Отмена</button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || чужие.length > 0}
            onClick={onSave}
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
