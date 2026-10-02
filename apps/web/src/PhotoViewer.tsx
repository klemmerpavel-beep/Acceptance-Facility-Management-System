import { useRef, useState } from "react";
import { useModalDialog } from "./modal.js";

/** Снимок для просмотра: адрес и подпись — раздел и дата. */
export interface СнимокПросмотра {
  readonly id: string;
  readonly src: string;
  readonly подпись: string;
}

/** Порог свайпа: короче — это касание, а не жест листания. */
const ПОРОГ_СВАЙПА = 40;

/**
 * Просмотр снимков дня во весь экран (план, пункт 7.7).
 *
 * Листание — стрелками ← и →, кнопками и свайпом; Esc закрывает. Фокус
 * держит `useModalDialog`: Tab не уходит за пределы окна, а после закрытия
 * возвращается к снимку коллажа, с которого просмотр открыли. Подпись
 * называет раздел и дату — то, по чему снимок ищут в отчёте.
 *
 * Снимки листаются по кругу: на объекте их смотрят подряд, и упор в
 * последний снимок заставлял бы возвращаться через весь день назад.
 */
export function PhotoViewer({
  снимки,
  начало,
  onClose,
}: {
  снимки: readonly СнимокПросмотра[];
  /** С какого снимка открыт просмотр. */
  начало: number;
  onClose: () => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog(onClose);
  const [номер, setНомер] = useState(начало);
  const откуда = useRef<number | null>(null);
  const всего = снимки.length;
  const снимок = снимки[номер];

  const листать = (шаг: number): void => {
    setНомер((текущий) => (текущий + шаг + всего) % всего);
  };

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть просмотр" onClick={onClose} />
      <div
        className="viewer"
        role="dialog"
        aria-modal="true"
        aria-label="Просмотр снимков"
        ref={dialog}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") { event.preventDefault(); листать(-1); }
          if (event.key === "ArrowRight") { event.preventDefault(); листать(1); }
        }}
        onPointerDown={(event) => { откуда.current = event.clientX; }}
        onPointerUp={(event) => {
          const начальная = откуда.current;
          откуда.current = null;
          if (начальная === null) return;
          const сдвиг = event.clientX - начальная;
          if (Math.abs(сдвиг) < ПОРОГ_СВАЙПА) return;
          листать(сдвиг < 0 ? 1 : -1);
        }}
      >
        <div className="viewer__bar">
          <p className="viewer__caption" aria-live="polite">
            {снимок?.подпись ?? ""}
            <span className="t-sm"> · {номер + 1} из {всего}</span>
          </p>
          <button ref={first} type="button" className="btn btn--secondary viewer__close" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <div className="viewer__stage">
          {снимок !== undefined && (
            <img className="viewer__photo" src={снимок.src} alt={снимок.подпись} draggable={false} />
          )}
        </div>
        {всего > 1 && (
          <div className="viewer__nav">
            <button
              type="button"
              className="btn btn--secondary viewer__prev"
              aria-label="Предыдущий снимок"
              onClick={() => { листать(-1); }}
            >
              <svg className="icon" aria-hidden="true"><use href="#i-back" /></svg>
            </button>
            <button
              type="button"
              className="btn btn--secondary viewer__next"
              aria-label="Следующий снимок"
              onClick={() => { листать(1); }}
            >
              <svg className="icon" aria-hidden="true"><use href="#i-crumb" /></svg>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
