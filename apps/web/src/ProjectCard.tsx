import { useEffect, useState } from "react";
import type { CurrentUser, EstimateView, ImportRecord, ProjectSummary } from "@priyomka/contracts";
import { formatKopecks, formatPercent } from "@priyomka/ui";
import { fetchEstimate, fetchImports } from "./api.js";
import { EstimateTable } from "./EstimateTable.js";
import { ImportEstimate } from "./ImportEstimate.js";

const STATUS_LABEL: Record<ProjectSummary["status"], string> = {
  NEW: "Новый",
  IN_PROGRESS: "В работе",
  PAUSED: "Пауза",
  WAITING_CLIENT: "Ждёт ответа",
  DONE: "Завершён",
  ARCHIVED: "Архив",
};

const money = (value: string): string => formatKopecks(BigInt(value));

/** Кольцо готовности. Считается по сумме принятых позиций к итогу сметы. */
function ReadinessRing({ share }: { share: number }): React.JSX.Element {
  const circumference = 2 * Math.PI * 32;
  return (
    <div className="ring ring--on-accent">
      <svg viewBox="0 0 72 72" width="72" height="72" aria-hidden="true">
        <circle className="ring__track" cx="36" cy="36" r="32" fill="none" strokeWidth="8" />
        <circle
          className="ring__arc"
          cx="36" cy="36" r="32" fill="none" strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - share / 100)}
          transform="rotate(-90 36 36)"
        />
      </svg>
      <span className="ring__value">{share} %</span>
    </div>
  );
}

type Tab = "estimate" | "import";

export function ProjectCard({
  project,
  user,
  units,
  onBack,
}: {
  project: ProjectSummary;
  user: CurrentUser;
  units: string[];
  onBack: () => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("estimate");
  const [estimate, setEstimate] = useState<EstimateView | null>(null);
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = (): void => {
    setLoading(true);
    void fetchEstimate(project.code)
      .then(async (view) => {
        setEstimate(view);
        setImports(await fetchImports(project.code));
        setError(null);
      })
      .catch((cause: Error) => {
        setEstimate(null);
        setError(cause.message);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [project.code]);

  /**
   * Срок объекта. Дедлайн в прошлом — обычное дело на ремонте, и подпись
   * должна называть это просрочкой, а не «осталось минус девятнадцать дней».
   */
  const deadline =
    project.deadline === null
      ? null
      : {
          date: new Date(project.deadline).toLocaleDateString("ru-RU"),
          days: Math.round((new Date(project.deadline).getTime() - Date.now()) / 86_400_000),
        };
  const overdue = deadline !== null && deadline.days < 0;

  return (
    <>
      <div className="cover">
        <div className="container">
          <p className="cover__crumbs">
            <a href="#" onClick={(event) => { event.preventDefault(); onBack(); }}>Объекты</a>
            <svg className="icon icon--sm" aria-hidden="true"><use href="#i-crumb" /></svg>
            <span>{project.address}</span>
          </p>
          <div className="cover__title">
            <span className="code-badge code-badge--lg">{project.code}</span>
            <h1 className="t-h1">{project.address}</h1>
            <span className="pill pill--ok">{STATUS_LABEL[project.status]}</span>
          </div>
        </div>
      </div>

      <main className="container">
        <div className="project-layout">
          <aside className="stack">
            <div className="stack">
              <div className="figure">
                <span className="figure__label">Выполнено на сумму</span>
                <span className="figure__value">{money("0")}</span>
                <span className="figure__note">приёмок пока нет</span>
              </div>
              {estimate !== null && (
                <div className="figure">
                  <span className="figure__label">Итог по работам</span>
                  <span className="figure__value figure__value--h2">{money(estimate.totals.works)}</span>
                  <span className="figure__note">
                    пересчёт по {estimate.positions} позициям
                  </span>
                </div>
              )}
            </div>

            {estimate !== null && (
              <div className="figure figure--framed">
                <span className="figure__label">Итог сметы для клиента</span>
                <span className="figure__value">{money(estimate.totals.estimate)}</span>
                <span className="figure__note">
                  включая сопровождение объекта {formatPercent(BigInt(estimate.totals.supervisionShare))} —{" "}
                  {money(estimate.totals.supervision)}
                </span>
              </div>
            )}

            <div className="tile stack stack--tight">
              <span className="figure__label">Чеки на материалы</span>
              <p className="mail-gateway">
                checks+<span className="code-badge">{project.code.replace("-", "")}</span>@dolgiy.studio
              </p>
              <p className="t-sm t-muted">Код объекта ищется и в теме письма. Письмо без кода не теряется.</p>
            </div>

            <div className="tile tile--accent row row--between">
              <div className="figure">
                <span className="figure__label">
                  {deadline === null ? "Срок" : overdue ? "Просрочено на" : "Осталось"}
                </span>
                <span className="figure__value">
                  {deadline === null ? "—" : Math.abs(deadline.days)}
                </span>
                <span className="figure__note">
                  {deadline === null ? "дедлайн не задан" : `дней · дедлайн ${deadline.date}`}
                </span>
              </div>
              <ReadinessRing share={0} />
            </div>

            <dl className="deflist">
              <p className="deflist__head">Информация</p>
              <div className="deflist__row">
                <dt className="deflist__term">Клиент</dt>
                <dd className="deflist__value">[{project.client.code}] {project.client.name}</dd>
              </div>
              <div className="deflist__row">
                <dt className="deflist__term">Прораб</dt>
                <dd className="deflist__value">{project.foreman?.name ?? "не назначен"}</dd>
              </div>
              <div className="deflist__row">
                <dt className="deflist__term">Ключи</dt>
                <dd className="deflist__value">{project.keysCount} компл.</dd>
              </div>
              {estimate !== null && (
                <div className="deflist__row">
                  <dt className="deflist__term">Смета</dt>
                  <dd className="deflist__value">редакция {estimate.version}</dd>
                </div>
              )}
            </dl>
          </aside>

          <div className="stack stack--loose">
            <div className="tabs" role="tablist">
              <button type="button" className="tabs__item" role="tab" aria-selected={tab === "estimate"} onClick={() => setTab("estimate")}>
                Смета
              </button>
              {user.role === "OWNER" && (
                <button type="button" className="tabs__item" role="tab" aria-selected={tab === "import"} onClick={() => setTab("import")}>
                  Импорт
                </button>
              )}
            </div>

            {tab === "estimate" && (
              <>
                {loading && <span className="skeleton skeleton--row" />}
                {error !== null && !loading && (
                  <div className="empty">
                    <p className="empty__title">Сметы пока нет</p>
                    <p className="empty__text">{error}</p>
                    {user.role === "OWNER" && (
                      <button type="button" className="btn btn--primary" onClick={() => setTab("import")}>
                        Импортировать смету
                      </button>
                    )}
                  </div>
                )}
                {estimate !== null && <EstimateTable estimate={estimate} />}
                {estimate !== null && estimate.otherExpenses.length > 0 && (
                  <div className="panel panel--pad stack stack--tight">
                    <p className="figure__label">Прочие расходы · цена без объёма, приёмке не подлежат</p>
                    <hr className="rule" />
                    {estimate.otherExpenses.map((expense) => (
                      <p className="row row--between" key={expense.id}>
                        <span className="t-sm">{expense.name}</span>
                        <span className="num">{money(expense.unitPrice)} / {expense.unit}</span>
                      </p>
                    ))}
                  </div>
                )}
                {imports.length > 0 && (
                  <div className="panel panel--pad stack stack--tight">
                    <p className="figure__label">Отчёт о расхождениях · импорт от {new Date(imports[0]!.importedAt).toLocaleDateString("ru-RU")}</p>
                    <hr className="rule" />
                    {imports[0]!.report.findings.map((finding, index) => (
                      <p className="row row--between" key={`${finding.kind}-${index}`}>
                        <span className="t-sm">{finding.title}</span>
                        <span className={finding.amount === null ? "num t-muted" : "num num--danger"}>
                          {finding.amount === null ? `строк: ${finding.rows.length}` : money(finding.amount)}
                        </span>
                      </p>
                    ))}
                  </div>
                )}
              </>
            )}

            {tab === "import" && <ImportEstimate code={project.code} units={units} onImported={load} />}
          </div>
        </div>
      </main>
    </>
  );
}
