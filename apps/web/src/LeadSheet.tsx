import { useEffect, useState } from "react";
import type { LeadCard, LeadStage, ProjectEvent, RepairType } from "@priyomka/contracts";
import { formatKopecks, formatPercent } from "@priyomka/ui";
import {
  addLeadTask, errorMessage, fetchLeadEvents, fetchRepairTypes, loseLead, setLeadTask, updateLead,
} from "./api.js";
import { EventFeed } from "./Dashboard.js";
import { ConvertLeadSheet } from "./ConvertLeadSheet.js";
import { useModalDialog } from "./modal.js";
import { formatDate } from "./status.js";

const STAGES: readonly { stage: LeadStage; label: string }[] = [
  { stage: "FIRST_CONTACT", label: "Первичный контакт" },
  { stage: "MEETING", label: "Знакомство" },
  { stage: "DECIDING", label: "Принимают решение" },
  { stage: "CONTRACT", label: "Согласование договора" },
];

/**
 * Лист заявки.
 *
 * Стадия меняется списком, а не перетаскиванием карточки: перетаскивание
 * недоступно с клавиатуры, на телефоне тянуть некуда, а стадию меняют реже,
 * чем смотрят на неё.
 *
 * Ориентир считается сервером и приходит готовой вилкой: считать его здесь
 * значило бы завести вторую формулу цены, которая разойдётся с первой.
 */
export function LeadSheet({
  lead,
  onClose,
  onChanged,
  onOpenProject,
}: {
  lead: LeadCard;
  onClose: () => void;
  onChanged: (lead: LeadCard) => void;
  onOpenProject: (code: string) => void;
}): React.JSX.Element {
  const { dialog, first } = useModalDialog<HTMLSelectElement>(onClose);
  const [types, setTypes] = useState<RepairType[] | null>(null);
  const [events, setEvents] = useState<ProjectEvent[] | null>(null);
  const [area, setArea] = useState(
    lead.guideline === null ? "" : (Number(lead.guideline.area) / 1000).toString().replace(".", ","),
  );
  const [typeId, setTypeId] = useState(lead.repairTypeId ?? "");
  const [title, setTitle] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [reason, setReason] = useState("");
  const [losing, setLosing] = useState(false);
  const [converting, setConverting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRepairTypes()
      .then(setTypes)
      .catch((cause: unknown) => { setError(errorMessage(cause)); });
  }, []);

  /* Журнал перечитывается после каждой правки: стадия и ориентир пишутся в
     него, и лента, застывшая на состоянии открытия листа, врала бы. */
  useEffect(() => {
    fetchLeadEvents(lead.id)
      .then(setEvents)
      .catch(() => { setEvents([]); });
  }, [lead]);

  const открыта = lead.outcome === "OPEN";

  const запрос = (обещание: Promise<LeadCard>): void => {
    setBusy(true);
    setError(null);
    обещание
      .then(onChanged)
      .catch((cause: unknown) => { setError(errorMessage(cause)); })
      .finally(() => { setBusy(false); });
  };

  /* Площадь вводится в метрах с запятой, хранится тысячными: тот же разбор,
     что у количеств сметы и величин обмера. */
  const тысячные = (значение: string): string | null => {
    const число = Number(значение.replace(",", ".").trim());
    if (!Number.isFinite(число) || число <= 0) return null;
    return Math.round(число * 1000).toString();
  };

  const считатьОриентир = (nextTypeId: string, nextArea: string): void => {
    const площадь = тысячные(nextArea);
    if (nextTypeId === "" || площадь === null) {
      запрос(updateLead(lead.id, { repairTypeId: null, area: null }));
      return;
    }
    запрос(updateLead(lead.id, { repairTypeId: nextTypeId, area: площадь }));
  };

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} />
      <div
        className="sheet sheet--tall"
        role="dialog"
        aria-modal="true"
        aria-label={`Заявка № ${lead.number}`}
        ref={dialog}
      >
        <p className="t-h3">
          № {lead.number} · {lead.name}
        </p>
        <p className="t-sm t-secondary">
          {lead.phone} · обращение {formatDate(lead.createdAt.slice(0, 10))}
          {lead.address === null ? "" : ` · ${lead.address}`}
        </p>
        {lead.note !== null && <p className="t-sm t-muted">{lead.note}</p>}

        {lead.outcome === "WON" && lead.projectCode !== null && (
          <p className="toast" role="status">
            <span className="pill pill--ok">Выиграна</span>
            <button
              type="button"
              className="btn btn--text"
              onClick={() => { onOpenProject(lead.projectCode ?? ""); }}
            >
              Открыть объект {lead.projectCode}
            </button>
          </p>
        )}
        {lead.outcome === "LOST" && (
          <p className="toast" role="status">
            <span className="pill">Отказ</span>
            <span className="t-sm">{lead.lostReason}</span>
          </p>
        )}

        {открыта && (
          <label className="field">
            <span className="field__label">Стадия воронки</span>
            <span className="selectwrap">
              <select
                ref={first}
                id="lead-stage"
                className="input"
                value={lead.stage}
                disabled={busy}
                onChange={(event) => {
                  запрос(updateLead(lead.id, { stage: event.target.value as LeadStage }));
                }}
              >
                {STAGES.map((stage) => (
                  <option key={stage.stage} value={stage.stage}>{stage.label}</option>
                ))}
              </select>
              <svg className="icon selectwrap__chevron" aria-hidden="true"><use href="#i-chevron" /></svg>
            </span>
          </label>
        )}

        <section className="stack stack--tight">
          <p className="t-cap">Ориентир цены</p>
          <label className="field">
            <span className="field__label">Тип ремонта</span>
            <span className="selectwrap">
              <select
                id="lead-type"
                className="input"
                value={typeId}
                disabled={busy || !открыта || types === null}
                onChange={(event) => {
                  setTypeId(event.target.value);
                  считатьОриентир(event.target.value, area);
                }}
              >
                <option value="">не выбран</option>
                {(types ?? []).map((type) => (
                  <option key={type.id} value={type.id}>{type.name}</option>
                ))}
              </select>
              <svg className="icon selectwrap__chevron" aria-hidden="true"><use href="#i-chevron" /></svg>
            </span>
          </label>
          <label className="field">
            <span className="field__label">Общая площадь, м²</span>
            <input
              id="lead-area"
              className="input num"
              inputMode="decimal"
              value={area}
              disabled={busy || !открыта}
              onChange={(event) => { setArea(event.target.value); }}
              onBlur={() => { считатьОриентир(typeId, area); }}
            />
            <span className="field__hint">
              По документам, со слов заказчика: ориентир нужен на первом звонке, до выезда.
            </span>
          </label>
          {lead.guideline === null ? (
            <p className="t-sm t-muted">
              Ориентир не посчитан: назовите тип ремонта и площадь.
            </p>
          ) : (
            <>
              <p className="t-h3 num">
                {formatKopecks(BigInt(lead.guideline.low))} — {formatKopecks(BigInt(lead.guideline.high))}
              </p>
              {/* Снимок называется прямо: тариф в справочнике могли уже
                  поправить, и человек должен видеть, по какому числу
                  названа вилка. */}
              <p className="t-sm t-muted">
                {formatKopecks(BigInt(lead.guideline.rate))} за м² ±
                {formatPercent(BigInt(lead.guideline.spread))} · {lead.guideline.typeName}
              </p>
              {открыта && (
                <button
                  type="button"
                  className="btn btn--text"
                  disabled={busy}
                  onClick={() => { считатьОриентир(typeId, area); }}
                >
                  Пересчитать по действующему тарифу
                </button>
              )}
            </>
          )}
        </section>

        <section className="stack stack--tight">
          <p className="t-cap">Задачи</p>
          {lead.tasks.length === 0 && <p className="t-sm t-muted">Задач нет.</p>}
          {lead.tasks.map((task) => (
            <label key={task.id} className="checkline">
              <input
                type="checkbox"
                className="checkbox"
                checked={task.state === "выполнена"}
                disabled={busy}
                onChange={(event) => {
                  запрос(setLeadTask(lead.id, task.id, { done: event.target.checked }));
                }}
              />
              <span className="t-sm">{task.title}</span>
              <span className={task.state === "просрочена" ? "pill pill--danger" : "pill"}>
                {task.state === "просрочена" ? "просрочена " : ""}
                {formatDate(task.dueOn)}
              </span>
            </label>
          ))}
          {открыта && (
            <div className="row row--wrap">
              <input
                id="lead-task-title"
                className="input"
                value={title}
                placeholder="Что сделать"
                onChange={(event) => { setTitle(event.target.value); }}
              />
              <input
                id="lead-task-due"
                className="input"
                type="date"
                value={dueOn}
                onChange={(event) => { setDueOn(event.target.value); }}
              />
              <button
                type="button"
                className="btn btn--secondary"
                disabled={busy || title.trim().length < 2 || dueOn === ""}
                onClick={() => {
                  запрос(addLeadTask(lead.id, { title: title.trim(), dueOn }));
                  setTitle("");
                  setDueOn("");
                }}
              >
                Добавить
              </button>
            </div>
          )}
        </section>

        {error !== null && <p className="field__error" role="alert">{error}</p>}

        {открыта && !losing && (
          <div className="stack stack--tight">
            <button
              type="button"
              className="btn btn--primary btn--block btn--touch"
              disabled={busy}
              onClick={() => { setConverting(true); }}
            >
              Превратить в объект
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--block"
              disabled={busy}
              onClick={() => { setLosing(true); }}
            >
              Отказ
            </button>
          </div>
        )}

        {losing && (
          <div className="stack stack--tight">
            <label className="field">
              <span className="field__label">Причина отказа</span>
              <input
                id="lead-loss-reason"
                className="input"
                value={reason}
                onChange={(event) => { setReason(event.target.value); }}
                placeholder="Дорого, выбрали другого, отложили"
              />
              <span className="field__hint">
                Обязательна: отказ без причины ничему не учит.
              </span>
            </label>
            <button
              type="button"
              className="btn btn--primary btn--block"
              disabled={busy || reason.trim().length < 3}
              onClick={() => {
                запрос(loseLead(lead.id, { reason: reason.trim() }));
                setLosing(false);
              }}
            >
              Закрыть отказом
            </button>
            <button type="button" className="btn btn--text btn--block" onClick={() => { setLosing(false); }}>
              Не закрывать
            </button>
          </div>
        )}

        {/* Журнал заявки: кто и когда менял стадию, ориентир и исход.
            Записи писались с первого дня, но читать их было негде. */}
        {events !== null && events.length > 0 && (
          <section className="stack stack--tight">
            <p className="t-cap">Журнал заявки</p>
            <EventFeed events={events} showCode={false} />
          </section>
        )}

        <button type="button" className="btn btn--text btn--block" onClick={onClose}>
          Закрыть
        </button>
      </div>

      {converting && (
        <ConvertLeadSheet
          lead={lead}
          onClose={() => { setConverting(false); }}
          onConverted={(next) => { setConverting(false); onChanged(next); }}
        />
      )}
    </>
  );
}
