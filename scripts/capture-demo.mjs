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
  units: await owner("/projects/R-99/estimate/units"),
  organization: await owner("/organization"),
  unitDirectory: await owner("/units"),
  "estimate-owner": estimateOwner,
  "estimate-foreman": await foreman("/projects/R-99/estimate"),
  measure: await owner("/projects/R-99/measure"),
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

writeFileSync(TARGET, `${JSON.stringify(snapshot, null, 1)}\n`, "utf8");
const size = Math.round(readFileSync(TARGET).length / 1024);
console.log(`Слепок снят: ${TARGET} (${size} КБ)`);
console.log(
  `  объектов у руководителя ${snapshot["projects-owner"].length},`,
  `у прораба ${snapshot["projects-foreman"].length};`,
  `позиций сметы ${estimateOwner.positions}; событий ${snapshot["events-owner"].length};`,
  `помещений обмера ${snapshot.measure.rooms.length}`,
);
