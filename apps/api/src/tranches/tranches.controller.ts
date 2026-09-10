import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import type { TrancheView } from "@priyomka/contracts";
import { closeTrancheSchema, createTrancheSchema } from "@priyomka/contracts";
import { TranchesService } from "./tranches.service";
import { SessionGuard } from "../auth/session.guard";
import { Roles, RolesGuard } from "../common/roles.guard";
import { CurrentUser, type RequestUser } from "../common/current-user";

/**
 * Транши объекта.
 *
 * Читают все, у кого объект виден: транш есть сумма платежа клиента, и
 * внутренних величин в нём нет ни одной — ставка и прибыль остались в
 * смете. Прорабу остаток транша говорит, сколько ещё можно принять до
 * следующего акта, и скрывать это от него значило бы прятать границу
 * его же работы.
 *
 * Ведёт руководитель — то же правило, что у графика и смены статуса:
 * транш является денежным обязательством перед заказчиком.
 *
 * Закрытие и оплата объявлены отдельными маршрутами, а не одной правкой
 * статуса: это разные события с разными отказами, и общий маршрут принял
 * бы переход «открыт → оплачен», которого не бывает.
 */
@Controller("projects/:code/tranches")
@UseGuards(SessionGuard, RolesGuard)
export class TranchesController {
  constructor(private readonly tranches: TranchesService) {}

  @Get()
  view(@CurrentUser() user: RequestUser, @Param("code") code: string): Promise<TrancheView> {
    return this.tranches.view(user, code);
  }

  @Post()
  @Roles("OWNER")
  create(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Body() body: unknown,
  ): Promise<TrancheView> {
    return this.tranches.create(user, code, createTrancheSchema.parse(body));
  }

  @Post(":id/closure")
  @Roles("OWNER")
  close(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<TrancheView> {
    return this.tranches.close(user, code, id, closeTrancheSchema.parse(body ?? {}));
  }

  @Post(":id/payment")
  @Roles("OWNER")
  pay(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Param("id") id: string,
  ): Promise<TrancheView> {
    return this.tranches.pay(user, code, id);
  }
}
