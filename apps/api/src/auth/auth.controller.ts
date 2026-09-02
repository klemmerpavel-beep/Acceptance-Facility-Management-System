import { Body, Controller, Get, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { consumeTokenSchema, requestMagicLinkSchema, type CurrentUser as CurrentUserDto } from "@priyomka/contracts";
import { AuthService } from "./auth.service";
import { SESSION_COOKIE, SessionGuard } from "./session.guard";
import { CurrentUser, type RequestUser } from "../common/current-user";
import { Roles, RolesGuard } from "../common/roles.guard";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Запрос ссылки входа. Ответ одинаков для существующего и несуществующего
   * адреса. Токен возвращается в теле только вне промышленной среды: в
   * промышленной его отправляет почтовый отправитель.
   */
  @Post("magic-link")
  async requestMagicLink(@Body() body: unknown): Promise<{ sent: true; token?: string }> {
    const { email } = requestMagicLinkSchema.parse(body);
    const issued = await this.auth.issueLink(email);
    if (issued && process.env["NODE_ENV"] !== "production") {
      return { sent: true, token: issued.token };
    }
    return { sent: true };
  }

  @Post("foreman-link")
  @UseGuards(SessionGuard, RolesGuard)
  @Roles("OWNER")
  async requestForemanLink(@Body() body: { userId?: string }): Promise<{ token: string }> {
    if (!body.userId) throw new Error("Укажите прораба, для которого нужна ссылка");
    return this.auth.issueForemanLink(body.userId);
  }

  /**
   * Обмен ссылки на сессию. Отвечает переадресацией в приложение, а не
   * телом: по ссылке из письма человек переходит браузером, и ответ
   * с JSON оставил бы его на странице со служебным текстом.
   */
  @Get("consume")
  async consume(@Query() query: unknown, @Res() reply: FastifyReply): Promise<void> {
    const { token } = consumeTokenSchema.parse(query);
    const { sessionToken, expiresAt } = await this.auth.consume(token);
    reply.setCookie(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env["NODE_ENV"] === "production",
      path: "/",
      expires: expiresAt,
    });
    await reply.redirect(process.env["WEB_ORIGIN"] ?? "/", 302);
  }

  @Get("me")
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: RequestUser): CurrentUserDto {
    return {
      id: user.id,
      role: user.role,
      name: user.name,
      organization: { id: user.orgId, name: user.orgName },
    };
  }

  /** Выход гасит сессию в базе, а не только куку: иначе украденный ключ
   *  продолжает работать. */
  @Post("logout")
  @UseGuards(SessionGuard)
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ ok: true }> {
    const token = request.cookies?.[SESSION_COOKIE];
    if (token) await this.auth.revokeSession(token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  }
}
