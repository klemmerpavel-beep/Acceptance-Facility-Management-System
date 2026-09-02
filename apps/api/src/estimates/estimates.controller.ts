import { BadRequestException, Controller, Get, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ImportReport, ImportResult } from "@priyomka/contracts";
import { unitOverridesSchema } from "@priyomka/contracts";
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
  ): Promise<{ fileName: string; report: ImportReport }> {
    const upload = await readUpload(request);
    return { fileName: upload.fileName, report: await this.estimates.preview(user, code, upload.buffer, upload.overrides) };
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
      fileName = part.filename ?? fileName;
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
