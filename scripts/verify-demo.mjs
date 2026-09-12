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

const server = createServer((request, response) => {
  const адрес = new URL(request.url ?? "/", "http://x").pathname;
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

await раздел("Контрагенты");
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
/* Кнопка отметки оплаты стоит только у ждущего: кнопка, которая ответит
   отказом, не показывается вовсе. */
const ждущих = (ведомость.match(/ждёт оплаты|просрочено/gu) ?? []).length;
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

await browser.close();
server.close();

if (environment.length > 0) {
  console.log(`Ограничения среды (не дефекты): ${new Set(environment).size}`);
}
console.log(problems.length === 0
  ? "Проверка демонстрации: замечаний нет"
  : `Проверка демонстрации:\n  ✗ ${problems.join("\n  ✗ ")}`);
process.exit(problems.length === 0 ? 0 : 1);
