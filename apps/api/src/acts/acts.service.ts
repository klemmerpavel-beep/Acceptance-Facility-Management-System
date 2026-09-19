import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { ActRow, ActView, SignAct } from "@priyomka/contracts";
import {
  acceptedTotal, basisPoints, clientTotals, kopecks, milliunits, projectActLine, sum,
  type Kopecks,
  ownerLevel,
} from "@priyomka/domain";
import { PrismaService } from "../prisma.service";
import { AuditService } from "../common/audit.service";
import type { RequestUser } from "../common/current-user";
import { projectScope } from "../common/project-scope";

/**
 * Акт выполненных работ.
 *
 * **Отдельной записи акта нет.** Акт есть представление закрытого транша:
 * «выработали сумму → акт выполненных работ → подписание → оплата»
 * (`01_PROJECT.md`, раздел 4, шаг 5). Вторая запись тех же строк разошлась
 * бы с первой при первом же сторно приёмки — а сторно в продукте законно и
 * историю не переписывает (БП-04).
 *
 * Отсюда и нумерация: номер акта есть номер транша, который он закрывает,
 * и счёт идёт по объекту — решение заказчика от 13.09.2026. Совпадающие
 * номера у разных объектов разводит код объекта, который стоит в акте рядом
 * с номером.
 *
 * **Два вида различаются составом полей, а не оформлением.** В клиентском
 * ключей внутренних величин нет вовсе, а не значения пусты: то же правило,
 * что у сметы (`projection.ts`). Внутренний вид отдаётся только
 * руководителю — проверка стоит и здесь, и декоратором маршрута.
 *
 * Строки акта собираются доменом (`projectActLine`), написанным заранее и
 * до этой работы ни разу не вызванным.
 */

/* Выборка пакетов вписана в оба запроса, а не вынесена в постоянную:
   Prisma выводит тип выборки из литерала на месте, и вынесенная в
   переменную она теряет литеральность — отказ читается десятком строк о
   несовместимости типов вместо одной о причине. Повтор здесь дешевле. */

const день = (значение: Date): string => значение.toISOString().slice(0, 10);

@Injectable()
export class ActsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async projectOf(user: RequestUser, code: string) {
    const project = await this.prisma.project.findFirst({
      where: { ...projectScope(user), code },
      include: { client: { select: { name: true, requisites: true } } },
    });
    if (!project) {
      throw new NotFoundException({ message: `Объект ${code} не найден или недоступен.` });
    }
    return project;
  }

  /**
   * Перечень актов объекта: по одному на закрытый транш.
   *
   * Открытый транш акта не имеет по определению: акт и есть то, чем транш
   * закрывают. Показывать строку «акт ещё не сформирован» значило бы занять
   * место обещанием вместо документа.
   */
  async list(user: RequestUser, code: string): Promise<ActRow[]> {
    const project = await this.projectOf(user, code);
    /* Надбавка нужна уже перечню: строка показывает ту же сумму, что стоит
       в подвале самого акта. Показывать в перечне одни работы, а в акте —
       работы с сопровождением значит назвать документ двумя числами, из
       которых меньшее видно сразу, а большее — только после раскрытия. */
    const смета = await this.prisma.estimate.findFirst({
      where: { projectId: project.id },
      orderBy: { version: "desc" },
      select: { supervisionShare: true },
    });
    const share = basisPoints(смета?.supervisionShare ?? project.supervisionShare);
    const транши = await this.prisma.tranche.findMany({
      where: { projectId: project.id, status: { in: ["CLOSED", "PAID"] } },
      orderBy: { number: "desc" },
      select: {
        id: true, number: true, closedAt: true, signedAt: true, paidAt: true,
        batches: {
          select: {
            acceptances: {
              select: {
                qty: true,
                item: {
                  select: {
                    id: true, name: true, unitPrice: true, unitWage: true,
                    unit: { select: { code: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    return транши
      .filter((транш): транш is typeof транш & { closedAt: Date } => транш.closedAt !== null)
      .map((транш) => {
        const строки = транш.batches.flatMap((пакет) => пакет.acceptances);
        return {
          trancheId: транш.id,
          number: транш.number,
          closedAt: день(транш.closedAt),
          signedAt: транш.signedAt === null ? null : день(транш.signedAt),
          paidAt: транш.paidAt === null ? null : транш.paidAt.toISOString(),
          positions: строки.length,
          total: clientTotals(acceptedTotal(строки.map((строка) => ({
            qty: milliunits(строка.qty),
            unitPrice: kopecks(строка.item.unitPrice),
          }))), share).total.toString(),
        };
      });
  }

  /**
   * Один акт в выбранном виде.
   *
   * Надбавка берётся у действующей сметы объекта — той же, по которой
   * считается клиентская сумма транша (БП-05). Взять её у объекта значило бы
   * получить в акте одно число, а в траншах другое.
   */
  async view(
    user: RequestUser,
    code: string,
    id: string,
    audience: "client" | "internal",
  ): Promise<ActView> {
    if (audience === "internal" && !ownerLevel(user.role)) {
      throw new ForbiddenException({
        message: "Внутренний вид акта содержит ставку и прибыль и отдаётся руководителю.",
      });
    }
    const project = await this.projectOf(user, code);
    const транш = await this.prisma.tranche.findFirst({
      where: { id, projectId: project.id },
      select: {
        id: true, number: true, status: true, closedAt: true, signedAt: true,
        batches: {
          select: {
            acceptances: {
              select: {
                qty: true,
                item: {
                  select: {
                    id: true, name: true, unitPrice: true, unitWage: true,
                    unit: { select: { code: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!транш) {
      throw new NotFoundException({ message: "Транш не найден или недоступен." });
    }
    if (транш.closedAt === null) {
      throw new BadRequestException({
        message: `Транш № ${String(транш.number)} ещё открыт. Акт формируется закрытием транша.`,
      });
    }

    const [смета, организация] = await Promise.all([
      this.prisma.estimate.findFirst({
        where: { projectId: project.id },
        orderBy: { version: "desc" },
        select: { supervisionShare: true },
      }),
      this.prisma.organization.findUniqueOrThrow({ where: { id: user.orgId } }),
    ]);
    const share = basisPoints(смета?.supervisionShare ?? project.supervisionShare);

    /* Позиции сводятся по опознавателю: одна работа, принятая тремя
       пакетами, стоит в акте одной строкой с суммарным количеством.
       Три строки «Штукатурка стен» в акте заказчик читает как ошибку. */
    const своды = new Map<string, {
      name: string; unit: string; unitPrice: bigint; unitWage: bigint; qty: bigint;
    }>();
    for (const пакет of транш.batches) {
      for (const строка of пакет.acceptances) {
        const было = своды.get(строка.item.id);
        своды.set(строка.item.id, {
          name: строка.item.name,
          unit: строка.item.unit.code,
          unitPrice: строка.item.unitPrice,
          unitWage: строка.item.unitWage,
          qty: (было?.qty ?? 0n) + строка.qty,
        });
      }
    }

    const lines = [...своды.entries()].map(([id, свод]) => {
      /* Поля позиции сметы, которых акту не нужно, всё равно передаются:
         `ActLineRecord` наследует запись позиции целиком, и обрезать её
         здесь значило бы завести второй, неполный образец той же записи.
         Количество в акте отличается от количества в смете — принято
         столько, сколько принято, а не столько, сколько заложено. */
      const запись = {
        id,
        sectionId: "",
        order: 0,
        name: свод.name,
        unit: свод.unit,
        qty: milliunits(свод.qty),
        qtyAccepted: milliunits(свод.qty),
        unitPrice: kopecks(свод.unitPrice),
        unitWage: kopecks(свод.unitWage),
        qtyInAct: milliunits(свод.qty),
        /* Помещение бланк акта не печатает — как и раздел выше. */
        room: null,
      };
      if (audience === "internal") {
        const строка = projectActLine(запись, "internal");
        return {
          name: строка.name,
          unit: строка.unit,
          qty: строка.qty.toString(),
          unitPrice: строка.unitPrice.toString(),
          total: строка.total.toString(),
          unitWage: строка.unitWage.toString(),
          wageTotal: строка.wageTotal.toString(),
          profit: строка.profit.toString(),
          profitShare: Number(строка.profitShare),
        };
      }
      const строка = projectActLine(запись, "client");
      return {
        name: строка.name,
        unit: строка.unit,
        qty: строка.qty.toString(),
        unitPrice: строка.unitPrice.toString(),
        total: строка.total.toString(),
      };
    });

    const works = sum(lines.map((строка) => kopecks(строка.total)));
    const итоги = clientTotals(works, share);
    const начислено: Kopecks = audience === "internal"
      ? sum(lines.map((строка) => kopecks(строка.wageTotal ?? "0")))
      : kopecks(0);

    return {
      audience,
      number: транш.number,
      trancheId: транш.id,
      closedAt: день(транш.closedAt),
      signedAt: транш.signedAt === null ? null : день(транш.signedAt),
      project: { code: project.code, address: project.address },
      client: { name: project.client.name, requisites: project.client.requisites },
      contractor: {
        name: организация.name,
        phone: организация.phone,
        email: организация.email,
        requisites: организация.requisites,
      },
      lines,
      totals: {
        works: итоги.works.toString(),
        supervisionShare: Number(итоги.supervisionShare),
        supervision: итоги.supervision.toString(),
        total: итоги.total.toString(),
        ...(audience === "internal"
          ? {
            wage: начислено.toString(),
            profit: (works - начислено).toString(),
          }
          : {}),
      },
    };
  }

  /**
   * Отметка подписания. Ставит руководитель, датой с бумаги.
   *
   * Дата приходит запросом, а не берётся из часов: акт подписывают на
   * объекте, а в систему вносят вечером, и «сегодня» здесь означало бы не
   * тот день. Будущая дата отвергается — подписанного завтра не бывает.
   */
  async sign(user: RequestUser, code: string, id: string, input: SignAct): Promise<ActRow[]> {
    if (!ownerLevel(user.role)) {
      throw new ForbiddenException({ message: "Подписание акта отмечает руководитель." });
    }
    const project = await this.projectOf(user, code);
    const транш = await this.prisma.tranche.findFirst({
      where: { id, projectId: project.id },
      select: { id: true, number: true, closedAt: true, signedAt: true },
    });
    if (!транш) throw new NotFoundException({ message: "Транш не найден или недоступен." });
    if (транш.closedAt === null) {
      throw new BadRequestException({
        message: `Транш № ${String(транш.number)} ещё открыт: подписывать нечего.`,
      });
    }
    if (input.signedAt > день(new Date())) {
      throw new BadRequestException({
        message: "Дата подписания позже сегодняшней. Подписанного завтра не бывает.",
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.tranche.update({
        where: { id: транш.id },
        data: { signedAt: new Date(input.signedAt) },
      });
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "Tranche",
        entityId: транш.id,
        field: `акт № ${String(транш.number)} — подписание`,
        oldValue: транш.signedAt === null ? null : день(транш.signedAt),
        newValue: input.signedAt,
      });
    });

    return this.list(user, code);
  }
}
