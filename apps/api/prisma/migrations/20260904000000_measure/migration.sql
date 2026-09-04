-- Обмерный план: помещения, проёмы, изображение плана объекта.
--
-- Величины хранятся BigInt тысячных долей единицы — той же идиомой, что
-- количества сметы: 18,40 м² → 18400, 2,70 м → 2700. Число с плавающей
-- точкой не применяется: площади отсюда становятся количествами позиций
-- сметы, а количества умножаются на цены.
--
-- Площадь стен и объём в таблицах отсутствуют. Они выводятся из четырёх
-- замеренных величин (packages/domain/src/measure.ts) и, будучи
-- сохранёнными, завели бы вторую правду о тех же числах, расходящуюся с
-- первой при первой же правке высоты.
--
-- Изображение плана — одно на объект: контур помещения не рисуется.
-- В базе только ключ файла, сам файл лежит в хранилище за портом
-- FileStorage.

-- CreateEnum
CREATE TYPE "OpeningKind" AS ENUM ('WINDOW', 'DOOR');

-- CreateTable
CREATE TABLE "measure_rooms" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "floorArea" BIGINT NOT NULL,
    "floorPerimeter" BIGINT NOT NULL,
    "ceilingPerimeter" BIGINT NOT NULL,
    "height" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measure_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measure_openings" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "kind" "OpeningKind" NOT NULL,
    "count" INTEGER NOT NULL,
    "area" BIGINT NOT NULL,
    "reveal" BIGINT NOT NULL,

    CONSTRAINT "measure_openings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measure_plans" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "uploadedById" UUID,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measure_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "measure_rooms_projectId_order_idx" ON "measure_rooms"("projectId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "measure_rooms_projectId_name_key" ON "measure_rooms"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "measure_openings_roomId_kind_key" ON "measure_openings"("roomId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "measure_plans_projectId_key" ON "measure_plans"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "measure_plans_storageKey_key" ON "measure_plans"("storageKey");

-- AddForeignKey
ALTER TABLE "measure_rooms" ADD CONSTRAINT "measure_rooms_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measure_openings" ADD CONSTRAINT "measure_openings_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "measure_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measure_plans" ADD CONSTRAINT "measure_plans_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measure_plans" ADD CONSTRAINT "measure_plans_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

