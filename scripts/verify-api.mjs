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

/**
 * Вход по номеру телефона. Проверяется не «работает ли», а то, чего
 * проверка на глаз не даёт: одинаковый ответ на существующий и
 * несуществующий номер, однократность кода, ограничение попыток и
 * невозможность обменять код маршрутом ссылки.
 */
const phoneRequest = (phone) =>
  fetch(`${BASE}/auth/phone/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone }),
  });

const phoneConfirm = (phone, code) =>
  fetch(`${BASE}/auth/phone/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, code }),
  });

const known = await phoneRequest("8 900 000-00-00").then((r) => r.json());
const unknown = await phoneRequest("+7 999 111-22-33").then((r) => r.json());
check(known.sent === true && unknown.sent === true, "ответ различает известный и неизвестный номер");
// Пробелы в показном номере неразрывные: иначе он рвётся переносом строки.
check(
  /^\+7\u00a0\(\d{3}\)\u00a0\d{3}-\d{2}-\d{2}$/u.test(known.phone),
  `номер вернулся как «${known.phone}»`,
);
check(typeof known.code === "string" && known.code.length === 6, "стенд не показал код подтверждения");
check(unknown.code === undefined, "код выдан на номер, которого нет в системе");

const foreignCode = await phoneRequest("+1 202 555-01-99");
check(foreignCode.status === 400, `чужой код страны принят с кодом ${foreignCode.status}`);
const landline = await phoneRequest("+7 473 000-00-00");
check(landline.status === 400, `городской номер принят на вход с кодом ${landline.status}`);

const wrongShape = await phoneConfirm("+79000000000", "12");
check(wrongShape.status === 400, `код из двух цифр принят с кодом ${wrongShape.status}`);

// Код нельзя обменять маршрутом ссылки: там не считаются попытки.
const asLink = await fetch(`${BASE}/auth/consume?token=${known.code}`, { redirect: "manual" });
check(asLink.status === 401 || asLink.status === 400, `код обменен маршрутом ссылки с кодом ${asLink.status}`);

const entered = await phoneConfirm("+79000000000", known.code);
check(entered.status === 201 || entered.status === 200, `вход по коду отклонён с кодом ${entered.status}`);
const phoneSession = /priyomka_session=([^;]+)/u.exec(entered.headers.get("set-cookie") ?? "")?.[1];
check(Boolean(phoneSession), "вход по коду не выдал сессию");

const reused = await phoneConfirm("+79000000000", known.code);
check(reused.status === 401, `погашенный код принят повторно с кодом ${reused.status}`);

// Пять неверных попыток гасят код: шесть цифр перебираются за миллион запросов.
const guessed = await phoneRequest("+79000000000").then((r) => r.json());
const wrong = guessed.code === "000000" ? "111111" : "000000";
const attempts = [];
for (let i = 0; i < 5; i += 1) attempts.push((await phoneConfirm("+79000000000", wrong)).status);
check(attempts.every((status) => status === 401), `попытки отдали коды ${attempts.join(", ")}`);
const blocked = await phoneConfirm("+79000000000", guessed.code);
check(blocked.status === 401, `верный код принят после пяти неудач с кодом ${blocked.status}`);

/** Карточка организации: читают все, правит руководитель. */
const organization = await owner("/organization").then((r) => r.json());
check(organization.currency === "RUB", "валюта организации не рублёвая");
check(typeof organization.timeZone === "string", "часовой пояс не пришёл");
const foremanOrganization = await foreman("/organization");
check(foremanOrganization.status === 200, `прорабу не отдана карточка организации: ${foremanOrganization.status}`);

const patchByForeman = await foreman("/organization", {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Чужая студия" }),
});
check(patchByForeman.status === 403, `правка организации прорабом отдана с кодом ${patchByForeman.status}`);

const badPhone = await owner("/organization", {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ phone: "телефон" }),
});
check(badPhone.status === 400, `мусор в телефоне организации принят с кодом ${badPhone.status}`);

const restored = await owner("/organization", {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ phone: organization.phone, email: organization.email ?? "" }),
}).then((r) => r.json());
check(restored.phone === organization.phone, "карточка организации не восстановлена после проверки");

/** Справочник единиц: девять канонических форм со своими написаниями. */
const units = await owner("/units").then((r) => r.json());
check(units.length === 9, `в справочнике ${units.length} единиц вместо девяти`);
check(
  units.every((unit) => Array.isArray(unit.aliases) && unit.aliases.length > 0),
  "у единицы справочника нет ни одного написания",
);

const anonymous = await fetch(`${BASE}/projects/R-99/estimate`);
check(anonymous.status === 401, `смета отдана без сессии с кодом ${anonymous.status}`);

console.log(`Позиций в ответе: ${foremanEstimate.positions}, разделов ${foremanEstimate.sectionsTopLevel} + ${foremanEstimate.sectionsNested}`);
console.log(`Внутренних полей у руководителя: ${findInternal(ownerEstimate).length}, у прораба: ${leaks.length}`);
console.log(`Сводка: объектов у руководителя ${ownerSummary.projects.total}, у прораба ${foremanSummary.projects.total};`,
  `заказчиков ${ownerClients.length} и ${foremanClients.length}`);
console.log(problems.length === 0 ? "\nРазграничение на уровне полей: замечаний нет" : "\nЗамечания:\n  " + problems.join("\n  "));
process.exit(problems.length === 0 ? 0 : 1);
