-- Этап Э11, шаг 2, миграция М-3: адрес поверхности и источник подстановки
-- у позиции сметы (ADR-0002, п. 3, раздел «Решения шага 2», пп. 5–8;
-- docs/discovery/MIGRATION.md, раздел 3.1 с припиской 20.11.2026).
--
-- Адрес — вид поверхности и стена (решение Д4; Э11-2.5 «а»). Таблицы
-- поверхностей нет: величины поверхности выводит домен.
--
-- Источник подстановки (решение Э11-2.7 «в»): строка перечня с областью
-- ("qtySource"), подставленное число ("qtySourceValue") и помещение и стена
-- источника. Признак «обмер изменился» не хранится — домен сравнивает
-- подставленное число с величиной источника сейчас. Количество позиции
-- по-прежнему копия и не пересчитывается.
--
-- Все ссылки — SET NULL, как "roomId" позиции: смета не вправе запрещать
-- правку обмера. Пустая ссылка при заданной области источника — «источник
-- удалён»; прямое удаление стены с позициями служба замера предваряет
-- отказом с числом позиций.
--
-- Переноса данных нет (MIGRATION.md, 3.4): у всех прежних строк адрес и
-- источник пусты — источник прежде не хранился, и вывод адреса из единицы
-- или наименования был бы догадкой. Количества не меняются. Компенсация —
-- удаление шести столбцов и перечисления: теряются адреса, источники и
-- признак, количества остаются.

-- CreateEnum
CREATE TYPE "SurfaceKind" AS ENUM ('FLOOR', 'CEILING', 'WALLS', 'WALL', 'REVEALS');

-- AlterTable
ALTER TABLE "estimate_items" ADD COLUMN     "qtySource" TEXT,
ADD COLUMN     "qtySourceRoomId" UUID,
ADD COLUMN     "qtySourceValue" BIGINT,
ADD COLUMN     "qtySourceWallId" UUID,
ADD COLUMN     "surfaceKind" "SurfaceKind",
ADD COLUMN     "wallId" UUID;

-- CreateIndex
CREATE INDEX "estimate_items_wallId_idx" ON "estimate_items"("wallId");

-- CreateIndex
CREATE INDEX "estimate_items_qtySourceRoomId_idx" ON "estimate_items"("qtySourceRoomId");

-- CreateIndex
CREATE INDEX "estimate_items_qtySourceWallId_idx" ON "estimate_items"("qtySourceWallId");

-- AddForeignKey
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_wallId_fkey" FOREIGN KEY ("wallId") REFERENCES "measure_walls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_qtySourceRoomId_fkey" FOREIGN KEY ("qtySourceRoomId") REFERENCES "measure_rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_qtySourceWallId_fkey" FOREIGN KEY ("qtySourceWallId") REFERENCES "measure_walls"("id") ON DELETE SET NULL ON UPDATE CASCADE;
