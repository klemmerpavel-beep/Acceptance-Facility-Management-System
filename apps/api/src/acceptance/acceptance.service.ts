import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  AcceptanceBatch, AcceptanceView, CreateAcceptance, PhotoReport, Reversal,
} from "@priyomka/contracts";
import {
  acceptanceFault, acceptedQty, acceptedTotal, accrualAmount, accrualSummary,
  accrualsByTranche, groupByDay, photoSections, kopecks, milliunits, negateQuantity, ownerLevel,
  remainingQty, sum,
  type Kopecks, type Milliunits, type TrancheAccrualRecord,
} from "@priyomka/domain";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma.service";
import { AuditService } from "../common/audit.service";
import { currentEstimate } from "../common/current-estimate";
import { topLevelSections } from "../common/section-rollup";
import { FileStorage } from "../common/file-storage";
import { IMAGE_EXTENSION, type ImageType } from "../measure/image-type";
import type { RequestUser } from "../common/current-user";
import { projectScope } from "../common/project-scope";

/**
 * Приёмка выполненных работ — ядро продукта.
 *
 * Одно действие прораба порождает три следствия сразу: принятое количество
 * позиции, начисление сдельной оплаты бригаде и рост выполненного на сумму.
 * Все три записываются одной транзакцией: пакет, у которого начислилось не
 * всё, хуже, чем пакет, не записавшийся вовсе.
 *
 * Разграничение на уровне полей
 * -----------------------------
 * Ставка, начисленное и свод по бригадам собираются только для роли OWNER.
 * Сумма начисления прорабу не отдаётся: начисление есть ставка, умноженная
 * на количество, и при известном количестве сумма выдаёт ставку
 * арифметически. Ключи для прочих ролей не создаются вовсе — не «есть, но
 * `null`», а отсутствуют, как в проекции сметы.
 */

/** Неделя свода: семь дней назад включительно. */
const НЕДЕЛЯ_ДНЕЙ = 7;

const iso = (date: Date): string => date.toISOString().slice(0, 10);

@Injectable()
export class AcceptanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: FileStorage,
  ) {}

  /** Видимость объекта берётся из общего правила: своего здесь нет. */
  private async projectOf(user: RequestUser, code: string) {
    const project = await this.prisma.project.findFirst({
      where: { ...projectScope(user), code },
      select: { id: true, code: true },
    });
    if (!project) {
      throw new NotFoundException({ message: `Объект ${code} не найден или недоступен.` });
    }
    return project;
  }

  /** Действующая редакция сметы объекта. Приёмка ведётся по ней. */
  private async estimateOf(projectId: string) {
    const estimate = await currentEstimate(this.prisma, projectId);
    if (estimate === null) {
      throw new BadRequestException({
        message: "У объекта нет сметы. Принимать нечего: приёмке подлежат позиции сметы.",
      });
    }
    return estimate;
  }

  async view(user: RequestUser, code: string): Promise<AcceptanceView> {
    const project = await this.projectOf(user, code);
    return this.build(user, project.id);
  }

  /**
   * Собрать вид вкладки целиком.
   *
   * Читается четырьмя запросами, а не по разделу на каждый: у R-99
   * одиннадцать разделов и сто тридцать две позиции, и запрос на раздел
   * дал бы дюжину обращений на один экран.
   */
  private async build(user: RequestUser, projectId: string): Promise<AcceptanceView> {
    const внутренние = ownerLevel(user.role);
    const estimate = await this.prisma.estimate.findFirst({
      where: { projectId },
      orderBy: { version: "desc" },
      select: { id: true },
    });
    if (estimate === null) {
      return {
        sections: [], batches: [],
        totals: { positions: 0, acceptedPositions: 0, accepted: "0", ...(внутренние ? { accrued: "0" } : {}) },
        ...(внутренние ? { accruals: [] } : {}),
      };
    }

    const [sections, items, stages, acceptances, открытыйТранш] = await Promise.all([
      this.prisma.estimateSection.findMany({
        where: { estimateId: estimate.id, parentId: null },
        orderBy: { order: "asc" },
        select: { id: true, name: true, order: true },
      }),
      this.prisma.estimateItem.findMany({
        where: { estimateId: estimate.id },
        orderBy: { order: "asc" },
        select: {
          id: true, sectionId: true, name: true, order: true,
          qty: true, unitPrice: true, unitWage: true,
          unit: { select: { code: true } },
        },
      }),
      this.prisma.workStage.findMany({
        where: { projectId, NOT: { sectionId: null } },
        select: {
          id: true, name: true, sectionId: true,
          brigade: { select: { id: true, name: true } },
        },
      }),
      /* Приёмки берутся только по позициям действующей редакции сметы.
         Приёмка привязана к своей редакции (Р11): после нового импорта
         прежние относятся к позициям, которых в действующей смете уже нет.
         Смешивать их с текущими нельзя — вид показывал бы «принято ноль
         позиций» и «начислено четыреста тысяч» одновременно. Прежние
         приёмки остаются в базе и в журнале объекта. */
      this.prisma.acceptance.findMany({
        where: { batch: { projectId }, item: { estimateId: estimate.id } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true, batchId: true, itemId: true, qty: true, reason: true,
          reversesId: true, createdAt: true,
          createdBy: { select: { name: true } },
          accrual: { select: { amount: true, brigadeId: true, createdAt: true } },
          /* Транш берётся у пакета, а не у начисления: пакет есть единица
             приёмки, и все его строки зачтены в один и тот же транш. */
          batch: { select: { trancheId: true } },
        },
      }),
      this.prisma.tranche.findFirst({
        where: { projectId, status: "OPEN" },
        select: { id: true },
      }),
    ]);

    /* Позиции раскладываются по разделам верхнего уровня общим правилом:
       по этой же карте считает фактическую готовность график. */
    const поРазделу = new Map<string, typeof items>();
    const верхний = await topLevelSections(this.prisma, estimate.id);

    for (const item of items) {
      const ключ = верхний.get(item.sectionId) ?? item.sectionId;
      const список = поРазделу.get(ключ) ?? [];
      список.push(item);
      поРазделу.set(ключ, список);
    }

    const поПозиции = new Map<string, { qty: Milliunits }[]>();
    for (const record of acceptances) {
      const список = поПозиции.get(record.itemId) ?? [];
      список.push({ qty: milliunits(record.qty) });
      поПозиции.set(record.itemId, список);
    }

    const этапРаздела = new Map(stages.map((stage) => [stage.sectionId ?? "", stage]));

    let принятыхПозиций = 0;
    const принятые: { qty: Milliunits; unitPrice: Kopecks }[] = [];

    const виды = sections.map((section) => {
      const stage = этапРаздела.get(section.id);
      return {
        id: section.id,
        name: section.name,
        order: section.order,
        stage: stage === undefined ? null : {
          id: stage.id,
          name: stage.name,
          brigade: stage.brigade,
        },
        positions: (поРазделу.get(section.id) ?? []).map((item) => {
          const accepted = acceptedQty(поПозиции.get(item.id) ?? []);
          if (accepted > 0n) принятыхПозиций += 1;
          if (accepted !== 0n) {
            принятые.push({ qty: accepted, unitPrice: kopecks(item.unitPrice) });
          }
          return {
            id: item.id,
            name: item.name,
            unit: item.unit.code,
            order: item.order,
            qty: item.qty.toString(),
            accepted: accepted.toString(),
            remaining: remainingQty(milliunits(item.qty), accepted).toString(),
            unitPrice: item.unitPrice.toString(),
            ...(внутренние ? { unitWage: item.unitWage.toString() } : {}),
          };
        }),
      };
    });

    const batches = await this.batches(projectId, estimate.id, acceptances, внутренние);

    const начислено = внутренние
      ? sum(acceptances.map((row) => kopecks(row.accrual?.amount ?? 0n)))
      : kopecks(0);

    const totals = {
      positions: items.length,
      acceptedPositions: принятыхПозиций,
      accepted: acceptedTotal(принятые).toString(),
      ...(внутренние ? { accrued: начислено.toString() } : {}),
    };

    if (!внутренние) return { sections: виды, batches, totals };

    const бригады = new Map(stages.flatMap((stage) =>
      stage.brigade === null ? [] : [[stage.brigade.id, stage.brigade.name] as const]));
    const записи: TrancheAccrualRecord[] = acceptances.flatMap((row) =>
      row.accrual === null ? [] : [{
        brigadeId: row.accrual.brigadeId,
        brigadeName: бригады.get(row.accrual.brigadeId) ?? "Бригада снята",
        amount: kopecks(row.accrual.amount),
        at: iso(row.accrual.createdAt),
        trancheId: row.batch.trancheId,
      }]);

    const сегодня = new Date();
    const неделяОт = new Date(сегодня);
    неделяОт.setUTCDate(неделяОт.getUTCDate() - НЕДЕЛЯ_ДНЕЙ);
    const заНеделю = new Map(
      accrualSummary(записи, { from: iso(неделяОт), to: iso(сегодня) })
        .map((row) => [row.brigadeId, row.amount]),
    );

    /* Разрез «за транш» (пункт плана 3.10). Отбор по траншу, а не по датам
       его открытия и закрытия: приёмка привязывается к траншу в момент
       записи, и отбор по датам разошёлся бы с этой привязкой на любом
       переносе закрытия. Открытого транша нет — разрезать нечем, и строка
       получает null, а не ноль: ноль означал бы «за транш не начислено». */
    const заТранш = открытыйТранш === null
      ? null
      : new Map(accrualsByTranche(записи, открытыйТранш.id).map((row) => [row.brigadeId, row.amount]));

    const accruals = accrualSummary(записи).map((row) => ({
      brigadeId: row.brigadeId,
      brigadeName: row.brigadeName,
      week: (заНеделю.get(row.brigadeId) ?? kopecks(0)).toString(),
      total: row.amount.toString(),
      tranche: заТранш === null ? null : (заТранш.get(row.brigadeId) ?? kopecks(0)).toString(),
    }));

    return { sections: виды, batches, totals, accruals };
  }

  /** Пакеты объекта с их строками. Новые сверху: смотрят на последнее. */
  private async batches(
    projectId: string,
    estimateId: string,
    acceptances: readonly {
      id: string; batchId: string; itemId: string; qty: bigint; reason: string | null;
      reversesId: string | null; createdAt: Date;
      createdBy: { name: string } | null;
      accrual: { amount: bigint; brigadeId: string; createdAt: Date } | null;
    }[],
    внутренние: boolean,
  ): Promise<AcceptanceBatch[]> {
    const rows = await this.prisma.acceptanceBatch.findMany({
      where: { projectId, section: { estimateId } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, sectionId: true, createdAt: true, comment: true,
        section: { select: { name: true } },
        brigade: { select: { id: true, name: true } },
        createdBy: { select: { name: true } },
        photos: { select: { id: true } },
      },
    });

    const позиции = await this.prisma.estimateItem.findMany({
      where: { id: { in: [...new Set(acceptances.map((row) => row.itemId))] } },
      select: { id: true, name: true, unit: { select: { code: true } } },
    });
    const поId = new Map(позиции.map((item) => [item.id, item]));

    /* Сторнированная приёмка помечается временем и причиной своего сторно:
       читателю нужно видеть, что запись отменена, не разыскивая обратную. */
    const сторно = new Map(acceptances.flatMap((row) =>
      row.reversesId === null ? [] : [[row.reversesId, row] as const]));

    return rows.map((batch) => ({
      id: batch.id,
      sectionId: batch.sectionId,
      sectionName: batch.section.name,
      brigade: batch.brigade,
      createdAt: batch.createdAt.toISOString(),
      author: batch.createdBy?.name ?? null,
      comment: batch.comment,
      photos: batch.photos.map((photo) => photo.id),
      lines: acceptances
        .filter((row) => row.batchId === batch.id && row.reversesId === null)
        .map((row) => {
          const отмена = сторно.get(row.id);
          const item = поId.get(row.itemId);
          return {
            id: row.id,
            positionName: item?.name ?? "Позиция снята",
            unit: item?.unit.code ?? "",
            qty: row.qty.toString(),
            reversedAt: отмена === undefined ? null : отмена.createdAt.toISOString(),
            reason: отмена?.reason ?? null,
            ...(внутренние ? { amount: (row.accrual?.amount ?? 0n).toString() } : {}),
          };
        }),
    }));
  }

  /**
   * Фотоотчёт объекта (стадия C.4).
   *
   * Снимки приёмки попадают сюда сами: прораб фотографирует один раз, и
   * второго места, куда их складывать, продукт не заводит.
   *
   * Отбора по редакции сметы здесь НЕТ, в отличие от вида приёмки. Вид
   * приёмки отвечает на вопрос «что принято по действующей смете», а отчёт —
   * на вопрос «что сделано на объекте», и повторный импорт этого не
   * отменяет: снимок сделан, работа была. То же правило, по которому счёт
   * транша не отбирается по редакции.
   *
   * Денежных величин в отчёте нет ни одной, ни одной роли: это отчёт о
   * сделанном, а не о начисленном.
   */
  async report(user: RequestUser, code: string): Promise<PhotoReport> {
    const project = await this.projectOf(user, code);

    const пакеты = await this.prisma.acceptanceBatch.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, sectionId: true, createdAt: true, comment: true,
        section: { select: { name: true } },
        brigade: { select: { name: true } },
        createdBy: { select: { name: true } },
        photos: { select: { id: true } },
        acceptances: {
          select: {
            id: true, itemId: true, qty: true, reversesId: true,
            item: { select: { name: true, unit: { select: { code: true } } } },
          },
        },
      },
    });

    const отчёт = пакеты.map((пакет) => {
      /* Сторно приходит обратной записью внутри того же пакета: строка
         считается отменённой, если её опознаватель кто-то сторнировал. */
      const отменены = new Set(пакет.acceptances.flatMap((row) =>
        row.reversesId === null ? [] : [row.reversesId]));
      const строки = пакет.acceptances
        .filter((row) => row.reversesId === null)
        .map((row) => ({
          positionName: row.item.name,
          unit: row.item.unit.code,
          qty: row.qty.toString(),
          reversed: отменены.has(row.id),
        }));
      return {
        id: пакет.id,
        sectionId: пакет.sectionId,
        sectionName: пакет.section.name,
        brigade: пакет.brigade.name,
        at: пакет.createdAt.toISOString(),
        author: пакет.createdBy?.name ?? null,
        comment: пакет.comment,
        photos: пакет.photos.map((photo) => photo.id),
        lines: строки,
        /* Пакет, все строки которого сторнированы, помечается целиком, но
           не прячется: история не переписывается (БП-04). Показать его как
           сделанное значило бы солгать заказчику. */
        reversed: строки.length > 0 && строки.every((строка) => строка.reversed),
      };
    });


    /* Раскладка по дням — доменное правило (`groupByDay`): на стенде все
       приёмки приходятся на один день, и порядок дней поверх HTTP проверить
       нечем — испытывается он тестом домена. */
    const дни = groupByDay(отчёт);

    return {
      days: дни.map((день) => ({ day: день.day, batches: день.items })),
      /* Разделы отбора «по этапу» — тоже доменное правило: у каждого
         пакета стенда ровно один снимок, и «считать снимки» там неотличимо
         от «считать пакеты». Отличимо это в тесте домена. */
      sections: photoSections(отчёт),
      totals: {
        photos: отчёт.reduce((всего, пакет) => всего + пакет.photos.length, 0),
        batches: отчёт.length,
        days: дни.length,
      },
    };
  }

  /**
   * Завести пакет приёмки.
   *
   * Порядок проверок: доступ к объекту, смета, раздел, этап с бригадой,
   * фотография, затем количества. Первый отказ возвращается сразу —
   * человеку нужна одна причина, а не список.
   */
  async create(
    user: RequestUser,
    code: string,
    input: CreateAcceptance,
    photo: { fileName: string; contentType: ImageType; buffer: Buffer },
  ): Promise<AcceptanceView> {
    const project = await this.projectOf(user, code);
    const estimate = await this.estimateOf(project.id);

    const section = await this.prisma.estimateSection.findFirst({
      where: { id: input.sectionId, estimateId: estimate.id },
      select: { id: true, name: true },
    });
    if (section === null) {
      throw new NotFoundException({ message: "Раздел не найден в действующей смете объекта." });
    }

    const stage = await this.prisma.workStage.findFirst({
      where: { projectId: project.id, sectionId: section.id },
      select: { id: true, name: true, brigadeId: true },
    });
    /* Бригада вынимается отдельной переменной: ниже она нужна суженной до
       строки, а «этап есть, бригады нет» и «этапа нет» для человека одно и
       то же — начислять некому. */
    const brigadeId = stage?.brigadeId ?? null;
    if (brigadeId === null) {
      throw new BadRequestException({
        message: `У раздела «${section.name}» нет этапа графика с бригадой. `
          + "Свяжите раздел с этапом на вкладке «Работа»: начисление адресуется бригаде этапа.",
      });
    }

    /* Позиции берутся вместе с принятым: проверить остаток можно только
       зная, сколько уже принято, а это сумма записей, а не поле. */
    const items = await this.prisma.estimateItem.findMany({
      where: { id: { in: input.positions.map((position) => position.itemId) }, estimateId: estimate.id },
      select: {
        id: true, name: true, qty: true, unitWage: true,
        unit: { select: { code: true } },
        acceptances: { select: { qty: true } },
      },
    });
    const поId = new Map(items.map((item) => [item.id, item]));

    for (const position of input.positions) {
      const item = поId.get(position.itemId);
      if (item === undefined) {
        throw new NotFoundException({ message: "Позиция не найдена в действующей смете объекта." });
      }
      const fault = acceptanceFault({
        requested: milliunits(position.qty),
        qty: milliunits(item.qty),
        accepted: acceptedQty(item.acceptances.map((row) => ({ qty: milliunits(row.qty) }))),
        unit: item.unit.code,
      });
      if (fault !== null) throw new BadRequestException({ message: `${item.name}. ${fault}` });
    }

    /* Ключ собирает сервер из опознавателя объекта, а не из его кода:
       код содержит заглавные буквы, а правило ключей хранилища их не
       допускает. Файл кладётся до транзакции — запись в базе без файла
       хуже, чем файл без записи: второе видно уборкой, первое ничем. */
    const key = `projects/${project.id}/acceptance/${randomUUID()}.${IMAGE_EXTENSION[photo.contentType]}`;
    await this.storage.put(key, photo.buffer, photo.contentType);

    /* Транш проставляется снимком, как и бригада: открытие транша задним
       числом не должно переписывать уже принятое (БП-04). Открытого транша
       нет — пакет остаётся без него и попадает в разрез «вне транша».
       Отсутствие транша приёмку не запрещает: прораб не заводит транши, и
       отказать ему за то, чего он не делает, значило бы остановить работу. */
    const транш = await this.prisma.tranche.findFirst({
      where: { projectId: project.id, status: "OPEN" },
      select: { id: true },
    });

    await this.prisma.$transaction(async (tx) => {
      const batch = await tx.acceptanceBatch.create({
        data: {
          projectId: project.id,
          sectionId: section.id,
          brigadeId,
          trancheId: транш?.id ?? null,
          createdById: user.id,
          ...(input.comment === undefined ? {} : { comment: input.comment }),
        },
        select: { id: true },
      });

      await tx.acceptancePhoto.create({
        data: {
          batchId: batch.id,
          storageKey: key,
          fileName: photo.fileName,
          contentType: photo.contentType,
          byteSize: photo.buffer.byteLength,
          uploadedById: user.id,
        },
      });

      for (const position of input.positions) {
        const item = поId.get(position.itemId);
        if (item === undefined) continue;
        const qty = milliunits(position.qty);
        const acceptance = await tx.acceptance.create({
          data: { batchId: batch.id, itemId: item.id, qty, createdById: user.id },
          select: { id: true },
        });
        /* Ставка копируется снимком (БП-03): правка сметы задним числом
           не переписывает начисленное. */
        await tx.wageAccrual.create({
          data: {
            acceptanceId: acceptance.id,
            brigadeId,
            unitWage: item.unitWage,
            amount: accrualAmount(kopecks(item.unitWage), qty),
          },
        });
      }

      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "AcceptanceBatch",
        entityId: batch.id,
        field: `приёмка: ${section.name}, этап «${stage?.name ?? ""}»`,
        oldValue: null,
        newValue: `позиций ${String(input.positions.length)}`,
      });
    });

    return this.build(user, project.id);
  }

  /**
   * Сторнировать приёмку (БП-04).
   *
   * Создаётся обратная запись в том же пакете: свидетельство остаётся при
   * своей фотографии. Начисление сторнируется симметрично, и пара
   * складывается в ноль. Повторное сторно отсекается уникальностью ссылки
   * на сторнируемую приёмку — правилом базы, а не проверкой в коде.
   */
  async reverse(
    user: RequestUser,
    code: string,
    acceptanceId: string,
    input: Reversal,
  ): Promise<AcceptanceView> {
    const project = await this.projectOf(user, code);

    const original = await this.prisma.acceptance.findFirst({
      where: { id: acceptanceId, batch: { projectId: project.id } },
      select: {
        id: true, batchId: true, itemId: true, qty: true, reversesId: true,
        item: { select: { name: true } },
        accrual: { select: { unitWage: true, brigadeId: true } },
        reversal: { select: { id: true } },
      },
    });
    if (original === null) {
      throw new NotFoundException({ message: "Приёмка не найдена на этом объекте." });
    }
    if (original.reversesId !== null) {
      throw new BadRequestException({
        message: "Это сторно, а не приёмка. Сторнировать обратную запись нельзя: "
          + "история не переписывается.",
      });
    }
    if (original.reversal !== null) {
      throw new BadRequestException({ message: "Эта приёмка уже сторнирована." });
    }

    const qty = negateQuantity(milliunits(original.qty));

    await this.prisma.$transaction(async (tx) => {
      const reversal = await tx.acceptance.create({
        data: {
          batchId: original.batchId,
          itemId: original.itemId,
          qty,
          reason: input.reason,
          reversesId: original.id,
          createdById: user.id,
        },
        select: { id: true },
      });

      if (original.accrual !== null) {
        await tx.wageAccrual.create({
          data: {
            acceptanceId: reversal.id,
            brigadeId: original.accrual.brigadeId,
            unitWage: original.accrual.unitWage,
            amount: accrualAmount(kopecks(original.accrual.unitWage), qty),
          },
        });
      }

      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "Acceptance",
        entityId: original.id,
        field: `сторно приёмки «${original.item.name}»`,
        oldValue: original.qty.toString(),
        newValue: input.reason,
      });
    });

    return this.build(user, project.id);
  }

  /** Фотография пакета для отдачи клиенту. */
  async photo(user: RequestUser, code: string, photoId: string) {
    const project = await this.projectOf(user, code);
    const photo = await this.prisma.acceptancePhoto.findFirst({
      where: { id: photoId, batch: { projectId: project.id } },
      select: { storageKey: true, fileName: true, contentType: true },
    });
    if (photo === null) {
      throw new NotFoundException({ message: "Снимок не найден на этом объекте." });
    }
    return photo;
  }
}
