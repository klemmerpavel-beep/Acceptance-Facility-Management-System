-- Этап Э9, ДР-3: фиксация подписанного акта и поправки к нему.
-- Подписанный акт читается из снимка строк, а не из приёмок и текущих цен
-- сметы; ошибка в нём исправляется поправкой строкой акта текущего транша.
-- AlterTable
ALTER TABLE "tranches" ADD COLUMN     "fixedAt" TIMESTAMP(3),
ADD COLUMN     "fixedShare" INTEGER;

-- CreateTable
CREATE TABLE "act_lines" (
    "id" UUID NOT NULL,
    "trancheId" UUID NOT NULL,
    "itemId" UUID,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "qty" BIGINT NOT NULL,
    "unitPrice" BIGINT NOT NULL,
    "unitWage" BIGINT NOT NULL,

    CONSTRAINT "act_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "act_corrections" (
    "id" UUID NOT NULL,
    "actLineId" UUID NOT NULL,
    "trancheId" UUID NOT NULL,
    "qtyBefore" BIGINT NOT NULL,
    "qtyAfter" BIGINT NOT NULL,
    "priceBefore" BIGINT NOT NULL,
    "priceAfter" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "act_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "act_lines_trancheId_order_idx" ON "act_lines"("trancheId", "order");

-- CreateIndex
CREATE INDEX "act_corrections_trancheId_idx" ON "act_corrections"("trancheId");

-- CreateIndex
CREATE INDEX "act_corrections_actLineId_createdAt_idx" ON "act_corrections"("actLineId", "createdAt");

-- AddForeignKey
ALTER TABLE "act_lines" ADD CONSTRAINT "act_lines_trancheId_fkey" FOREIGN KEY ("trancheId") REFERENCES "tranches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "act_lines" ADD CONSTRAINT "act_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "estimate_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "act_corrections" ADD CONSTRAINT "act_corrections_actLineId_fkey" FOREIGN KEY ("actLineId") REFERENCES "act_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "act_corrections" ADD CONSTRAINT "act_corrections_trancheId_fkey" FOREIGN KEY ("trancheId") REFERENCES "tranches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "act_corrections" ADD CONSTRAINT "act_corrections_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Акты, подписанные до этой миграции, фиксируются ею — тем же сводом и по
-- тем же ценам, какими показывались в мгновение миграции: позиция одной
-- строкой с суммарным принятым количеством, цена и ставка — из сметы,
-- надбавка — действующей сметы объекта.
INSERT INTO "act_lines" ("id", "trancheId", "itemId", "order", "name", "unit", "qty", "unitPrice", "unitWage")
SELECT gen_random_uuid(), t."id", i."id",
       (ROW_NUMBER() OVER (PARTITION BY t."id" ORDER BY MIN(a."createdAt"), i."id") - 1)::INTEGER,
       i."name", u."code", SUM(a."qty"), i."unitPrice", i."unitWage"
FROM "tranches" t
JOIN "acceptance_batches" b ON b."trancheId" = t."id"
JOIN "acceptances" a ON a."batchId" = b."id"
JOIN "estimate_items" i ON i."id" = a."itemId"
JOIN "units" u ON u."id" = i."unitId"
WHERE t."signedAt" IS NOT NULL AND t."closedAt" IS NOT NULL
GROUP BY t."id", i."id", i."name", u."code", i."unitPrice", i."unitWage";

UPDATE "tranches" t
SET "fixedAt" = CURRENT_TIMESTAMP,
    "fixedShare" = COALESCE(
      (SELECT e."supervisionShare" FROM "estimates" e WHERE e."projectId" = t."projectId" ORDER BY e."version" DESC LIMIT 1),
      p."supervisionShare")
FROM "projects" p
WHERE p."id" = t."projectId" AND t."signedAt" IS NOT NULL AND t."closedAt" IS NOT NULL;
