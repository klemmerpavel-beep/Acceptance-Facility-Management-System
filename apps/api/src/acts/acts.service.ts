import { randomUUID } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { ActCorrection, ActRow, ActView, CreateActCorrection, SignAct } from "@priyomka/contracts";
import {
  acceptedTotal, actLineWage, basisPoints, clientTotals, correctedState, correctionFault, correctionTotal,
  formatKopecks, kopecks, milliunits, multiplyByQuantity, projectActLine, sum,
  type ActLineWage, type BasisPoints, type Kopecks,
  ownerLevel, formatDay,
} from "@priyomka/domain";
import { PrismaService } from "../prisma.service";
import { AuditService } from "../common/audit.service";
import type { RequestUser } from "../common/current-user";
import { projectScope } from "../common/project-scope";
import { orgDay } from "../common/org-day";
import { FileStorage } from "../common/file-storage";
import { безМетаданных } from "../common/clean-image";
import { типСкана } from "./scan-type";

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
 * до этой работы ни разу не вызванным. «Начислено» и прибыль внутреннего
 * вида — сумма начислений приёмок строки (`actLineWage`; П-60, решение
 * заказчика В-1 от 07.11.2026): живого акта — при выводе, подписанного —
 * снимком при фиксации. Цена и надбавка живого акта следуют за сметой
 * (П-27), ставка — нет: начисление бригаде хранит её снимком (БП-3).
 */

/* Выборка пакетов вписана в оба запроса, а не вынесена в постоянную:
   Prisma выводит тип выборки из литерала на месте, и вынесенная в
   переменную она теряет литеральность — отказ читается десятком строк о
   несовместимости типов вместо одной о причине. Повтор здесь дешевле. */

/**
 * День календаря — дата подписания, хранимая полночью UTC (`@db.Date`): её
 * срез UTC и есть день, а перевод в пояс организации к западу от Гринвича
 * сдвинул бы его на вчера.
 *
 * Мгновения — закрытие транша, фиксация, поправка, загрузка скана —
 * переводятся в день организации (`orgDay`), а не срезаются по UTC (П-68,
 * класс K10): в Воронеже с полуночи до трёх ночи срез UTC датировал акт,
 * фиксацию и поправку вчерашним днём.
 */
const деньКалендаря = (значение: Date): string => значение.toISOString().slice(0, 10);

/**
 * Количество для журнала: «10,5», а не «10500». Журнал читает человек
 * (П-20); форма количества экрана живёт в `packages/ui`, которого у сервера
 * в зависимостях нет, и здесь повторена её суть — тысячные без лишних нулей.
 */
const количествоСловами = (тысячные: bigint): string => {
  const знак = тысячные < 0n ? "−" : "";
  const модуль = тысячные < 0n ? -тысячные : тысячные;
  const дробь = (модуль % 1000n).toString().padStart(3, "0").replace(/0+$/u, "");
  return `${знак}${(модуль / 1000n).toString()}${дробь === "" ? "" : `,${дробь}`}`;
};

/** Строка акта: живая — из приёмок, или строка снимка подписанного акта. */
interface СтрокаАкта {
  /** Строка снимка; `null` — акт не зафиксирован. */
  readonly id: string | null;
  readonly itemId: string | null;
  readonly name: string;
  readonly unit: string;
  readonly qty: bigint;
  readonly unitPrice: bigint;
  /** Ставка и начислено — из начислений приёмок строки, а не из сметы. */
  readonly wage: ActLineWage;
}

interface ПриёмкаАкта {
  readonly qty: bigint;
  readonly item: {
    readonly id: string; readonly name: string; readonly unitPrice: bigint;
    readonly unit: { readonly code: string };
  };
  /** Начисление приёмки: снимок ставки на день приёмки и сумма (БП-3). */
  readonly accrual: { readonly unitWage: bigint; readonly amount: bigint } | null;
}

/**
 * Живой свод акта: позиция одной строкой с суммарным количеством.
 *
 * Позиции сводятся по опознавателю: одна работа, принятая тремя пакетами,
 * стоит в акте одной строкой. Три строки «Штукатурка стен» в акте заказчик
 * читает как ошибку. Тем же сводом пишется снимок при фиксации (ДР-3) —
 * подписанный акт повторяет ровно то, что заказчик видел до подписи.
 *
 * Начисления приёмок строки сводятся вместе с количеством: «начислено»
 * строки — их сумма, ставка — их снимок (П-60). Приёмка без начисления
 * ничего не начислила и в сумму не входит.
 */
function живойСвод(пакеты: readonly { readonly acceptances: readonly ПриёмкаАкта[] }[]): СтрокаАкта[] {
  const своды = new Map<string, {
    строка: Omit<СтрокаАкта, "wage" | "qty">; qty: bigint;
    начисления: { qty: bigint; unitWage: bigint; amount: bigint }[];
  }>();
  for (const пакет of пакеты) {
    for (const строка of пакет.acceptances) {
      const свод = своды.get(строка.item.id) ?? {
        строка: {
          id: null,
          itemId: строка.item.id,
          name: строка.item.name,
          unit: строка.item.unit.code,
          unitPrice: строка.item.unitPrice,
        },
        qty: 0n,
        начисления: [],
      };
      свод.qty += строка.qty;
      if (строка.accrual !== null) {
        свод.начисления.push({ qty: строка.qty, unitWage: строка.accrual.unitWage, amount: строка.accrual.amount });
      }
      своды.set(строка.item.id, свод);
    }
  }
  return [...своды.values()].map((свод) => ({
    ...свод.строка,
    qty: свод.qty,
    wage: actLineWage(свод.начисления.map((начисление) => ({
      qty: milliunits(начисление.qty),
      unitWage: kopecks(начисление.unitWage),
      amount: kopecks(начисление.amount),
    }))),
  }));
}

/** Строка снимка подписанного акта: ставка и начислено записаны фиксацией. */
function строкаСнимка(строка: {
  id: string; itemId: string | null; name: string; unit: string; qty: bigint; unitPrice: bigint;
  unitWage: bigint | null; wageTotal: bigint;
}): СтрокаАкта {
  return {
    id: строка.id,
    itemId: строка.itemId,
    name: строка.name,
    unit: строка.unit,
    qty: строка.qty,
    unitPrice: строка.unitPrice,
    wage: {
      unitWage: строка.unitWage === null ? null : kopecks(строка.unitWage),
      wageTotal: kopecks(строка.wageTotal),
    },
  };
}

interface ЗаписьПоправки {
  readonly id: string;
  readonly actLineId: string;
  readonly qtyBefore: bigint;
  readonly qtyAfter: bigint;
  readonly priceBefore: bigint;
  readonly priceAfter: bigint;
  readonly reason: string;
  readonly createdAt: Date;
  readonly actLine: {
    readonly name: string; readonly unit: string; readonly tranche: { readonly number: number };
  };
  readonly tranche: { readonly number: number };
}

/**
 * Поправка, вошедшая в акт, — в виде ответа. Внутренних величин у неё нет.
 * День записи — день организации (П-68).
 */
function поправкаАкта(запись: ЗаписьПоправки, день: (мгновение: Date) => string): ActCorrection {
  return {
    id: запись.id,
    lineId: запись.actLineId,
    act: запись.actLine.tranche.number,
    into: запись.tranche.number,
    name: запись.actLine.name,
    unit: запись.actLine.unit,
    qtyBefore: запись.qtyBefore.toString(),
    qtyAfter: запись.qtyAfter.toString(),
    priceBefore: запись.priceBefore.toString(),
    priceAfter: запись.priceAfter.toString(),
    total: correctionTotal({
      было: { qty: milliunits(запись.qtyBefore), unitPrice: kopecks(запись.priceBefore) },
      стало: { qty: milliunits(запись.qtyAfter), unitPrice: kopecks(запись.priceAfter) },
    }).toString(),
    reason: запись.reason,
    createdAt: день(запись.createdAt),
  };
}

@Injectable()
export class ActsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: FileStorage,
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
   * Надбавка действующей сметы объекта — та же, по которой считается
   * клиентская сумма транша (БП-05). Взять её у объекта значило бы получить
   * в акте одно число, а в траншах другое. Зафиксированный акт несёт свою.
   */
  private async действующаяНадбавка(project: { id: string; supervisionShare: number }): Promise<BasisPoints> {
    const смета = await this.prisma.estimate.findFirst({
      where: { projectId: project.id },
      orderBy: { version: "desc" },
      select: { supervisionShare: true },
    });
    return basisPoints(смета?.supervisionShare ?? project.supervisionShare);
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
    const { day: день } = await orgDay(this.prisma, user.orgId);
    /* Надбавка нужна уже перечню: строка показывает ту же сумму, что стоит
       в подвале самого акта. Показывать в перечне одни работы, а в акте —
       работы с сопровождением значит назвать документ двумя числами, из
       которых меньшее видно сразу, а большее — только после раскрытия. */
    const share = await this.действующаяНадбавка(project);
    const транши = await this.prisma.tranche.findMany({
      where: { projectId: project.id, status: { in: ["CLOSED", "PAID"] } },
      orderBy: { number: "desc" },
      select: {
        id: true, number: true, closedAt: true, signedAt: true, paidAt: true,
        signedScanType: true, signedScanAt: true, fixedAt: true, fixedShare: true,
        actLines: { select: { qty: true, unitPrice: true } },
        corrections: { select: { qtyBefore: true, qtyAfter: true, priceBefore: true, priceAfter: true } },
        batches: {
          select: {
            acceptances: {
              select: {
                qty: true,
                item: { select: { unitPrice: true } },
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
        /* Зафиксированный акт считается по снимку и своей надбавке (ДР-3);
           живой — по приёмкам и действующей смете, как прежде. */
        const работы = транш.fixedAt !== null
          ? sum(транш.actLines.map((строка) =>
            multiplyByQuantity(kopecks(строка.unitPrice), milliunits(строка.qty))))
          : acceptedTotal(строки.map((строка) => ({
            qty: milliunits(строка.qty),
            unitPrice: kopecks(строка.item.unitPrice),
          })));
        const поправки = sum(транш.corrections.map((запись) => correctionTotal({
          было: { qty: milliunits(запись.qtyBefore), unitPrice: kopecks(запись.priceBefore) },
          стало: { qty: milliunits(запись.qtyAfter), unitPrice: kopecks(запись.priceAfter) },
        })));
        return {
          trancheId: транш.id,
          number: транш.number,
          closedAt: день(транш.closedAt),
          closedTime: транш.closedAt.toISOString(),
          signedAt: транш.signedAt === null ? null : деньКалендаря(транш.signedAt),
          fixedAt: транш.fixedAt === null ? null : день(транш.fixedAt),
          paidAt: транш.paidAt === null ? null : транш.paidAt.toISOString(),
          positions: транш.fixedAt !== null ? транш.actLines.length : строки.length,
          corrections: транш.corrections.length,
          total: clientTotals((работы + поправки) as Kopecks,
            транш.fixedShare === null ? share : basisPoints(транш.fixedShare)).total.toString(),
          scan: транш.signedScanType === null || транш.signedScanAt === null
            ? null
            : { type: транш.signedScanType, uploadedAt: день(транш.signedScanAt) },
        };
      });
  }

  /**
   * Один акт в выбранном виде.
   *
   * Зафиксированный акт (ДР-3) читается из снимка строк и своей надбавки;
   * живой — из приёмок и действующей сметы. Поправки к подписанным актам,
   * вошедшие в этот акт, стоят отдельным перечнем и входят в «Работы».
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
        fixedAt: true, fixedShare: true,
        actLines: {
          orderBy: { order: "asc" },
          select: {
            id: true, itemId: true, name: true, unit: true, qty: true, unitPrice: true,
            unitWage: true, wageTotal: true,
          },
        },
        corrections: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true, actLineId: true, qtyBefore: true, qtyAfter: true, priceBefore: true, priceAfter: true,
            reason: true, createdAt: true,
            actLine: { select: { name: true, unit: true, tranche: { select: { number: true } } } },
            tranche: { select: { number: true } },
          },
        },
        batches: {
          select: {
            acceptances: {
              select: {
                qty: true,
                item: {
                  select: {
                    id: true, name: true, unitPrice: true,
                    unit: { select: { code: true } },
                  },
                },
                accrual: { select: { unitWage: true, amount: true } },
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

    const организация = await this.prisma.organization.findUniqueOrThrow({ where: { id: user.orgId } });
    const { day: день } = await orgDay(this.prisma, user.orgId);
    const share = транш.fixedShare === null
      ? await this.действующаяНадбавка(project)
      : basisPoints(транш.fixedShare);
    const своды: readonly СтрокаАкта[] = транш.fixedAt !== null
      ? транш.actLines.map(строкаСнимка)
      : живойСвод(транш.batches);

    const lines = своды.map((свод) => {
      /* Количество в акте отличается от количества в смете — принято
         столько, сколько принято, а не столько, сколько заложено. */
      const запись = {
        name: свод.name,
        unit: свод.unit,
        unitPrice: kopecks(свод.unitPrice),
        qtyInAct: milliunits(свод.qty),
      };
      if (audience === "internal") {
        const строка = projectActLine(запись, "internal", свод.wage);
        return {
          id: свод.id,
          name: строка.name,
          unit: строка.unit,
          qty: строка.qty.toString(),
          unitPrice: строка.unitPrice.toString(),
          total: строка.total.toString(),
          unitWage: строка.unitWage === null ? null : строка.unitWage.toString(),
          wageTotal: строка.wageTotal.toString(),
          profit: строка.profit.toString(),
          profitShare: Number(строка.profitShare),
        };
      }
      const строка = projectActLine(запись, "client");
      return {
        id: свод.id,
        name: строка.name,
        unit: строка.unit,
        qty: строка.qty.toString(),
        unitPrice: строка.unitPrice.toString(),
        total: строка.total.toString(),
      };
    });

    const corrections = транш.corrections.map((запись) => поправкаАкта(запись, день));
    /* Поправки к строкам этого акта — где и чем он исправлен. Только у
       подписанного: у живого акта строк снимка, к которым пишут поправку,
       нет. В суммы акта они не входят. */
    const amendments = транш.fixedAt === null
      ? []
      : (await this.prisma.actCorrection.findMany({
        where: { actLine: { trancheId: транш.id } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true, actLineId: true, qtyBefore: true, qtyAfter: true, priceBefore: true, priceAfter: true,
          reason: true, createdAt: true,
          actLine: { select: { name: true, unit: true, tranche: { select: { number: true } } } },
          tranche: { select: { number: true } },
        },
      })).map((запись) => поправкаАкта(запись, день));
    const works = sum([
      ...lines.map((строка) => kopecks(строка.total)),
      ...corrections.map((поправка) => kopecks(поправка.total)),
    ]);
    const итоги = clientTotals(works, share);
    /* «Начислено» акта — начисления его строк. Поправки к подписанным актам
       начисления не несут (допущение ДР-3: поправка меняет только сумму для
       заказчика), поэтому в «начислено» не входят, а в прибыль входят
       вместе с работами. */
    const начислено: Kopecks = audience === "internal"
      ? sum(lines.map((строка) => kopecks(строка.wageTotal ?? "0")))
      : kopecks(0);

    return {
      audience,
      number: транш.number,
      trancheId: транш.id,
      closedAt: день(транш.closedAt),
      signedAt: транш.signedAt === null ? null : деньКалендаря(транш.signedAt),
      fixedAt: транш.fixedAt === null ? null : день(транш.fixedAt),
      project: { code: project.code, address: project.address },
      client: { name: project.client.name, requisites: project.client.requisites },
      contractor: {
        name: организация.name,
        phone: организация.phone,
        email: организация.email,
        requisites: организация.requisites,
      },
      lines,
      corrections,
      amendments,
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
   *
   * Первая отметка фиксирует акт (этап Э9, ДР-3): строки, какими заказчик
   * их видел, пишутся снимком вместе с надбавкой, и правка сметы больше их
   * не меняет; ставка и начислено снимка — из начислений приёмок (П-60).
   * Повторная отметка меняет только дату — снимок один.
   *
   * «Завтра» считается от дня организации, а не от UTC: по UTC в Воронеже
   * до трёх часов ночи сегодняшняя дата подписания отвергалась как будущая —
   * тот же класс, что у чека и платежа (фаза 0, дефект K10).
   */
  async sign(
    user: RequestUser, code: string, id: string, input: SignAct, now = new Date(),
  ): Promise<ActRow[]> {
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
    if (input.signedAt > (await orgDay(this.prisma, user.orgId, now)).today) {
      throw new BadRequestException({
        message: "Дата подписания позже сегодняшней. Подписанного завтра не бывает.",
      });
    }
    const share = await this.действующаяНадбавка(project);

    await this.prisma.$transaction(async (tx) => {
      /* Строка транша запирается до снимка (П-67, класс K3): сторно пакета
         проверяет фиксацию под разделяемой блокировкой той же строки
         (`AcceptanceService.reverse`) и ждёт снимка — или снимок ждёт его.
         Сторно, записанное раньше, снимок видит; позже — получает отказ. */
      await tx.$queryRaw`SELECT "id" FROM "tranches" WHERE "id" = ${транш.id}::uuid FOR UPDATE`;
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
        oldValue: транш.signedAt === null ? null : formatDay(деньКалендаря(транш.signedAt)),
        newValue: formatDay(input.signedAt),
      }, tx);

      /* Фиксация — условным обновлением: прочитать «не зафиксирован» и
         зафиксировать двумя шагами значило записать снимок дважды двумя
         одновременными отметками (тот же образец, что у погашения ссылки,
         П-24). */
      const фиксация = await tx.tranche.updateMany({
        where: { id: транш.id, fixedAt: null },
        data: { fixedAt: new Date(), fixedShare: Number(share) },
      });
      if (фиксация.count === 0) return;
      const пакеты = await tx.acceptanceBatch.findMany({
        where: { trancheId: транш.id },
        select: {
          acceptances: {
            select: {
              qty: true,
              item: {
                select: {
                  id: true, name: true, unitPrice: true,
                  unit: { select: { code: true } },
                },
              },
              accrual: { select: { unitWage: true, amount: true } },
            },
          },
        },
      });
      /* Ставка и начислено снимка — из начислений приёмок строки той же
         транзакцией (П-60): правка ставки сметы между приёмкой и подписью
         подписанный акт не сдвигает. */
      const строки = живойСвод(пакеты);
      await tx.actLine.createMany({
        data: строки.map((строка, order) => ({
          trancheId: транш.id,
          itemId: строка.itemId,
          order,
          name: строка.name,
          unit: строка.unit,
          qty: строка.qty,
          unitPrice: строка.unitPrice,
          unitWage: строка.wage.unitWage,
          wageTotal: строка.wage.wageTotal,
        })),
      });
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "Tranche",
        entityId: транш.id,
        field: `акт № ${String(транш.number)} — фиксация`,
        oldValue: null,
        newValue: `строк ${String(строки.length)}`,
      }, tx);
    });

    return this.list(user, code);
  }

  /**
   * Поправка к строке подписанного акта (этап Э9, ДР-3).
   *
   * Подписанный акт не меняется: поправка входит строкой в акт открытого
   * транша объекта, и заказчик подписывает её вместе с ним. «Было» берётся
   * из снимка или из последней поправки той же строки — под блокировкой
   * строки, иначе две одновременные поправки посчитали бы разницу от одного
   * «было» и учли бы её дважды.
   */
  async correct(
    user: RequestUser,
    code: string,
    id: string,
    input: CreateActCorrection,
  ): Promise<ActRow[]> {
    if (!ownerLevel(user.role)) {
      throw new ForbiddenException({ message: "Поправку к акту оформляет руководитель." });
    }
    const project = await this.projectOf(user, code);
    const акт = await this.prisma.tranche.findFirst({
      where: { id, projectId: project.id },
      select: { id: true, number: true, fixedAt: true },
    });
    if (!акт) throw new NotFoundException({ message: "Акт не найден или недоступен." });
    if (акт.fixedAt === null) {
      throw new BadRequestException({
        message: `Акт № ${String(акт.number)} не подписан и следует за сметой: его исправляет правка сметы, `
          + "а не поправка.",
      });
    }
    const текущий = await this.prisma.tranche.findFirst({
      where: { projectId: project.id, status: "OPEN" },
      select: { id: true, number: true },
    });
    if (текущий === null) {
      throw new BadRequestException({
        message: "У объекта нет открытого транша: поправка входит в акт текущего транша. "
          + "Откройте транш на вкладке «Транши».",
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "act_lines" WHERE "id" = ${input.lineId}::uuid FOR UPDATE`;
      const строка = await tx.actLine.findFirst({
        where: { id: input.lineId, trancheId: акт.id },
        select: {
          id: true, name: true, unit: true, qty: true, unitPrice: true,
          corrections: { orderBy: { createdAt: "asc" }, select: { qtyAfter: true, priceAfter: true } },
        },
      });
      if (строка === null) {
        throw new NotFoundException({ message: `Строка не найдена в акте № ${String(акт.number)}.` });
      }
      const было = correctedState(
        { qty: milliunits(строка.qty), unitPrice: kopecks(строка.unitPrice) },
        строка.corrections.map((запись) => ({
          стало: { qty: milliunits(запись.qtyAfter), unitPrice: kopecks(запись.priceAfter) },
        })),
      );
      const стало = { qty: milliunits(input.qty), unitPrice: kopecks(input.unitPrice) };
      const ошибка = correctionFault({ было, стало, причина: input.reason });
      if (ошибка !== null) throw new BadRequestException({ message: ошибка });

      await tx.actCorrection.create({
        data: {
          actLineId: строка.id,
          trancheId: текущий.id,
          qtyBefore: было.qty,
          qtyAfter: стало.qty,
          priceBefore: было.unitPrice,
          priceAfter: стало.unitPrice,
          reason: input.reason.trim(),
          createdById: user.id,
        },
      });
      /* Запись журнала — на транш подписанного акта: лента показывает её в
         «Документах» рядом с его подписанием, тем же правилом видимости. */
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "Tranche",
        entityId: акт.id,
        field: `акт № ${String(акт.number)} — поправка «${строка.name}» в акт № ${String(текущий.number)}`,
        oldValue: `${количествоСловами(было.qty)} ${строка.unit} × ${formatKopecks(было.unitPrice)}`,
        newValue: `${количествоСловами(стало.qty)} ${строка.unit} × ${formatKopecks(стало.unitPrice)}; `
          + `причина: ${input.reason.trim()}`,
      }, tx);
    });

    return this.list(user, code);
  }

  /**
   * Скан подписанного экземпляра акта (план, пункт 4.10).
   *
   * Отметка подписания хранила одну дату, а бумага с подписью заказчика
   * жила в папке. Скан прикладывается к подписанному акту — без даты
   * подписания он ничего не подтверждает. Снимок перекодируется без
   * метаданных (П-39), PDF кладётся как есть. Новый скан заменяет прежний:
   * подписанный экземпляр один, а замена пишется в журнал.
   */
  async attachScan(user: RequestUser, code: string, id: string, body: Buffer): Promise<ActRow[]> {
    if (!ownerLevel(user.role)) {
      throw new ForbiddenException({ message: "Скан подписанного акта прикладывает руководитель." });
    }
    const project = await this.projectOf(user, code);
    const транш = await this.prisma.tranche.findFirst({
      where: { id, projectId: project.id },
      select: { id: true, number: true, signedAt: true, signedScanKey: true },
    });
    if (!транш) throw new NotFoundException({ message: "Акт не найден или недоступен." });
    if (транш.signedAt === null) {
      throw new BadRequestException({
        message: `Акт № ${String(транш.number)} не отмечен подписанным: сначала поставьте дату подписания, затем приложите скан.`,
      });
    }
    const тип = типСкана(body);
    if (тип === null) {
      throw new BadRequestException({
        message: "Скан принимается снимком (JPEG, PNG, WebP) или файлом PDF. Тип определяется по содержимому файла, а не по расширению.",
      });
    }
    const файл = тип.type === "application/pdf"
      ? body
      : await безМетаданных(body, тип.type);
    const key = `projects/${project.id}/acts/${randomUUID()}.${тип.extension}`;
    await this.storage.put(key, файл, тип.type);
    await this.prisma.$transaction(async (tx) => {
      await tx.tranche.update({
        where: { id: транш.id },
        data: { signedScanKey: key, signedScanType: тип.type, signedScanAt: new Date() },
      });
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "Tranche",
        entityId: транш.id,
        field: `акт № ${String(транш.number)} — скан подписанного экземпляра`,
        oldValue: транш.signedScanKey === null ? null : "прежний скан",
        newValue: "приложен",
      }, tx);
    });
    if (транш.signedScanKey !== null) await this.storage.remove(транш.signedScanKey);
    return this.list(user, code);
  }

  /**
   * Файл скана. Видят руководитель, бухгалтер и заказчик своего объекта:
   * на бумаге подпись заказчика, прорабу она ни к чему.
   */
  async readScan(user: RequestUser, code: string, id: string): Promise<{
    body: Buffer; contentType: string; fileName: string;
  }> {
    if (user.role === "FOREMAN") {
      throw new ForbiddenException({ message: "Скан подписанного акта видят руководитель, бухгалтер и заказчик." });
    }
    const project = await this.projectOf(user, code);
    const транш = await this.prisma.tranche.findFirst({
      where: { id, projectId: project.id },
      select: { number: true, signedScanKey: true, signedScanType: true },
    });
    const ключ = транш?.signedScanKey ?? null;
    const тип = транш?.signedScanType ?? null;
    if (!транш || ключ === null || тип === null) {
      throw new NotFoundException({ message: "Скан к этому акту не приложен." });
    }
    const расширение = ключ.slice(ключ.lastIndexOf(".") + 1);
    return {
      body: await this.storage.get(ключ),
      contentType: тип,
      fileName: `akt-${String(транш.number)}-podpisan.${расширение}`,
    };
  }
}
