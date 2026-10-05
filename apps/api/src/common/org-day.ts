import { dayInZone } from "@priyomka/domain";
import type { PrismaService } from "../prisma.service";

/**
 * День организации: «сегодня» и перевод мгновения в день по её часовому
 * поясу (этап Э8). Одна точка на сервер: бухгалтерия, транши и очередь
 * «Ждёт вашего действия» считают дни ожидания одним правилом, и число,
 * стоящее в двух местах, совпадает.
 */
export interface OrgDay {
  readonly today: string;
  readonly day: (at: Date) => string;
}

export async function orgDay(prisma: PrismaService, orgId: string, now = new Date()): Promise<OrgDay> {
  const организация = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { timeZone: true },
  });
  const пояс = организация?.timeZone ?? "Europe/Moscow";
  return { today: dayInZone(now, пояс), day: (at) => dayInZone(at, пояс) };
}
