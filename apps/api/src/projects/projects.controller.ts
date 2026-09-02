import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import type { ProjectSummary } from "@priyomka/contracts";
import { ProjectsService } from "./projects.service";
import { SessionGuard } from "../auth/session.guard";
import { RolesGuard } from "../common/roles.guard";
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
}
