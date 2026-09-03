import { CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AuthService } from "./auth.service";
import type { RequestUser } from "../common/current-user";

export const SESSION_COOKIE = "priyomka_session";

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest & { user?: RequestUser }>();
    const token = request.cookies[SESSION_COOKIE];
    if (!token) {
      throw new UnauthorizedException({ message: "Войдите по ссылке, отправленной на почту." });
    }
    const user = await this.auth.resolveSession(token);
    if (!user) {
      throw new UnauthorizedException({ message: "Сессия истекла. Запросите новую ссылку входа." });
    }
    request.user = user;
    return true;
  }
}
