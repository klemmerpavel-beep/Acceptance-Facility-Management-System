-- Чеки на материалы: расход по объекту с подтверждением руководителем.
--
-- Новая таблица, миграция безоговорочна: существующих строк она не трогает.
--
-- Отдельно от `other_expenses`: та означает строку импортированной сметы без
-- объёма, её пишет только парсер книги. Смешать их значило бы смешать «цену в
-- смете» и «деньги, потраченные по факту».

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ExpenseKind" AS ENUM ('MATERIALS', 'DELIVERY', 'TOOLS', 'OTHER');

-- CreateTable
CREATE TABLE "material_expenses" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "kind" "ExpenseKind" NOT NULL,
    "amount" BIGINT NOT NULL,
    "reimbursable" BOOLEAN NOT NULL DEFAULT true,
    "seller" TEXT NOT NULL,
    "spentAt" DATE NOT NULL,
    "sectionId" UUID,
    "note" TEXT,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedById" UUID,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "material_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "material_expenses_storageKey_key" ON "material_expenses"("storageKey");

-- CreateIndex
CREATE INDEX "material_expenses_projectId_spentAt_idx" ON "material_expenses"("projectId", "spentAt");

-- AddForeignKey
ALTER TABLE "material_expenses" ADD CONSTRAINT "material_expenses_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Раздел сметы: расход переживает удаление раздела, теряя привязку, а не
-- исчезая вместе с ним. Деньги потрачены независимо от того, что стало со
-- строкой сметы.
ALTER TABLE "material_expenses" ADD CONSTRAINT "material_expenses_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "estimate_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_expenses" ADD CONSTRAINT "material_expenses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_expenses" ADD CONSTRAINT "material_expenses_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
