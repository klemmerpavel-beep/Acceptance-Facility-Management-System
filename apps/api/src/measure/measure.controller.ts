import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Req, Res, UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { MeasureView } from "@priyomka/contracts";
import { createMeasureRoomSchema, updateMeasureRoomSchema } from "@priyomka/contracts";
import { MeasureService } from "./measure.service";
import { SessionGuard } from "../auth/session.guard";
import { Roles, RolesGuard } from "../common/roles.guard";
import { CurrentUser, type RequestUser } from "../common/current-user";

/**
 * Предел размера плана. Тот же, что у книги сметы: настройка
 * `@fastify/multipart` в main.ts общая, и здесь она только повторена
 * числом, чтобы отказ был осмысленным, а не обрывом соединения.
 */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Обмерный план объекта.
 *
 * Вносят и правят руководитель и прораб: замер снимается на объекте, и
 * это работа прораба. Снабжение видит числа, но не правит их — площади
 * отсюда становятся количествами позиций сметы.
 *
 * Разграничения по полям нет и быть не должно: денежных величин в замере
 * не содержится, `INTERNAL_FIELDS` домена не расширяется.
 */
@Controller("projects/:code/measure")
@UseGuards(SessionGuard, RolesGuard)
export class MeasureController {
  constructor(private readonly measure: MeasureService) {}

  /** Вкладка целиком: помещения, итоги, сведения о плане. */
  @Get()
  view(@CurrentUser() user: RequestUser, @Param("code") code: string): Promise<MeasureView> {
    return this.measure.view(user, code);
  }

  @Post("rooms")
  @Roles("OWNER", "FOREMAN")
  createRoom(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Body() body: unknown,
  ): Promise<MeasureView> {
    return this.measure.createRoom(user, code, createMeasureRoomSchema.parse(body));
  }

  @Patch("rooms/:id")
  @Roles("OWNER", "FOREMAN")
  updateRoom(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<MeasureView> {
    return this.measure.updateRoom(user, code, id, updateMeasureRoomSchema.parse(body));
  }

  @Delete("rooms/:id")
  @Roles("OWNER", "FOREMAN")
  deleteRoom(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Param("id") id: string,
  ): Promise<MeasureView> {
    return this.measure.deleteRoom(user, code, id);
  }

  @Put("plan")
  @Roles("OWNER", "FOREMAN")
  async savePlan(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Req() request: FastifyRequest,
  ): Promise<MeasureView> {
    const upload = await readImage(request);
    return this.measure.savePlan(user, code, upload.fileName, upload.buffer);
  }

  /**
   * Отдача плана. Изображение запрашивается тегом `img` того же источника,
   * кука сессии уходит браузером сама — подписанные ссылки не нужны, и
   * весь доступ остаётся в одном месте.
   */
  @Get("plan/file")
  async readPlan(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const plan = await this.measure.readPlan(user, code);
    void reply
      .header("content-type", plan.contentType)
      // nosniff: тип определён сервером по сигнатуре, и браузеру не за чем
      // угадывать его заново.
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "private, no-cache")
      .header(
        "content-disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(plan.fileName)}`,
      );
    return plan.body;
  }

  @Delete("plan")
  @Roles("OWNER", "FOREMAN")
  deletePlan(@CurrentUser() user: RequestUser, @Param("code") code: string): Promise<MeasureView> {
    return this.measure.deletePlan(user, code);
  }
}

/** Чтение изображения из многочастного тела. */
async function readImage(request: FastifyRequest): Promise<{ fileName: string; buffer: Buffer }> {
  for await (const part of request.parts()) {
    if (part.type !== "file") continue;
    const buffer = await part.toBuffer();
    if (buffer.byteLength > MAX_FILE_BYTES) {
      throw new BadRequestException({
        message: `Файл больше ${MAX_FILE_BYTES / 1024 / 1024} МБ. Снимок плана столько не весит — проверьте, что выбран нужный файл.`,
      });
    }
    return { fileName: part.filename, buffer };
  }
  throw new BadRequestException({ message: "Приложите снимок или изображение плана." });
}
