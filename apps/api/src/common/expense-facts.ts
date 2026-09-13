import { kopecks, type Kopecks } from "@priyomka/domain";
import type { PrismaService } from "../prisma.service";

/*
 * Потрачено на материалы — по объектам, одним запросом на весь список.
 *
 * Отдельным помощником, а не запросом внутри службы объектов: величина
 * нужна и списку портфеля, и карточке, и реестру бухгалтерии, а второе
 * правило «что считать потраченным» разошлось бы с первым — на одном экране
 * черновики вошли бы в итог, на другом нет.
 *
 * Запрос один на список, а не один на объект: портфель — десятки строк, и
 * обращение на строку выродилось бы в десятки обращений к базе на один
 * экран. Та же причина, по которой так устроены `estimateFacts`,
 * `openTranches` и `coverPhotos`.
 *
 * Отбор по состоянию задаётся базой, а не фильтром в памяти: черновиков и
 * отклонённых может быть больше, чем подтверждённых, и тащить их через сеть
 * ради того, чтобы выбросить, незачем.
 */

export interface SpentFacts {
  /** Потрачено по подтверждённым. */
  readonly spent: Kopecks;
  /** Из потраченного — то, что предъявляется заказчику. */
  readonly reimbursable: Kopecks;
}

/**
 * Расходы объектов по подтверждённым чекам.
 *
 * Объект без чеков в карте отсутствует — вызывающий подставляет нули. Ноль
 * здесь настоящий: чеков нет, потрачено ноль; пустоты у этой величины не
 * бывает, в отличие от остатка транша.
 */
export async function spentFacts(
  prisma: PrismaService,
  projectIds: readonly string[],
): Promise<Map<string, SpentFacts>> {
  if (projectIds.length === 0) return new Map();

  const строки = await prisma.materialExpense.groupBy({
    by: ["projectId", "reimbursable"],
    where: { projectId: { in: [...projectIds] }, status: "CONFIRMED" },
    _sum: { amount: true },
  });

  const итоги = new Map<string, { spent: bigint; reimbursable: bigint }>();
  for (const строка of строки) {
    const сумма = строка._sum.amount ?? 0n;
    const было = итоги.get(строка.projectId) ?? { spent: 0n, reimbursable: 0n };
    итоги.set(строка.projectId, {
      spent: было.spent + сумма,
      reimbursable: было.reimbursable + (строка.reimbursable ? сумма : 0n),
    });
  }

  return new Map(
    [...итоги].map(([id, сумма]) => [
      id,
      { spent: kopecks(сумма.spent), reimbursable: kopecks(сумма.reimbursable) },
    ]),
  );
}
