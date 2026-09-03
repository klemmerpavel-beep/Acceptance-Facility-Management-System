import { useEffect, useState } from "react";
import type { Organization, Role, Unit } from "@priyomka/contracts";
import { formatPhone, isPhoneNumber } from "@priyomka/domain";
import { fetchOrganization, fetchUnits, saveOrganization } from "./api.js";

/**
 * Настройки организации. Состав вкладок — по артборду `Nastroyki.dc.html`
 * и карте разделов: наполнены «Обзор» и «Смета», остальные показывают
 * стадию, на которой появятся.
 *
 * Правит карточку только руководитель; читают все — часовой пояс нужен и
 * прорабу. Разграничение держит сервер, экран лишь не показывает форму
 * тому, кому она не поможет.
 */
/**
 * Вкладки настроек. Здесь то, что работает: карточка организации и
 * справочник единиц. Реквизиты, права, уведомления и интеграции названы
 * в «Что дальше», а не показаны вкладками с заглушками.
 */
const TABS = [
  { key: "overview", label: "Организация" },
  { key: "estimate", label: "Единицы измерения" },
] as const;

type Tab = (typeof TABS)[number]["key"];

/** Пояса, в которых работают студии ремонта России. Список закрытый:
 *  свободный ввод пояса даёт опечатку и сдвиг всех сроков объекта. */
const TIME_ZONES = [
  "Europe/Kaliningrad", "Europe/Moscow", "Europe/Samara", "Asia/Yekaterinburg",
  "Asia/Omsk", "Asia/Krasnoyarsk", "Asia/Irkutsk", "Asia/Yakutsk",
  "Asia/Vladivostok", "Asia/Magadan", "Asia/Kamchatka",
] as const;

/** Хранимый номер показывается разбитым на группы, а не строкой цифр. */
const shownPhone = (stored: string | null): string =>
  stored !== null && isPhoneNumber(stored) ? formatPhone(stored) : (stored ?? "");

export function Settings({ role, onRoadmap }: { role: Role; onRoadmap: () => void }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("overview");
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [units, setUnits] = useState<Unit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchOrganization().then(setOrganization).catch((cause: Error) => setError(cause.message));
  }, []);

  useEffect(() => {
    if (tab !== "estimate" || units !== null) return;
    void fetchUnits().then(setUnits).catch((cause: Error) => setError(cause.message));
  }, [tab, units]);

  const onTabKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = TABS.findIndex((item) => item.key === tab);
    const next = TABS[(index + step + TABS.length) % TABS.length];
    if (next === undefined) return;
    setTab(next.key);
    setSaved(false);
    document.getElementById(`settings-tab-${next.key}`)?.focus();
  };

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    setSaved(false);
    void saveOrganization({
      name: String(form.get("name") ?? ""),
      timeZone: String(form.get("timeZone") ?? ""),
      phone: String(form.get("phone") ?? ""),
      email: String(form.get("email") ?? ""),
    })
      .then((updated) => { setOrganization(updated); setSaved(true); })
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setBusy(false));
  };

  return (
    <main className="container stack stack--loose">
      <div className="tabs" role="tablist" onKeyDown={onTabKey}>
        {TABS.map((item) => (
          <button
            key={item.key}
            id={`settings-tab-${item.key}`}
            type="button"
            role="tab"
            className="tabs__item"
            aria-selected={tab === item.key}
            aria-controls={`settings-panel-${item.key}`}
            tabIndex={tab === item.key ? 0 : -1}
            onClick={() => { setTab(item.key); setSaved(false); }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error !== null && <p className="field__error" id="settings-error" role="alert">{error}</p>}

      <div role="tabpanel" id="settings-panel-overview" aria-labelledby="settings-tab-overview" hidden={tab !== "overview"}>
      {tab === "overview" && organization !== null && (
        <section className="panel panel--pad stack stack--loose settings__panel">
          <h2 className="t-h2">Данные организации</h2>
          {/* Д-29: обязательность названа текстом. Атрибут title на сенсорном
              экране не показывается, и звёздочка оставалась без объяснения. */}
          {role === "OWNER" && (
            <p className="t-sm t-muted">Поля со звёздочкой обязательны.</p>
          )}
          <form
              key={`${organization.phone ?? ""}|${organization.email ?? ""}`}
              className="stack stack--loose settings__form"
              onSubmit={submit}
            >
              <label className="field">
                <span className="field__label">Название <span className="settings__required">*</span></span>
                <input className="input" name="name" required defaultValue={organization.name} disabled={role !== "OWNER"} aria-describedby={error === null ? undefined : "settings-error"} aria-invalid={error === null ? undefined : true} />
              </label>

              <div className="settings__grid">
                <label className="field">
                  <span className="field__label">Часовой пояс <span className="settings__required">*</span></span>
                  <span className="selectwrap">
                    <select className="input" name="timeZone" defaultValue={organization.timeZone} disabled={role !== "OWNER"}>
                      {TIME_ZONES.map((zone) => (
                        <option key={zone} value={zone}>{zone}</option>
                      ))}
                    </select>
                    <svg className="icon selectwrap__chevron" aria-hidden="true"><use href="#i-chevron" /></svg>
                  </span>
                </label>
                {/* Валюта одна на организацию: суммы в разных валютах не
                    складываются. Поле, которое нельзя править, выглядело как
                    редактируемое и не попадало в обход клавиатурой (Д-21). */}
                <div className="field">
                  <span className="field__label">Валюта</span>
                  <p className="field__value">₽ рубль</p>
                </div>
                <label className="field">
                  <span className="field__label">Телефон</span>
                  <input className="input input--tel" name="phone" type="tel" defaultValue={shownPhone(organization.phone)} disabled={role !== "OWNER"} placeholder="+7 (___) ___-__-__" />
                </label>
                <label className="field">
                  <span className="field__label">Почта</span>
                  <input className="input" name="email" type="email" defaultValue={organization.email ?? ""} disabled={role !== "OWNER"} />
                </label>
              </div>

              {role === "OWNER" && (
                <div className="row">
                  <button className="btn btn--primary" type="submit" data-loading={busy || undefined}>
                    Сохранить изменения
                  </button>
                  {saved && <span className="pill pill--ok" role="status">Сохранено</span>}
                </div>
              )}
          </form>
        </section>
      )}
      </div>

      <div role="tabpanel" id="settings-panel-estimate" aria-labelledby="settings-tab-estimate" hidden={tab !== "estimate"}>
      {tab === "estimate" && (
        <section className="panel panel--pad stack settings__panel">
          <h2 className="t-h2">Единицы измерения</h2>
          <p className="t-sm t-muted prose">
            Девять канонических форм. Написания в правой колонке импорт приводит сам; составные
            записи вроде «м2/мп» не приводятся — они выносятся на решение оператора на экране
            импорта, потому что написание не определяет физическую величину.
          </p>
          {units === null ? (
            <span className="skeleton skeleton--row" />
          ) : (
            <dl className="deflist">
              {units.map((unit) => (
                <div className="deflist__row" key={unit.name}>
                  <dt className="deflist__term"><span className="num">{unit.name}</span></dt>
                  <dd className="deflist__value">{unit.aliases.join(", ")}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      )}
      </div>

      <p className="t-sm t-muted">
        Чего в системе пока нет и когда появится —{" "}
        <a
          href="#roadmap"
          onClick={(event) => { event.preventDefault(); onRoadmap(); }}
        >
          «Что дальше»
        </a>.
      </p>
    </main>
  );
}
