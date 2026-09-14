import {
  BadRequestException, Body, Controller, Get, Param, Patch, Post, Req, Res, UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  DisplacedByImport, EstimateView, ImportRecord, ImportReport, ImportResult,
} from "@priyomka/contracts";
import {
  moveEstimateItemSchema, unitOverridesSchema,
  updateEstimateItemSchema, updateSupervisionSchema,
} from "@priyomka/contracts";
import type { CanonicalUnit, UnitOverrides } from "@priyomka/importer";
import { normalizeSpelling } from "@priyomka/importer";
import { EstimatesService } from "./estimates.service";
import { SessionGuard } from "../auth/session.guard";
import { Roles, RolesGuard } from "../common/roles.guard";
import { CurrentUser, type RequestUser } from "../common/current-user";

/** Предел размера книги. Смета на 141 строку весит десятки килобайт. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

interface UploadedEstimate {
  fileName: string;
  buffer: Buffer;
  overrides: UnitOverrides;
}

@Controller("projects/:code/estimate")
@UseGuards(SessionGuard, RolesGuard)
export class EstimatesController {
  constructor(private readonly estimates: EstimatesService) {}

  /** Действующая редакция сметы, спроецированная по роли. */
  /* Смета отдаётся клиентской проекцией: ставки и прибыли в ней нет по
     составу ответа, а не скрыта показом (`projection.ts`). */
  @Roles("OWNER", "FOREMAN", "CLIENT")
  @Get()
  view(@CurrentUser() user: RequestUser, @Param("code") code: string): Promise<EstimateView> {
    return this.estimates.view(user, code);
  }

  /** Протоколы импорта: отчёт о расхождениях остаётся доступным. */
  @Get("imports")
  imports(@CurrentUser() user: RequestUser, @Param("code") code: string): Promise<ImportRecord[]> {
    return this.estimates.imports(user, code);
  }

  /** Справочник для экрана сопоставления единиц. */
  @Get("units")
  units(): readonly string[] {
    return this.estimates.canonicalUnits();
  }

  /** Эталонный шаблон выгрузки. */
  @Get("template")
  @Roles("OWNER")
  async template(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const file = await this.estimates.template(user, code);
    reply.header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.header("content-disposition", `attachment; filename="smeta-${code}.xlsx"`);
    return file;
  }

  /** Разбор без записи: отчёт и написания единиц, ждущие решения. */
  @Post("preview")
  @Roles("OWNER")
  async preview(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Req() request: FastifyRequest,
  ): Promise<{ fileName: string; report: ImportReport; displaced: DisplacedByImport | null }> {
    const upload = await readUpload(request);
    /* Отчёт описывает файл, `displaced` — состояние объекта, которое запись
       новой редакции вытеснит из вида приёмки. Две разные вещи, два поля. */
    const [report, displaced] = await Promise.all([
      this.estimates.preview(user, code, upload.buffer, upload.overrides),
      this.estimates.displacedByImport(user, code),
    ]);
    return { fileName: upload.fileName, report, displaced };
  }

  /** Импорт с записью новой редакции сметы. */
  @Post("import")
  @Roles("OWNER")
  async import(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Req() request: FastifyRequest,
  ): Promise<ImportResult> {
    const upload = await readUpload(request);
    return this.estimates.import(user, code, upload.fileName, upload.buffer, upload.overrides);
  }

  /**
   * Правка позиции действующей редакции (пункты плана 2.5, 2.6 и 3.9).
   *
   * Правит руководитель — то же правило, что у графика и смены статуса:
   * смета есть основание расчётов и с заказчиком, и с бригадой, и менять её
   * в поле, между делом, нельзя.
   *
   * Возвращается вид сметы целиком: правка одной позиции меняет подытог её
   * раздела, итог по работам, надбавку и итог для клиента. Частичный ответ
   * заставил бы экран пересчитывать подвал вторым сводом правил.
   */
  /**
   * Перенос позиции: другой раздел, другое помещение, другое место в ряду.
   *
   * Объявлен ДО `items/:id` намеренно. Nest разбирает маршруты в порядке
   * объявления, и `items/:id` поймал бы `items/<опознаватель>/place`,
   * приняв «place» за... ничего — и вернул бы 404 «позиция не найдена».
   * Сообщение правдоподобное и уводящее в сторону; тот же класс ошибки уже
   * ловили у графика.
   */
  @Patch("items/:id/place")
  @Roles("OWNER")
  moveItem(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<EstimateView> {
    return this.estimates.moveItem(user, code, id, moveEstimateItemSchema.parse(body));
  }

  @Patch("items/:id")
  @Roles("OWNER")
  updateItem(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<EstimateView> {
    return this.estimates.updateItem(user, code, id, updateEstimateItemSchema.parse(body));
  }

  /** Надбавка «сопровождение объекта» действующей редакции. */
  @Patch("supervision")
  @Roles("OWNER")
  updateSupervision(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Body() body: unknown,
  ): Promise<EstimateView> {
    return this.estimates.updateSupervision(user, code, updateSupervisionSchema.parse(body));
  }
}

/**
 * Чтение книги и подтверждённых сопоставлений из многочастного тела.
 * Сопоставления приходят полем `units` в виде объекта «написание → единица».
 */
async function readUpload(request: FastifyRequest): Promise<UploadedEstimate> {
  const parts = request.parts();
  let fileName = "смета.xlsx";
  let buffer: Buffer | null = null;
  let overrides: UnitOverrides = new Map();

  for await (const part of parts) {
    if (part.type === "file") {
      fileName = part.filename;
      buffer = await part.toBuffer();
      if (buffer.byteLength > MAX_FILE_BYTES) {
        throw new BadRequestException({
          message: `Файл больше ${MAX_FILE_BYTES / 1024 / 1024} МБ. Смета на полторы сотни позиций весит десятки килобайт — проверьте, что это книга Excel.`,
        });
      }
    } else if (part.fieldname === "units") {
      const parsed = unitOverridesSchema.parse(JSON.parse(String(part.value)));
      overrides = new Map(
        Object.entries(parsed).map(([raw, unit]) => [normalizeSpelling(raw), unit as CanonicalUnit]),
      );
    }
  }

  if (buffer === null) {
    throw new BadRequestException({ message: "Приложите файл сметы в формате .xlsx." });
  }
  return { fileName, buffer, overrides };
}
