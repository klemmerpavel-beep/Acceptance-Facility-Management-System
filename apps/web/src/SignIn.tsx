import { useState } from "react";
import { parsePhone } from "@priyomka/domain";
import { confirmSmsCode, requestSmsCode } from "./api.js";

/**
 * Вход по номеру телефона в два шага.
 *
 * Пароля нет: заказчик не смог завершить регистрацию в продукте-конкуренте,
 * и барьер входа снят до одного номера и одного кода. Прораб не входит и
 * так — у него персональная ссылка, без номера и кода.
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

  const request = (event: React.FormEvent): void => {
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
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setBusy(false));
  };

  const confirm = (event: React.FormEvent): void => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    void confirmSmsCode(phone, code)
      // Сессия ставится кукой; приложение перечитывает её само.
      // Перезагрузка страницы здесь была бы лишней: она стирает
      // состояние и в демонстрационной сборке возвращает на тот же экран.
      .then(onSignedIn)
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setBusy(false));
  };

  return (
    <main className="signin">
      <div className="signin__brand">
        <svg className="icon" aria-hidden="true"><use href="#i-acceptance" /></svg>
        <span className="t-h3">Приёмка</span>
      </div>

      {step === null ? (
        <form className="signin__form stack" onSubmit={request}>
          <h1 className="t-h1 signin__title">Вход или регистрация</h1>
          <label className="field">
            <span className="field__label field__label--cap">Введите номер телефона</span>
            <div className="signin__phone">
              <span className="selectwrap">
                <select className="input" aria-label="Страна" defaultValue="Россия">
                  <option>Россия</option>
                </select>
                <svg className="icon selectwrap__chevron" aria-hidden="true"><use href="#i-chevron" /></svg>
              </span>
              <input
                className="input input--tel"
                type="tel"
                autoComplete="tel"
                required
                value={phone}
                onChange={(event) => { setPhone(event.target.value); setError(null); }}
                placeholder="+7 (___) ___-__-__"
              />
            </div>
          </label>
          {error !== null && <p className="field__error" role="alert">{error}</p>}
          <div className="signin__actions">
            <button className="btn btn--primary" type="submit" data-loading={busy || undefined}>
              Продолжить
            </button>
          </div>
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
              value={code}
              onChange={(event) => { setCode(event.target.value.replace(/\D/gu, "").slice(0, 6)); setError(null); }}
              placeholder="000000"
            />
          </label>
          {error !== null && <p className="field__error" role="alert">{error}</p>}
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
