import { useEffect, useState } from "react";
import type { Organization, Role, Unit } from "@priyomka/contracts";
import { formatPhone, isPhoneNumber } from "@priyomka/domain";
import { fetchOrganization, fetchUnits, saveOrganization } from "./api.js";
import { Planned } from "./Planned.js";

/**
 * Настройки организации. Состав вкладок — по артборду `Nastroyki.dc.html`
 * и карте разделов: наполнены «Обзор» и «Смета», остальные показывают
 * стадию, на которой появятся.
 *
 * Правит карточку только руководитель; читают все — часовой пояс нужен и
 * прорабу. Разграничение держит сервер, экран лишь не показывает форму
 * тому, кому она не поможет.
 */
const TABS = [
  { key: "overview", label: "Обзор" },
  { key: "requisites", label: "Реквизиты" },
  { key: "access", label: "Права доступа" },
  { key: "notifications", label: "Уведомления" },
  { key: "estimate", label: "Смета" },
  { key: "integrations", label: "Интеграции" },
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

export function Settings({ role }: { role: Role }): React.JSX.Element {
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
      <div className="tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            className="tabs__item"
            aria-selected={tab === item.key}
            onClick={() => { setTab(item.key); setSaved(false); }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error !== null && <p className="field__error" role="alert">{error}</p>}

      {tab === "overview" && organization !== null && (
        <section className="panel panel--pad stack stack--loose settings__panel">
          <h2 className="t-h2">Данные организации</h2>
          <div className="settings__identity">
            <span className="settings__logo" aria-hidden="true">
              <svg className="icon" aria-hidden="true"><use href="#i-acceptance" /></svg>
            </span>
            <form
              key={`${organization.phone ?? ""}|${organization.email ?? ""}`}
              className="stack stack--loose settings__form"
              onSubmit={submit}
            >
              <label className="field">
                <span className="field__label">Название <abbr className="settings__required" title="обязательное поле">*</abbr></span>
                <input className="input" name="name" required defaultValue={organization.name} disabled={role !== "OWNER"} />
              </label>

              <div className="settings__grid">
                <label className="field">
                  <span className="field__label">Часовой пояс <abbr className="settings__required" title="обязательное поле">*</abbr></span>
                  <span className="selectwrap">
                    <select className="input" name="timeZone" defaultValue={organization.timeZone} disabled={role !== "OWNER"}>
                      {TIME_ZONES.map((zone) => (
                        <option key={zone} value={zone}>{zone}</option>
                      ))}
                    </select>
                    <svg className="icon selectwrap__chevron" aria-hidden="true"><use href="#i-chevron" /></svg>
                  </span>
                </label>
                <label className="field">
                  <span className="field__label">Валюта</span>
                  {/* Валюта одна на организацию: суммы в разных валютах
                      не складываются, поэтому поле только показывает. */}
                  <input className="input" value="₽ рубль" readOnly disabled />
                </label>
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
                  {saved && <span className="pill pill--ok">Сохранено</span>}
                </div>
              )}
            </form>
          </div>
        </section>
      )}

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

      {tab === "requisites" && (
        <Planned
          title="Реквизиты исполнителя"
          stage="ждёт заказчика"
          text={
            "Реквизиты подставляются в акт и счёт. Бланк с реквизитами исполнителя заказчиком " +
            "пока не передан, и придумывать их нельзя: они попадут в документ, который увидит клиент."
          }
        />
      )}
      {tab === "access" && (
        <Planned
          title="Права доступа"
          stage="стадия D"
          text={
            "Роли и их права заданы в коде: руководитель, прораб, снабжение. Экран управления " +
            "появится, когда в системе будет больше одного прораба на организацию."
          }
        />
      )}
      {tab === "notifications" && (
        <Planned
          title="Уведомления"
          stage="стадия D"
          text={
            "Сообщение о приёмке, о поступившем чеке и о наступающем сроке. Отправщик сообщений " +
            "подключается перед пилотом — тем же, которым уходит код подтверждения."
          }
        />
      )}
      {tab === "integrations" && (
        <Planned
          title="Интеграции"
          stage="отложенный контур"
          text={
            "Почтовый шлюз чеков работает и настраивается в карточке объекта. Прочие интеграции " +
            "в объём первой версии не входят: список исключённого — раздел 6.2 файла 01_PROJECT.md."
          }
        />
      )}
    </main>
  );
}
