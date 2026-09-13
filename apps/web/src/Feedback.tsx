import { useState } from "react";
import { useModalDialog } from "./modal.js";

/**
 * Приём замечаний по демонстрации.
 *
 * Орган показа, а не продукта. Демонстрация уходит заказчику ссылкой, и
 * замечания к ней до сих пор возвращались письмами и голосовыми: «на
 * третьем экране цифра непонятная» — без экрана, без ширины окна, без
 * даты. Виджет собирает то же замечание вместе с обстановкой, в которой
 * оно возникло, и складывает всё в одну таблицу.
 *
 * **Рисуется только в демонстрационной сборке** — её оболочкой
 * `main.demo.tsx`. В продукте его нет: там замечания идут прорабу и
 * руководителю в работу, а не в таблицу обзора.
 *
 * **Пока приёмник не настроен, виджета нет вовсе.** Кнопка, которая
 * открывает форму, которая ничего не отправляет, хуже отсутствия кнопки:
 * заказчик напишет замечание и будет считать его переданным. Правило
 * допуска (`07_IA.md`, раздел 7) запрещает показывать неработающее, и
 * пустой адрес приёмника означает «не готово».
 *
 * Обстановка снимается из разметки, а не передаётся состоянием: виджет
 * стоит рядом с продуктом, а не внутри него, и знать его состояние ему
 * незачем. Цена решения названа: имена узлов здесь повторены вторым местом
 * и разойдутся, если их переименовать. Взамен продукт не несёт ни одного
 * поля ради обзора, который закончится вместе с обзором.
 */

/**
 * Адрес приёмника — веб-приложение Apps Script, дописывающее строку в
 * Google-таблицу. Пусто — виджета нет вовсе.
 *
 * Берётся из переменной сборки `VITE_FEEDBACK_URL`, а не из исходного
 * текста. Довод не в тайне: веб-приложение развёрнуто с доступом «Все» —
 * иначе страница без сервера не смогла бы в него писать, — и адрес, который
 * обязан знать каждый посетитель, тайной не является. Довод в том, что
 * приёмник меняют без правки продукта: развернули заново — поменяли
 * переменную сборки, и ни одна строка кода не тронута.
 */
const ИЗ_СБОРКИ: unknown = import.meta.env.VITE_FEEDBACK_URL;
export const ПРИЁМНИК = typeof ИЗ_СБОРКИ === "string" ? ИЗ_СБОРКИ.trim() : "";

/** Приёмник ответил, но отказом: поле `ok` ложно или отсутствует. */
const неПринят = (итог: { ok?: boolean }): boolean => итог.ok !== true;

const ВИДЫ = [
  ["Идея", "что добавить или изменить"],
  ["Дефект", "что работает не так"],
  ["Вопрос", "что непонятно"],
] as const;

/** Где заказчик находился, когда писал. Читается из разметки. */
const обстановка = (): { section: string; project: string; tab: string; width: number } => {
  const текст = (узел: Element | null): string => (узел?.textContent ?? "").trim();
  return {
    section: текст(document.querySelector('[aria-current="page"]')),
    project: текст(document.querySelector(".stamp__value--code")),
    tab: текст(document.querySelector('[role="tab"][aria-selected="true"]')),
    width: window.innerWidth,
  };
};

export function Feedback(): React.JSX.Element | null {
  const [открыт, setОткрыт] = useState(false);
  if (ПРИЁМНИК === "") return null;
  return (
    <>
      <button
        type="button"
        className="btn btn--primary feedback__open"
        onClick={() => { setОткрыт(true); }}
      >
        <svg className="icon" aria-hidden="true"><use href="#i-request" /></svg>
        Замечание
      </button>
      {открыт && <FeedbackSheet onClose={() => { setОткрыт(false); }} />}
    </>
  );
}

function FeedbackSheet({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { dialog, first } = useModalDialog<HTMLTextAreaElement>(onClose);
  const [вид, setВид] = useState<string>(ВИДЫ[0][0]);
  const [текст, setТекст] = useState("");
  const [автор, setАвтор] = useState("");
  const [идёт, setИдёт] = useState(false);
  const [отказ, setОтказ] = useState<string | null>(null);
  const [принято, setПринято] = useState(false);

  const готово = текст.trim().length >= 5;

  const submit: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!готово || идёт) return;
    setИдёт(true);
    setОтказ(null);
    /* Тип содержимого — простой текст намеренно: иначе браузер шлёт
       предварительный запрос OPTIONS, а веб-приложение Apps Script на него
       не отвечает, и отправка не доходит вовсе. Разбирает тело всё равно
       наш же скрипт. */
    void fetch(ПРИЁМНИК, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ kind: вид, text: текст.trim(), author: автор.trim(), ...обстановка() }),
    })
      .then(async (ответ) => {
        if (!ответ.ok) throw new Error(`Приёмник ответил ${String(ответ.status)}.`);
        const итог = (await ответ.json()) as { ok?: boolean; error?: string };
        if (неПринят(итог)) throw new Error(итог.error ?? "Приёмник не принял сообщение.");
        setПринято(true);
      })
      .catch((причина: unknown) => {
        /* Отказ называется, а не проглатывается: замечание, которое
           заказчик считает отправленным, теряется молча. */
        setОтказ(причина instanceof Error
          ? `Не удалось отправить: ${причина.message}`
          : "Не удалось отправить: связь с приёмником не установлена.");
      })
      .finally(() => { setИдёт(false); });
  };

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Замечание по демонстрации"
        ref={dialog}
      >
        <p className="t-h3">Замечание по демонстрации</p>

        {принято ? (
          <div className="stack stack--tight">
            <p className="t-body">
              Записано. Замечание попало в таблицу вместе с экраном, на котором оно возникло.
            </p>
            <button type="button" className="btn btn--primary btn--block" onClick={onClose}>
              Готово
            </button>
          </div>
        ) : (
          <form className="stack stack--tight" onSubmit={submit}>
            <div className="field">
              <span className="field__label">Что это</span>
              <div className="segmented" role="group" aria-label="Вид замечания">
                {ВИДЫ.map(([имя, пояснение]) => (
                  <button
                    key={имя}
                    type="button"
                    className="segmented__option"
                    aria-pressed={вид === имя}
                    title={пояснение}
                    onClick={() => { setВид(имя); }}
                  >
                    {имя}
                  </button>
                ))}
              </div>
            </div>

            <label className="field">
              <span className="field__label">Замечание</span>
              <textarea
                ref={first}
                className="input feedback__text"
                value={текст}
                maxLength={4000}
                rows={5}
                placeholder="Что не так или чего не хватает"
                onChange={(event) => { setТекст(event.target.value); }}
              />
              <span className="field__hint">
                Экран, на котором Вы сейчас, прикладывается сам — называть его не нужно.
              </span>
            </label>

            <label className="field">
              <span className="field__label">Кто пишет</span>
              <input
                className="input"
                value={автор}
                maxLength={120}
                placeholder="Необязательно"
                onChange={(event) => { setАвтор(event.target.value); }}
              />
            </label>

            {отказ !== null && <p className="field__error" role="alert">{отказ}</p>}

            <button
              type="submit"
              className="btn btn--primary btn--block"
              data-loading={идёт || undefined}
              disabled={идёт || !готово}
            >
              Отправить
            </button>
            <button type="button" className="btn btn--text btn--block" onClick={onClose}>
              Отмена
            </button>
          </form>
        )}
      </div>
    </>
  );
}
