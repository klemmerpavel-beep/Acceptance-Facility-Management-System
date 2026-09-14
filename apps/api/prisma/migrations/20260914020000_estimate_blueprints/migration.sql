-- Типовые сметы организации: заготовка под повторяющийся вид ремонта.
--
-- Слово «шаблон» в продукте занято дважды — эталонной книгой выгрузки и
-- шаблонами документов организации, — и третьего значения ему не даётся.
--
-- Устройство повторяет смету объекта без привязок к нему: дерево разделов,
-- позиции с единицей, ценой, ставкой и количеством. Помещений нет:
-- помещение принадлежит объекту, а не типу ремонта.

CREATE TABLE "estimate_blueprints" (
  "id"          UUID         NOT NULL,
  "orgId"       UUID         NOT NULL,
  "name"        TEXT         NOT NULL,
  "sourceCode"  TEXT,
  "createdById" UUID,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "estimate_blueprints_pkey" PRIMARY KEY ("id")
);

-- Имя уникально в организации: две «Типовые двушки» в списке неразличимы.
CREATE UNIQUE INDEX "estimate_blueprints_orgId_name_key"
  ON "estimate_blueprints"("orgId", "name");

CREATE TABLE "blueprint_sections" (
  "id"          UUID    NOT NULL,
  "blueprintId" UUID    NOT NULL,
  "parentId"    UUID,
  "name"        TEXT    NOT NULL,
  "order"       INTEGER NOT NULL,
  CONSTRAINT "blueprint_sections_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "blueprint_sections_blueprintId_order_idx"
  ON "blueprint_sections"("blueprintId", "order");

CREATE TABLE "blueprint_items" (
  "id"          UUID    NOT NULL,
  "blueprintId" UUID    NOT NULL,
  "sectionId"   UUID    NOT NULL,
  "unitId"      UUID    NOT NULL,
  "name"        TEXT    NOT NULL,
  "order"       INTEGER NOT NULL,
  "qty"         BIGINT  NOT NULL,
  "unitPrice"   BIGINT  NOT NULL,
  "unitWage"    BIGINT  NOT NULL DEFAULT 0,
  CONSTRAINT "blueprint_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "blueprint_items_blueprintId_order_idx"
  ON "blueprint_items"("blueprintId", "order");
CREATE INDEX "blueprint_items_sectionId_order_idx"
  ON "blueprint_items"("sectionId", "order");

ALTER TABLE "estimate_blueprints"
  ADD CONSTRAINT "estimate_blueprints_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "estimate_blueprints"
  ADD CONSTRAINT "estimate_blueprints_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "blueprint_sections"
  ADD CONSTRAINT "blueprint_sections_blueprintId_fkey"
  FOREIGN KEY ("blueprintId") REFERENCES "estimate_blueprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "blueprint_sections"
  ADD CONSTRAINT "blueprint_sections_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "blueprint_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "blueprint_items"
  ADD CONSTRAINT "blueprint_items_blueprintId_fkey"
  FOREIGN KEY ("blueprintId") REFERENCES "estimate_blueprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "blueprint_items"
  ADD CONSTRAINT "blueprint_items_sectionId_fkey"
  FOREIGN KEY ("sectionId") REFERENCES "blueprint_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Restrict: справочник единиц один на организацию, и единица, на которую
-- ссылается заготовка, не должна исчезать из него молча.
ALTER TABLE "blueprint_items"
  ADD CONSTRAINT "blueprint_items_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
