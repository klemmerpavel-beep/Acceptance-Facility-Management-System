import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { NextProjectCode, ProjectEvent, ProjectSummary } from "@priyomka/contracts";
import { createProjectSchema, updateProjectSchema, updateProjectStatusSchema } from "@priyomka/contracts";
import { ProjectsService } from "./projects.service";
import { SessionGuard } from "../auth/session.guard";
import { Roles, RolesGuard } from "../common/roles.guard";
import { CurrentUser, type RequestUser } from "../common/current-user";

@Controller("projects")
@UseGuards(SessionGuard, RolesGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  /* Заказчику приходят только его объекты: отбор задаётся `projectScope`,
     а не фильтром после выборки. */
  @Roles("OWNER", "FOREMAN", "CLIENT")
  @Get()
  list(@CurrentUser() user: RequestUser): Promise<ProjectSummary[]> {
    return this.projects.list(user);
  }

  /* Стоит до `:code` намеренно: «next-code» не проходит выражение номера и
     был бы отвергнут как несуществующий объект, а не понят как маршрут.
     Порядок объявления делает это видимым в тексте, а не зависящим от того,
     как маршрутизатор разбирает путь. */
  @Get("next-code")
  @Roles("OWNER")
  nextCode(@CurrentUser() user: RequestUser): Promise<NextProjectCode> {
    return this.projects.nextCode(user);
  }

  @Get(":code")
  @Roles("OWNER", "FOREMAN", "CLIENT")
  byCode(@CurrentUser() user: RequestUser, @Param("code") code: string): Promise<ProjectSummary> {
    return this.projects.byCode(user, code);
  }

  @Post()
  @Roles("OWNER")
  create(@CurrentUser() user: RequestUser, @Body() body: unknown): Promise<ProjectSummary> {
    return this.projects.create(user, createProjectSchema.parse(body));
  }

  /**
   * Журнал объекта. Страница — двадцать записей; больше просят явно.
   *
   * Предел вынесен в запрос не ради экрана — тот берёт страницу, — а ради
   * проверки состава. Записи восьми видов ложатся в одну ленту по времени,
   * и на объекте с живой работой двадцать последних могут не содержать ни
   * одной записи графика: она просто старше. Проверка, читающая страницу,
   * стережёт страницу, а не журнал, и падает от появления нового вида
   * записей — что и случилось при заведении чеков.
   */
  @Get(":code/events")
  @Roles("OWNER", "FOREMAN", "CLIENT")
  events(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Query("limit") limit?: string,
  ): Promise<ProjectEvent[]> {
    const предел = limit === undefined ? undefined : Number.parseInt(limit, 10);
    const годен = предел !== undefined && Number.isInteger(предел) && предел > 0;
    return this.projects.events(user, code, годен ? Math.min(предел, 200) : undefined);
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
