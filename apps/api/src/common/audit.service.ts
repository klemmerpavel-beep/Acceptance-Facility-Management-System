import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

/**
 * Журнал аудита (БП-10). Изменение любого денежного поля пишется сюда
 * с автором и временем. Записи не изменяются и не удаляются.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: {
    orgId: string;
    actorId: string | null;
    entity: string;
    entityId: string;
    field: string;
    oldValue: string | null;
    newValue: string | null;
  }): Promise<void> {
    await this.prisma.auditLog.create({ data: input });
  }
}
