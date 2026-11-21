import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ActRow, ActView } from "@priyomka/contracts";
import { createActCorrectionSchema, signActSchema } from "@priyomka/contracts";
import { ActsService } from "./acts.service";
import { SessionGuard } from "../auth/session.guard";
import { Roles, RolesGuard } from "../common/roles.guard";
import { CurrentUser, type RequestUser } from "../common/current-user";

/**
 * Акты выполненных работ.
 *
 * Перечень читают обе роли: прораб видит, за что объект закрыт, и денежных
 * величин сверх итога в перечне нет. Внутренний вид акта со ставкой и
 * прибылью отдаётся только руководителю — проверка стоит и в службе.
 *
 * Отметка подписания — действие руководителя: акт подписывает он.
 */
@Controller("projects/:code/acts")
@UseGuards(SessionGuard, RolesGuard)
export class ActsController {
  constructor(private readonly acts: ActsService) {}

  /* Акт — бумага заказчика, и видеть её он вправе. */
  @Roles("OWNER", "FOREMAN", "CLIENT")
  @Get()
  list(@CurrentUser() user: RequestUser, @Param("code") code: string): Promise<ActRow[]> {
    return this.acts.list(user, code);
  }

  /**
   * Вид акта. Умолчание — клиентский: он же уходит заказчику, и ошибиться
   * в сторону показа внутренних величин должно быть труднее, чем наоборот.
   */
  @Get(":id")
  @Roles("OWNER", "FOREMAN", "CLIENT")
  view(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Param("id") id: string,
    @Query("view") view?: string,
  ): Promise<ActView> {
    return this.acts.view(user, code, id, view === "internal" ? "internal" : "client");
  }

  @Post(":id/signature")
  @Roles("OWNER")
  sign(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ActRow[]> {
    return this.acts.sign(user, code, id, signActSchema.parse(body));
  }

  /**
   * Поправка к строке подписанного акта (этап Э9, ДР-3): входит строкой в акт
   * открытого транша. Подписанный акт не меняется.
   */
  @Post(":id/corrections")
  @Roles("OWNER")
  correct(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ActRow[]> {
    return this.acts.correct(user, code, id, createActCorrectionSchema.parse(body));
  }

  /** Скан подписанного экземпляра акта (план, пункт 4.10). */
  @Post(":id/scan")
  @Roles("OWNER")
  async attachScan(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Param("id") id: string,
    @Req() request: FastifyRequest,
  ): Promise<ActRow[]> {
    for await (const part of request.parts()) {
      if (part.type !== "file") continue;
      return this.acts.attachScan(user, code, id, await part.toBuffer());
    }
    throw new BadRequestException({ message: "Приложите скан подписанного акта: снимок или PDF." });
  }

  /**
   * Файл скана. Тот же источник, что у клиента: кука сессии уходит
   * браузером сама, подписанные ссылки не нужны.
   */
  @Get(":id/scan")
  @Roles("OWNER", "CLIENT")
  async readScan(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Param("id") id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const скан = await this.acts.readScan(user, code, id);
    void reply
      .header("content-type", скан.contentType)
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "private, no-cache")
      .header("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(скан.fileName)}`);
    return скан.body;
  }
}
