import { useCallback, useEffect, useState } from "react";
import type { ClientRow, InviteUser, PersonRow, Role } from "@priyomka/contracts";
import { errorMessage, fetchPeople, invitePerson, relinkPerson, revokePerson } from "./api.js";
import { Announce } from "./Announce.js";
import { завести } from "./verbs.js";

/**
 * Люди организации: кто имеет вход и с какой ролью.
 *
 * **Самостоятельной регистрации в продукте нет** — решение заказчика от
 * 13.09.2026. Человека заводит руководитель и передаёт ему личную ссылку.
 * Формы «зарегистрироваться» на экране входа поэтому тоже нет: показанная
 * форма, которая ничего не заводит, обещает работу, которой не существует.
 *
 * Ссылка показывается один раз после заведения и не хранится: она равна
 * доступу, и место ей в переписке руководителя, а не в перечне на экране.
 * Потерялась — выдаётся новая, прежняя остаётся одноразовой.
 */

const РОЛИ: Readonly<Record<Role, string>> = {
  OWNER: "Руководитель",
  FOREMAN: "Прораб",
  CLIENT: "Заказчик",
};

const ЧТО_ВИДИТ: Readonly<Record<Role, string>> = {
  OWNER: "весь продукт",
  FOREMAN: "свои объекты: замер, смета, приёмка, чеки, отчёт",
  CLIENT: "свой объект: ход работ, смета и бумаги",
};

export function People({ clients }: { clients: readonly ClientRow[] }): React.JSX.Element {
  const [rows, setRows] = useState<PersonRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [объявление, setОбъявление] = useState<string | null>(null);
  /* Выданная ссылка живёт в состоянии экрана и исчезает при перезагрузке:
     хранить её значило бы держать доступ там, где его видно мимоходом. */
  const [ссылка, setСсылка] = useState<{ имя: string; адрес: string } | null>(null);
  const [заводим, setЗаводим] = useState(false);

  const load = useCallback(() => {
    fetchPeople()
      .then((next) => { setRows(next); setError(null); })
      .catch((cause: unknown) => { setError(errorMessage(cause)); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const адресСсылки = (token: string): string =>
    `${window.location.origin}/api/auth/consume?token=${token}`;

  const пригласить = (input: InviteUser): void => {
    setBusy(true);
    invitePerson(input)
      .then((выдано) => {
        setСсылка({ имя: input.name, адрес: адресСсылки(выдано.token) });
        setЗаводим(false);
        setError(null);
        setОбъявление(`${РОЛИ[input.role]} «${input.name}» заведён, ссылка выдана`);
        load();
      })
      .catch((cause: unknown) => { setError(errorMessage(cause)); })
      .finally(() => { setBusy(false); });
  };

  const выдатьЗаново = (row: PersonRow): void => {
    setBusy(true);
    relinkPerson(row.id)
      .then((выдано) => {
        setСсылка({ имя: row.name, адрес: адресСсылки(выдано.token) });
        setError(null);
        setОбъявление(`Новая ссылка для «${row.name}» выдана`);
      })
      .catch((cause: unknown) => { setError(errorMessage(cause)); })
      .finally(() => { setBusy(false); });
  };

  const снять = (row: PersonRow): void => {
    setBusy(true);
    revokePerson(row.id)
      .then((next) => {
        setRows(next);
        setError(null);
        setОбъявление(`Доступ «${row.name}» снят`);
      })
      .catch((cause: unknown) => { setError(errorMessage(cause)); })
      .finally(() => { setBusy(false); });
  };

  if (rows === null) return <p className="t-sm t-muted">Загружаем людей…</p>;

  return (
    <div className="stack stack--loose">
      <Announce text={объявление} />

      <div className="section-head">
        <h2 className="t-h2">Люди</h2>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={() => { setЗаводим(true); setСсылка(null); }}
        >
          {завести("человек")}
        </button>
      </div>

      <p className="t-sm t-muted">
        Вход в систему выдаёт руководитель: самостоятельной регистрации нет. Человек получает
        личную ссылку, она действует ограниченное время и обменивается на вход один раз.
      </p>

      {error !== null && <p className="field__error" role="alert">{error}</p>}

      {ссылка !== null && (
        <div className="invite">
          <p className="t-strong">Ссылка для «{ссылка.имя}»</p>
          <p className="t-sm t-muted">
            Передайте её лично. Ссылка показывается один раз: она равна доступу, и на экране не
            хранится. Потерялась — выдайте новую.
          </p>
          <code className="invite__link">{ссылка.адрес}</code>
          <button
            type="button"
            className="btn btn--text"
            onClick={() => { setСсылка(null); }}
          >
            Скрыть ссылку
          </button>
        </div>
      )}

      <ul className="records">
        {rows.map((row) => (
          <li className="record" key={row.id}>
            <span className="pill">{РОЛИ[row.role]}</span>
            <div className="record__body">
              <p className="record__head">
                <span className="t-strong">{row.name}</span>
                {row.entered
                  ? <span className="pill pill--ok">Входил</span>
                  : <span className="pill pill--warn">Ещё не входил</span>}
              </p>
              <p className="t-sm t-muted">
                {row.email ?? row.phone ?? "без способа входа"}
                {row.client !== null && ` · заказчик ${row.client}`}
              </p>
              <p className="t-sm t-muted">Видит: {ЧТО_ВИДИТ[row.role]}</p>
            </div>
            <div className="record__side">
              <span className="record__actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={busy}
                  onClick={() => { выдатьЗаново(row); }}
                >
                  Выдать ссылку
                </button>
                <button
                  type="button"
                  className="btn btn--text"
                  disabled={busy}
                  onClick={() => { снять(row); }}
                >
                  Снять доступ
                </button>
              </span>
            </div>
          </li>
        ))}
      </ul>

      {заводим && (
        <InviteSheet
          clients={clients}
          busy={busy}
          onSave={пригласить}
          onClose={() => { setЗаводим(false); setError(null); }}
        />
      )}
    </div>
  );
}

/** Лист заведения человека. Роль выбирается первой: от неё зависят поля. */
function InviteSheet({
  clients, busy, onSave, onClose,
}: {
  clients: readonly ClientRow[];
  busy: boolean;
  onSave: (input: InviteUser) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("FOREMAN");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [clientId, setClientId] = useState("");

  const заказчик = role === "CLIENT";
  const можно = name.trim() !== ""
    && (email.trim() !== "" || phone.trim() !== "")
    && (!заказчик || clientId !== "");

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Новый человек">
      <div className="sheet__body stack stack--tight">
        <h2 className="t-h2">{завести("человек")}</h2>

        <label className="field">
          <span className="field__label">Имя</span>
          <input className="input" value={name} onChange={(e) => { setName(e.target.value); }} />
        </label>

        <label className="field">
          <span className="field__label">Роль</span>
          <select
            className="input"
            value={role}
            onChange={(e) => { setRole(e.target.value as Role); setClientId(""); }}
          >
            <option value="FOREMAN">Прораб</option>
            <option value="CLIENT">Заказчик</option>
            <option value="OWNER">Руководитель</option>
          </select>
          <span className="field__hint">{ЧТО_ВИДИТ[role]}</span>
        </label>

        {заказчик && (
          <label className="field">
            <span className="field__label">Чей заказчик</span>
            <select
              className="input"
              value={clientId}
              onChange={(e) => { setClientId(e.target.value); }}
            >
              <option value="">Выберите запись справочника</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
            <span className="field__hint">
              По этой записи и определяется, какие объекты он видит.
            </span>
          </label>
        )}

        <label className="field">
          <span className="field__label">Почта</span>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); }}
          />
        </label>

        <label className="field">
          <span className="field__label">Телефон</span>
          <input
            className="input"
            type="tel"
            value={phone}
            onChange={(e) => { setPhone(e.target.value); }}
          />
          <span className="field__hint">Хотя бы одно из двух: по ним человек и входит.</span>
        </label>

        <p className="t-sm t-muted">
          По заведении сразу выдаётся личная ссылка входа — передайте её человеку.
        </p>

        <div className="sheet__actions">
          <button type="button" className="btn btn--secondary" onClick={onClose}>Отмена</button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || !можно}
            onClick={() => {
              onSave({
                name: name.trim(),
                role,
                email: email.trim() === "" ? null : email.trim(),
                phone: phone.trim() === "" ? null : phone.trim(),
                clientId: заказчик ? clientId : null,
              });
            }}
          >
            {завести("человек")}
          </button>
        </div>
      </div>
    </div>
  );
}
