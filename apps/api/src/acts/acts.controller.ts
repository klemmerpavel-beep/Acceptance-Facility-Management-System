import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import type { ActRow, ActView } from "@priyomka/contracts";
import { signActSchema } from "@priyomka/contracts";
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
}
