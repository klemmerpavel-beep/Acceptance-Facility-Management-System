-- Шаблоны документов организации: договоры и дополнительные соглашения с
-- переменными.
--
-- Новые таблицы — миграция безоговорочна: существующих строк она не трогает.
--
-- Акта среди видов нет намеренно. Акт есть представление закрытого транша и
-- собирается из принятых позиций; шаблоном он не правится, иначе редактируемый
-- текст смог бы вынести ставку оплаты труда в клиентский документ.

-- CreateEnum
CREATE TYPE "TemplateKind" AS ENUM ('CONTRACT', 'ANNEX', 'OTHER');

-- CreateTable
CREATE TABLE "document_templates" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TemplateKind" NOT NULL DEFAULT 'CONTRACT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_clauses" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "document_clauses_pkey" PRIMARY KEY ("id")
);

-- Имя шаблона уникально в организации: два «Договора подряда» в списке
-- неразличимы, и выбирают из них наугад.
CREATE UNIQUE INDEX "document_templates_orgId_name_key" ON "document_templates"("orgId", "name");

-- CreateIndex
CREATE INDEX "document_clauses_templateId_order_idx" ON "document_clauses"("templateId", "order");

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Пункт без шаблона не существует: удаление шаблона уносит его пункты.
ALTER TABLE "document_clauses" ADD CONSTRAINT "document_clauses_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "document_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
