import { Controller, Get, UseGuards } from "@nestjs/common";
import type { Dashboard } from "@priyomka/contracts";
import { SummaryService } from "./summary.service";
import { SessionGuard } from "../auth/session.guard";
import { RolesGuard } from "../common/roles.guard";
import { CurrentUser, type RequestUser } from "../common/current-user";

@Controller("summary")
@UseGuards(SessionGuard, RolesGuard)
export class SummaryController {
  constructor(private readonly summary: SummaryService) {}

  @Get()
  dashboard(@CurrentUser() user: RequestUser): Promise<Dashboard> {
    return this.summary.dashboard(user);
  }
}
