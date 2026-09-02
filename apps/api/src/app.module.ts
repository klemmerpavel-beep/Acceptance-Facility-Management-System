import { Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { AuthService } from "./auth/auth.service";
import { AuthController } from "./auth/auth.controller";
import { SessionGuard } from "./auth/session.guard";
import { RolesGuard } from "./common/roles.guard";
import { AuditService } from "./common/audit.service";
import { ProjectsService } from "./projects/projects.service";
import { ProjectsController } from "./projects/projects.controller";
import { EstimatesService } from "./estimates/estimates.service";
import { EstimatesController } from "./estimates/estimates.controller";
import { SummaryService } from "./summary/summary.service";
import { SummaryController } from "./summary/summary.controller";
import { DirectoryService } from "./directory/directory.service";
import { DirectoryController } from "./directory/directory.controller";

@Module({
  controllers: [
    AuthController, ProjectsController, EstimatesController,
    SummaryController, DirectoryController,
  ],
  providers: [
    PrismaService, AuthService, SessionGuard, RolesGuard, AuditService,
    ProjectsService, EstimatesService, SummaryService, DirectoryService,
  ],
})
export class AppModule {}
