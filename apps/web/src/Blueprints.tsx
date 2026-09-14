import { useEffect, useState } from "react";
import type { BlueprintRow } from "@priyomka/contracts";
import { formatKopecks } from "@priyomka/ui";
import { deleteBlueprint, errorMessage, fetchBlueprints } from "./api.js";
import { plural } from "./status.js";

/**
 * Типовые сметы организации.
 *
 * Слово «шаблон» в продукте занято дважды — эталонной книгой выгрузки и
 * шаблонами документов, — и третьего значения ему не даётся: одно слово на
 * одну вещь.
 *
 * Правки внутри заготовки здесь нет, и это не пропуск. Заготовка, которую
 * правят внутри себя, расходится со всеми сметами, из которых вышла, и
 * через месяц никто не скажет, какая из них верна. Новая заготовка
 * заводится из очередного объекта — это и есть правка.
 */
export function Blueprints(): React.JSX.Element {
  const [строки, setСтроки] = useState<readonly BlueprintRow[] | null>(null);
  const [ошибка, setОшибка] = useState<string | null>(null);
  const [занят, setЗанят] = useState(false);

  useEffect(() => {
    void fetchBlueprints()
      .then(setСтроки)
      .catch((cause: unknown) => { setОшибка(errorMessage(cause)); });
  }, []);

  const снять = (строка: BlueprintRow): void => {
    setЗанят(true);
    setОшибка(null);
    void deleteBlueprint(строка.id)
      .then(setСтроки)
      .catch((cause: unknown) => { setОшибка(errorMessage(cause)); })
      .finally(() => { setЗанят(false); });
  };

  return (
    <section className="panel panel--pad stack settings__panel">
      <div className="stack stack--tight">
        <h2 className="t-h2">Типовые сметы</h2>
        <p className="prose t-secondary">
          Заготовка под повторяющийся вид ремонта: разделы, наименования, единицы, цены,
          ставки и количества. Заводится из готовой сметы объекта кнопкой «Сохранить
          как типовую» на вкладке сметы, применяется к объекту, у которого сметы ещё нет.
        </p>
      </div>

      {ошибка !== null && <p className="field__error" role="alert">{ошибка}</p>}

      {строки === null && <p className="t-secondary">Загрузка…</p>}

      {строки !== null && строки.length === 0 && (
        <div className="empty">
          <p className="empty__title">Типовых смет пока нет</p>
          <p className="empty__text">
            Откройте объект с готовой сметой и сохраните её как типовую — она встанет сюда.
          </p>
        </div>
      )}

      {строки !== null && строки.length > 0 && (
        <ul className="stack stack--tight blueprints">
          {строки.map((строка) => (
            <li className="blueprint" key={строка.id}>
              <div className="stack stack--tight">
                <p className="t-h3">{строка.name}</p>
                <p className="t-sm t-muted">
                  {строка.positions} {plural(строка.positions, "позиция", "позиции", "позиций")}
                  {" · "}
                  {строка.sections} {plural(строка.sections, "раздел", "раздела", "разделов")}
                  {строка.sourceCode !== null && ` · из ${строка.sourceCode}`}
                </p>
              </div>
              <p className="num blueprint__total">{formatKopecks(BigInt(строка.works))}</p>
              <button
                type="button"
                className="btn btn--text"
                disabled={занят}
                onClick={() => { снять(строка); }}
              >
                Снять
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
