import {
  acceptedQty, acceptedTotal, kopecks, milliunits, type Kopecks,
} from "@priyomka/domain";
import type { PrismaService } from "../prisma.service";
import type { EstimateFacts } from "./estimate-facts";

/**
 * Принятое по объекту: то, что вправе называться словом «принято».
 *
 * Заявленная готовность графика — величина, которую ставит человек, и она
 * законно опережает приёмку. Принятое считается по приёмке и только по ней:
 * приёмка есть единственный источник факта выполнения (БП-01).
 */
export interface AcceptedFacts {
  /** Выполнено на сумму по действующей редакции. */
  accepted: Kopecks;
  /** Позиций с ненулевым принятым количеством. */
  positions: number;
}

/**
 * Принятое для набора объектов одним запросом на весь портфель.
 *
 * Отбор идёт по позициям **действующей** редакции (Р11): приёмки прежних
 * редакций остаются в базе и в счёте транша, но в картину текущей сметы не
 * входят — иначе реестр показывал бы принятым то, чего в смете уже нет.
 *
 * Редакции берутся готовыми из `estimateFacts`, которую список и сводка
 * читают всё равно: второй поиск действующей редакции разошёлся бы с первым
 * на первом же повторном импорте.
 */
export async function acceptedFacts(
  prisma: PrismaService,
  facts: ReadonlyMap<string, EstimateFacts>,
): Promise<Map<string, AcceptedFacts>> {
  const редакции = new Map([...facts].map(([projectId, факт]) => [факт.estimateId, projectId]));
  if (редакции.size === 0) return new Map();

  const приёмки = await prisma.acceptance.findMany({
    where: { item: { estimateId: { in: [...редакции.keys()] } } },
    select: { itemId: true, qty: true, item: { select: { estimateId: true, unitPrice: true } } },
  });

  /* Сначала по позициям, потом по объектам: сторно приходит отдельной
     записью с отрицательным количеством, и складывать суммы записей вместо
     количеств значило бы считать принятым то, что отменено. */
  const поПозиции = new Map<string, { estimateId: string; unitPrice: bigint; qty: bigint[] }>();
  for (const запись of приёмки) {
    const прежнее = поПозиции.get(запись.itemId);
    if (прежнее === undefined) {
      поПозиции.set(запись.itemId, {
        estimateId: запись.item.estimateId,
        unitPrice: запись.item.unitPrice,
        qty: [запись.qty],
      });
    } else {
      прежнее.qty.push(запись.qty);
    }
  }

  const своды = new Map<string, { rows: { qty: bigint; unitPrice: bigint }[]; positions: number }>();
  for (const позиция of поПозиции.values()) {
    const projectId = редакции.get(позиция.estimateId);
    if (projectId === undefined) continue;
    const принято = acceptedQty(позиция.qty.map((qty) => ({ qty: milliunits(qty) })));
    const свод = своды.get(projectId) ?? { rows: [], positions: 0 };
    свод.rows.push({ qty: принято, unitPrice: позиция.unitPrice });
    if (принято > 0n) свод.positions += 1;
    своды.set(projectId, свод);
  }

  const итог = new Map<string, AcceptedFacts>();
  for (const [projectId] of facts) {
    const свод = своды.get(projectId);
    итог.set(projectId, {
      accepted: свод === undefined
        ? kopecks(0n)
        : acceptedTotal(свод.rows.map((row) => ({
          qty: milliunits(row.qty),
          unitPrice: kopecks(row.unitPrice),
        }))),
      positions: свод?.positions ?? 0,
    });
  }
  return итог;
}
