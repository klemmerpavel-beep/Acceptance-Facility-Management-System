-- Этап Э11, шаг 2, миграция М-2: проём на стене — одна запись на два
-- помещения (ADR-0002, п. 2; docs/discovery/MIGRATION.md, раздел 3.1).
--
-- Сторона А — стена "wallId", обязательна; сторона Б — стена соседнего
-- помещения "adjoiningWallId", необязательна: пока у соседа стен нет, проём
-- односторонний (решение Э11-2.2 «а»), и ссылки на помещение соседа нет.
-- Правило «обе стены — разных помещений одного объекта и одного набора» —
-- в службе замера с отказом 400: ограничений базы на это в хранилище нет.
--
-- Откосы сторон — измеренные величины, необязательны. Вид — прежнее
-- перечисление "OpeningKind" без новых значений.
--
-- "wallId" — каскад, "adjoiningWallId" — SET NULL. Каскад срабатывает только
-- для проёма без стороны Б: проём с привязанной стороной Б служба замера до
-- удаления стены стороны А передаёт соседу в той же транзакции (решение
-- Э11-2.3 «б»).
--
-- Поля "sillHeight" (высота от пола) из плана MIGRATION.md, 3.1 нет: в
-- расчёте шага 2 оно не участвует, а вводить ли его — вторая очередь допроса
-- (ADR-0002, раздел «Решения шага 2»). Понадобится — добавится миграцией
-- вперёд без потери данных.
--
-- Строки "measure_openings" не переводятся в отдельные проёмы: они хранят
-- количество, сумму площадей и сумму откосов без ширины, высоты и стены, и
-- перевод выдумал бы размеры (MIGRATION.md, 3.4). Компенсация — удаление
-- таблицы; итоги проёмов помещений без стен она не затрагивает.

-- CreateTable
CREATE TABLE "wall_openings" (
    "id" UUID NOT NULL,
    "wallId" UUID NOT NULL,
    "adjoiningWallId" UUID,
    "kind" "OpeningKind" NOT NULL,
    "width" BIGINT NOT NULL,
    "height" BIGINT NOT NULL,
    "reveal" BIGINT,
    "adjoiningReveal" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wall_openings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wall_openings_wallId_idx" ON "wall_openings"("wallId");

-- CreateIndex
CREATE INDEX "wall_openings_adjoiningWallId_idx" ON "wall_openings"("adjoiningWallId");

-- AddForeignKey
ALTER TABLE "wall_openings" ADD CONSTRAINT "wall_openings_wallId_fkey" FOREIGN KEY ("wallId") REFERENCES "measure_walls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wall_openings" ADD CONSTRAINT "wall_openings_adjoiningWallId_fkey" FOREIGN KEY ("adjoiningWallId") REFERENCES "measure_walls"("id") ON DELETE SET NULL ON UPDATE CASCADE;
