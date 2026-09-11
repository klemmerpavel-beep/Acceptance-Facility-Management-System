import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { LeadBoard, LeadCard } from "@priyomka/contracts";
import {
  convertLeadSchema, createLeadSchema, createLeadTaskSchema, loseLeadSchema,
  updateLeadSchema, updateLeadTaskSchema,
} from "@priyomka/contracts";
import { LeadsService } from "./leads.service";
import { SessionGuard } from "../auth/session.guard";
import { Roles, RolesGuard } from "../common/roles.guard";
import { CurrentUser, type RequestUser } from "../common/current-user";

/**
 * Заявки — раздел руководителя целиком, включая чтение.
 *
 * Роль объявлена на классе, а не на каждом обработчике: прораб заявок не
 * касается вовсе, и перечисление по методам рано или поздно разошлось бы —
 * новый маршрут забыли бы закрыть.
 *
 * Отказ, превращение и правка задач объявлены отдельными маршрутами, а не
 * одной правкой полей: это разные события с разными отказами, и общий
 * маршрут принял бы переход «отказ → превращён», которого не бывает.
 */
@Controller("leads")
@UseGuards(SessionGuard, RolesGuard)
@Roles("OWNER")
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  board(@CurrentUser() user: RequestUser, @Query("open") open?: string): Promise<LeadBoard> {
    /* По умолчанию доска показывает открытые: воронка — про работу, а не
       про историю. «Все» запрашиваются явно. */
    return this.leads.board(user, open !== "false");
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() body: unknown): Promise<LeadCard> {
    return this.leads.create(user, createLeadSchema.parse(body));
  }

  @Patch(":id")
  update(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<LeadCard> {
    return this.leads.update(user, id, updateLeadSchema.parse(body));
  }

  @Post(":id/conversion")
  convert(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<LeadCard> {
    return this.leads.convert(user, id, convertLeadSchema.parse(body));
  }

  @Post(":id/loss")
  lose(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<LeadCard> {
    return this.leads.lose(user, id, loseLeadSchema.parse(body));
  }

  @Post(":id/tasks")
  addTask(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<LeadCard> {
    return this.leads.addTask(user, id, createLeadTaskSchema.parse(body));
  }

  @Patch(":id/tasks/:taskId")
  setTask(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Param("taskId") taskId: string,
    @Body() body: unknown,
  ): Promise<LeadCard> {
    return this.leads.setTask(user, id, taskId, updateLeadTaskSchema.parse(body));
  }
}
