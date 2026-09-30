import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import type { PersonRow } from "@priyomka/contracts";
import { inviteUserSchema } from "@priyomka/contracts";
import { PeopleService } from "./people.service";
import { SessionGuard } from "../auth/session.guard";
import { OwnerOnly, Roles, RolesGuard } from "../common/roles.guard";
import { CurrentUser, type RequestUser } from "../common/current-user";

/**
 * Люди организации. Весь раздел ведёт руководитель: выдача доступа — его
 * право, и прораб, заводящий себе второго прораба, обошёл бы это правило.
 *
 * `@OwnerOnly()` — это и есть «роли» из решения заказчика от 19.09.2026
 * «бухгалтеру открыто всё, кроме настроек и ролей». Бухгалтер, выдающий вход
 * бухгалтеру, обошёл бы то же правило, что и прораб выше.
 */
@Controller("people")
@UseGuards(SessionGuard, RolesGuard)
@Roles("OWNER")
@OwnerOnly()
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  @Get()
  list(@CurrentUser() user: RequestUser): Promise<PersonRow[]> {
    return this.people.list(user);
  }

  /** Заведение человека. Ответ несёт личную ссылку — её передаёт руководитель. */
  @Post()
  invite(@CurrentUser() user: RequestUser, @Body() body: unknown): Promise<{ token: string }> {
    return this.people.invite(user, inviteUserSchema.parse(body));
  }

  @Post(":id/link")
  relink(@CurrentUser() user: RequestUser, @Param("id") id: string): Promise<{ token: string }> {
    return this.people.relink(user, id);
  }

  @Delete(":id")
  revoke(@CurrentUser() user: RequestUser, @Param("id") id: string): Promise<PersonRow[]> {
    return this.people.revoke(user, id);
  }
}
