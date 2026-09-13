import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Role } from "@priyomka/contracts";

/** Пользователь, установленный SessionGuard на время запроса. */
export interface RequestUser {
  id: string;
  role: Role;
  name: string;
  orgId: string;
  orgName: string;
  /**
   * Запись справочника, от лица которой входит заказчик. У прочих ролей
   * пуста. Видимость объектов заказчика строится по ней, а не по признаку
   * роли: роль говорит «он заказчик», а не «чей».
   */
  clientId: string | null;
}

/**
 * Каждый запрос знает организацию пользователя. Ни один обработчик не
 * обращается к данным без этого признака: принадлежность объекта
 * организации проверяется в запросе к базе, а не после выборки.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestUser => {
    const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    if (!request.user) throw new Error("SessionGuard не выполнялся до обработчика");
    return request.user;
  },
);
