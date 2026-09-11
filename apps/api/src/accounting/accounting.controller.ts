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
    /* Сегодняшний день берётся здесь, а не внутри арифметики: домен
       чистый, и просрочка, вычисленная от скрытого «сейчас», перестала бы
       воспроизводиться в тестах. */
    return this.accounting.view(user, new Date().toISOString().slice(0, 10));
  }
}
