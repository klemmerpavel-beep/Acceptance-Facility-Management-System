import { Controller, Get, UseGuards } from "@nestjs/common";
import type { ClientRow, WorkerRow } from "@priyomka/contracts";
import { DirectoryService } from "./directory.service";
import { SessionGuard } from "../auth/session.guard";
import { RolesGuard } from "../common/roles.guard";
import { CurrentUser, type RequestUser } from "../common/current-user";

@Controller()
@UseGuards(SessionGuard, RolesGuard)
export class DirectoryController {
  constructor(private readonly directory: DirectoryService) {}

  @Get("clients")
  clients(@CurrentUser() user: RequestUser): Promise<ClientRow[]> {
    return this.directory.clients(user);
  }

  @Get("workers")
  workers(@CurrentUser() user: RequestUser): Promise<WorkerRow[]> {
    return this.directory.workers(user);
  }
}
