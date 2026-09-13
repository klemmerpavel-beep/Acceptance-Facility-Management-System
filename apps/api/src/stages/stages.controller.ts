import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import type { WorkStage } from "@priyomka/contracts";
import {
  createWorkStageSchema,
  planFromEstimateSchema,
  reorderWorkStagesSchema,
  updateWorkStageSchema,
} from "@priyomka/contracts";
import { StagesService } from "./stages.service";
import { SessionGuard } from "../auth/session.guard";
import { Roles, RolesGuard } from "../common/roles.guard";
import { CurrentUser, type RequestUser } from "../common/current-user";

/**
 * График производства работ объекта.
 *
 * Читают все, у кого объект виден; ведёт руководитель. Это то же правило,
 * что у смены статуса: график — обязательство перед заказчиком, и менять
 * его в поле, между делом, нельзя. Прораб отмечает выполненное на стадии
 * приёмки, а не двигает сроки.
 *
 * Каждый пишущий маршрут возвращает список этапов целиком: после
 * перестановки меняется половина строк, и частичный ответ заставил бы
 * экран пересобирать порядок вторым сводом правил.
 */
@Controller("projects/:code/stages")
@UseGuards(SessionGuard, RolesGuard)
export class StagesController {
  constructor(private readonly stages: StagesService) {}

  /* График — ответ на вопрос «когда закончат», и он же первое, о чём
     заказчик спрашивает. Только чтение: правит его руководитель. */
  @Roles("OWNER", "FOREMAN", "CLIENT")
  @Get()
  view(@CurrentUser() user: RequestUser, @Param("code") code: string): Promise<WorkStage[]> {
    return this.stages.view(user, code);
  }

  @Post()
  @Roles("OWNER")
  create(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Body() body: unknown,
  ): Promise<WorkStage[]> {
    return this.stages.create(user, code, createWorkStageSchema.parse(body));
  }

  /**
   * Завести график из разделов действующей сметы. Разделы, у которых этап
   * уже есть, пропускаются: действие дозаводит, а не перезаписывает.
   */
  @Post("plan")
  @Roles("OWNER")
  plan(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Body() body: unknown,
  ): Promise<WorkStage[]> {
    return this.stages.planFromEstimate(user, code, planFromEstimateSchema.parse(body));
  }

  /* Перестановка объявлена прежде правки одного этапа: иначе «order» попал
     бы в :id и запрос ушёл бы искать этап с таким идентификатором. */
  @Patch("order")
  @Roles("OWNER")
  reorder(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Body() body: unknown,
  ): Promise<WorkStage[]> {
    return this.stages.reorder(user, code, reorderWorkStagesSchema.parse(body).ids);
  }

  @Patch(":id")
  @Roles("OWNER")
  update(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<WorkStage[]> {
    return this.stages.update(user, code, id, updateWorkStageSchema.parse(body));
  }

  @Delete(":id")
  @Roles("OWNER")
  remove(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Param("id") id: string,
  ): Promise<WorkStage[]> {
    return this.stages.remove(user, code, id);
  }
}
