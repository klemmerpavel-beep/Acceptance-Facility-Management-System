/**
 * Проверка опубликованной демонстрации браузером.
 *
 * До сих пор проверялись стенд (`verify-page.mjs`, живой сервер) и состав
 * каталога публикации (`verify-pages.mjs`, файлы на диске). Между ними
 * лежал слой, который не проверял никто: `api.demo.ts` — двойник клиента
 * API, отвечающий из слепка. Дефект в нём не виден ни одной из двух
 * проверок и виден заказчику: демонстрация — единственное, что он
 * открывает по ссылке.
 *
 * Проверяется собранный каталог `site/`, а не исходники: публикуется он.
 * Раздаётся штатным сервером Node — новых зависимостей работа не вводит.
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./browser.mjs";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const site = new URL("../site", import.meta.url).pathname;
const PORT = Number(process.env["DEMO_PORT"] ?? 4173);

if (!existsSync(join(site, "index.html"))) {
  console.error("Нет каталога site/: выполните `node scripts/build-pages.mjs` до проверки.");
  process.exit(1);
}

const problems = [];
const environment = [];
const note = (kind, detail) => problems.push(`${kind}: ${detail}`);

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};

/* Что приняла заглушка приёмника замечаний. Сервер раздачи и приёмник —
   один процесс намеренно: адрес приёмника запекается в сборку, и второй
   порт пришлось бы согласовывать с ней отдельно. */
const принятое = [];

const server = createServer((request, response) => {
  const адрес = new URL(request.url ?? "/", "http://x").pathname;

  /* Заглушка приёмника замечаний. Настоящий приёмник — веб-приложение
     Apps Script, дописывающее строку в Google-таблицу; сюда он не ходит и
     ходить не должен: проверка стережёт форму и то, что она отправляет, а
     не работоспособность Google. */
  if (адрес === "/__feedback") {
    if (request.method !== "POST") { response.writeHead(405); response.end("нет"); return; }
    let тело = "";
    request.on("data", (кусок) => { тело += String(кусок); });
    request.on("end", () => {
      try { принятое.push(JSON.parse(тело)); } catch { принятое.push({ битое: тело }); }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  const путь = join(site, normalize(decodeURIComponent(адрес)).replace(/^(\.\.[/\\])+/u, ""));
  const файл = existsSync(путь) && extname(путь) !== "" ? путь : join(путь, "index.html");
  if (!existsSync(файл)) { response.writeHead(404); response.end("нет"); return; }
  response.writeHead(200, { "content-type": TYPES[extname(файл)] ?? "application/octet-stream" });
  response.end(readFileSync(файл));
});
await new Promise((resolve) => server.listen(PORT, resolve));
const BASE = `http://127.0.0.1:${PORT}`;

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });

/* Единственное ожидаемое событие — недоступность шрифтов: исходящая сеть
   песочницы закрыта. Всё остальное на странице без сервера есть дефект:
   ходить ей некуда. */
const ожидаемо = (url) => url.includes("fonts.googleapis.com") || url.includes("fonts.gstatic.com");

page.on("console", (message) => {
  if (message.type() !== "error") return;
  const url = message.location().url ?? "";
  if (ожидаемо(url)) environment.push(`консоль: ${url.slice(0, 60)}`);
  else note("ошибка консоли", `${url} — ${message.text().slice(0, 90)}`);
});
page.on("pageerror", (error) => note("исключение страницы", String(error).slice(0, 160)));
page.on("requestfailed", (request) => {
  if (ожидаемо(request.url())) environment.push(`сеть песочницы: ${request.url().slice(0, 50)}`);
  else note("запрос не выполнен", `${request.url()} — ${request.failure()?.errorText ?? ""}`);
});
page.on("response", (response) => {
  if (response.status() >= 400 && !ожидаемо(response.url())) {
    note("ответ с ошибкой", `${response.status()} ${response.url()}`);
  }
  /* Демонстрация обязана работать без сервера. Запрос к `/api` означает,
     что в сборку попал продуктовый клиент и заказчик увидит вечную
     загрузку: проверка состава такого не видит — файлы на месте. */
  if (new URL(response.url()).pathname.startsWith("/api")) {
    note("обращение к серверу", response.url());
  }
});

const текст = async (селектор) => (await page.locator(селектор).first().innerText()).trim();
const число = async (селектор) => page.locator(селектор).count();

/* Раздел выбирается ссылкой полосы разделов — той же, которой его
   выбирает человек, а не переходом по адресу: маршрута у продукта нет,
   и адрес ничего бы не выбрал. */
const раздел = async (имя) => {
  await page.locator(".appbar__nav-scroll .appbar__link", { hasText: имя }).first().click();
  await page.waitForTimeout(700);
};

await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);

/* 1. Главная. Первый экран отвечает на вопрос «что с портфелем»: числа,
      два графика и лента событий. Пустой любой из трёх — экран без
      ответа. */
const чисел = await число(".score");
if (чисел < 3) note("главная", `чисел в ряду ${чисел}: ряд свёрнут`);
if (await число(".statusbar__part") === 0) note("главная", "полоса статусов пуста");
if (await число(".readiness__row") === 0) note("главная", "график готовности пуст");
const событий = await число(".feed__item");
if (событий === 0) note("главная", "лента событий пуста");

/* 2. Разделы. Каждый обязан нарисовать содержимое: в демонстрации нет
      сервера, и пустой раздел означает не «данных нет», а «двойник API
      промолчал». */
await раздел("Заявки");
const карточек = await число(".leadcard");
if (карточек === 0) note("заявки", "на доске ни одной заявки");

await раздел("Проекты");
const плитокПортфеля = await число(".objecttile");
if (плитокПортфеля < 5) note("проекты", `плиток в портфеле ${плитокПортфеля}`);

await раздел("Контакты");
const строкЗаказчиков = await число("tbody tr");
if (строкЗаказчиков < 2) note("контрагенты", `строк в справочнике ${строкЗаказчиков}`);

/* 3. Бухгалтерия. Раздел портфельный, и демонстрация обязана это
      показывать: ведомость об одном объекте отвечает не на тот вопрос,
      ради которого раздел заведён. Ровно так и было до 11.09.2026. */
await раздел("Бухгалтерия");
const сводДенег = await число(".statcard");
if (сводДенег !== 4) note("бухгалтерия", `в своде ${сводДенег} чисел вместо четырёх`);
const коды = await page.$$eval(
  ".money__row .code-badge",
  (узлы) => узлы.map((узел) => узел.textContent?.trim() ?? ""),
);
if (коды.length === 0) note("бухгалтерия", "ведомость пуста");
const объектыДенег = new Set(коды);
if (объектыДенег.size < 3) {
  note("бухгалтерия", `деньги показаны по ${объектыДенег.size} объектам: раздел портфельный`);
}
const ведомость = await текст(".money");
if (!ведомость.includes("просрочено")) {
  note("бухгалтерия", "в ведомости нет просроченного транша: строка не называет просрочку словом");
}
if (!ведомость.includes("ждёт оплаты")) note("бухгалтерия", "в ведомости нет ждущего транша");
if (!ведомость.includes("в работе")) note("бухгалтерия", "в ведомости нет транша в работе");
if (!ведомость.includes("оплачен частично")) {
  note("бухгалтерия", "в ведомости нет частично оплаченного транша: состояние не показано словом");
}
if (!ведомость.includes("недобор")) {
  note("бухгалтерия", "в ведомости нет недобора: расхождение отметки с платежами не показано");
}
/* Кнопка отметки оплаты стоит только у того, кто ещё ждёт денег: кнопка,
   которая ответит отказом, не показывается вовсе. Состояний ожидания с
   19.09.2026 три — ждёт оплаты, оплачен частично и просрочено; последнее
   перекрывает собой первые два, и потому считается по пилюлям, а не по
   подстрокам. */
const ждущих = (ведомость.match(/ждёт оплаты|оплачен частично|просрочено/gu) ?? []).length;
const кнопок = await число(".money__act button");
if (кнопок !== ждущих) note("бухгалтерия", `ждут оплаты ${ждущих} строк, кнопок отметки ${кнопок}`);

/* 4. Карточка объекта. Восемь вкладок, и каждая рисуется из слепка.
      Молчаливо пустая вкладка — самый частый дефект двойника. */
await раздел("Проекты");
/* Портфель читается галереей плиток; объект открывается ссылкой адреса —
   ею же его открывает человек. Заодно сверяется, что обложка есть у каждой
   плитки: снимком, если он лежит в каталоге демонстрации, иначе подложкой.
   Пустая рамка вместо обложки читается как поломка продукта. */
const плиток = await число(".objecttile");
const обложек = (await число(".objecttile__photo")) + (await число(".objecttile__plate"));
if (плиток === 0) note("портфель", "галерея объектов пуста");
console.log(`  портфель: плиток ${плиток}, со снимком ${await число(".objecttile__photo")}, с подложкой ${await число(".objecttile__plate")}`);
if (обложек !== плиток) {
  note("портфель", `обложка есть у ${обложек} плиток из ${плиток}`);
}
await page.locator(".objecttile__link").first().click();
await page.waitForTimeout(700);
const вкладки = page.locator('[role="tab"]');
const всего = await вкладки.count();
if (всего < 7) note("карточка", `вкладок ${всего}`);
for (let i = 0; i < всего; i += 1) {
  const имя = (await вкладки.nth(i).innerText()).trim();
  await вкладки.nth(i).click();
  await page.waitForTimeout(500);
  const содержимое = (await page.locator("main").innerText()).replace(/\s+/gu, " ").trim();
  if (содержимое.length < 120) note("карточка", `вкладка «${имя}» пуста`);
}

/* 5. Ширина документа. Публикация открывается на чужой машине, и
      горизонтальная прокрутка на первом же экране — дефект, которого со
      стенда не видно: там проверяется другая сборка. */
const ширина = await page.evaluate(() => ({
  viewport: document.documentElement.clientWidth,
  scroll: document.documentElement.scrollWidth,
}));
if (ширина.scroll > ширина.viewport + 1) {
  note("ширина", `полотно ${ширина.scroll} при окне ${ширина.viewport}`);
}

/* 6. Значок страницы. Шаблон демонстрации и шаблон продукта разошлись
      однажды именно здесь: браузер просил `/favicon.ico`, публикация
      отвечала 404. */
const значок = await page.locator('link[rel="icon"]').count();
if (значок === 0) note("публикация", "страница не объявляет значок: браузер запросит /favicon.ico");

/* 7. Страница аудита и квиза. Опубликована рядом с демонстрацией, и
      проверяется тем же обходом: вопросы без работающего выбора —
      страница, которая выглядит целой и ничего не собирает. */
await page.goto(`${BASE}/audit.html`, { waitUntil: "networkidle" });
const вопросов = await число("fieldset");
if (вопросов !== 12) note("аудит", `вопросов ${вопросов} вместо двенадцати`);
/* Отсутствие полей выбора называется замечанием, а не падением обхода:
   проверка, срывающаяся исключением, не сообщает, что именно не так, и
   останавливает остальные — а они ещё не выполнены. */
if (await число('input[name="q1"]') === 0 || await число('input[name="q2"]') < 2) {
  note("аудит", "полей выбора нет: проверить перенос ответа нечем");
} else {
  await page.locator('input[name="q1"]').first().check();
  await page.locator('input[name="q2"]').nth(1).check();
  await page.waitForTimeout(200);
  const итог = await текст("#ответ");
  if (!итог.includes("1 — а") || !итог.includes("2 — б")) {
    note("аудит", `выбор не попал в итог: «${итог.slice(0, 60)}»`);
  }
  const счётчик = await текст("#счёт");
  if (!счётчик.startsWith("2 из 12")) note("аудит", `счётчик ответов показывает «${счётчик}»`);
}
const ширинаАудита = await page.evaluate(() => ({
  viewport: document.documentElement.clientWidth,
  scroll: document.documentElement.scrollWidth,
}));
if (ширинаАудита.scroll > ширинаАудита.viewport + 1) {
  note("аудит", `полотно ${ширинаАудита.scroll} при окне ${ширинаАудита.viewport}`);
}
/* Телефон: страницу открывают и с него, и горизонтальная прокрутка на
   ней означает, что таблица модулей вышла за экран. */
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
const узкая = await page.evaluate(() => ({
  viewport: document.documentElement.clientWidth,
  scroll: document.documentElement.scrollWidth,
}));
if (узкая.scroll > узкая.viewport + 1) {
  note("аудит", `на 390 px полотно ${узкая.scroll} при окне ${узкая.viewport}`);
}

/* 9. Приём замечаний по демонстрации.

      Виджет ставится ради обзора заказчиком, и цена его отказа выше
      обычной: заказчик пишет замечание, видит, что окно закрылось, и
      считает сказанное переданным. Поэтому проверяется не наличие кнопки,
      а путь целиком — до строки, дошедшей до приёмника.

      Приёмник здесь подменён заглушкой в том же процессе; адрес ей
      задаётся переменной сборки `VITE_FEEDBACK_URL`. Собранная без этой
      переменной демонстрация виджета не показывает вовсе — и проверка
      обязана это назвать, а не промолчать: молчание означало бы, что
      заказчику отдали страницу без того, ради чего её отдавали. */
/* --- переключатель роли ------------------------------------------------------
   Демонстрация показывает продукт глазами каждой из четырёх ролей. До этого
   она показывала только руководителя, и посмотреть на прораба или заказчика
   было негде: страница раздаётся статикой и входа не имеет.

   Стережётся свойство, а не вид: переключение меняет то, что видно. Роль,
   при которой состав разделов не изменился, — это переключатель, который
   ничего не переключает; он хуже отсутствующего, потому что обещает показ.

   У бухгалтера состав разделов с руководителем совпадает намеренно: решением
   заказчика от 19.09.2026 им открыто одно и то же, а различаются служебные
   экраны. Поэтому для него проверяется не разница разделов, а отсутствие
   настроек в списке «Ещё» — иначе правило требовало бы разницы, которой по
   решению быть не должно, и «исправить» его пришлось бы ложью в продукте.
   -------------------------------------------------------------------------- */
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
{
  const переключатель = page.locator('.demorole [role="group"] .segmented__option');
  const ролей = await переключатель.count();
  if (ролей !== 4) {
    note("роли", `в переключателе ${ролей} ролей вместо четырёх`);
  } else {
    const составы = new Map();
    for (const подпись of ["Руководитель", "Прораб", "Бухгалтер", "Заказчик"]) {
      await page.click(`.demorole .segmented__option:has-text("${подпись}")`);
      await page.waitForTimeout(900);
      const разделы = (await page.locator(".appbar__nav-scroll .appbar__link").allTextContents())
        .map((текст) => текст.trim());
      составы.set(подпись, разделы.join("|"));
      if (разделы.length === 0) {
        note("роли", `у роли «${подпись}» в шапке нет ни одного раздела`);
      }
    }
    const заказчику = составы.get("Заказчик") ?? "";
    const руководителю = составы.get("Руководитель") ?? "";
    if (заказчику === руководителю) {
      note("роли", "заказчик видит те же разделы, что руководитель: переключатель ничего не меняет");
    }
    if (заказчику.split("|").length > 1) {
      note("роли", `у заказчика в шапке разделы «${заказчику.replace(/\|/gu, ", ")}»`);
    }
    /* Бухгалтер: разделы те же, служебные экраны — нет. Проверяется вторая
       половина решения, потому что первая половина у него неотличима от
       руководителя по построению. */
    await page.click('.demorole .segmented__option:has-text("Бухгалтер")');
    await page.waitForTimeout(900);
    await page.click(".appbar__more > summary").catch(() => { /* уже раскрыт */ });
    await page.waitForTimeout(200);
    const служебные = (await page.locator(".appbar__menu .appbar__menu-item").allTextContents())
      .map((текст) => текст.trim());
    if (служебные.includes("Настройки")) {
      note("роли", `бухгалтеру показаны настройки: «${служебные.join(", ")}»`);
    }
    if (служебные.length === 0) {
      note("роли", "список «Ещё» у бухгалтера пуст: проверка настроек ничего не стережёт");
    }
    if ((составы.get("Бухгалтер") ?? "") !== (составы.get("Руководитель") ?? "")) {
      note("роли", `разделы бухгалтера «${составы.get("Бухгалтер")}» разошлись с разделами руководителя`);
    }

    console.log(`  роли демонстрации: ${[...составы].map(([р, с]) => `${р} — ${String(с.split("|").length)}`).join(", ")} разделов`);
    await page.click('.demorole .segmented__option:has-text("Руководитель")');
    await page.waitForTimeout(700);
  }
}

{
  const кнопка = page.locator(".feedback__open");
  if ((await кнопка.count()) === 0) {
    note("замечания", "виджета нет: демонстрация собрана без VITE_FEEDBACK_URL");
  } else {
    await кнопка.click();
    await page.waitForSelector('.sheet[aria-label="Замечание по демонстрации"]');
    const лист = page.locator('.sheet[aria-label="Замечание по демонстрации"]');

    /* Пустое замечание не отправляется: строка «» в таблице обзора —
       это работа человеку, который будет гадать, что имелось в виду. */
    const отправить = лист.locator('button[type="submit"]');
    if (!(await отправить.isDisabled())) {
      note("замечания", "пустое замечание можно отправить");
    }

    await лист.locator('.segmented__option:has-text("Дефект")').click();
    await лист.locator("textarea").fill("Проверка приёма: цифра готовности читается неоднозначно.");
    await лист.locator('.field:has(.field__label:text-is("Кто пишет")) input').fill("Обход проверки");
    await отправить.click();
    await page.waitForTimeout(700);

    const подтверждение = await лист.innerText().catch(() => "");
    if (!подтверждение.toLowerCase().includes("записано")) {
      note("замечания", `отправка не подтверждена: «${подтверждение.slice(0, 80).replace(/\n/gu, " ")}»`);
    }

    const строка = принятое.at(-1) ?? {};
    if (!String(строка.text ?? "").includes("цифра готовности")) {
      note("замечания", "приёмник не получил текста замечания");
    }
    if (строка.kind !== "Дефект") {
      note("замечания", `вид замечания не дошёл: «${String(строка.kind ?? "—")}»`);
    }
    /* Обстановка — половина ценности замечания: «непонятно» без экрана
       стоит столько же, сколько молчание. */
    if (String(строка.section ?? "").trim() === "") {
      note("замечания", "к замечанию не приложен экран, на котором оно написано");
    }
    if (!(Number(строка.width) > 0)) {
      note("замечания", "к замечанию не приложена ширина окна");
    }
    console.log(`  замечание принято: ${String(строка.kind ?? "—")}, экран «${String(строка.section ?? "—")}», ширина ${String(строка.width ?? "—")}`);
  }
}

await browser.close();
server.close();

if (environment.length > 0) {
  console.log(`Ограничения среды (не дефекты): ${new Set(environment).size}`);
}
console.log(problems.length === 0
  ? "Проверка демонстрации: замечаний нет"
  : `Проверка демонстрации:\n  ✗ ${problems.join("\n  ✗ ")}`);
process.exit(problems.length === 0 ? 0 : 1);
