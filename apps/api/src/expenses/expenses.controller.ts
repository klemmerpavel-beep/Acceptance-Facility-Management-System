import {
  BadRequestException, Controller, Delete, Get, Param, Post, Req, Res, UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ExpenseView } from "@priyomka/contracts";
import { createExpenseSchema } from "@priyomka/contracts";
import { ExpensesService } from "./expenses.service";
import { FileStorage } from "../common/file-storage";
import { detectImageType, ALLOWED_IMAGE_TYPES } from "../measure/image-type";
import { SessionGuard } from "../auth/session.guard";
import { Roles, RolesGuard } from "../common/roles.guard";
import { CurrentUser, type RequestUser } from "../common/current-user";

/**
 * Чеки на материалы.
 *
 * Заводят руководитель и прораб: материалы покупает тот, кто на объекте.
 * Подтверждает и отклоняет только руководитель — право признать расход
 * деньгами студии шире права его заявить.
 *
 * Чек приходит одним запросом вместе со снимком: снимок обязателен, и
 * раздельная отправка допускала бы расход без свидетельства. Приём письмом
 * не сделан — приёма почты на сервере нет.
 */

const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Разбор запроса: часть `expense` с телом и часть `file` со снимком чека. */
async function readExpense(
  request: FastifyRequest,
): Promise<{ expense: unknown; fileName: string; buffer: Buffer }> {
  let expense: unknown;
  let file: { fileName: string; buffer: Buffer } | null = null;

  for await (const part of request.parts()) {
    if (part.type === "file") {
      const buffer = await part.toBuffer();
      if (buffer.byteLength > MAX_FILE_BYTES) {
        throw new BadRequestException({
          message: `Снимок больше ${String(MAX_FILE_BYTES / 1024 / 1024)} МБ. `
            + "Снимите заново — камера телефона умещается в этот предел.",
        });
      }
      file = { fileName: part.filename, buffer };
      continue;
    }
    if (part.fieldname !== "expense") continue;
    try {
      expense = JSON.parse(String(part.value));
    } catch {
      throw new BadRequestException({ message: "Тело чека не разбирается как JSON." });
    }
  }

  if (expense === undefined) {
    throw new BadRequestException({ message: "В запросе нет описания чека." });
  }
  if (file === null) {
    throw new BadRequestException({
      message: "Приложите снимок чека: без него расход нечем предъявить заказчику.",
    });
  }
  return { expense, ...file };
}

@Controller("projects/:code/expenses")
@UseGuards(SessionGuard, RolesGuard)
export class ExpensesController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly storage: FileStorage,
  ) {}

  @Get()
  view(@CurrentUser() user: RequestUser, @Param("code") code: string): Promise<ExpenseView> {
    return this.expenses.view(user, code);
  }

  @Post()
  @Roles("OWNER", "FOREMAN")
  async create(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Req() request: FastifyRequest,
  ): Promise<ExpenseView> {
    const { expense, fileName, buffer } = await readExpense(request);
    const input = createExpenseSchema.parse(expense);

    /* Тип определяется по содержимому, а не по расширению: файл,
       назвавшийся снимком, свидетельством не становится. */
    const contentType = detectImageType(buffer);
    if (contentType === null) {
      throw new BadRequestException({
        message: `Снимок принимается изображением: ${ALLOWED_IMAGE_TYPES.join(", ")}. `
          + "Тип определяется по содержимому файла, а не по расширению.",
      });
    }

    return this.expenses.create(user, code, input, { fileName, contentType, buffer });
  }

  @Post(":id/confirm")
  @Roles("OWNER")
  confirm(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Param("id") id: string,
  ): Promise<ExpenseView> {
    return this.expenses.decide(user, code, id, "CONFIRMED");
  }

  @Post(":id/reject")
  @Roles("OWNER")
  reject(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Param("id") id: string,
  ): Promise<ExpenseView> {
    return this.expenses.decide(user, code, id, "REJECTED");
  }

  @Delete(":id")
  @Roles("OWNER", "FOREMAN")
  remove(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Param("id") id: string,
  ): Promise<ExpenseView> {
    return this.expenses.remove(user, code, id);
  }

  /**
   * Снимок чека. Запрашивается тегом `img` того же источника, кука сессии
   * уходит браузером сама — подписанные ссылки не нужны.
   */
  @Get(":id/file")
  async photo(
    @CurrentUser() user: RequestUser,
    @Param("code") code: string,
    @Param("id") id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const photo = await this.expenses.photo(user, code, id);
    void reply
      .header("content-type", photo.contentType)
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "private, no-cache")
      .header("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(photo.fileName)}`);
    return this.storage.get(photo.storageKey);
  }
}
