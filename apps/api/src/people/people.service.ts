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

  /** Перечень людей с действующим доступом. Ведёт руководитель. */
  async list(user: RequestUser): Promise<PersonRow[]> {
    const люди = await this.prisma.user.findMany({
      where: { orgId: user.orgId, revokedAt: null },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: {
        id: true, name: true, role: true, email: true, phone: true, createdAt: true,
        clientId: true,
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
      clientId: человек.clientId,
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
       организация.

       Единственное исключение — снятый человек своей организации: выдача
       входа по его почте или телефону возвращает ту же запись, и журнал,
       приёмка и чеки остаются за одним автором (решение заказчика от
       01.10.2026, П-51). Совпадение с двумя записями или с действующей —
       прежний отказ. */
    const совпали = await this.prisma.user.findMany({
      where: {
        OR: [
          ...(input.email === null ? [] : [{ email: input.email }]),
          ...(input.phone === null ? [] : [{ phone: input.phone }]),
        ],
      },
      select: { id: true, orgId: true, revokedAt: true },
      take: 2,
    });
    const [первый] = совпали;
    const снятый = совпали.length === 1 && первый?.orgId === user.orgId
      && первый.revokedAt !== null ? первый : null;
    const занят = new BadRequestException({
      message: "Эта почта или телефон уже заведены. Вход по ним был бы неоднозначным.",
    });
    if (совпали.length > 0 && снятый === null) throw занят;

    if (input.clientId !== null) {
      const заказчик = await this.prisma.client.findFirst({
        where: { id: input.clientId, orgId: user.orgId },
        select: { id: true },
      });
      if (!заказчик) {
        throw new BadRequestException({ message: "Такого заказчика нет в справочнике." });
      }
    }

    if (снятый !== null) {
      return this.prisma.$transaction(async (tx) => {
        /* Условием от прежнего состояния: два одновременных возврата не
           выдают двух ссылок с двумя записями журнала (П-38). */
        const возвращён = await tx.user.updateMany({
          where: { id: снятый.id, revokedAt: { not: null } },
          data: {
            revokedAt: null,
            role: input.role,
            name: input.name,
            email: input.email,
            phone: input.phone,
            clientId: input.clientId,
          },
        });
        if (возвращён.count === 0) throw занят;
        await this.audit.record({
          orgId: user.orgId,
          actorId: user.id,
          entity: "User",
          entityId: снятый.id,
          field: `доступ «${input.name}» возвращён`,
          oldValue: null,
          newValue: input.role,
        }, tx);
        return this.auth.issueForemanLink(снятый.id, user.orgId, tx);
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const заведён = await tx.user.create({
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
      }, tx);

      return this.auth.issueForemanLink(заведён.id, user.orgId, tx);
    });
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
      where: { id, orgId: user.orgId, revokedAt: null },
      select: { id: true, name: true },
    });
    if (!человек) throw new NotFoundException({ message: "Человек не найден или недоступен." });
    if (человек.id === user.id) {
      throw new BadRequestException({ message: "Себе ссылка не нужна: вы уже вошли." });
    }
    return this.prisma.$transaction(async (tx) => {
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "User",
        entityId: человек.id,
        field: `ссылка входа «${человек.name}»`,
        oldValue: null,
        newValue: "выдана заново",
      }, tx);
      return this.auth.issueForemanLink(человек.id, user.orgId, tx);
    });
  }

  /**
   * Снятие доступа. Сессии и ссылки удаляются: доступ, переживший
   * увольнение, — это доступ.
   *
   * Сама запись человека остаётся с датой снятия. Прежде она удалялась, и
   * связи `SetNull` стирали авторство: у прораба R-99 после снятия пять
   * записей журнала остались без автора (полный аудит 30.09.2026, П-51).
   * История не переписывается (БП-04), и «кто принял эту позицию»
   * спрашивают через год, когда человек уже не работает.
   */
  async revoke(user: RequestUser, id: string): Promise<PersonRow[]> {
    if (id === user.id) {
      throw new BadRequestException({
        message: "Нельзя снять доступ себе: организация осталась бы без руководителя.",
      });
    }
    const человек = await this.prisma.user.findFirst({
      where: { id, orgId: user.orgId, revokedAt: null },
      select: { id: true, name: true, role: true },
    });
    if (!человек) throw new NotFoundException({ message: "Человек не найден или недоступен." });

    if (человек.role === "OWNER") {
      const руководителей = await this.prisma.user.count({
        where: { orgId: user.orgId, role: "OWNER", revokedAt: null },
      });
      if (руководителей <= 1) {
        throw new BadRequestException({
          message: "Это последний руководитель организации: снять с него доступ нельзя.",
        });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const снят = await tx.user.updateMany({
        where: { id: человек.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (снят.count === 0) {
        throw new NotFoundException({ message: "Человек не найден или недоступен." });
      }
      await tx.session.deleteMany({ where: { userId: человек.id } });
      await tx.authToken.deleteMany({ where: { userId: человек.id } });
      /* Назначение прорабом снимается, как снимало его прежнее удаление:
         объект, который ведёт человек без входа, не ведёт никто. Прежде это
         случалось молча; теперь лента объекта называет, кто и когда снят с
         него. Авторство прошлых записей при этом остаётся. */
      const объекты = await tx.project.findMany({ where: { foremanId: человек.id }, select: { id: true } });
      await tx.project.updateMany({ where: { foremanId: человек.id }, data: { foremanId: null } });
      for (const объект of объекты) {
        await this.audit.record({
          orgId: user.orgId,
          actorId: user.id,
          entity: "Project",
          entityId: объект.id,
          field: "прораб",
          oldValue: человек.name,
          newValue: null,
        }, tx);
      }
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "User",
        entityId: человек.id,
        field: `доступ «${человек.name}» снят`,
        oldValue: человек.role,
        newValue: null,
      }, tx);
    });

    return this.list(user);
  }
}
