-- CreateEnum
CREATE TYPE "TrancheStatus" AS ENUM ('OPEN', 'CLOSED', 'PAID');

-- AlterTable
ALTER TABLE "acceptance_batches" ADD COLUMN     "trancheId" UUID;

-- CreateTable
CREATE TABLE "tranches" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" "TrancheStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "comment" TEXT,
    "createdById" UUID,

    CONSTRAINT "tranches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tranches_projectId_status_idx" ON "tranches"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tranches_projectId_number_key" ON "tranches"("projectId", "number");

-- CreateIndex
CREATE INDEX "acceptance_batches_trancheId_idx" ON "acceptance_batches"("trancheId");

-- AddForeignKey
ALTER TABLE "acceptance_batches" ADD CONSTRAINT "acceptance_batches_trancheId_fkey" FOREIGN KEY ("trancheId") REFERENCES "tranches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tranches" ADD CONSTRAINT "tranches_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tranches" ADD CONSTRAINT "tranches_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

