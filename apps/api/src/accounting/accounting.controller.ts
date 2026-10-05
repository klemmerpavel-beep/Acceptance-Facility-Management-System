import { Controller, Get, UseGuards } from "@nestjs/common";
import type { AccountingView } from "@priyomka/contracts";
import { AccountingService } from "./accounting.service";
import { SessionGuard } from "../auth/session.guard";
import { Roles, RolesGuard } from "../common/roles.guard";
import { CurrentUser, type RequestUser } from "../common/current-user";

/**
 * Бухгалтерия — только руководителю.
 *
 * Отказ, а не пустой список: прораб денег заказчика не касается вовсе, и
 * пустой раздел сообщал бы «денег нет» вместо «это не ваш контур». То же
 * правило, что у воронки заявок.
 *
 * Внутренние величины сюда не приходят по составу: транш несёт клиентскую
 * сумму, а ставка и прибыль остались в смете. Закрывается весь раздел, а
 * не отдельные поля.
 */
@Controller("accounting")
@UseGuards(SessionGuard, RolesGuard)
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Get()
  @Roles("OWNER")
  view(@CurrentUser() user: RequestUser): Promise<AccountingView> {
    /* Сегодняшний день берётся службой по часовому поясу организации
       (этап Э8), а не здесь по UTC; в домен он по-прежнему приходит
       готовой датой — арифметика остаётся чистой и воспроизводимой. */
    return this.accounting.view(user);
  }
}
