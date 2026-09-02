/**
 * Проверка разграничения на уровне полей поверх HTTP.
 *
 * `docs/02_DEV_PROMPT.md`, раздел 4: ставка оплаты труда, зарплата и прибыль
 * не должны попадать в ответ API для ролей, кроме OWNER. Проверяется тестом,
 * который дёргает API от имени прораба и убеждается, что полей нет в теле
 * ответа. Здесь это делается на настоящем сервере и настоящей смете из
 * 132 позиций, а не на выдуманном объекте.
 */
const BASE = process.env.API ?? "http://127.0.0.1:3000";
const INTERNAL = ["unitWage", "wageTotal", "profit", "profitShare", "subtotalWage", "wage"];

const problems = [];
const check = (condition, message) => { if (!condition) problems.push(message); };

/** Обходит ответ целиком: поле на третьем уровне — такая же утечка, как в корне. */
function findInternal(payload, path = "$") {
  if (Array.isArray(payload)) return payload.flatMap((entry, i) => findInternal(entry, `${path}[${i}]`));
  if (payload === null || typeof payload !== "object") return [];
  const found = [];
  for (const [key, value] of Object.entries(payload)) {
    if (INTERNAL.includes(key)) found.push(`${path}.${key}`);
    found.push(...findInternal(value, `${path}.${key}`));
  }
  return found;
}

async function signIn(email) {
  const link = await fetch(`${BASE}/auth/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  }).then((r) => r.json());
  const response = await fetch(`${BASE}/auth/consume?token=${link.token}`, { redirect: "manual" });
  const cookie = response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return (path, init = {}) => fetch(`${BASE}${path}`, { ...init, headers: { cookie, ...init.headers } });
}

const owner = await signIn("owner@dolgiy.studio");
const foreman = await signIn("foreman@dolgiy.studio");

const ownerEstimate = await owner("/projects/R-99/estimate").then((r) => r.json());
check(ownerEstimate.positions === 132, `руководителю пришло ${ownerEstimate.positions} позиций вместо 132`);
check(findInternal(ownerEstimate).length > 0, "руководителю не пришли внутренние величины");
check(ownerEstimate.totals.wage !== undefined, "руководителю не пришёл фонд оплаты труда");

const foremanEstimate = await foreman("/projects/R-99/estimate").then((r) => r.json());
const leaks = findInternal(foremanEstimate);
check(leaks.length === 0, `прорабу утекли внутренние поля: ${leaks.slice(0, 5).join(", ")}`);
check(foremanEstimate.positions === 132, "прораб не получил позиции сметы");
check(foremanEstimate.totals.works !== undefined, "прораб не получил итог по работам");

const foreign = await foreman("/projects/R-42/estimate");
check(foreign.status === 404, `чужой объект отдан прорабу с кодом ${foreign.status}`);

/**
 * Сводка — такой же носитель внутренних величин, как позиция сметы:
 * фонд оплаты труда попадает в неё только руководителю.
 */
const ownerSummary = await owner("/summary").then((r) => r.json());
const foremanSummary = await foreman("/summary").then((r) => r.json());
check(ownerSummary.money.wage !== undefined, "руководителю не пришёл фонд оплаты труда в сводке");
const summaryLeaks = findInternal(foremanSummary);
check(summaryLeaks.length === 0, `в сводке прораба внутренние поля: ${summaryLeaks.join(", ")}`);
check(
  foremanSummary.projects.total < ownerSummary.projects.total,
  `сводка прораба охватывает ${foremanSummary.projects.total} объектов из ${ownerSummary.projects.total}`,
);

// Справочник заказчиков ограничен объектами, доступными роли.
const ownerClients = await owner("/clients").then((r) => r.json());
const foremanClients = await foreman("/clients").then((r) => r.json());
check(
  foremanClients.length > 0 && foremanClients.length < ownerClients.length,
  `прорабу пришло ${foremanClients.length} заказчиков из ${ownerClients.length}`,
);

// Статус объекта меняет руководитель.
const forbidden = await foreman("/projects/R-99/status", {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ status: "PAUSED" }),
});
check(forbidden.status === 403, `смена статуса прорабом отдана с кодом ${forbidden.status}`);

const anonymous = await fetch(`${BASE}/projects/R-99/estimate`);
check(anonymous.status === 401, `смета отдана без сессии с кодом ${anonymous.status}`);

console.log(`Позиций в ответе: ${foremanEstimate.positions}, разделов ${foremanEstimate.sectionsTopLevel} + ${foremanEstimate.sectionsNested}`);
console.log(`Внутренних полей у руководителя: ${findInternal(ownerEstimate).length}, у прораба: ${leaks.length}`);
console.log(`Сводка: объектов у руководителя ${ownerSummary.projects.total}, у прораба ${foremanSummary.projects.total};`,
  `заказчиков ${ownerClients.length} и ${foremanClients.length}`);
console.log(problems.length === 0 ? "\nРазграничение на уровне полей: замечаний нет" : "\nЗамечания:\n  " + problems.join("\n  "));
process.exit(problems.length === 0 ? 0 : 1);
