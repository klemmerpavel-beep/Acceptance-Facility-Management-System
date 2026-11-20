#!/usr/bin/env node
/**
 * Замер базы метрик до этапа Э9 (решение допроса Э9-12, план доработок 6.5).
 *
 * Запуск на рабочей базе заказчика:
 *
 *   DATABASE_URL=… node scripts/measure-baseline.mjs [--from ГГГГ-ММ-ДД] [--to ГГГГ-ММ-ДД] [--json путь]
 *
 * Окно по умолчанию — `ОКНО_ЗАМЕРА_ДНЕЙ` по сегодняшний день организации
 * включительно. Скрипт только читает: ни одной записи в базу и ни одного
 * обращения в сеть, кроме самой базы. Отчёт — в стандартный вывод; с
 * `--json` те же числа ложатся файлом, чтобы замер «после» сравнивался с
 * базой построчно, а не на глаз.
 *
 * Правило замера — `packages/domain/src/baseline.ts`; здесь только чтение и
 * перевод моментов в дни организации. Домен загружается из исходников
 * снятием типов средствами Node: сборки он не требует, и правило в скрипте
 * то же, что проверяют тесты.
 *
 * Вне продукта намеренно: средства замера в продукт не встраиваются (ответ
 * на вопрос 11 квиза) — ни маршрута, ни экрана у замера нет.
 *
 * Стенд замер проверяет (`scripts/verify-baseline.mjs`), но его числа за
 * базу не выдаются: данные стенда придуманы.
 */
import { createRequire, register } from "node:module";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/* Исходники домена ссылаются друг на друга как `./x.js` — так требует
   TypeScript, — а файл лежит как `x.ts`. Node этого сопоставления не делает;
   крючок разрешения делает его только для импортов из `.ts`. */
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier.endsWith(".js") && context.parentURL?.endsWith(".ts")) {
    return next(specifier.slice(0, -3) + ".ts", context);
  }
  return next(specifier, context);
}`));

const { замерБазы, процент, ОКНО_ЗАМЕРА_ДНЕЙ, dayInZone, shiftDay, formatDay } =
  await import("../packages/domain/src/index.ts");

/** Колонка `@db.Date` приходит полуночью UTC: день — её первые десять знаков. */
const деньКолонки = (дата) => дата.toISOString().slice(0, 10);

/**
 * Замер одной организации за окно. Возвращает то же, что `замерБазы`, —
 * чтение базы здесь, правило в домене.
 */
export async function измерить(prisma, организация, { с, по }) {
  const пояс = организация.timeZone;
  const день = (момент) => dayInZone(момент, пояс);

  const транши = await prisma.tranche.findMany({
    where: { project: { orgId: организация.id }, closedAt: { not: null } },
    select: {
      number: true, amount: true, status: true, closedAt: true, paidAt: true, signedAt: true,
      project: { select: { code: true, client: { select: { paymentGraceDays: true } } } },
      payments: { select: { amount: true, paidOn: true } },
    },
  });

  const заказчики = await prisma.user.findMany({
    where: { orgId: организация.id, role: "CLIENT" },
    select: { createdAt: true, revokedAt: true, lastSeenAt: true, sessions: { select: { createdAt: true } } },
  });

  const чеки = await prisma.materialExpense.findMany({
    where: { project: { orgId: организация.id } },
    select: {
      createdAt: true, status: true, confirmedAt: true, createdById: true, confirmedById: true, reimbursable: true,
    },
  });

  return замерБазы({
    с,
    по,
    транши: транши.map((транш) => ({
      объект: транш.project.code,
      номер: транш.number,
      закрыт: день(транш.closedAt),
      сумма: транш.amount,
      порог: транш.project.client.paymentGraceDays,
      платежи: транш.payments.map((платёж) => ({ день: деньКолонки(платёж.paidOn), сумма: платёж.amount })),
      отметкаОплаты: транш.status === "PAID" && транш.paidAt !== null ? день(транш.paidAt) : null,
      подписан: транш.signedAt === null ? null : деньКолонки(транш.signedAt),
    })),
    /* Истории заходов продукт не хранит: сессия удаляется при выходе и при
       снятии входа, отметка захода держит только последний. Заходы — дни
       сохранившихся сессий и день отметки; замер — нижняя граница. */
    заказчики: заказчики.map((заказчик) => ({
      выдан: день(заказчик.createdAt),
      снят: заказчик.revokedAt === null ? null : день(заказчик.revokedAt),
      заходы: [
        ...заказчик.sessions.map((сессия) => день(сессия.createdAt)),
        ...(заказчик.lastSeenAt === null ? [] : [день(заказчик.lastSeenAt)]),
      ],
    })),
    чеки: чеки.map((чек) => ({
      создан: день(чек.createdAt),
      состояние: чек.status,
      решён: чек.confirmedAt === null ? null : день(чек.confirmedAt),
      самПодтвердил: чек.status === "CONFIRMED" && чек.createdById !== null && чек.confirmedById === чек.createdById,
      возмещаемый: чек.reimbursable,
    })),
  });
}

const дн = (число) => (число === null ? "нет данных" : `${String(число).replace(".", ",")} дн.`);
const доля = (часть, целое) => {
  const п = процент(часть, целое);
  return п === null ? `${часть} из ${целое}` : `${часть} из ${целое} (${п} %)`;
};

/** Отчёт для чтения человеком. Числа те же, что в `--json`. */
export function отчёт(организация, замер) {
  const { оплата, подпись, входы, чеки } = замер;
  const известенИсход = оплата.оплаченоВСрок + оплата.оплаченоСПросрочкой + оплата.просрочено.length;
  return [
    `# Замер базы метрик до Э9 — ${организация.name}`,
    "",
    `Окно: ${formatDay(замер.с)} – ${formatDay(замер.по)}, дни по поясу ${организация.timeZone}.`,
    "",
    "## 1. Дни от закрытия транша до оплаты",
    `- Закрыто траншей: ${оплата.закрыто}`,
    `- Оплачено: ${оплата.оплаченоВСрок + оплата.оплаченоСПросрочкой}; медиана ${дн(оплата.медиана)},`
      + ` наибольшее ${дн(оплата.наибольшее)}`,
    `- В срок по договору: ${доля(оплата.оплаченоВСрок, известенИсход)} с известным исходом`,
    `- Просрочено без оплаты: ${оплата.просрочено.length}`
      + (оплата.просрочено.length > 0 ? ` — ${оплата.просрочено.join(", ")}` : ""),
    `- Ждёт в пределах порога: ${оплата.ждётВПределахПорога}`,
    "",
    "## 2. Дни от закрытия транша до подписи акта",
    `- Подписано: ${доля(подпись.подписано, подпись.закрыто)}; медиана ${дн(подпись.медиана)},`
      + ` наибольшее ${дн(подпись.наибольшее)}`,
    `- Не подписан дольше всех: ${дн(подпись.дольшеЖдёт)}`,
    "",
    "## 3. Входы заказчика (нижняя граница)",
    `- Входов действовало в окне: ${входы.выдано}; заходили хотя бы раз: ${доля(входы.заходили, входы.выдано)}`,
    `- Дней с заходом в неделю на заказчика, медиана по входам не короче недели: ${
      входы.днейВНеделю === null ? "нет данных" : String(входы.днейВНеделю).replace(".", ",")}`,
    "",
    "## 4. Разбор чеков",
    `- Записано: ${чеки.записано}, из них возмещаемых ${чеки.возмещаемых}; ждали разбора ${чеки.ждалиРазбора}`,
    `- Разобрано: ${доля(чеки.подтверждено + чеки.отклонено, чеки.ждалиРазбора)}`
      + ` (подтверждено ${чеки.подтверждено}, отклонено ${чеки.отклонено});`
      + ` медиана ${дн(чеки.медиана)}, наибольшее ${дн(чеки.наибольшее)}`,
    `- Без решения: ${чеки.безРешения}; дольше всех ждёт ${дн(чеки.дольшеЖдёт)}`,
    "",
  ].join("\n");
}

function доводы(argv) {
  const значения = {};
  for (let i = 0; i < argv.length; i += 1) {
    const [ключ, значение] = [argv[i], argv[i + 1]];
    if (!["--from", "--to", "--json"].includes(ключ) || значение === undefined) {
      throw new Error(`Непонятный довод «${ключ}». Запуск: node scripts/measure-baseline.mjs`
        + " [--from ГГГГ-ММ-ДД] [--to ГГГГ-ММ-ДД] [--json путь]");
    }
    значения[ключ.slice(2)] = значение;
    i += 1;
  }
  return значения;
}

/** Окно организации: явное либо `ОКНО_ЗАМЕРА_ДНЕЙ` по её сегодняшний день. */
export function окно(организация, { from, to } = {}) {
  const по = to ?? dayInZone(new Date(), организация.timeZone);
  return { с: from ?? shiftDay(по, -(ОКНО_ЗАМЕРА_ДНЕЙ - 1)), по };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const заданное = доводы(process.argv.slice(2));
  const { PrismaClient } = createRequire(new URL("../apps/api/package.json", import.meta.url))("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const организации = await prisma.organization.findMany({
      select: { id: true, name: true, timeZone: true },
      orderBy: { createdAt: "asc" },
    });
    const замеры = [];
    for (const организация of организации) {
      const замер = await измерить(prisma, организация, окно(организация, заданное));
      замеры.push({ организация: организация.name, ...замер });
      console.log(отчёт(организация, замер));
    }
    if (заданное.json !== undefined) {
      writeFileSync(заданное.json, JSON.stringify({ снят: new Date().toISOString(), замеры }, null, 2) + "\n");
      console.log(`Числа замера записаны: ${заданное.json}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}
