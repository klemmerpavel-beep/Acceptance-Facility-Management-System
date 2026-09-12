import { useEffect, useId, useState } from "react";
import { завести } from "./verbs.js";
import { looksLikeCompany } from "@priyomka/domain";
import type { ClientRow, Foreman, ProjectSummary } from "@priyomka/contracts";
import {
  createClient, createProject, errorMessage, fetchClients, fetchForemen, fetchNextProjectCode,
} from "./api.js";
import { useModalDialog } from "./modal.js";

/**
 * Заведение объекта.
 *
 * Форма переделана 12.09.2026 по трём решениям заказчика. Прежняя
 * спрашивала код, адрес, заказчика и срок и объяснялась тем, что «форма из
 * восьми полей на входе стоит дороже, чем правка карточки потом». Довод
 * оказался неверным ровно наполовину: руководитель всё равно шёл в карточку
 * дописывать прораба и начало работ — сразу, тем же движением, — и второй
 * заход стоил дороже сэкономленного поля. Сэкономлено было не время, а
 * место в листе.
 *
 * **Номер объекта предлагается, а не спрашивается.** «Код объекта» было
 * понятием ниоткуда: человек, заводящий первый объект, не знает, откуда
 * берётся «R-42» и что будет, если написать другое. Теперь поле приходит
 * заполненным следующим свободным номером, подпись говорит «Номер объекта»,
 * а подсказка — откуда он взялся и что его можно изменить. Правило выбора
 * живёт в домене (`nextProjectCode`) и одинаково на сервере и в
 * демонстрации.
 *
 * **Заказчик набирается именем.** Выпадающий список был верен, пока
 * заказчиков четверо, и становится негодным на сороковом: искать «Ковалёву»
 * в списке медленнее, чем набрать «Кова». Поле осталось связанным со
 * справочником — совпадения предлагаются, — но имя, которого в справочнике
 * нет, не тупик: заказчик заводится тем же нажатием, без ухода в
 * «Контакты». Вид лица выводится из названия (`looksLikeCompany`), а не
 * спрашивается отдельным переключателем; реквизиты остаются за
 * «Контактами» — они нужны к счёту, а не к заведению.
 *
 * **Поля ведения собраны в свою группу и не свёрнуты.** Свернуть их значило
 * бы спрятать ровно то, что заказчик просил добавить. Группа с именем
 * делит форму по смыслу: «Объект» — чего без него нет, «Ведение» — что о
 * нём уже известно. Всё в группе «Ведение» необязательно, и объект, о
 * котором известны только адрес и заказчик, заводится ровно как раньше.
 *
 * Бригада в форму не вошла, и это ограничение, а не недосмотр: бригада в
 * схеме связана с этапом графика, а не с объектом, и назначить её на объект
 * нельзя без правки схемы базы. Правка схемы — отдельное решение заказчика.
 */

/** Номер объекта: буква, дефис, цифры. То же выражение, что в контракте. */
const НОМЕР = /^[A-ZА-Я]-\d{1,4}$/u;

/** Надбавка сопровождения по умолчанию — 12,00 %, как значение в базе. */
const НАДБАВКА_ПО_УМОЛЧАНИЮ = "12";

/** Проценты в базисные пункты: 12,5 % → 1250. В продукте доля всегда целая. */
const вПункты = (проценты: string): number => Math.round(Number(проценты) * 100);

const ключ = (имя: string): string => имя.trim().toLocaleLowerCase("ru-RU");

export function NewProjectSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (project: ProjectSummary) => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog<HTMLInputElement>(onClose);
  const список = useId();
  const [clients, setClients] = useState<ClientRow[] | null>(null);
  const [foremen, setForemen] = useState<readonly Foreman[]>([]);
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [clientName, setClientName] = useState("");
  const [deadline, setDeadline] = useState("");
  const [foremanId, setForemanId] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [keys, setKeys] = useState("0");
  const [supervision, setSupervision] = useState(НАДБАВКА_ПО_УМОЛЧАНИЮ);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchClients()
      .then((rows) => { setClients(rows); })
      .catch((cause: unknown) => { setError(errorMessage(cause)); });
    /* Прорабов может не быть вовсе — организация из одного руководителя:
       это не отказ, поле просто останется с единственным «Не назначен». */
    void fetchForemen().then(setForemen).catch(() => { setForemen([]); });
    /* Номер приходит последним и не мешает набору: если человек успел
       вписать свой, предложение его не затирает. */
    void fetchNextProjectCode()
      .then((предложенный) => {
        if (предложенный !== null) setCode((своё) => (своё === "" ? предложенный : своё));
      })
      .catch(() => { /* Не предложили — номер назовёт человек. */ });
  }, []);

  const набрано = clientName.trim();
  const найден = (clients ?? []).find((client) => ключ(client.name) === ключ(набрано));
  const новый = набрано.length >= 2 && найден === undefined;

  const номерГоден = НОМЕР.test(code.trim().toUpperCase());
  const ready = номерГоден && address.trim().length >= 3 && набрано.length >= 2;

  const submit: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);

    /* Заказчик заводится до объекта и только когда его нет: объект без
       заказчика не бьётся ни со сметой, ни со счётом, и порядок здесь не
       вопрос удобства. Код заказчика назначает сервер. */
    const опознаватель: Promise<string> = найден !== undefined
      ? Promise.resolve(найден.id)
      : createClient({
          name: набрано,
          isCompany: looksLikeCompany(набрано),
          requisites: null,
        }).then((справочник) => {
          setClients(справочник);
          const заведённый = справочник.find((client) => ключ(client.name) === ключ(набрано));
          if (заведённый === undefined) throw new Error("Заказчик заведён, но не найден в справочнике.");
          return заведённый.id;
        });

    void опознаватель
      .then((clientId) => createProject({
        code: code.trim().toUpperCase(),
        address: address.trim(),
        clientId,
        deadline: deadline === "" ? null : deadline,
        foremanId: foremanId === "" ? null : foremanId,
        startedAt: startedAt === "" ? null : startedAt,
        keysCount: Number(keys),
        supervisionShare: вПункты(supervision),
      }))
      .then(onCreated)
      .catch((cause: unknown) => { setError(errorMessage(cause)); })
      .finally(() => { setBusy(false); });
  };

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div
        className="sheet sheet--tall"
        role="dialog"
        aria-modal="true"
        aria-label="Новый объект"
        ref={dialog}
      >
        <p className="t-h3">Новый объект</p>

        <form className="stack stack--tight" onSubmit={submit}>
          <fieldset className="formgroup">
            <legend className="formgroup__legend">Объект</legend>

            <label className="field">
              <span className="field__label">Номер объекта</span>
              <input
                ref={first}
                className="input"
                value={code}
                maxLength={6}
                placeholder="R-42"
                aria-invalid={code !== "" && !номерГоден}
                onChange={(event) => { setCode(event.target.value); }}
              />
              <span className="field__hint">
                Предложен следующий свободный — его можно изменить. Номер сквозной: он же в теме
                письма с чеками, в акте и в разговоре на объекте.
              </span>
            </label>

            <label className="field">
              <span className="field__label">Адрес</span>
              <input
                className="input"
                value={address}
                maxLength={200}
                placeholder="Московский проспект 116, кв. 12"
                onChange={(event) => { setAddress(event.target.value); }}
              />
            </label>

            <label className="field">
              <span className="field__label">Заказчик</span>
              <input
                className="input"
                list={список}
                value={clientName}
                maxLength={120}
                placeholder="Ирина Ковалёва"
                autoComplete="off"
                onChange={(event) => { setClientName(event.target.value); }}
              />
              {/* Подсказка списком, а не выбор из него: набранное имя,
                  которого в справочнике нет, остаётся годным ответом. */}
              <datalist id={список}>
                {(clients ?? []).map((client) => (
                  <option key={client.id} value={client.name}>{client.code}</option>
                ))}
              </datalist>
              <span className="field__hint">
                Начните набирать — совпадения из справочника предложатся.
              </span>
            </label>

            {новый && (
              <p className="newclient">
                <span>
                  Такого заказчика в справочнике нет — он будет заведён:{" "}
                  <strong>{набрано}</strong>,{" "}
                  {looksLikeCompany(набрано) ? "юридическое лицо" : "физическое лицо"}.
                </span>
                <span className="t-muted">Реквизиты для счёта добавляются в «Контактах».</span>
              </p>
            )}

            <label className="field">
              <span className="field__label">Срок сдачи</span>
              <input
                type="date"
                className="input"
                value={deadline}
                onChange={(event) => { setDeadline(event.target.value); }}
              />
              <span className="field__hint">Необязательно: срок часто уточняют после замера.</span>
            </label>
          </fieldset>

          <fieldset className="formgroup">
            <legend className="formgroup__legend">Ведение</legend>

            <label className="field">
              <span className="field__label">Прораб</span>
              <span className="selectwrap">
                <select
                  className="input"
                  value={foremanId}
                  onChange={(event) => { setForemanId(event.target.value); }}
                >
                  <option value="">Не назначен</option>
                  {foremen.map((прораб) => (
                    <option key={прораб.id} value={прораб.id}>{прораб.name}</option>
                  ))}
                </select>
                <svg className="icon selectwrap__chevron" aria-hidden="true"><use href="#i-chevron" /></svg>
              </span>
            </label>

            <label className="field">
              <span className="field__label">Начало работ</span>
              <input
                type="date"
                className="input"
                value={startedAt}
                onChange={(event) => { setStartedAt(event.target.value); }}
              />
              <span className="field__hint">
                Не дата заведения: день, когда бригада выходит на объект.
              </span>
            </label>

            <div className="formrow">
              <label className="field">
                <span className="field__label">Ключи</span>
                <input
                  type="number"
                  className="input input--num"
                  value={keys}
                  min={0}
                  max={99}
                  onChange={(event) => { setKeys(event.target.value); }}
                />
                <span className="field__hint">Комплектов на руках.</span>
              </label>

              <label className="field">
                <span className="field__label">Сопровождение, %</span>
                <input
                  type="number"
                  className="input input--num"
                  value={supervision}
                  min={0}
                  max={100}
                  step={0.5}
                  onChange={(event) => { setSupervision(event.target.value); }}
                />
                <span className="field__hint">Надбавка к работам в смете.</span>
              </label>
            </div>
          </fieldset>

          {error !== null && <p className="field__error" role="alert">{error}</p>}

          <button
            type="submit"
            className="btn btn--primary btn--block"
            data-loading={busy || undefined}
            disabled={busy || !ready}
          >
            {завести("объект")}
          </button>
          <button type="button" className="btn btn--text btn--block" onClick={onClose}>
            Отмена
          </button>
        </form>
      </div>
    </>
  );
}
