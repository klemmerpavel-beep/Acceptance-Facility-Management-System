-- Этап Э11, шаг 2, миграция М-1: стены помещения (ADR-0002, п. 1;
-- docs/discovery/MIGRATION.md, раздел 3.1; решения заказчика 20.11.2026).
--
-- Стена — длина и необязательная высота: пустая высота значит «как у
-- помещения», и правка высоты помещения переходит на такие стены сама.
-- Величины — тысячные доли метра, как у помещения. Площадь стены брутто и
-- нетто не хранится: её выводит домен.
--
-- Каскад с помещением — как у итогов проёмов: стена без помещения ничего не
-- значит. Переноса данных нет (MIGRATION.md, 3.4): прежние помещения стен не
-- получают и считаются по четырём величинам, как на шаге 1, — длины стен не
-- измерялись, и разложить периметр на стены нечем.
--
-- Компенсация миграцией вперёд — удаление таблицы (MIGRATION.md, 3.3), в
-- обратном порядке после М-3 и М-2.

-- CreateTable
CREATE TABLE "measure_walls" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "label" TEXT,
    "length" BIGINT NOT NULL,
    "height" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measure_walls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "measure_walls_roomId_order_idx" ON "measure_walls"("roomId", "order");

-- AddForeignKey
ALTER TABLE "measure_walls" ADD CONSTRAINT "measure_walls_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "measure_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
