import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  createClientSchema,
  createRepairTypeSchema,
  createWorkerSchema,
  updateClientSchema,
  updateOrganizationSchema,
  updateRepairTypeSchema,
  type ClientRow,
  type Foreman,
  type Organization,
  type RepairType,
  type Unit,
  type WorkerRow,
} from "@priyomka/contracts";
import { DirectoryService } from "./directory.service";
import { SessionGuard } from "../auth/session.guard";
import { OwnerOnly, Roles, RolesGuard } from "../common/roles.guard";
import { CurrentUser, type RequestUser } from "../common/current-user";

@Controller()
@UseGuards(SessionGuard, RolesGuard)
export class DirectoryController {
  constructor(private readonly directory: DirectoryService) {}

  @Get("clients")
  clients(@CurrentUser() user: RequestUser): Promise<ClientRow[]> {
    return this.directory.clients(user);
  }

  /** Ответом идёт весь справочник: добавленная запись видна сразу. */
  @Post("clients")
  @Roles("OWNER")
  createClient(@CurrentUser() user: RequestUser, @Body() body: unknown): Promise<ClientRow[]> {
    return this.directory.createClient(user, createClientSchema.parse(body));
  }

  /**
   * Правка карточки заказчика. Заведена ответом на вопрос 5 квиза от
   * 19.09.2026: порог просрочки назначается договором, и назначает его тот,
   * кто ведёт деньги, — то есть руководитель и бухгалтер.
   */
  @Patch("clients/:id")
  @Roles("OWNER")
  updateClient(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ClientRow[]> {
    return this.directory.updateClient(user, id, updateClientSchema.parse(body));
  }

  @Get("organization")
  organization(@CurrentUser() user: RequestUser): Promise<Organization> {
    return this.directory.organization(user);
  }

  /** Правка карточки организации — только руководителю: это настройка. */
  @Patch("organization")
  @Roles("OWNER")
  @OwnerOnly()
  updateOrganization(@CurrentUser() user: RequestUser, @Body() body: unknown): Promise<Organization> {
    return this.directory.updateOrganization(user, updateOrganizationSchema.parse(body));
  }

  @Get("units")
  units(@CurrentUser() user: RequestUser): Promise<Unit[]> {
    return this.directory.units(user);
  }

  /** Прорабы организации: список для назначения на объект. */
  @Get("foremen")
  foremen(@CurrentUser() user: RequestUser): Promise<Foreman[]> {
    return this.directory.foremen(user);
  }

  @Get("workers")
  workers(@CurrentUser() user: RequestUser): Promise<WorkerRow[]> {
    return this.directory.workers(user);
  }

  @Post("workers")
  @Roles("OWNER")
  createWorker(@CurrentUser() user: RequestUser, @Body() body: unknown): Promise<WorkerRow[]> {
    return this.directory.createWorker(user, createWorkerSchema.parse(body));
  }

  /**
   * Типы ремонта с тарифом за квадратный метр. Справочник руководителя
   * целиком: тариф — денежная величина, и прорабу она не приходит вовсе.
   *
   * Бухгалтеру он тоже закрыт, и не по доводу о деньгах, а по месту: тарифы
   * живут на экране настроек, а настройки решением от 19.09.2026 оставлены
   * руководителю.
   */
  @Get("repair-types")
  @Roles("OWNER")
  @OwnerOnly()
  repairTypes(@CurrentUser() user: RequestUser): Promise<RepairType[]> {
    return this.directory.repairTypes(user);
  }

  @Post("repair-types")
  @Roles("OWNER")
  @OwnerOnly()
  createRepairType(@CurrentUser() user: RequestUser, @Body() body: unknown): Promise<RepairType[]> {
    return this.directory.createRepairType(user, createRepairTypeSchema.parse(body));
  }

  @Patch("repair-types/:id")
  @Roles("OWNER")
  @OwnerOnly()
  updateRepairType(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<RepairType[]> {
    return this.directory.updateRepairType(user, id, updateRepairTypeSchema.parse(body));
  }
}
