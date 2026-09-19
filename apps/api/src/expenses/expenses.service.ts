import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { CreateExpense, ExpenseView, MaterialExpense } from "@priyomka/contracts";
import { expenseFault, expenseTotals, kopecks, ownerLevel } from "@priyomka/domain";
import { PrismaService } from "../prisma.service";
import { AuditService } from "../common/audit.service";
import { FileStorage } from "../common/file-storage";
import type { RequestUser } from "../common/current-user";
import { projectScope } from "../common/project-scope";
import { IMAGE_EXTENSION, type ImageType } from "../measure/image-type";

/**
 * Чеки на материалы: расход объекта с подтверждением руководителем.
 *
 * Заказчик назвал утрату чеков одной из главных потерь: бухгалтера в
 * компании нет, материалы возмещаются заказчиком по факту предъявления, и
 * чек, которого нет в системе, — это деньги, которых студия не получит.
 *
 * **Почтового шлюза здесь нет.** Бизнес-правило 12 описывает приём писем на
 * адрес `checks+<код>@<домен>`; приёма на сервере не существует, домен не
 * подтверждён, и адрес на экране не показывается — показанный адрес, на
 * который нельзя писать, обещает работу, которой нет.
 *
 * Правила счёта и отказа живут в домене (`expenseTotals`, `expenseFault`) и
 * зовутся отсюда до записи. Экран зовёт те же — одно правило, два места
 * применения, ни одной копии.
 */

/** Подписи видов расхода для журнала: `MATERIALS` прорабу читать нечем. */
const ВИД: Readonly<Record<string, string>> = {
  MATERIALS: "материалы",
  DELIVERY: "доставка",
  TOOLS: "инструмент",
  OTHER: "прочее",
};

/** Сегодняшний день организации в виде `ГГГГ-ММ-ДД`. */
const сегодня = (): string => new Date().toISOString().slice(0, 10);

const день = (значение: Date): string => значение.toISOString().slice(0, 10);

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: FileStorage,
  ) {}

  /** Видимость объекта — общим правилом; своего здесь нет. */
  private async projectOf(user: RequestUser, code: string) {
    const project = await this.prisma.project.findFirst({ where: { ...projectScope(user), code } });
    if (!project) {
      throw new NotFoundException({ message: `Объект ${code} не найден или недоступен.` });
    }
    return project;
  }

  private async expenseOf(projectId: string, id: string) {
    const expense = await this.prisma.materialExpense.findFirst({ where: { id, projectId } });
    if (!expense) {
      throw new NotFoundException({ message: "Чек не найден или недоступен." });
    }
    return expense;
  }

  async view(user: RequestUser, code: string): Promise<ExpenseView> {
    const project = await this.projectOf(user, code);
    const rows = await this.prisma.materialExpense.findMany({
      where: { projectId: project.id },
      include: {
        section: { select: { id: true, name: true } },
        createdBy: { select: { name: true } },
        confirmedBy: { select: { name: true } },
      },
      /* Черновики впереди: их надо разобрать, и это единственная работа на
         экране. Внутри — свежие сверху: чек недельной давности разбирают
         раньше, чем позавчерашний, только если он позже попал. */
      orderBy: [{ status: "asc" }, { spentAt: "desc" }],
    });

    const totals = expenseTotals(rows.map((row) => ({
      status: row.status,
      amount: kopecks(row.amount),
      reimbursable: row.reimbursable,
    })));

    return {
      rows: rows.map((row): MaterialExpense => ({
        id: row.id,
        status: row.status,
        kind: row.kind,
        amount: row.amount.toString(),
        reimbursable: row.reimbursable,
        seller: row.seller,
        spentAt: день(row.spentAt),
        section: row.section === null ? null : { id: row.section.id, name: row.section.name },
        note: row.note,
        fileName: row.fileName,
        createdBy: row.createdBy?.name ?? null,
        createdAt: row.createdAt.toISOString(),
        confirmedBy: row.confirmedBy?.name ?? null,
      })),
      totals: {
        spent: totals.spent.toString(),
        reimbursable: totals.reimbursable.toString(),
        own: totals.own.toString(),
        drafts: rows.filter((row) => row.status === "DRAFT").length,
      },
    };
  }

  /**
   * Заведение чека.
   *
   * **Заведённый руководителем сразу подтверждён.** Требовать от него
   * второго щелчка по собственной записи значит придумать шаг: подтверждение
   * существует затем, чтобы руководитель видел чужую покупку, а не свою.
   *
   * Снимок обязателен и проверен вызывающим по содержимому файла. Расход без
   * свидетельства нельзя предъявить заказчику, а предъявление и есть
   * назначение вкладки.
   */
  async create(
    user: RequestUser,
    code: string,
    input: CreateExpense,
    photo: { fileName: string; contentType: ImageType; buffer: Buffer },
  ): Promise<ExpenseView> {
    const project = await this.projectOf(user, code);

    const отказ = expenseFault(
      { amount: kopecks(input.amount), seller: input.seller, spentAt: input.spentAt },
      сегодня(),
    );
    if (отказ !== null) throw new BadRequestException({ message: отказ });

    /* Раздел проверяется до записи и по действующей смете объекта: чужой
       опознаватель иначе отверг бы драйвер связи, сообщением базы вместо
       человеческого. */
    if (input.sectionId !== null) {
      const раздел = await this.prisma.estimateSection.findFirst({
        where: { id: input.sectionId, estimate: { projectId: project.id } },
        select: { id: true },
      });
      if (!раздел) {
        throw new BadRequestException({ message: "Такого раздела нет в смете этого объекта." });
      }
    }

    const сразуПодтверждён = ownerLevel(user.role);
    const key = `projects/${project.id}/expenses/${randomUUID()}`
      + `.${IMAGE_EXTENSION[photo.contentType]}`;
    await this.storage.put(key, photo.buffer, photo.contentType);

    await this.prisma.$transaction(async (tx) => {
      await tx.materialExpense.create({
        data: {
          projectId: project.id,
          status: сразуПодтверждён ? "CONFIRMED" : "DRAFT",
          kind: input.kind,
          amount: BigInt(input.amount),
          reimbursable: input.reimbursable,
          seller: input.seller,
          spentAt: new Date(input.spentAt),
          sectionId: input.sectionId,
          note: input.note,
          storageKey: key,
          fileName: photo.fileName,
          contentType: photo.contentType,
          byteSize: photo.buffer.byteLength,
          createdById: user.id,
          confirmedById: сразуПодтверждён ? user.id : null,
          confirmedAt: сразуПодтверждён ? new Date() : null,
        },
      });
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "MaterialExpense",
        entityId: project.id,
        field: `чек ${input.seller} — ${ВИД[input.kind] ?? input.kind}`,
        oldValue: null,
        newValue: `${input.amount} копеек${сразуПодтверждён ? "" : ", черновик"}`,
      });
    });

    return this.view(user, code);
  }

  /**
   * Подтверждение и отклонение — только руководителю.
   *
   * Отклонённый чек не удаляется: история не переписывается (БП-04), и
   * «почему этот чек не возместили» спрашивают через месяц.
   */
  async decide(
    user: RequestUser,
    code: string,
    id: string,
    решение: "CONFIRMED" | "REJECTED",
  ): Promise<ExpenseView> {
    if (!ownerLevel(user.role)) {
      throw new ForbiddenException({ message: "Чеки подтверждает руководитель." });
    }
    const project = await this.projectOf(user, code);
    const expense = await this.expenseOf(project.id, id);
    if (expense.status === решение) return this.view(user, code);

    await this.prisma.$transaction(async (tx) => {
      await tx.materialExpense.update({
        where: { id: expense.id },
        data: {
          status: решение,
          confirmedById: user.id,
          confirmedAt: new Date(),
        },
      });
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "MaterialExpense",
        entityId: project.id,
        field: `чек ${expense.seller} — состояние`,
        oldValue: expense.status,
        newValue: решение,
      });
    });

    return this.view(user, code);
  }

  /**
   * Удаление черновика. Подтверждённый и отклонённый не удаляются: первый —
   * деньги, второй — история. Снимок снимается с диска после коммита: файл,
   * удалённый до записи, теряется вместе с откатом транзакции.
   */
  async remove(user: RequestUser, code: string, id: string): Promise<ExpenseView> {
    const project = await this.projectOf(user, code);
    const expense = await this.expenseOf(project.id, id);
    if (expense.status !== "DRAFT") {
      throw new BadRequestException({
        message: "Удаляется только черновик. Подтверждённый чек — деньги, отклонённый — история.",
      });
    }
    if (!ownerLevel(user.role) && expense.createdById !== user.id) {
      throw new ForbiddenException({ message: "Чужой черновик удаляет руководитель." });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.materialExpense.delete({ where: { id: expense.id } });
      await this.audit.record({
        orgId: user.orgId,
        actorId: user.id,
        entity: "MaterialExpense",
        entityId: project.id,
        field: `чек ${expense.seller} — черновик удалён`,
        oldValue: `${expense.amount.toString()} копеек`,
        newValue: null,
      });
    });

    await this.storage.remove(expense.storageKey);
    return this.view(user, code);
  }

  /** Снимок чека для отдачи. Доступ — тот же, что у вкладки. */
  async photo(
    user: RequestUser,
    code: string,
    id: string,
  ): Promise<{ storageKey: string; contentType: string; fileName: string }> {
    const project = await this.projectOf(user, code);
    const expense = await this.expenseOf(project.id, id);
    return {
      storageKey: expense.storageKey,
      contentType: expense.contentType,
      fileName: expense.fileName,
    };
  }
}
