import { Body, Controller, Get, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  confirmSmsCodeSchema,
  consumeTokenSchema,
  requestMagicLinkSchema,
  requestSmsCodeSchema,
  type CurrentUser as CurrentUserDto,
  type SmsCodeIssued,
} from "@priyomka/contracts";
import { AuthService } from "./auth.service";
import { echoesSecrets } from "./echo";
import { SESSION_COOKIE, SessionGuard } from "./session.guard";
import { CurrentUser, type RequestUser } from "../common/current-user";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Запрос ссылки входа. Ответ одинаков для существующего и несуществующего
   * адреса. Токен возвращается в теле только на стенде с флагом `AUTH_ECHO=1`
   * (`echo.ts`); без флага его отправляет почтовый отправитель.
   */
  @Post("magic-link")
  async requestMagicLink(@Body() body: unknown): Promise<{ sent: true; token?: string }> {
    const { email } = requestMagicLinkSchema.parse(body);
    const issued = await this.auth.issueLink(email);
    if (issued && echoesSecrets()) {
      return { sent: true, token: issued.token };
    }
    return { sent: true };
  }

  /**
   * Запрос кода подтверждения на номер телефона. Ответ одинаков для
   * существующего и несуществующего номера. На стенде с флагом `AUTH_ECHO=1`
   * код приходит в теле и показывается на экране: отправщик сообщений
   * подключается к пилоту заменой одного вызова, экран при этом не меняется.
   */
  @Post("phone/request")
  async requestSmsCode(@Body() body: unknown): Promise<SmsCodeIssued> {
    const { phone } = requestSmsCodeSchema.parse(body);
    const issued = await this.auth.issueSmsCode(phone);
    return { sent: true, ...issued };
  }

  /** Обмен кода на сессию. Кука ставится так же, как при входе по ссылке. */
  @Post("phone/confirm")
  async confirmSmsCode(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ ok: true }> {
    const { phone, code } = confirmSmsCodeSchema.parse(body);
    поставитьСессию(reply, await this.auth.confirmSmsCode(phone, code));
    return { ok: true };
  }

  /* Маршрута `POST /auth/foreman-link` больше нет. Он выдавал ссылку входа на
     любой `userId` и не спрашивал организацию: руководитель одной студии
     входил руководителем другой (полный аудит 30.09.2026, П-15). Клиент им
     не пользовался — вход выдаётся через `/people` с отбором по своей
     организации. */

  /**
   * Обмен ссылки на сессию: токен — в теле запроса (ADR-0008, п. 2; K5 фазы
   * 0, П-61). Ссылка выдаётся фрагментом адреса приложения — `/#login/<токен>`:
   * фрагмент на сервер не уходит и в журналы доступа не попадает. Экран
   * входа по ссылке берёт токен из фрагмента, стирает его из истории и
   * отправляет сюда; кука ставится так же, как при входе по коду.
   */
  @Post("consume")
  async consumeLink(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ ok: true }> {
    const { token } = consumeTokenSchema.parse(body);
    поставитьСессию(reply, await this.auth.consume(token));
    return { ok: true };
  }

  /**
   * Переходный обмен по строке запроса — для ссылок, выданных до 07.11.2026
   * (ADR-0008, п. 3). Токен здесь в адресе запроса, поэтому журнал доступа
   * этого адреса в nginx отключён (`apps/web/nginx.conf`). Маршрут снимается
   * отдельным запросом после перевыпуска ссылок или по истечении их срока;
   * дата снятия — решение заказчика при приёмке работы.
   *
   * Отвечает переадресацией в приложение, а не телом: по такой ссылке
   * человек переходит браузером, и ответ с JSON оставил бы его на странице
   * со служебным текстом.
   */
  @Get("consume")
  async consume(@Query() query: unknown, @Res() reply: FastifyReply): Promise<void> {
    const { token } = consumeTokenSchema.parse(query);
    поставитьСессию(reply, await this.auth.consume(token));
    await reply.redirect(process.env.WEB_ORIGIN ?? "/", 302);
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
    const token = request.cookies[SESSION_COOKIE];
    if (token) await this.auth.revokeSession(token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  }
}

/** Кука сессии — одна на все способы входа: код, ссылка телом и переходный обмен. */
function поставитьСессию(reply: FastifyReply, { sessionToken, expiresAt }: { sessionToken: string; expiresAt: Date }): void {
  reply.setCookie(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}
