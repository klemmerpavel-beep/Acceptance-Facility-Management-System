import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import type { BlueprintRow, BlueprintView } from "@priyomka/contracts";
import { createBlueprintSchema } from "@priyomka/contracts";
import { BlueprintsService } from "./blueprints.service";
import { SessionGuard } from "../auth/session.guard";
import { OwnerOnly, Roles, RolesGuard } from "../common/roles.guard";
import { CurrentUser, type RequestUser } from "../common/current-user";

/**
 * Типовые сметы организации.
 *
 * Весь узел закрыт руководителем, и разграничение по полям здесь не
 * применяется отдельно: заготовка несёт ставку оплаты труда, то есть фонд
 * оплаты всей типовой сметы одним документом. Прорабу она не нужна вовсе,
 * заказчику — тем более.
 */
@Controller("blueprints")
@UseGuards(SessionGuard, RolesGuard)
@Roles("OWNER")
@OwnerOnly()
export class BlueprintsController {
  constructor(private readonly blueprints: BlueprintsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser): Promise<BlueprintRow[]> {
    return this.blueprints.list(user);
  }

  @Get(":id")
  view(@CurrentUser() user: RequestUser, @Param("id") id: string): Promise<BlueprintView> {
    return this.blueprints.view(user, id);
  }

  /** Завести типовую смету из действующей редакции объекта. */
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() body: unknown): Promise<BlueprintView> {
    return this.blueprints.create(user, createBlueprintSchema.parse(body));
  }

  @Delete(":id")
  remove(@CurrentUser() user: RequestUser, @Param("id") id: string): Promise<BlueprintRow[]> {
    return this.blueprints.remove(user, id);
  }
}
