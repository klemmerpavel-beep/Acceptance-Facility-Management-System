/**
 * Загрузка обезличенной сметы на стенд через API.
 *
 * Смета попадает в базу тем же путём, что и у пользователя: разбор,
 * сопоставление написаний единиц, импорт. Прямой записи в таблицы нет —
 * иначе стенд наполнялся бы данными, которые продукт получить не может.
 */
import { readFileSync } from "node:fs";

const BASE = process.env.API ?? "http://127.0.0.1:3000";
const CODE = process.env.CODE ?? "R-99";
const FILE = process.env.FIXTURE
  ?? new URL("../packages/importer/fixtures/smeta-obezlichennaya.xlsx", import.meta.url).pathname;

const link = await fetch(`${BASE}/auth/magic-link`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: process.env.EMAIL ?? "owner@dolgiy.studio" }),
}).then((response) => response.json());

const consumed = await fetch(`${BASE}/auth/consume?token=${link.token}`, { redirect: "manual" });
const cookie = consumed.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");

const body = () => {
  const form = new FormData();
  form.append("file", new Blob([readFileSync(FILE)]), FILE.split("/").pop());
  return form;
};

const preview = await fetch(`${BASE}/projects/${CODE}/estimate/preview`, {
  method: "POST", headers: { cookie }, body: body(),
}).then((response) => response.json());

// Написания, требующие решения оператора, принимаются с предложенной
// формой: скрипт наполняет стенд, а не решает за руководителя.
const overrides = Object.fromEntries(
  preview.report.unitDecisions.map((decision) => [decision.raw, decision.suggestion]),
);

const form = body();
form.append("units", JSON.stringify(overrides));
const result = await fetch(`${BASE}/projects/${CODE}/estimate/import`, {
  method: "POST", headers: { cookie }, body: form,
}).then((response) => response.json());

if (result.report === undefined) {
  console.error("Импорт не выполнен:", result);
  process.exit(1);
}
console.log(
  `Смета загружена в ${CODE}: редакция ${result.version}, позиций ${result.report.positions},`,
  `разделов ${result.report.sectionsTopLevel} + ${result.report.sectionsNested},`,
  `сопоставлено написаний ${Object.keys(overrides).length}`,
);

/* Связь этапов графика с разделами проставляется здесь: до импорта разделов
   не существует, и наполнение стенда оставило бы этапы без раздела — то есть
   приёмку без бригады-получателя.

   Через API, а не через Prisma: этот скрипт лежит в корне репозитория, а
   `@prisma/client` — зависимость `apps/api`, и при строгой раскладке pnpm в
   корень она не поднимается. Обращение к базе отсюда падает на сборке с
   чистыми зависимостями, хотя на машине разработчика может пройти. Заодно
   связь проставляется тем же путём, каким её проставит человек. */
const { РАЗДЕЛ_ЭТАПА } = await import("../apps/api/prisma/stage-sections.mjs");

const этапы = await fetch(`${BASE}/projects/${CODE}/stages`, { headers: { cookie } })
  .then((response) => response.json());
const приёмка = await fetch(`${BASE}/projects/${CODE}/acceptance`, { headers: { cookie } })
  .then((response) => response.json());
const разделПоИмени = new Map(приёмка.sections.map((раздел) => [раздел.name, раздел.id]));

let связано = 0;
for (const этап of этапы) {
  const sectionId = разделПоИмени.get(РАЗДЕЛ_ЭТАПА[этап.name] ?? "");
  if (sectionId === undefined) continue;
  const ответ = await fetch(`${BASE}/projects/${CODE}/stages/${этап.id}`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ sectionId }),
  });
  if (ответ.ok) связано += 1;
  else console.error(`  этап «${этап.name}» не связан: код ${ответ.status}`);
}
console.log(`  этапов связано с разделами: ${связано}`);

/* Помещения у позиций сметы. Тем же путём, каким их проставит человек, —
   правкой позиции, а не записью в таблицу. Обмер к этому моменту уже есть:
   его заводит `seed.mjs`, а смету — этот скрипт, и связать одно с другим
   можно только здесь. */
const { ПОМЕЩЕНИЕ_РАЗДЕЛА } = await import("../apps/api/prisma/estimate-rooms.mjs");

const смета = await fetch(`${BASE}/projects/${CODE}/estimate`, { headers: { cookie } })
  .then((response) => response.json());

/* Помещения обоих наборов: действующий набор приходит в самой смете, а
   начальный нужен разделам, помещения которых перепланировка слила. */
const наборы = await Promise.all(
  ["REPLANNED", "INITIAL"].map((набор) =>
    fetch(`${BASE}/projects/${CODE}/measure?set=${набор}`, { headers: { cookie } })
      .then((response) => response.json())),
);
const помещениеПоИмени = new Map();
for (const набор of наборы) {
  for (const комната of набор.rooms ?? []) {
    if (!помещениеПоИмени.has(комната.name)) помещениеПоИмени.set(комната.name, комната.id);
  }
}

const позицииРазделов = [];
const обойти = (узлы) => {
  for (const узел of узлы) {
    const имя = ПОМЕЩЕНИЕ_РАЗДЕЛА[узел.name];
    const roomId = имя === undefined ? undefined : помещениеПоИмени.get(имя);
    if (roomId !== undefined) {
      for (const позиция of узел.items) позицииРазделов.push([позиция.id, roomId]);
    }
    обойти(узел.children);
  }
};
обойти(смета.sections);

let сПомещением = 0;
for (const [itemId, roomId] of позицииРазделов) {
  const ответ = await fetch(`${BASE}/projects/${CODE}/estimate/items/${itemId}`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ roomId }),
  });
  if (ответ.ok) сПомещением += 1;
  else console.error(`  позиция ${itemId} не связана с помещением: код ${ответ.status}`);
}
console.log(
  `  позиций связано с помещениями: ${сПомещением} из ${смета.positions};`,
  `помещений в обоих наборах: ${помещениеПоИмени.size}`,
);

/* Транши объекта. Заводятся здесь, а не в `seed.mjs`: сумма предоплаты
   выводится из итога сметы, а до импорта итога не существует.

   Транш № 0 — предоплата 30 % от суммы, которую платит клиент, то есть от
   итога сметы с надбавкой (решение Р12). Транш № 1 — рабочий, на 450 000 ₽:
   заказчик назвал вилку 300–500 тыс. ₽, «чтобы заказчику суммы не казались
   большими» (docs/01_PROJECT.md:66). Числа наши собственные, из документов
   заказчика не переносятся. */
const объект = await fetch(`${BASE}/projects`, { headers: { cookie } })
  .then((response) => response.json())
  .then((строки) => строки.find((строка) => строка.code === CODE));

const транши = [];
if (объект?.estimateTotal) {
  /* Тридцать процентов одним умножением с округлением до копейки: тем же
     правилом, что и надбавка. Делить в двоичной плавающей арифметике
     нельзя — БП-08 запрещает её для денег. */
  транши.push({
    prepayment: true,
    amount: ((BigInt(объект.estimateTotal) * 30n + 50n) / 100n).toString(),
    comment: "Предоплата 30 % по договору",
  });
}
транши.push({ amount: "45000000", comment: "Рабочий транш" });

let заведено = 0;
for (const транш of транши) {
  const ответ = await fetch(`${BASE}/projects/${CODE}/tranches`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(транш),
  });
  if (ответ.ok) заведено += 1;
  else console.error(`  транш не заведён: код ${ответ.status}`);
}
console.log(`  траншей заведено: ${заведено}`);

/* Один пакет приёмки на стенде. Без него выработка всех траншей равна нулю,
   остаток совпадает с суммой, и проверка согласованности величин («остаток
   равен сумме минус выработка с надбавкой») теряет силу: подмена одного
   числа другим на таких данных неразличима. Обнаружено откатом проверки
   страницы — она не покраснела там, где обязана была.

   Заодно стенд перестаёт показывать пустой продукт: полоса транша
   заполнена, свод начислений не пуст, кольцо готовности имеет основание. */
const видПриёмки = await fetch(`${BASE}/projects/${CODE}/acceptance`, { headers: { cookie } })
  .then((response) => response.json());
const разделСЭтапом = видПриёмки.sections.find((раздел) => раздел.stage?.brigade != null);
const позиция = разделСЭтапом?.positions.find((строка) => BigInt(строка.remaining) >= 4n);

if (позиция !== undefined) {
  const форма = new FormData();
  форма.append("batch", JSON.stringify({
    sectionId: разделСЭтапом.id,
    comment: "Наполнение стенда",
    // Четверть остатка: позиция остаётся частично принятой, и экран
    // показывает все три состояния — принято, осталось, ожидает.
    positions: [{ itemId: позиция.id, qty: (BigInt(позиция.remaining) / 4n).toString() }],
  }));
  форма.append("file", new Blob([readFileSync(new URL("./fixtures/snimok.png", import.meta.url))]), "snimok.png");
  const ответ = await fetch(`${BASE}/projects/${CODE}/acceptance`, {
    method: "POST", headers: { cookie }, body: форма,
  });
  console.log(ответ.ok
    ? `  приёмка стенда: «${позиция.name}», ${(BigInt(позиция.remaining) / 4n).toString()} тысячных`
    : `  приёмка стенда не прошла: код ${ответ.status}`);
}

/* --- чеки на материалы ------------------------------------------------------
   Три чека на R-99, и каждый заведён тем, кто его в жизни заводит: два
   руководителем (значит сразу подтверждены), один прорабом (значит остаётся
   черновиком и ждёт разбора).

   Без черновика вкладка показывала бы только разобранное, а ключевое
   действие экрана — «подтвердить черновик расхода» (`07_IA.md`, раздел 4) —
   было бы недостижимо на стенде: проверить его было бы нечем.

   Суммы разные по виду и по возмещению: один расход остаётся на студии, и
   без него разделение «к возмещению / своё» показывало бы два одинаковых
   числа — состояние, в котором подмена одного другим неразличима.
   -------------------------------------------------------------------------- */
const снимокЧека = () =>
  new Blob([readFileSync(new URL("./fixtures/snimok.png", import.meta.url))]);

const разделыСметы = await fetch(`${BASE}/projects/${CODE}/estimate`, { headers: { cookie } })
  .then((ответ) => ответ.json())
  .then((вид) => вид.sections ?? []);
const разделЧека = разделыСметы[0]?.id ?? null;

const завестиЧек = async (кука, чек) => {
  const форма = new FormData();
  форма.append("expense", JSON.stringify(чек));
  форма.append("file", снимокЧека(), "chek.png");
  const ответ = await fetch(`${BASE}/projects/${CODE}/expenses`, {
    method: "POST", headers: { cookie: кука }, body: форма,
  });
  if (!ответ.ok) console.error(`  чек «${чек.seller}» не заведён: код ${ответ.status}`);
  return ответ.ok;
};

/* Вход прораба — тот же порядок, что у проверки API: одноразовая ссылка и
   кука из ответа. Заводить черновик от имени руководителя нельзя: он
   подтверждается сразу, и черновика на стенде не возникнет. */
const ссылкаПрораба = await fetch(`${BASE}/auth/magic-link`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "foreman@dolgiy.studio" }),
}).then((ответ) => ответ.json());
const входПрораба = await fetch(`${BASE}/auth/consume?token=${ссылкаПрораба.token}`, {
  redirect: "manual",
});
const кукаПрораба = входПрораба.headers.getSetCookie()
  .map((значение) => значение.split(";")[0]).join("; ");

let чеков = 0;
if (await завестиЧек(cookie, {
  kind: "MATERIALS", amount: "4870000", reimbursable: true,
  seller: "Петрович", spentAt: "2026-08-14", sectionId: разделЧека,
  note: "Гипсокартон, профиль, крепёж",
})) чеков += 1;

if (await завестиЧек(cookie, {
  kind: "DELIVERY", amount: "350000", reimbursable: true,
  seller: "Газель на час", spentAt: "2026-08-14", sectionId: null,
  note: "Доставка гипсокартона на объект",
})) чеков += 1;

if (await завестиЧек(кукаПрораба, {
  kind: "TOOLS", amount: "128000", reimbursable: false,
  seller: "Всеинструменты", spentAt: "2026-09-02", sectionId: null,
  note: "Диски отрезные, расходник",
})) чеков += 1;

console.log(`  чеков заведено: ${чеков}, из них черновиком 1`);

/* --- акт выполненных работ ---------------------------------------------------
   Рабочий транш закрывается, и на его месте открывается следующий. Без
   закрытого транша у объекта нет ни одного акта: акт есть представление
   закрытого транша, и вкладка «Документы» показывала бы пустое состояние —
   то есть проверять на стенде было бы нечего.

   Открытый транш при этом остаётся: он нужен приёмке, полосе выработки и
   остатку на «Обзоре». Закрыть единственный транш значило бы обменять одно
   пустое состояние на другое.
   -------------------------------------------------------------------------- */
const видТраншей = await fetch(`${BASE}/projects/${CODE}/tranches`, { headers: { cookie } })
  .then((ответ) => ответ.json());
const рабочий = видТраншей.current;

if (рабочий !== null && рабочий !== undefined) {
  const закрыт = await fetch(`${BASE}/projects/${CODE}/tranches/${рабочий.id}/closure`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ comment: "Закрыт актом выполненных работ" }),
  });
  const следующий = await fetch(`${BASE}/projects/${CODE}/tranches`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ amount: "50000000", comment: "Следующий рабочий транш" }),
  });
  console.log(закрыт.ok && следующий.ok
    ? `  акт стенда: транш № ${String(рабочий.number)} закрыт, открыт следующий`
    : `  акт стенда не собран: закрытие ${закрыт.status}, открытие ${следующий.status}`);
}
