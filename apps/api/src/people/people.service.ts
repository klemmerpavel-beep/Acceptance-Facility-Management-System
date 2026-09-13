import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { InviteUser, PersonRow } from "@priyomka/contracts";
import { PrismaService } from "../prisma.service";
import { AuthService } from "../auth/auth.service";
import { AuditService } from "../common/audit.service";
import type { RequestUser } from "../common/current-user";

/**
 * Люди организации: кто имеет вход и с какой ролью.
 *
 * **Самостоятельной регистрации в продукте нет** — решение заказчика от
 * 13.09.2026. В системе лежат чужие деньги и персональные данные (152-ФЗ), и
 * вход с улицы означал бы, что состав пользователей определяет не компания.
 * Человека заводит руководитель и выдаёт ему личную ссылку.
 *
 * Ссылка живёт ограниченное время и обменивается на сессию один раз — то же
 * устройство, что у ссылки прораба, которая работала и до этой работы.
 * Постоянной ссылки «на объект» нет: попав в чужие руки, она открыла бы
 * объект целиком, и отозвать её было бы нечем.
 */

@Injectable()
export class PeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  /** Перечень людей организации. Ведёт руководитель. */
  async list(user: RequestUser): Promise<PersonRow[]> {
    const люди = await this.prisma.user.findMany({
      where: { orgId: user.orgId },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: {
        id: true, name: true, role: true, email: true, phone: true, createdAt: true,
        client: { select: { name: true } },
        sessions: { select: { id: true }, take: 1 },
      },
    });
    return люди.map((человек) => ({
      id: человек.id,
      name: человек.name,
      role: человек.role,
      email: человек.email,
      phone: человек.phone,
      client: человек.client?.name ?? null,
      /* «Входил» — не время последнего входа, а признак: сессия у человека
         была. Точное время означало бы учёт рабочего времени, которого в
         продукте нет и не будет (границы объёма). */
      entered: человек.sessions.length > 0,
    }));
  }

  /**
   * Заведение человека и выдача личной ссылки.
   *
   * Ссылка возвращается вызывающему, а не отправляется письмом: почтового
   * отправителя в продукте нет, и обещать доставку было бы обещанием работы,
   * которой не существует. Руководитель передаёт ссылку сам.
   */
  async invite(user: RequestUser, input: InviteUser): Promise<{ token: string }> {
    if (input.role === "CLIENT" && input.clientId === null) {
      throw new BadRequestException({
        message: "Заказчику нужна запись справочника: без неё непонятно, чьи объекты он видит.",
      });
    }
    if (input.role !== "CLIENT" && input.clientId !== null) {
      throw new BadRequestException({
        message: "Связь с заказчиком ставится только роли «заказчик».",
      });
    }
    if (input.email === null && input.phone === null) {
      throw new BadRequestException({
        message: "Нужен хотя бы один способ входа: почта или телефон.",
      });
    }

    /* Почта и телефон опознают человека при входе, и два человека с одним
       адресом сделали бы вход неоднозначным. Проверка идёт по всем
       организациям: адрес опознаёт человека до того, как известна его
       организация. */
    const занят = await this.prisma.user.findFirst({
      where: {
        OR: [
          ...(input.email === null ? [] : [{ email: input.email }]),
          ...(input.phone === null ? [] : [{ phone: input.phone }]),
        ],
      },
      select: { id: true },
    });
    if (занят) {
      throw new BadRequestException({
        message: "Эта почта или телефон уже заведены. Вход по ним был бы неоднозначным.",
      });
    }

    if (input.clientId !== null) {
      const заказчик = await this.prisma.client.findFirst({
        where: { id: input.clientId, orgId: user.orgId },
        select: { id: true },
      });
      if (!заказчик) {
        throw new BadRequestException({ message: "Такого заказчика нет в справочнике." });
      }
    }

    const заведён = await this.prisma.user.create({
      data: {
        orgId: user.orgId,
        role: input.role,
        name: input.name,
        email: input.email,
        phone: input.phone,
        clientId: input.clientId,
      },
      select: { id: true },
    });

    await this.audit.record({
      orgId: user.orgId,
      actorId: user.id,
      entity: "User",
      entityId: заведён.id,
      field: `доступ «${input.name}»`,
      oldValue: null,
      newValue: input.role,
    });

    return this.auth.issueForemanLink(заведён.id);
  }

  /**
   * Новая ссылка уже заведённому человеку: прежняя истекла или потерялась.
   *
   * Выдача новой не отзывает старую по отдельности — обмен одноразовый, и
   * первая же использованная ссылка закрывает вопрос. Руководитель себе
   * ссылку не выписывает: он уже вошёл, и это был бы способ продлить себе
   * сессию в обход срока.
   */
  async relink(user: RequestUser, id: string): Promise<{ token: string }> {
    const человек = await this.prisma.user.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true, name: true },
    });
    if (!человек) throw new NotFoundException({ message: "Человек не найден или недоступен." });
    if (человек.id === user.id) {
      throw new BadRequestException({ message: "Себе ссылка не нужна: вы уже вошли." });
    }
    await this.audit.record({
      orgId: user.orgId,
      actorId: user.id,
      entity: "User",
      entityId: человек.id,
      field: `ссылка входа «${человек.name}»`,
      oldValue: null,
      newValue: "выдана заново",
    });
    return this.auth.issueForemanLink(человек.id);
  }

  /**
   * Снятие доступа. Сессии удаляются вместе с записью: доступ, переживший
   * увольнение, — это доступ.
   *
   * Записи журнала остаются: история не переписывается (БП-04), и «кто принял
   * эту позицию» спрашивают через год, когда человек уже не работает.
   */
  async revoke(user: RequestUser, id: string): Promise<PersonRow[]> {
    if (id === user.id) {
      throw new BadRequestException({
        message: "Нельзя снять доступ себе: организация осталась бы без руководителя.",
      });
    }
    const человек = await this.prisma.user.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true, name: true, role: true },
    });
    if (!человек) throw new NotFoundException({ message: "Человек не найден или недоступен." });

    if (человек.role === "OWNER") {
      const руководителей = await this.prisma.user.count({
        where: { orgId: user.orgId, role: "OWNER" },
      });
      if (руководителей <= 1) {
        throw new BadRequestException({
          message: "Это последний руководитель организации: снять с него доступ нельзя.",
        });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.session.deleteMany({ where: { userId: человек.id } });
      await tx.authToken.deleteMany({ where: { userId: человек.id } });
      await tx.user.delete({ where: { id: человек.id } });
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "User",
        entityId: человек.id,
        field: `доступ «${человек.name}» снят`,
        oldValue: человек.role,
        newValue: null,
      });
    });

    return this.list(user);
  }
}
