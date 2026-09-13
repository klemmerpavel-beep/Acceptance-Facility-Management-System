import { CanActivate, type ExecutionContext, ForbiddenException, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@priyomka/contracts";
import type { RequestUser } from "./current-user";

export const ROLES_KEY = "priyomka:roles";

/** Ограничение обработчика перечнем ролей. */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

/**
 * Роли, которым непомеченный обработчик открыт по умолчанию.
 *
 * **Заказчика в этом перечне нет — и это главное правило стража.** Роль,
 * добавленная в продукт, иначе получила бы доступ ко всякому маршруту, где
 * никто не вспомнил поставить декоратор: к приёмке, чекам, траншам,
 * справочникам, бухгалтерии. Умолчание «разрешено» безопасно ровно до той
 * поры, пока роли две и обе внутренние.
 *
 * Заказчик — сторона вне компании, и ему открыто только то, что названо
 * прямо. Забытый декоратор оборачивается отказом, а не утечкой: цена ошибки
 * переносится с заказчика на разработчика.
 */
const ПО_УМОЛЧАНИЮ: readonly Role[] = ["OWNER", "FOREMAN"];

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    const role = request.user?.role;

    if (!required || required.length === 0) {
      if (role !== undefined && ПО_УМОЛЧАНИЮ.includes(role)) return true;
      throw new ForbiddenException({
        message: "Этот раздел ведётся внутри компании. "
          + "Заказчику открыты ход работ по своему объекту и бумаги по нему.",
      });
    }

    if (role && required.includes(role)) return true;

    throw new ForbiddenException({
      message: `Действие доступно ролям: ${required.join(", ")}. У вас роль ${role ?? "без роли"}.`,
    });
  }
}
