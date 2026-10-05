import { useState } from "react";
import type { EventGroup, ProjectEvent, Role } from "@priyomka/contracts";
import { EventFeed } from "./Dashboard.js";

/**
 * Отбор ленты по видам (этап Э8, ДР-5): «Все · Приёмка · Деньги · Смета ·
 * График · Документы» — в «Событиях объекта» и в колоколе.
 *
 * С приёмками, платежами и чеками лента стала полной и потому длинной; шум
 * снимается отбором, а не умолчанием о событиях. Роль видит только пункты,
 * в которых у неё бывают записи: пункт, всегда пустой для роли, — обещание
 * событий, которых сервер ей не отдаст. Чеки — в «Приёмке» (решение допроса
 * Э8-6), в «Деньгах» — транши и платежи.
 */
const ПУНКТЫ: readonly { group: EventGroup; label: string }[] = [
  { group: "acceptance", label: "Приёмка" },
  { group: "money", label: "Деньги" },
  { group: "estimate", label: "Смета" },
  { group: "schedule", label: "График" },
  { group: "documents", label: "Документы" },
];

/** Какие пункты бывают у роли — по проекции ленты на сервере. */
const ПО_РОЛИ: Readonly<Record<Role, readonly EventGroup[]>> = {
  OWNER: ["acceptance", "money", "estimate", "schedule", "documents"],
  ACCOUNTANT: ["acceptance", "money", "estimate", "schedule", "documents"],
  FOREMAN: ["acceptance", "money", "estimate", "schedule"],
  CLIENT: ["estimate", "schedule"],
};

export function FilteredEventFeed({
  events,
  role,
  showCode = true,
}: {
  events: ProjectEvent[];
  role: Role;
  showCode?: boolean;
}): React.JSX.Element {
  const [группа, setГруппа] = useState<EventGroup | null>(null);
  const пункты = ПУНКТЫ.filter((пункт) => ПО_РОЛИ[role].includes(пункт.group));
  const отобрано = группа === null ? events : events.filter((событие) => событие.group === группа);
  return (
    <div className="stack stack--tight">
      <div className="segmented feedfilter" role="group" aria-label="Отбор событий по видам">
        <button
          type="button"
          className="segmented__option"
          aria-pressed={группа === null}
          onClick={() => { setГруппа(null); }}
        >
          Все
        </button>
        {пункты.map((пункт) => (
          <button
            key={пункт.group}
            type="button"
            className="segmented__option"
            aria-pressed={группа === пункт.group}
            onClick={() => { setГруппа(пункт.group); }}
          >
            {пункт.label}
          </button>
        ))}
      </div>
      {отобрано.length === 0
        ? <p className="t-sm t-muted">Событий этого вида пока нет.</p>
        : <EventFeed events={отобрано} showCode={showCode} />}
    </div>
  );
}
