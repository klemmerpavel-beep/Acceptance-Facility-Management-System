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

const anonymousMeasure = await fetch(`${BASE}/projects/R-99/measure`);
check(anonymousMeasure.status === 401, `обмер отдан без сессии с кодом ${anonymousMeasure.status}`);

const anonymous = await fetch(`${BASE}/projects/R-99/estimate`);
check(anonymous.status === 401, `смета отдана без сессии с кодом ${anonymous.status}`);

console.log(`Позиций в ответе: ${foremanEstimate.positions}, разделов ${foremanEstimate.sectionsTopLevel} + ${foremanEstimate.sectionsNested}`);
console.log(`Внутренних полей у руководителя: ${findInternal(ownerEstimate).length}, у прораба: ${leaks.length}`);
console.log(`Сводка: объектов у руководителя ${ownerSummary.projects.total}, у прораба ${foremanSummary.projects.total};`,
  `заказчиков ${ownerClients.length} и ${foremanClients.length}`);
console.log(`Обмер R-99: ${measure.rooms.length} помещений, площадь ${measure.totals.floorArea},`,
  `стены ${measure.totals.wallArea}, объём ${measure.totals.volume} тысячных`);
console.log(`График R-99: ${R99строка?.stages?.length} этапов, готовность ${R99строка?.readiness} сотых процента;`,
  `объектов без графика ${списокОбъектов.filter((project) => project.stages.length === 0).length}`);
console.log(problems.length === 0 ? "\nРазграничение на уровне полей: замечаний нет" : "\nЗамечания:\n  " + problems.join("\n  "));
process.exit(problems.length === 0 ? 0 : 1);
