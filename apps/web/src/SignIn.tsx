import { useState } from "react";
import { parsePhone } from "@priyomka/domain";
import { confirmSmsCode, requestSmsCode, errorMessage } from "./api.js";

/**
 * Вход по номеру телефона в два шага.
 *
 * Пароля нет: заказчик не смог завершить регистрацию в продукте-конкуренте,
 * и барьер входа снят до одного номера и одного кода. Прораб не входит и
 * так — у него персональная ссылка, без номера и кода.
 *
 * **Регистрации на этом экране нет.** Доступ выдаёт руководитель: он заводит
 * человека в настройках и передаёт личную ссылку (решение заказчика от
 * 13.09.2026). Экран это и говорит — форма, которая ничего не заводит,
 * обещает работу, которой не существует.
 *
 * Правила номера берутся из доменного слоя, а не переписываются здесь:
 * иначе клиент и сервер разойдутся на второй правке. Проверка на клиенте
 * нужна только затем, чтобы не гонять заведомо неверный номер на сервер.
 */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }): React.JSX.Element {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<{ shown: string; code?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const request: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const parsed = parsePhone(phone);
    if (!parsed.ok) { setError(parsed.message); return; }

    setBusy(true);
    setError(null);
    void requestSmsCode(phone)
      .then((issued) => {
        setStep({ shown: issued.phone, ...(issued.code !== undefined && { code: issued.code }) });
        setCode("");
      })
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setBusy(false));
  };

  const confirm: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    void confirmSmsCode(phone, code)
      // Сессия ставится кукой; приложение перечитывает её само.
      // Перезагрузка страницы здесь была бы лишней: она стирает
      // состояние и в демонстрационной сборке возвращает на тот же экран.
      .then(onSignedIn)
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <main className="signin">
      <div className="signin__brand">
        {/* Знак тот же, что в шапке. Прежде вход ставил рядом со словом
            #i-acceptance — рабочий значок отметки позиции, который на экране
            приёмки повторяется девять раз подряд: знаком продукта он быть не
            может. */}
        <svg className="icon" aria-hidden="true"><use href="#i-mark" /></svg>
        <span className="signin__lockup">
          <span className="t-h3">Приёмка</span>
          <span className="signin__org">DOLGIY STUDIO</span>
        </span>
      </div>

      {step === null ? (
        <form className="signin__form stack" onSubmit={request}>
          {/* Заголовок называет то, что экран делает. «Вход или регистрация»
              обещал форму заведения, которой нет и не будет: доступ выдаёт
              руководитель личной ссылкой (решение заказчика от 13.09.2026).
              Обещанная и отсутствующая работа — тот же дефект, по которому
              с обзора был снят почтовый адрес чеков. */}
          <h1 className="t-h1 signin__title">Вход</h1>
          <label className="field">
            <span className="field__label field__label--cap">Номер телефона, код страны +7</span>
            {/* Список стран из одного пункта — орган управления без выбора:
                он занимает место, ловит фокус и ничего не решает. Код страны
                показан приставкой поля (Д-26). */}
            <div className="signin__phone">
              <span className="signin__prefix">+7</span>
              <input
                className="input input--tel"
                type="tel"
                autoComplete="tel"
                required
                aria-describedby={error === null ? undefined : "signin-error"}
                aria-invalid={error === null ? undefined : true}
                value={phone}
                onChange={(event) => { setPhone(event.target.value); setError(null); }}
                onBlur={() => {
                  // Проверка после потери фокуса, а не только на отправке:
                  // иначе о неверном формате узнают на последнем шаге.
                  if (phone.trim() === "") return;
                  const parsed = parsePhone(phone);
                  if (!parsed.ok) setError(parsed.message);
                }}
                placeholder="900 000-00-00"
              />
            </div>
          </label>
          {error !== null && <p className="field__error" id="signin-error" role="alert">{error}</p>}
          <div className="signin__actions">
            <button className="btn btn--primary" type="submit" data-loading={busy || undefined}>
              Продолжить
            </button>
          </div>
          {/* Тому, кому доступ не выдали, сказано, что делать. Прежде экран
              молчал об этом и предлагал «регистрацию», которой нет. */}
          <p className="t-sm t-muted signin__note">
            Доступ выдаёт руководитель: он заводит человека в настройках и передаёт личную
            ссылку. Если ссылки нет — обратитесь к нему.
          </p>
        </form>
      ) : (
        <form className="signin__form stack" onSubmit={confirm}>
          <h1 className="t-h1 signin__title">Код подтверждения</h1>
          <label className="field">
            <span className="field__label field__label--cap">Отправлен на {step.shown}</span>
            <input
              className="input signin__code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              required
              aria-describedby={error === null ? undefined : "code-error"}
              aria-invalid={error === null ? undefined : true}
              value={code}
              onChange={(event) => { setCode(event.target.value.replace(/\D/gu, "").slice(0, 6)); setError(null); }}
              placeholder="000000"
            />
          </label>
          {error !== null && <p className="field__error" id="code-error" role="alert">{error}</p>}
          {step.code !== undefined && (
            // На стенде отправщик сообщений не подключён, поэтому код
            // показывается здесь. Перед пилотом меняется отправщик, экран нет.
            <p className="field__hint">
              Код на стенде: <span className="num">{step.code}</span>
            </p>
          )}
          <div className="signin__actions">
            <button
              className="btn btn--text"
              type="button"
              onClick={() => { setStep(null); setError(null); }}
            >
              Изменить номер
            </button>
            <button className="btn btn--primary" type="submit" data-loading={busy || undefined}>
              Войти
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
