import { Injectable } from "@nestjs/common";
import type { ClientRow, WorkerRow } from "@priyomka/contracts";
import { basisPoints, clientTotals, kopecks, sum, type Kopecks } from "@priyomka/domain";
import { PrismaService } from "../prisma.service";
import type { RequestUser } from "../common/current-user";
import { projectScope } from "../common/project-scope";
import { estimateFacts } from "../common/estimate-facts";

/**
 * Справочники организации: заказчики и расчётные единицы сдельной оплаты.
 *
 * Заказчик виден только вместе со своими объектами: прораб получает список
 * заказчиков тех объектов, на которые он назначен, и ничей больше.
 */
@Injectable()
export class DirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  async clients(user: RequestUser): Promise<ClientRow[]> {
    const projects = await this.prisma.project.findMany({
      where: projectScope(user),
      select: { id: true, clientId: true, supervisionShare: true },
    });
    if (projects.length === 0) return [];

    const facts = await estimateFacts(this.prisma, projects.map((project) => project.id));
    const clients = await this.prisma.client.findMany({
      where: { orgId: user.orgId, id: { in: [...new Set(projects.map((p) => p.clientId))] } },
      orderBy: { code: "asc" },
    });

    return clients.map((client) => {
      const own = projects.filter((project) => project.clientId === client.id);
      const totals: Kopecks[] = own.map((project) => {
        const estimate = facts.get(project.id);
        if (estimate === undefined) return kopecks(0);
        return clientTotals(estimate.works, basisPoints(estimate.supervisionShare)).total;
      });
      return {
        id: client.id,
        code: client.code,
        name: client.name,
        isCompany: client.isCompany,
        requisites: client.requisites,
        projects: own.length,
        estimateTotal: sum(totals).toString(),
      };
    });
  }

  async workers(user: RequestUser): Promise<WorkerRow[]> {
    const workers = await this.prisma.worker.findMany({
      where: { orgId: user.orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, kind: true },
    });
    return workers.map((worker) => ({ id: worker.id, name: worker.name, kind: worker.kind }));
  }
}
