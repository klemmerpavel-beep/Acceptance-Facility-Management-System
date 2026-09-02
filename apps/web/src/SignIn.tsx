import { useState } from "react";
import { requestMagicLink } from "./api.js";

/**
 * Вход по ссылке. Пароля нет, кода из СМС нет: заказчик не смог завершить
 * регистрацию в продукте-конкуренте, и барьер входа снят целиком.
 */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<{ token?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    void requestMagicLink(email)
      .then((result) => setSent({ ...(result.token !== undefined && { token: result.token }) }))
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setBusy(false));
  };

  return (
    <main className="container stack stack--loose">
      <div className="cover">
        <div className="container">
          <div className="cover__title">
            <h1 className="t-h1">Приёмка</h1>
          </div>
        </div>
      </div>

      {sent === null ? (
        <form className="panel panel--pad stack" onSubmit={submit} style={{ maxWidth: "var(--modal-w)" }}>
          <p className="t-h3">Вход</p>
          <label className="field">
            <span className="field__label">Почта</span>
            <input
              className="input"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="owner@dolgiy.studio"
            />
          </label>
          {error !== null && <p className="field__error">{error}</p>}
          <button className="btn btn--primary" type="submit" data-loading={busy || undefined}>
            Прислать ссылку
          </button>
        </form>
      ) : (
        <div className="panel panel--pad stack" style={{ maxWidth: "var(--modal-w)" }}>
          <p className="t-h3">Ссылка отправлена</p>
          <p className="t-sm t-muted">
            Откройте письмо и перейдите по ссылке. Ответ одинаков для существующего и
            несуществующего адреса — форма входа не проверяет, кто есть в системе.
          </p>
          {sent.token !== undefined && (
            // Вне промышленной среды ссылка показывается прямо здесь:
            // почтовый отправитель на стенде не настроен.
            <a
              className="btn btn--primary"
              href={`/api/auth/consume?token=${sent.token}`}
              onClick={() => window.setTimeout(onSignedIn, 300)}
            >
              Открыть ссылку входа
            </a>
          )}
        </div>
      )}
    </main>
  );
}
