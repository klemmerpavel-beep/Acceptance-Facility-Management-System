import type { RequestUser } from "./current-user";

/**
 * Правило видимости объекта. Объявлено один раз и используется всеми
 * службами: вторая копия этого правила разошлась с первой и открыла
 * прорабу смету объекта, на который он не назначен.
 *
 * Условие уходит в запрос к базе, а не проверяется после выборки:
 * обработчик физически не может получить недоступный объект.
 */
export function projectScope(user: RequestUser): { orgId: string; foremanId?: string } {
  return user.role === "FOREMAN"
    ? { orgId: user.orgId, foremanId: user.id }
    : { orgId: user.orgId };
}
