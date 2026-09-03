import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ZodError } from "zod";

/**
 * Отказ проверки схемы — это 400 с внятным текстом, а не 500.
 *
 * Схемы `@priyomka/contracts` вызываются прямо в контроллерах, и без этого
 * фильтра `ZodError` доходит до обработчика Nest как неизвестное исключение:
 * человек получает «Internal server error», а в журнале сервера появляется
 * запись об ошибке приложения там, где приложение работает правильно.
 * Раздел 6 норматива требует, чтобы ошибка объясняла, что произошло.
 *
 * Наружу отдаётся первое сообщение — то, которое относится к первому
 * непринятому полю; остальные перечисляются полем `issues`, чтобы форма
 * могла подсветить все поля разом.
 */
@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(error: ZodError, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const issues = error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    void reply.status(HttpStatus.BAD_REQUEST).send({
      statusCode: HttpStatus.BAD_REQUEST,
      message: issues[0]?.message ?? "Запрос не принят",
      issues,
    });
  }
}
