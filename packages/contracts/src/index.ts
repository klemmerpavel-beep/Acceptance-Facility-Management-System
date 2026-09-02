/**
 * Контракты API. Одни и те же схемы проверяют тело запроса на сервере и
 * типизируют клиента: расхождение между ними невозможно по построению.
 *
 * Денежные величины пересекают границу HTTP строкой, а не числом: JSON
 * не имеет целых произвольной длины, а `number` для денег запрещён (БП-08).
 */
import { z } from "zod";

/** Целое число копеек в виде строки: "375877835". */
export const kopecksString = z
  .string()
  .regex(/^-?\d+$/, "Копейки передаются целым числом в строке");

/** Тысячные доли единицы измерения в виде строки: "406910" — это 406,91 м². */
export const milliunitsString = z
  .string()
  .regex(/^-?\d+$/, "Количество передаётся в тысячных долях целым числом в строке");

export const roleSchema = z.enum(["OWNER", "FOREMAN", "SUPPLY"]);
export type Role = z.infer<typeof roleSchema>;

export const projectStatusSchema = z.enum([
  "NEW", "IN_PROGRESS", "PAUSED", "WAITING_CLIENT", "DONE", "ARCHIVED",
]);

/** Код объекта: латинская буква, дефис, цифры. Сквозной идентификатор R-99. */
export const projectCodeSchema = z
  .string()
  .regex(/^[A-Z]-\d{1,4}$/, "Код объекта имеет вид R-99");

export const requestMagicLinkSchema = z.object({
  email: z.string().email("Нужен адрес почты"),
});
export type RequestMagicLink = z.infer<typeof requestMagicLinkSchema>;

export const consumeTokenSchema = z.object({
  token: z.string().min(32, "Ссылка входа повреждена"),
});

export const currentUserSchema = z.object({
  id: z.string().uuid(),
  role: roleSchema,
  name: z.string(),
  organization: z.object({ id: z.string().uuid(), name: z.string() }),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

export const projectSummarySchema = z.object({
  id: z.string().uuid(),
  code: projectCodeSchema,
  address: z.string(),
  status: projectStatusSchema,
  deadline: z.string().date().nullable(),
  keysCount: z.number().int().nonnegative(),
  supervisionShare: z.number().int().nonnegative(),
  client: z.object({ code: z.string(), name: z.string() }),
  foreman: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

export const errorSchema = z.object({
  /** Сообщение объясняет, что произошло и что делать. Извинений нет. */
  message: z.string(),
  details: z.array(z.string()).optional(),
});
