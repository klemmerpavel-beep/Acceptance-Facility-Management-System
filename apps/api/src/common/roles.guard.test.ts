import "reflect-metadata";
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import type { Role } from "@priyomka/contracts";
import { describe, expect, it } from "vitest";
import { OWNER_ONLY_KEY, ROLES_KEY, RolesGuard } from "./roles.guard";

/**
 * Страж ролей. Два правила, которые стенд проверяет перечнем маршрутов, а
 * здесь — самим правилом, на всех ролях сразу:
 * 1. непомеченный маршрут закрыт заказчику — забытый декоратор оборачивается
 *    отказом, а не утечкой;
 * 2. бухгалтер наследует руководителя всюду, кроме помеченного «только
 *    руководитель» (решение от 19.09.2026: «кроме настроек и ролей»).
 */
const РОЛИ: Role[] = ["OWNER", "FOREMAN", "ACCOUNTANT", "CLIENT"];

function пропуск(метки: { roles?: Role[]; ownerOnly?: boolean }, role: Role | undefined): boolean {
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === ROLES_KEY ? метки.roles : key === OWNER_ONLY_KEY ? метки.ownerOnly : undefined,
  };
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user: role === undefined ? undefined : { role } }) }),
  } as unknown as ExecutionContext;
  try {
    return new RolesGuard(reflector as never).canActivate(context);
  } catch (cause) {
    if (cause instanceof ForbiddenException) return false;
    throw cause;
  }
}

const открыто = (метки: { roles?: Role[]; ownerOnly?: boolean }): Role[] =>
  РОЛИ.filter((роль) => пропуск(метки, роль));

describe("страж ролей", () => {
  it("непомеченный маршрут открыт внутренним ролям и закрыт заказчику", () => {
    expect(открыто({})).toEqual(["OWNER", "FOREMAN", "ACCOUNTANT"]);
    expect(открыто({ roles: [] })).toEqual(["OWNER", "FOREMAN", "ACCOUNTANT"]);
  });

  it("без пользователя не открыто ничего", () => {
    expect(пропуск({}, undefined)).toBe(false);
    expect(пропуск({ roles: ["OWNER"] }, undefined)).toBe(false);
  });

  it("маршрут руководителя наследует бухгалтер, но не прораб и не заказчик", () => {
    expect(открыто({ roles: ["OWNER"] })).toEqual(["OWNER", "ACCOUNTANT"]);
  });

  it("«только руководитель» бухгалтеру закрыт", () => {
    expect(открыто({ roles: ["OWNER"], ownerOnly: true })).toEqual(["OWNER"]);
  });

  it("заказчику открыто только то, что названо прямо", () => {
    expect(открыто({ roles: ["OWNER", "CLIENT"] })).toEqual(["OWNER", "ACCOUNTANT", "CLIENT"]);
    expect(открыто({ roles: ["OWNER", "FOREMAN"] })).toEqual(["OWNER", "FOREMAN", "ACCOUNTANT"]);
  });

  it("отказ бухгалтеру в настройках называет причину словами", () => {
    const reflector = {
      getAllAndOverride: (key: string) => (key === ROLES_KEY ? ["OWNER"] : key === OWNER_ONLY_KEY ? true : undefined),
    };
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ user: { role: "ACCOUNTANT" } }) }),
    } as unknown as ExecutionContext;
    expect(() => new RolesGuard(reflector as never).canActivate(context))
      .toThrow("Настройки компании и выдача входа ведутся руководителем.");
  });
});
