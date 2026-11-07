import { useEffect, useState } from "react";
import type { OrganizationContacts, ProjectSummary } from "@priyomka/contracts";
import { errorMessage, fetchOrganizationContacts } from "./api.js";
import { пусто } from "./empty.js";

/**
 * Первый вход заказчика и «Как пользоваться» (этап Э8, ДР-11).
 *
 * Заказчик входил по ссылке и попадал в перечень объектов без единого
 * слова о том, что перед ним, чего от него ждут и кому звонить. Экран —
 * три блока текстом, без иллюстраций: что вы здесь видите, что нужно от
 * вас, как связаться. Показывается сам, пока у заказчика нет отметки
 * захода (решение допроса Э8-2), и повторно — из «Ещё → Как пользоваться».
 *
 * «Как связаться» — организация из настроек и имя прораба объекта без
 * телефона (решение допроса Э8-7): личный телефон сотрудника — его
 * персональные данные. Незаполненное называется словом словаря.
 */
export function ClientGuide({
  projects,
  onOpen,
}: {
  projects: readonly ProjectSummary[];
  onOpen: () => void;
}): React.JSX.Element {
  const [контакты, setКонтакты] = useState<OrganizationContacts | null>(null);
  const [ошибка, setОшибка] = useState<string | null>(null);
  useEffect(() => {
    fetchOrganizationContacts()
      .then(setКонтакты)
      .catch((cause: unknown) => { setОшибка(errorMessage(cause)); });
  }, []);

  const [один] = projects;
  const подпись = projects.length === 1 && один !== undefined
    ? `Объект ${один.code} · ${один.address}`
    : `Объекты: ${projects.map((project) => project.code).join(", ")}`;

  return (
    <main className="container stack stack--loose guide">
      {/* Заголовок — в обложке раздела: приветствие при первом входе,
          «Как пользоваться» при повторном открытии. */}
      {projects.length > 0 && <p className="t-sm t-muted">{подпись}</p>}

      <section className="guide__block stack stack--tight" aria-labelledby="guide-see">
        <h2 className="t-h3" id="guide-see">Что вы здесь видите</h2>
        <p className="t-sm"><b>Обзор</b> — состояние объекта и новое с прошлого входа: оно стоит первым блоком.</p>
        <p className="t-sm"><b>Работа</b> — этапы и сроки; «принято» — то, что прораб проверил на месте и отметил.</p>
        <p className="t-sm"><b>Смета</b> — позиции работ и итог для вас.</p>
        <p className="t-sm"><b>Отчёт</b> — снимки выполненной работы по дням.</p>
        <p className="t-sm"><b>Документы</b> — акты выполненных работ для печати.</p>
      </section>

      <section className="guide__block stack stack--tight" aria-labelledby="guide-need">
        <h2 className="t-h3" id="guide-need">Что нужно от вас</h2>
        <p className="t-sm">Смотреть ход работ, когда удобно: новое собирается в начале «Обзора».</p>
        <p className="t-sm">
          Подписывать акты на бумаге — их приносит прораб; отметка о подписи появится в «Документах».
        </p>
        <p className="t-sm">Ссылку для входа не пересылайте: она равна доступу к вашему объекту.</p>
      </section>

      <section className="guide__block stack stack--tight" aria-labelledby="guide-contact">
        <h2 className="t-h3" id="guide-contact">Как связаться</h2>
        {ошибка !== null && <p className="field__error" role="alert">{ошибка}</p>}
        {ошибка === null && контакты === null && <span className="skeleton skeleton--row" />}
        {контакты !== null && (
          <p className="t-sm">
            {контакты.name} · {контакты.phone ?? пусто("телефон")} · {контакты.email ?? пусто("почта")}
          </p>
        )}
        {projects.map((project) => (
          <p className="t-sm" key={project.code}>
            Прораб объекта {project.code}: {project.foreman?.name ?? пусто("прораб")}
          </p>
        ))}
      </section>

      <div>
        <button type="button" className="btn btn--primary" onClick={onOpen}>
          {projects.length === 1 ? "Перейти к объекту" : "Перейти к объектам"}
        </button>
      </div>
    </main>
  );
}
