import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { EstimateView, ImportRecord, ImportReport, ImportResult } from "@priyomka/contracts";
import {
  buildDiscrepancyReport, buildTemplate, parseWorkbook,
  CANONICAL_UNITS, type CanonicalUnit, type ParsedItem, type UnitOverrides,
} from "@priyomka/importer";
import { acceptedQty, basisPoints, buildEstimateView, kopecks, milliunits } from "@priyomka/domain";
import { toEstimateViewDto } from "./estimate.mapper";
import { PrismaService } from "../prisma.service";
import { AuditService } from "../common/audit.service";
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
          include: { unit: true, acceptances: { select: { qty: true } } },
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
      })),
      otherExpenses: estimate.otherExpenses.map((expense) => ({
        id: expense.id,
        name: expense.name,
        unit: expense.unit.code,
        unitPrice: kopecks(expense.unitPrice),
        order: expense.order,
      })),
    });

    return toEstimateViewDto(view, {
      version: estimate.version,
      importedAt: estimate.imports[0]?.importedAt ?? null,
      declaredWorksTotal: estimate.declaredWorksTotal,
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

  /** Канонический справочник единиц для экрана сопоставления. */
  canonicalUnits(): readonly string[] {
    return CANONICAL_UNITS;
  }
}
