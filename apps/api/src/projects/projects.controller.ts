import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import type { ProjectEvent, ProjectSummary } from "@priyomka/contracts";
import { updateProjectStatusSchema } from "@priyomka/contracts";
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

  @Get(":code/events")
  events(@CurrentUser() user: RequestUser, @Param("code") code: string): Promise<ProjectEvent[]> {
    return this.projects.events(user, code);
  }

  /** Тело проверяется той же схемой, что типизирует клиента. */
  @Patch(":code/status")
  setStatus(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Body() body: unknown,
  ): Promise<ProjectSummary> {
    const { status } = updateProjectStatusSchema.parse(body);
    return this.projects.setStatus(user, code, status);
  }
}
