/**
 * Проверка разграничения на уровне полей поверх HTTP.
 *
 * `docs/02_DEV_PROMPT.md`, раздел 4: ставка оплаты труда, зарплата и прибыль
 * не должны попадать в ответ API для ролей, кроме OWNER. Проверяется тестом,
 * который дёргает API от имени прораба и убеждается, что полей нет в теле
 * ответа. Здесь это делается на настоящем сервере и настоящей смете из
 * 132 позиций, а не на выдуманном объекте.
 */
import { readFileSync } from "node:fs";

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

const client = await signIn("client@dolgiy.studio");
const accountant = await signIn("buh@dolgiy.studio");
const яРуководитель = await owner("/auth/me").then((r) => r.json());

/* --- четвёртая роль: бухгалтер ----------------------------------------------
   Заведена ответом заказчика на вопрос 7 квиза от 19.09.2026. Решение звучит
   отрицанием — «всё, кроме настроек и ролей», — и потому проверяется обеими
   половинами: одна половина в одиночку держится и тогда, когда роль не
   работает вовсе либо открыта целиком.
   -------------------------------------------------------------------------- */
const яБухгалтер = await accountant("/auth/me").then((r) => r.json());
check(яБухгалтер.role === "ACCOUNTANT", `роль бухгалтера «${яБухгалтер.role}» вместо ACCOUNTANT`);

/* Открыто: деньги, объекты, сметы, заявки, документы. Перечень взят не
   наугад — это ровно те маршруты, которые помечены `@Roles("OWNER")` и
   наследуются бухгалтером. */
for (const [имя, путь] of [
  ["бухгалтерия", "/accounting"],
  ["транши объекта", "/projects/R-99/tranches"],
  ["смета", "/projects/R-99/estimate"],
  ["приёмка", "/projects/R-99/acceptance"],
  ["чеки", "/projects/R-99/expenses"],
  ["заявки", "/leads"],
  ["шаблоны документов", "/templates"],
  ["справочник заказчиков", "/clients"],
  ["перечень актов", "/projects/R-99/acts"],
]) {
  const ответ = await accountant(путь);
  check(ответ.status === 200, `бухгалтеру закрыт ${имя}: код ${ответ.status}`);
}

/* Закрыто: настройки компании и выдача входа — те самые два слова решения. */
for (const [имя, путь] of [
  ["люди организации", "/people"],
  ["типы ремонта", "/repair-types"],
  ["типовые сметы", "/blueprints"],
]) {
  const ответ = await accountant(путь);
  check(ответ.status === 403, `бухгалтеру открыт${имя === "люди организации" ? "ы" : ""} ${имя}: код ${ответ.status}`);
}
const правкаОрганизации = await accountant("/organization", {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Проверка стража" }),
});
check(
  правкаОрганизации.status === 403,
  `бухгалтер правит карточку организации с кодом ${правкаОрганизации.status}`,
);

/* Внутренние величины бухгалтеру приходят: решение заказчика от 19.09.2026.
   Сверяется не наличием ключей, а равенством ответу руководителя — иначе
   правило держалось бы на одном поле из четырёх. */
const сметаБухгалтеру = await accountant("/projects/R-99/estimate").then((r) => r.json());
const сметаРуководителю = await owner("/projects/R-99/estimate").then((r) => r.json());
check(
  findInternal(сметаБухгалтеру).length === findInternal(сметаРуководителю).length,
  `внутренних полей бухгалтеру ${findInternal(сметаБухгалтеру).length}, `
  + `руководителю ${findInternal(сметаРуководителю).length}`,
);
check(
  findInternal(сметаБухгалтеру).length > 0,
  "бухгалтеру не пришло ни одного внутреннего поля: разграничение проверено пустым ответом",
);

/* --- три роли: руководитель, прораб, заказчик --------------------------------
   Заказчик — сторона вне компании, и правило стража обратное прочим: ему
   закрыто всё, что не названо прямо. Проверяется обеими сторонами — и что
   открытое открыто, и что закрытое закрыто: правило «доступа нет» в
   одиночку держится и тогда, когда роль не работает вовсе.
   -------------------------------------------------------------------------- */
const яЗаказчик = await client("/auth/me").then((r) => r.json());
check(яЗаказчик.role === "CLIENT", `роль заказчика «${яЗаказчик.role}» вместо CLIENT`);

const объектыЗаказчика = await client("/projects").then((r) => r.json());
check(Array.isArray(объектыЗаказчика) && объектыЗаказчика.length > 0,
  "заказчику не пришло ни одного объекта: вход есть, смотреть нечего");
check(Array.isArray(объектыЗаказчика) && объектыЗаказчика.length < 8,
  `заказчику пришло ${объектыЗаказчика.length} объектов — столько же, сколько руководителю`);
check(Array.isArray(объектыЗаказчика) && объектыЗаказчика.some((p) => p.code === "R-99"),
  "заказчику не пришёл его собственный объект R-99");

/* Открыто: ход работ и бумаги по своему объекту. */
for (const [имя, путь] of [
  ["карточка объекта", "/projects/R-99"],
  ["журнал объекта", "/projects/R-99/events"],
  ["график работ", "/projects/R-99/stages"],
  ["смета", "/projects/R-99/estimate"],
  ["фотоотчёт", "/projects/R-99/acceptance/report"],
  ["перечень актов", "/projects/R-99/acts"],
]) {
  const ответ = await client(путь);
  check(ответ.status === 200, `заказчику закрыт ${имя}: код ${ответ.status}`);
}

/* Закрыто: внутренняя работа компании. Непомеченный маршрут заказчику
   недоступен по умолчанию — забытый декоратор оборачивается отказом, а не
   утечкой. */
for (const [имя, путь] of [
  ["приёмка", "/projects/R-99/acceptance"],
  ["чеки", "/projects/R-99/expenses"],
  ["транши", "/projects/R-99/tranches"],
  ["бухгалтерия", "/accounting"],
  ["заявки", "/leads"],
  ["шаблоны документов", "/templates"],
  ["люди организации", "/people"],
  ["справочник заказчиков", "/clients"],
]) {
  const ответ = await client(путь);
  check(ответ.status === 403, `заказчику открыт ${имя}: код ${ответ.status}`);
}

/* Чужой объект — тот же 404, что у прораба: отбор задаётся запросом к базе. */
const чужойЗаказчику = await client("/projects/R-42");
check(чужойЗаказчику.status === 404,
  `чужой объект отдан заказчику с кодом ${чужойЗаказчику.status}`);

/* Внутренних величин заказчику не приходит нигде — наравне с прорабом. */
const сметаЗаказчику = await client("/projects/R-99/estimate").then((r) => r.json());
const утечкаЗаказчику = findInternal(сметаЗаказчику);
check(утечкаЗаказчику.length === 0,
  `заказчику утекли внутренние поля сметы: ${утечкаЗаказчику.slice(0, 5).join(", ")}`);

const актыЗаказчику = await client("/projects/R-99/acts").then((r) => r.json());
if (Array.isArray(актыЗаказчику) && актыЗаказчику[0] !== undefined) {
  const внутрьЗаказчику = await client(`/projects/R-99/acts/${актыЗаказчику[0].trancheId}?view=internal`);
  check(внутрьЗаказчику.status === 403,
    `заказчик получил внутренний вид акта с кодом ${внутрьЗаказчику.status}`);
}

/* --- люди организации: вход выдаёт руководитель ------------------------------
   Самостоятельной регистрации нет. Проверяется, что доступ выдаётся и
   снимается, и что выдать его может только руководитель.
   -------------------------------------------------------------------------- */
const люди = await owner("/people").then((r) => r.json());
check(Array.isArray(люди) && люди.length >= 3,
  `людей в организации ${люди.length}: ожидались хотя бы руководитель, прораб и заказчик`);
check(Array.isArray(люди) && люди.some((человек) => человек.role === "CLIENT"),
  "среди людей организации нет заказчика");

const прорабЗаводит = await foreman("/people", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Свой", role: "FOREMAN", email: "own@x.ru", phone: null, clientId: null }),
});
check(прорабЗаводит.status === 403, `прораб завёл человека с кодом ${прорабЗаводит.status}`);

const заказчикБезСвязи = await owner("/people", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Без связи", role: "CLIENT", email: "no@x.ru", phone: null, clientId: null }),
});
check(заказчикБезСвязи.status === 400,
  `заказчик без записи справочника заведён с кодом ${заказчикБезСвязи.status}`);

const безВхода = await owner("/people", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Немой", role: "FOREMAN", email: null, phone: null, clientId: null }),
});
check(безВхода.status === 400, `человек без почты и телефона заведён с кодом ${безВхода.status}`);

const занятаяПочта = await owner("/people", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({
    name: "Двойник", role: "FOREMAN", email: "owner@dolgiy.studio", phone: null, clientId: null,
  }),
});
check(занятаяПочта.status === 400, `занятая почта принята с кодом ${занятаяПочта.status}`);

const справочникДляДоступа = await owner("/clients").then((r) => r.json());
const доступВыдан = await owner("/people", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({
    name: "Проверка API: заказчик", role: "CLIENT",
    email: "proverka-api@dolgiy.studio", phone: null, clientId: справочникДляДоступа[0]?.id ?? null,
  }),
});
check(доступВыдан.status === 201, `заведение заказчика дало код ${доступВыдан.status}`);
if (доступВыдан.status === 201) {
  const { token } = await доступВыдан.json();
  check(typeof token === "string" && token.length > 0, "ссылка входа не выдана");
  /* Ссылка обменивается на вход: выданная и неработающая — это не доступ. */
  const вход = await fetch(`${BASE}/auth/consume?token=${token}`, { redirect: "manual" });
  check(вход.status === 302, `ссылка не обменялась на вход: код ${вход.status}`);
}

/* Себе доступ не снимают: организация осталась бы без руководителя. */
const себе = await owner(`/people/${яРуководитель.id}`, { method: "DELETE" });
check(себе.status === 400, `руководитель снял доступ себе с кодом ${себе.status}`);

console.log(`Роли: заказчику объектов ${объектыЗаказчика.length} из 8;`,
  `людей в организации ${люди.length}; внутренних полей заказчику ${утечкаЗаказчику.length}`);

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

/* Состав портфеля по статусам сходится с независимым пересчётом из списка
   объектов. Сводка считает его своей выборкой, список — своей; разойдясь,
   они дали бы на одном экране полосу долей и таблицу, противоречащие друг
   другу. */
const объектыДляСостава = await owner("/projects").then((r) => r.json());
const поСтатусам = new Map();
for (const project of объектыДляСостава) {
  поСтатусам.set(project.status, (поСтатусам.get(project.status) ?? 0) + 1);
}
check(
  ownerSummary.statuses.every((row) => поСтатусам.get(row.status) === row.count),
  "состав портфеля в сводке не сошёлся с пересчётом по списку объектов: "
  + ownerSummary.statuses.map((row) => `${row.status} ${row.count}/${поСтатусам.get(row.status) ?? 0}`).join(", "),
);
check(
  ownerSummary.statuses.reduce((всего, row) => всего + row.count, 0) === объектыДляСостава.length,
  "сумма по статусам не равна числу объектов портфеля",
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

/* --- Обмерный план ------------------------------------------------------
 * Денежных величин в замере нет, разграничения по полям не требуется.
 * Проверяется другое: кто вправе править, кому объект виден и сходятся ли
 * производные величины с числами утверждённого артборда.
 * --------------------------------------------------------------------- */

const measure = await owner("/projects/R-99/measure").then((r) => r.json());
check(measure.rooms.length === 7, `помещений в обмере ${measure.rooms.length} вместо семи`);
check(measure.totals.floorArea === "80530", `площадь объекта ${measure.totals.floorArea} вместо 80530 тысячных`);
check(measure.totals.floorPerimeter === "86070", `периметр пола ${measure.totals.floorPerimeter} вместо 86070`);
check(measure.totals.ceilingPerimeter === "97390", `периметр потолка ${measure.totals.ceilingPerimeter} вместо 97390`);
check(measure.totals.wallArea === "262953", `площадь стен ${measure.totals.wallArea} вместо 262953 — формула ушла с периметра потолка`);
check(measure.totals.volume === "217431", `объём ${measure.totals.volume} вместо 217431`);

const bedroom = measure.rooms.find((room) => room.name === "Спальня");
check(bedroom !== undefined, "в обмере нет спальни, заданной артбордом");
check(bedroom?.wallArea === "47520", `площадь стен спальни ${bedroom?.wallArea} вместо 47520`);
check(bedroom?.volume === "49680", `объём спальни ${bedroom?.volume} вместо 49680`);
check(bedroom?.openings.length === 2, `у спальни ${bedroom?.openings.length} видов проёмов вместо двух`);

/**
 * Второй набор обмера стоит РЯДОМ с начальным, а не поверх него.
 *
 * Проверяется именно это, а не наличие второго набора: по начальному
 * обмеру считалась смета, и перепись его поверх стёрла бы ответ на вопрос
 * «почему в смете 12,70, а в обмере 36,80». Числа берутся оба сразу — итог
 * начального набора обязан остаться прежним при существующем втором.
 */
check(measure.set === "INITIAL", `обмер без набора в запросе отдан как «${measure.set}»`);
check(
  Array.isArray(measure.filled) && measure.filled.includes("REPLANNED"),
  `наличие перепланировки не объявлено: filled = ${JSON.stringify(measure.filled)}`,
);

const replanned = await owner("/projects/R-99/measure?set=REPLANNED").then((r) => r.json());
check(replanned.set === "REPLANNED", `набор перепланировки отдан как «${replanned.set}»`);
check(replanned.rooms.length === 5, `помещений после перепланировки ${replanned.rooms.length} вместо пяти`);
check(
  replanned.totals.floorArea === "80810",
  `площадь после перепланировки ${replanned.totals.floorArea} вместо 80810 тысячных`,
);
/* Кухня-гостиная — сумма двух прежних помещений и снесённой перегородки.
   Число сходится арифметически, и это единственный способ убедиться, что
   второй набор — обмер, а не копия первого. */
const kitchenHall = replanned.rooms.find((room) => room.name === "Кухня-гостиная");
check(
  kitchenHall?.floorArea === "36800",
  `кухня-гостиная ${kitchenHall?.floorArea} вместо 36800 = 12700 + 23630 + 470`,
);
check(
  measure.rooms.some((room) => room.name === "Кухня") && measure.totals.floorArea === "80530",
  "начальный обмер изменился после заведения перепланировки",
);
/* Имя помещения уникально внутри набора, а не внутри объекта: «Спальня»
   есть в обоих наборах, и это одно помещение в двух состояниях. */
check(
  replanned.rooms.some((room) => room.name === "Спальня"),
  "«Спальня» не попала во второй набор: ключ имени остался по объекту",
);

/* --- помещение у позиции сметы (второй срез модуля 2) ------------------------
   Позиция сметы знает своё помещение. До этого помещение в продукте было, а
   работам недоступно: подстановка «из обмера» в правке позиции брала итог по
   всему объекту, и на позицию «плитка пола, санузел» уходила площадь пола
   всей квартиры.

   Стенд держит три состояния разом, и ни одно не подстроено под проверку:
   позиции на помещениях действующего набора, позиции на помещениях
   начального обмера, которым перепланировка одноимённых не оставила
   («Ванная» и «Санузел» слились в «Санузел совмещённый»), и позиции без
   помещения вовсе — так приходит всё, что импортировано из файла.
   -------------------------------------------------------------------------- */
const позицииСметы = (вид) => {
  const собрано = [];
  const обойти = (узлы) => {
    for (const узел of узлы) {
      собрано.push(...узел.items);
      обойти(узел.children);
    }
  };
  обойти(вид.sections ?? []);
  return собрано;
};
const поПомещениям = (вид) => {
  const счёт = new Map();
  for (const позиция of позицииСметы(вид)) {
    const ключ = позиция.room === null || позиция.room === undefined
      ? "нет"
      : `${позиция.room.name} (${позиция.room.set})`;
    счёт.set(ключ, (счёт.get(ключ) ?? 0) + 1);
  }
  return счёт;
};

const сметаСПомещениями = await owner("/projects/R-99/estimate").then((r) => r.json());
const разрезПомещений = поПомещениям(сметаСПомещениями);
const сПомещением = позицииСметы(сметаСПомещениями)
  .filter((позиция) => позиция.room !== null && позиция.room !== undefined).length;
check(
  сПомещением === 64,
  `позиций с помещением ${сПомещением} вместо 64: связь до вида не доходит`,
);
check(
  разрезПомещений.get("нет") === 68,
  `позиций без помещения ${разрезПомещений.get("нет")} вместо 68`,
);
check(
  разрезПомещений.get("Ванная (INITIAL)") === 18,
  `на «Ванной» начального обмера ${разрезПомещений.get("Ванная (INITIAL)")} позиций вместо 18`,
);
check(
  разрезПомещений.get("Кухня-гостиная (REPLANNED)") === 18,
  `на «Кухне-гостиной» ${разрезПомещений.get("Кухня-гостиная (REPLANNED)")} позиций вместо 18`,
);

/* Перепланировка объявлена самой сметой, а список выбора — помещения
   действующего набора. Без этой величины экран не отличил бы позицию,
   честно стоящую на единственном наборе, от позиции, отставшей от
   перепланировки: набор у обеих `INITIAL`. */
check(сметаСПомещениями.replanned === true, "смета не объявила перепланировку объекта");
check(
  Array.isArray(сметаСПомещениями.rooms) && сметаСПомещениями.rooms.length === 5,
  `в списке выбора ${сметаСПомещениями.rooms?.length} помещений вместо пяти`,
);
check(
  (сметаСПомещениями.rooms ?? []).every((комната) => комната.set === "REPLANNED"),
  "в список выбора попали помещения начального обмера",
);

/* Помещение — не внутренняя величина: прорабу оно нужнее прочих, он
   принимает помещение, а не позицию. Отбор по роли не должен унести его
   заодно с деньгами. */
const сметаПрорабу = await foreman("/projects/R-99/estimate").then((r) => r.json());
check(
  позицииСметы(сметаПрорабу).some((позиция) => позиция.room?.name === "Кухня-гостиная"),
  "прорабу смета пришла без помещений позиций",
);

/* Помещение чужого объекта — не «не найдено», а попытка приписать работы
   соседней квартире. */
const чужоеПомещение = replanned.rooms[0]?.id;
const позицияR27 = await owner("/projects/R-27/estimate")
  .then((r) => (r.ok ? r.json() : null))
  .then((вид) => (вид === null ? undefined : позицииСметы(вид)[0]));
if (позицияR27 !== undefined && чужоеПомещение !== undefined) {
  const чужое = await owner(`/projects/R-27/estimate/items/${позицияR27.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomId: чужоеПомещение }),
  });
  check(
    чужое.status === 400,
    `помещение чужого объекта принято с кодом ${чужое.status}`,
  );
}

/* --- автоперенос при перепланировке ------------------------------------------
   Отдельного действия «завести набор перепланировки» в продукте нет:
   помещения заводят по одному. Поэтому перевод срабатывает при появлении в
   наборе `REPLANNED` помещения, одноимённого начальному.

   Проверяется на настоящем случае стенда: «Ванная» начального обмера ушла в
   «Санузел совмещённый», и одноимённого ей в перепланировке нет. Заведение
   такой — студия решила снова разделить санузел — обязано перевести все
   восемнадцать позиций.
   -------------------------------------------------------------------------- */
const ваннаяСнова = await owner("/projects/R-99/measure/rooms?set=REPLANNED", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    name: "Ванная", floorArea: "4400",
    floorPerimeter: "7700", ceilingPerimeter: "8400", height: "2700",
  }),
});
check(ваннаяСнова.ok, `помещение перепланировки не заведено: код ${ваннаяСнова.status}`);

const послеПеревода = await owner("/projects/R-99/estimate").then((r) => r.json());
const разрезПосле = поПомещениям(послеПеревода);
check(
  разрезПосле.get("Ванная (REPLANNED)") === 18,
  `на новую «Ванную» переведено ${разрезПосле.get("Ванная (REPLANNED)") ?? 0} позиций вместо 18`,
);
check(
  разрезПосле.get("Ванная (INITIAL)") === undefined,
  `на «Ванной» начального обмера осталось ${разрезПосле.get("Ванная (INITIAL)")} позиций`,
);
/* Слитое помещение молча не переводится: «Санузел» одноимённого в новом
   наборе не получил, и его тринадцать позиций обязаны остаться на месте.
   Перевод по порядковому номеру вместо имени утащил бы и их. */
check(
  разрезПосле.get("Санузел (INITIAL)") === 13,
  `«Санузел» без одноимённого потерял позиции: ${разрезПосле.get("Санузел (INITIAL)") ?? 0} вместо 13`,
);
/* Итог работ переводом не меняется: переводится ссылка и только ссылка.
   Пересчёт количеств по новой площади опустил бы их ниже принятого. */
check(
  послеПеревода.totals.works === сметаСПомещениями.totals.works,
  `итог работ изменился при переводе: ${послеПеревода.totals.works}`
  + ` вместо ${сметаСПомещениями.totals.works}`,
);

/* Перевод виден в журнале объекта: менялось основание количества. */
const журналОбъекта = await owner("/projects/R-99/events").then((r) => (r.ok ? r.json() : []));
check(
  Array.isArray(журналОбъекта)
    && журналОбъекта.some((запись) => `${запись.title ?? ""} ${запись.detail ?? ""}`
      .includes("переведены на обмер")),
  "перевод прошёл мимо журнала объекта",
);

/* Удаление помещения со ссылками — именованный отказ с числом позиций, а не
   молчаливое обнуление. Связь объявлена `ON DELETE SET NULL`, иначе каскад
   удаления объекта упёрся бы в ссылку; отказ живёт в службе. */
const новаяВанная = послеПеревода.rooms.find((комната) => комната.name === "Ванная");
const удалениеСоСсылками = await owner(
  `/projects/R-99/measure/rooms/${новаяВанная?.id}`, { method: "DELETE" },
);
check(
  удалениеСоСсылками.status === 400,
  `помещение с 18 позициями удалено с кодом ${удалениеСоСсылками.status}`,
);
const текстОтказа = await удалениеСоСсылками.json().then((тело) => тело.message ?? "").catch(() => "");
check(
  текстОтказа.includes("18"),
  `отказ удаления не называет числа позиций: «${текстОтказа}»`,
);

/* Уборка: проверка возвращает стенд в прежнее состояние. Позиции — на
   начальную «Ванную», помещение — снято. Иначе обход страницы получил бы
   не тот стенд, на котором писались его собственные числа. */
const начальныйНабор = await owner("/projects/R-99/measure?set=INITIAL").then((r) => r.json());
const ваннаяНачальная = начальныйНабор.rooms.find((комната) => комната.name === "Ванная");
for (const позиция of позицииСметы(послеПеревода)) {
  if (позиция.room?.name !== "Ванная" || позиция.room.set !== "REPLANNED") continue;
  await owner(`/projects/R-99/estimate/items/${позиция.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomId: ваннаяНачальная?.id }),
  });
}
const уборкаПомещения = await owner(
  `/projects/R-99/measure/rooms/${новаяВанная?.id}`, { method: "DELETE" },
);
check(
  уборкаПомещения.ok,
  `помещение без ссылок не удалилось: код ${уборкаПомещения.status}`,
);
const сметаПослеУборки = await owner("/projects/R-99/estimate").then((r) => r.json());
const разрезУборки = поПомещениям(сметаПослеУборки);
check(
  разрезУборки.get("Ванная (INITIAL)") === 18 && разрезУборки.get("нет") === 68,
  "стенд не вернулся в прежнее состояние после проверки перевода:"
  + ` «Ванная» ${разрезУборки.get("Ванная (INITIAL)") ?? 0}, без помещения ${разрезУборки.get("нет") ?? 0}`,
);

/* --- перенос позиции сметы ---------------------------------------------------
   Одно действие с разными исходами: другой раздел, другое место в ряду.
   Стережётся не «запрос прошёл», а согласованность величин: перенос
   перекладывает деньги между подытогами и не меняет итога работ; порядок
   остаётся 1..n без дыр и повторов; номер строки документа сквозной.
   -------------------------------------------------------------------------- */
const разделыСметы = (вид) => {
  const собрано = [];
  const обойти = (узлы) => {
    for (const узел of узлы) { собрано.push(узел); обойти(узел.children); }
  };
  обойти(вид.sections ?? []);
  return собрано;
};

const доПереноса = await owner("/projects/R-99/estimate").then((r) => r.json());
{
  /* Номер строки документа сквозной: 1..N без пропусков и повторов. Возьми
     его из хранения — и после первой перестановки в смете окажется два
     номера 47 и ни одного 61. */
  const номера = позицииСметы(доПереноса).map((позиция) => позиция.order);
  const ожидалось = Array.from({ length: доПереноса.positions }, (_, i) => i + 1);
  check(
    JSON.stringify(номера) === JSON.stringify(ожидалось),
    `номера строк сметы не подряд: ${номера.slice(0, 8).join(", ")}…`
    + ` при ${доПереноса.positions} позициях`,
  );
}

const разделыДо = разделыСметы(доПереноса);
/* Раздел-источник: с двумя и более непринятыми позициями, чтобы было что
   переставлять внутри него. Раздел-приёмник — любой другой. */
const источник = разделыДо.find((узел) =>
  узел.items.filter((позиция) => BigInt(позиция.qtyAccepted) === 0n).length >= 2);
const приёмник = разделыДо.find((узел) => узел.id !== источник?.id && узел.items.length > 0);

if (источник === undefined || приёмник === undefined) {
  check(false, "на стенде не нашлось пары разделов для проверки переноса позиции");
} else {
  const берём = источник.items.find((позиция) => BigInt(позиция.qtyAccepted) === 0n);
  const подытогИсточникаДо = BigInt(источник.subtotal);
  const подытогПриёмникаДо = BigInt(приёмник.subtotal);
  const цена = BigInt(берём.total);

  /* 1. Перенос между разделами: деньги переложены, итог работ тот же. */
  const перенос = await owner(`/projects/R-99/estimate/items/${берём.id}/place`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sectionId: приёмник.id, after: null }),
  });
  check(перенос.ok, `перенос позиции не прошёл: код ${перенос.status}`);
  const послеПереноса = await перенос.json().catch(() => null);

  if (послеПереноса !== null && послеПереноса.totals !== undefined) {
    check(
      послеПереноса.totals.works === доПереноса.totals.works,
      `итог работ изменился при переносе: ${послеПереноса.totals.works}`
      + ` вместо ${доПереноса.totals.works}`,
    );
    check(
      послеПереноса.version === доПереноса.version,
      `перенос поднял редакцию сметы до ${послеПереноса.version}`,
    );
    const разделыПосле = разделыСметы(послеПереноса);
    const источникПосле = разделыПосле.find((узел) => узел.id === источник.id);
    const приёмникПосле = разделыПосле.find((узел) => узел.id === приёмник.id);
    /* Подытог вложенного раздела входит в подытог родителя, поэтому у
       вложенных пар сверка идёт по числу позиций, а не по деньгам. */
    if (источник.level === 1 && приёмник.level === 1) {
      check(
        BigInt(источникПосле?.subtotal ?? "0") === подытогИсточникаДо - цена,
        `подытог источника ${источникПосле?.subtotal} вместо`
        + ` ${(подытогИсточникаДо - цена).toString()}`,
      );
      check(
        BigInt(приёмникПосле?.subtotal ?? "0") === подытогПриёмникаДо + цена,
        `подытог приёмника ${приёмникПосле?.subtotal} вместо`
        + ` ${(подытогПриёмникаДо + цена).toString()}`,
      );
    }
    check(
      приёмникПосле?.items[0]?.id === берём.id,
      "перенесённая позиция не встала первой, хотя просили встать первой",
    );
    /* Порядок обоих разделов плотный: после ухода позиции в источнике
       осталась бы дыра, и следующая вставка встала бы не туда. */
    const номера = позицииСметы(послеПереноса).map((позиция) => позиция.order);
    const подряд = Array.from({ length: послеПереноса.positions }, (_, i) => i + 1);
    check(
      JSON.stringify(номера) === JSON.stringify(подряд),
      `после переноса номера строк не подряд: ${номера.slice(0, 8).join(", ")}…`,
    );
  }

  /* 2. Принятая позиция раздела не меняет: отказ называет принятое. */
  const принятая = позицииСметы(доПереноса).find((позиция) => BigInt(позиция.qtyAccepted) > 0n);
  if (принятая === undefined) {
    check(false, "на стенде нет принятых позиций: запрет переноса не на чем проверить");
  } else {
    const чужойРаздел = разделыДо.find((узел) =>
      !узел.items.some((позиция) => позиция.id === принятая.id) && узел.items.length > 0);
    const отказ = await owner(`/projects/R-99/estimate/items/${принятая.id}/place`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sectionId: чужойРаздел?.id, after: null }),
    });
    check(отказ.status === 400, `перенос принятой позиции прошёл с кодом ${отказ.status}`);
    const текст = await отказ.json().then((тело) => тело.message ?? "").catch(() => "");
    check(
      текст.includes("принято"),
      `отказ переноса принятой не называет принятого: «${текст}»`,
    );
  }

  /* 3. Раздел чужой сметы — не «не найден», а чужой объект. */
  const чужаяСмета = await owner("/projects/R-27/estimate")
    .then((r) => (r.ok ? r.json() : null));
  const чужойРазделId = чужаяСмета === null ? undefined : разделыСметы(чужаяСмета)[0]?.id;
  if (чужойРазделId !== undefined) {
    const чужое = await owner(`/projects/R-99/estimate/items/${берём.id}/place`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sectionId: чужойРазделId, after: null }),
    });
    check(чужое.status === 400, `раздел чужой сметы принят с кодом ${чужое.status}`);
  }

  /* 4. Переносит только руководитель. */
  const прорабПереносит = await foreman(`/projects/R-99/estimate/items/${берём.id}/place`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sectionId: источник.id, after: null }),
  });
  check(
    прорабПереносит.status === 403,
    `прораб перенёс позицию с кодом ${прорабПереносит.status}`,
  );

  /* Уборка: позиция возвращается в свой раздел, на своё место. */
  const сосед = источник.items.find((позиция) => позиция.id !== берём.id);
  const возврат = await owner(`/projects/R-99/estimate/items/${берём.id}/place`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sectionId: источник.id, after: null }),
  });
  check(возврат.ok, `позиция не вернулась в свой раздел: код ${возврат.status}`);
  void сосед;
  const после = await owner("/projects/R-99/estimate").then((r) => r.json());
  check(
    после.totals.works === доПереноса.totals.works,
    `после уборки итог работ ${после.totals.works} вместо ${доПереноса.totals.works}`,
  );
}

/* --- типовые сметы организации -----------------------------------------------
   Заготовка несёт ставку оплаты труда, то есть фонд оплаты всей типовой
   сметы одним документом. Поэтому проверяется не только «список пришёл», но
   и то, что он не приходит никому, кроме руководителя, и не пересекает
   организаций.
   -------------------------------------------------------------------------- */
const заготовки = await owner("/blueprints").then((r) => r.json());
check(
  Array.isArray(заготовки) && заготовки.length === 1,
  `типовых смет на стенде ${заготовки.length} вместо одной`,
);
const типовая = заготовки[0];
check(
  типовая?.positions === доПереноса.positions,
  `в типовой смете ${типовая?.positions} позиций против ${доПереноса.positions} в исходной`,
);
check(
  типовая?.works === доПереноса.totals.works,
  `итог типовой сметы ${типовая?.works} против ${доПереноса.totals.works} у исходной`,
);
check(типовая?.sourceCode === "R-99", `происхождение заготовки «${типовая?.sourceCode}» вместо R-99`);

/* Дерево заготовки повторяет дерево сметы: разделов столько же, и они
   вложены так же. Плоская копия потеряла бы структуру молча. */
const деревоЗаготовки = await owner(`/blueprints/${типовая?.id}`).then((r) => r.json());
check(
  деревоЗаготовки.sections?.length === доПереноса.sectionsTopLevel,
  `в заготовке ${деревоЗаготовки.sections?.length} разделов верхнего уровня`
  + ` против ${доПереноса.sectionsTopLevel}`,
);
const вложенныхВЗаготовке = (узлы) =>
  узлы.reduce((всего, узел) => всего + узел.children.length + вложенныхВЗаготовке(узел.children), 0);
check(
  вложенныхВЗаготовке(деревоЗаготовки.sections ?? []) === доПереноса.sectionsNested,
  `в заготовке ${вложенныхВЗаготовке(деревоЗаготовки.sections ?? [])} вложенных разделов`
  + ` против ${доПереноса.sectionsNested}`,
);

/* Заготовка закрыта руководителем целиком: прорабу и заказчику она не
   нужна вовсе, а несёт фонд оплаты. */
const прорабЗаготовки = await foreman("/blueprints");
check(
  прорабЗаготовки.status === 403,
  `прорабу открыты типовые сметы: код ${прорабЗаготовки.status}`,
);
const заказчикЗаготовки = await client("/blueprints");
check(
  заказчикЗаготовки.status === 403,
  `заказчику открыты типовые сметы: код ${заказчикЗаготовки.status}`,
);

/* Имя уникально в организации: две одинаковые строки в списке неразличимы. */
const повторноеИмя = await owner("/blueprints", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ fromProject: "R-99", name: типовая?.name }),
});
check(
  повторноеИмя.status === 400,
  `вторая типовая смета с тем же именем заведена с кодом ${повторноеИмя.status}`,
);

/* Применение к объекту, у которого смета уже есть, запрещено: смета объекта
   одна, и слияние двух породило бы вопрос «откуда взялась эта позиция», на
   который в данных ответа нет. */
const поверхСметы = await owner("/projects/R-99/estimate/from-blueprint", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ blueprintId: типовая?.id }),
});
check(
  поверхСметы.status === 400,
  `типовая смета применена поверх существующей с кодом ${поверхСметы.status}`,
);

/* Применение к объекту без сметы даёт редакцию 1 с тем же итогом. */
const пустойОбъект = "R-42";
const применение = await owner(`/projects/${пустойОбъект}/estimate/from-blueprint`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ blueprintId: типовая?.id }),
});
check(применение.ok, `типовая смета не применилась к ${пустойОбъект}: код ${применение.status}`);
if (применение.ok) {
  const сметаИзЗаготовки = await применение.json();
  check(
    сметаИзЗаготовки.version === 1,
    `смета из заготовки заведена редакцией ${сметаИзЗаготовки.version} вместо первой`,
  );
  check(
    сметаИзЗаготовки.totals.works === типовая?.works,
    `итог сметы из заготовки ${сметаИзЗаготовки.totals.works} против ${типовая?.works} у заготовки`,
  );
  check(
    сметаИзЗаготовки.positions === типовая?.positions,
    `позиций в смете из заготовки ${сметаИзЗаготовки.positions} против ${типовая?.positions}`,
  );
  /* Заявленного итога у заготовки нет, и выдумывать его нельзя: на нём стоит
     отчёт о расхождениях. */
  check(
    сметаИзЗаготовки.declaredWorksTotal === null,
    `смета из заготовки объявила заявленный итог ${сметаИзЗаготовки.declaredWorksTotal}`,
  );
  /* Помещения не уносятся: помещение принадлежит объекту, а не типу ремонта. */
  const сПомещением = позицииСметы(сметаИзЗаготовки)
    .filter((позиция) => позиция.room !== null).length;
  check(
    сПомещением === 0,
    `в смету из заготовки пришли помещения чужого объекта: ${сПомещением} позиций`,
  );
  /* Происхождение — в журнале объекта: поле на смете пришлось бы обнулять
     при удалении заготовки, а журнал не переписывается. */
  const журнал42 = await owner(`/projects/${пустойОбъект}/events?limit=200`)
    .then((r) => (r.ok ? r.json() : []));
  check(
    журнал42.some((запись) => `${запись.title ?? ""} ${запись.detail ?? ""}`.includes("типовой")),
    "заведение сметы из заготовки прошло мимо журнала объекта",
  );
}

/* --- чеки на материалы ------------------------------------------------------
   Ключевое в этом контуре — не «чек завёлся», а «черновик деньгами не
   считается». Черновик, попавший в потраченное, выглядит на экране в
   точности как подтверждённый расход, и заметить подмену нечем: обе
   величины — просто число рядом со словом «Потрачено».
   -------------------------------------------------------------------------- */
const чеки = await owner(`/projects/R-99/expenses`).then((r) => r.json());
check(чеки.rows.length === 3, `чеков на стенде ${чеки.rows.length} вместо трёх`);
check(чеки.totals.drafts === 1, `черновиков ${чеки.totals.drafts} вместо одного`);
/* 48 700 + 3 500 подтверждённых; черновик на 1 280 в итог не входит. */
check(чеки.totals.spent === "5220000", `потрачено ${чеки.totals.spent} вместо 5220000 копеек`);
check(чеки.totals.reimbursable === "5220000",
  `к возмещению ${чеки.totals.reimbursable} вместо 5220000 копеек`);
check(чеки.totals.own === "0", `своих расходов ${чеки.totals.own} вместо нуля`);

/* Черновик заводит прораб, и он остаётся черновиком: подтверждение
   существует затем, чтобы руководитель видел чужую покупку. */
const наполнение = чеки.rows.find((строка) => строка.status === "DRAFT");
check(наполнение?.seller === "Всеинструменты", `черновик от «${наполнение?.seller}» вместо инструмента`);
check(наполнение?.reimbursable === false, "черновик инструмента помечен возмещаемым");

/* Дальше проверка заводит СВОЙ черновик и разбирает его.
   Разбирать черновик наполнения нельзя: обход страницы идёт по тому же
   стенду после этой проверки (`02_DEV_PROMPT.md`, порядок обязателен), и
   съеденный здесь черновик оставил бы обходу пустую вкладку. Проверка,
   уносящая опору другой проверки, стережёт только себя.

   Заодно это испытывает заведение прорабом: чек прораба обязан остаться
   черновиком, а не подтвердиться сам. */
const свой = new FormData();
свой.append("expense", JSON.stringify({
  kind: "OTHER", amount: "200000", reimbursable: false,
  seller: "Проверка API", spentAt: "2026-09-05", sectionId: null, note: null,
}));
свой.append("file", new Blob([readFileSync(new URL("./fixtures/snimok.png", import.meta.url))]), "chek.png");
const свойЗаведён = await foreman("/projects/R-99/expenses", { method: "POST", body: свой })
  .then((r) => r.json());
check(свойЗаведён.totals.drafts === 2,
  `после заведения прорабом черновиков ${свойЗаведён.totals.drafts} вместо двух`);
check(свойЗаведён.totals.spent === "5220000",
  `черновик прораба попал в потраченное: ${свойЗаведён.totals.spent} вместо 5220000`);
const черновик = свойЗаведён.rows.find((строка) => строка.seller === "Проверка API");
check(черновик?.status === "DRAFT", `чек прораба заведён как «${черновик?.status}» вместо черновика`);

/* Прораб не подтверждает свой же черновик: право признать расход деньгами
   студии шире права его заявить. */
const чужоеПодтверждение = await foreman(
  `/projects/R-99/expenses/${черновик?.id}/confirm`, { method: "POST" });
check(чужоеПодтверждение.status === 403,
  `прораб подтвердил чек с кодом ${чужоеПодтверждение.status}`);

/* Подтверждение руководителем меняет итог ровно на сумму чека и переносит
   её в «своё»: чек инструмента возмещению не подлежит. */
const послеПодтверждения = await owner(
  `/projects/R-99/expenses/${черновик?.id}/confirm`, { method: "POST" }).then((r) => r.json());
check(послеПодтверждения.totals.spent === "5420000",
  `после подтверждения потрачено ${послеПодтверждения.totals.spent} вместо 5420000`);
check(послеПодтверждения.totals.own === "200000",
  `своих расходов ${послеПодтверждения.totals.own} вместо 200000`);
check(послеПодтверждения.totals.drafts === 1,
  `черновиков после подтверждения ${послеПодтверждения.totals.drafts} вместо одного: разобран чужой`);

/* Отклонение убирает расход из денег, не убирая его из истории. */
const послеОтклонения = await owner(
  `/projects/R-99/expenses/${черновик?.id}/reject`, { method: "POST" }).then((r) => r.json());
check(послеОтклонения.totals.spent === "5220000",
  `после отклонения потрачено ${послеОтклонения.totals.spent} вместо 5220000`);
check(послеОтклонения.rows.length === 4,
  `после отклонения строк ${послеОтклонения.rows.length}: отклонённый исчез вместо того, чтобы остаться историей`);

/* Чек без снимка не принимается: расход без свидетельства нечем предъявить
   заказчику, а предъявление и есть назначение вкладки. */
const чекБезСнимка = new FormData();
чекБезСнимка.append("expense", JSON.stringify({
  kind: "OTHER", amount: "100000", reimbursable: true,
  seller: "Без снимка", spentAt: "2026-09-01", sectionId: null, note: null,
}));
const отказБезСнимка = await owner("/projects/R-99/expenses", {
  method: "POST", body: чекБезСнимка,
});
check(отказБезСнимка.status === 400, `чек без снимка принят с кодом ${отказБезСнимка.status}`);

/* Величина «потрачено» доходит до карточки объекта: вкладка и карточка
   обязаны показывать одно число, иначе одно из двух мест лжёт. */
const карточкаСРасходом = await owner(`/projects/R-99`).then((r) => r.json());
check(карточкаСРасходом.spentMaterials === "5220000",
  `в карточке потрачено ${карточкаСРасходом.spentMaterials} вместо 5220000`);

/* Бухгалтерия: расходы стоят рядом с клиентскими деньгами и слагаемым им не
   являются. Проверяется и то, и другое. */
const деньги = await owner("/accounting").then((r) => r.json());
check(деньги.materials.spent === "5220000",
  `в бухгалтерии потрачено ${деньги.materials.spent} вместо 5220000`);
check(деньги.expenses.some((строка) => строка.projectCode === "R-99"),
  `объекта R-99 нет в разрезе расходов бухгалтерии`);
/* Расход не слагаемое клиентских денег. Проверяется не словами, а
   подтверждением ещё одного чека: четыре клиентские величины обязаны
   остаться теми же, а «потрачено» — вырасти. Сравнение «до и после» ловит
   то, чего не поймает сверка чисел на месте: сложение, случившееся внутри
   формулы, а не в ответе. */
const сноваЧерновик = await owner("/projects/R-99/expenses").then((r) => r.json())
  .then((вид) => вид.rows.find((строка) => строка.status === "REJECTED"));
const доПодтверждения = {
  inWork: деньги.totals.inWork, awaiting: деньги.totals.awaiting,
  paid: деньги.totals.paid, overdue: деньги.totals.overdue,
};
await owner(`/projects/R-99/expenses/${сноваЧерновик?.id}/confirm`, { method: "POST" });
const послеРасхода = await owner("/accounting").then((r) => r.json());
for (const [имя, было] of Object.entries(доПодтверждения)) {
  check(послеРасхода.totals[имя] === было,
    `подтверждение чека изменило клиентскую величину «${имя}»: ${было} → ${послеРасхода.totals[имя]}`);
}
check(BigInt(послеРасхода.materials.spent) > BigInt(деньги.materials.spent),
  "подтверждение чека не изменило потраченное в бухгалтерии");

console.log(`Чеки R-99: ${чеки.rows.length} всего, черновиков ${чеки.totals.drafts};`,
  `потрачено ${чеки.totals.spent} копеек, к возмещению ${чеки.totals.reimbursable}`);

/* --- акты выполненных работ -------------------------------------------------
   Главное здесь — не «акт собрался», а «клиентский вид НЕ содержит
   внутренних величин». Ставка и прибыль в акте, ушедшем заказчику, — это
   не дефект вёрстки, а показанная себестоимость: её нельзя ни отозвать, ни
   объяснить. Проверяется составом ответа, а не видом на экране.
   -------------------------------------------------------------------------- */
const акты = await owner("/projects/R-99/acts").then((r) => r.json());
/* Перечень проверяется отдельно от одного акта, и дальше правило идёт
   только при исправном перечне. Иначе испорченный перечень даёт падение по
   месту первого обращения — а падение прячет ровно тот дефект, который
   правило и стережёт: замечание накоплено, но отчёт до глаз не доходит. */
if (!Array.isArray(акты) || акты.length !== 1) {
  check(false, `перечень актов R-99 отдал не один акт: ${JSON.stringify(акты).slice(0, 160)}`);
} else {
  const [акт] = акты;
  check(акт.number === 1, `номер акта ${акт.number} вместо первого`);
  check(акт.signedAt === null, "акт наполнения отмечен подписанным");

  const актКлиенту = await owner(`/projects/R-99/acts/${акт.trancheId}`).then((r) => r.json());
  check(актКлиенту.audience === "client", `вид по умолчанию «${актКлиенту.audience}» вместо клиентского`);
  const утечкаАкта = findInternal(актКлиенту);
  check(утечкаАкта.length === 0, `в клиентском акте внутренние поля: ${утечкаАкта.join(", ")}`);
  check(Array.isArray(актКлиенту.lines) && актКлиенту.lines.length > 0,
    `в акте нет ни одной строки: ${JSON.stringify(актКлиенту).slice(0, 160)}`);

  if (Array.isArray(актКлиенту.lines) && актКлиенту.lines.length > 0) {
    /* Итог акта = работы + надбавка, той же арифметикой, что и транш (БП-05). */
    const работыАкта = BigInt(актКлиенту.totals.works);
    const надбавкаАкта = BigInt(актКлиенту.totals.supervision);
    check(BigInt(актКлиенту.totals.total) === работыАкта + надбавкаАкта,
      `итог акта ${актКлиенту.totals.total} не равен работам с надбавкой`);
    /* Работы акта = сумма строк: итог, посчитанный мимо строк, расходится с
       тем, что заказчик видит в таблице, и спорить он будет по таблице. */
    const посСтрокам = актКлиенту.lines
      .reduce((свод, строка) => свод + BigInt(строка.total), 0n);
    check(работыАкта === посСтрокам,
      `работы акта ${работыАкта.toString()} не сходятся с суммой строк ${посСтрокам.toString()}`);
    check(актКлиенту.contractor.name.length > 0, "в акте не названа сторона исполнителя");
    /* Сумма строки перечня — та же, что в подвале акта. Иначе документ
       назван двумя числами, и меньшее из них видно первым. */
    check(акт.total === актКлиенту.totals.total,
      `в перечне акт стоит ${акт.total} копеек, а в подвале ${актКлиенту.totals.total}`);

    const актВнутрь = await owner(`/projects/R-99/acts/${акт.trancheId}?view=internal`)
      .then((r) => r.json());
    check(актВнутрь.audience === "internal", `внутренний вид отдан как «${актВнутрь.audience}»`);
    check(актВнутрь.lines.every((строка) => строка.wageTotal !== undefined),
      "во внутреннем виде акта нет начисленного по строкам");
    check(актВнутрь.totals.profit !== undefined, "во внутреннем виде акта нет прибыли");

    console.log(`Акты R-99: ${акты.length}, строк в акте ${актКлиенту.lines.length},`,
      `итог ${актКлиенту.totals.total} копеек; внутренних полей клиенту: ${утечкаАкта.length}`);
  }

  /* Прорабу внутренний вид не отдаётся вовсе: право видеть себестоимость
     шире права видеть работу. */
  const чужойВид = await foreman(`/projects/R-99/acts/${акт.trancheId}?view=internal`);
  check(чужойВид.status === 403, `прораб получил внутренний акт с кодом ${чужойВид.status}`);
  /* Клиентский вид прораб видит: он же делал работу. */
  const прорабуАкт = await foreman(`/projects/R-99/acts/${акт.trancheId}`);
  check(прорабуАкт.status === 200, `прорабу отказан клиентский акт с кодом ${прорабуАкт.status}`);

  /* Открытый транш акта не имеет: акт и есть то, чем транш закрывают. */
  const траншиДляАкта = await owner("/projects/R-99/tranches").then((r) => r.json());
  const открытыйДляАкта = траншиДляАкта.current;
  if (открытыйДляАкта !== null) {
    const актОткрытого = await owner(`/projects/R-99/acts/${открытыйДляАкта.id}`);
    check(актОткрытого.status === 400,
      `акт открытого транша отдан с кодом ${актОткрытого.status}`);
  }

  /* Отметка подписания: ставит руководитель, датой не из будущего.
     Подписание идёт последним: оно меняет состояние стенда, и проверки выше
     читают акт ещё неподписанным — тем, каким его заводит наполнение. */
  const прорабПодписал = await foreman(`/projects/R-99/acts/${акт.trancheId}/signature`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ signedAt: "2026-09-12" }),
  });
  check(прорабПодписал.status === 403, `прораб отметил подписание с кодом ${прорабПодписал.status}`);

  const будущее = await owner(`/projects/R-99/acts/${акт.trancheId}/signature`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ signedAt: "2030-01-01" }),
  });
  check(будущее.status === 400, `подписание будущей датой принято с кодом ${будущее.status}`);

  const подписан = await owner(`/projects/R-99/acts/${акт.trancheId}/signature`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ signedAt: "2026-09-12" }),
  }).then((r) => r.json());
  check(подписан[0]?.signedAt === "2026-09-12",
    `после отметки дата подписания «${подписан[0]?.signedAt}» вместо 2026-09-12`);
}

/* --- шаблоны документов организации ------------------------------------------
   Главное здесь — что метка заменяется значением объекта, а неизвестная
   метка остаётся видимой. Документ, из которого молча пропал реквизит,
   подписывают не глядя: пустое место читается как «здесь ничего и не было».
   -------------------------------------------------------------------------- */
const шаблоны = await owner("/templates").then((r) => r.json());
check(Array.isArray(шаблоны) && шаблоны.length === 2,
  `шаблонов на стенде ${JSON.stringify(шаблоны).slice(0, 120)} вместо двух`);
const договор = Array.isArray(шаблоны)
  ? шаблоны.find((шаблон) => шаблон.kind === "CONTRACT")
  : undefined;
if (договор === undefined) {
  check(false, "среди шаблонов стенда нет договора");
} else {
  check(договор.clauses > 0, `у договора пунктов ${договор.clauses}`);

  /* Шаблон отдаётся метками: подстановка — отдельное действие. */
  const видШаблона = await owner(`/templates/${договор.id}`).then((r) => r.json());
  const естьМетки = видШаблона.clauses.some((пункт) => /\{\{[^}]+\}\}/u.test(пункт.body));
  check(естьМетки, "в шаблоне не осталось ни одной метки: шаблон отдан уже подставленным");

  const документ = await owner(`/templates/${договор.id}/issue`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectCode: "R-99" }),
  }).then((r) => r.json());
  const текст = документ.clauses.map((пункт) => `${пункт.title}\n${пункт.body}`).join("\n");
  check(!/\{\{[^}]+\}\}/u.test(текст), "в выпущенном документе осталась неподставленная метка");
  check(текст.includes("R-99"), "код объекта в документ не подставлен");
  check(документ.client.name.length > 0, "в документе не названа сторона заказчика");
  /* Внутренних величин в документе нет по составу — он уходит заказчику. */
  const утечкаДокумента = findInternal(документ);
  check(утечкаДокумента.length === 0,
    `в документе организации внутренние поля: ${утечкаДокумента.join(", ")}`);

  /* Чужой объект документом не выпускается: та же видимость, что у сметы. */
  const чужойДокумент = await owner(`/templates/${договор.id}/issue`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectCode: "НЕТ-ТАКОГО" }),
  });
  check(чужойДокумент.status === 404,
    `документ по несуществующему объекту отдан с кодом ${чужойДокумент.status}`);

  /* Правит шаблоны руководитель; читают и выпускают обе роли. */
  const прорабПравит = await foreman(`/templates/${договор.id}`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Свой договор", kind: "CONTRACT", clauses: [{ title: "П", body: "" }] }),
  });
  check(прорабПравит.status === 403, `прораб правит шаблон с кодом ${прорабПравит.status}`);
  const прорабЧитает = await foreman("/templates");
  check(прорабЧитает.status === 200, `прорабу отказан перечень шаблонов: ${прорабЧитает.status}`);

  /* Неизвестная переменная отвергается при записи: иначе метка доходит до
     подписи, и замечает её уже заказчик. */
  const сЧужойМеткой = await owner("/templates", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Проверка API", kind: "OTHER",
      clauses: [{ title: "Пункт", body: "Цвет {{объект.цвет}}" }],
    }),
  });
  check(сЧужойМеткой.status === 400,
    `шаблон с неизвестной переменной принят с кодом ${сЧужойМеткой.status}`);

  /* Метка в наименовании подставляется наравне с пунктами: наименование
     печатается в шапке документа, и метка там заметнее любой другой.
     Найдено разбором граничных данных: сервер принимал такое имя и печатал
     его сырым. */
  const сМеткойВИмени = await owner("/templates", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Проверка API: договор по {{объект.код}}", kind: "OTHER",
      clauses: [{ title: "Пункт", body: "Объект {{объект.код}}" }],
    }),
  });
  check(сМеткойВИмени.status === 201,
    `шаблон с меткой в наименовании отвергнут с кодом ${сМеткойВИмени.status}`);
  if (сМеткойВИмени.status === 201) {
    const перечень = await owner("/templates").then((r) => r.json());
    const сИменем = перечень.find((шаблон) => шаблон.name.includes("Проверка API"));
    const бумага = await owner(`/templates/${сИменем?.id}/issue`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectCode: "R-99" }),
    }).then((r) => r.json());
    check(!бумага.name.includes("{{"),
      `в наименовании выпущенного документа осталась метка: «${бумага.name}»`);
    check(бумага.name.includes("R-99"), `в наименовании не подставлен код: «${бумага.name}»`);
  }

  /* Неизвестная метка в наименовании отвергается так же, как в пункте. */
  const чужаяВИмени = await owner("/templates", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Договор {{объект.цвет}}", kind: "OTHER",
      clauses: [{ title: "Пункт", body: "текст" }],
    }),
  });
  check(чужаяВИмени.status === 400,
    `неизвестная метка в наименовании принята с кодом ${чужаяВИмени.status}`);

  /* Одноимённый шаблон не заводится: два одинаковых имени неразличимы. */
  const тёзка = await owner("/templates", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: договор.name, kind: "CONTRACT",
      clauses: [{ title: "Пункт", body: "Объект {{объект.код}}" }],
    }),
  });
  check(тёзка.status === 400, `одноимённый шаблон заведён с кодом ${тёзка.status}`);

  console.log(`Шаблоны организации: ${String(шаблоны.length)}, в договоре пунктов`,
    `${String(договор.clauses)}; меток в выпущенном документе не осталось`);
}

/** Обмер чужого объекта прорабу не виден: тот же 404, что у сметы. */
const foreignMeasure = await foreman("/projects/R-19/measure");
check(foreignMeasure.status === 404, `обмер чужого объекта отдан прорабу с кодом ${foreignMeasure.status}`);

/** Прораб вносит замер — это его работа на объекте. */
const created = await foreman("/projects/R-99/measure/rooms", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    name: "Проверочное помещение", floorArea: "1000",
    floorPerimeter: "4000", ceilingPerimeter: "4000", height: "2700",
  }),
});
check(created.status === 201, `внесение помещения прорабом отклонено с кодом ${created.status}`);
const afterCreate = await created.json();
check(afterCreate.totals?.floorArea === "81530", `итог после внесения ${afterCreate.totals?.floorArea} вместо 81530`);

/** Высота в сантиметрах вместо метров — самый частый промах в единицах. */
const wrongHeight = await foreman("/projects/R-99/measure/rooms", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    name: "Промах в единицах", floorArea: "1000",
    floorPerimeter: "4000", ceilingPerimeter: "4000", height: "270000",
  }),
});
check(wrongHeight.status === 400, `высота 270 метров принята с кодом ${wrongHeight.status}`);

/** Два одинаковых названия в обмере — ошибка замера, а не данные. */
const duplicate = await foreman("/projects/R-99/measure/rooms", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    name: "Спальня", floorArea: "1000",
    floorPerimeter: "4000", ceilingPerimeter: "4000", height: "2700",
  }),
});
check(duplicate.status === 400, `повтор названия помещения принят с кодом ${duplicate.status}`);

/** Файл, назвавшийся изображением, но им не являющийся, отвергается по содержимому. */
const disguised = new FormData();
disguised.append(
  "file",
  new Blob([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>0</script></svg>')], { type: "image/png" }),
  "план.png",
);
const badPlan = await foreman("/projects/R-99/measure/plan", { method: "PUT", body: disguised });
check(badPlan.status === 400, `SVG под видом PNG принят с кодом ${badPlan.status}`);

/** Уборка: проверка не должна оставлять следов в обмере. */
const probeId = afterCreate.rooms?.find((room) => room.name === "Проверочное помещение")?.id;
if (probeId !== undefined) {
  const cleaned = await owner(`/projects/R-99/measure/rooms/${probeId}`, { method: "DELETE" }).then((r) => r.json());
  check(cleaned.totals?.floorArea === "80530", `после уборки итог ${cleaned.totals?.floorArea} вместо 80530`);
}

/**
 * График производства работ: готовность считается из этапов и совпадает с
 * доменным правилом. 8557 — то же число, что в schedule.test.ts; если
 * сервер посчитает иначе, полоса плана и таблица разойдутся.
 */
const списокОбъектов = await owner("/projects").then((r) => r.json());
const R99строка = списокОбъектов.find((project) => project.code === "R-99");
check(R99строка?.stages?.length === 7, `у R-99 этапов ${R99строка?.stages?.length} вместо 7`);
check(R99строка?.readiness === 8557, `готовность R-99 ${R99строка?.readiness} вместо 8557`);
const безГрафика = списокОбъектов.find((project) => project.code === "R-42");
check(безГрафика?.readiness === null, `объект без этапов даёт готовность ${безГрафика?.readiness}, а не «не задано»`);
check(безГрафика?.stages?.length === 0, "у объекта без графика оказались этапы");

/**
 * Счётчики срочности вложены: сегодня ⊆ неделя ⊆ две недели. Разъехавшись,
 * они дали бы на главной три числа, противоречащих друг другу.
 */
const срочность = ownerSummary.projects;
check(
  срочность.dueToday <= срочность.dueWeek && срочность.dueWeek <= срочность.dueSoon,
  `счётчики срочности не вложены: сегодня ${срочность.dueToday}, неделя ${срочность.dueWeek}, две ${срочность.dueSoon}`,
);

/**
 * Заведение записей: проверяются отказы.
 *
 * Удачное заведение здесь не проверяется намеренно. Маршрута удаления
 * объекта, заказчика и работника в продукте нет, поэтому успешная проба
 * оставила бы в портфеле лишнюю строку и сломала бы счёт объектов у
 * следующей проверки. Обещание «сохранённая запись видна в списке сразу»
 * проверяется живым прогоном браузера на свежем стенде — там оно и
 * наблюдается, а не выводится из кода ответа.
 */
const создать = (who, path, body) =>
  who(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const заказчикR99 = ownerClients[0];

const повторКодаОбъекта = await создать(owner, "/projects", {
  code: "R-99", address: "Проверочная 1", clientId: заказчикR99?.id, deadline: null,
});
check(повторКодаОбъекта.status === 400, `повтор кода объекта прошёл с кодом ${повторКодаОбъекта.status}`);

const повторКодаЗаказчика = await создать(owner, "/clients", {
  code: заказчикR99?.code, name: "Двойник", isCompany: false, requisites: null,
});
check(повторКодаЗаказчика.status === 400, `повтор кода заказчика прошёл с кодом ${повторКодаЗаказчика.status}`);

const чужойЗаказчик = await создать(owner, "/projects", {
  code: "R-00", address: "Проверочная 1", clientId: "00000000-0000-4000-8000-00000000dead", deadline: null,
});
check(чужойЗаказчик.status === 400, `объект на несуществующего заказчика прошёл с кодом ${чужойЗаказчик.status}`);

const прорабЗаводитОбъект = await создать(foreman, "/projects", {
  code: "R-00", address: "Нельзя", clientId: заказчикR99?.id, deadline: null,
});
check(прорабЗаводитОбъект.status === 403, `прораб завёл объект с кодом ${прорабЗаводитОбъект.status}`);

const прорабЗаводитЗаказчика = await создать(foreman, "/clients", {
  code: "000", name: "Нельзя", isCompany: false, requisites: null,
});
check(прорабЗаводитЗаказчика.status === 403, `прораб завёл заказчика с кодом ${прорабЗаводитЗаказчика.status}`);

const мусорВТеле = await создать(owner, "/projects", {
  code: "плохой код", address: "x", clientId: "не uuid", deadline: null,
});
check(мусорВТеле.status === 400, `тело мимо схемы принято с кодом ${мусорВТеле.status}`);

/**
 * Правка графика. Маршрутов пишущих пять; проверяется и то, что они
 * работают, и то, что валидатор дат стоит на сервере, а не только на
 * экране: подсказку в разметке обойти нечего не стоит, отказ сервера — нет.
 *
 * Стенд возвращается в исходное состояние: заведённый этап удаляется, и
 * следующий прогон видит те же семь этапов R-99.
 */
const этап = (who, path, method, body) =>
  who(path, {
    method,
    /* Заголовок ставится только вместе с телом. Fastify разбирает тело
       прежде охраны и на пустом «application/json» отвечает 400 — отказ
       пришёл бы раньше проверки прав, и проверка стерегла бы не то.
       Клиент шлёт снятие так же (apps/web/src/api.ts:152). */
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });

const проба = `Проверочный этап ${String(Date.now())}`;

const заведён = await этап(owner, "/projects/R-99/stages", "POST", {
  name: проба, startsOn: "2026-04-01", endsOn: "2026-04-20", progress: 2500,
});
check(заведён.ok, `этап не заведён: код ${заведён.status}`);
const послеЗаведения = заведён.ok ? await заведён.json() : [];
check(послеЗаведения.length === 8, `после заведения этапов ${послеЗаведения.length} вместо восьми`);
const новый = послеЗаведения.find((row) => row.name === проба);
check(новый !== undefined, "заведённый этап не вернулся в списке");
check(новый?.order === 7, `новый этап встал на место ${новый?.order} вместо последнего`);

const перевёрнутые = await этап(owner, "/projects/R-99/stages", "POST", {
  name: "Перевёрнутый", startsOn: "2026-03-31", endsOn: "2026-03-07", progress: 0,
});
check(перевёрнутые.status === 400, `перевёрнутый отрезок принят с кодом ${перевёрнутые.status}`);
const текстПеревёрнутого = перевёрнутые.status === 400 ? (await перевёрнутые.json()).message : "";
check(
  текстПеревёрнутого.includes("раньше начала"),
  `отказ на перевёрнутом отрезке не называет причину: «${текстПеревёрнутого}»`,
);

/* Существование даты в календаре стерегут два слоя: «z.string().date()» в
   договоре и «stageDateFault» в домене. Откат это показал — проверка
   краснеет только когда снят и тот и другой. Слои оставлены оба: договор
   отсекает мусор на границе, домен нужен экрану, где договора нет. */
const несуществующая = await этап(owner, "/projects/R-99/stages", "POST", {
  name: "Тридцатое февраля", startsOn: "2026-04-01", endsOn: "2026-02-30", progress: 0,
});
check(несуществующая.status === 400, `30 февраля принято с кодом ${несуществующая.status}`);

const чужойГод = await этап(owner, "/projects/R-99/stages", "POST", {
  name: "Далёкий год", startsOn: "2026-04-01", endsOn: "2029-07-24", progress: 0,
});
check(чужойГод.status === 400, `год за пределами проекта принят с кодом ${чужойГод.status}`);

const дубльЭтапа = await этап(owner, "/projects/R-99/stages", "POST", {
  name: "Демонтаж", startsOn: "2026-04-01", endsOn: "2026-04-10", progress: 0,
});
check(дубльЭтапа.status === 400, `дубль названия этапа принят с кодом ${дубльЭтапа.status}`);

const прорабПравитГрафик = await этап(foreman, "/projects/R-99/stages", "POST", {
  name: "Нельзя", startsOn: "2026-04-01", endsOn: "2026-04-10", progress: 0,
});
check(прорабПравитГрафик.status === 403, `прораб завёл этап с кодом ${прорабПравитГрафик.status}`);

const сдвинут = await этап(owner, `/projects/R-99/stages/${новый?.id}`, "PATCH", {
  startsOn: "2026-04-05", endsOn: "2026-04-25",
});
check(сдвинут.ok, `сдвиг этапа не прошёл: код ${сдвинут.status}`);
const послеСдвига = сдвинут.ok ? await сдвинут.json() : [];
check(
  послеСдвига.find((row) => row.id === новый?.id)?.startsOn === "2026-04-05",
  "сдвиг этапа не изменил дату начала",
);

/*
 * Связь этапа с разделом сметы и бригадой (пункт плана 5.2, решение Р19).
 *
 * Этой парой решается, кому уйдёт сдельная оплата: приёмка ищет этап по
 * разделу, начисление — бригаду по этапу. До правки оба опознавателя
 * уходили в базу без проверки, и три обращения давали 500 «Internal server
 * error» вместо отказа: занятый раздел, несуществующий раздел,
 * несуществующая бригада.
 *
 * Проверка идёт на пробном этапе, который ниже снимается: стенд остаётся
 * в том же состоянии, в каком был.
 */
const занятыеРазделы = new Set(послеСдвига.map((row) => row.sectionId).filter(Boolean));
const свободныйРаздел = ownerEstimate.sections.find((row) => !занятыеРазделы.has(row.id));
const занятыйРаздел = послеСдвига.find((row) => row.sectionId !== null);
check(свободныйРаздел !== undefined, "в смете R-99 не осталось свободного раздела для пробы");
check(занятыйРаздел !== undefined, "ни один этап R-99 не ведёт раздел: проверять занятость не на чем");

const справочникБригад = await owner("/workers").then((r) => r.json());
const бригада = справочникБригад.find((row) => row.kind === "BRIGADE");
check(бригада !== undefined, "в справочнике организации нет ни одной бригады");

const связан = await этап(owner, `/projects/R-99/stages/${новый?.id}`, "PATCH", {
  sectionId: свободныйРаздел?.id, brigadeId: бригада?.id,
});
check(связан.ok, `связь этапа с разделом не прошла: код ${связан.status}`);
const послеСвязи = связан.ok ? await связан.json() : [];
const связанныйЭтап = послеСвязи.find((row) => row.id === новый?.id);
check(
  связанныйЭтап?.sectionId === свободныйРаздел?.id,
  "раздел не записался этапу",
);
check(связанныйЭтап?.brigade?.id === бригада?.id, "бригада не записалась этапу");

const занятыйДругим = await этап(owner, `/projects/R-99/stages/${новый?.id}`, "PATCH", {
  sectionId: занятыйРаздел?.sectionId,
});
check(занятыйДругим.status === 400, `занятый раздел принят с кодом ${занятыйДругим.status}`);
const текстЗанятого = занятыйДругим.status === 400 ? (await занятыйДругим.json()).message : "";
check(
  текстЗанятого.includes(занятыйРаздел?.name ?? "\u0000"),
  `отказ на занятом разделе не называет ведущий этап: «${текстЗанятого}»`,
);

/* Вложенный раздел: связь легла бы в базу, а приёмка её не увидела бы —
   позиции вложенных разделов она складывает в родительский и ищет этап по
   верхнему. Отказ обязан называть, какой раздел годится. */
const вложенныйРаздел = ownerEstimate.sections.flatMap((row) => row.children)[0];
check(вложенныйРаздел !== undefined, "в смете R-99 нет вложенных разделов: проверять нечего");
const вложенныйОтвет = await этап(owner, `/projects/R-99/stages/${новый?.id}`, "PATCH", {
  sectionId: вложенныйРаздел?.id,
});
check(вложенныйОтвет.status === 400, `вложенный раздел принят с кодом ${вложенныйОтвет.status}`);
const текстВложенного = вложенныйОтвет.status === 400 ? (await вложенныйОтвет.json()).message : "";
check(
  текстВложенного.includes("верхнего"),
  `отказ на вложенном разделе не называет, какой годится: «${текстВложенного}»`,
);

const небывалыйРаздел = await этап(owner, `/projects/R-99/stages/${новый?.id}`, "PATCH", {
  sectionId: "00000000-0000-4000-8000-000000000000",
});
check(небывалыйРаздел.status === 404, `несуществующий раздел принят с кодом ${небывалыйРаздел.status}`);

const чужаяБригада = await этап(owner, `/projects/R-99/stages/${новый?.id}`, "PATCH", {
  brigadeId: "00000000-0000-4000-8000-000000000000",
});
check(чужаяБригада.status === 404, `несуществующая бригада принята с кодом ${чужаяБригада.status}`);

/* Раздел чужой сметы: объект без сметы связывать не с чем, и отказ должен
   называть именно это, а не «раздел не найден» — человек ищет причину. */
const этапыБезСметы = await owner("/projects/R-19/stages").then((r) => r.json());
if (этапыБезСметы.length > 0) {
  const безСметы = await этап(owner, `/projects/R-19/stages/${этапыБезСметы[0].id}`, "PATCH", {
    sectionId: свободныйРаздел?.id,
  });
  check(безСметы.status === 400, `раздел чужой сметы принят с кодом ${безСметы.status}`);
  const текстБезСметы = безСметы.status === 400 ? (await безСметы.json()).message : "";
  check(
    текстБезСметы.includes("нет сметы"),
    `отказ объекту без сметы не называет причину: «${текстБезСметы}»`,
  );
} else {
  check(false, "у R-19 нет этапов: отказ объекту без сметы проверять не на чем");
}

const связьСнята = await этап(owner, `/projects/R-99/stages/${новый?.id}`, "PATCH", {
  sectionId: null, brigadeId: null,
});
check(связьСнята.ok, `снятие связи не прошло: код ${связьСнята.status}`);
const послеСнятияСвязи = связьСнята.ok ? await связьСнята.json() : [];
const развязанный = послеСнятияСвязи.find((row) => row.id === новый?.id);
check(развязанный?.sectionId === null, "раздел не снялся с этапа");
check(развязанный?.brigade === null, "бригада не снялась с этапа");

const частичныйПорядок = await этап(owner, "/projects/R-99/stages/order", "PATCH", {
  ids: [новый?.id],
});
check(частичныйПорядок.status === 400, `частичный порядок принят с кодом ${частичныйПорядок.status}`);

const обратныйПорядок = послеСдвига.map((row) => row.id).reverse();
const переставлен = await этап(owner, "/projects/R-99/stages/order", "PATCH", { ids: обратныйПорядок });
check(переставлен.ok, `перестановка не прошла: код ${переставлен.status}`);
const послеПерестановки = переставлен.ok ? await переставлен.json() : [];
check(
  послеПерестановки[0]?.id === обратныйПорядок[0],
  "перестановка не поставила присланный этап первым",
);

const вернули = await этап(owner, "/projects/R-99/stages/order", "PATCH", {
  ids: обратныйПорядок.slice().reverse(),
});
check(вернули.ok, `возврат порядка не прошёл: код ${вернули.status}`);

/*
 * Фактическая готовность этапа — доля принятого в итоге его раздела.
 *
 * Проверяется не «поле пришло», а «число сходится»: доля пересчитывается
 * здесь независимо, из вида приёмки, теми же двумя действиями — сумма
 * принятого делённая на сумму раздела. Совпадение двух независимых счётов
 * и есть проверка; одинокое поле в ответе не стережёт ничего.
 */
const видПриёмки = await owner("/projects/R-99/acceptance").then((r) => r.json());
const этапыСРазделом = послеСнятияСвязи.filter((row) => row.sectionId !== null);
check(этапыСРазделом.length > 0, "ни один этап R-99 не ведёт раздел: фактическую готовность не с чем сверить");

/** Копейки позиции: количество в тысячных на цену, половина вверх. */
const суммаПозиции = (тысячные, цена) => (BigInt(тысячные) * BigInt(цена) + 500n) / 1000n;

for (const stage of этапыСРазделом) {
  const section = видПриёмки.sections.find((row) => row.id === stage.sectionId);
  if (section === undefined) {
    check(false, `раздел этапа «${stage.name}» не найден в виде приёмки`);
    continue;
  }
  let всего = 0n;
  let принято = 0n;
  for (const position of section.positions) {
    всего += суммаПозиции(position.qty, position.unitPrice);
    принято += суммаПозиции(position.accepted, position.unitPrice);
  }
  const свой = всего === 0n ? null : Number((принято * 10_000n + всего / 2n) / всего);
  check(
    stage.actualProgress === свой,
    `фактическая готовность «${stage.name}»: сервер ${stage.actualProgress}, пересчёт ${свой}`,
  );
}

/* Этап без раздела получает прочерк, а не ноль: ноль означал бы «ничего не
   принято», а это иное утверждение. Пробный этап связь только что потерял. */
const безРаздела = послеСнятияСвязи.find((row) => row.id === новый?.id);
check(
  безРаздела?.actualProgress === null,
  `этап без раздела получил готовность ${безРаздела?.actualProgress} вместо прочерка`,
);

/* Список объектов фактическую не несёт: она стоит двух выборок на объект,
   а полосе плана не нужна. Узкая схема плана это и закрепляет. */
const этапВСписке = R99строка?.stages?.[0];
check(
  этапВСписке !== undefined && !("actualProgress" in этапВСписке),
  "список объектов отдаёт фактическую готовность: полоса плана её не показывает, а цена — выборки на каждый объект",
);

const снят = await этап(owner, `/projects/R-99/stages/${новый?.id}`, "DELETE");
check(снят.ok, `этап не снят: код ${снят.status}`);
const послеСнятия = снят.ok ? await снят.json() : [];
check(послеСнятия.length === 7, `после снятия этапов ${послеСнятия.length} вместо семи`);
check(
  послеСнятия.every((row) => row.name !== проба),
  "снятый этап остался в списке",
);


/*
 * ГРАФИК ИЗ РАЗДЕЛОВ СМЕТЫ (стадия C.3).
 *
 * Разделы верхнего уровня становятся этапами, сроки раскладываются по
 * стоимости работ. Проверяется не то, что маршрут отвечает 200, а то, что
 * раскладка сходится с независимым пересчётом: доли считаются здесь заново
 * из сметы, а не берутся из ответа. Проверка, сверяющая ответ с ответом,
 * не проверяет ничего.
 *
 * Блок возвращает стенд в прежний вид: заведённые этапы снимаются. График
 * не история — снять этап законно, и семь этапов R-99 остаются семью.
 */
const этапыДоРаскладки = await owner("/projects/R-99/stages").then((r) => r.json());
const ведутРазделы = new Set(этапыДоРаскладки.map((row) => row.sectionId).filter(Boolean));
/* Раздел без единой позиции этапом не становится: это заголовок сметы, а
   не работа. Считается здесь независимо, обходом дерева, а не берётся из
   ответа сервера — сверять ответ с ответом бессмысленно. На стенде такой
   раздел есть: «ДОПОЛНИТЕЛЬНЫЕ РАСХОДЫ ( ВХОДЕ РАБОТЫ)». */
const позицийВРазделе = (раздел) =>
  раздел.items.length + раздел.children.reduce((всего, дочерний) => всего + позицийВРазделе(дочерний), 0);
const свободныеРазделы = ownerEstimate.sections
  .filter((row) => !ведутРазделы.has(row.id) && позицийВРазделе(row) > 0);
check(
  ownerEstimate.sections.some((row) => позицийВРазделе(row) === 0),
  "в смете нет раздела-заголовка: отсев разделов без работ проверять не на чем",
);
check(
  свободныеРазделы.length >= 2,
  `свободных разделов ${свободныеРазделы.length}: раскладку проверять не на чем`,
);

const прорабРаскладка = await foreman("/projects/R-99/stages/plan", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ from: "2026-03-02", to: "2026-08-15" }),
});
check(прорабРаскладка.status === 403, `прорабу раскладка отдана с кодом ${прорабРаскладка.status}`);

const безСметыРаскладка = await owner("/projects/R-19/stages/plan", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ from: "2026-03-02", to: "2026-08-15" }),
});
check(безСметыРаскладка.status === 400, `объекту без сметы раскладка прошла: ${безСметыРаскладка.status}`);
const текстБезСметыПлана = безСметыРаскладка.status === 400
  ? (await безСметыРаскладка.json()).message
  : "";
check(
  текстБезСметыПлана.includes("нет сметы"),
  `отказ объекту без сметы не называет причину: «${текстБезСметыПлана}»`,
);

/* Вывернутое окно отвергается тем же сводом правил, что даты отдельного
   этапа: иначе лист и раскладка отказывали бы по разным правилам. */
const вывернутоеОкно = await owner("/projects/R-99/stages/plan", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ from: "2026-08-15", to: "2026-03-02" }),
});
check(вывернутоеОкно.status === 400, `вывернутое окно принято с кодом ${вывернутоеОкно.status}`);

const ОКНО = { from: "2026-03-02", to: "2026-08-15" };
const разложено = await owner("/projects/R-99/stages/plan", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(ОКНО),
});
check(разложено.ok, `раскладка не прошла: код ${разложено.status}`);
const послеРаскладки = разложено.ok ? await разложено.json() : этапыДоРаскладки;
const заведённые = послеРаскладки.filter((row) =>
  !этапыДоРаскладки.some((было) => было.id === row.id));

check(
  заведённые.length === свободныеРазделы.length,
  `заведено ${заведённые.length} этапов при ${свободныеРазделы.length} свободных разделах`,
);
check(
  этапыДоРаскладки.every((было) => послеРаскладки.some((стало) =>
    стало.id === было.id && стало.startsOn === было.startsOn && стало.endsOn === было.endsOn)),
  "раскладка тронула уже заведённые этапы: она дозаводит, а не перезаписывает",
);
check(
  заведённые.every((row) => row.sectionId !== null),
  "заведённый этап не связан с разделом: приёмке будет некому начислять",
);
check(
  заведённые.every((row) => row.brigade === null && row.progress === 0),
  "заведённый этап пришёл с бригадой или с ненулевой готовностью",
);
check(
  заведённые.every((row) => свободныеРазделы.some((раздел) =>
    раздел.id === row.sectionId && раздел.name === row.name)),
  "имя заведённого этапа не совпадает с именем его раздела",
);

/* Сроки: первый начинается в начале окна, последний кончается в конце,
   между этапами нет ни разрывов, ни перекрытий. */
const поПорядку = [...заведённые].sort((левый, правый) => левый.order - правый.order);
check(поПорядку[0]?.startsOn === ОКНО.from, `первый этап начинается ${поПорядку[0]?.startsOn}`);
check(
  поПорядку[поПорядку.length - 1]?.endsOn === ОКНО.to,
  `последний этап кончается ${поПорядку[поПорядку.length - 1]?.endsOn} вместо ${ОКНО.to}`,
);
const следующийДень = (день) => {
  const дата = new Date(`${день}T00:00:00Z`);
  дата.setUTCDate(дата.getUTCDate() + 1);
  return дата.toISOString().slice(0, 10);
};
check(
  поПорядку.every((row, i) => i === 0 || row.startsOn === следующийДень(поПорядку[i - 1].endsOn)),
  "этапы раскладки идут с разрывом или внахлёст",
);

/* Независимый пересчёт: дорогой раздел получает больше дней. Доли берутся
   из сметы заново — сверять ответ с ответом бессмысленно. */
const деньВЧислах = (день) => Math.round(new Date(`${день}T00:00:00Z`).getTime() / 86_400_000);
const длительность = (row) => деньВЧислах(row.endsOn) - деньВЧислах(row.startsOn) + 1;
const стоимостьРаздела = new Map(свободныеРазделы.map((раздел) => [раздел.id, BigInt(раздел.subtotal)]));
const пары = поПорядку.flatMap((row, i) => (i === 0 ? [] : [[поПорядку[i - 1], row]]));
check(
  пары.every(([левый, правый]) => {
    const дороже = стоимостьРаздела.get(левый.sectionId) > стоимостьРаздела.get(правый.sectionId);
    return !дороже || длительность(левый) >= длительность(правый);
  }),
  "дешёвый раздел получил больше дней, чем дорогой: раскладка идёт не по стоимости",
);
check(
  поПорядку.reduce((всего, row) => всего + длительность(row), 0)
    === деньВЧислах(ОКНО.to) - деньВЧислах(ОКНО.from) + 1,
  "сумма длительностей не совпала с окном: округления копятся",
);

/* Повторный вызов: раскладывать нечего, и отказ называет это, а не заводит
   вторые этапы на те же разделы. */
const повторнаяРаскладка = await owner("/projects/R-99/stages/plan", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(ОКНО),
});
check(повторнаяРаскладка.status === 400, `повторная раскладка прошла с кодом ${повторнаяРаскладка.status}`);
const текстПовтора = повторнаяРаскладка.status === 400
  ? (await повторнаяРаскладка.json()).message
  : "";
/* Отказ называет, почему заводить нечего: все разделы с работами уже
   ведутся, либо свободными остались одни заголовки. Обе причины разные, и
   человеку нужна та, которая верна. */
check(
  текстПовтора.includes("уже ведутся") || текстПовтора.includes("не содержат позиций"),
  `отказ повторной раскладке не называет причину: «${текстПовтора}»`,
);

/* Стенд возвращается: заведённые этапы снимаются, остаются прежние семь. */
for (const row of заведённые) {
  await этап(owner, `/projects/R-99/stages/${row.id}`, "DELETE");
}
const послеВозврата = await owner("/projects/R-99/stages").then((r) => r.json());
check(
  послеВозврата.length === этапыДоРаскладки.length,
  `после возврата этапов ${послеВозврата.length} вместо ${этапыДоРаскладки.length}`,
);

/*
 * Свод по рабочему (объём, пункт 4): сколько начислено бригаде по всем
 * объектам организации.
 *
 * Сверяется не с собой, а со сводом «Начислено бригадам» вкладки приёмки:
 * на стенде объект с приёмками один, и свод по рабочему обязан совпасть с
 * ним до копейки. Совпадут два независимых счёта — значит, сходится.
 *
 * Разграничение то же, что у ставки и прибыли: прорабу этих полей нет в
 * ответе вовсе. Утечку ловит общая проверка внутренних полей — поле названо
 * `wageTotal` именно поэтому; здесь проверяется обратное — что руководителю
 * поле пришло. Проверка одного отсутствия проходит и на поле, которого не
 * шлют никому.
 */
const сводПоРабочему = await owner("/workers").then((r) => r.json());
const сЗачислением = сводПоРабочему.find((row) => row.wageTotal !== undefined && row.wageTotal !== "0");
check(
  сводПоРабочему.every((row) => row.wageTotal !== undefined && row.projects !== undefined),
  "руководителю пришли бригады без свода: начислено и объекты не заполнены",
);
check(сЗачислением !== undefined, "ни одной бригаде на стенде не начислено: свод не с чем сверить");

/* Вид приёмки берётся здесь своим вызовом: тот, что ниже, снимается после
   заведения и сторно пакета, а сверять надо два счёта одного мгновения. */
const сводПриёмки = (await owner("/projects/R-99/acceptance").then((r) => r.json())).accruals ?? [];
const поПриёмке = сводПриёмки.find((row) => row.brigadeName === сЗачислением?.name);
check(
  поПриёмке !== undefined && поПриёмке.total === сЗачислением?.wageTotal,
  `свод по рабочему «${сЗачислением?.name}» — ${сЗачислением?.wageTotal}, `
  + `свод приёмки — ${поПриёмке?.total}`,
);
check(
  сЗачислением?.projects === 1,
  `у бригады объектов ${сЗачислением?.projects} вместо одного: на стенде приёмка ведётся на одном объекте`,
);
check(
  сводПоРабочему.some((row) => row.wageTotal === "0" && row.projects === 0),
  "бригада без начислений не показала ноль: ноль здесь — сведение, а не отсутствие величины",
);

const бригадыПрорабу = await foreman("/workers").then((r) => r.json());
check(
  бригадыПрорабу.length > 0,
  "прорабу не пришло ни одной бригады: справочник ему нужен",
);
check(
  бригадыПрорабу.every((row) => row.projects === undefined),
  "прорабу утекло число объектов бригады",
);
/* Тем же обходом, каким проверяются смета, сводка, приёмка и транши:
   справочник — такой же носитель внутренних величин, и своё правило для
   него разошлось бы с общим на первой же новой величине. */
const утечкиСправочника = findInternal(бригадыПрорабу);
check(
  утечкиСправочника.length === 0,
  `прорабу утекли внутренние поля справочника: ${утечкиСправочника.slice(0, 5).join(", ")}`,
);

const anonymousStages = await fetch(`${BASE}/projects/R-99/stages`);
check(anonymousStages.status === 401, `график отдан без сессии с кодом ${anonymousStages.status}`);

const anonymousMeasure = await fetch(`${BASE}/projects/R-99/measure`);
check(anonymousMeasure.status === 401, `обмер отдан без сессии с кодом ${anonymousMeasure.status}`);

const anonymous = await fetch(`${BASE}/projects/R-99/estimate`);
check(anonymous.status === 401, `смета отдана без сессии с кодом ${anonymous.status}`);

/**
 * Приёмка — ядро продукта. Проверяется то, чего не видно на снимке: что
 * начисление считается по снимку ставки, что сторно возвращает остаток
 * ровно, что прораб не получает ни ставки, ни суммы начисления, и что
 * раздел без этапа отказывает внятно.
 *
 * Стенд не возвращается удалением: история приёмки не переписывается по
 * БП-04, и пакет остаётся в списке. Поэтому проверки написаны на разностях,
 * а не на absolute-числах — прогон второй раз даёт тот же результат.
 */
const снимок = readFileSync(new URL("./fixtures/snimok.png", import.meta.url));

const пакет = (тело) => {
  const form = new FormData();
  form.append("batch", JSON.stringify(тело));
  form.append("file", new Blob([снимок]), "snimok.png");
  return form;
};

const доПриёмки = await owner("/projects/R-99/acceptance").then((r) => r.json());
check(доПриёмки.sections.length === 11, `разделов приёмки ${доПриёмки.sections.length} вместо одиннадцати`);
const сЭтапом = доПриёмки.sections.filter((section) => section.stage !== null);
check(сЭтапом.length === 7, `разделов с этапом ${сЭтапом.length} вместо семи`);
check(
  доПриёмки.sections.reduce((всего, section) => всего + section.positions.length, 0) === 132,
  "позиции разделов не сходятся со сметой в 132 строки",
);

const разделПриёмки = сЭтапом[0];
const позицияПриёмки = разделПриёмки.positions.find((position) => BigInt(position.remaining) >= 2n);
check(позицияПриёмки !== undefined, "в первом разделе нет позиции с остатком хотя бы в две тысячных");
check(
  разделПриёмки.stage?.brigade?.name !== undefined,
  `у этапа «${разделПриёмки.stage?.name}» нет бригады: начислять некому`,
);

const былоПакетов = доПриёмки.batches.length;
const былоПринято = BigInt(позицияПриёмки?.accepted ?? "0");
const былоВыполнено = BigInt(доПриёмки.totals.accepted);
const былоНачислено = BigInt(доПриёмки.totals.accrued);
const половина = BigInt(позицияПриёмки?.remaining ?? "0") / 2n;

/* Принимает прораб: это его ежедневная работа и единственный источник факта
   выполнения (БП-01). */
const пакетЗаведён = await foreman("/projects/R-99/acceptance", {
  method: "POST",
  body: пакет({
    sectionId: разделПриёмки.id,
    comment: "Проверка API",
    positions: [{ itemId: позицияПриёмки?.id, qty: половина.toString() }],
  }),
});
check(пакетЗаведён.ok, `пакет не пакетЗаведён: код ${пакетЗаведён.status}`);
const послеПриёмки = пакетЗаведён.ok ? await пакетЗаведён.json() : доПриёмки;
check(
  послеПриёмки.batches.length === былоПакетов + 1,
  `пакетов ${послеПриёмки.batches.length} вместо ${былоПакетов + 1}`,
);

const принятая = послеПриёмки.sections
  .find((section) => section.id === разделПриёмки.id)?.positions
  .find((position) => position.id === позицияПриёмки?.id);
check(
  BigInt(принятая?.accepted ?? "0") === былоПринято + половина,
  `принято ${принятая?.accepted} вместо ${(былоПринято + половина).toString()}`,
);
check(
  BigInt(принятая?.remaining ?? "0") === BigInt(позицияПриёмки?.remaining ?? "0") - половина,
  "остаток по позиции не уменьшился на принятое",
);

/* Начисление считается по снимку ставки: ставка × количество, тем же
   правилом округления, что и вся арифметика денег. */
const глазамиРуководителя = await owner("/projects/R-99/acceptance").then((r) => r.json());
const ожидаемоеНачисление = (BigInt(позицияПриёмки?.unitWage ?? "0") * половина + 500n) / 1000n;
check(
  BigInt(глазамиРуководителя.totals.accrued) - былоНачислено === ожидаемоеНачисление,
  `начислено ${(BigInt(глазамиРуководителя.totals.accrued) - былоНачислено).toString()} вместо `
    + `${ожидаемоеНачисление.toString()} копеек`,
);
const ожидаемоеВыполнение = (BigInt(позицияПриёмки?.unitPrice ?? "0") * половина + 500n) / 1000n;
check(
  BigInt(глазамиРуководителя.totals.accepted) - былоВыполнено === ожидаемоеВыполнение,
  "выполнено на сумму не сошлось с ручным расчётом",
);
check(
  глазамиРуководителя.accruals?.some((row) => row.brigadeName === разделПриёмки.stage?.brigade?.name),
  "бригада принявшего этапа не попала в свод начислений",
);

/* Разграничение на уровне полей: прораб не получает ни ставки, ни суммы
   начисления, ни свода. Сумма при известном количестве выдала бы ставку. */
const глазамиПрораба = await foreman("/projects/R-99/acceptance").then((r) => r.json());
check(глазамиПрораба.totals.accrued === undefined, "прораб получил сумму начисления");
check(глазамиПрораба.accruals === undefined, "прораб получил свод начислений");
const утечкиПриёмки = findInternal(глазамиПрораба);
check(
  утечкиПриёмки.length === 0,
  `внутренних полей в приёмке у прораба: ${утечкиПриёмки.length}, первое — ${утечкиПриёмки[0]}`,
);
check(
  глазамиПрораба.batches[0]?.lines?.[0]?.amount === undefined,
  "прораб получил сумму начисления в строке пакета",
);

/* Отказы. Тексты сверяются по существу, а не дословно: важно, что причина
   названа и сказано, что делать. */
const превышение = await foreman("/projects/R-99/acceptance", {
  method: "POST",
  body: пакет({
    sectionId: разделПриёмки.id,
    positions: [{ itemId: позицияПриёмки?.id, qty: позицияПриёмки?.qty }],
  }),
});
check(превышение.status === 400, `превышение остатка принято с кодом ${превышение.status}`);
const текстПревышения = превышение.status === 400 ? (await превышение.json()).message : "";
check(
  текстПревышения.includes("по смете осталось") && текстПревышения.includes("Уменьшите количество"),
  `отказ на превышении не называет остаток и работу: «${текстПревышения}»`,
);

const безЭтапа = доПриёмки.sections.find((section) => section.stage === null);
const чужойРаздел = await foreman("/projects/R-99/acceptance", {
  method: "POST",
  body: пакет({
    sectionId: безЭтапа?.id,
    positions: [{ itemId: безЭтапа?.positions[0]?.id, qty: "1000" }],
  }),
});
check(чужойРаздел.status === 400, `раздел без этапа принят с кодом ${чужойРаздел.status}`);
const текстБезЭтапа = чужойРаздел.status === 400 ? (await чужойРаздел.json()).message : "";
check(
  текстБезЭтапа.includes("нет этапа графика") && текстБезЭтапа.includes("Работа"),
  `отказ без этапа не уводит на вкладку графика: «${текстБезЭтапа}»`,
);

const безСнимка = await foreman("/projects/R-99/acceptance", {
  method: "POST",
  body: (() => {
    const form = new FormData();
    form.append("batch", JSON.stringify({
      sectionId: разделПриёмки.id,
      positions: [{ itemId: позицияПриёмки?.id, qty: "1000" }],
    }));
    return form;
  })(),
});
check(безСнимка.status === 400, `пакет без снимка принят с кодом ${безСнимка.status}`);

const неКартинка = await foreman("/projects/R-99/acceptance", {
  method: "POST",
  body: (() => {
    const form = new FormData();
    form.append("batch", JSON.stringify({
      sectionId: разделПриёмки.id,
      positions: [{ itemId: позицияПриёмки?.id, qty: "1000" }],
    }));
    form.append("file", new Blob(["<svg xmlns=\"http://www.w3.org/2000/svg\"/>"]), "snimok.png");
    return form;
  })(),
});
check(неКартинка.status === 400, `файл, назвавшийся снимком, принят с кодом ${неКартинка.status}`);

/* Сторно — право руководителя, и только с причиной. */
const строкаПакета = послеПриёмки.batches[0]?.lines?.[0];
const отменаПрорабом = await создать(foreman, `/projects/R-99/acceptance/${строкаПакета?.id}/reversal`, {
  reason: "прораб не вправе",
});
check(отменаПрорабом.status === 403, `прораб сторнировал с кодом ${отменаПрорабом.status}`);

const безПричины = await создать(owner, `/projects/R-99/acceptance/${строкаПакета?.id}/reversal`, {
  reason: "   ",
});
check(безПричины.status === 400, `отмена без причины принято с кодом ${безПричины.status}`);

const отмена = await создать(owner, `/projects/R-99/acceptance/${строкаПакета?.id}/reversal`, {
  reason: "Проверка API: приёмка отменена",
});
check(отмена.ok, `сторно не прошло: код ${отмена.status}`);
const послеСторно = отмена.ok ? await отмена.json() : послеПриёмки;

/* Пара «приёмка и её отмена» возвращает всё ровно: количество, выполненное
   и начисленное. Расхождение хотя бы в копейку означает, что округление
   несимметрично, — то, ради чего правило половины вверх по модулю и выбрано. */
const послеОтмены = послеСторно.sections
  .find((section) => section.id === разделПриёмки.id)?.positions
  .find((position) => position.id === позицияПриёмки?.id);
check(
  BigInt(послеОтмены?.accepted ?? "-1") === былоПринято,
  `после сторно принято ${послеОтмены?.accepted} вместо ${былоПринято.toString()}`,
);
check(
  BigInt(послеСторно.totals.accepted) === былоВыполнено,
  "после сторно выполнено на сумму не вернулось к прежнему",
);
check(
  BigInt(послеСторно.totals.accrued) === былоНачислено,
  "после сторно начисленное не вернулось к прежнему: округление несимметрично",
);
check(
  послеСторно.batches[0]?.lines?.[0]?.reversedAt !== null,
  "сторнированная строка не помечена временем отмены",
);
check(
  послеСторно.batches[0]?.lines?.[0]?.reason === "Проверка API: приёмка отменена",
  "сторнированная строка не называет причину",
);

const повторноеСторно = await создать(owner, `/projects/R-99/acceptance/${строкаПакета?.id}/reversal`, {
  reason: "второй раз",
});
check(повторноеСторно.status === 400, `повторное сторно принято с кодом ${повторноеСторно.status}`);

const приёмкаБезСессии = await fetch(`${BASE}/projects/R-99/acceptance`);
check(приёмкаБезСессии.status === 401, `приёмка отдана без сессии с кодом ${приёмкаБезСессии.status}`);

const чужаяПриёмка = await foreman("/projects/R-31/acceptance");
check(чужаяПриёмка.status === 404, `чужой объект отдал приёмку с кодом ${чужаяПриёмка.status}`);


/*
 * ФОТООТЧЁТ (стадия C.4).
 *
 * Отчёт и вкладка приёмки отвечают на разные вопросы. Приёмка — «что
 * принято по действующей смете», отчёт — «что сделано на объекте».
 * Отсюда всё остальное: отбора по редакции в отчёте нет, сторно из него не
 * исчезает, денежных величин в нём нет ни у одной роли, и прорабу он
 * открыт — снимает он.
 *
 * Свод отчёта сверяется не с собой, а с видом приёмки: два независимых
 * счёта одних и тех же пакетов. Проверка, сверяющая отчёт с отчётом, не
 * проверяет ничего.
 */
const отчёт = await owner("/projects/R-99/acceptance/report").then((r) => r.json());
const пакетыОтчёта = отчёт.days.flatMap((день) => день.batches);
check(
  отчёт.totals.batches === послеСторно.batches.length,
  `в отчёте ${отчёт.totals.batches} приёмок, в виде приёмки ${послеСторно.batches.length}`,
);
check(
  пакетыОтчёта.length === отчёт.totals.batches,
  `по дням разложено ${пакетыОтчёта.length} приёмок, а свод обещает ${отчёт.totals.batches}`,
);
check(
  отчёт.totals.photos === пакетыОтчёта.reduce((сумма, пакет) => сумма + пакет.photos.length, 0),
  "свод снимков не сходится с числом снимков в пакетах",
);
check(
  отчёт.totals.photos > 0,
  "на стенде в отчёте нет ни одного снимка: проверять нечего",
);

/* Раскладка по дням и список разделов отбора здесь не проверяются, и это
   не упущение. Все приёмки стенда заводятся одним заходом и получают время
   сервера: второго дня не бывает, и проверка порядка дней прошла бы при
   любой сортировке. Снимок у пакета ровно один: «считать снимки»
   неотличимо от «считать пакеты». Оба правила вынесены в домен
   (`groupByDay`, `photoSections`) и испытываются его тестами — на
   придуманных данных, где дней несколько, а снимков у пакета то ноль, то
   три. Проверка, которая не может упасть, не стережёт ничего. */
check(
  отчёт.sections.reduce((сумма, раздел) => сумма + раздел.photos, 0) === отчёт.totals.photos,
  "снимки по разделам не сходятся с общим числом: отбор по этапу теряет часть",
);

/* Сторно остаётся в отчёте помеченным. Спрятать его значило бы переписать
   историю (БП-04), выдать за сделанное — солгать заказчику. */
const строкиОтчёта = пакетыОтчёта.flatMap((пакет) => пакет.lines);
check(
  строкиОтчёта.some((строка) => строка.reversed === true),
  "в отчёте нет ни одной отменённой строки, хотя сторно на стенде прошло",
);
check(
  пакетыОтчёта.every((пакет) => пакет.lines.length > 0 || пакет.reversed === false),
  "пакет без строк помечен сторнированным: «все строки отменены» на пустом списке истинно всегда",
);

/* Денег в отчёте нет ни у одной роли: отчёт показывает работу, а не
   расчёт. Ставка у прораба закрыта и без того, но здесь закрыта и сумма —
   у обоих, потому что её в ответе нет вовсе. */
const деньгиВОтчёте = findInternal(отчёт);
check(деньгиВОтчёте.length === 0, `в отчёте у руководителя внутренние поля: ${деньгиВОтчёте.join(", ")}`);
check(
  !JSON.stringify(отчёт).includes('"amount"'),
  "в отчёте есть суммы: отчёт отвечает на вопрос о работе, а не о деньгах",
);

/* Прорабу отчёт открыт: снимает он, и запрет смотреть снятое означал бы,
   что фотография уходит в никуда. */
const отчётПрораба = await foreman("/projects/R-99/acceptance/report");
check(отчётПрораба.ok, `прорабу отчёт не отдан: код ${отчётПрораба.status}`);
const видПрораба = отчётПрораба.ok ? await отчётПрораба.json() : { totals: { batches: -1 } };
check(
  видПрораба.totals.batches === отчёт.totals.batches,
  `прорабу в отчёте ${видПрораба.totals.batches} приёмок вместо ${отчёт.totals.batches}`,
);
const утечкиОтчёта = findInternal(видПрораба);
check(утечкиОтчёта.length === 0, `прорабу в отчёте утекли внутренние поля: ${утечкиОтчёта.join(", ")}`);

const отчётБезСессии = await fetch(`${BASE}/projects/R-99/acceptance/report`);
check(отчётБезСессии.status === 401, `отчёт отдан без сессии с кодом ${отчётБезСессии.status}`);
const чужойОтчёт = await foreman("/projects/R-31/acceptance/report");
check(чужойОтчёт.status === 404, `чужой объект отдал отчёт с кодом ${чужойОтчёт.status}`);


/* ТРАНШИ (пункты плана 4.2–4.4).
 *
 * Блок написан на дельтах и не опирается на число траншей: транш — денежная
 * запись, удалять её нельзя, и повторный прогон на том же стенде оставляет
 * закрытые транши в истории. Проверяется не количество, а то, что открытый
 * транш ровно один и что величины сходятся с ручным расчётом.
 *
 * Стенд возвращается к исходному виду по существу: в конце блока у объекта
 * снова один открытый рабочий транш.
 */
/* Ручной расчёт надбавки: то же правило, что в домене (половина вверх),
   но записанное здесь заново. Проверка, повторяющая вызов домена, не
   проверяет ничего — она сверяет функцию с ней же самой. */
const надбавка = (сумма) => (BigInt(сумма) * 11200n + 5000n) / 10000n;

const траншиДо = await owner("/projects/R-99/tranches").then((r) => r.json());
check(траншиДо.supervisionShare === 1200, `надбавка транша ${траншиДо.supervisionShare} вместо 1200`);

/* Согласованность величин: клиентская сумма, остаток и заполнение выводятся
   из выработки одним правилом. Проверяется на каждом транше — расхождение
   означало бы, что сервер и домен считают по-разному. */
for (const транш of траншиДо.tranches) {
  const клиентская = надбавка(транш.produced);
  check(
    BigInt(транш.client) === клиентская,
    `транш № ${транш.number}: клиентская сумма ${транш.client} вместо ${клиентская.toString()}`,
  );
  check(
    BigInt(транш.remainder) === BigInt(транш.amount) - клиентская,
    `транш № ${транш.number}: остаток ${транш.remainder} не равен сумме минус выработка с надбавкой`,
  );
}

const предоплата = траншиДо.tranches.find((транш) => транш.number === 0);
check(предоплата?.status === "PAID", `предоплата в состоянии ${предоплата?.status} вместо PAID`);
const открытые = траншиДо.tranches.filter((транш) => транш.status === "OPEN");
check(открытые.length === 1, `открытых траншей ${открытые.length} вместо одного`);
check(траншиДо.current?.id === открытые[0]?.id, "текущий транш не совпадает с единственным открытым");

/* Приёмка попадает в открытый транш и увеличивает его выработку ровно на
   стоимость принятого. Считается тем же произведением, что и «выполнено на
   сумму»: количество в тысячных, цена в копейках, деление на тысячу. */
const позицияТранша = сЭтапом[0].positions.find((position) => BigInt(position.remaining) >= 2n);
const четверть = BigInt(позицияТранша?.remaining ?? "0") / 4n;
const вТранш = await foreman("/projects/R-99/acceptance", {
  method: "POST",
  body: пакет({
    sectionId: сЭтапом[0].id,
    comment: "Проверка транша",
    positions: [{ itemId: позицияТранша?.id, qty: четверть.toString() }],
  }),
});
check(вТранш.ok, `приёмка в транш не прошла: код ${вТранш.status}`);

const траншиПосле = await owner("/projects/R-99/tranches").then((r) => r.json());
const ожидаемаяВыработка = (BigInt(позицияТранша?.unitPrice ?? "0") * четверть + 500n) / 1000n;
check(
  BigInt(траншиПосле.current?.produced ?? "0") - BigInt(траншиДо.current?.produced ?? "0")
    === ожидаемаяВыработка,
  `выработка транша выросла на ${(BigInt(траншиПосле.current?.produced ?? "0") - BigInt(траншиДо.current?.produced ?? "0")).toString()}`
    + ` вместо ${ожидаемаяВыработка.toString()}`,
);
check(
  BigInt(траншиПосле.current?.remainder ?? "0")
    === BigInt(траншиПосле.current?.amount ?? "0") - надбавка(траншиПосле.current?.produced ?? "0"),
  "остаток транша не сошёлся с ручным расчётом после приёмки",
);
check(
  траншиПосле.outside.batches === траншиДо.outside.batches,
  "пакет приёмки попал в разрез «вне транша», хотя транш открыт",
);

/* Разрез свода «за транш» (пункт 3.10): у руководителя есть, у прораба нет
   ни свода, ни разреза — весь свод внутренний. */
const сводСТраншем = await owner("/projects/R-99/acceptance").then((r) => r.json());
check(
  сводСТраншем.accruals?.every((row) => row.tranche !== undefined),
  "в своде начислений нет разреза за транш",
);
check(
  сводСТраншем.accruals?.some((row) => row.tranche !== null && BigInt(row.tranche) > 0n),
  "разрез за транш пуст, хотя приёмка в транш прошла",
);

/* Сторно возвращает выработку транша: пара «приёмка и её сторно» траншу
   безразлична, как и остатку по позиции. */
const строкаТранша = траншиПосле && сводСТраншем.batches
  .find((batch) => batch.comment === "Проверка транша")?.lines?.[0];
await создать(owner, `/projects/R-99/acceptance/${строкаТранша?.id}/reversal`, {
  reason: "Проверка транша: приёмка отменена",
});
const траншиПослеСторно = await owner("/projects/R-99/tranches").then((r) => r.json());
check(
  BigInt(траншиПослеСторно.current?.produced ?? "-1") === BigInt(траншиДо.current?.produced ?? "0"),
  "сторно не вернуло выработку транша",
);

/* Отказы при заведении. */
const второйОткрытый = await создать(owner, "/projects/R-99/tranches", { amount: "10000000" });
check(второйОткрытый.status === 400, `второй открытый транш заведён с кодом ${второйОткрытый.status}`);
const текстВторого = второйОткрытый.status === 400 ? (await второйОткрытый.json()).message : "";
check(
  текстВторого.includes("уже открыт транш") && текстВторого.includes("Закройте"),
  `отказ на втором транше не называет причину и действие: «${текстВторого}»`,
);

const нулевойТранш = await создать(owner, "/projects/R-99/tranches", { amount: "0" });
check(нулевойТранш.status === 400, `транш на ноль заведён с кодом ${нулевойТранш.status}`);

const втораяПредоплата = await создать(owner, "/projects/R-99/tranches", {
  amount: "10000000", prepayment: true,
});
check(втораяПредоплата.status === 400, `вторая предоплата заведена с кодом ${втораяПредоплата.status}`);

const траншПрорабом = await создать(foreman, "/projects/R-99/tranches", { amount: "10000000" });
check(траншПрорабом.status === 403, `прораб завёл транш с кодом ${траншПрорабом.status}`);

/* Читают транши все, кому виден объект: внутренних величин в них нет.
   Прораб видит границу своей работы — сколько ещё можно принять. */
const траншиПрораба = await foreman("/projects/R-99/tranches");
check(траншиПрораба.ok, `прорабу не отданы транши: код ${траншиПрораба.status}`);
const утечкиТраншей = findInternal(await траншиПрораба.json());
check(утечкиТраншей.length === 0, `внутренние поля в траншах у прораба: ${утечкиТраншей.join(", ")}`);

const траншиБезСессии = await fetch(`${BASE}/projects/R-99/tranches`);
check(траншиБезСессии.status === 401, `транши отданы без сессии с кодом ${траншиБезСессии.status}`);
const чужиеТранши = await foreman("/projects/R-31/tranches");
check(чужиеТранши.status === 404, `чужой объект отдал транши с кодом ${чужиеТранши.status}`);

/* Закрытие, перевыработка, оплата. Малый транш заводится намеренно: доказать,
   что приёмка сверх суммы транша принимается, а не отклоняется, — иначе
   правило «перевыработка не ошибка» ничем не стережётся. */
const текущийId = траншиПослеСторно.current?.id;
const закрытие = await создать(owner, `/projects/R-99/tranches/${текущийId}/closure`, {});
check(закрытие.ok, `транш не закрылся: код ${закрытие.status}`);
const послеЗакрытия = закрытие.ok ? await закрытие.json() : траншиПослеСторно;
check(послеЗакрытия.current === null, "после закрытия остался текущий транш");
check(
  послеЗакрытия.tranches.find((транш) => транш.id === текущийId)?.status === "CLOSED",
  "закрытый транш не перешёл в состояние CLOSED",
);

const повторноеЗакрытие = await создать(owner, `/projects/R-99/tranches/${текущийId}/closure`, {});
check(повторноеЗакрытие.status === 400, `транш закрыт второй раз с кодом ${повторноеЗакрытие.status}`);

const малый = await создать(owner, "/projects/R-99/tranches", {
  amount: "100", comment: "Проверка перевыработки",
});
check(малый.ok, `малый транш не заведён: код ${малый.status}`);
const малыйId = малый.ok ? (await малый.json()).current?.id : null;

const сверхТранша = await foreman("/projects/R-99/acceptance", {
  method: "POST",
  body: пакет({
    sectionId: сЭтапом[0].id,
    comment: "Проверка перевыработки",
    positions: [{ itemId: позицияТранша?.id, qty: четверть.toString() }],
  }),
});
check(сверхТранша.ok, `приёмка сверх суммы транша отклонена с кодом ${сверхТранша.status}`);

const перевыработка = await owner("/projects/R-99/tranches").then((r) => r.json());
check(
  BigInt(перевыработка.current?.remainder ?? "0") < 0n,
  `остаток перевыработанного транша ${перевыработка.current?.remainder} не отрицателен`,
);
check(
  (перевыработка.current?.fill ?? 0) > 10000,
  `заполнение перевыработанного транша ${перевыработка.current?.fill} не больше 10000`,
);

/* Приёмка перевыработки сторнируется: без этого каждый прогон навсегда
   съедал бы четверть остатка позиции, и на стенде, проверяемом не впервые,
   принимать стало бы нечего. История при этом целая — сторно, а не удаление. */
const строкаСверх = await owner("/projects/R-99/acceptance").then((r) => r.json())
  .then((вид) => вид.batches.find((batch) => batch.comment === "Проверка перевыработки")?.lines?.[0]);
await создать(owner, `/projects/R-99/acceptance/${строкаСверх?.id}/reversal`, {
  reason: "Проверка транша: перевыработка отменена",
});

/* Отметка оплаты зовётся `settlement` с 19.09.2026: рядом встал маршрут
   записи платежа `payments`, и пара имён, различающаяся одной буквой,
   кончилась бы вызовом не того маршрута. */
const оплатаОткрытого = await создать(owner, `/projects/R-99/tranches/${малыйId}/settlement`, {});
check(оплатаОткрытого.status === 400, `открытый транш оплачен с кодом ${оплатаОткрытого.status}`);

/* Платёж по открытому траншу отвергается по тому же доводу, что и отметка:
   сумма к оплате ещё не определена. */
const платёжОткрытого = await создать(owner, `/projects/R-99/tranches/${малыйId}/payments`, {
  amount: "100000", paidOn: new Date().toISOString().slice(0, 10),
});
check(платёжОткрытого.status === 400, `платёж по открытому траншу принят с кодом ${платёжОткрытого.status}`);

await создать(owner, `/projects/R-99/tranches/${малыйId}/closure`, {});

/* Частичная оплата: платёж записан, состояние транша не изменилось.
   Это и есть решение заказчика от 19.09.2026 — оплаченным транш называет
   отметка руководителя, а не арифметика платежей. Проверяется прямо: иначе
   первая же «удобная» правка выставила бы PAID по покрытию суммы. */
const сегодняДень = new Date().toISOString().slice(0, 10);
const частичный = await создать(owner, `/projects/R-99/tranches/${малыйId}/payments`, {
  amount: "300000", paidOn: сегодняДень, comment: "Частичная оплата",
});
check(частичный.ok, `частичный платёж не записан: код ${частичный.status}`);
const послеЧастичного = частичный.ok ? await частичный.json() : перевыработка;
const частичноОплаченный = послеЧастичного.tranches.find((транш) => транш.id === малыйId);
check(
  частичноОплаченный?.status === "CLOSED",
  `частичный платёж сам перевёл транш в ${частичноОплаченный?.status}: отметка отдана арифметике`,
);
check(
  частичноОплаченный?.paid === "300000",
  `оплачено по траншу ${частичноОплаченный?.paid}, записано 300000`,
);
check(
  BigInt(частичноОплаченный?.outstanding ?? "0") === BigInt(частичноОплаченный?.amount ?? "0") - 300000n,
  `непокрытое ${частичноОплаченный?.outstanding} не равно сумме за вычетом оплаченного`,
);

/* Платёж будущим днём отвергается: пишется пришедшее, а не обещанное. */
const завтра = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const будущий = await создать(owner, `/projects/R-99/tranches/${малыйId}/payments`, {
  amount: "100000", paidOn: завтра,
});
check(будущий.status === 400, `платёж будущим днём принят с кодом ${будущий.status}`);

/* Сторно платежа — обратная запись, а не удаление (БП-04). Оплаченное
   уменьшается, обе строки остаются. */
const кСторно = частичноОплаченный?.payments.find((платёж) => платёж.reversalOfId === null);
const сторноБезПричины = await создать(
  owner, `/projects/R-99/tranches/${малыйId}/payments/${кСторно?.id}/reversal`, { reason: "" },
);
check(
  сторноБезПричины.status === 400,
  `сторно платежа без причины принято с кодом ${сторноБезПричины.status}`,
);

const сторноПлатежа = await создать(
  owner, `/projects/R-99/tranches/${малыйId}/payments/${кСторно?.id}/reversal`,
  { reason: "Проверка сторно: платёж отнесён к другому объекту" },
);
check(сторноПлатежа.ok, `сторно платежа не прошло: код ${сторноПлатежа.status}`);
const послеСторноПлатежа = сторноПлатежа.ok ? await сторноПлатежа.json() : послеЧастичного;
const траншПослеСторно = послеСторноПлатежа.tranches.find((транш) => транш.id === малыйId);
check(
  траншПослеСторно?.paid === "0",
  `после сторно оплачено ${траншПослеСторно?.paid}, ожидался ноль`,
);
check(
  траншПослеСторно?.payments.length === 2,
  `после сторно у транша ${траншПослеСторно?.payments.length} записей платежей: пара обязана остаться в истории`,
);
const повторноеСторноПлатежа = await создать(
  owner, `/projects/R-99/tranches/${малыйId}/payments/${кСторно?.id}/reversal`,
  { reason: "Ещё раз" },
);
check(
  повторноеСторноПлатежа.status === 400,
  `платёж сторнирован дважды с кодом ${повторноеСторноПлатежа.status}`,
);

const оплата = await создать(owner, `/projects/R-99/tranches/${малыйId}/settlement`, {});
check(оплата.ok, `транш не оплачен: код ${оплата.status}`);
const послеОплаты = оплата.ok ? await оплата.json() : перевыработка;
check(
  послеОплаты.tranches.find((транш) => транш.id === малыйId)?.status === "PAID",
  "оплаченный транш не перешёл в состояние PAID",
);
/* Отметка без платежей даёт недобор на всю сумму: цена решения от
   19.09.2026, и продукт обязан называть её числом, а не молчать. */
check(
  BigInt(послеОплаты.tranches.find((транш) => транш.id === малыйId)?.outstanding ?? "0") > 0n,
  "отмеченный оплаченным транш без платежей не показывает недобора",
);
const повторнаяОплата = await создать(owner, `/projects/R-99/tranches/${малыйId}/settlement`, {});
check(повторнаяОплата.status === 400, `транш оплачен второй раз с кодом ${повторнаяОплата.status}`);

/* Доплата по оплаченному траншу разрешена: недобор закрывается деньгами, а
   не отменой отметки. */
const доплата = await создать(owner, `/projects/R-99/tranches/${малыйId}/payments`, {
  amount: "100000", paidOn: сегодняДень, comment: "Доплата недобора",
});
check(доплата.ok, `доплата по оплаченному траншу отвергнута с кодом ${доплата.status}`);

/* Стенд возвращается к одному открытому рабочему траншу. */
const рабочий = await создать(owner, "/projects/R-99/tranches", {
  amount: "45000000", comment: "Рабочий транш",
});
check(рабочий.ok, `рабочий транш не восстановлен: код ${рабочий.status}`);
const траншиИтог = рабочий.ok ? await рабочий.json() : послеОплаты;
check(
  траншиИтог.tranches.filter((транш) => транш.status === "OPEN").length === 1,
  "после проверки у объекта не один открытый транш",
);


/* ПРАВКА СМЕТЫ (пункты плана 2.5, 2.6 и 3.9).
 *
 * Блок ставит стенд обратно каждой правкой: смета — не история, и обратная
 * правка здесь законна, в отличие от приёмки, где отмена есть сторно.
 * Сверка в конце подтверждает, что стенд вернулся: итог по работам и
 * надбавка совпадают с теми, что были до блока.
 */
const правка = (path, body) => owner(path, {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

const сметаДо = await owner("/projects/R-99/estimate").then((r) => r.json());
const всеПозиции = сметаДо.sections.flatMap((раздел) =>
  [...раздел.items, ...раздел.children.flatMap((вложенный) => вложенный.items)]);
const свободная = всеПозиции.find((позиция) => BigInt(позиция.qtyAccepted) === 0n);
const сПриёмкой = всеПозиции.find((позиция) => BigInt(позиция.qtyAccepted) > 0n);
check(свободная !== undefined, "в смете нет ни одной позиции без приёмок");
check(сПриёмкой !== undefined, "в смете нет ни одной принятой позиции: правило 3.9 не проверить");

/* Правка количества: итог по работам растёт ровно на цену единицы,
   помноженную на приращение. Сверка с ручным расчётом до копейки. */
const приращение = 1000n;
const послеКоличества = await правка(`/projects/R-99/estimate/items/${свободная?.id}`, {
  qty: (BigInt(свободная?.qty ?? "0") + приращение).toString(),
}).then((r) => r.json());
const ожидаемыйПрирост = (BigInt(свободная?.unitPrice ?? "0") * приращение + 500n) / 1000n;
check(
  BigInt(послеКоличества.totals?.works ?? "0") - BigInt(сметаДо.totals.works) === ожидаемыйПрирост,
  `итог работ вырос на ${(BigInt(послеКоличества.totals?.works ?? "0") - BigInt(сметаДо.totals.works)).toString()}`
    + ` вместо ${ожидаемыйПрирост.toString()}`,
);

/* Главная проверка решения о правке на месте: новая редакция не порождается.
   Прежняя формулировка Р11 создавала бы версию на каждой правке цены. */
check(
  послеКоличества.version === сметаДо.version,
  `правка количества подняла редакцию с ${сметаДо.version} до ${послеКоличества.version}`,
);

await правка(`/projects/R-99/estimate/items/${свободная?.id}`, { qty: свободная?.qty });

/* Правка цены: тот же счёт, но приращение на стороне цены. Редакция снова
   не растёт — это и есть содержание решения. */
const надбавкаЦены = 10_000n;
const послеЦены = await правка(`/projects/R-99/estimate/items/${свободная?.id}`, {
  unitPrice: (BigInt(свободная?.unitPrice ?? "0") + надбавкаЦены).toString(),
}).then((r) => r.json());
const ожидаемоеОтЦены = (надбавкаЦены * BigInt(свободная?.qty ?? "0") + 500n) / 1000n;
check(
  BigInt(послеЦены.totals?.works ?? "0") - BigInt(сметаДо.totals.works) === ожидаемоеОтЦены,
  `правка цены дала прирост ${(BigInt(послеЦены.totals?.works ?? "0") - BigInt(сметаДо.totals.works)).toString()}`
    + ` вместо ${ожидаемоеОтЦены.toString()}`,
);
check(
  послеЦены.version === сметаДо.version,
  `правка цены подняла редакцию с ${сметаДо.version} до ${послеЦены.version}`,
);
await правка(`/projects/R-99/estimate/items/${свободная?.id}`, { unitPrice: свободная?.unitPrice });

/* Правка наименования: позиция найдена по новому имени, затем возвращена. */
const новоеИмя = "Проверка API: наименование";
const послеИмени = await правка(`/projects/R-99/estimate/items/${свободная?.id}`, { name: новоеИмя })
  .then((r) => r.json());
check(
  послеИмени.sections?.flatMap((раздел) =>
    [...раздел.items, ...раздел.children.flatMap((в) => в.items)])
    .some((позиция) => позиция.name === новоеИмя),
  "позиция не переименовалась",
);
await правка(`/projects/R-99/estimate/items/${свободная?.id}`, { name: свободная?.name });

/* Правило 3.9: уменьшить ниже принятого нельзя, ровно до принятого — можно. */
const нижеПринятого = await правка(`/projects/R-99/estimate/items/${сПриёмкой?.id}`, { qty: "1" });
check(нижеПринятого.status === 400, `уменьшение ниже принятого прошло с кодом ${нижеПринятого.status}`);
const текстНиже = нижеПринятого.status === 400 ? (await нижеПринятого.json()).message : "";
check(
  текстНиже.includes("уже принято") && текстНиже.includes("сторнируйте"),
  `отказ на уменьшении не называет принятое и что делать: «${текстНиже}»`,
);

const ровноДоПринятого = await правка(`/projects/R-99/estimate/items/${сПриёмкой?.id}`, {
  qty: сПриёмкой?.qtyAccepted,
});
check(ровноДоПринятого.ok, `уменьшение ровно до принятого отклонено с кодом ${ровноДоПринятого.status}`);
await правка(`/projects/R-99/estimate/items/${сПриёмкой?.id}`, { qty: сПриёмкой?.qty });

/* Отказы на величинах. */
const нольКоличества = await правка(`/projects/R-99/estimate/items/${свободная?.id}`, { qty: "0" });
check(нольКоличества.status === 400, `нулевое количество принято с кодом ${нольКоличества.status}`);
const минусЦена = await правка(`/projects/R-99/estimate/items/${свободная?.id}`, { unitPrice: "-1" });
check(минусЦена.status === 400, `отрицательная цена принята с кодом ${минусЦена.status}`);
const чужаяЕдиница = await правка(`/projects/R-99/estimate/items/${свободная?.id}`, { unit: "погонаж" });
check(чужаяЕдиница.status === 400, `неканоническая единица принята с кодом ${чужаяЕдиница.status}`);
const текстЕдиницы = чужаяЕдиница.status === 400 ? (await чужаяЕдиница.json()).message : "";
check(
  текстЕдиницы.includes("Допустимы"),
  `отказ на единице не перечисляет допустимые: «${текстЕдиницы}»`,
);

/* Пробы отказов восстанавливаются явно, а не полагаются на сам отказ. Иначе
   откат проверяемого правила портит стенд необратимо: количество остаётся
   нулевым, и следующий прогон падает уже не на том, что проверял. Найдено
   первым же откатом этого блока. */
await правка(`/projects/R-99/estimate/items/${свободная?.id}`, {
  qty: свободная?.qty, unitPrice: свободная?.unitPrice, unit: свободная?.unit,
});

/* Надбавка: сопровождение и итог для клиента пересчитываются ровно. */
const надбавкаБыла = сметаДо.totals.supervisionShare;
const послеНадбавки = await правка("/projects/R-99/estimate/supervision", { supervisionShare: 1500 })
  .then((r) => r.json());
const ожидаемоеСопровождение =
  (BigInt(послеНадбавки.totals?.works ?? "0") * 1500n + 5000n) / 10_000n;
check(
  BigInt(послеНадбавки.totals?.supervision ?? "0") === ожидаемоеСопровождение,
  `сопровождение ${послеНадбавки.totals?.supervision} вместо ${ожидаемоеСопровождение.toString()}`,
);
check(
  BigInt(послеНадбавки.totals?.estimate ?? "0")
    === BigInt(послеНадбавки.totals?.works ?? "0") + ожидаемоеСопровождение,
  "итог для клиента не равен итогу работ плюс сопровождение",
);
await правка("/projects/R-99/estimate/supervision", { supervisionShare: надбавкаБыла });

const надбавкаВыше100 = await правка("/projects/R-99/estimate/supervision", { supervisionShare: 10_001 });
check(надбавкаВыше100.status === 400, `надбавка выше 100 % принята с кодом ${надбавкаВыше100.status}`);
const надбавкаМинус = await правка("/projects/R-99/estimate/supervision", { supervisionShare: -1 });
check(надбавкаМинус.status === 400, `отрицательная надбавка принята с кодом ${надбавкаМинус.status}`);

/* Правит руководитель. Прораб не правит ничего и внутренних полей не видит. */
const правкаПрорабом = await foreman(`/projects/R-99/estimate/items/${свободная?.id}`, {
  method: "PATCH", headers: { "content-type": "application/json" },
  body: JSON.stringify({ qty: "1000" }),
});
check(правкаПрорабом.status === 403, `прораб правил позицию с кодом ${правкаПрорабом.status}`);
const надбавкаПрорабом = await foreman("/projects/R-99/estimate/supervision", {
  method: "PATCH", headers: { "content-type": "application/json" },
  body: JSON.stringify({ supervisionShare: 1500 }),
});
check(надбавкаПрорабом.status === 403, `прораб правил надбавку с кодом ${надбавкаПрорабом.status}`);

/* Несуществующая позиция даёт 404, а не 500. Границу «своя редакция своего
   объекта» этим не проверить: на стенде смета одна и редакция одна, а завести
   вторую значило бы импортировать смету ещё раз и оставить объект в другом
   состоянии. Граница стережётся условием запроса; проверка откатом её не
   ловит, и это сказано здесь, а не умолчано. */
const чужойОпознаватель = await правка(
  "/projects/R-99/estimate/items/00000000-0000-4000-8000-000000000000", { qty: "1000" },
);
check(
  чужойОпознаватель.status === 404,
  `чужойОпознаватель позиция принята с кодом ${чужойОпознаватель.status}`,
);

const правкаБезСессии = await fetch(`${BASE}/projects/R-99/estimate/items/${свободная?.id}`, {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ qty: "1000" }),
});
check(правкаБезСессии.status === 401, `правка без сессии прошла с кодом ${правкаБезСессии.status}`);

/* Стенд вернулся: величины совпадают с теми, что были до блока. */
const сметаПосле = await owner("/projects/R-99/estimate").then((r) => r.json());
check(
  сметаПосле.totals.works === сметаДо.totals.works,
  `итог работ после блока ${сметаПосле.totals.works} вместо ${сметаДо.totals.works}`,
);
check(
  сметаПосле.totals.supervisionShare === сметаДо.totals.supervisionShare,
  "надбавка после блока не вернулась к исходной",
);
check(сметаПосле.version === сметаДо.version, "редакция сметы изменилась за блок правки");

/* Блок стоит последним намеренно: он читает журнал и потому обязан идти
   после действий, которые в журнал пишут. На чистом стенде записей сметы до
   блока правки не существует, и проверка, поставленная выше, проходила бы
   только на грязном стенде — то есть не стерегла бы ничего. */
/*
 * Журнал объекта: лента показывает то, что в неё пишут.
 *
 * До этой правки отбор брал три вида записей из одиннадцати — статус
 * объекта, обмер и план, — а правки сметы, графика и траншей писались и не
 * были видны никому. Журнал заводился ради спора «кто поменял величину»;
 * запись, которую нельзя прочитать, спора не решает.
 *
 * Проверяется три утверждения: записи разделов появляются; деньги в них
 * читаются рублями, а не сырыми копейками; записи о деньгах прорабу не
 * приходят — журнальная строка есть обход поля, и разграничение на уровне
 * полей должно держаться и здесь.
 */
/* Спрашивается больше страницы намеренно. Записи восьми видов ложатся в
   одну ленту по времени, и двадцать последних могут не содержать ни одной
   записи графика — она просто старше. Проверка состава, читающая страницу,
   стережёт страницу, а не журнал: она проходила ровно до тех пор, пока
   новый вид записей не вытеснил старый, и падение это назвало.

   Предел взят наибольший, какой отдаёт маршрут, и рядом стоит правило,
   доказывающее, что лента в него не упёрлась. Без этого правила число
   пришлось бы поднимать всякий раз, как журнал подрастёт, — а порог,
   подогнанный под факт, перестаёт быть правилом. Второй раз это случилось
   при заведении помещений у позиций сметы. */
const ПРЕДЕЛ_ЛЕНТЫ = 200;
const лентаРуководителя = await owner(`/projects/R-99/events?limit=${ПРЕДЕЛ_ЛЕНТЫ}`)
  .then((r) => r.json());
check(
  лентаРуководителя.length < ПРЕДЕЛ_ЛЕНТЫ,
  `лента упёрлась в предел ${ПРЕДЕЛ_ЛЕНТЫ}: состав разделов ниже ничего не доказывает`,
);
const разделы = new Set(лентаРуководителя.map((row) => row.title.split(":")[0]));
check(разделы.has("Смета"), `в ленте руководителя нет записей сметы: ${[...разделы].join(", ")}`);
check(разделы.has("График"), `в ленте руководителя нет записей графика: ${[...разделы].join(", ")}`);
check(разделы.has("Чеки"), `в ленте руководителя нет записей чеков: ${[...разделы].join(", ")}`);
check(разделы.has("Транш"), `в ленте руководителя нет записей траншей: ${[...разделы].join(", ")}`);

/* Деньги рублями. Сырые копейки узнаются по числу без разделителя разрядов
   и без запятой: «450000000» против «450 000,00 ₽». */
const денежные = лентаРуководителя.filter((row) =>
  row.title.startsWith("Транш:") || /цена единицы|ставка оплаты труда/u.test(row.title));
check(денежные.length > 0, "в ленте нет ни одной денежной записи: проверять читаемость не на чем");
const сырые = денежные.filter((row) => /\b\d{6,}\b/u.test(row.detail ?? ""));
check(
  сырые.length === 0,
  `в журнале сырые копейки: ${сырые.slice(0, 2).map((row) => row.detail).join(" | ")}`,
);
check(
  денежные.some((row) => (row.detail ?? "").includes("₽")),
  "в денежных записях журнала нет ни одного знака рубля",
);

/* Состояние транша не выдаётся за статус объекта: до правки обе записи
   писались полем `status`, и лента титуловала транш «Статус: OPEN → CLOSED». */
check(
  лентаРуководителя.every((row) => !row.title.startsWith("Статус:") || !/OPEN|CLOSED|PAID/u.test(row.title)),
  "состояние транша показано как статус объекта",
);

const лентаПрораба = await foreman("/projects/R-99/events").then((r) => r.json());
const разделыПрораба = new Set(лентаПрораба.map((row) => row.title.split(":")[0]));
check(
  !разделыПрораба.has("Смета") && !разделыПрораба.has("Транш"),
  `прорабу утекли записи о деньгах: ${[...разделыПрораба].join(", ")}`,
);
check(
  разделыПрораба.has("График"),
  `прораб не видит записей графика, по которым работает: ${[...разделыПрораба].join(", ")}`,
);

/*
 * Воронка заявок и ориентир цены (стадия F).
 *
 * Блок ОСТАВЛЯЕТ СЛЕД: заявка не удаляется по решению заказчика — история
 * не переписывается (БП-04), — и заведённый превращением объект остаётся
 * до следующего наполнения. Стенд возвращает посев, а не проверка; без
 * этой оговорки накопившиеся заявки на грязном стенде примут за дефект.
 */
const доска = await owner("/leads").then((r) => r.json());
check(доска.columns?.length === 4, `колонок воронки ${доска.columns?.length} вместо четырёх`);
check(
  доска.columns?.map((column) => column.label).join("|")
    === "Первичный контакт|Знакомство|Принимают решение|Согласование договора",
  `стадии воронки: ${доска.columns?.map((column) => column.label).join(", ")}`,
);
const заявокНаДоске = доска.columns.reduce((всего, column) => всего + column.leads.length, 0);
check(
  заявокНаДоске === доска.totals.open,
  `на доске ${заявокНаДоске} заявок, а открытых по счётчику ${доска.totals.open}`,
);

/* Воронка — раздел руководителя целиком, включая чтение: прораб заявок не
   касается вовсе, и пустая доска сообщала бы «заявок нет» вместо «это не
   ваш раздел». */
check((await foreman("/leads")).status === 403, "прораб читает воронку заявок");
check(
  (await создать(foreman, "/leads", { name: "Проверка", phone: "+79000000099" })).status === 403,
  "прораб заводит заявки",
);
check((await foreman("/repair-types")).status === 403, "прораб читает справочник тарифов");

/* Ориентир считается доменом. Пересчёт независимый: площадь × тариф,
   отклонение — долей от него, тем же округлением, что вся арифметика. */
const сВилкой = доска.columns.flatMap((column) => column.leads)
  .find((lead) => lead.guideline !== null);
check(сВилкой !== undefined, "ни одна заявка стенда не несёт ориентира");
if (сВилкой !== undefined) {
  const центр = (BigInt(сВилкой.guideline.rate) * BigInt(сВилкой.guideline.area) + 500n) / 1000n;
  const отклонение = (центр * BigInt(сВилкой.guideline.spread) + 5000n) / 10_000n;
  check(
    BigInt(сВилкой.guideline.low) === центр - отклонение
      && BigInt(сВилкой.guideline.high) === центр + отклонение,
    `вилка ${сВилкой.guideline.low}—${сВилкой.guideline.high}, `
    + `пересчёт даёт ${(центр - отклонение).toString()}—${(центр + отклонение).toString()}`,
  );
}

/* Номер выводит сервер и не переиспользует. */
const первая = await создать(owner, "/leads", {
  name: "Проверка API", phone: "+7 900 000-00-98", note: "Заведена проверкой",
}).then((r) => r.json());
const вторая = await создать(owner, "/leads", {
  name: "Проверка API, вторая", phone: "+7 900 000-00-97", note: "Заведена проверкой",
}).then((r) => r.json());
check(
  вторая.number === первая.number + 1,
  `номера заявок ${первая.number} и ${вторая.number}: второй не следует за первым`,
);

/* Снимок тарифа: правка справочника не меняет уже названную вилку. Это и
   есть смысл снимка (БП-03) — правка задним числом изменила бы цену,
   названную заказчику по телефону. */
const типы = await owner("/repair-types").then((r) => r.json());
const тип = типы[0];
check(тип !== undefined, "справочник тарифов пуст");
const сОриентиром = await owner(`/leads/${первая.id}`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ repairTypeId: тип?.id, area: "60000" }),
}).then((r) => r.json());
check(сОриентиром.guideline !== null, "ориентир не посчитался по типу и площади");
const вилкаДоПравки = сОриентиром.guideline?.low;
await owner(`/repair-types/${тип?.id}`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ratePerSqm: (BigInt(тип?.ratePerSqm ?? "0") * 2n).toString() }),
});
const послеПравкиТарифа = await owner("/leads").then((r) => r.json());
const таЖе = послеПравкиТарифа.columns.flatMap((column) => column.leads)
  .find((lead) => lead.id === первая.id);
check(
  таЖе?.guideline?.low === вилкаДоПравки,
  `правка тарифа изменила уже названную вилку: ${вилкаДоПравки} → ${таЖе?.guideline?.low}`,
);
/* Возврат тарифа: справочник — общий для стенда, и удвоенная цена ушла бы
   в слепок демонстрации. */
await owner(`/repair-types/${тип?.id}`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ratePerSqm: тип?.ratePerSqm }),
});

/* Отказ требует причину. */
check(
  (await создать(owner, `/leads/${вторая.id}/loss`, {})).status === 400,
  "отказ принят без причины",
);
const отказана = await создать(owner, `/leads/${вторая.id}/loss`, {
  reason: "Проверка: выбрали другого подрядчика",
}).then((r) => r.json());
check(отказана.outcome === "LOST", `после отказа исход ${отказана.outcome}`);
const открытыеЗаявки = await owner("/leads?open=true").then((r) => r.json());
check(
  !открытыеЗаявки.columns.flatMap((column) => column.leads).some((lead) => lead.id === вторая.id),
  "отказная заявка осталась в списке открытых",
);
const всеЗаявки = await owner("/leads?open=false").then((r) => r.json());
check(
  всеЗаявки.columns.flatMap((column) => column.leads).some((lead) => lead.id === вторая.id),
  "отказная заявка пропала из списка всех: история не переписывается",
);

/* Превращение заводит заказчика и объект одним действием. */
const объектовДо = (await owner("/projects").then((r) => r.json())).length;
const превращена = await создать(owner, `/leads/${первая.id}/conversion`, {
  code: "T-1", address: "Проверочный адрес 1", clientCode: "T-900",
}).then((r) => r.json());
check(превращена.outcome === "WON", `после превращения исход ${превращена.outcome}`);
check(превращена.projectCode === "T-1", `заявка ссылается на ${превращена.projectCode}`);
const объектовПосле = (await owner("/projects").then((r) => r.json())).length;
check(объектовПосле === объектовДо + 1, `объектов ${объектовПосле} вместо ${объектовДо + 1}`);
const заказчики = await owner("/clients").then((r) => r.json());
check(
  заказчики.some((client) => client.code === "T-900"),
  "заказчик из заявки не появился в справочнике",
);

/* Ориентир переехал на объект и стоит рядом с итогом сметы. */
const заведённый = await owner("/projects/T-1").then((r) => r.json());
check(
  заведённый.guideline?.low === сОриентиром.guideline?.low
    && заведённый.guideline?.high === сОриентиром.guideline?.high,
  `вилка на объекте ${заведённый.guideline?.low}—${заведённый.guideline?.high}, `
  + `на заявке ${сОриентиром.guideline?.low}—${сОриентиром.guideline?.high}`,
);
/* Сметы у заведённого объекта нет, и сверять не с чем: `null`, а не ноль.
   Ноль означал бы «сошлось копейка в копейку». */
check(
  заведённый.guideline?.verdict === null,
  `у объекта без сметы сверка со сметой ${JSON.stringify(заведённый.guideline?.verdict)}`,
);

/* Повторное превращение отказывает и называет уже заведённый объект. */
const повторное = await создать(owner, `/leads/${первая.id}/conversion`, {
  code: "T-2", address: "Проверочный адрес 2", clientCode: "T-901",
});
check(повторное.status === 400, `повторное превращение прошло с кодом ${повторное.status}`);

/* Задачи: просрочка считается по дате, а не хранится признаком. */
const вчера = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const сЗадачей = await создать(owner, `/leads/${вторая.id}/tasks`, {
  title: "Проверка просрочки", dueOn: вчера,
}).then((r) => r.json());
const задача = сЗадачей.tasks?.find((task) => task.title === "Проверка просрочки");
check(задача?.state === "просрочена", `задача со вчерашним сроком в состоянии «${задача?.state}»`);
const выполненная = await owner(`/leads/${вторая.id}/tasks/${задача?.id}`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ done: true }),
}).then((r) => r.json());
check(
  выполненная.tasks?.find((task) => task.id === задача?.id)?.state === "выполнена",
  "отметка выполнения не сняла просрочку",
);

/* Журнал заявки читается: записи писались с первого дня, но читать их было
   негде — ровно тот же дефект, что был у журнала объекта. */
const журналЗаявки = await owner(`/leads/${первая.id}/events`).then((r) => r.json());
check(журналЗаявки.length > 0, "журнал заявки пуст: правки в него не пишутся или не читаются");
const виды = new Set(журналЗаявки.map((событие) => событие.title));
check(
  [...виды].some((title) => title.includes("ориентир")),
  `в журнале заявки нет записи об ориентире: ${[...виды].join(", ")}`,
);
check(
  [...виды].some((title) => title.includes("превращена в объект")),
  `в журнале заявки нет записи о превращении: ${[...виды].join(", ")}`,
);
/* Деньги в журнале — рублями, а не сырыми копейками: журнал читает человек,
   и «6120000» читается как рубли и врёт в сто раз. */
const проОриентире = журналЗаявки.find((событие) => событие.title.includes("ориентир"));
check(
  /₽/u.test(проОриентире?.detail ?? ""),
  `запись об ориентире без рублей: «${проОриентире?.detail ?? ""}»`,
);
check((await foreman(`/leads/${первая.id}/events`)).status === 403, "прораб читает журнал заявки");

/* Воронка на первом экране. Счётчики стадий сходятся с доской, просроченные
   задачи считаются по дате тем же доменом. */
const сводкаСВоронкой = await owner("/summary").then((r) => r.json());
check(сводкаСВоронкой.leads !== undefined, "в сводке руководителя нет воронки");
check(
  сводкаСВоронкой.leads?.stages?.length === 4,
  `в сводке ${сводкаСВоронкой.leads?.stages?.length} стадий вместо четырёх`,
);
const открытыхВСводке = сводкаСВоронкой.leads?.stages
  ?.reduce((всего, стадия) => всего + стадия.count, 0);
check(
  открытыхВСводке === сводкаСВоронкой.leads?.open,
  `по стадиям ${открытыхВСводке} заявок, а открытых ${сводкаСВоронкой.leads?.open}`,
);
const доскаДляСводки = await owner("/leads?open=true").then((r) => r.json());
check(
  сводкаСВоронкой.leads?.open === доскаДляСводки.totals.open,
  `сводка насчитала ${сводкаСВоронкой.leads?.open} открытых, доска ${доскаДляСводки.totals.open}`,
);
check(
  сводкаСВоронкой.leads?.overdueTasks >= 1,
  `просроченных задач в сводке ${сводкаСВоронкой.leads?.overdueTasks}: на стенде их не меньше одной`,
);
/* Прорабу воронка не приходит вовсе — не пустыми счётчиками: пустая доска
   сообщала бы «заявок нет» вместо «это не ваш контур». */
const сводкаПрораба = await foreman("/summary").then((r) => r.json());
check(
  сводкаПрораба.leads === undefined,
  "прорабу в сводку пришла воронка заявок",
);

/* Внутренних величин в воронке нет ни одной: закрывать нечего, закрыт весь
   раздел. Проверка остаётся, чтобы они туда не приехали позже. */
check(
  findInternal(доска).length === 0,
  `в воронке внутренние поля: ${findInternal(доска).join(", ")}`,
);

/*
 * Заявленное не называется принятым.
 *
 * Карточка объекта печатала заявленную готовность графика под словом
 * «принято»: 85,57 % там, где по приёмке принято меньше процента. Слово
 * «принято» в этом продукте закреплено за приёмкой — единственным
 * источником факта выполнения (БП-01), — и отдавать его величине, которую
 * поставил человек, значит обесценить его везде.
 *
 * Проверяется, что величины две, что они считаются по-разному и что
 * принятое сходится с независимым пересчётом из вида приёмки.
 */
const карточкаR99 = await owner("/projects/R-99").then((r) => r.json());
const видДляДоли = await owner("/projects/R-99/acceptance").then((r) => r.json());
const сметаДляДоли = await owner("/projects/R-99/estimate").then((r) => r.json());

check(
  карточкаR99.acceptedShare !== undefined && карточкаR99.readiness !== undefined,
  "у карточки нет одной из двух величин готовности",
);
check(
  карточкаR99.accepted === видДляДоли.totals.accepted,
  `карточка: выполнено ${карточкаR99.accepted}, вид приёмки ${видДляДоли.totals.accepted}`,
);
check(
  карточкаR99.acceptedPositions === видДляДоли.totals.acceptedPositions,
  `карточка: принятых позиций ${карточкаR99.acceptedPositions}, `
  + `вид приёмки ${видДляДоли.totals.acceptedPositions}`,
);
/* Пересчёт независимый: доля считается здесь из двух чисел вида приёмки и
   сметы, а не сверяется поле с самим собой. Округление — до ближайшего,
   половина вверх, тем же правилом, что у всей арифметики денег. */
const ожидаемаяДоля = Number(
  (BigInt(видДляДоли.totals.accepted) * 10_000n * 2n / BigInt(сметаДляДоли.totals.works) + 1n) / 2n,
);
check(
  карточкаR99.acceptedShare === ожидаемаяДоля,
  `карточка обещает принятыми ${карточкаR99.acceptedShare} сотых процента, `
  + `пересчёт по виду приёмки даёт ${ожидаемаяДоля}`,
);
check(
  карточкаR99.acceptedShare !== карточкаR99.readiness,
  `принятое и заявленное совпали (${карточкаR99.acceptedShare}): `
  + "на стенде они расходятся, и совпадение означает, что показывается одно число дважды",
);
check(
  карточкаR99.readiness > карточкаR99.acceptedShare,
  `заявлено ${карточкаR99.readiness}, принято ${карточкаR99.acceptedShare}: `
  + "на стенде заявленное опережает приёмку, и обратное означает подмену величин",
);

/* Объект без сметы: принятого нет, и это `null`, а не ноль. */
const безСметыКарточка = await owner("/projects/R-19").then((r) => r.json());
check(
  безСметыКарточка.acceptedShare === null,
  `объекту без сметы карточка обещает принятыми ${безСметыКарточка.acceptedShare} сотых процента`,
);
check(
  безСметыКарточка.accepted === null,
  "объекту без сметы карточка называет выполненную сумму",
);

/* Та же пара в реестре: список и карточка обязаны отдавать одно и то же —
   разойдясь, они дали бы два ответа на один вопрос. */
const реестр = await owner("/projects").then((r) => r.json());
const строкаR99 = реестр.find((project) => project.code === "R-99");
check(
  строкаR99?.acceptedShare === карточкаR99.acceptedShare,
  `реестр обещает принятыми ${строкаR99?.acceptedShare}, карточка ${карточкаR99.acceptedShare}`,
);

/*
 * Повторный импорт называет, что он уносит.
 *
 * Приёмка привязана к своей редакции (Р11): после записи новой редакции
 * принятое по прежней остаётся в базе и в счёте транша, но из вида приёмки
 * уходит. Лист подтверждения обязан назвать это числом до нажатия.
 *
 * Проверяются два утверждения: предпросмотр считает то же, что показывает
 * вид приёмки (два независимых свода одного и того же), и предсказанное
 * последствие действительно наступает — после импорта принятых ноль, а
 * остаток транша прежний.
 *
 * Блок стоит последним и **оставляет стенд с новой редакцией**: импорт
 * необратим по смыслу, и «вернуть как было» здесь нечем — приёмки прежней
 * редакции обратно в вид не возвращаются ни одним действием продукта.
 */
const файлСметы = readFileSync("packages/importer/fixtures/smeta-obezlichennaya.xlsx");
const предпросмотр = await owner("/projects/R-99/estimate/preview", {
  method: "POST",
  body: (() => { const form = new FormData(); form.append("file", new Blob([файлСметы]), "smeta.xlsx"); return form; })(),
}).then((r) => r.json());

const видДоИмпорта = await owner("/projects/R-99/acceptance").then((r) => r.json());
const отчётДоИмпорта = await owner("/projects/R-99/acceptance/report").then((r) => r.json());
check(предпросмотр.displaced !== null, "предпросмотр не сказал, что уйдёт при записи новой редакции");
check(
  предпросмотр.displaced?.acceptedPositions === видДоИмпорта.totals.acceptedPositions,
  `предпросмотр обещает унести ${предпросмотр.displaced?.acceptedPositions} позиций, `
  + `а в виде приёмки принято ${видДоИмпорта.totals.acceptedPositions}`,
);
check(
  предпросмотр.displaced?.accepted === видДоИмпорта.totals.accepted,
  `предпросмотр обещает унести ${предпросмотр.displaced?.accepted} копеек, `
  + `а в виде приёмки выполнено ${видДоИмпорта.totals.accepted}`,
);
check(
  предпросмотр.displaced?.acceptedPositions > 0,
  "на стенде нечего уносить: проверять предупреждение не на чем",
);

/* Объект без сметы терять нечего — и лист об этом молчит. */
const безСметы = await owner("/projects/R-19/estimate/preview", {
  method: "POST",
  body: (() => { const form = new FormData(); form.append("file", new Blob([файлСметы]), "smeta.xlsx"); return form; })(),
}).then((r) => r.json());
check(безСметы.displaced === null, "объекту без сметы предпросмотр обещает что-то унести");

/* Последствие наступает: вид приёмки обнуляется, счёт транша — нет. */
const траншиДоИмпорта = await owner("/projects/R-99/tranches").then((r) => r.json());
/* Решения по написаниям единиц передаются те же, что предложил разбор:
   проверка наполняет стенд, а не решает за руководителя. Без них импорт
   отказывает — и правильно делает. */
const решенияЕдиниц = Object.fromEntries(
  предпросмотр.report.unitDecisions.map((decision) => [decision.raw, decision.suggestion]),
);
const записан = await owner("/projects/R-99/estimate/import", {
  method: "POST",
  body: (() => {
    const form = new FormData();
    form.append("file", new Blob([файлСметы]), "smeta.xlsx");
    form.append("units", JSON.stringify(решенияЕдиниц));
    return form;
  })(),
});
check(записан.ok, `повторный импорт не прошёл: код ${записан.status}`);
const видПослеИмпорта = await owner("/projects/R-99/acceptance").then((r) => r.json());
check(
  видПослеИмпорта.totals.acceptedPositions === 0,
  `после импорта в виде приёмки ${видПослеИмпорта.totals.acceptedPositions} принятых позиций вместо нуля: `
  + "предупреждение листа обещает иное",
);
/* Второй предпросмотр — уже поверх новой редакции. Уносить нечего: приёмки
   остались у прежней редакции и из вида ушли однажды. Это и отличает счёт
   «по действующей редакции» от счёта «все приёмки объекта»: на объекте с
   одной редакцией они совпадают, и без этой проверки подмена одного другим
   осталась бы незамеченной. */
const послеПовтора = await owner("/projects/R-99/estimate/preview", {
  method: "POST",
  body: (() => { const form = new FormData(); form.append("file", new Blob([файлСметы]), "smeta.xlsx"); return form; })(),
}).then((r) => r.json());
check(
  послеПовтора.displaced?.acceptedPositions === 0,
  `поверх новой редакции предпросмотр обещает унести ${послеПовтора.displaced?.acceptedPositions} позиций: `
  + "приёмки прежней редакции из вида ушли уже и второй раз не уходят",
);

/* Отчёт новую редакцию не замечает — и в этом вся его суть.
   Вид приёмки только что обнулился, а отчёт обязан показывать ровно
   столько же приёмок, сколько до импорта: снимок сделан, работа была, и
   правка сметы этого не отменяет. Проверка стоит здесь, потому что нового
   издания сметы больше нигде на стенде нет, а без него отчёт и вид
   приёмки совпадают и подмену одного другим не разглядеть. */
const отчётПослеИмпорта = await owner("/projects/R-99/acceptance/report").then((r) => r.json());
check(
  отчётПослеИмпорта.totals.batches === отчётДоИмпорта.totals.batches,
  `повторный импорт унёс из отчёта приёмки: было ${отчётДоИмпорта.totals.batches}, стало `
  + `${отчётПослеИмпорта.totals.batches}; отчёт отвечает на вопрос «что сделано на объекте»`,
);
check(
  отчётПослеИмпорта.totals.photos === отчётДоИмпорта.totals.photos,
  `повторный импорт унёс из отчёта снимки: было ${отчётДоИмпорта.totals.photos}, стало `
  + `${отчётПослеИмпорта.totals.photos}`,
);
check(
  отчётПослеИмпорта.totals.batches > видПослеИмпорта.batches.length,
  "после нового издания сметы отчёт показывает не больше приёмок, чем вкладка приёмки: "
  + "либо отбор по редакции попал в отчёт, либо стенд не даёт это различить",
);

const траншиПослеИмпорта = await owner("/projects/R-99/tranches").then((r) => r.json());
check(
  траншиПослеИмпорта.current?.remainder === траншиДоИмпорта.current?.remainder,
  `остаток транша изменился импортом: ${траншиДоИмпорта.current?.remainder} → ${траншиПослеИмпорта.current?.remainder}; `
  + "лист обещает, что в счёте транша принятое останется",
);

/*
 * Стенд возвращается не в прежнее состояние, а в прежнее свойство: у
 * действующей редакции снова есть принятые позиции.
 *
 * Приёмки прежней редакции обратно не переносятся ни одним действием
 * продукта — и не должны (Р11). Но обход страницы идёт по тому же стенду
 * и проверяет на нём два правила, которым принятое в действующей редакции
 * необходимо: отказ правки сметы ниже принятого (3.9) и строку листа
 * импорта об уходящих позициях. Без этого шага обе молча перестали бы
 * что-либо стеречь — проверка, которой нечего проверять, проходит всегда.
 */
const видДляВозврата = await owner("/projects/R-99/acceptance").then((r) => r.json());
const разделВозврата = видДляВозврата.sections.find((section) =>
  section.stage?.brigade != null
  && section.positions.some((position) => BigInt(position.remaining) >= 2n));
const позицияВозврата = разделВозврата?.positions
  .find((position) => BigInt(position.remaining) >= 2n);
check(
  позицияВозврата !== undefined,
  "после повторного импорта нечем вернуть стенд: нет раздела с бригадой и остатком",
);
const возврат = await foreman("/projects/R-99/acceptance", {
  method: "POST",
  body: пакет({
    sectionId: разделВозврата?.id,
    comment: "Возврат стенда после повторного импорта",
    positions: [{
      itemId: позицияВозврата?.id,
      qty: (BigInt(позицияВозврата?.remaining ?? "0") / 2n).toString(),
    }],
  }),
});
check(возврат.ok, `возврат стенда не прошёл: код ${возврат.status}`);
const видВозврата = возврат.ok ? await возврат.json() : видДляВозврата;
check(
  видВозврата.totals.acceptedPositions > 0,
  "в действующей редакции не осталось принятых позиций: обход страницы проверит не то",
);

/*
 * БУХГАЛТЕРИЯ: деньги заказчиков по портфелю.
 *
 * Раздел собирается из траншей, и проверяется не то, что маршрут отвечает
 * 200, а то, что свод сходится с независимым пересчётом по тем же траншам,
 * взятым с карточек объектов. Свод, сверенный сам с собой, не проверяет
 * ничего.
 *
 * Блок стоит последним и стенда не меняет: он только читает.
 */
const бухгалтерия = await owner("/accounting").then((r) => r.json());
check(бухгалтерия.rows.length > 0, "в бухгалтерии нет ни одного транша");

/* Независимый пересчёт: те же транши, но взятые по объектам. */
const всеОбъекты = await owner("/projects").then((r) => r.json());
const своиТранши = [];
for (const project of всеОбъекты) {
  const вид = await owner(`/projects/${project.code}/tranches`).then((r) => r.json());
  for (const транш of вид.tranches) своиТранши.push({ code: project.code, транш });
}
check(
  бухгалтерия.rows.length === своиТранши.length,
  `в бухгалтерии ${бухгалтерия.rows.length} траншей, по карточкам объектов ${своиТранши.length}`,
);

const сумма = (предикат, поле = "amount") => своиТранши
  .filter(({ транш }) => предикат(транш))
  .reduce((итог, { транш }) => итог + BigInt(транш[поле]), 0n);

/* Полученное складывается из двух частей, и это прямое следствие решения от
   19.09.2026 «оплаченным транш называет руководитель»: у оплаченного в
   получено идёт вся сумма транша, у закрытого — только пришедшие платежи. */
const оплаченоПоКарточкам = сумма((т) => т.status === "PAID")
  + сумма((т) => т.status === "CLOSED", "paid");
check(
  BigInt(бухгалтерия.totals.paid) === оплаченоПоКарточкам,
  `оплачено в своде ${бухгалтерия.totals.paid}, по карточкам ${оплаченоПоКарточкам}`,
);
const ждётПоКарточкам = сумма((т) => т.status === "CLOSED", "outstanding");
check(
  BigInt(бухгалтерия.totals.awaiting) === ждётПоКарточкам,
  `ждёт оплаты в своде ${бухгалтерия.totals.awaiting}, по карточкам ${ждётПоКарточкам}`,
);
check(
  BigInt(бухгалтерия.totals.inWork) === сумма((т) => т.status === "OPEN"),
  `в работе по своду ${бухгалтерия.totals.inWork}, по карточкам ${сумма((т) => т.status === "OPEN")}`,
);

/* Инвариант раздела: сумма трёх слагаемых равна предъявленному. Он держался
   и до платежей, но тогда держался сам собой — каждый транш целиком уходил в
   одно слагаемое. С частичной оплатой он стал утверждением, которое можно
   нарушить, и потому проверяется. */
const предъявлено = сумма(() => true);
const слагаемые = BigInt(бухгалтерия.totals.inWork)
  + BigInt(бухгалтерия.totals.awaiting) + BigInt(бухгалтерия.totals.paid);
check(
  слагаемые === предъявлено,
  `три слагаемых дают ${слагаемые}, предъявлено по карточкам ${предъявлено}`,
);

/* Недобор — часть полученного, не подтверждённая платежами. Цена решения
   от 19.09.2026, названная числом: без неё «получено» завышено ровно на эту
   величину и выглядит верным. */
const недоборПоКарточкам = сумма((т) => т.status === "PAID", "outstanding");
check(
  BigInt(бухгалтерия.totals.shortfall) === недоборПоКарточкам,
  `недобор в своде ${бухгалтерия.totals.shortfall}, по карточкам ${недоборПоКарточкам}`,
);
check(
  BigInt(бухгалтерия.totals.shortfall) > 0n,
  "на стенде нет транша с недобором: расхождение отметки с платежами не подтверждено живым ответом",
);
/* Просроченное входит в ожидающее, а не стоит слагаемым сверх него: иначе
   человек сложил бы одни и те же деньги дважды. */
check(
  BigInt(бухгалтерия.totals.overdue) <= BigInt(бухгалтерия.totals.awaiting),
  `просроченного ${бухгалтерия.totals.overdue} больше, чем ожидающего ${бухгалтерия.totals.awaiting}`,
);

/* Открытый транш деньгами к получению не считается: по нему идёт
   выработка, и сумма к оплате ещё не определена. */
check(
  бухгалтерия.rows.every((row) => row.state !== "в работе" || row.awaitingDays === null),
  "у транша в работе считается ожидание оплаты",
);
check(
  бухгалтерия.rows.every((row) => row.state !== "оплачено" || !row.overdue),
  "оплаченный транш помечен просроченным",
);

/* Свод по заказчикам сходится с ведомостью: две суммы одних денег обязаны
   совпасть до копейки. */
const поЗаказчикам = бухгалтерия.clients.reduce(
  (итог, client) => итог + BigInt(client.awaiting) + BigInt(client.paid), 0n,
);
/* Сумма по заказчику складывается из ожидания и полученного, и у закрытого
   транша это непокрытое плюс пришедшее — то есть вся его сумма. Равенство
   держится и при частичной оплате, и проверяется именно поэтому: оно
   перестало быть тождеством и стало утверждением. */
const поВедомости = бухгалтерия.rows
  .filter((row) => row.state !== "в работе")
  .reduce((итог, row) => итог + BigInt(row.amount), 0n);
check(
  поЗаказчикам === поВедомости,
  `свод по заказчикам ${поЗаказчикам}, ведомость ${поВедомости}`,
);

/*
 * Свойства самого стенда, без которых проверки выше проверяют одну шестую
 * себя. Раздел портфельный, и деньги одного объекта в трёх одинаковых
 * состояниях сверяются с собой безошибочно при любой ошибке в отборе.
 * Ровно так и было до 11.09.2026: транши стояли только на R-99, живого
 * просроченного транша стенд не знал, и порог семи дней держался одними
 * тестами домена.
 */
const состояния = new Set(бухгалтерия.rows.map((row) => row.state));
check(состояния.size === 4, `на стенде ${состояния.size} состояний денег из четырёх: ${[...состояния].join(", ")}`);
const объектыДенег = new Set(бухгалтерия.rows.map((row) => row.projectCode));
check(
  объектыДенег.size >= 3,
  `деньги стенда собраны на ${объектыДенег.size} объектах: портфельный раздел проверяется не портфелем`,
);
check(бухгалтерия.clients.length >= 2, `в своде ${бухгалтерия.clients.length} заказчиков: свод по одному заказчику равен ведомости тождественно`);

/* Порог просрочки на живом ответе: строго после порога, а не в день
   порога. Внутри порога ждущий транш просроченным не зовётся. */
const ждущие = бухгалтерия.rows.filter(
  (row) => row.state === "ждёт оплаты" || row.state === "оплачен частично",
);
check(ждущие.some((row) => row.overdue), "на стенде нет просроченного транша: порог оплаты не подтверждён живым ответом");
check(ждущие.some((row) => !row.overdue), "на стенде нет ждущего транша внутри порога: граница порога не подтверждена");
/* Порог берётся у самой строки, а не из свода: с 19.09.2026 он назначается
   договором с конкретным заказчиком, и единого порога по компании больше нет
   (ответ на вопрос 5 квиза). Сверка со сводным порогом проверяла бы умолчание
   вместо правила. */
for (const row of ждущие) {
  const заПорогом = (row.awaitingDays ?? 0) > row.graceDays;
  const погашен = BigInt(row.outstanding) <= 0n;
  check(
    row.overdue === (заПорогом && !погашен),
    `транш ${row.projectCode} № ${row.number}: ждёт ${row.awaitingDays} дней при пороге `
    + `${row.graceDays}, непокрыто ${row.outstanding}, помечен просроченным — ${row.overdue}`,
  );
}
const просроченные = ждущие.filter((row) => row.overdue)
  .reduce((итог, row) => итог + BigInt(row.outstanding), 0n);
check(
  BigInt(бухгалтерия.totals.overdue) === просроченные,
  `просрочено в своде ${бухгалтерия.totals.overdue}, по ведомости ${просроченные}`,
);

/* Договорный порог обязан стоять на стенде живым: без него всё правило
   сводится к умолчанию, а проверка выше сверяет семь дней с семью днями.
   Нужны оба случая — и порог договора, и умолчание, — иначе одно из двух
   чтений поля остаётся непроверенным. */
check(
  бухгалтерия.rows.some((row) => row.graceByContract),
  "на стенде нет заказчика с порогом по договору: поле порога не подтверждено живым ответом",
);
check(
  бухгалтерия.rows.some((row) => !row.graceByContract),
  "на стенде нет заказчика с порогом по умолчанию: умолчание не подтверждено живым ответом",
);
/* Главный случай поля: транш, который по умолчанию компании был бы
   просрочен, а по договору — нет. Без него порог мог бы приходить в ответе
   и ни на что не влиять. */
check(
  бухгалтерия.rows.some((row) => row.graceByContract
    && (row.awaitingDays ?? 0) > бухгалтерия.totals.graceDays
    && !row.overdue),
  "на стенде нет транша, спасённого договорным порогом: поле приходит, но ни на что не влияет",
);

/* Прорабу раздел закрыт целиком отказом, а не пустым списком: пустой
   раздел сообщал бы «денег нет» вместо «это не ваш контур». */
const бухгалтерияПрораба = await foreman("/accounting");
check(
  бухгалтерияПрораба.status === 403,
  `прорабу бухгалтерия отдана с кодом ${бухгалтерияПрораба.status}`,
);
const бухгалтерияБезСессии = await fetch(`${BASE}/accounting`);
check(
  бухгалтерияБезСессии.status === 401,
  `бухгалтерия отдана без сессии с кодом ${бухгалтерияБезСессии.status}`,
);

/*
 * ОБЛОЖКА ОБЪЕКТА — производное поле сводки.
 *
 * Блок стоит после всех приёмок намеренно: к этому месту на R-99 заведено
 * несколько пакетов со снимками, и «последний» выбирается из многих. Стой
 * он раньше, снимок был бы один, и выбор прошёл бы при любом порядке.
 *
 * Ожидаемый снимок считается не по сводке, а по фотоотчёту: другой маршрут,
 * другой запрос к базе, другой сбор. Сверять сводку с самой собой значило бы
 * проверять, что поле равно себе.
 */
const объектыОбложек = await owner("/projects").then((r) => r.json());
let сОбложкой = 0;
let безСнимков = 0;
for (const project of объектыОбложек) {
  const отчётОбложки = await owner(`/projects/${project.code}/acceptance/report`).then((r) => r.json());
  /* Тот же порядок, что и на сервере: дата пакета, при равенстве —
     опознаватель снимка. Без второго ключа сверка сама зависела бы от того,
     в каком порядке база выдала строки. */
  const снимкиОбъекта = отчётОбложки.days
    .flatMap((день) => день.batches)
    .flatMap((пакет) => пакет.photos.map((photoId) => ({ at: пакет.at, photoId })))
    .sort((левый, правый) =>
      правый.at.localeCompare(левый.at) || правый.photoId.localeCompare(левый.photoId));

  if (снимкиОбъекта.length === 0) {
    безСнимков += 1;
    /* Строго `null`, а не «пусто»: `undefined` означал бы, что поля в ответе
       нет вовсе, и читатель ответа отличить одно от другого не сможет. */
    check(
      project.cover === null,
      `объект ${project.code} снимков не имеет, а обложка в сводке — ${JSON.stringify(project.cover ?? null)}`
      + `${project.cover === undefined ? " (поля нет в ответе)" : ""}`,
    );
    continue;
  }

  сОбложкой += 1;
  check(
    project.cover?.photoId === снимкиОбъекта[0].photoId,
    `обложка ${project.code}: в сводке ${project.cover?.photoId ?? "пусто"}, `
    + `последний снимок отчёта — ${снимкиОбъекта[0].photoId} из ${снимкиОбъекта.length}`,
  );
  /* Опознаватель обязан открываться тем маршрутом, которым его берёт экран:
     обложка, которую нечем показать, ничем не лучше отсутствующей. */
  if (typeof project.cover?.photoId === "string") {
    const файлОбложки = await owner(`/projects/${project.code}/acceptance/photo/${project.cover.photoId}`);
    check(
      файлОбложки.status === 200,
      `обложка ${project.code} не выдаётся маршрутом снимка: код ${файлОбложки.status}`,
    );
  }
}
/* Свойства стенда: без объекта со снимками проверка сводится к «везде
   пусто», без объекта без снимков — пустая обложка не проверена вовсе. */
check(сОбложкой > 0, "на стенде нет объекта со снимками: обложка проверена одними пустотами");
check(безСнимков > 0, "на стенде нет объекта без снимков: пустая обложка не проверена");

/* Карточка обязана дать ту же обложку, что и список: собирается она вторым
   вызовом, и разойдясь, плитка портфеля и карточка одного объекта показали
   бы разные снимки. */
const обложкаСписка = объектыОбложек.find((project) => project.code === "R-99")?.cover?.photoId;
const обложкаКарточки = (await owner("/projects/R-99").then((r) => r.json())).cover?.photoId;
check(
  обложкаКарточки === обложкаСписка,
  `обложка R-99: в списке ${обложкаСписка ?? "пусто"}, в карточке ${обложкаКарточки ?? "пусто"}`,
);

console.log(`Позиций в ответе: ${foremanEstimate.positions}, разделов ${foremanEstimate.sectionsTopLevel} + ${foremanEstimate.sectionsNested}`);
console.log(`Внутренних полей у руководителя: ${findInternal(ownerEstimate).length}, у прораба: ${leaks.length}`);
console.log(`Сводка: объектов у руководителя ${ownerSummary.projects.total}, у прораба ${foremanSummary.projects.total};`,
  `заказчиков ${ownerClients.length} и ${foremanClients.length}`);
console.log(`Обмер R-99: ${measure.rooms.length} помещений, площадь ${measure.totals.floorArea},`,
  `стены ${measure.totals.wallArea}, объём ${measure.totals.volume} тысячных`);
console.log(`График R-99: ${R99строка?.stages?.length} этапов, готовность ${R99строка?.readiness} сотых процента;`,
  `объектов без графика ${списокОбъектов.filter((project) => project.stages.length === 0).length}`);
console.log(`Приёмка R-99: ${доПриёмки.sections.length} разделов, ${сЭтапом.length} с этапом;`,
  `принято ${послеСторно.totals.acceptedPositions} позиций, начислено ${послеСторно.totals.accrued} копеек;`,
  `пакетов ${послеСторно.batches.length}`);
console.log(`Смета R-99: редакция ${сметаПосле.version}, итог работ ${сметаПосле.totals.works} копеек,`
  + ` надбавка ${сметаПосле.totals.supervisionShare} сотых процента; правок откачено`);
console.log(`Транши R-99: ${траншиИтог.tranches.length} всего, открытых `
  + `${траншиИтог.tranches.filter((транш) => транш.status === "OPEN").length};`
  + ` остаток текущего ${траншиИтог.current?.remainder} копеек, заполнение ${траншиИтог.current?.fill}`);
console.log(`Обложки: со снимками ${сОбложкой} объектов, без снимков ${безСнимков};`
  + ` у R-99 ${объектыОбложек.find((project) => project.code === "R-99")?.cover?.photoId ?? "пусто"}`);
console.log(problems.length === 0 ? "\nРазграничение на уровне полей: замечаний нет" : "\nЗамечания:\n  " + problems.join("\n  "));
process.exit(problems.length === 0 ? 0 : 1);
