import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

/**
 * Журнал аудита (БП-10). Изменение любого денежного поля пишется сюда
 * с автором и временем. Записи не изменяются и не удаляются.
 *
 * Запись журнала делается клиентом той транзакции, что меняет данные, и
 * только им. Прежде журнал писался собственным соединением службы — и
 * внутри транзакции, и рядом с одиночной записью: изменение и его след
 * фиксировались порознь, и откат транзакции оставлял след без изменения,
 * а сбой записи следа — изменение без следа (полный аудит 30.09.2026,
 * П-37). Клиент транзакции — обязательный довод; передать вместо него
 * службу базы не даёт правило линта.
 */
@Injectable()
export class AuditService {
  async record(
    input: {
      orgId: string;
      actorId: string | null;
      entity: string;
      entityId: string;
      field: string;
      oldValue: string | null;
      newValue: string | null;
    },
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.auditLog.create({ data: input });
  }
}
