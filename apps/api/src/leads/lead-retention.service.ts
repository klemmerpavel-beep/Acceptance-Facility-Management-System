import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { LEAD_RETENTION_DAYS, retentionExpired, сколько } from "@priyomka/domain";
import { PrismaService } from "../prisma.service";
import { AuditService } from "../common/audit.service";
import { обезличенныеПоля } from "./anonymize";

/** Обход раз в шесть часов: срок считается днями, точнее не нужно. */
const ПЕРИОД_МС = 6 * 60 * 60 * 1000;

/**
 * Обезличивание отказных заявок по сроку хранения.
 *
 * Действие «обезличить» исполнено 01.10.2026 и зависит от того, вспомнит ли
 * о нём руководитель. Ч. 7 ст. 21 152-ФЗ требует уничтожить данные в срок,
 * не превышающий тридцати дней с достижения цели обработки, — и не ждёт
 * памяти человека. Решение заказчика (П-40, вариант «а», вместе с проектом
 * политики обработки — 02.10.2026): сервер сам обезличивает отказную заявку
 * через `LEAD_RETENTION_DAYS` после отказа — при запуске и далее раз в шесть
 * часов. Журнал заявки не трогается, как решено 01.10.2026; запись о факте
 * пишется без автора — его нет — и без персональных данных.
 */
@Injectable()
export class LeadRetentionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("Срок хранения заявок");
  private таймер: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    void this.обойти();
    this.таймер = setInterval(() => { void this.обойти(); }, ПЕРИОД_МС);
    this.таймер.unref();
  }

  onModuleDestroy(): void {
    if (this.таймер !== null) clearInterval(this.таймер);
  }

  /** Один обход. Возвращает число обезличенных заявок; сбой пишется в журнал запуска. */
  async обойти(сейчас = new Date()): Promise<number> {
    try {
      const кандидаты = await this.prisma.lead.findMany({
        where: { outcome: "LOST", anonymizedAt: null, lostAt: { not: null } },
        select: { id: true, orgId: true, lostAt: true },
      });
      let обезличено = 0;
      for (const заявка of кандидаты) {
        if (заявка.lostAt === null || !retentionExpired(заявка.lostAt, сейчас)) continue;
        await this.prisma.$transaction(async (tx) => {
          /* Условным обновлением: заявку мог обезличить руководитель между
             выборкой и записью — второй записи журнала тогда не будет. */
          const { count } = await tx.lead.updateMany({
            where: { id: заявка.id, outcome: "LOST", anonymizedAt: null },
            data: обезличенныеПоля(сейчас),
          });
          if (count === 0) return;
          обезличено += 1;
          await this.audit.record({
            orgId: заявка.orgId,
            actorId: null,
            entity: "Lead",
            entityId: заявка.id,
            field: "персональные данные",
            oldValue: null,
            newValue: `обезличены по сроку хранения: ${сколько(LEAD_RETENTION_DAYS, "день", "дня", "дней")} после отказа`,
          }, tx);
        });
      }
      if (обезличено > 0) this.logger.log(`обезличено отказных заявок: ${String(обезличено)}`);
      return обезличено;
    } catch (cause) {
      this.logger.error(`обход не выполнен: ${String(cause)}`);
      return 0;
    }
  }
}
