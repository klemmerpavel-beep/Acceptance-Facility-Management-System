import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import type { ProjectEvent, ProjectSummary } from "@priyomka/contracts";
import { createProjectSchema, updateProjectSchema, updateProjectStatusSchema } from "@priyomka/contracts";
import { ProjectsService } from "./projects.service";
import { SessionGuard } from "../auth/session.guard";
import { Roles, RolesGuard } from "../common/roles.guard";
import { CurrentUser, type RequestUser } from "../common/current-user";

@Controller("projects")
@UseGuards(SessionGuard, RolesGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser): Promise<ProjectSummary[]> {
    return this.projects.list(user);
  }

  @Get(":code")
  byCode(@CurrentUser() user: RequestUser, @Param("code") code: string): Promise<ProjectSummary> {
    return this.projects.byCode(user, code);
  }

  @Post()
  @Roles("OWNER")
  create(@CurrentUser() user: RequestUser, @Body() body: unknown): Promise<ProjectSummary> {
    return this.projects.create(user, createProjectSchema.parse(body));
  }

  @Get(":code/events")
  events(@CurrentUser() user: RequestUser, @Param("code") code: string): Promise<ProjectEvent[]> {
    return this.projects.events(user, code);
  }

  /**
   * Смена статуса объекта — действие руководителя.
   *
   * Роль проверяется дважды: декоратором здесь и явной проверкой в службе
   * (`projects.service.ts`). Дублирование намеренное. Служебная проверка
   * старше и стережёт вызов службы помимо маршрута; декоратор объявляет
   * правило там, где его ищет читатель контроллера. Без него маршрут
   * выглядел выпадающим из общего порядка — `RolesGuard` без декоратора
   * пропускает любую роль, и при разборе охраны этот маршрут был ошибочно
   * принят за незащищённый.
   *
   * Тело проверяется той же схемой, что типизирует клиента.
   */
  /**
   * Правка полей объекта на месте. Роль та же, что у смены статуса:
   * переименовать объект или сдвинуть срок — распоряжение, а не отметка о
   * ходе работ. Статус правится своим маршрутом и сюда не входит.
   */
  @Patch(":code")
  @Roles("OWNER")
  update(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Body() body: unknown,
  ): Promise<ProjectSummary> {
    return this.projects.update(user, code, updateProjectSchema.parse(body));
  }

  @Patch(":code/status")
  @Roles("OWNER")
  setStatus(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Body() body: unknown,
  ): Promise<ProjectSummary> {
    const { status } = updateProjectStatusSchema.parse(body);
    return this.projects.setStatus(user, code, status);
  }
}
