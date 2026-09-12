import type { ProjectSummary } from "@priyomka/contracts";
import { due } from "./due.js";
import { STATUS_LABEL, STATUS_PILL } from "./status.js";
import { ОБЛОЖКА_СТАТУСА } from "./coverTone.js";

/**
 * Плитка объекта.
 *
 * Объект узнают в лицо. Строка ведомости называет объект кодом и адресом —
 * двумя строками, которые у соседних объектов отличаются одной цифрой и
 * одним словом; снимок отличает их мгновенно. Поэтому портфель читается
 * галереей, а не таблицей: экран отвечает на вопрос «где что происходит», а
 * не «сколько это стоит».
 *
 * Ссылка растянута на всю плитку псевдоэлементом, а сама плитка ссылкой не
 * является. Иначе пилюля статуса, которая открывает лист смены, оказалась бы
 * кнопкой внутри ссылки — разметкой недопустимой и ломающей обход с
 * клавиатуры. Приём даёт цель нажатия во всю площадь и оставляет внутри
 * плитки место для собственных органов: они поднимаются над растяжкой
 * порядком наложения.
 *
 * Объект без снимков получает подложку, а не пустую рамку и не чужую
 * картинку: подложка выглядит подложкой и несёт код — то единственное, что
 * о таком объекте известно наверняка. Тон подложки — тон статуса, из тех же
 * токенов, которыми красится пилюля рядом: два разных вида одного состояния
 * на одной плитке сообщали бы о разнице, которой нет.
 */
export function ObjectTile({
  project,
  today,
  coverUrl,
  onOpen,
  onStatus,
}: {
  project: ProjectSummary;
  today: string;
  /** Адрес снимка обложки. `null` — снимков у объекта нет, рисуется подложка. */
  coverUrl: string | null;
  onOpen: (project: ProjectSummary) => void;
  /** Смена статуса прямо из портфеля. Нет обработчика — нет и органа. */
  onStatus?: (project: ProjectSummary) => void;
}): React.JSX.Element {
  const срок = due(project.deadline, today);
  const пилюля = (
    <span className={STATUS_PILL[project.status]}>{STATUS_LABEL[project.status]}</span>
  );

  return (
    <div className="objecttile">
      <span className={ОБЛОЖКА_СТАТУСА[project.status]}>
        {coverUrl === null ? (
          /* Подложка, а не изображение-заглушка: «битая картинка» в галерее
             читается как поломка продукта, а не как отсутствие снимка. */
          <span className="objecttile__plate" aria-hidden="true">{project.code}</span>
        ) : (
          <img
            className="objecttile__photo"
            src={coverUrl}
            alt=""
            loading="lazy"
          />
        )}
      </span>

      <span className="objecttile__body">
        <span className="objecttile__head">
          <span className="code-badge">{project.code}</span>
          {onStatus === undefined ? пилюля : (
            <button
              type="button"
              className="pillbutton objecttile__status"
              onClick={() => { onStatus(project); }}
              aria-label={`Статус объекта ${project.code}: ${STATUS_LABEL[project.status]}. Изменить`}
            >
              {пилюля}
            </button>
          )}
        </span>

        <a
          className="objecttile__link t-h3"
          href={`#${project.code}`}
          title={project.address}
          onClick={(event) => { event.preventDefault(); onOpen(project); }}
        >
          {project.address}
        </a>

        {/* Отсутствующее не называется в каждой плитке: восемь подряд
            «прораб не назначен» — шум, из-за которого не видно плиток, где
            прораб есть. */}
        <span className="t-sm t-secondary objecttile__who">
          {project.client.name}
          {project.foreman !== null && ` · ${project.foreman.name}`}
        </span>

        <span className="objecttile__foot">
          <span className={срок.pill}>{срок.words}</span>
          {project.readiness !== null && (
            <span className="objecttile__ready">
              <span className="objecttile__track" aria-hidden="true">
                <span
                  className="objecttile__fill"
                  style={{ inlineSize: `${String(Math.min(100, project.readiness / 100))}%` }}
                />
              </span>
              <span className="t-cap objecttile__pct num">
                {(project.readiness / 100).toFixed(0)}%
              </span>
            </span>
          )}
        </span>
      </span>
    </div>
  );
}
