import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  createClientSchema,
  createRepairTypeSchema,
  createWorkerSchema,
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
import { Roles, RolesGuard } from "../common/roles.guard";
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

  @Get("organization")
  organization(@CurrentUser() user: RequestUser): Promise<Organization> {
    return this.directory.organization(user);
  }

  /** Правка карточки организации — только руководителю. */
  @Patch("organization")
  @Roles("OWNER")
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
   */
  @Get("repair-types")
  @Roles("OWNER")
  repairTypes(@CurrentUser() user: RequestUser): Promise<RepairType[]> {
    return this.directory.repairTypes(user);
  }

  @Post("repair-types")
  @Roles("OWNER")
  createRepairType(@CurrentUser() user: RequestUser, @Body() body: unknown): Promise<RepairType[]> {
    return this.directory.createRepairType(user, createRepairTypeSchema.parse(body));
  }

  @Patch("repair-types/:id")
  @Roles("OWNER")
  updateRepairType(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<RepairType[]> {
    return this.directory.updateRepairType(user, id, updateRepairTypeSchema.parse(body));
  }
}
