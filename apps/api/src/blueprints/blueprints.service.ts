import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  ApplyBlueprint, BlueprintRow, BlueprintSectionNode, BlueprintView, CreateBlueprint,
} from "@priyomka/contracts";
import { kopecks, milliunits, multiplyByQuantity } from "@priyomka/domain";
import { PrismaService } from "../prisma.service";
import { AuditService } from "../common/audit.service";
import type { RequestUser } from "../common/current-user";
import { projectScope } from "../common/project-scope";

/**
 * Типовые сметы организации.
 *
 * Заготовка под повторяющийся вид ремонта: разделы, наименования, единицы,
 * цены, ставки и количества. Помещений в ней нет — помещение принадлежит
 * объекту, а не типу ремонта.
 *
 * Правки внутри заготовки нет и она не откладывается «на потом»: шаблон,
 * который правят внутри себя, начинает расходиться со всеми сметами, из
 * которых он вышел, и через месяц никто не скажет, какая из них верна.
 * Новая заготовка заводится из очередного объекта — это и есть правка.
 */
@Injectable()
export class BlueprintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async blueprintOf(user: RequestUser, id: string) {
    const заготовка = await this.prisma.estimateBlueprint.findFirst({
      /* Область — организация. Чужая заготовка не «нет доступа», а «нет
         такой»: разные ответы рассказали бы о чужой организации. */
      where: { id, orgId: user.orgId },
      include: {
        sections: { orderBy: { order: "asc" } },
        items: { orderBy: { order: "asc" }, include: { unit: { select: { code: true } } } },
      },
    });
    if (!заготовка) {
      throw new NotFoundException({ message: "Такой типовой сметы в организации нет." });
    }
    return заготовка;
  }

  async list(user: RequestUser): Promise<BlueprintRow[]> {
    const строки = await this.prisma.estimateBlueprint.findMany({
      where: { orgId: user.orgId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { sections: true } },
        items: { select: { qty: true, unitPrice: true, unitWage: true } },
      },
    });
    return строки.map((заготовка) => ({
      id: заготовка.id,
      name: заготовка.name,
      sourceCode: заготовка.sourceCode,
      createdAt: заготовка.createdAt.toISOString(),
      positions: заготовка.items.length,
      sections: заготовка._count.sections,
      works: заготовка.items
        .reduce((всего, позиция) => всего + умножить(позиция.unitPrice, позиция.qty), 0n)
        .toString(),
      wage: заготовка.items
        .reduce((всего, позиция) => всего + умножить(позиция.unitWage, позиция.qty), 0n)
        .toString(),
    }));
  }

  async view(user: RequestUser, id: string): Promise<BlueprintView> {
    const заготовка = await this.blueprintOf(user, id);
    return собрать(заготовка);
  }

  /**
   * Завести типовую смету из действующей редакции объекта.
   *
   * Прочие расходы не копируются: они цена без объёма, привязанная к
   * конкретному объекту, — вывоз мусора у одного дома и у другого стоит
   * разного числа рейсов.
   */
  async create(user: RequestUser, input: CreateBlueprint): Promise<BlueprintView> {
    const project = await this.prisma.project.findFirst({
      where: { code: input.fromProject, ...projectScope(user) },
      select: { id: true, code: true },
    });
    if (!project) throw new NotFoundException({ message: "Объект не найден." });

    const смета = await this.prisma.estimate.findFirst({
      where: { projectId: project.id },
      orderBy: { version: "desc" },
      include: {
        sections: { orderBy: { order: "asc" } },
        items: { orderBy: { order: "asc" } },
      },
    });
    if (!смета || смета.items.length === 0) {
      throw new BadRequestException({
        message: `У объекта ${project.code} нет сметы: заготовку брать не из чего.`,
      });
    }

    const занято = await this.prisma.estimateBlueprint.findFirst({
      where: { orgId: user.orgId, name: input.name },
      select: { id: true },
    });
    if (занято !== null) {
      throw new BadRequestException({
        message: `Типовая смета «${input.name}» в организации уже есть. `
          + "Два одинаковых названия в списке неразличимы: назовите иначе.",
      });
    }

    const id = await this.prisma.$transaction(async (tx) => {
      const заготовка = await tx.estimateBlueprint.create({
        data: {
          orgId: user.orgId,
          name: input.name,
          sourceCode: project.code,
          createdById: user.id,
        },
        select: { id: true },
      });

      /* Дерево переносится по опознавателям исходных разделов: имя могло бы
         повториться у вложенных разделов разных ветвей. */
      const новые = new Map<string, string>();
      for (const раздел of смета.sections) {
        const создан = await tx.blueprintSection.create({
          data: {
            blueprintId: заготовка.id,
            name: раздел.name,
            order: раздел.order,
            ...(раздел.parentId === null
              ? {}
              : { parentId: новые.get(раздел.parentId) ?? null }),
          },
          select: { id: true },
        });
        новые.set(раздел.id, создан.id);
      }

      for (const позиция of смета.items) {
        const sectionId = новые.get(позиция.sectionId);
        if (sectionId === undefined) continue;
        await tx.blueprintItem.create({
          data: {
            blueprintId: заготовка.id,
            sectionId,
            unitId: позиция.unitId,
            name: позиция.name,
            order: позиция.order,
            qty: позиция.qty,
            unitPrice: позиция.unitPrice,
            unitWage: позиция.unitWage,
          },
        });
      }

      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "EstimateBlueprint",
        entityId: project.id,
        field: `${input.name} — типовая смета заведена`,
        oldValue: null,
        newValue: `из ${project.code}, позиций ${смета.items.length}`,
      });
      return заготовка.id;
    });

    return this.view(user, id);
  }

  async remove(user: RequestUser, id: string): Promise<BlueprintRow[]> {
    const заготовка = await this.blueprintOf(user, id);
    await this.prisma.estimateBlueprint.delete({ where: { id: заготовка.id } });
    return this.list(user);
  }

  /**
   * Применить типовую смету к объекту.
   *
   * Только к объекту БЕЗ сметы. Слияние с действующей редакцией не делается
   * и не откладывается: оно потребовало бы правил разрешения совпадений по
   * именам, которых никто не задавал, а вопрос «откуда взялась эта позиция»
   * не имел бы ответа в данных. Замена сметы у объекта — существующий путь,
   * повторный импорт, и он уже называет, что уносит.
   */
  async apply(user: RequestUser, code: string, input: ApplyBlueprint): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { code, ...projectScope(user) },
      select: { id: true, code: true, supervisionShare: true },
    });
    if (!project) throw new NotFoundException({ message: "Объект не найден." });

    const заготовка = await this.blueprintOf(user, input.blueprintId);

    const есть = await this.prisma.estimate.findFirst({
      where: { projectId: project.id },
      select: { version: true },
    });
    if (есть !== null) {
      throw new BadRequestException({
        message: `У объекта ${project.code} уже есть смета (редакция ${есть.version.toString()}). `
          + "Типовая смета не дописывается к существующей: смета объекта одна. "
          + "Замените её повторным импортом — он назовёт, что уносит.",
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const смета = await tx.estimate.create({
        data: {
          projectId: project.id,
          version: 1,
          supervisionShare: project.supervisionShare,
          /* Заявленного итога у заготовки нет, и выдумывать его нельзя: на
             нём стоит отчёт о расхождениях. */
          declaredWorksTotal: null,
        },
        select: { id: true },
      });

      const новые = new Map<string, string>();
      for (const раздел of заготовка.sections) {
        const создан = await tx.estimateSection.create({
          data: {
            estimateId: смета.id,
            name: раздел.name,
            order: раздел.order,
            ...(раздел.parentId === null
              ? {}
              : { parentId: новые.get(раздел.parentId) ?? null }),
          },
          select: { id: true },
        });
        новые.set(раздел.id, создан.id);
      }

      for (const позиция of заготовка.items) {
        const sectionId = новые.get(позиция.sectionId);
        if (sectionId === undefined) continue;
        await tx.estimateItem.create({
          data: {
            estimateId: смета.id,
            sectionId,
            unitId: позиция.unitId,
            name: позиция.name,
            order: позиция.order,
            qty: позиция.qty,
            unitPrice: позиция.unitPrice,
            unitWage: позиция.unitWage,
          },
        });
      }

      /* Происхождение сметы — в журнале объекта, а не полем на смете: поле
         пришлось бы обнулять при удалении заготовки и оно потеряло бы имя,
         а журнал не переписывается (БП-10). Протокола импорта не заводится:
         он описывает файл, а файла здесь нет. */
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "Estimate",
        entityId: project.id,
        field: `Смета заведена из типовой «${заготовка.name}»`,
        oldValue: null,
        newValue: `позиций ${заготовка.items.length}`,
      });
    });
  }
}

/**
 * Цена за количество. Правило округления живёт в домене в одном месте:
 * второй свод разошёлся бы с первым на третьей копейке.
 */
const умножить = (цена: bigint, количество: bigint): bigint =>
  multiplyByQuantity(kopecks(цена), milliunits(количество));

/** Заготовка деревом: то же устройство, что у сметы объекта. */
function собрать(заготовка: {
  id: string;
  name: string;
  sourceCode: string | null;
  sections: { id: string; parentId: string | null; name: string; order: number }[];
  items: {
    id: string; sectionId: string; name: string; order: number;
    qty: bigint; unitPrice: bigint; unitWage: bigint; unit: { code: string };
  }[];
}): BlueprintView {
  const дети = new Map<string | null, typeof заготовка.sections>();
  for (const раздел of заготовка.sections) {
    const список = дети.get(раздел.parentId) ?? [];
    список.push(раздел);
    дети.set(раздел.parentId, список);
  }
  for (const список of дети.values()) список.sort((a, b) => a.order - b.order);

  const поРазделам = new Map<string, typeof заготовка.items>();
  for (const позиция of заготовка.items) {
    const список = поРазделам.get(позиция.sectionId) ?? [];
    список.push(позиция);
    поРазделам.set(позиция.sectionId, список);
  }

  let номер = 0;
  const собратьУзел = (
    раздел: (typeof заготовка.sections)[number],
    level: number,
  ): BlueprintSectionNode => {
    const свои = (поРазделам.get(раздел.id) ?? []).sort((a, b) => a.order - b.order);
    const позиции = свои.map((позиция) => ({
      id: позиция.id,
      order: (номер += 1),
      name: позиция.name,
      unit: позиция.unit.code,
      qty: позиция.qty.toString(),
      unitPrice: позиция.unitPrice.toString(),
      total: умножить(позиция.unitPrice, позиция.qty).toString(),
      unitWage: позиция.unitWage.toString(),
      wageTotal: умножить(позиция.unitWage, позиция.qty).toString(),
    }));
    const вложенные = (дети.get(раздел.id) ?? []).map((узел) => собратьУзел(узел, level + 1));
    const итог = позиции.reduce((всего, позиция) => всего + BigInt(позиция.total), 0n)
      + вложенные.reduce((всего, узел) => всего + BigInt(узел.subtotal), 0n);
    return {
      id: раздел.id,
      name: раздел.name,
      level,
      items: позиции,
      children: вложенные,
      subtotal: итог.toString(),
    };
  };

  const дерево = (дети.get(null) ?? []).map((раздел) => собратьУзел(раздел, 1));
  return {
    id: заготовка.id,
    name: заготовка.name,
    sourceCode: заготовка.sourceCode,
    positions: заготовка.items.length,
    sections: дерево,
    works: дерево.reduce((всего, узел) => всего + BigInt(узел.subtotal), 0n).toString(),
    wage: заготовка.items
      .reduce((всего, позиция) => всего + умножить(позиция.unitWage, позиция.qty), 0n)
      .toString(),
  };
}
