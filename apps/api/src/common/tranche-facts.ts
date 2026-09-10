import { acceptedTotal, kopecks, milliunits, sum, type Kopecks } from "@priyomka/domain";
import type { PrismaService } from "../prisma.service";

/**
 * Открытый транш объекта и выработка по нему.
 *
 * Отдельным помощником, а не запросом внутри службы объектов: тем же
 * фактом пользуются карточка объекта и список портфеля, и второй свод
 * правил «что считать выработкой» разошёлся бы с первым.
 *
 * Остаток здесь не считается: для него нужна надбавка действующей сметы,
 * а она приходит из `estimateFacts`. Помощник отдаёт слагаемые, а вычитание
 * делает вызывающая служба одним вызовом домена.
 */
export interface OpenTranche {
  id: string;
  number: number;
  /** Копейки. Сумма платежа клиента по траншу. */
  amount: Kopecks;
  /** Копейки. Выработано: Σ принятое × цена единицы, без надбавки. */
  produced: Kopecks;
}

/**
 * Открытые транши набора объектов двумя запросами на весь портфель.
 *
 * По запросу на объект список из восьми строк стоил бы шестнадцати
 * обращений к базе — та же причина, по которой так устроен `estimateFacts`.
 */
export async function openTranches(
  prisma: PrismaService,
  projectIds: readonly string[],
): Promise<Map<string, OpenTranche>> {
  if (projectIds.length === 0) return new Map();

  const tranches = await prisma.tranche.findMany({
    where: { projectId: { in: [...projectIds] }, status: "OPEN" },
    select: { id: true, projectId: true, number: true, amount: true },
  });
  if (tranches.length === 0) return new Map();

  const batches = await prisma.acceptanceBatch.findMany({
    where: { trancheId: { in: tranches.map((транш) => транш.id) } },
    select: {
      trancheId: true,
      acceptances: { select: { qty: true, item: { select: { unitPrice: true } } } },
    },
  });

  const выработка = new Map<string, Kopecks>();
  for (const пакет of batches) {
    if (пакет.trancheId === null) continue;
    const пакетом = acceptedTotal(пакет.acceptances.map((row) => ({
      qty: milliunits(row.qty),
      unitPrice: kopecks(row.item.unitPrice),
    })));
    выработка.set(пакет.trancheId, sum([выработка.get(пакет.trancheId) ?? kopecks(0), пакетом]));
  }

  return new Map(tranches.map((транш) => [транш.projectId, {
    id: транш.id,
    number: транш.number,
    amount: kopecks(транш.amount),
    produced: выработка.get(транш.id) ?? kopecks(0),
  }]));
}
