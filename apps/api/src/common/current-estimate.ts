import type { PrismaService } from "../prisma.service";

/**
 * Действующая редакция сметы объекта — старшая по номеру.
 *
 * Правило одно, а спрашивают о нём трое: приёмка (пакет привязывается к
 * разделу действующей редакции), правка сметы и связь этапа графика с
 * разделом. Три написания `orderBy: { version: "desc" }` разошлись бы на
 * первой же смене правила, а сменить его есть чем: редакция растёт при
 * импорте, и мысль «действующей считать последнюю утверждённую» уже
 * звучала при обсуждении Р11.
 *
 * Отказ остаётся за вызывающим. «Принимать нечего», «импортируйте смету»
 * и «связывать этап не с чем» — три разных сообщения одному человеку, и
 * общий отказ был бы верен ни в одном из трёх случаев.
 */
export interface CurrentEstimate {
  id: string;
  version: number;
  supervisionShare: number;
}

export function currentEstimate(
  prisma: PrismaService,
  projectId: string,
): Promise<CurrentEstimate | null> {
  return prisma.estimate.findFirst({
    where: { projectId },
    orderBy: { version: "desc" },
    select: { id: true, version: true, supervisionShare: true },
  });
}
