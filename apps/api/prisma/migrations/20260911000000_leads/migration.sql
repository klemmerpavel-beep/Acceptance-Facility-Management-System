-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('FIRST_CONTACT', 'MEETING', 'DECIDING', 'CONTRACT');

-- CreateEnum
CREATE TYPE "LeadOutcome" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateTable
CREATE TABLE "repair_types" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ratePerSqm" BIGINT NOT NULL,
    "spread" INTEGER NOT NULL DEFAULT 1500,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "repair_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT,
    "note" TEXT,
    "stage" "LeadStage" NOT NULL DEFAULT 'FIRST_CONTACT',
    "outcome" "LeadOutcome" NOT NULL DEFAULT 'OPEN',
    "lostReason" TEXT,
    "repairTypeId" UUID,
    "area" BIGINT,
    "rateSnapshot" BIGINT,
    "spreadSnapshot" INTEGER,
    "clientId" UUID,
    "projectId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_tasks" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "dueOn" DATE NOT NULL,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repair_types_orgId_name_key" ON "repair_types"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "leads_projectId_key" ON "leads"("projectId");

-- CreateIndex
CREATE INDEX "leads_orgId_stage_idx" ON "leads"("orgId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "leads_orgId_number_key" ON "leads"("orgId", "number");

-- CreateIndex
CREATE INDEX "lead_tasks_leadId_idx" ON "lead_tasks"("leadId");

-- AddForeignKey
ALTER TABLE "repair_types" ADD CONSTRAINT "repair_types_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_repairTypeId_fkey" FOREIGN KEY ("repairTypeId") REFERENCES "repair_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

