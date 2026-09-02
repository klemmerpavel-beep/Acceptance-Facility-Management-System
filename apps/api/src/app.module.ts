import { Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { AuthService } from "./auth/auth.service";
import { AuthController } from "./auth/auth.controller";
import { SessionGuard } from "./auth/session.guard";
import { RolesGuard } from "./common/roles.guard";
import { AuditService } from "./common/audit.service";
import { ProjectsService } from "./projects/projects.service";
import { ProjectsController } from "./projects/projects.controller";

@Module({
  controllers: [AuthController, ProjectsController],
  providers: [PrismaService, AuthService, SessionGuard, RolesGuard, AuditService, ProjectsService],
})
export class AppModule {}
