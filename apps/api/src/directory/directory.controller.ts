import { Body, Controller, Get, Patch, Post, UseGuards } from "@nestjs/common";
import {
  createClientSchema,
  createWorkerSchema,
  updateOrganizationSchema,
  type ClientRow,
  type Organization,
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

  @Get("workers")
  workers(@CurrentUser() user: RequestUser): Promise<WorkerRow[]> {
    return this.directory.workers(user);
  }

  @Post("workers")
  @Roles("OWNER")
  createWorker(@CurrentUser() user: RequestUser, @Body() body: unknown): Promise<WorkerRow[]> {
    return this.directory.createWorker(user, createWorkerSchema.parse(body));
  }
}
