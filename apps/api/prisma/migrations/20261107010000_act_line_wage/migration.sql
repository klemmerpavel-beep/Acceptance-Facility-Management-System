-- П-60, решение заказчика В-1 от 07.11.2026: «начислено» строки снимка
-- подписанного акта — сумма начислений приёмок строки (снимок ставки на день
-- приёмки, БП-3, с учётом сторно), а не ставка сметы на день подписи.
-- Ставка строки — снимок начислений, если у действующих приёмок строки он
-- один; ставку правили между приёмками — ставок несколько, и поле пусто.
-- Миграция только вперёд: строки, зафиксированные до неё, пересчитываются
-- из тех же начислений — тем же правилом, что фиксация (`actLineWage`).
-- AlterTable
ALTER TABLE "act_lines" ALTER COLUMN "unitWage" DROP NOT NULL,
ADD COLUMN     "wageTotal" BIGINT;

WITH "поСтавке" AS (
  SELECT b."trancheId", a."itemId", w."unitWage",
         SUM(a."qty") AS "qty", SUM(w."amount") AS "amount"
  FROM "wage_accruals" w
  JOIN "acceptances" a ON a."id" = w."acceptanceId"
  JOIN "acceptance_batches" b ON b."id" = a."batchId"
  WHERE b."trancheId" IS NOT NULL
  GROUP BY b."trancheId", a."itemId", w."unitWage"
), "строки" AS (
  SELECT "trancheId", "itemId", SUM("amount") AS "amount",
         COUNT(*) FILTER (WHERE "qty" <> 0) AS "действующих",
         MIN("unitWage") FILTER (WHERE "qty" <> 0) AS "действующая",
         COUNT(*) AS "всех",
         MIN("unitWage") AS "любая"
  FROM "поСтавке"
  GROUP BY "trancheId", "itemId"
)
UPDATE "act_lines" l
SET "wageTotal" = s."amount",
    "unitWage" = CASE
      WHEN s."действующих" = 1 THEN s."действующая"
      WHEN s."действующих" = 0 AND s."всех" = 1 THEN s."любая"
      ELSE NULL
    END
FROM "строки" s
WHERE l."trancheId" = s."trancheId" AND l."itemId" = s."itemId";

-- Строка без начислений — позиция снята или приёмки без начисления: ноль,
-- как в живом акте, и ставки нет.
UPDATE "act_lines" SET "wageTotal" = 0, "unitWage" = NULL WHERE "wageTotal" IS NULL;

ALTER TABLE "act_lines" ALTER COLUMN "wageTotal" SET NOT NULL;
