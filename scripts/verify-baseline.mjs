#!/usr/bin/env node
/**
 * Проверка замера базы метрик на стенде (решение допроса Э9-12).
 *
 * Стенд проверяет замер, а не снимает базу: данные стенда придуманы, и их
 * числа за базу не выдаются. Проверяется три вещи.
 *
 * 1. Замер сходится с продуктом. Просрочка, оплаченность, число закрытых
 *    траншей и чеков без решения считаются в замере своим путём — из базы,
 *    правилом `baseline.ts`, — а продукт отвечает о том же экраном денег и
 *    вкладкой «Чеки». Разойтись они могут только ошибкой одного из путей;
 *    просрочка в базе «до» и на экране обязана быть одной.
 * 2. Замер не пуст: у каждой метрики на стенде есть хотя бы один случай.
 *    Сверка пустых множеств проходит при любом правиле.
 * 3. Замер только читает: скрипт не содержит ни одной записи в базу.
 *
 * Запуск — после наполнения стенда и `verify-api.mjs`, при живом API.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { измерить } from "./measure-baseline.mjs";

const BASE = process.env.API ?? "http://127.0.0.1:3000";
const problems = [];
const check = (condition, message) => { if (!condition) problems.push(`База метрик: ${message}`); };

async function signIn(email) {
  const link = await fetch(`${BASE}/auth/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  }).then((r) => r.json());
  const response = await fetch(`${BASE}/auth/consume?token=${link.token}`, { redirect: "manual" });
  const cookie = response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return (path) => fetch(`${BASE}${path}`, { headers: { cookie } }).then((r) => r.json());
}

const { PrismaClient } = createRequire(new URL("../apps/api/package.json", import.meta.url))("@prisma/client");
const prisma = new PrismaClient();

try {
  const owner = await signIn("owner@dolgiy.studio");
  const { orgId } = await prisma.user.findFirstOrThrow({
    where: { email: "owner@dolgiy.studio" }, select: { orgId: true },
  });
  const организация = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId }, select: { id: true, name: true, timeZone: true },
  });

  /* Окно — вся история организации по её сегодняшний день, взятый у
     продукта (очередь называет его, этап Э8): экран денег показывает все
     транши, и сверка обязана видеть те же в тот же день. */
  const { today: сегодня } = await owner("/inbox");
  const деньги = await owner("/accounting");
  const замер = await измерить(prisma, организация, { с: "2000-01-01", по: сегодня });

  // 1. Сходимость с продуктом.
  const закрытые = деньги.rows.filter((строка) => строка.closedAt !== null);
  check(замер.оплата.закрыто === закрытые.length,
    `закрытых траншей в замере ${замер.оплата.закрыто}, на экране денег ${закрытые.length}`);

  const просроченоНаЭкране = закрытые.filter((строка) => строка.overdue)
    .map((строка) => `${строка.projectCode} № ${строка.number}`).sort();
  check(JSON.stringify(замер.оплата.просрочено) === JSON.stringify(просроченоНаЭкране),
    `просрочка в замере [${замер.оплата.просрочено.join(", ")}],`
      + ` на экране денег [${просроченоНаЭкране.join(", ")}] — правило разошлось с продуктом`);

  /* Оплаченный — отмеченный руководителем либо покрытый платежами: так
     продукт называет состояние денег (`moneyState`, `outstanding`). */
  const оплаченоНаЭкране = закрытые
    .filter((строка) => строка.state === "оплачено" || BigInt(строка.outstanding) <= 0n).length;
  const оплаченоВЗамере = замер.оплата.оплаченоВСрок + замер.оплата.оплаченоСПросрочкой;
  check(оплаченоВЗамере === оплаченоНаЭкране,
    `оплаченных траншей в замере ${оплаченоВЗамере}, на экране денег ${оплаченоНаЭкране}`);
  const исходов = оплаченоВЗамере + замер.оплата.просрочено.length + замер.оплата.ждётВПределахПорога;
  check(исходов === замер.оплата.закрыто,
    "оплаченные, просроченные и ждущие в пределах порога не складываются в число закрытых");

  const объекты = await owner("/projects");
  let черновиков = 0;
  for (const объект of объекты) {
    const чеки = await owner(`/projects/${объект.code}/expenses`);
    черновиков += (чеки.rows ?? []).filter((чек) => чек.status === "DRAFT").length;
  }
  check(замер.чеки.безРешения === черновиков,
    `чеков без решения в замере ${замер.чеки.безРешения}, черновиков на вкладках «Чеки» ${черновиков}`);
  check(замер.чеки.подтверждено + замер.чеки.отклонено + замер.чеки.безРешения === замер.чеки.ждалиРазбора,
    "подтверждённые, отклонённые и ждущие не складываются в число ждавших разбора");
  check(замер.входы.заходили <= замер.входы.выдано, "заходивших заказчиков больше, чем выданных входов");

  // 2. Непустота: правило, проверенное на пустом множестве, не проверено.
  check(замер.оплата.закрыто > 0, "на стенде нет закрытых траншей — замер оплаты не проверен");
  check(оплаченоВЗамере > 0 && замер.оплата.медиана !== null,
    "на стенде нет оплаченных траншей — дни до оплаты не проверены");
  check(замер.оплата.просрочено.length > 0, "на стенде нет просрочки — сверка с экраном денег пуста");
  check(замер.подпись.закрыто > 0, "замер подписи актов пуст");
  check(замер.входы.заходили > 0, "ни один заказчик стенда не заходил — замер входов не проверен");
  check(замер.чеки.ждалиРазбора > 0, "на стенде нет чеков, ждавших разбора");

  // 3. Только чтение: в скрипте замера нет ни одной записи в базу.
  const исходник = readFileSync(new URL("./measure-baseline.mjs", import.meta.url), "utf8");
  const записи = исходник
    .match(/\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw/gu) ?? [];
  check(записи.length === 0, `скрипт замера пишет в базу: ${записи.join(", ")}`);
} finally {
  await prisma.$disconnect();
}

if (problems.length > 0) {
  console.error(`Замечаний: ${problems.length}\n` + problems.map((p) => `  ${p}`).join("\n"));
  process.exit(1);
}
console.log("Замер базы метрик сверен с экраном денег и вкладками «Чеки»; замер не пуст и только читает.");
