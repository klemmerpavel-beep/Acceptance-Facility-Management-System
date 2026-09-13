-- Три рабочие роли: руководитель, прораб, заказчик.
--
-- `SUPPLY` снята: она была объявлена в схеме и защищена проекцией, но входа не
-- имела ни на одном экране (дефект А-7 аудита). Объявленная и не выданная роль
-- обещает доступ, которого нет.
--
-- Перечисление пересоздаётся, а не правится по месту: PostgreSQL не удаляет
-- значение перечисления. Приведение падает, если хоть одна строка несёт
-- 'SUPPLY' — и это верное поведение: молча превратить снабженца в прораба
-- значило бы выдать ему чужой доступ.

CREATE TYPE "Role_new" AS ENUM ('OWNER', 'FOREMAN', 'CLIENT');
ALTER TABLE "users" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "Role_old";

-- Запись справочника, от лица которой входит заказчик. Обязательна для роли
-- CLIENT и пуста у прочих; проверяется приложением, а не связью — ограничение
-- по значению другого столбца выражается в PostgreSQL только триггером, а
-- триггер прячет правило от того, кто читает схему.
ALTER TABLE "users" ADD COLUMN "clientId" UUID;

-- Удаление записи справочника уносит доступ вместе с ней: вход, переживший
-- заказчика, открывал бы объекты, которых он лишился.
ALTER TABLE "users" ADD CONSTRAINT "users_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
