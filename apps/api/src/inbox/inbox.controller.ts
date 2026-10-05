import { Controller, Get, Post, UseGuards } from "@nestjs/common";
import type { Inbox, InboxSeen } from "@priyomka/contracts";
import { InboxService } from "./inbox.service";
import { SessionGuard } from "../auth/session.guard";
import { Roles, RolesGuard } from "../common/roles.guard";
import { CurrentUser, type RequestUser } from "../common/current-user";

/**
 * Очередь «Ждёт вашего действия» (этап Э8, ДР-1).
 *
 * Открыта всем четырём ролям: что именно ждёт человека, решает роль в
 * службе, и денежных величин в пункте нет ни у кого — вид, объект, число
 * и день. Бухгалтер получает очередь через наследование от руководителя.
 */
@Controller("inbox")
@UseGuards(SessionGuard, RolesGuard)
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  @Roles("OWNER", "FOREMAN", "CLIENT")
  list(@CurrentUser() user: RequestUser): Promise<Inbox> {
    return this.inbox.inbox(user);
  }

  /** Отметка захода — только заказчику: «новое с прошлого входа» есть у него одного. */
  @Post("seen")
  @Roles("CLIENT")
  seen(@CurrentUser() user: RequestUser): Promise<InboxSeen> {
    return this.inbox.seen(user);
  }
}
