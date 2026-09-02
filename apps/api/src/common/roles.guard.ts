import { CanActivate, type ExecutionContext, ForbiddenException, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@priyomka/contracts";
import type { RequestUser } from "./current-user";

export const ROLES_KEY = "priyomka:roles";

/** Ограничение обработчика перечнем ролей. */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    const role = request.user?.role;
    if (role && required.includes(role)) return true;

    throw new ForbiddenException({
      message: `Действие доступно ролям: ${required.join(", ")}. У вас роль ${role ?? "без роли"}.`,
    });
  }
}
