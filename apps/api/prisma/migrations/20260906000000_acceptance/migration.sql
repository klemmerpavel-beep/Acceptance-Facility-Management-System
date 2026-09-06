-- AlterTable
ALTER TABLE "work_stages" ADD COLUMN     "brigadeId" UUID,
ADD COLUMN     "sectionId" UUID;

-- CreateTable
CREATE TABLE "acceptance_batches" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "sectionId" UUID NOT NULL,
    "brigadeId" UUID NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,

    CONSTRAINT "acceptance_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acceptances" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "qty" BIGINT NOT NULL,
    "reason" TEXT,
    "reversesId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wage_accruals" (
    "id" UUID NOT NULL,
    "acceptanceId" UUID NOT NULL,
    "brigadeId" UUID NOT NULL,
    "unitWage" BIGINT NOT NULL,
    "amount" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wage_accruals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acceptance_photos" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "uploadedById" UUID,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acceptance_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "acceptance_batches_projectId_createdAt_idx" ON "acceptance_batches"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "acceptances_reversesId_key" ON "acceptances"("reversesId");

-- CreateIndex
CREATE INDEX "acceptances_itemId_idx" ON "acceptances"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "wage_accruals_acceptanceId_key" ON "wage_accruals"("acceptanceId");

-- CreateIndex
CREATE INDEX "wage_accruals_brigadeId_createdAt_idx" ON "wage_accruals"("brigadeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "acceptance_photos_storageKey_key" ON "acceptance_photos"("storageKey");

-- CreateIndex
CREATE INDEX "acceptance_photos_batchId_idx" ON "acceptance_photos"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "work_stages_sectionId_key" ON "work_stages"("sectionId");

-- AddForeignKey
ALTER TABLE "work_stages" ADD CONSTRAINT "work_stages_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "estimate_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_stages" ADD CONSTRAINT "work_stages_brigadeId_fkey" FOREIGN KEY ("brigadeId") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acceptance_batches" ADD CONSTRAINT "acceptance_batches_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acceptance_batches" ADD CONSTRAINT "acceptance_batches_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "estimate_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acceptance_batches" ADD CONSTRAINT "acceptance_batches_brigadeId_fkey" FOREIGN KEY ("brigadeId") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acceptance_batches" ADD CONSTRAINT "acceptance_batches_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "acceptance_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "estimate_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "acceptances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wage_accruals" ADD CONSTRAINT "wage_accruals_acceptanceId_fkey" FOREIGN KEY ("acceptanceId") REFERENCES "acceptances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wage_accruals" ADD CONSTRAINT "wage_accruals_brigadeId_fkey" FOREIGN KEY ("brigadeId") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acceptance_photos" ADD CONSTRAINT "acceptance_photos_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "acceptance_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acceptance_photos" ADD CONSTRAINT "acceptance_photos_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

