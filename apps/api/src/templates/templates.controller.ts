import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from "@nestjs/common";
import type { DocumentTemplate, IssuedDocument, TemplateRow } from "@priyomka/contracts";
import { issueDocumentSchema, saveTemplateSchema } from "@priyomka/contracts";
import { TemplatesService } from "./templates.service";
import { SessionGuard } from "../auth/session.guard";
import { Roles, RolesGuard } from "../common/roles.guard";
import { CurrentUser, type RequestUser } from "../common/current-user";

/**
 * Документы организации.
 *
 * Перечень и выпуск читают обе роли: прораб берёт на объект подписанный
 * договор так же, как руководитель. Правит шаблоны только руководитель —
 * договор организации не редактируют с телефона между приёмками.
 */
@Controller("templates")
@UseGuards(SessionGuard, RolesGuard)
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  list(@CurrentUser() user: RequestUser): Promise<TemplateRow[]> {
    return this.templates.list(user);
  }

  @Get(":id")
  view(@CurrentUser() user: RequestUser, @Param("id") id: string): Promise<DocumentTemplate> {
    return this.templates.view(user, id);
  }

  @Post()
  @Roles("OWNER")
  create(@CurrentUser() user: RequestUser, @Body() body: unknown): Promise<TemplateRow[]> {
    return this.templates.save(user, saveTemplateSchema.parse(body), null);
  }

  @Put(":id")
  @Roles("OWNER")
  update(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<TemplateRow[]> {
    return this.templates.save(user, saveTemplateSchema.parse(body), id);
  }

  @Delete(":id")
  @Roles("OWNER")
  remove(@CurrentUser() user: RequestUser, @Param("id") id: string): Promise<TemplateRow[]> {
    return this.templates.remove(user, id);
  }

  /** Выпуск документа по объекту: метки заменяются значениями. */
  @Post(":id/issue")
  issue(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<IssuedDocument> {
    return this.templates.issue(user, id, issueDocumentSchema.parse(body).projectCode);
  }
}
