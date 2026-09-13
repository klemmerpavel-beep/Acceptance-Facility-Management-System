import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  DocumentTemplate, IssuedDocument, SaveTemplate, TemplateRow,
} from "@priyomka/contracts";
import {
  acceptedTotal, basisPoints, clientTotals, fillTemplate, formatKopecks, kopecks,
  milliunits, templateFault,
} from "@priyomka/domain";
import { PrismaService } from "../prisma.service";
import { AuditService } from "../common/audit.service";
import type { RequestUser } from "../common/current-user";

/**
 * Шаблоны документов организации.
 *
 * Договор и дополнительное соглашение — свободный текст с метками, и метка
 * заменяется значением в момент выпуска. Акта среди видов нет: он есть
 * представление закрытого транша и собирается из принятых позиций
 * (`acts.service.ts`). Сделать его редактируемым шаблоном значило бы дать
 * тексту вынести ставку оплаты труда в клиентский документ.
 *
 * Правила разбора и подстановки живут в домене (`template.ts`) и зовутся
 * отсюда до записи. Экран зовёт те же — одно правило, два места применения.
 *
 * Оформления в шаблоне нет: бланк задаёт система, тот же, что у акта. Панель
 * стилизации из утверждённого макета не делается — решение заказчика от
 * 13.09.2026.
 */

const день = (значение: Date): string => значение.toISOString().slice(0, 10);

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Перечень шаблонов организации. Тело пунктов в списке не нужно. */
  async list(user: RequestUser): Promise<TemplateRow[]> {
    const шаблоны = await this.prisma.documentTemplate.findMany({
      where: { orgId: user.orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, kind: true, updatedAt: true, _count: { select: { clauses: true } } },
    });
    return шаблоны.map((шаблон) => ({
      id: шаблон.id,
      name: шаблон.name,
      kind: шаблон.kind,
      clauses: шаблон._count.clauses,
      updatedAt: шаблон.updatedAt.toISOString(),
    }));
  }

  /** Один шаблон с пунктами. Метки остаются метками — это и есть шаблон. */
  async view(user: RequestUser, id: string): Promise<DocumentTemplate> {
    const шаблон = await this.prisma.documentTemplate.findFirst({
      where: { id, orgId: user.orgId },
      include: { clauses: { orderBy: { order: "asc" } } },
    });
    if (!шаблон) throw new NotFoundException({ message: "Шаблон не найден или недоступен." });
    return {
      id: шаблон.id,
      name: шаблон.name,
      kind: шаблон.kind,
      updatedAt: шаблон.updatedAt.toISOString(),
      clauses: шаблон.clauses.map((пункт) => ({ title: пункт.title, body: пункт.body })),
    };
  }

  /**
   * Заведение и правка. Пункты переписываются целиком, а не сверяются
   * построчно: порядок и состав меняются вместе, и сведение двух списков в
   * один дало бы правила слияния там, где их никто не спрашивал.
   */
  async save(user: RequestUser, input: SaveTemplate, id: string | null): Promise<TemplateRow[]> {
    const отказ = templateFault(input);
    if (отказ !== null) throw new BadRequestException({ message: отказ });

    const занято = await this.prisma.documentTemplate.findFirst({
      where: { orgId: user.orgId, name: input.name, ...(id === null ? {} : { NOT: { id } }) },
      select: { id: true },
    });
    if (занято) {
      throw new BadRequestException({
        message: `Шаблон «${input.name}» уже заведён. Два одинаковых имени в списке неразличимы.`,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const шаблон = id === null
        ? await tx.documentTemplate.create({
          data: { orgId: user.orgId, name: input.name, kind: input.kind },
          select: { id: true },
        })
        : await (async () => {
          const свой = await tx.documentTemplate.findFirst({
            where: { id, orgId: user.orgId }, select: { id: true },
          });
          if (!свой) throw new NotFoundException({ message: "Шаблон не найден или недоступен." });
          await tx.documentTemplate.update({
            where: { id: свой.id },
            data: { name: input.name, kind: input.kind },
          });
          await tx.documentClause.deleteMany({ where: { templateId: свой.id } });
          return свой;
        })();

      await tx.documentClause.createMany({
        data: input.clauses.map((пункт, индекс) => ({
          templateId: шаблон.id,
          order: индекс,
          title: пункт.title,
          body: пункт.body,
        })),
      });

      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "DocumentTemplate",
        entityId: шаблон.id,
        field: `шаблон «${input.name}»`,
        oldValue: id === null ? null : "правка",
        newValue: `${String(input.clauses.length)} пунктов`,
      });
    });

    return this.list(user);
  }

  async remove(user: RequestUser, id: string): Promise<TemplateRow[]> {
    const шаблон = await this.prisma.documentTemplate.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true, name: true },
    });
    if (!шаблон) throw new NotFoundException({ message: "Шаблон не найден или недоступен." });

    await this.prisma.$transaction(async (tx) => {
      await tx.documentTemplate.delete({ where: { id: шаблон.id } });
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "DocumentTemplate",
        entityId: шаблон.id,
        field: `шаблон «${шаблон.name}» удалён`,
        oldValue: шаблон.name,
        newValue: null,
      });
    });
    return this.list(user);
  }

  /**
   * Выпуск документа по объекту.
   *
   * Подстановка идёт здесь, где лежат данные, а не на экране: второе правило
   * подстановки разошлось бы с первым на первой же новой переменной.
   */
  async issue(user: RequestUser, id: string, projectCode: string): Promise<IssuedDocument> {
    const шаблон = await this.prisma.documentTemplate.findFirst({
      where: { id, orgId: user.orgId },
      include: { clauses: { orderBy: { order: "asc" } } },
    });
    if (!шаблон) throw new NotFoundException({ message: "Шаблон не найден или недоступен." });

    const project = await this.prisma.project.findFirst({
      where: { orgId: user.orgId, code: projectCode },
      include: { client: { select: { name: true, requisites: true } } },
    });
    if (!project) {
      throw new NotFoundException({ message: `Объект ${projectCode} не найден или недоступен.` });
    }

    const [организация, смета, обмер, автор] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: user.orgId } }),
      this.prisma.estimate.findFirst({
        where: { projectId: project.id },
        orderBy: { version: "desc" },
        select: { id: true, supervisionShare: true },
      }),
      this.prisma.measureRoom.findMany({
        where: { projectId: project.id, set: "INITIAL" },
        select: { floorArea: true },
      }),
      this.prisma.user.findUnique({ where: { id: user.id }, select: { name: true } }),
    ]);

    /* Итог сметы — клиентский: документ уходит заказчику, и внутренних
       величин в нём нет по составу, как и в акте. */
    let итогСметы: string | null = null;
    if (смета !== null) {
      const позиции = await this.prisma.estimateItem.findMany({
        where: { section: { estimateId: смета.id } },
        select: { qty: true, unitPrice: true },
      });
      const работы = acceptedTotal(позиции.map((позиция) => ({
        qty: milliunits(позиция.qty),
        unitPrice: kopecks(позиция.unitPrice),
      })));
      итогСметы = formatKopecks(
        clientTotals(работы, basisPoints(смета.supervisionShare)).total);
    }

    const площадь = обмер.length === 0
      ? null
      : `${(Number(обмер.reduce((сумма, комната) => сумма + комната.floorArea, 0n)) / 1000).toFixed(2)} м²`;

    const сегодня = день(new Date());
    const значения: Record<string, string | null> = {
      "организация.наименование": организация.name,
      "организация.телефон": организация.phone,
      "организация.почта": организация.email,
      "исполнитель.наименование": организация.name,
      "исполнитель.реквизиты": организация.requisites,
      "контрагент.наименование": project.client.name,
      "контрагент.реквизиты": project.client.requisites,
      "документ.номер": project.code,
      "документ.дата": сегодня,
      "объект.код": project.code,
      "объект.адрес": project.address,
      "объект.площадь": площадь,
      "объект.смета": итогСметы,
      "система.сегодня": сегодня,
      "система.автор": автор?.name ?? null,
    };

    return {
      name: шаблон.name,
      kind: шаблон.kind,
      issuedAt: сегодня,
      project: { code: project.code, address: project.address },
      contractor: { name: организация.name, requisites: организация.requisites },
      client: { name: project.client.name, requisites: project.client.requisites },
      clauses: шаблон.clauses.map((пункт) => ({
        title: fillTemplate(пункт.title, значения),
        body: fillTemplate(пункт.body, значения),
      })),
    };
  }
}
