import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { EstimateView, ImportRecord, ImportReport, ImportResult } from "@priyomka/contracts";
import {
  buildDiscrepancyReport, buildTemplate, parseWorkbook,
  CANONICAL_UNITS, type CanonicalUnit, type ParsedItem, type UnitOverrides,
} from "@priyomka/importer";
import { basisPoints, buildEstimateView, kopecks, milliunits } from "@priyomka/domain";
import { toEstimateViewDto } from "./estimate.mapper";
import { PrismaService } from "../prisma.service";
import { AuditService } from "../common/audit.service";
import type { RequestUser } from "../common/current-user";
import { projectScope } from "../common/project-scope";
import { toImportReport } from "./report.mapper";

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
      let order = 0;
      for (const section of parsed.sections) {
        const parentKey = section.path.slice(0, -1).join("·");
        const created = await tx.estimateSection.create({
          data: {
            estimateId: estimate.id,
            name: section.name,
            order: (order += 1),
            sourceRow: section.row,
            ...(section.level === 2 && sectionIds.has(parentKey)
              ? { parentId: sectionIds.get(parentKey) as string }
              : {}),
          },
        });
        sectionIds.set(section.path.join("·"), created.id);
      }

      let itemOrder = 0;
      for (const item of parsed.items) {
        const sectionId = sectionIds.get(item.sectionPath.join("·"));
        if (sectionId === undefined || item.unit.kind !== "resolved") continue;
        await tx.estimateItem.create({
          data: {
            estimateId: estimate.id,
            sectionId,
            unitId: units.get(item.unit.unit) as string,
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
            unitId: units.get(expense.unit.unit) as string,
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
          report: dto as unknown as object,
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
        items: { orderBy: { order: "asc" }, include: { unit: true } },
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
        qtyAccepted: milliunits(0n),
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
