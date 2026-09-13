import {
  BadRequestException, Body, Controller, Get, Param, Post, Req, Res, UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AcceptanceView, PhotoReport } from "@priyomka/contracts";
import { createAcceptanceSchema, reversalSchema } from "@priyomka/contracts";
import { AcceptanceService } from "./acceptance.service";
import { FileStorage } from "../common/file-storage";
import { detectImageType, ALLOWED_IMAGE_TYPES } from "../measure/image-type";
import { SessionGuard } from "../auth/session.guard";
import { Roles, RolesGuard } from "../common/roles.guard";
import { CurrentUser, type RequestUser } from "../common/current-user";

/**
 * Приёмка выполненных работ.
 *
 * Отмечает прораб — это его ежедневная работа и единственный источник факта
 * выполнения (БП-01). Сторнирует только руководитель и только с причиной:
 * право отменять начисленное шире права его создавать.
 *
 * Пакет приходит одним запросом вместе с фотографией: снимок обязателен, и
 * раздельная загрузка допускала бы пакет без свидетельства.
 */

const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Разбор пакета: часть `batch` с телом и часть `file` со снимком. */
async function readBatch(
  request: FastifyRequest,
): Promise<{ batch: unknown; fileName: string; buffer: Buffer }> {
  let batch: unknown;
  let file: { fileName: string; buffer: Buffer } | null = null;

  for await (const part of request.parts()) {
    if (part.type === "file") {
      const buffer = await part.toBuffer();
      if (buffer.byteLength > MAX_FILE_BYTES) {
        throw new BadRequestException({
          message: `Снимок больше ${String(MAX_FILE_BYTES / 1024 / 1024)} МБ. `
            + "Снимите заново — камера телефона умещается в этот предел.",
        });
      }
      file = { fileName: part.filename, buffer };
      continue;
    }
    if (part.fieldname !== "batch") continue;
    try {
      batch = JSON.parse(String(part.value));
    } catch {
      throw new BadRequestException({ message: "Тело пакета не разбирается как JSON." });
    }
  }

  if (batch === undefined) {
    throw new BadRequestException({ message: "В запросе нет описания пакета." });
  }
  if (file === null) {
    throw new BadRequestException({
      message: "Приложите снимок помещения: без него приёмка не является свидетельством.",
    });
  }
  return { batch, ...file };
}

@Controller("projects/:code/acceptance")
@UseGuards(SessionGuard, RolesGuard)
export class AcceptanceController {
  constructor(
    private readonly acceptance: AcceptanceService,
    private readonly storage: FileStorage,
  ) {}

  @Get()
  view(@CurrentUser() user: RequestUser, @Param("code") code: string): Promise<AcceptanceView> {
    return this.acceptance.view(user, code);
  }

  @Post()
  @Roles("OWNER", "FOREMAN")
  async create(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Req() request: FastifyRequest,
  ): Promise<AcceptanceView> {
    const { batch, fileName, buffer } = await readBatch(request);
    const input = createAcceptanceSchema.parse(batch);

    /* Тип определяется по содержимому, а не по расширению: файл, назвавшийся
       снимком, свидетельством не становится. */
    const contentType = detectImageType(buffer);
    if (contentType === null) {
      throw new BadRequestException({
        message: `Снимок принимается изображением: ${ALLOWED_IMAGE_TYPES.join(", ")}. `
          + "Тип определяется по содержимому файла, а не по расширению.",
      });
    }

    return this.acceptance.create(user, code, input, { fileName, contentType, buffer });
  }

  @Post(":id/reversal")
  @Roles("OWNER")
  reverse(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<AcceptanceView> {
    return this.acceptance.reverse(user, code, id, reversalSchema.parse(body));
  }

  /**
   * Фотоотчёт объекта. Читают все три роли: снимки делает прораб, и прятать
   * от него собственную работу незачем, а заказчику отчёт и адресован — это
   * свидетельство того, что работы выполнены. Денежных величин в нём нет.
   *
   * Сама приёмка заказчику закрыта: в ней стоит начисленное бригаде, и
   * отбор позиций — действие прораба, а не наблюдателя.
   */
  @Get("report")
  @Roles("OWNER", "FOREMAN", "CLIENT")
  report(@CurrentUser() user: RequestUser, @Param("code") code: string): Promise<PhotoReport> {
    return this.acceptance.report(user, code);
  }

  /* Сам снимок — часть отчёта: закрыв его, отчёт превратили бы в перечень
     подписей под пустыми рамками. */
  @Get("photo/:id")
  @Roles("OWNER", "FOREMAN", "CLIENT")
  async photo(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Param("id") id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const photo = await this.acceptance.photo(user, code, id);
    void reply
      .header("content-type", photo.contentType)
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "private, no-cache")
      .header("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(photo.fileName)}`);
    return this.storage.get(photo.storageKey);
  }
}
