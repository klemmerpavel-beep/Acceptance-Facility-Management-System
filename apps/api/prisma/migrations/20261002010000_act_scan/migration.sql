-- Скан подписанного акта (план, пункт 4.10).
--
-- Отметка подписания хранила одну дату; бумага с подписью заказчика жила вне
-- системы. Скан прикладывается к подписанному акту — то есть к закрытому
-- траншу с датой подписания; ключ файла, его тип и день загрузки — здесь.
ALTER TABLE "tranches" ADD COLUMN "signedScanKey" TEXT;
ALTER TABLE "tranches" ADD COLUMN "signedScanType" TEXT;
ALTER TABLE "tranches" ADD COLUMN "signedScanAt" TIMESTAMP(3);
