-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimates" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supervisionShare" INTEGER NOT NULL DEFAULT 1200,
    "declaredWorksTotal" BIGINT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estimates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimate_sections" (
    "id" UUID NOT NULL,
    "estimateId" UUID NOT NULL,
    "parentId" UUID,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "sourceRow" INTEGER,

    CONSTRAINT "estimate_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimate_items" (
    "id" UUID NOT NULL,
    "estimateId" UUID NOT NULL,
    "sectionId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "qty" BIGINT NOT NULL,
    "unitPrice" BIGINT NOT NULL,
    "unitWage" BIGINT NOT NULL DEFAULT 0,
    "sourceRow" INTEGER,

    CONSTRAINT "estimate_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "other_expenses" (
    "id" UUID NOT NULL,
    "estimateId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "unitPrice" BIGINT NOT NULL,
    "sourceRow" INTEGER,

    CONSTRAINT "other_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimate_imports" (
    "id" UUID NOT NULL,
    "estimateId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "importedById" UUID,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "positions" INTEGER NOT NULL,
    "sectionsTotal" INTEGER NOT NULL,
    "computedWorksTotal" BIGINT NOT NULL,
    "declaredWorksTotal" BIGINT,
    "worksTotalDelta" BIGINT,
    "report" JSONB NOT NULL,

    CONSTRAINT "estimate_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "units_orgId_code_key" ON "units"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "estimates_projectId_version_key" ON "estimates"("projectId", "version");

-- CreateIndex
CREATE INDEX "estimate_sections_estimateId_order_idx" ON "estimate_sections"("estimateId", "order");

-- CreateIndex
CREATE INDEX "estimate_items_estimateId_order_idx" ON "estimate_items"("estimateId", "order");

-- CreateIndex
CREATE INDEX "estimate_items_sectionId_order_idx" ON "estimate_items"("sectionId", "order");

-- CreateIndex
CREATE INDEX "other_expenses_estimateId_order_idx" ON "other_expenses"("estimateId", "order");

-- CreateIndex
CREATE INDEX "estimate_imports_estimateId_importedAt_idx" ON "estimate_imports"("estimateId", "importedAt");

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_sections" ADD CONSTRAINT "estimate_sections_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "estimates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_sections" ADD CONSTRAINT "estimate_sections_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "estimate_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "estimates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "estimate_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_expenses" ADD CONSTRAINT "other_expenses_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "estimates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_expenses" ADD CONSTRAINT "other_expenses_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_imports" ADD CONSTRAINT "estimate_imports_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "estimates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

