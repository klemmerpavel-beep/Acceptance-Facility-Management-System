-- Вход по номеру телефона и сведения об организации.
--
-- Код подтверждения — такой же одноразовый токен, как магическая ссылка,
-- поэтому он живёт в auth_tokens и хранится хешем. Отличие одно: шесть цифр
-- перебираются за миллион запросов, и одного срока жизни мало — нужен
-- счётчик попыток.

ALTER TYPE "AuthPurpose" ADD VALUE 'SMS_CODE';

ALTER TABLE "auth_tokens" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "organizations"
  ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'RUB',
  ADD COLUMN "phone"    TEXT,
  ADD COLUMN "email"    TEXT,
  ADD COLUMN "logoKey"  TEXT;
