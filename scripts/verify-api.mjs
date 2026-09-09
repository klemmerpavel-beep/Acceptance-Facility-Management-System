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

const снят = await этап(owner, `/projects/R-99/stages/${новый?.id}`, "DELETE");
check(снят.ok, `этап не снят: код ${снят.status}`);
const послеСнятия = снят.ok ? await снят.json() : [];
check(послеСнятия.length === 7, `после снятия этапов ${послеСнятия.length} вместо семи`);
check(
  послеСнятия.every((row) => row.name !== проба),
  "снятый этап остался в списке",
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

const оплатаОткрытого = await создать(owner, `/projects/R-99/tranches/${малыйId}/payment`, {});
check(оплатаОткрытого.status === 400, `открытый транш оплачен с кодом ${оплатаОткрытого.status}`);

await создать(owner, `/projects/R-99/tranches/${малыйId}/closure`, {});
const оплата = await создать(owner, `/projects/R-99/tranches/${малыйId}/payment`, {});
check(оплата.ok, `транш не оплачен: код ${оплата.status}`);
const послеОплаты = оплата.ok ? await оплата.json() : перевыработка;
check(
  послеОплаты.tranches.find((транш) => транш.id === малыйId)?.status === "PAID",
  "оплаченный транш не перешёл в состояние PAID",
);
const повторнаяОплата = await создать(owner, `/projects/R-99/tranches/${малыйId}/payment`, {});
check(повторнаяОплата.status === 400, `транш оплачен второй раз с кодом ${повторнаяОплата.status}`);

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
console.log(`Транши R-99: ${траншиИтог.tranches.length} всего, открытых `
  + `${траншиИтог.tranches.filter((транш) => транш.status === "OPEN").length};`
  + ` остаток текущего ${траншиИтог.current?.remainder} копеек, заполнение ${траншиИтог.current?.fill}`);
console.log(problems.length === 0 ? "\nРазграничение на уровне полей: замечаний нет" : "\nЗамечания:\n  " + problems.join("\n  "));
process.exit(problems.length === 0 ? 0 : 1);
