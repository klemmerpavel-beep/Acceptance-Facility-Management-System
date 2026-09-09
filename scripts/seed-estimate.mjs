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
