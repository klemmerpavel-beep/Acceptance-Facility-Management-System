import { useEffect, useState } from "react";
import type { ClientRow, Organization, RepairType, Unit } from "@priyomka/contracts";
import { formatPhone, isPhoneNumber } from "@priyomka/domain";
import { formatKopecks, formatPercent } from "@priyomka/ui";
import {
  createRepairType, errorMessage, fetchOrganization, fetchRepairTypes, fetchUnits,
  fetchClients, logout, saveOrganization, updateRepairType,
} from "./api.js";
import { useModalDialog } from "./modal.js";
import { plural } from "./status.js";
import { tabArrowHandler } from "./tabs.js";
import { People } from "./People.js";

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
  /* Люди стоят рядом с организацией, а не отдельным разделом: выдача входа —
     настройка компании, и шестого пункта в полосе разделов она не стоит. */
  { key: "people", label: "Люди" },
  { key: "estimate", label: "Единицы измерения" },
  { key: "tariffs", label: "Типы ремонта" },
] as const;

type Tab = (typeof TABS)[number]["key"];

/** Пояса, в которых работают студии ремонта России. Список закрытый:
 *  свободный ввод пояса даёт опечатку и сдвиг всех сроков объекта. */
const TIME_ZONES = [
  "Europe/Kaliningrad", "Europe/Moscow", "Europe/Samara", "Asia/Yekaterinburg",
  "Asia/Omsk", "Asia/Krasnoyarsk", "Asia/Irkutsk", "Asia/Yakutsk",
  "Asia/Vladivostok", "Asia/Magadan", "Asia/Kamchatka",
] as const;

/**
 * Значение текстового поля формы.
 *
 * `FormData.get` отдаёт строку или файл, и `String(файл)` даёт «[object
 * File]» молча: поле, к которому однажды приложат загрузку, уедет в базу
 * мусором. Здесь нестрока превращается в пустую строку.
 */
const text = (form: FormData, field: string): string => {
  const value = form.get(field);
  return typeof value === "string" ? value : "";
};

/** Хранимый номер показывается разбитым на группы, а не строкой цифр. */
const shownPhone = (stored: string | null): string =>
  stored !== null && isPhoneNumber(stored) ? formatPhone(stored) : (stored ?? "");

export function Settings({
  onRoadmap,
  onSignedOut,
}: {
  onRoadmap: () => void;
  onSignedOut: () => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("overview");
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [units, setUnits] = useState<Unit[] | null>(null);
  /* Справочник заказчиков нужен листу заведения: заказчику ставится связь
     с записью, и выбирать её по опознавателю руками никто не станет. */
  const [клиенты, setКлиенты] = useState<ClientRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    /* Отказ проглатывается: справочник нужен одной вкладке из четырёх, и
       падать всем экраном из-за него значило бы закрыть настройки целиком. */
    fetchClients().then(setКлиенты).catch(() => { setКлиенты([]); });
  }, []);

  useEffect(() => {
    void fetchOrganization().then(setOrganization).catch((cause: unknown) => setError(errorMessage(cause)));
  }, []);

  useEffect(() => {
    if (tab !== "estimate" || units !== null) return;
    void fetchUnits().then(setUnits).catch((cause: unknown) => setError(errorMessage(cause)));
  }, [tab, units]);

  const onTabKey = tabArrowHandler(
    TABS.map((item) => item.key),
    tab,
    (next) => { setTab(next); setSaved(false); },
    (key) => `settings-tab-${key}`,
  );

  const submit: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    setSaved(false);
    void saveOrganization({
      name: text(form, "name"),
      timeZone: text(form, "timeZone"),
      phone: text(form, "phone"),
      email: text(form, "email"),
      requisites: text(form, "requisites"),
    })
      .then((updated) => { setOrganization(updated); setSaved(true); })
      .catch((cause: unknown) => setError(errorMessage(cause)))
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
          <p className="t-sm t-muted">Поля со звёздочкой обязательны.</p>
          <form
              key={`${organization.phone ?? ""}|${organization.email ?? ""}`}
              className="stack stack--loose settings__form"
              onSubmit={submit}
            >
              <label className="field">
                <span className="field__label">Название <span className="settings__required">*</span></span>
                <input className="input" name="name" required defaultValue={organization.name} aria-describedby={error === null ? undefined : "settings-error"} aria-invalid={error === null ? undefined : true} />
              </label>

              <div className="settings__grid">
                <label className="field">
                  <span className="field__label">Часовой пояс <span className="settings__required">*</span></span>
                  <span className="selectwrap">
                    <select className="input" name="timeZone" defaultValue={organization.timeZone}>
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
                  <input className="input input--tel" name="phone" type="tel" defaultValue={shownPhone(organization.phone)} placeholder="+7 (___) ___-__-__" />
                </label>
                <label className="field">
                  <span className="field__label">Почта</span>
                  <input className="input" name="email" type="email" defaultValue={organization.email ?? ""} />
                </label>
              </div>

              {/* Реквизиты — одно поле свободного текста, решение заказчика
                  от 13.09.2026. Набор граф (ИНН, счёт, банк, БИК) пришлось
                  бы придумывать за компанию, а печатается всё равно то, что
                  вписал руководитель. То же устройство, что у реквизитов
                  заказчика в «Контактах». */}
              <label className="field">
                <span className="field__label">Реквизиты для акта</span>
                <textarea
                  className="input settings__requisites"
                  name="requisites"
                  rows={3}
                  maxLength={600}
                  placeholder="ИП Долгий П. С., ИНН 366000000000, р/с 40802810000000000000"
                  defaultValue={organization.requisites ?? ""}
                />
                <span className="field__hint">
                  Печатаются в шапке акта выполненных работ со стороны исполнителя.
                </span>
              </label>

              <div className="row">
                <button className="btn btn--primary" type="submit" data-loading={busy || undefined}>
                  Сохранить изменения
                </button>
                {saved && <span className="pill pill--ok" role="status">Сохранено</span>}
              </div>
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

      <div role="tabpanel" id="settings-panel-people" aria-labelledby="settings-tab-people" hidden={tab !== "people"}>
        {tab === "people" && <People clients={клиенты} />}
      </div>

      <div role="tabpanel" id="settings-panel-tariffs" aria-labelledby="settings-tab-tariffs" hidden={tab !== "tariffs"}>
      {tab === "tariffs" && <RepairTypes />}
      </div>

      {/* Выход переехал сюда из шапки: в шапке эталона справа стоят блок
          пользователя и колокол, и лишний орган управления рядом с ними
          сделал бы её длиннее полосы навигации. Нужен он редко — выходят в
          конце дня. Переключателя темы здесь больше нет: тема одна. */}
      <section className="panel panel--pad stack settings__panel">
        <h2 className="t-h2">Рабочее место</h2>
        <div className="row">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => void logout().then(onSignedOut)}
          >
            Выйти
          </button>
        </div>
      </section>

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

/**
 * Справочник типов ремонта с тарифом за квадратный метр.
 *
 * Правится здесь, а не зашит в код: цены меняются чаще, чем выходят
 * редакции продукта. Правка тарифа **не** меняет уже названные ориентиры —
 * заявка хранит снимок, и в этом весь его смысл; экран об этом говорит.
 */
function RepairTypes(): React.JSX.Element {
  const [types, setTypes] = useState<RepairType[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RepairType | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchRepairTypes()
      .then(setTypes)
      .catch((cause: unknown) => { setError(errorMessage(cause)); });
  }, []);

  return (
    <section className="panel panel--pad stack settings__panel">
      <div className="row row--between">
        <h2 className="t-h2">Типы ремонта</h2>
        <button type="button" className="btn btn--secondary" onClick={() => { setAdding(true); }}>
          Добавить тип
        </button>
      </div>
      <p className="t-sm t-muted prose">
        Тариф за квадратный метр общей площади и отклонение вилки. По ним считается ориентир
        на заявке до выезда. Правка тарифа не меняет уже названные ориентиры: заявка хранит
        снимок тарифа на момент расчёта — иначе правка справочника задним числом меняла бы
        цену, названную заказчику по телефону.
      </p>
      {error !== null && <p className="field__error" role="alert">{error}</p>}
      {types === null ? (
        <span className="skeleton skeleton--row" />
      ) : types.length === 0 ? (
        <p className="t-sm t-muted">Типов ремонта нет. Без них ориентир не посчитать.</p>
      ) : (
        <dl className="deflist">
          {types.map((type) => (
            <div className="deflist__row" key={type.id}>
              <dt className="deflist__term">{type.name}</dt>
              <dd className="deflist__value row row--wrap">
                <span className="num">{formatKopecks(BigInt(type.ratePerSqm))} за м²</span>
                <span className="t-sm t-muted num">± {formatPercent(BigInt(type.spread))}</span>
                <span className="t-sm t-muted">
                  {type.leads} {plural(type.leads, "заявка", "заявки", "заявок")}
                </span>
                <button
                  type="button"
                  className="btn btn--text"
                  onClick={() => { setEditing(type); }}
                >
                  Править
                </button>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {(adding || editing !== null) && (
        <RepairTypeSheet
          type={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={(next) => { setTypes(next); setAdding(false); setEditing(null); }}
        />
      )}
    </section>
  );
}

/** Лист типа ремонта. Тариф вводится рублями, хранится копейками. */
function RepairTypeSheet({
  type,
  onClose,
  onSaved,
}: {
  type: RepairType | null;
  onClose: () => void;
  onSaved: (types: RepairType[]) => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog<HTMLInputElement>(onClose);
  const [name, setName] = useState(type?.name ?? "");
  const [rate, setRate] = useState(
    type === null ? "" : (Number(type.ratePerSqm) / 100).toString().replace(".", ","),
  );
  const [spread, setSpread] = useState(
    type === null ? "15" : (type.spread / 100).toString().replace(".", ","),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const копейки = (значение: string): string | null => {
    const число = Number(значение.replace(",", ".").trim());
    if (!Number.isFinite(число) || число <= 0) return null;
    return Math.round(число * 100).toString();
  };
  const сотые = (значение: string): number | null => {
    const число = Number(значение.replace(",", ".").trim());
    if (!Number.isFinite(число) || число < 0 || число > 100) return null;
    return Math.round(число * 100);
  };

  const тариф = копейки(rate);
  const отклонение = сотые(spread);
  const ready = name.trim().length >= 2 && тариф !== null && отклонение !== null;

  const submit: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const поля = { name: name.trim(), ratePerSqm: тариф, spread: отклонение };
    (type === null ? createRepairType(поля) : updateRepairType(type.id, поля))
      .then(onSaved)
      .catch((cause: unknown) => { setError(errorMessage(cause)); })
      .finally(() => { setBusy(false); });
  };

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={type === null ? "Новый тип ремонта" : "Правка типа ремонта"}
        ref={dialog}
      >
        <p className="t-h3">{type === null ? "Новый тип ремонта" : type.name}</p>
        <form className="stack stack--tight" onSubmit={submit}>
          <label className="field">
            <span className="field__label">Название</span>
            <input
              ref={first}
              id="tariff-name"
              className="input"
              value={name}
              onChange={(event) => { setName(event.target.value); }}
            />
          </label>
          <label className="field">
            <span className="field__label">Тариф, ₽ за м²</span>
            <input
              id="tariff-rate"
              className="input num"
              inputMode="decimal"
              value={rate}
              onChange={(event) => { setRate(event.target.value); }}
            />
          </label>
          <label className="field">
            <span className="field__label">Отклонение вилки, %</span>
            <input
              id="tariff-spread"
              className="input num"
              inputMode="decimal"
              value={spread}
              onChange={(event) => { setSpread(event.target.value); }}
            />
            <span className="field__hint">
              Ориентир называется вилкой «от — до»: смета предварительная, и одно число
              заказчик запоминает как обещанное.
            </span>
          </label>
          {error !== null && <p className="field__error" role="alert">{error}</p>}
          <button
            type="submit"
            className="btn btn--primary btn--block btn--touch"
            data-loading={busy || undefined}
            disabled={busy || !ready}
          >
            Сохранить
          </button>
          <button type="button" className="btn btn--text btn--block" onClick={onClose}>
            Отмена
          </button>
        </form>
      </div>
    </>
  );
}
