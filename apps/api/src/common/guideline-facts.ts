import { basisPoints, guidelineRange, kopecks, milliunits } from "@priyomka/domain";
import type { PrismaService } from "../prisma.service";

/** Ориентир объекта: вилка, названная на заявке до выезда. */
export interface GuidelineFacts {
  low: bigint;
  high: bigint;
  typeName: string;
  area: bigint;
  rate: bigint;
  spread: number;
  leadNumber: number;
}

/**
 * Ориентиры набора объектов одним запросом.
 *
 * Величины читаются с заявки, а не дублируются полями объекта: два места
 * для одного числа расходятся на первой же правке. Снимок тарифа лежит на
 * заявке, и вилка считается тем же доменом, что при её расчёте.
 */
export async function guidelineFacts(
  prisma: PrismaService,
  projectIds: readonly string[],
): Promise<Map<string, GuidelineFacts>> {
  if (projectIds.length === 0) return new Map();

  const заявки = await prisma.lead.findMany({
    where: { projectId: { in: [...projectIds] }, NOT: { area: null } },
    select: {
      number: true, projectId: true, area: true, rateSnapshot: true, spreadSnapshot: true,
      repairType: { select: { name: true } },
    },
  });

  const итог = new Map<string, GuidelineFacts>();
  for (const заявка of заявки) {
    if (
      заявка.projectId === null || заявка.area === null
      || заявка.rateSnapshot === null || заявка.spreadSnapshot === null
    ) continue;
    const вилка = guidelineRange(
      milliunits(заявка.area),
      kopecks(заявка.rateSnapshot),
      basisPoints(заявка.spreadSnapshot),
    );
    if (вилка === null) continue;
    итог.set(заявка.projectId, {
      low: вилка.low,
      high: вилка.high,
      typeName: заявка.repairType?.name ?? "тип удалён из справочника",
      area: заявка.area,
      rate: заявка.rateSnapshot,
      spread: заявка.spreadSnapshot,
      leadNumber: заявка.number,
    });
  }
  return итог;
}
