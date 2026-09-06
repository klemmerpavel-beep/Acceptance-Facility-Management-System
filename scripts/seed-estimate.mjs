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
   приёмку без бригады-получателя. */
const { PrismaClient } = await import("@prisma/client");
const { связатьЭтапыСРазделами } = await import("../apps/api/prisma/stage-sections.mjs");
const prisma = new PrismaClient();
try {
  const объект = await prisma.project.findFirst({ where: { code: CODE }, select: { id: true } });
  if (объект !== null) {
    const связано = await связатьЭтапыСРазделами(prisma, объект.id);
    console.log(`  этапов связано с разделами: ${связано}`);
  }
} finally {
  await prisma.$disconnect();
}
