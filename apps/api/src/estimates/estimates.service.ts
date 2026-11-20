import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  ClosedTranches, CreateEstimateItem, CreateEstimateSection, DisplacedByImport, EstimateView,
  ImportRecord, ImportReport, ImportResult, MoveEstimateItem, RenameEstimateSection,
  UpdateEstimateItem, UpdateSupervision,
} from "@priyomka/contracts";
import {
  buildDiscrepancyReport, buildTemplate, parseWorkbook,
  CANONICAL_UNITS, type CanonicalUnit, type ParsedItem, type UnitOverrides,
} from "@priyomka/importer";
import {
  acceptedQty, acceptedTotal, basisPoints, buildEstimateView, estimateItemFault,
  estimateItemMoveFault, estimateItemRemovalFault, estimateSectionNestingFault,
  estimateSectionRemovalFault, formatKopecks, formatPercent, isQtySource, kopecks, measureDrift,
  measureDriftNote, measureTotals, multiplyByQuantity, qtySourceFault, qtySourceMismatch, qtySourceNote,
  qtySourceScope, qtySourceValue, surfaceFault, SURFACE_LABEL, wallName,
  количествоТекстом,
  milliunits, ownerLevel,
  сколько,
  type ItemSurface, type Milliunits, type MeasureTotals, type QtySource, type RoomMeasure, type SurfaceKind,
} from "@priyomka/domain";
import { toEstimateViewDto } from "./estimate.mapper";
import { PrismaService } from "../prisma.service";
import { AuditService } from "../common/audit.service";
import { currentEstimate } from "../common/current-estimate";
import type { RequestUser } from "../common/current-user";
import { projectScope } from "../common/project-scope";
import { toImportReport } from "./report.mapper";
import {
  обмерСоСтенами, помещениеДляДомена, стенаДляДомена, стеныПоId, type RoomWithWalls,
} from "../measure/measure-load";


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

/**
 * Подписи полей для журнала объекта.
 *
 * «unitPrice» в ленте событий читателю ничего не говорит, а спор звучит как
 * «кто поменял цену», а не «кто правил позицию» — тот же довод, что у обмера.
 */
const FIELD_LABEL: Readonly<Record<string, string>> = {
  name: "наименование",
  unit: "единица",
  qty: "количество",
  unitPrice: "цена единицы",
  unitWage: "ставка оплаты труда",
};

/** Поля позиции, правка которых пишется в журнал по отдельности. */
const ITEM_FIELDS = ["name", "unit", "qty", "unitPrice", "unitWage"] as const;

/**
 * Значение поля в том виде, в каком его читает человек.
 *
 * Журнал читает человек и только человек: машинного потребителя у него нет.
 * Сырые копейки в записи «115050 → 120000» читаются как рубли и врут в сто
 * раз, а количество в тысячных не читается вовсе. Формы берутся общие — те
 * же, которыми числа показаны на экранах.
 */
function значениеДляЖурнала(field: string, value: string | null, unit: string): string | null {
  if (value === null) return null;
  if (field === "unitPrice" || field === "unitWage") return formatKopecks(kopecks(value));
  if (field === "qty") return количествоТекстом(milliunits(value), unit);
  return value;
}

/** Адрес и источник позиции в хранении (этап Э11, шаг 2; миграция М-3). */
interface ItemAddress {
  roomId: string | null;
  surfaceKind: SurfaceKind | null;
  wallId: string | null;
  qtySource: string | null;
  qtySourceValue: bigint | null;
  qtySourceRoomId: string | null;
  qtySourceWallId: string | null;
}

/** Правка адреса из тела запроса: отсутствие поля его не трогает. */
interface AddressInput {
  roomId?: string | null | undefined;
  surfaceKind?: SurfaceKind | null | undefined;
  wallId?: string | null | undefined;
  qtySource?: QtySource | null | undefined;
}

/** Колонки адреса и источника, которые пишет правка. */
type AddressData = Pick<ItemAddress, "surfaceKind" | "wallId" | "qtySource" | "qtySourceValue"
  | "qtySourceRoomId" | "qtySourceWallId">;

/** Пустой источник: правленое руками количество источника не имеет. */
const БЕЗ_ИСТОЧНИКА = {
  qtySource: null, qtySourceValue: null, qtySourceRoomId: null, qtySourceWallId: null,
} as const;

/**
 * Обмер объекта для подстановки и признака: помещения обоих наборов со
 * стенами, проёмы на стенах, указатель стен и итоги действующего набора —
 * того, что предлагает «из обмера объекта». Действующий — набор после
 * перепланировки, если он заведён, иначе начальный: то же правило, что у
 * списка помещений сметы.
 */
interface MeasureIndex {
  rooms: Map<string, { row: RoomWithWalls; measure: RoomMeasure }>;
  walls: ReturnType<typeof стеныПоId>;
  totals: MeasureTotals;
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

  /**
   * Обмер объекта со стенами — для величин источника (этап Э11, шаг 2).
   * Тот же загрузчик и та же сборка для домена, что у вкладки «Замер»:
   * признак в смете и число на экране обмера не могут разойтись.
   */
  private async обмерОбъекта(projectId: string): Promise<MeasureIndex> {
    const { rooms, openings } = await обмерСоСтенами(this.prisma, { projectId });
    const действующий = rooms.some((room) => room.set === "REPLANNED") ? "REPLANNED" : "INITIAL";
    const поId = new Map(rooms.map((row) => [row.id, { row, measure: помещениеДляДомена(row, openings) }]));
    return {
      rooms: поId,
      walls: стеныПоId(rooms),
      totals: measureTotals([...поId.values()]
        .filter(({ row }) => row.set === действующий)
        .map(({ measure }) => measure)),
    };
  }

  /** Величина источника сейчас: помещение, стена и итог — из одного обмера. */
  private величинаИсточника(
    обмер: MeasureIndex,
    source: QtySource,
    roomId: string | null,
    wallId: string | null,
  ): Milliunits | null {
    const помещение = roomId === null ? undefined : обмер.rooms.get(roomId);
    const стена = wallId === null ? undefined : обмер.walls.get(wallId);
    return qtySourceValue(source, {
      room: помещение?.measure ?? null,
      wall: стена?.room.id === roomId ? стенаДляДомена(стена.wall) : null,
      totals: обмер.totals,
    });
  }

  /**
   * Адрес поверхности и источник количества позиции после правки (этап
   * Э11, шаг 2; решения Э11-2.5 и Э11-2.7).
   *
   * Вид и стена ставятся выбором: из величины адрес не выводится. Вид без
   * помещения не адрес — снятое помещение снимает и вид; стена — только у
   * «одной стены» и только стена помещения позиции. Стена, оставшаяся от
   * прежнего помещения после его смены, снимается: она не того помещения.
   *
   * Источник ставится вместе с подставленным числом и сверяется с обмером
   * сейчас: основание, которое уже в момент записи расходится с обмером,
   * было бы неправдой. Ручная правка количества, смена единицы и смена
   * адреса источник снимают: подставленное относилось к прежнему.
   * Количество при этом не трогается — его меняет только человек.
   */
  private async адресПозиции(
    projectId: string,
    before: (ItemAddress & { qty: bigint; unit: string }) | null,
    input: AddressInput,
    after: { roomId: string | null; qty: bigint; unit: string },
  ): Promise<{ data: AddressData; wallName: string | null; sourceNote: string | null }> {
    let surfaceKind = input.surfaceKind !== undefined ? input.surfaceKind : before?.surfaceKind ?? null;
    let wallId = input.wallId !== undefined ? input.wallId : before?.wallId ?? null;
    if (after.roomId === null && input.surfaceKind === undefined) surfaceKind = null;
    if (surfaceKind !== "WALL" && input.wallId === undefined) wallId = null;
    const отказ = surfaceFault({ roomId: after.roomId, surface: surfaceKind, wallId });
    if (отказ !== null) throw new BadRequestException({ message: отказ });

    const нужноОбмер = wallId !== null || (input.qtySource !== undefined && input.qtySource !== null);
    const обмер = нужноОбмер ? await this.обмерОбъекта(projectId) : null;
    let стена = wallId === null || обмер === null ? undefined : обмер.walls.get(wallId);
    if (wallId !== null && стена?.room.id !== after.roomId) {
      if (input.wallId !== undefined) {
        throw new BadRequestException({ message: "Такой стены нет у помещения позиции: выберите стену этого помещения." });
      }
      wallId = null;
      стена = undefined;
    }
    const имяСтены = стена === undefined ? null : стена.name;

    const адресСменился = after.roomId !== (before?.roomId ?? null)
      || surfaceKind !== (before?.surfaceKind ?? null)
      || wallId !== (before?.wallId ?? null);
    const адрес = { surfaceKind, wallId };

    if (input.qtySource === null) return { data: { ...адрес, ...БЕЗ_ИСТОЧНИКА }, wallName: имяСтены, sourceNote: null };
    if (input.qtySource !== undefined && обмер !== null) {
      const источник = input.qtySource;
      const отказИсточника = qtySourceFault(источник, {
        roomId: after.roomId, surface: surfaceKind, wallId, unit: after.unit,
      });
      if (отказИсточника !== null) throw new BadRequestException({ message: отказИсточника });
      const область = qtySourceScope(источник);
      const roomId = область === "project" ? null : after.roomId;
      const sourceWallId = область === "wall" ? wallId : null;
      const сейчас = this.величинаИсточника(обмер, источник, roomId, sourceWallId);
      const расхождение = qtySourceMismatch(milliunits(after.qty), сейчас, after.unit);
      if (расхождение !== null) throw new BadRequestException({ message: расхождение });
      return {
        data: {
          ...адрес,
          qtySource: источник,
          qtySourceValue: after.qty,
          qtySourceRoomId: roomId,
          qtySourceWallId: sourceWallId,
        },
        wallName: имяСтены,
        sourceNote: qtySourceNote(
          источник,
          { room: roomId === null ? null : обмер.rooms.get(roomId)?.row.name ?? null, wall: имяСтены },
          milliunits(after.qty),
          after.unit,
        ),
      };
    }

    /* Источника в теле нет: прежний остаётся, пока количество, единица и
       адрес те же. */
    const прежний = before?.qtySource == null
      || after.qty !== before.qty || after.unit !== before.unit || адресСменился
      ? БЕЗ_ИСТОЧНИКА
      : {
          qtySource: before.qtySource,
          qtySourceValue: before.qtySourceValue,
          qtySourceRoomId: before.qtySourceRoomId,
          qtySourceWallId: before.qtySourceWallId,
        };
    return { data: { ...адрес, ...прежний }, wallName: имяСтены, sourceNote: null };
  }

  /**
   * Журнал адреса и источника позиции — словами, той же транзакцией (БП-10):
   * спор звучит как «кто снял стену с позиции», а не «кто правил смету».
   */
  private async журналАдреса(
    tx: Prisma.TransactionClient,
    user: RequestUser,
    projectId: string,
    orgId: string,
    name: string,
    before: { surfaceKind: SurfaceKind | null; wallName: string | null; qtySource: string | null } | null,
    after: { data: AddressData; wallName: string | null; sourceNote: string | null },
  ): Promise<void> {
    const запись = (field: string, oldValue: string | null, newValue: string | null) =>
      this.audit.record({
        orgId, actorId: user.id, entity: "EstimateItem", entityId: projectId,
        field: `${name} — ${field}`, oldValue, newValue,
      }, tx);
    const вид = (kind: SurfaceKind | null): string => (kind === null ? "не выбрана" : SURFACE_LABEL[kind]);
    if ((before?.surfaceKind ?? null) !== after.data.surfaceKind) {
      await запись("поверхность", before === null ? null : вид(before.surfaceKind), вид(after.data.surfaceKind));
    }
    if ((before?.wallName ?? null) !== after.wallName) {
      await запись("стена", before === null ? null : before.wallName ?? "не выбрана", after.wallName ?? "не выбрана");
    }
    const былИсточник = before !== null && before.qtySource !== null;
    if (after.sourceNote !== null) {
      await запись("источник количества", былИсточник ? "подставлено из обмера" : "нет", after.sourceNote);
    } else if (былИсточник && after.data.qtySource === null) {
      await запись("источник количества", "подставлено из обмера",
        "снят: правлены количество, единица или адрес позиции");
    }
  }

  /**
   * Адрес, источник и признак позиций для вида сметы (этап Э11, шаг 2).
   * Признак — функция домена: подставленное число против величины
   * источника сейчас; количество он не трогает.
   */
  private адресаДляВида(
    обмер: MeasureIndex,
    items: readonly (ItemAddress & { id: string; unit: string })[],
  ): Map<string, ItemSurface> {
    const адреса = new Map<string, ItemSurface>();
    for (const item of items) {
      const стена = item.wallId === null ? undefined : обмер.walls.get(item.wallId);
      let source: ItemSurface["source"] = null;
      if (item.qtySource !== null && isQtySource(item.qtySource) && item.qtySourceValue !== null) {
        const value = milliunits(item.qtySourceValue);
        const помещение = item.qtySourceRoomId === null ? undefined : обмер.rooms.get(item.qtySourceRoomId);
        const стенаИсточника = item.qtySourceWallId === null ? undefined : обмер.walls.get(item.qtySourceWallId);
        const признак = measureDrift(
          { source: item.qtySource, value, roomId: item.qtySourceRoomId, wallId: item.qtySourceWallId },
          item.roomId,
          {
            room: помещение?.measure ?? null,
            wall: стенаИсточника === undefined ? null : стенаДляДомена(стенаИсточника.wall),
            totals: обмер.totals,
          },
        );
        source = {
          key: item.qtySource,
          value,
          note: qtySourceNote(
            item.qtySource,
            { room: помещение?.row.name ?? null, wall: стенаИсточника?.name ?? null },
            value,
            item.unit,
          ),
          state: признак.state,
          now: признак.state === "removed" ? null : признак.now,
          drift: measureDriftNote(признак, value, item.unit),
        };
      }
      адреса.set(item.id, {
        kind: item.surfaceKind,
        wall: стена === undefined ? null : { id: стена.wall.id, name: стена.name },
        source,
      });
    }
    return адреса;
  }

  /** Разбор без записи: показывает отчёт и написания единиц, ждущие решения. */
  async preview(user: RequestUser, code: string, file: Buffer, overrides: UnitOverrides): Promise<ImportReport> {
    await this.projectOf(user, code);
    const parsed = await parseWorkbook(file, overrides);
    return toImportReport(buildDiscrepancyReport(parsed));
  }

  /**
   * Что уйдёт из вида приёмки при записи новой редакции.
   *
   * Приёмка привязана к своей редакции (Р11): после импорта принятые
   * позиции действующей редакции остаются в базе и в журнале, но вкладка
   * приёмки их больше не покажет — она отбирает по действующей. Это
   * поведение принято заказчиком; не названо оно было только там, где
   * человек нажимает кнопку.
   *
   * Считается по действующей редакции, а не по всем приёмкам объекта:
   * приёмки прежних редакций из вида ушли уже и второй раз не уходят.
   * Суммы — теми же правилами домена, что у вида приёмки: два свода одного
   * и того же обязаны совпасть до копейки.
   */
  async displacedByImport(user: RequestUser, code: string): Promise<DisplacedByImport | null> {
    const project = await this.projectOf(user, code);
    const estimate = await currentEstimate(this.prisma, project.id);
    if (estimate === null) return null;

    const приёмки = await this.prisma.acceptance.findMany({
      where: { batch: { projectId: project.id }, item: { estimateId: estimate.id } },
      select: { itemId: true, qty: true, batchId: true, item: { select: { unitPrice: true } } },
    });

    const поПозиции = new Map<string, { qty: bigint; unitPrice: bigint }>();
    for (const запись of приёмки) {
      const прежнее = поПозиции.get(запись.itemId);
      поПозиции.set(запись.itemId, {
        qty: (прежнее?.qty ?? 0n) + запись.qty,
        unitPrice: запись.item.unitPrice,
      });
    }

    const принятые = [...поПозиции.values()]
      .map((row) => ({ qty: acceptedQty([{ qty: milliunits(row.qty) }]), unitPrice: kopecks(row.unitPrice) }))
      .filter((row) => row.qty > 0n);

    return {
      version: estimate.version,
      acceptedPositions: принятые.length,
      accepted: acceptedTotal(принятые).toString(),
      batches: new Set(приёмки.map((запись) => запись.batchId)).size,
    };
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
          `Импорт остановлен: ${сколько(unresolved.length, "позиция", "позиции", "позиций")} с написаниями единиц, которые не приведены ` +
          `к справочнику — ${spellings.join(", ")}. Сопоставьте их на экране импорта и повторите.`,
      });
    }

    const previous = await this.prisma.estimate.findFirst({
      where: { projectId: project.id },
      orderBy: { version: "desc" },
    });
    const version = (previous?.version ?? 0) + 1;

    /* Помещения позиций переносятся на новую редакцию — по тому же доводу,
       по которому переносятся связи этапов с разделами: позиции у каждой
       редакции свои, и без переноса первый же повторный импорт унёс бы всю
       расстановку помещений молча. А молчание об уносимом — тот самый
       дефект, который импорт уже однажды за собой исправлял.

       Ключ переноса — путь раздела и наименование позиции: правка
       количеств и цен идёт на месте (Р11), а новая редакция рождается
       новым файлом, в котором позицию узнают по имени и месту. */
    /* С этапа Э11 (шаг 2) тем же ключом переносится и адрес поверхности —
       вид и стена (решение Э11-2.8 «б»): стена принадлежит помещению
       позиции, и переносятся они вместе. Источник количества не
       переносится: количество новой редакции пришло из книги, а не из
       обмера. */
    const прежниеПомещения = new Map<string, {
      roomId: string; surfaceKind: SurfaceKind | null; wallId: string | null;
    }>();
    if (previous !== null) {
      const было = await this.prisma.estimateItem.findMany({
        where: { estimateId: previous.id, removedAt: null, NOT: { roomId: null } },
        select: {
          name: true, roomId: true, surfaceKind: true, wallId: true,
          section: { select: { name: true, parent: { select: { name: true } } } },
        },
      });
      for (const позиция of было) {
        if (позиция.roomId === null) continue;
        const путь = позиция.section.parent === null
          ? позиция.section.name
          : `${позиция.section.parent.name}·${позиция.section.name}`;
        прежниеПомещения.set(`${путь}·${позиция.name}`, {
          roomId: позиция.roomId, surfaceKind: позиция.surfaceKind, wallId: позиция.wallId,
        });
      }
    }

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

      /* Порядок ведётся внутри раздела, а не сквозным счётчиком: перенос
         позиции трогает два раздела, а не всю смету. Номер строки документа
         считается при сборке вида и в хранении не нужен. */
      const itemOrder = new Map<string, number>();
      /* Помещения, которые перенести не удалось: позиция сменила имя или
         раздел. Их число уходит в отчёт — импорт обязан называть то, что
         уносит, а не терять молча. */
      let помещенийПеренесено = 0;
      let адресовПеренесено = 0;
      for (const item of parsed.items) {
        const sectionId = sectionIds.get(item.sectionPath.join("·"));
        if (sectionId === undefined || item.unit.kind !== "resolved") continue;
        const перенос = прежниеПомещения.get(`${item.sectionPath.join("·")}·${item.name}`);
        if (перенос !== undefined) помещенийПеренесено += 1;
        if (перенос !== undefined && перенос.surfaceKind !== null) адресовПеренесено += 1;
        await tx.estimateItem.create({
          data: {
            estimateId: estimate.id,
            sectionId,
            ...(перенос === undefined ? {} : {
              roomId: перенос.roomId, surfaceKind: перенос.surfaceKind, wallId: перенос.wallId,
            }),
            unitId: unitId(units, item.unit.unit),
            name: item.name,
            order: (itemOrder.set(sectionId, (itemOrder.get(sectionId) ?? 0) + 1),
              itemOrder.get(sectionId) ?? 1),
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

      /* Что импорт сделал с помещениями — в отчёте, а не только в базе.
         Отчёт есть то место, где продукт рассказывает о записи; потеря
         привязок, о которой он промолчал бы, обнаружилась бы через неделю
         пустой колонкой помещений и была бы списана на «само пропало».

         Находка добавляется, только если помещения были: строка «перенесено
         0 из 0» в отчёте объекта без обмера — шум. */
      const помещенийБыло = прежниеПомещения.size;
      if (помещенийБыло > 0) {
        dto.findings = [
          ...dto.findings,
          {
            kind: "rooms",
            title: помещенийПеренесено === помещенийБыло
              ? `Помещения позиций перенесены целиком: ${помещенийПеренесено} из ${помещенийБыло}`
              : `Помещения позиций перенесены не полностью: ${помещенийПеренесено} из ${помещенийБыло}.`
                + " Остальные позиции сменили наименование или раздел — назначьте им помещение заново",
            amount: null,
            rows: [],
          },
        ];
      }
      /* Адреса поверхностей считаются тем же образом и по той же причине
         (решение Э11-2.8 «б»): первый повторный импорт не вправе унести
         расстановку адресов молча. Нет адресов — нет и строки. */
      const адресовБыло = [...прежниеПомещения.values()].filter((перенос) => перенос.surfaceKind !== null).length;
      if (адресовБыло > 0) {
        dto.findings = [
          ...dto.findings,
          {
            kind: "surfaces",
            title: адресовПеренесено === адресовБыло
              ? `Адреса поверхностей перенесены целиком: ${адресовПеренесено} из ${адресовБыло}`
              : `Адреса поверхностей перенесены не полностью: ${адресовПеренесено} из ${адресовБыло}.`
                + " Остальные позиции сменили наименование или раздел — выберите им поверхность заново",
            amount: null,
            rows: [],
          },
        ];
      }

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
        newValue: `версия ${version}, позиций ${report.positions},`
          + ` пересчёт ${report.computedWorksTotal} коп.`
          + (прежниеПомещения.size === 0
            ? ""
            : `, помещений перенесено ${помещенийПеренесено} из ${прежниеПомещения.size}`)
          + (адресовБыло === 0 ? "" : `, адресов поверхностей — ${адресовПеренесено} из ${адресовБыло}`),
      }, tx);

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
        /* Этап приходит вместе с разделом: связь однозначна
           (`@@unique([sectionId])`), и второго запроса она не стоит. */
        sections: { orderBy: { order: "asc" }, include: { stage: { select: { name: true } } } },
        /* Приёмки приходят вместе с позицией: принятое есть их сумма, и
           отдельный запрос на каждую из ста тридцати двух позиций дал бы
           сто тридцать два обращения на один экран сметы. */
        /* Снятые со сметы позиции (пункт 7.3) в вид не входят: их история
           приёмки живёт в приёмке и отчёте, а не в смете. */
        items: {
          where: { removedAt: null },
          orderBy: { order: "asc" },
          include: {
            unit: true,
            acceptances: { select: { qty: true } },
            /* Помещение приходит вместе с позицией, а не отдельной выборкой:
               сто тридцать две позиции дали бы сто тридцать два обращения. */
            room: { select: { id: true, name: true, set: true } },
          },
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

    /* Адрес поверхности, источник и признак — уровню руководителя: до
       ответа второй очереди прорабу и заказчику объекта их нет (этап Э11,
       шаг 2). Обмер читается только тогда, когда адрес уйдёт в ответ. */
    const адреса = ownerLevel(user.role)
      ? this.адресаДляВида(
        await this.обмерОбъекта(project.id),
        estimate.items.map((item) => ({ ...item, unit: item.unit.code })),
      )
      : new Map<string, ItemSurface>();

    const view = buildEstimateView({
      role: user.role,
      supervisionShare: basisPoints(BigInt(estimate.supervisionShare)),
      sections: estimate.sections.map((section) => ({
        id: section.id,
        parentId: section.parentId,
        name: section.name,
        order: section.order,
        sourceRow: section.sourceRow,
        stage: section.stage?.name ?? null,
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
        room: item.room,
        ...(адреса.has(item.id) ? { surface: адреса.get(item.id) } : {}),
      })),
      otherExpenses: estimate.otherExpenses.map((expense) => ({
        id: expense.id,
        name: expense.name,
        unit: expense.unit.code,
        unitPrice: kopecks(expense.unitPrice),
        order: expense.order,
      })),
    });

    /* Помещения объекта: действующий набор идёт списком выбора, а сам факт
       перепланировки — отдельной величиной. Без него экран не отличит
       позицию, честно стоящую на единственном наборе, от позиции, отставшей
       от перепланировки: набор у обеих `INITIAL`. */
    const помещения = await this.prisma.measureRoom.findMany({
      where: { projectId: project.id },
      orderBy: [{ set: "asc" }, { order: "asc" }],
      select: { id: true, name: true, set: true },
    });
    const перепланировка = помещения.some((комната) => комната.set === "REPLANNED");

    return toEstimateViewDto(view, {
      version: estimate.version,
      importedAt: estimate.imports[0]?.importedAt ?? null,
      declaredWorksTotal: estimate.declaredWorksTotal,
      replanned: перепланировка,
      rooms: помещения.filter(
        (комната) => комната.set === (перепланировка ? "REPLANNED" : "INITIAL"),
      ),
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

    /* Отчёт хранит фонд оплаты труда файла — посчитанный, заявленный и их
       расхождение. Прорабу он отдавался целиком, хотя та же величина в
       смете от него закрыта (полный аудит 30.09.2026, П-16). Разграничение
       на уровне полей, а не экранов: отчёт прорабу остаётся, три поля —
       нет. */
    const внутренние = ownerLevel(user.role);
    return estimate.imports.map((record) => {
      const report = record.report as unknown as ImportReport;
      const { computedWageTotal, declaredWageTotal, wageTotalDelta, ...открытое } = report;
      return {
        id: record.id,
        estimateId: estimate.id,
        version: estimate.version,
        fileName: record.fileName,
        importedAt: record.importedAt.toISOString(),
        positions: record.positions,
        report: внутренние
          ? { ...открытое, computedWageTotal, declaredWageTotal, wageTotalDelta }
          : открытое,
      };
    });
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

  /**
   * Правка позиции действующей редакции (пункты плана 2.5, 2.6 и 3.9).
   *
   * Новой редакции не порождает: редакция растёт только при импорте. Правится
   * то, что человек тронул, — необязательные поля приходят по одному.
   */
  async updateItem(
    user: RequestUser,
    code: string,
    itemId: string,
    input: UpdateEstimateItem,
  ): Promise<EstimateView> {
    const project = await this.projectOf(user, code);
    const estimate = await this.currentEstimate(project.id);

    /* Позиция ищется в границах действующей редакции одним условием: чужая,
       несуществующая и принадлежащая прежней редакции дают один и тот же 404.
       Разные ответы на эти случаи рассказали бы о чужом объекте. */
    const before = await this.prisma.estimateItem.findFirst({
      where: { id: itemId, estimateId: estimate.id, removedAt: null },
      select: {
        id: true, name: true, qty: true, unitPrice: true, unitWage: true, roomId: true,
        surfaceKind: true, wallId: true, qtySource: true, qtySourceValue: true,
        qtySourceRoomId: true, qtySourceWallId: true,
        unit: { select: { id: true, code: true } },
        room: { select: { name: true } },
        wall: { select: { order: true, label: true } },
        acceptances: { select: { qty: true } },
      },
    });
    if (!before) {
      throw new NotFoundException({
        message: "Позиция не найдена в действующей редакции сметы этого объекта.",
      });
    }

    const unit = input.unit ?? before.unit.code;
    const принято = acceptedQty(before.acceptances.map((row) => ({ qty: milliunits(row.qty) })));
    const отказ = estimateItemFault({
      qty: input.qty === undefined ? milliunits(before.qty) : milliunits(input.qty),
      accepted: принято,
      unit,
      unitPrice: input.unitPrice === undefined
        ? kopecks(before.unitPrice)
        : kopecks(input.unitPrice),
      unitWage: input.unitWage === undefined ? kopecks(before.unitWage) : kopecks(input.unitWage),
    });
    if (отказ !== null) throw new BadRequestException({ message: отказ });

    /* Помещение проверяется по объекту, а не по существованию: помещение
       чужого объекта — не «не найдено», а попытка приписать работы соседней
       квартире, и отказ должен называть именно это. */
    let помещение: { id: string; name: string } | null = null;
    if (input.roomId !== undefined && input.roomId !== null) {
      const найдено = await this.prisma.measureRoom.findFirst({
        where: { id: input.roomId, projectId: project.id },
        select: { id: true, name: true },
      });
      if (найдено === null) {
        throw new BadRequestException({
          message: "Такого помещения нет в обмере этого объекта.",
        });
      }
      помещение = найдено;
    }

    /* Единица меняется только на каноническую: справочник организации
       наполняется импортом, и свободное написание развело бы «м2» и «м²»
       по разным строкам справочника — ровно то, против чего он заведён. */
    let unitId = before.unit.id;
    if (input.unit !== undefined && input.unit !== before.unit.code) {
      if (!CANONICAL_UNITS.includes(input.unit as CanonicalUnit)) {
        throw new BadRequestException({
          message: `Единица «${input.unit}» не каноническая. Допустимы: ${CANONICAL_UNITS.join(", ")}.`,
        });
      }
      const строка = await this.prisma.unit.upsert({
        where: { orgId_code: { orgId: project.orgId, code: input.unit } },
        update: {},
        create: { orgId: project.orgId, code: input.unit },
        select: { id: true },
      });
      unitId = строка.id;
    }

    const прежнее: Record<string, string> = {
      name: before.name,
      unit: before.unit.code,
      qty: before.qty.toString(),
      unitPrice: before.unitPrice.toString(),
      unitWage: before.unitWage.toString(),
    };

    /* Адрес поверхности и источник количества (этап Э11, шаг 2): правка
       количества, единицы или адреса без источника в теле источник снимает. */
    const адрес = await this.адресПозиции(
      project.id,
      { ...before, unit: before.unit.code },
      input,
      {
        roomId: input.roomId === undefined ? before.roomId : input.roomId,
        qty: input.qty === undefined ? before.qty : BigInt(input.qty),
        unit,
      },
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.estimateItem.update({
        where: { id: before.id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.qty === undefined ? {} : { qty: milliunits(input.qty) }),
          ...(input.unitPrice === undefined ? {} : { unitPrice: kopecks(input.unitPrice) }),
          ...(input.unitWage === undefined ? {} : { unitWage: kopecks(input.unitWage) }),
          ...(unitId === before.unit.id ? {} : { unitId }),
          ...(input.roomId === undefined ? {} : { roomId: input.roomId }),
          ...адрес.data,
        },
      });

      /* Каждое изменённое поле — отдельная запись журнала (БП-10): спор
         звучит как «кто поменял цену», а не «кто правил позицию». */
      for (const field of ITEM_FIELDS) {
        const next = input[field];
        if (next === undefined || next === прежнее[field]) continue;
        await this.audit.record({
          orgId: project.orgId,
          actorId: user.id,
          entity: "EstimateItem",
          entityId: project.id,
          field: `${before.name} — ${FIELD_LABEL[field] ?? field}`,
          /* Единица берётся прежняя: запись о смене количества читается в
             той единице, в которой количество и правили. */
          oldValue: значениеДляЖурнала(field, прежнее[field] ?? null, before.unit.code),
          newValue: значениеДляЖурнала(field, next, before.unit.code),
        }, tx);
      }

      /* Помещение пишется отдельно и именем: опознаватель в журнале
         нечитаем, а журнал читает человек и только человек. Пустое значение
         называется словами — «не выбрано», а не пустой строкой. */
      if (input.roomId !== undefined && input.roomId !== before.roomId) {
        await this.audit.record({
          orgId: project.orgId,
          actorId: user.id,
          entity: "EstimateItem",
          entityId: project.id,
          field: `${before.name} — помещение`,
          oldValue: before.room?.name ?? "не выбрано",
          newValue: помещение?.name ?? "не выбрано",
        }, tx);
      }
      await this.журналАдреса(tx, user, project.id, project.orgId, before.name, {
        surfaceKind: before.surfaceKind,
        wallName: before.wall === null ? null : wallName(before.wall.order, before.wall.label),
        qtySource: before.qtySource,
      }, адрес);
    });

    return this.view(user, code);
  }

  /**
   * Перенос позиции: другой раздел, другое помещение, другое место в ряду.
   *
   * Одно действие с разными исходами, а не три. Перенумеровываются только
   * затронутые разделы — исходный и целевой, — а сквозной номер строки
   * документа считается при сборке вида.
   *
   * Дробных значений «между соседями» не заводится: дробь упирается в
   * точность и порождает правило о перенормировке, которого никто не ждёт.
   */
  async moveItem(
    user: RequestUser,
    code: string,
    itemId: string,
    input: MoveEstimateItem,
  ): Promise<EstimateView> {
    const project = await this.projectOf(user, code);
    const estimate = await this.currentEstimate(project.id);

    const before = await this.prisma.estimateItem.findFirst({
      where: { id: itemId, estimateId: estimate.id, removedAt: null },
      select: {
        id: true, name: true, sectionId: true, roomId: true, qty: true,
        surfaceKind: true, wallId: true, qtySource: true, qtySourceValue: true,
        qtySourceRoomId: true, qtySourceWallId: true,
        unit: { select: { code: true } },
        section: { select: { name: true } },
        wall: { select: { order: true, label: true } },
        acceptances: { select: { qty: true } },
      },
    });
    if (!before) {
      throw new NotFoundException({
        message: "Позиция не найдена в действующей редакции сметы этого объекта.",
      });
    }

    /* Раздел ищется в границах той же редакции: раздел чужой сметы — не
       «не найден», а попытка переложить работы в чужой объект. */
    const целевой = await this.prisma.estimateSection.findFirst({
      where: { id: input.sectionId, estimateId: estimate.id },
      select: { id: true, name: true },
    });
    if (!целевой) {
      throw new BadRequestException({
        message: "Такого раздела нет в действующей редакции сметы этого объекта.",
      });
    }

    const отказ = estimateItemMoveFault({
      accepted: acceptedQty(before.acceptances.map((row) => ({ qty: milliunits(row.qty) }))),
      name: before.name,
      unit: before.unit.code,
      changesSection: целевой.id !== before.sectionId,
      section: before.section.name,
    });
    if (отказ !== null) throw new BadRequestException({ message: отказ });

    let помещение: { id: string; name: string } | null = null;
    if (input.roomId !== undefined && input.roomId !== null) {
      const найдено = await this.prisma.measureRoom.findFirst({
        where: { id: input.roomId, projectId: project.id },
        select: { id: true, name: true },
      });
      if (найдено === null) {
        throw new BadRequestException({
          message: "Такого помещения нет в обмере этого объекта.",
        });
      }
      помещение = найдено;
    }

    const прежнийРаздел = before.sectionId;

    /* Перенос с другим помещением — смена адреса: стена прежнего помещения
       снимается, без помещения снимается и вид, источник уходит вместе с
       адресом (этап Э11, шаг 2). */
    const адрес = input.roomId === undefined || input.roomId === before.roomId
      ? null
      : await this.адресПозиции(
        project.id,
        { ...before, unit: before.unit.code },
        { roomId: input.roomId },
        { roomId: input.roomId, qty: before.qty, unit: before.unit.code },
      );

    await this.prisma.$transaction(async (tx) => {
      /* Порядок собирается списком и переписывается плотно: так он остаётся
         1..n без дыр и повторов при любом исходе жеста. */
      const целевые = await tx.estimateItem.findMany({
        where: { sectionId: целевой.id, estimateId: estimate.id, removedAt: null },
        orderBy: { order: "asc" },
        select: { id: true },
      });
      const ряд = целевые.map((строка) => строка.id).filter((id) => id !== before.id);
      const место = input.after === null ? 0 : ряд.indexOf(input.after) + 1;
      if (input.after !== null && место === 0) {
        throw new BadRequestException({
          message: "Позиция, за которой предложено встать, не найдена в целевом разделе.",
        });
      }
      ряд.splice(место, 0, before.id);

      await tx.estimateItem.update({
        where: { id: before.id },
        data: {
          sectionId: целевой.id,
          ...(input.roomId === undefined ? {} : { roomId: input.roomId }),
          ...(адрес === null ? {} : адрес.data),
        },
      });
      for (const [индекс, id] of ряд.entries()) {
        await tx.estimateItem.update({ where: { id }, data: { order: индекс + 1 } });
      }

      /* Исходный раздел тоже перенумеровывается: после ухода позиции в нём
         остаётся дыра, и следующая вставка встала бы не туда. */
      if (прежнийРаздел !== целевой.id) {
        const оставшиеся = await tx.estimateItem.findMany({
          where: { sectionId: прежнийРаздел, estimateId: estimate.id, removedAt: null },
          orderBy: { order: "asc" },
          select: { id: true },
        });
        for (const [индекс, строка] of оставшиеся.entries()) {
          await tx.estimateItem.update({
            where: { id: строка.id },
            data: { order: индекс + 1 },
          });
        }
      }

      /* Каждое изменение — своя запись журнала: спор звучит как «кто унёс
         позицию из раздела», а не «кто правил смету». */
      if (прежнийРаздел !== целевой.id) {
        await this.audit.record({
          orgId: project.orgId,
          actorId: user.id,
          entity: "EstimateItem",
          entityId: project.id,
          field: `${before.name} — раздел`,
          oldValue: before.section.name,
          newValue: целевой.name,
        }, tx);
      }
      if (input.roomId !== undefined && input.roomId !== before.roomId) {
        await this.audit.record({
          orgId: project.orgId,
          actorId: user.id,
          entity: "EstimateItem",
          entityId: project.id,
          field: `${before.name} — помещение`,
          oldValue: before.roomId === null ? "не выбрано" : "прежнее",
          newValue: помещение?.name ?? "не выбрано",
        }, tx);
      }
      if (адрес !== null) {
        await this.журналАдреса(tx, user, project.id, project.orgId, before.name, {
          surfaceKind: before.surfaceKind,
          wallName: before.wall === null ? null : wallName(before.wall.order, before.wall.label),
          qtySource: before.qtySource,
        }, адрес);
      }
    });

    return this.view(user, code);
  }

  /**
   * Закрытые транши объекта и позиции, принятые в них, — для предупреждения
   * в листах правки позиции и надбавки (решение заказчика от 01.10.2026,
   * П-27). Отбор по редакции сметы не делается: счёт транша и акт по нему
   * его тоже не делают.
   */
  async closedTranches(user: RequestUser, code: string): Promise<ClosedTranches> {
    const project = await this.projectOf(user, code);
    const транши = await this.prisma.tranche.findMany({
      where: { projectId: project.id, status: { in: ["CLOSED", "PAID"] } },
      orderBy: { number: "asc" },
      select: {
        number: true, status: true, signedAt: true, fixedAt: true,
        batches: { select: { acceptances: { select: { itemId: true } } } },
      },
    });
    return {
      tranches: транши
        .map((транш) => ({
          number: транш.number,
          paid: транш.status === "PAID",
          signedAt: транш.signedAt === null ? null : транш.signedAt.toISOString().slice(0, 10),
          fixed: транш.fixedAt !== null,
          items: [...new Set(транш.batches.flatMap((пакет) => пакет.acceptances.map((строка) => строка.itemId)))],
        }))
        .filter((транш) => транш.items.length > 0),
    };
  }

  /**
   * Правка надбавки «сопровождение объекта» действующей редакции.
   *
   * Правится у сметы, а не у объекта: надбавка объекта есть значение по
   * умолчанию для новой сметы, а считают по надбавке той сметы, которая
   * действует (установлено стадией E при выводе остатка транша).
   */
  async updateSupervision(
    user: RequestUser,
    code: string,
    input: UpdateSupervision,
  ): Promise<EstimateView> {
    const project = await this.projectOf(user, code);
    const estimate = await this.currentEstimate(project.id);
    if (estimate.supervisionShare === input.supervisionShare) return this.view(user, code);

    await this.prisma.$transaction(async (tx) => {
      await tx.estimate.update({
        where: { id: estimate.id },
        data: { supervisionShare: input.supervisionShare },
      });
      await this.audit.record({
        orgId: project.orgId,
        actorId: user.id,
        entity: "Estimate",
        entityId: project.id,
        field: "надбавка «сопровождение объекта»",
        oldValue: formatPercent(basisPoints(estimate.supervisionShare)),
        newValue: formatPercent(basisPoints(input.supervisionShare)),
      }, tx);
    });

    return this.view(user, code);
  }

  /**
   * Заведение позиции в действующей редакции (план, пункт 7.3).
   *
   * Позиция встаёт последней в своём разделе. Изменение и запись журнала —
   * одной транзакцией (БП-10): позиция, заведённая без следа в журнале, была
   * бы суммой в смете, о происхождении которой не спросить.
   */
  async createItem(user: RequestUser, code: string, input: CreateEstimateItem): Promise<EstimateView> {
    const project = await this.projectOf(user, code);
    const estimate = await this.currentEstimate(project.id);

    const раздел = await this.prisma.estimateSection.findFirst({
      where: { id: input.sectionId, estimateId: estimate.id },
      select: { id: true, name: true },
    });
    if (!раздел) {
      throw new BadRequestException({
        message: "Такого раздела нет в действующей редакции сметы этого объекта.",
      });
    }

    const отказ = estimateItemFault({
      qty: milliunits(input.qty),
      accepted: milliunits(0n),
      unit: input.unit,
      unitPrice: kopecks(input.unitPrice),
      unitWage: kopecks(input.unitWage),
    });
    if (отказ !== null) throw new BadRequestException({ message: отказ });
    if (!CANONICAL_UNITS.includes(input.unit as CanonicalUnit)) {
      throw new BadRequestException({
        message: `Единица «${input.unit}» не каноническая. Допустимы: ${CANONICAL_UNITS.join(", ")}.`,
      });
    }

    let помещение: { id: string; name: string } | null = null;
    if (input.roomId !== undefined && input.roomId !== null) {
      помещение = await this.prisma.measureRoom.findFirst({
        where: { id: input.roomId, projectId: project.id },
        select: { id: true, name: true },
      });
      if (помещение === null) {
        throw new BadRequestException({ message: "Такого помещения нет в обмере этого объекта." });
      }
    }

    /* Адрес и источник новой позиции — тем же правилом, что в правке. */
    const адрес = await this.адресПозиции(project.id, null, input, {
      roomId: помещение?.id ?? null,
      qty: BigInt(input.qty),
      unit: input.unit,
    });

    await this.prisma.$transaction(async (tx) => {
      const единица = await tx.unit.upsert({
        where: { orgId_code: { orgId: project.orgId, code: input.unit } },
        update: {},
        create: { orgId: project.orgId, code: input.unit },
        select: { id: true },
      });
      const последняя = await tx.estimateItem.findFirst({
        where: { sectionId: раздел.id, estimateId: estimate.id, removedAt: null },
        orderBy: { order: "desc" },
        select: { order: true },
      });
      await tx.estimateItem.create({
        data: {
          estimateId: estimate.id,
          sectionId: раздел.id,
          unitId: единица.id,
          name: input.name,
          order: (последняя?.order ?? 0) + 1,
          qty: milliunits(input.qty),
          unitPrice: kopecks(input.unitPrice),
          unitWage: kopecks(input.unitWage),
          roomId: помещение?.id ?? null,
          ...адрес.data,
        },
      });
      /* Запись называет позицию целиком: что, сколько, почём и где. Ставка —
         отдельной записью того же рода, что при правке: журнал сметы
         читает только уровень руководителя, но поле ставки и там отдельно. */
      const количество = количествоТекстом(milliunits(input.qty), input.unit);
      const сумма = formatKopecks(multiplyByQuantity(kopecks(input.unitPrice), milliunits(input.qty)));
      await this.audit.record({
        orgId: project.orgId,
        actorId: user.id,
        entity: "EstimateItem",
        entityId: project.id,
        field: `${input.name} — позиция заведена в разделе «${раздел.name}»`,
        oldValue: null,
        newValue: `${количество} по ${formatKopecks(kopecks(input.unitPrice))} — ${сумма}`
          + (помещение === null ? "" : `, ${помещение.name}`),
      }, tx);
      await this.audit.record({
        orgId: project.orgId,
        actorId: user.id,
        entity: "EstimateItem",
        entityId: project.id,
        field: `${input.name} — ${FIELD_LABEL.unitWage ?? "ставка"}`,
        oldValue: null,
        newValue: formatKopecks(kopecks(input.unitWage)),
      }, tx);
      await this.журналАдреса(tx, user, project.id, project.orgId, input.name, null, адрес);
    });

    return this.view(user, code);
  }

  /**
   * Удаление позиции (план, пункт 7.3).
   *
   * Принятая позиция не удаляется: отказ называет принятое и путь через
   * сторно. Позиция без единой записи приёмки удаляется строкой. Позиция,
   * приёмка которой целиком сторнирована, снимается со сметы отметкой
   * `removedAt`: записи приёмки и сторно держат её внешним ключом, а история
   * не переписывается. Порядок оставшихся позиций раздела — плотный.
   */
  async removeItem(user: RequestUser, code: string, itemId: string): Promise<EstimateView> {
    const project = await this.projectOf(user, code);
    const estimate = await this.currentEstimate(project.id);

    const позиция = await this.prisma.estimateItem.findFirst({
      where: { id: itemId, estimateId: estimate.id, removedAt: null },
      select: {
        id: true, name: true, sectionId: true, qty: true, unitPrice: true,
        unit: { select: { code: true } },
        section: { select: { name: true } },
        acceptances: { select: { qty: true } },
      },
    });
    if (!позиция) {
      throw new NotFoundException({
        message: "Позиция не найдена в действующей редакции сметы этого объекта.",
      });
    }

    const принято = acceptedQty(позиция.acceptances.map((row) => ({ qty: milliunits(row.qty) })));
    const отказ = estimateItemRemovalFault({ accepted: принято, name: позиция.name, unit: позиция.unit.code });
    if (отказ !== null) throw new BadRequestException({ message: отказ });

    const сИсторией = позиция.acceptances.length > 0;
    await this.prisma.$transaction(async (tx) => {
      if (сИсторией) {
        await tx.estimateItem.update({ where: { id: позиция.id }, data: { removedAt: new Date() } });
      } else {
        await tx.estimateItem.delete({ where: { id: позиция.id } });
      }
      const оставшиеся = await tx.estimateItem.findMany({
        where: { sectionId: позиция.sectionId, estimateId: estimate.id, removedAt: null },
        orderBy: { order: "asc" },
        select: { id: true },
      });
      for (const [индекс, строка] of оставшиеся.entries()) {
        await tx.estimateItem.update({ where: { id: строка.id }, data: { order: индекс + 1 } });
      }
      const количество = количествоТекстом(milliunits(позиция.qty), позиция.unit.code);
      const сумма = formatKopecks(multiplyByQuantity(kopecks(позиция.unitPrice), milliunits(позиция.qty)));
      await this.audit.record({
        orgId: project.orgId,
        actorId: user.id,
        entity: "EstimateItem",
        entityId: project.id,
        field: `${позиция.name} — позиция раздела «${позиция.section.name}»`,
        oldValue: `${количество} — ${сумма}`,
        newValue: сИсторией
          ? "снята со сметы; приёмка и сторно остаются в истории"
          : "удалена из сметы",
      }, tx);
    });

    return this.view(user, code);
  }

  /**
   * Заведение раздела: верхнего или вложенного в раздел верхнего уровня
   * (план, пункт 7.3). Раздел встаёт последним среди своих соседей.
   */
  async createSection(user: RequestUser, code: string, input: CreateEstimateSection): Promise<EstimateView> {
    const project = await this.projectOf(user, code);
    const estimate = await this.currentEstimate(project.id);

    let родитель: { id: string; name: string } | null = null;
    if (input.parentId !== null) {
      const найден = await this.prisma.estimateSection.findFirst({
        where: { id: input.parentId, estimateId: estimate.id },
        select: { id: true, name: true, parentId: true },
      });
      if (!найден) {
        throw new BadRequestException({
          message: "Такого раздела нет в действующей редакции сметы этого объекта.",
        });
      }
      const отказ = estimateSectionNestingFault(найден.parentId !== null);
      if (отказ !== null) throw new BadRequestException({ message: отказ });
      родитель = { id: найден.id, name: найден.name };
    }

    await this.prisma.$transaction(async (tx) => {
      /* Порядок разделов в редакции сквозной (так его ставит импорт), и
         новый раздел получает следующий номер: среди соседей он встаёт
         последним, сборка вида сортирует детей одного родителя по нему. */
      const последний = await tx.estimateSection.findFirst({
        where: { estimateId: estimate.id },
        orderBy: { order: "desc" },
        select: { order: true },
      });
      await tx.estimateSection.create({
        data: {
          estimateId: estimate.id,
          parentId: родитель?.id ?? null,
          name: input.name,
          order: (последний?.order ?? 0) + 1,
        },
      });
      await this.audit.record({
        orgId: project.orgId,
        actorId: user.id,
        entity: "EstimateSection",
        entityId: project.id,
        field: родитель === null ? "раздел заведён" : `раздел заведён в разделе «${родитель.name}»`,
        oldValue: null,
        newValue: input.name,
      }, tx);
    });

    return this.view(user, code);
  }

  /** Переименование раздела (план, пункт 7.3). */
  async renameSection(
    user: RequestUser,
    code: string,
    sectionId: string,
    input: RenameEstimateSection,
  ): Promise<EstimateView> {
    const project = await this.projectOf(user, code);
    const estimate = await this.currentEstimate(project.id);
    const раздел = await this.prisma.estimateSection.findFirst({
      where: { id: sectionId, estimateId: estimate.id },
      select: { id: true, name: true },
    });
    if (!раздел) {
      throw new NotFoundException({ message: "Раздел не найден в действующей редакции сметы этого объекта." });
    }
    if (раздел.name === input.name) return this.view(user, code);

    await this.prisma.$transaction(async (tx) => {
      await tx.estimateSection.update({ where: { id: раздел.id }, data: { name: input.name } });
      await this.audit.record({
        orgId: project.orgId,
        actorId: user.id,
        entity: "EstimateSection",
        entityId: project.id,
        field: "название раздела",
        oldValue: раздел.name,
        newValue: input.name,
      }, tx);
    });

    return this.view(user, code);
  }

  /**
   * Удаление раздела — только пустого (план, пункт 7.3). Отказ называет всё,
   * что держит раздел: позиции, вложенные разделы, пакеты приёмки, снятые
   * позиции с историей, этап графика и чеки.
   */
  async removeSection(user: RequestUser, code: string, sectionId: string): Promise<EstimateView> {
    const project = await this.projectOf(user, code);
    const estimate = await this.currentEstimate(project.id);
    const раздел = await this.prisma.estimateSection.findFirst({
      where: { id: sectionId, estimateId: estimate.id },
      select: {
        id: true, name: true,
        stage: { select: { name: true } },
        _count: { select: { children: true, batches: true, expenses: true } },
      },
    });
    if (!раздел) {
      throw new NotFoundException({ message: "Раздел не найден в действующей редакции сметы этого объекта." });
    }
    const [позиций, снятых] = await Promise.all([
      this.prisma.estimateItem.count({ where: { sectionId: раздел.id, removedAt: null } }),
      this.prisma.estimateItem.count({ where: { sectionId: раздел.id, NOT: { removedAt: null } } }),
    ]);
    const отказ = estimateSectionRemovalFault({
      name: раздел.name,
      items: позиций,
      removed: снятых,
      children: раздел._count.children,
      batches: раздел._count.batches,
      stage: раздел.stage?.name ?? null,
      expenses: раздел._count.expenses,
    });
    if (отказ !== null) throw new BadRequestException({ message: отказ });

    await this.prisma.$transaction(async (tx) => {
      await tx.estimateSection.delete({ where: { id: раздел.id } });
      await this.audit.record({
        orgId: project.orgId,
        actorId: user.id,
        entity: "EstimateSection",
        entityId: project.id,
        field: "раздел удалён",
        oldValue: раздел.name,
        newValue: null,
      }, tx);
    });

    return this.view(user, code);
  }

  /** Действующая редакция объекта. Её отсутствие — не ошибка сервера, а состояние. */
  private async currentEstimate(projectId: string) {
    const estimate = await currentEstimate(this.prisma, projectId);
    if (!estimate) {
      throw new NotFoundException({
        message: "У объекта нет сметы. Импортируйте её на вкладке «Импорт».",
      });
    }
    return estimate;
  }

  /** Канонический справочник единиц для экрана сопоставления. */
  canonicalUnits(): readonly string[] {
    return CANONICAL_UNITS;
  }
}
