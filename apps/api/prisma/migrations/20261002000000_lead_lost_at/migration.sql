-- Дата отказа заявки: от неё отсчитывается срок хранения персональных данных.
--
-- Ч. 7 ст. 21 152-ФЗ: данные уничтожаются в срок, не превышающий тридцати
-- дней с даты достижения цели обработки; для заявки цель отпадает с отказом
-- (полный аудит 30.09.2026, П-40, вариант «а» — 02.10.2026). Прежде дата отказа
-- жила только записью журнала; для уже отказных заявок она берётся оттуда,
-- а при отсутствии записи — датой последнего изменения заявки.
ALTER TABLE "leads" ADD COLUMN "lostAt" TIMESTAMP(3);

UPDATE "leads" AS l
SET "lostAt" = COALESCE(
  (SELECT MAX(a."at") FROM "audit_log" AS a
    WHERE a."entity" = 'Lead' AND a."entityId" = l."id"::text AND a."field" = 'отказ'),
  l."updatedAt")
WHERE l."outcome" = 'LOST';

-- Поиск заявок с истёкшим сроком идёт по исходу, отметке обезличивания и
-- дате отказа — одним индексом.
CREATE INDEX "leads_outcome_anonymizedAt_lostAt_idx" ON "leads"("outcome", "anonymizedAt", "lostAt");
