import { kopecks, milliunits, multiplyByQuantity, sum, type Kopecks } from "@priyomka/domain";
import type { PrismaService } from "../prisma.service";

/**
 * Факты действующей редакции сметы объекта: то, что нужно списку и сводке,
 * но не стоит целого дерева разделов.
 *
 * Внутренние величины (фонд оплаты труда) в этой структуре присутствуют:
 * она служебная и наружу не отдаётся. За тем, что уходит в ответ, следит
 * вызывающая служба.
 */
export interface EstimateFacts {
  estimateId: string;
  version: number;
  supervisionShare: number;
  positions: number;
  works: Kopecks;
  wage: Kopecks;
  /** Недосчёт итога по последнему импорту: пересчёт минус заявленное. */
  discrepancy: Kopecks | null;
  findings: number;
  importedAt: Date | null;
  fileName: string | null;
}

/**
 * Факты для набора объектов тремя запросами на весь портфель. По запросу на
 * объект список из восьми строк стоил бы двадцати четырёх обращений к базе,
 * и цена росла бы вместе с портфелем.
 */
export async function estimateFacts(
  prisma: PrismaService,
  projectIds: readonly string[],
): Promise<Map<string, EstimateFacts>> {
  if (projectIds.length === 0) return new Map();

  const estimates = await prisma.estimate.findMany({
    where: { projectId: { in: [...projectIds] } },
    orderBy: [{ projectId: "asc" }, { version: "desc" }],
    select: { id: true, projectId: true, version: true, supervisionShare: true },
  });

  // Действующая редакция — старшая по номеру. Прежние остаются в базе:
  // приёмки привязаны к своей редакции (Р11).
  const current = new Map<string, (typeof estimates)[number]>();
  for (const estimate of estimates) {
    if (!current.has(estimate.projectId)) current.set(estimate.projectId, estimate);
  }
  const currentIds = [...current.values()].map((estimate) => estimate.id);
  if (currentIds.length === 0) return new Map();

  const items = await prisma.estimateItem.findMany({
    where: { estimateId: { in: currentIds } },
    select: { estimateId: true, qty: true, unitPrice: true, unitWage: true },
  });

  const imports = await prisma.estimateImport.findMany({
    where: { estimateId: { in: currentIds } },
    orderBy: { importedAt: "desc" },
    select: {
      estimateId: true, importedAt: true, fileName: true, worksTotalDelta: true, report: true,
    },
  });
  const lastImport = new Map<string, (typeof imports)[number]>();
  for (const record of imports) {
    if (!lastImport.has(record.estimateId)) lastImport.set(record.estimateId, record);
  }

  const facts = new Map<string, EstimateFacts>();
  for (const [projectId, estimate] of current) {
    const own = items.filter((item) => item.estimateId === estimate.id);
    const record = lastImport.get(estimate.id);
    facts.set(projectId, {
      estimateId: estimate.id,
      version: estimate.version,
      supervisionShare: estimate.supervisionShare,
      positions: own.length,
      works: sum(own.map((item) => multiplyByQuantity(kopecks(item.unitPrice), milliunits(item.qty)))),
      wage: sum(own.map((item) => multiplyByQuantity(kopecks(item.unitWage), milliunits(item.qty)))),
      discrepancy:
        record?.worksTotalDelta === undefined || record.worksTotalDelta === null
          ? null
          : kopecks(record.worksTotalDelta),
      findings: countFindings(record?.report),
      importedAt: record?.importedAt ?? null,
      fileName: record?.fileName ?? null,
    });
  }
  return facts;
}

/** Отчёт хранится в JSON-поле, поэтому его форма проверяется, а не берётся на веру. */
function countFindings(report: unknown): number {
  if (report === null || typeof report !== "object") return 0;
  const findings = (report as { findings?: unknown }).findings;
  return Array.isArray(findings) ? findings.length : 0;
}
