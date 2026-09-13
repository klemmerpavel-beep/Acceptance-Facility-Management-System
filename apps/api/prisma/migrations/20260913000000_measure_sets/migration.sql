-- Второй набор обмера: после перепланировки, рядом с начальным.
--
-- Значение по умолчанию делает миграцию безоговорочной: всё, что уже
-- обмерено, — обмер начальный, и ни одна строка не требует решения.

-- CreateEnum
CREATE TYPE "MeasureSet" AS ENUM ('INITIAL', 'REPLANNED');

-- AlterTable
ALTER TABLE "measure_rooms" ADD COLUMN "set" "MeasureSet" NOT NULL DEFAULT 'INITIAL';
ALTER TABLE "measure_plans" ADD COLUMN "set" "MeasureSet" NOT NULL DEFAULT 'INITIAL';

-- Ключи: имя помещения уникально внутри набора, а не внутри объекта.
-- «Санузел» есть и до перепланировки, и после — это одно помещение в двух
-- состояниях, а не ошибка замера.
DROP INDEX "measure_rooms_projectId_name_key";
DROP INDEX "measure_rooms_projectId_order_idx";
CREATE UNIQUE INDEX "measure_rooms_projectId_set_name_key" ON "measure_rooms"("projectId", "set", "name");
CREATE INDEX "measure_rooms_projectId_set_order_idx" ON "measure_rooms"("projectId", "set", "order");

-- План теперь один на набор, а не один на объект.
DROP INDEX "measure_plans_projectId_key";
CREATE UNIQUE INDEX "measure_plans_projectId_set_key" ON "measure_plans"("projectId", "set");
