/**
 * Снимок ответов API для демонстрационной сборки.
 *
 * Демонстрация показывает продукт, а не макет: экраны в ней те же самые,
 * подменяется только слой доступа к сети. Чтобы это оставалось правдой,
 * слепок снимается со стенда скриптом, а не правится руками.
 *
 * Роли снимаются порознь. Ответ прораба сохраняется таким, каким его отдал
 * сервер: отсутствие внутренних величин в демонстрации — это отсутствие их
 * в настоящем ответе, а не работа интерфейса.
 */
import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.API ?? "http://127.0.0.1:3000";
const TARGET = new URL("../apps/web/src/demo/snapshot.json", import.meta.url).pathname;
const FIXTURE = new URL("../packages/importer/fixtures/smeta-obezlichennaya.xlsx", import.meta.url).pathname;

async function signIn(email) {
  const link = await fetch(`${BASE}/auth/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  }).then((response) => response.json());
  const consumed = await fetch(`${BASE}/auth/consume?token=${link.token}`, { redirect: "manual" });
  const cookie = consumed.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  return async (path, init = {}) => {
    const response = await fetch(`${BASE}${path}`, { ...init, headers: { cookie, ...init.headers } });
    if (!response.ok) throw new Error(`${path} → ${response.status}`);
    return response.json();
  };
}

const owner = await signIn("owner@dolgiy.studio");
const foreman = await signIn("foreman@dolgiy.studio");
/* Заказчик снимается наравне с прочими: демонстрация показывает продукт
   глазами каждой роли, и набор данных для этого нужен свой. */
const client = await signIn("client@dolgiy.studio");

const form = new FormData();
form.append("file", new Blob([readFileSync(FIXTURE)]), "smeta-obezlichennaya.xlsx");
const preview = await owner("/projects/R-99/estimate/preview", { method: "POST", body: form });

const estimateOwner = await owner("/projects/R-99/estimate");
const imports = await owner("/projects/R-99/estimate/imports");
const last = imports[0];

const snapshot = {
  "me-owner": await owner("/auth/me"),
  "me-foreman": await foreman("/auth/me"),
  "projects-owner": await owner("/projects"),
  "projects-foreman": await foreman("/projects"),
  "summary-owner": await owner("/summary"),
  "summary-foreman": await foreman("/summary"),
  "clients-owner": await owner("/clients"),
  "clients-foreman": await foreman("/clients"),
  workers: await owner("/workers"),
  "events-owner": await owner("/projects/R-99/events"),
  "events-foreman": await foreman("/projects/R-99/events"),
  "me-client": await client("/auth/me"),
  "projects-client": await client("/projects"),
  "events-client": await client("/projects/R-99/events"),
  "estimate-client": await client("/projects/R-99/estimate"),
  "acts-client": await client("/projects/R-99/acts"),
  units: await owner("/projects/R-99/estimate/units"),
  organization: await owner("/organization"),
  unitDirectory: await owner("/units"),
  "estimate-owner": estimateOwner,
  "estimate-foreman": await foreman("/projects/R-99/estimate"),
  measure: await owner("/projects/R-99/measure"),
  /* Второй набор обмера снимается отдельным запросом: наборов два, и
     демонстрация обязана показывать переключатель заполненным с обеих
     сторон — иначе заказчик увидит кнопку, за которой пусто. */
  "measure-replanned": await owner("/projects/R-99/measure?set=REPLANNED"),
  expenses: await owner("/projects/R-99/expenses"),
  acts: await owner("/projects/R-99/acts"),
  templates: [],
  blueprints: [],
  people: await owner("/people"),
  /* Этапы снимаются своим вызовом, а не берутся из списка объектов: список
     несёт узкий план (даты и заявленная готовность), а карточке нужны ещё
     связь с разделом, бригада и фактическая готовность по приёмке. */
  stages: await owner("/projects/R-99/stages"),
  // Приёмка снимается дважды: свод начислений виден только руководителю,
  // и демонстрация обязана показывать оба вида, а не один с вырезанным полем.
  "acceptance-owner": await owner("/projects/R-99/acceptance"),
  "acceptance-foreman": await foreman("/projects/R-99/acceptance"),
  // Транши снимаются один раз: внутренних величин в них нет, и вид у
  // руководителя и прораба совпадает. Различается только право вести.
  tranches: await owner("/projects/R-99/tranches"),
  /* Деньги портфеля снимаются целиком: раздел «Бухгалтерия» собирает
     транши всех объектов, и вывести их из траншей одного R-99 нельзя.
     Вместе со сводом снимается день съёмки: состояния денег отсчитываются
     от сегодняшнего дня, и без опоры на дату слепка ждущий транш через
     месяц после съёмки стал бы просроченным сам собой. */
  accounting: await owner("/accounting"),
  capturedOn: new Date().toISOString().slice(0, 10),
  imports,
  "leads-owner": await owner("/leads?open=false"),
  "repair-types": await owner("/repair-types"),
  preview,
  // Результат импорта — запись о том импорте, который действительно был:
  // повторять запись ради снимка значило бы плодить редакции сметы.
  import: {
    importId: last.id,
    estimateId: last.estimateId,
    version: last.version,
    report: last.report,
  },
};

/* Акт снимается вторым заходом: опознаватель транша известен только из
   перечня актов, а тот уже в слепке. Снимаются оба вида — они различаются
   составом полей, и подменить один другим в демонстрации значило бы
   показать заказчику внутренние величины. Закрытого транша может не быть
   вовсе — тогда акта нет, и это честное состояние, а не отказ съёмки. */
/* Шаблоны снимаются с пунктами: перечень отдаёт строки без тела, а двойник
   демонстрации показывает сам шаблон — метками, как в продукте. */
const переченьШаблонов = await owner("/templates");
snapshot.templates = await Promise.all(
  переченьШаблонов.map((шаблон) => owner(`/templates/${шаблон.id}`)));

/* Типовые сметы снимаются перечнем: демонстрация показывает справочник
   организации, а не отдельную заготовку деревом. */
snapshot.blueprints = await owner("/blueprints");

const первыйАкт = snapshot.acts[0];
snapshot["act-client"] = первыйАкт === undefined
  ? null
  : await owner(`/projects/R-99/acts/${первыйАкт.trancheId}`);
snapshot["act-internal"] = первыйАкт === undefined
  ? null
  : await owner(`/projects/R-99/acts/${первыйАкт.trancheId}?view=internal`);

/*
 * Слепок снимается со стенда — с любого, в том числе с того, по которому
 * только что прошли проверки. Проверки заводят собственные записи: объект
 * `T-1` «Проверочный адрес 1», заказчика «Проверка API», транш на 1,00 ₽,
 * записи журнала о переименовании позиции. Такой слепок собирается без
 * единой ошибки и уезжает в публикацию — заказчик открывает демонстрацию
 * и видит служебные строки вперемешку со своими. Так и было до 11.09.2026:
 * в опубликованном слепке стояли девять объектов вместо восьми, пятый
 * заказчик и транш на рубль.
 *
 * Признак — не полнота данных, а имена: наполнение стенда знает коды вида
 * `R-99` и заказчиков с числовым кодом, проверки — коды `T-…` и имя
 * «Проверка API». Отказ лучше молчаливой съёмки: пересняться дёшево,
 * заметить рубль в ведомости на публикации — нет.
 */
const СЛЕДЫ_ПРОВЕРОК = [
  { признак: /Проверка API/u, что: "заказчик или позиция «Проверка API»" },
  { признак: /"code":\s*"T-\d+"/u, что: "объект или заказчик с кодом T-…" },
  { признак: /Проверочный адрес/u, что: "объект «Проверочный адрес»" },
];
const сериализованный = JSON.stringify(snapshot);
const следы = СЛЕДЫ_ПРОВЕРОК.filter(({ признак }) => признак.test(сериализованный));
if (следы.length > 0) {
  console.error(
    "Слепок снят со стенда, по которому прошли проверки, и несёт их записи:\n  "
    + следы.map(({ что }) => что).join("\n  ")
    + "\n\nПодними стенд заново и сними слепок до прогона проверок:"
    + "\n  . /tmp/stand52.sh && чисто && node scripts/capture-demo.mjs"
    + "\n\nФайл не записан.",
  );
  process.exit(1);
}

writeFileSync(TARGET, `${JSON.stringify(snapshot, null, 1)}\n`, "utf8");
const size = Math.round(readFileSync(TARGET).length / 1024);
console.log(`Слепок снят: ${TARGET} (${size} КБ)`);
console.log(
  `  объектов у руководителя ${snapshot["projects-owner"].length},`,
  `у прораба ${snapshot["projects-foreman"].length};`,
  `позиций сметы ${estimateOwner.positions}; событий ${snapshot["events-owner"].length};`,
  `помещений обмера ${snapshot.measure.rooms.length}, после перепланировки ${snapshot["measure-replanned"].rooms.length};`,
  `чеков ${snapshot.expenses.rows.length}, из них черновиков ${snapshot.expenses.totals.drafts};`,
  `актов ${snapshot.acts.length}; шаблонов ${snapshot.templates.length};`,
  `типовых смет ${snapshot.blueprints.length};`,
  `людей ${snapshot.people.length}; объектов заказчику ${snapshot["projects-client"].length};`,
  `траншей портфеля ${snapshot.accounting.rows.length}`,
);
