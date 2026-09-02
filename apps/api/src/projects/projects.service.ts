import { Injectable, NotFoundException } from "@nestjs/common";
import type { ProjectSummary } from "@priyomka/contracts";
import { PrismaService } from "../prisma.service";
import type { RequestUser } from "../common/current-user";
import { projectScope } from "../common/project-scope";

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: RequestUser): Promise<ProjectSummary[]> {
    const projects = await this.prisma.project.findMany({
      where: projectScope(user),
      include: { client: true, foreman: true },
      orderBy: { code: "asc" },
    });
    return projects.map(toSummary);
  }

  async byCode(user: RequestUser, code: string): Promise<ProjectSummary> {
    const project = await this.prisma.project.findFirst({
      where: { ...projectScope(user), code },
      include: { client: true, foreman: true },
    });
    if (!project) {
      throw new NotFoundException({ message: `Объект ${code} не найден или недоступен.` });
    }
    return toSummary(project);
  }
}

type ProjectRow = {
  id: string;
  code: string;
  address: string;
  status: ProjectSummary["status"];
  deadline: Date | null;
  keysCount: number;
  supervisionShare: number;
  client: { code: string; name: string };
  foreman: { id: string; name: string } | null;
};

const toSummary = (project: ProjectRow): ProjectSummary => ({
  id: project.id,
  code: project.code,
  address: project.address,
  status: project.status,
  deadline: project.deadline ? project.deadline.toISOString().slice(0, 10) : null,
  keysCount: project.keysCount,
  supervisionShare: project.supervisionShare,
  client: { code: project.client.code, name: project.client.name },
  foreman: project.foreman ? { id: project.foreman.id, name: project.foreman.name } : null,
});
