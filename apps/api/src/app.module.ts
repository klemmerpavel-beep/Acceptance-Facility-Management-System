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
import { MeasureService } from "./measure/measure.service";
import { MeasureController } from "./measure/measure.controller";
import { StagesService } from "./stages/stages.service";
import { AcceptanceService } from "./acceptance/acceptance.service";
import { StagesController } from "./stages/stages.controller";
import { AcceptanceController } from "./acceptance/acceptance.controller";
import { FileStorage, LocalFileStorage } from "./common/file-storage";

@Module({
  controllers: [
    AuthController, ProjectsController, EstimatesController,
    SummaryController, DirectoryController, MeasureController, StagesController,
    AcceptanceController,
  ],
  providers: [
    PrismaService, AuthService, SessionGuard, RolesGuard, AuditService,
    ProjectsService, EstimatesService, SummaryService, DirectoryService, MeasureService,
    StagesService,
    AcceptanceService,
    // Хранилище файлов подключается портом: смена реализации на S3 при
    // переезде в облако (план 6.1) — правка этой одной строки.
    { provide: FileStorage, useClass: LocalFileStorage },
  ],
})
export class AppModule {}
