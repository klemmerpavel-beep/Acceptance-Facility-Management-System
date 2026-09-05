-- Этапы работ объекта: строки графика производства работ.
--
-- Первичный источник дат для экрана «Главная». Полоса плана во времени и
-- процент готовности объекта считаются отсюда, а не из срока договора:
-- `projects.startedAt` и `projects.deadline` — рамка обязательства, а
-- внутри неё идут штукатурка, электрика, плитка, каждая своим отрезком.
-- Выводить полосу плана из двух дат объекта значило бы рисовать одну
-- сплошную линию и называть её графиком.
--
-- Прогресс — INTEGER базисных пунктов, как `projects.supervisionShare`:
-- 5000 = 50,00 %. Доля с плавающей точкой не применяется по общему
-- правилу схемы. Величина заявленная, а не измеренная: приёмки в продукте
-- нет (стадия D), и до неё прогресс вносит руководитель. Экран обязан
-- называть её заявленной, иначе первое расхождение с фактом подорвёт
-- доверие к остальным числам.
--
-- Даты без времени (DATE, не TIMESTAMP): этап меряется днями, час начала
-- штукатурки в графике не показывается и храниться не должен.
--
-- Мастера у этапа нет намеренно. Исходный проект (docs/01_PROJECT.md)
-- закладывал `master_id`, но назначения и чужие задачи в объём не входят,
-- а колонка, которую некому заполнять, — это будущий столбец пустот.

-- CreateTable
CREATE TABLE "work_stages" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "work_stages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_stages_projectId_startsOn_idx" ON "work_stages"("projectId", "startsOn");

-- CreateIndex
CREATE UNIQUE INDEX "work_stages_projectId_name_key" ON "work_stages"("projectId", "name");

-- AddForeignKey
ALTER TABLE "work_stages" ADD CONSTRAINT "work_stages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
