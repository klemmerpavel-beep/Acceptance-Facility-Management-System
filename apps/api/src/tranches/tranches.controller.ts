import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import type { TrancheView } from "@priyomka/contracts";
import {
  closeTrancheSchema, createPaymentSchema, createTrancheSchema, reversePaymentSchema,
} from "@priyomka/contracts";
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
 *
 * Отметка оплаты зовётся `settlement`, а не `payment`, с 19.09.2026. Рядом
 * встал маршрут записи платежа, и пара `payment` — `payments`, различающаяся
 * одной буквой, кончилась бы вызовом не того маршрута из соседнего экрана.
 * Имена разведены до того, как это случилось, а не после.
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

  @Post(":id/settlement")
  @Roles("OWNER")
  pay(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Param("id") id: string,
  ): Promise<TrancheView> {
    return this.tranches.pay(user, code, id);
  }

  /**
   * Запись платежа заказчика. Частичная оплата заведена ответом заказчика на
   * вопрос 4 квиза от 19.09.2026.
   */
  @Post(":id/payments")
  @Roles("OWNER")
  addPayment(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<TrancheView> {
    /* Сегодняшний день берётся здесь, а не в правиле: домен чистый, и
       отказ «платёж будущим днём», посчитанный от скрытого «сейчас»,
       перестал бы воспроизводиться в тестах. Тот же приём, что в
       бухгалтерии. */
    return this.tranches.addPayment(
      user, code, id, createPaymentSchema.parse(body), new Date().toISOString().slice(0, 10),
    );
  }

  /** Сторно платежа: запись того же вида с обратной суммой (БП-04). */
  @Post(":id/payments/:paymentId/reversal")
  @Roles("OWNER")
  reversePayment(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Param("id") id: string,
    @Param("paymentId") paymentId: string,
    @Body() body: unknown,
  ): Promise<TrancheView> {
    return this.tranches.reversePayment(
      user, code, id, paymentId, reversePaymentSchema.parse(body),
    );
  }
}
