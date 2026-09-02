import type { CurrentUser, ProjectSummary } from "@priyomka/contracts";
import { currentUserSchema, projectSummarySchema } from "@priyomka/contracts";
import { z } from "zod";

/**
 * Клиент API. Ответы проверяются теми же схемами, что и запросы на сервере:
 * если сервер начнёт отдавать не то, ошибка возникнет здесь, а не в вёрстке.
 */
const BASE = "/api";

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { credentials: "include", ...init });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Запрос ${path} завершился кодом ${response.status}`);
  }
  return schema.parse(await response.json());
}

export const fetchCurrentUser = (): Promise<CurrentUser> =>
  request("/auth/me", currentUserSchema);

export const fetchProjects = (): Promise<ProjectSummary[]> =>
  request("/projects", z.array(projectSummarySchema));

// exactOptionalPropertyTypes: отсутствующий токен и токен со значением
// undefined — разные вещи, и тип это отражает.
export const requestMagicLink = (
  email: string,
): Promise<{ sent: true; token?: string | undefined }> =>
  request(
    "/auth/magic-link",
    z.object({ sent: z.literal(true), token: z.string().optional() }),
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) },
  );

export const logout = (): Promise<{ ok: true }> =>
  request("/auth/logout", z.object({ ok: z.literal(true) }), { method: "POST" });
