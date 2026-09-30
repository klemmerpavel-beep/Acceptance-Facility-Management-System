-- Узел «деньги»: частичная оплата, порог просрочки по договору, роль бухгалтера.
--
-- Ответы заказчика на вопросы 4, 5 и 7 квиза от 19.09.2026. Три изменения идут
-- одной миграцией, потому что связаны данными: порог считается от транша,
-- транш считается по платежам, а ведёт их обоих новая роль.

-- 1. Четвёртая роль.
--
-- Перечисление пересоздаётся, а не правится по месту, — тем же приёмом, что и
-- при снятии `SUPPLY`: порядок значений здесь несёт смысл (роли перечислены от
-- наибольшего доступа к наименьшему), а ADD VALUE ставит новое значение в
-- конец и поставил бы бухгалтера после заказчика.
CREATE TYPE "Role_new" AS ENUM ('OWNER', 'FOREMAN', 'ACCOUNTANT', 'CLIENT');
ALTER TABLE "users" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "Role_old";

-- 2. Порог просрочки оплаты по договору с заказчиком.
--
-- Столбец допускает пустое значение, и это не небрежность: пусто означает
-- «действует умолчание компании», а не «просрочка не считается». Значение по
-- умолчанию на уровне базы поставило бы семь дней всем заказчикам разом и
-- лишило бы продукт возможности отличить назначенный порог от неназначенного.
ALTER TABLE "clients" ADD COLUMN "paymentGraceDays" INTEGER;

-- 3. Платёж заказчика в счёт транша.
--
-- Сумма — целые копейки (БП-08). У сторно она отрицательная, поэтому оплаченное
-- по траншу есть простая сумма столбца, а не сумма неотменённых записей.
CREATE TABLE "tranche_payments" (
    "id" UUID NOT NULL,
    "trancheId" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "paidOn" DATE NOT NULL,
    "reason" TEXT,
    "reversalOfId" UUID,
    "comment" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tranche_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tranche_payments_trancheId_paidOn_idx" ON "tranche_payments"("trancheId", "paidOn");

-- Сторнируемый платёж уникален: связь «один к одному» не даёт сторнировать один
-- платёж дважды даже в обход приложения — двумя окнами в одну секунду.
CREATE UNIQUE INDEX "tranche_payments_reversalOfId_key" ON "tranche_payments"("reversalOfId");

ALTER TABLE "tranche_payments" ADD CONSTRAINT "tranche_payments_trancheId_fkey" FOREIGN KEY ("trancheId") REFERENCES "tranches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tranche_payments" ADD CONSTRAINT "tranche_payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RESTRICT, а не CASCADE: удаление платежа, у которого есть сторно, означало бы
-- переписывание истории (БП-04). Запись не удаляется вовсе, и связь обязана
-- говорить об этом на уровне базы, а не только на уровне приложения.
ALTER TABLE "tranche_payments" ADD CONSTRAINT "tranche_payments_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "tranche_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Предоплаченные транши получают свой платёж.
--
-- Без этого шага каждый транш, заведённый предоплатой до сегодняшнего дня, с
-- первого же открытия экрана числился бы недобором на всю сумму: отметка
-- «оплачен» стоит, платежей нет. Пересчёт задним числом здесь законен — он не
-- переписывает историю, а записывает деньги, которые уже были получены и
-- засвидетельствованы отметкой оплаты.
INSERT INTO "tranche_payments" ("id", "trancheId", "amount", "paidOn", "comment", "createdById", "createdAt")
SELECT gen_random_uuid(), "id", "amount", COALESCE("paidAt", "openedAt")::date,
       'Оплата до появления учёта платежей', "createdById", COALESCE("paidAt", "openedAt")
FROM "tranches"
WHERE "status" = 'PAID';
