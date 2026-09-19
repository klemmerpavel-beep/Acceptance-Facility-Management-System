import { CanActivate, type ExecutionContext, ForbiddenException, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@priyomka/contracts";
import { ownerLevel } from "@priyomka/domain";
import type { RequestUser } from "./current-user";

export const ROLES_KEY = "priyomka:roles";
export const OWNER_ONLY_KEY = "priyomka:owner-only";

/** Ограничение обработчика перечнем ролей. */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

/**
 * Настройки компании и выдача входа: сюда бухгалтер не наследует.
 *
 * Единственное исключение из правила наследования ниже, и поэтому оно
 * помечается прямо у обработчика, а не выводится из имени маршрута. Решение
 * заказчика от 19.09.2026 названо двумя словами — «кроме настроек и ролей», —
 * и ровно эти два слова обязаны стоять в коде отметкой, которую видно при
 * чтении обработчика.
 */
export const OwnerOnly = (): MethodDecorator & ClassDecorator =>
  SetMetadata(OWNER_ONLY_KEY, true);

/**
 * Роли, которым непомеченный обработчик открыт по умолчанию.
 *
 * **Заказчика в этом перечне нет — и это главное правило стража.** Роль,
 * добавленная в продукт, иначе получила бы доступ ко всякому маршруту, где
 * никто не вспомнил поставить декоратор: к приёмке, чекам, траншам,
 * справочникам, бухгалтерии. Умолчание «разрешено» безопасно ровно до той
 * поры, пока роли внутренние.
 *
 * Заказчик — сторона вне компании, и ему открыто только то, что названо
 * прямо. Забытый декоратор оборачивается отказом, а не утечкой: цена ошибки
 * переносится с заказчика на разработчика.
 */
const ПО_УМОЛЧАНИЮ: readonly Role[] = ["OWNER", "FOREMAN", "ACCOUNTANT"];

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const ownerOnly = this.reflector.getAllAndOverride<boolean | undefined>(OWNER_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? false;
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

    /* Наследование, а не перечисление.

       Решение заказчика от 19.09.2026 звучит отрицанием: бухгалтеру открыто
       всё, кроме настроек и ролей. Исполнить его перечислением значило бы
       дописать роль в шестьдесят с лишним декораторов `@Roles("OWNER")` — и
       забыть её в одном-двух, а отказ там, где доступ обещан, выглядит
       работающим продуктом ровно до того дня, когда бухгалтер откроет тот
       самый экран.

       Цена приёма названа: маршрут, открытый одному руководителю впредь,
       откроется и бухгалтеру, если автор не поставит `@OwnerOnly()`. Это
       умолчание «разрешено» для внутренней роли — то самое, что для
       заказчика запрещено абзацем выше, — и держится оно на том, что
       бухгалтер внутри компании, а заказчик вне её. */
    if (!ownerOnly && required.includes("OWNER") && ownerLevel(role)) return true;

    throw new ForbiddenException({
      message: ownerOnly && role === "ACCOUNTANT"
        ? "Настройки компании и выдача входа ведутся руководителем."
        : `Действие доступно ролям: ${required.join(", ")}. У вас роль ${role ?? "без роли"}.`,
    });
  }
}
