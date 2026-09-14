import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  DisplacedByImport, EstimateView, ImportRecord, ImportReport, ImportResult,
  UpdateEstimateItem, UpdateSupervision,
} from "@priyomka/contracts";
import {
  buildDiscrepancyReport, buildTemplate, parseWorkbook,
  CANONICAL_UNITS, type CanonicalUnit, type ParsedItem, type UnitOverrides,
} from "@priyomka/importer";
import {
  acceptedQty, acceptedTotal, basisPoints, buildEstimateView, estimateItemFault,
  formatKopecks, formatPercent, kopecks, количествоТекстом, milliunits,
} from "@priyomka/domain";
import { toEstimateViewDto } from "./estimate.mapper";
import { PrismaService } from "../prisma.service";
import { AuditService } from "../common/audit.service";
import { currentEstimate } from "../common/current-estimate";
import type { RequestUser } from "../common/current-user";
import { projectScope } from "../common/project-scope";
import { toImportReport } from "./report.mapper";


/**
 * Идентификатор единицы измерения. Карта заполняется до цикла записи по тем
 * же написаниям, что пришли из разбора, поэтому промах означает расхождение
 * разбора и сопоставления — отказ здесь лучше, чем запись со ссылкой на
 * чужую единицу.
 */
function unitId(units: ReadonlyMap<string, string>, unit: string): string {
  const found = units.get(unit);
  if (found === undefined) {
    throw new Error(`Единица «${unit}» не сопоставлена: разбор и сопоставление разошлись.`);
  }
  return found;
}

/**
 * Подписи полей для журнала объекта.
 *
 * «unitPrice» в ленте событий читателю ничего не говорит, а спор звучит как
 * «кто поменял цену», а не «кто правил позицию» — тот же довод, что у обмера.
 */
const FIELD_LABEL: Readonly<Record<string, string>> = {
  name: "наименование",
  unit: "единица",
  qty: "количество",
  unitPrice: "цена единицы",
  unitWage: "ставка оплаты труда",
};

/** Поля позиции, правка которых пишется в журнал по отдельности. */
const ITEM_FIELDS = ["name", "unit", "qty", "unitPrice", "unitWage"] as const;

/**
 * Значение поля в том виде, в каком его читает человек.
 *
 * Журнал читает человек и только человек: машинного потребителя у него нет.
 * Сырые копейки в записи «115050 → 120000» читаются как рубли и врут в сто
 * раз, а количество в тысячных не читается вовсе. Формы берутся общие — те
 * же, которыми числа показаны на экранах.
 */
function значениеДляЖурнала(field: string, value: string | null, unit: string): string | null {
  if (value === null) return null;
  if (field === "unitPrice" || field === "unitWage") return formatKopecks(kopecks(value));
  if (field === "qty") return количествоТекстом(milliunits(value), unit);
  return value;
}

@Injectable()
export class EstimatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Видимость объекта берётся из общего правила: своего здесь нет. */
  private async projectOf(user: RequestUser, code: string) {
    const project = await this.prisma.project.findFirst({ where: { ...projectScope(user), code } });
    if (!project) throw new NotFoundException({ message: `Объект ${code} не найден или недоступен.` });
    return project;
  }

  /** Разбор без записи: показывает отчёт и написания единиц, ждущие решения. */
  async preview(user: RequestUser, code: string, file: Buffer, overrides: UnitOverrides): Promise<ImportReport> {
    await this.projectOf(user, code);
    const parsed = await parseWorkbook(file, overrides);
    return toImportReport(buildDiscrepancyReport(parsed));
  }

  /**
   * Что уйдёт из вида приёмки при записи новой редакции.
   *
   * Приёмка привязана к своей редакции (Р11): после импорта принятые
   * позиции действующей редакции остаются в базе и в журнале, но вкладка
   * приёмки их больше не покажет — она отбирает по действующей. Это
   * поведение принято заказчиком; не названо оно было только там, где
   * человек нажимает кнопку.
   *
   * Считается по действующей редакции, а не по всем приёмкам объекта:
   * приёмки прежних редакций из вида ушли уже и второй раз не уходят.
   * Суммы — теми же правилами домена, что у вида приёмки: два свода одного
   * и того же обязаны совпасть до копейки.
   */
  async displacedByImport(user: RequestUser, code: string): Promise<DisplacedByImport | null> {
    const project = await this.projectOf(user, code);
    const estimate = await currentEstimate(this.prisma, project.id);
    if (estimate === null) return null;

    const приёмки = await this.prisma.acceptance.findMany({
      where: { batch: { projectId: project.id }, item: { estimateId: estimate.id } },
      select: { itemId: true, qty: true, batchId: true, item: { select: { unitPrice: true } } },
    });

    const поПозиции = new Map<string, { qty: bigint; unitPrice: bigint }>();
    for (const запись of приёмки) {
      const прежнее = поПозиции.get(запись.itemId);
      поПозиции.set(запись.itemId, {
        qty: (прежнее?.qty ?? 0n) + запись.qty,
        unitPrice: запись.item.unitPrice,
      });
    }

    const принятые = [...поПозиции.values()]
      .map((row) => ({ qty: acceptedQty([{ qty: milliunits(row.qty) }]), unitPrice: kopecks(row.unitPrice) }))
      .filter((row) => row.qty > 0n);

    return {
      version: estimate.version,
      acceptedPositions: принятые.length,
      accepted: acceptedTotal(принятые).toString(),
      batches: new Set(приёмки.map((запись) => запись.batchId)).size,
    };
  }

  /**
   * Импорт с записью. Прежняя редакция сметы не удаляется: создаётся
   * следующая версия, а приёмки остаются привязаны к своей (Р11).
   */
  async import(
    user: RequestUser,
    code: string,
    fileName: string,
    file: Buffer,
    overrides: UnitOverrides,
  ): Promise<ImportResult> {
    const project = await this.projectOf(user, code);
    const parsed = await parseWorkbook(file, overrides);
    const report = buildDiscrepancyReport(parsed);

    const unresolved = [...parsed.items, ...parsed.otherExpenses].filter((i) => i.unit.kind !== "resolved");
    if (unresolved.length > 0) {
      const spellings = [...new Set(unresolved.map((i) => i.rawUnit.trim() || "пусто"))];
      throw new BadRequestException({
        message:
          `Импорт остановлен: ${unresolved.length} позиций с написаниями единиц, которые не приведены ` +
          `к справочнику — ${spellings.join(", ")}. Сопоставьте их на экране импорта и повторите.`,
      });
    }

    const previous = await this.prisma.estimate.findFirst({
      where: { projectId: project.id },
      orderBy: { version: "desc" },
    });
    const version = (previous?.version ?? 0) + 1;

    return this.prisma.$transaction(async (tx) => {
      const units = await this.ensureUnits(tx, user.orgId, parsed.items, parsed.otherExpenses);

      const estimate = await tx.estimate.create({
        data: {
          projectId: project.id,
          version,
          supervisionShare: parsed.supervisionShare ?? project.supervisionShare,
          declaredWorksTotal: parsed.declaredWorksTotal,
        },
      });

      // Разделы записываются деревом: сначала верхний уровень, затем вложенные.
      const sectionIds = new Map<string, string>();
      /* Разделы верхнего уровня по имени: к ним привязаны этапы графика, и
         связи предстоит перенести на новую редакцию. */
      const topLevel = new Map<string, string>();
      let order = 0;
      for (const section of parsed.sections) {
        const parentKey = section.path.slice(0, -1).join("·");
        const parentId = sectionIds.get(parentKey);
        const created = await tx.estimateSection.create({
          data: {
            estimateId: estimate.id,
            name: section.name,
            order: (order += 1),
            sourceRow: section.row,
            ...(section.level === 2 && parentId !== undefined ? { parentId } : {}),
          },
        });
        sectionIds.set(section.path.join("·"), created.id);
        if (section.level === 1) topLevel.set(section.name, created.id);
      }

      /* Связи этапов графика с разделами переносятся на новую редакцию по
         имени раздела. Разделы у каждой редакции свои, и без переноса первый
         же импорт оставил бы все этапы без раздела — то есть приёмку без
         бригады-получателя, а прораба с отказом «у раздела нет этапа» на
         каждом разделе объекта.

         Имя выбрано ключом переноса, потому что оно и есть то, чем раздел
         называют: правка количеств и наименований идёт на месте (Р11), а
         новая редакция рождается правкой цен и ставок, имён не трогающей. */
      const linked = await tx.workStage.findMany({
        where: { projectId: project.id, NOT: { sectionId: null } },
        select: { id: true, sectionId: true },
      });
      /* Имена прежних разделов берутся отдельным запросом, а не связью:
         связь Prisma объявляет необязательной независимо от условия выборки,
         и разбор её пустоты пришлось бы писать там, где её быть не может. */
      const прежние = await tx.estimateSection.findMany({
        where: { id: { in: linked.flatMap((stage) => stage.sectionId ?? []) } },
        select: { id: true, name: true },
      });
      const имяПрежнего = new Map(прежние.map((section) => [section.id, section.name]));

      const занятые = new Set<string>();
      for (const stage of linked) {
        const имя = stage.sectionId === null ? undefined : имяПрежнего.get(stage.sectionId);
        const следующий = имя === undefined ? undefined : topLevel.get(имя);
        /* Раздел ведёт не более одного этапа. Если два прежних раздела
           слились в новой редакции в один, второй этап остаётся без раздела,
           а не роняет импорт: смету важнее принять, чем сохранить связь. */
        const свободен = следующий !== undefined && !занятые.has(следующий);
        if (свободен) занятые.add(следующий);
        await tx.workStage.update({
          where: { id: stage.id },
          data: { sectionId: свободен ? следующий : null },
        });
      }

      let itemOrder = 0;
      for (const item of parsed.items) {
        const sectionId = sectionIds.get(item.sectionPath.join("·"));
        if (sectionId === undefined || item.unit.kind !== "resolved") continue;
        await tx.estimateItem.create({
          data: {
            estimateId: estimate.id,
            sectionId,
            unitId: unitId(units, item.unit.unit),
            name: item.name,
            order: (itemOrder += 1),
            qty: item.qty ?? 0n,
            unitPrice: item.unitPrice ?? 0n,
            unitWage: item.unitWage ?? 0n,
            sourceRow: item.row,
          },
        });
      }

      let expenseOrder = 0;
      for (const expense of parsed.otherExpenses) {
        if (expense.unit.kind !== "resolved") continue;
        await tx.otherExpense.create({
          data: {
            estimateId: estimate.id,
            unitId: unitId(units, expense.unit.unit),
            name: expense.name,
            order: (expenseOrder += 1),
            unitPrice: expense.unitPrice ?? 0n,
            sourceRow: expense.row,
          },
        });
      }

      const dto = toImportReport(report);
      const record = await tx.estimateImport.create({
        data: {
          estimateId: estimate.id,
          fileName,
          importedById: user.id,
          positions: report.positions,
          sectionsTotal: report.sectionsTotal,
          computedWorksTotal: report.computedWorksTotal,
          declaredWorksTotal: report.declaredWorksTotal,
          worksTotalDelta: report.worksTotalDelta,
          report: dto,
        },
      });

      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "Estimate",
        entityId: estimate.id,
        field: "import",
        oldValue: previous === null ? null : `версия ${previous.version}`,
        newValue: `версия ${version}, позиций ${report.positions}, пересчёт ${report.computedWorksTotal} коп.`,
      });

      return { importId: record.id, estimateId: estimate.id, version, report: dto };
    });
  }

  /** Заводит недостающие единицы справочника организации. */
  private async ensureUnits(
    tx: Prisma.TransactionClient,
    orgId: string,
    items: readonly ParsedItem[],
    expenses: readonly ParsedItem[],
  ): Promise<Map<CanonicalUnit, string>> {
    const needed = new Set<CanonicalUnit>();
    for (const item of [...items, ...expenses]) {
      if (item.unit.kind === "resolved") needed.add(item.unit.unit);
    }
    const existing = await tx.unit.findMany({ where: { orgId, code: { in: [...needed] } } });
    const map = new Map<CanonicalUnit, string>(
      existing.map((unit) => [unit.code as CanonicalUnit, unit.id]),
    );
    for (const code of needed) {
      if (map.has(code)) continue;
      const created = await tx.unit.create({ data: { orgId, code } });
      map.set(code, created.id);
    }
    return map;
  }

  /**
   * Действующая редакция сметы объекта, собранная в дерево и спроецированная
   * по роли. Отдаётся последняя версия: прежние редакции сохраняются, но
   * показывается та, по которой работают сейчас (Р11).
   */
  async view(user: RequestUser, code: string): Promise<EstimateView> {
    const project = await this.projectOf(user, code);
    const estimate = await this.prisma.estimate.findFirst({
      where: { projectId: project.id },
      orderBy: { version: "desc" },
      include: {
        sections: { orderBy: { order: "asc" } },
        /* Приёмки приходят вместе с позицией: принятое есть их сумма, и
           отдельный запрос на каждую из ста тридцати двух позиций дал бы
           сто тридцать два обращения на один экран сметы. */
        items: {
          orderBy: { order: "asc" },
          include: {
            unit: true,
            acceptances: { select: { qty: true } },
            /* Помещение приходит вместе с позицией, а не отдельной выборкой:
               сто тридцать две позиции дали бы сто тридцать два обращения. */
            room: { select: { id: true, name: true, set: true } },
          },
        },
        otherExpenses: { orderBy: { order: "asc" }, include: { unit: true } },
        imports: { orderBy: { importedAt: "desc" }, take: 1 },
      },
    });
    if (!estimate) {
      throw new NotFoundException({
        message: `У объекта ${code} нет сметы. Импортируйте её на вкладке «Импорт».`,
      });
    }

    const view = buildEstimateView({
      role: user.role,
      supervisionShare: basisPoints(BigInt(estimate.supervisionShare)),
      sections: estimate.sections.map((section) => ({
        id: section.id,
        parentId: section.parentId,
        name: section.name,
        order: section.order,
        sourceRow: section.sourceRow,
      })),
      items: estimate.items.map((item) => ({
        id: item.id,
        sectionId: item.sectionId,
        order: item.order,
        name: item.name,
        unit: item.unit.code,
        qty: milliunits(item.qty),
        // Принято — сумма записей приёмки по позиции, включая отрицательные
        // у сторно. Пока приёмок нет, сумма пуста и даёт честный ноль.
        qtyAccepted: acceptedQty(item.acceptances.map((row) => ({ qty: milliunits(row.qty) }))),
        unitPrice: kopecks(item.unitPrice),
        unitWage: kopecks(item.unitWage),
        room: item.room,
      })),
      otherExpenses: estimate.otherExpenses.map((expense) => ({
        id: expense.id,
        name: expense.name,
        unit: expense.unit.code,
        unitPrice: kopecks(expense.unitPrice),
        order: expense.order,
      })),
    });

    /* Помещения объекта: действующий набор идёт списком выбора, а сам факт
       перепланировки — отдельной величиной. Без него экран не отличит
       позицию, честно стоящую на единственном наборе, от позиции, отставшей
       от перепланировки: набор у обеих `INITIAL`. */
    const помещения = await this.prisma.measureRoom.findMany({
      where: { projectId: project.id },
      orderBy: [{ set: "asc" }, { order: "asc" }],
      select: { id: true, name: true, set: true },
    });
    const перепланировка = помещения.some((комната) => комната.set === "REPLANNED");

    return toEstimateViewDto(view, {
      version: estimate.version,
      importedAt: estimate.imports[0]?.importedAt ?? null,
      declaredWorksTotal: estimate.declaredWorksTotal,
      replanned: перепланировка,
      rooms: помещения.filter(
        (комната) => комната.set === (перепланировка ? "REPLANNED" : "INITIAL"),
      ),
    });
  }

  /**
   * Протоколы импорта действующей редакции. Отчёт о расхождениях сохранён
   * целиком и доступен после перезагрузки страницы (БП-09).
   */
  async imports(user: RequestUser, code: string): Promise<ImportRecord[]> {
    const project = await this.projectOf(user, code);
    const estimate = await this.prisma.estimate.findFirst({
      where: { projectId: project.id },
      orderBy: { version: "desc" },
      include: { imports: { orderBy: { importedAt: "desc" } } },
    });
    if (!estimate) return [];

    return estimate.imports.map((record) => ({
      id: record.id,
      estimateId: estimate.id,
      version: estimate.version,
      fileName: record.fileName,
      importedAt: record.importedAt.toISOString(),
      positions: record.positions,
      report: record.report as unknown as ImportReport,
    }));
  }

  /** Эталонный шаблон выгрузки для объекта. */
  async template(user: RequestUser, code: string): Promise<Buffer> {
    const project = await this.projectOf(user, code);
    return buildTemplate({
      projectCode: project.code,
      address: project.address,
      supervisionShare: project.supervisionShare,
    });
  }

  /**
   * Правка позиции действующей редакции (пункты плана 2.5, 2.6 и 3.9).
   *
   * Новой редакции не порождает: редакция растёт только при импорте. Правится
   * то, что человек тронул, — необязательные поля приходят по одному.
   */
  async updateItem(
    user: RequestUser,
    code: string,
    itemId: string,
    input: UpdateEstimateItem,
  ): Promise<EstimateView> {
    const project = await this.projectOf(user, code);
    const estimate = await this.currentEstimate(project.id);

    /* Позиция ищется в границах действующей редакции одним условием: чужая,
       несуществующая и принадлежащая прежней редакции дают один и тот же 404.
       Разные ответы на эти случаи рассказали бы о чужом объекте. */
    const before = await this.prisma.estimateItem.findFirst({
      where: { id: itemId, estimateId: estimate.id },
      select: {
        id: true, name: true, qty: true, unitPrice: true, unitWage: true, roomId: true,
        unit: { select: { id: true, code: true } },
        room: { select: { name: true } },
        acceptances: { select: { qty: true } },
      },
    });
    if (!before) {
      throw new NotFoundException({
        message: "Позиция не найдена в действующей редакции сметы этого объекта.",
      });
    }

    const unit = input.unit ?? before.unit.code;
    const принято = acceptedQty(before.acceptances.map((row) => ({ qty: milliunits(row.qty) })));
    const отказ = estimateItemFault({
      qty: input.qty === undefined ? milliunits(before.qty) : milliunits(input.qty),
      accepted: принято,
      unit,
      unitPrice: input.unitPrice === undefined
        ? kopecks(before.unitPrice)
        : kopecks(input.unitPrice),
      unitWage: input.unitWage === undefined ? kopecks(before.unitWage) : kopecks(input.unitWage),
    });
    if (отказ !== null) throw new BadRequestException({ message: отказ });

    /* Помещение проверяется по объекту, а не по существованию: помещение
       чужого объекта — не «не найдено», а попытка приписать работы соседней
       квартире, и отказ должен называть именно это. */
    let помещение: { id: string; name: string } | null = null;
    if (input.roomId !== undefined && input.roomId !== null) {
      const найдено = await this.prisma.measureRoom.findFirst({
        where: { id: input.roomId, projectId: project.id },
        select: { id: true, name: true },
      });
      if (найдено === null) {
        throw new BadRequestException({
          message: "Такого помещения нет в обмере этого объекта.",
        });
      }
      помещение = найдено;
    }

    /* Единица меняется только на каноническую: справочник организации
       наполняется импортом, и свободное написание развело бы «м2» и «м²»
       по разным строкам справочника — ровно то, против чего он заведён. */
    let unitId = before.unit.id;
    if (input.unit !== undefined && input.unit !== before.unit.code) {
      if (!CANONICAL_UNITS.includes(input.unit as CanonicalUnit)) {
        throw new BadRequestException({
          message: `Единица «${input.unit}» не каноническая. Допустимы: ${CANONICAL_UNITS.join(", ")}.`,
        });
      }
      const строка = await this.prisma.unit.upsert({
        where: { orgId_code: { orgId: project.orgId, code: input.unit } },
        update: {},
        create: { orgId: project.orgId, code: input.unit },
        select: { id: true },
      });
      unitId = строка.id;
    }

    const прежнее: Record<string, string> = {
      name: before.name,
      unit: before.unit.code,
      qty: before.qty.toString(),
      unitPrice: before.unitPrice.toString(),
      unitWage: before.unitWage.toString(),
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.estimateItem.update({
        where: { id: before.id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.qty === undefined ? {} : { qty: milliunits(input.qty) }),
          ...(input.unitPrice === undefined ? {} : { unitPrice: kopecks(input.unitPrice) }),
          ...(input.unitWage === undefined ? {} : { unitWage: kopecks(input.unitWage) }),
          ...(unitId === before.unit.id ? {} : { unitId }),
          ...(input.roomId === undefined ? {} : { roomId: input.roomId }),
        },
      });

      /* Каждое изменённое поле — отдельная запись журнала (БП-10): спор
         звучит как «кто поменял цену», а не «кто правил позицию». */
      for (const field of ITEM_FIELDS) {
        const next = input[field];
        if (next === undefined || next === прежнее[field]) continue;
        await this.audit.record({
          orgId: project.orgId,
          actorId: user.id,
          entity: "EstimateItem",
          entityId: project.id,
          field: `${before.name} — ${FIELD_LABEL[field] ?? field}`,
          /* Единица берётся прежняя: запись о смене количества читается в
             той единице, в которой количество и правили. */
          oldValue: значениеДляЖурнала(field, прежнее[field] ?? null, before.unit.code),
          newValue: значениеДляЖурнала(field, next, before.unit.code),
        });
      }

      /* Помещение пишется отдельно и именем: опознаватель в журнале
         нечитаем, а журнал читает человек и только человек. Пустое значение
         называется словами — «не выбрано», а не пустой строкой. */
      if (input.roomId !== undefined && input.roomId !== before.roomId) {
        await this.audit.record({
          orgId: project.orgId,
          actorId: user.id,
          entity: "EstimateItem",
          entityId: project.id,
          field: `${before.name} — помещение`,
          oldValue: before.room?.name ?? "не выбрано",
          newValue: помещение?.name ?? "не выбрано",
        });
      }
    });

    return this.view(user, code);
  }

  /**
   * Правка надбавки «сопровождение объекта» действующей редакции.
   *
   * Правится у сметы, а не у объекта: надбавка объекта есть значение по
   * умолчанию для новой сметы, а считают по надбавке той сметы, которая
   * действует (установлено стадией E при выводе остатка транша).
   */
  async updateSupervision(
    user: RequestUser,
    code: string,
    input: UpdateSupervision,
  ): Promise<EstimateView> {
    const project = await this.projectOf(user, code);
    const estimate = await this.currentEstimate(project.id);
    if (estimate.supervisionShare === input.supervisionShare) return this.view(user, code);

    await this.prisma.$transaction(async (tx) => {
      await tx.estimate.update({
        where: { id: estimate.id },
        data: { supervisionShare: input.supervisionShare },
      });
      await this.audit.record({
        orgId: project.orgId,
        actorId: user.id,
        entity: "Estimate",
        entityId: project.id,
        field: "надбавка «сопровождение объекта»",
        oldValue: formatPercent(basisPoints(estimate.supervisionShare)),
        newValue: formatPercent(basisPoints(input.supervisionShare)),
      });
    });

    return this.view(user, code);
  }

  /** Действующая редакция объекта. Её отсутствие — не ошибка сервера, а состояние. */
  private async currentEstimate(projectId: string) {
    const estimate = await currentEstimate(this.prisma, projectId);
    if (!estimate) {
      throw new NotFoundException({
        message: "У объекта нет сметы. Импортируйте её на вкладке «Импорт».",
      });
    }
    return estimate;
  }

  /** Канонический справочник единиц для экрана сопоставления. */
  canonicalUnits(): readonly string[] {
    return CANONICAL_UNITS;
  }
}
