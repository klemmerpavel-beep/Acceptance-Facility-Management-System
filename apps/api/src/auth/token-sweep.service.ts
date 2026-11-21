import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { СУТКИ_МС } from "./limits";

/** Обход раз в час: срок токена считается минутами и днями, точнее не нужно. */
const ПЕРИОД_МС = 60 * 60 * 1000;

/**
 * Уборка просроченных токенов входа (ADR-0008, п. 7; K7 фазы 0, П-63).
 *
 * Прежде токены удалялись только при снятии доступа, и таблица росла на
 * каждый запрос ссылки и кода. Устройство — по образцу обезличивания
 * заявок (`leads/lead-retention.service.ts`): при запуске и далее по таймеру.
 *
 * Удаляется токен, истёкший больше суток назад, а не всякий истёкший:
 * пределы частоты считают коды на номер за сутки строками этой таблицы
 * (`limits.ts`), и код, удалённый через пять минут после выдачи, выпал бы
 * из счёта — уборка снимала бы предел. Сессии здесь не трогаются: по ним
 * «Люди» и очередь руководителя отвечают, входил ли человек.
 */
@Injectable()
export class TokenSweepService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("Уборка токенов входа");
  private таймер: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    void this.обойти();
    this.таймер = setInterval(() => { void this.обойти(); }, ПЕРИОД_МС);
    this.таймер.unref();
  }

  onModuleDestroy(): void {
    if (this.таймер !== null) clearInterval(this.таймер);
  }

  /** Один обход. Возвращает число удалённых токенов; сбой пишется в журнал запуска. */
  async обойти(сейчас = new Date()): Promise<number> {
    try {
      const { count } = await this.prisma.authToken.deleteMany({
        where: { expiresAt: { lt: new Date(сейчас.getTime() - СУТКИ_МС) } },
      });
      if (count > 0) this.logger.log(`удалено просроченных токенов: ${String(count)}`);
      return count;
    } catch (cause) {
      this.logger.error(`обход не выполнен: ${String(cause)}`);
      return 0;
    }
  }
}
