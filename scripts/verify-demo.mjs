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

/* Ожидаемых событий нет. Прежде им была недоступность шрифтов Google — с
   02.10.2026 гарнитуры раздаются из сборки (П-52), и обращение опубликованной
   страницы к узлам Google Fonts само есть дефект: адрес заказчика уходит
   третьей стороне. Всё на странице без сервера — дефект: ходить ей некуда. */
const ожидаемо = () => false;
page.on("request", (request) => {
  if (/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//u.test(request.url())) {
    note("гарнитуры", `страница обращается к Google Fonts: ${request.url().slice(0, 80)}`);
  }
});

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

/* --- Телефон 390 × 844 (план, этап Э7: пункты 7.1 и 7.2) ---------------------
   Демонстрацию заказчик открывает и с телефона, а два её органа живут
   только здесь: кнопка «Замечание» и панель «Смотреть глазами». На 390 px
   кнопка с подписью закрывала суммы карточек над нижней панелью, а панель
   ролей переносилась в три строки. Обход идёт по всем четырём ролям
   двойника: слой `api.demo.ts` отдаёт каждой свой состав, и ширину стережёт
   каждая. Сравнение — с `innerWidth`, как записано в плане. */
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
{
  const панель = await page.evaluate(() => {
    const узел = document.querySelector(".demorole");
    if (узел === null) return null;
    const видимые = [...узел.children].filter((ребёнок) => !ребёнок.classList.contains("visually-hidden"));
    const верхи = new Set(видимые.map((ребёнок) => Math.round(ребёнок.getBoundingClientRect().top)));
    const обрезанных = [...узел.querySelectorAll(".segmented__option")]
      .filter((роль) => роль.scrollWidth > роль.clientWidth + 1).length;
    return { строк: верхи.size, лишнее: узел.scrollWidth - узел.clientWidth, обрезанных };
  });
  if (панель === null) {
    note("7.1 смотреть глазами", "на 390 px панели ролей нет");
  } else if (панель.строк !== 1 || панель.лишнее > 1 || панель.обрезанных > 0) {
    note("7.1 смотреть глазами",
      `на 390 px панель ролей в ${панель.строк} строки, шире себя на ${панель.лишнее} px, обрезанных ролей ${панель.обрезанных}`);
  }

  const кнопка = page.locator(".feedback__open");
  if ((await кнопка.count()) === 1) {
    const подпись = (await кнопка.innerText()).trim();
    const имя = await кнопка.getAttribute("aria-label");
    if (подпись !== "" || имя !== "Замечание") {
      note("7.1 замечание", `на 390 px кнопка замечания — «${подпись}», имя «${String(имя)}»: ожидался значок с именем «Замечание»`);
    }
  }

  /* Кнопка стоит над нижней панелью, не шире значка и не закрывает чисел
     насовсем: в конце любой страницы под ней пустое поле. При прокрутке
     содержимое проходит под значком так же, как под самой нижней панелью, —
     плавающий орган иначе не устроен; дефектом было число, которое из-под
     подписанной кнопки нельзя вывести никакой прокруткой. Пункты списка
     «Ещё», раскрытого вверх в ту же зону, проверяются ниже. */
  const перекрытия = async (где) => {
    await page.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); });
    await page.waitForTimeout(200);
    const итог = await page.evaluate(() => {
      const кнопка = document.querySelector(".feedback__open");
      const панель = document.querySelector(".tabbar");
      if (кнопка === null) return { нет: true, надПанелью: true, чисел: [] };
      const к = кнопка.getBoundingClientRect();
      const надПанелью = панель === null || к.bottom <= панель.getBoundingClientRect().top + 1;
      const чисел = [...document.querySelectorAll(".num, .statcard__value, .figure__value, .score__value, .money__sum")]
        .filter((узел) => !кнопка.contains(узел))
        .map((узел) => ({ узел, р: узел.getBoundingClientRect() }))
        .filter(({ р }) => р.width > 0 && р.bottom > 0 && р.top < window.innerHeight)
        .filter(({ р }) => р.left < к.right && р.right > к.left && р.top < к.bottom && р.bottom > к.top)
        .map(({ узел }) => (узел.textContent ?? "").trim().slice(0, 24));
      return { нет: false, надПанелью, чисел, ширина: Math.round(к.width), высота: Math.round(к.height) };
    });
    if (итог.нет) return;
    if (!итог.надПанелью) note("7.1 замечание", `${где}: кнопка замечания заходит на нижнюю панель`);
    if (итог.ширина > 48 || итог.высота > 48) {
      note("7.1 замечание", `${где}: кнопка замечания ${итог.ширина} × ${итог.высота} px — шире значка`);
    }
    if (итог.чисел.length > 0) {
      note("7.1 замечание", `${где}: в конце страницы кнопка замечания закрывает числа — ${итог.чисел.join("; ")}`);
    }
  };

  const РАЗДЕЛЫ = [["home", "Главная"], ["requests", "Заявки"], ["projects", "Проекты"], ["contacts", "Контакты"], ["accounting", "Бухгалтерия"]];
  const ВКЛАДКИ = {
    "Обзор": "", "Замер": "/measure", "Смета": "/estimate", "Работа": "/work", "Приёмка": "/acceptance",
    "Чеки": "/expenses", "Отчёт": "/report", "Транши": "/tranches", "Документы": "/documents", "Импорт": "/import",
  };
  for (const роль of ["Руководитель", "Прораб", "Бухгалтер", "Заказчик"]) {
    await page.goto(`${BASE}/#home`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await page.click(`.demorole .segmented__option:has-text("${роль}")`);
    await page.waitForTimeout(800);
    const экраны = [...РАЗДЕЛЫ.map(([ключ, подпись]) => [`#${ключ}`, подпись])];
    await page.goto(`${BASE}/#R-99`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    const вкладки = (await page.locator(".tabs__item").allTextContents()).map((текст) => текст.trim());
    for (const вкладка of вкладки) {
      if (ВКЛАДКИ[вкладка] !== undefined) экраны.push([`#R-99${ВКЛАДКИ[вкладка]}`, `R-99 · ${вкладка}`]);
    }
    for (const [адрес, подпись] of экраны) {
      await page.goto(`${BASE}/${адрес}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      const лишнее = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (лишнее > 0) note("7.1 узкая ширина", `демонстрация, ${роль.toLowerCase()}: «${подпись}» шире окна на ${лишнее} px`);
      await перекрытия(`${роль.toLowerCase()}, «${подпись}»`);
    }
    if (вкладки.length > 0) {
      await page.goto(`${BASE}/#R-99`, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      const верх = await page.evaluate(() => {
        const полоса = document.querySelector('.tabs[role="tablist"]');
        return полоса === null ? null : Math.round(полоса.getBoundingClientRect().top + window.scrollY);
      });
      if (верх === null || верх >= 844) {
        note("7.2 карточка на телефоне", `демонстрация, ${роль.toLowerCase()}: верх полосы вкладок ${String(верх)} px — ниже первого экрана`);
      }
    }
  }

  /* Список «Ещё» нижней панели раскрывается вверх — в зону кнопки. */
  await page.goto(`${BASE}/#home`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.click('.demorole .segmented__option:has-text("Руководитель")');
  await page.waitForTimeout(600);
  const ещё = page.locator(".tabbar__more > summary");
  if ((await ещё.count()) > 0) {
    await ещё.click();
    await page.waitForTimeout(300);
    const закрыто = await page.evaluate(() => [...document.querySelectorAll(".tabbar__menu button, .tabbar__menu a")]
      .filter((пункт) => {
        const р = пункт.getBoundingClientRect();
        const сверху = document.elementFromPoint(р.left + р.width / 2, р.top + р.height / 2);
        return сверху === null || !пункт.contains(сверху);
      })
      .map((пункт) => (пункт.textContent ?? "").trim()));
    if (закрыто.length > 0) note("7.1 замечание", `пункты списка «Ещё» закрыты сверху: ${закрыто.join(", ")}`);
    await ещё.click();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

/* --- Коллаж дня и следующее действие (план, этап Э7: пункты 7.7 и 7.8) -------
   Снимки отчёта двойник отдаёт из каталога демонстрации, и его дефект —
   одна картинка на любой опознаватель — виден только здесь: на стенде
   снимки лежат на сервере. Блок «Выполнено N из M» строится из фактов
   слепка: слепок, снятый без них, оставил бы «Обзор» без блока, а стенд
   этого не заметил бы. */
{
  const войти = async (роль) => {
    await page.goto(`${BASE}/#home`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await page.click(`.demorole .segmented__option:has-text("${роль}")`);
    await page.waitForTimeout(600);
  };

  await войти("Руководитель");
  await page.goto(`${BASE}/#R-99/report`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const коллажи = await page.$$eval(".collage", (узлы) => узлы.map((узел) => {
    const снимки = [...узел.querySelectorAll(".collage__tile img")];
    return {
      адреса: снимки.map((снимок) => снимок.getAttribute("src") ?? ""),
      загружено: снимки.every((снимок) => снимок.complete && снимок.naturalWidth > 0),
      ещё: (узел.querySelector(".collage__more")?.textContent ?? "").trim(),
    };
  }));
  const полный = коллажи.find((коллаж) => коллаж.ещё !== "");
  if (коллажи.length === 0) {
    note("7.7 коллаж дня", "в отчёте демонстрации коллажа нет");
  } else if (полный === undefined) {
    note("7.7 коллаж дня", "в демонстрации нет дня, где снимков больше трёх: «+N» не показан");
  } else {
    const разных = new Set(полный.адреса).size;
    if (полный.адреса.length !== 3 || разных !== 3) {
      note("7.7 коллаж дня", `в коллаже ${полный.адреса.length} плиток, разных снимков ${разных}: двойник отдаёт одну картинку`);
    }
    if (!полный.загружено) note("7.7 коллаж дня", "снимок коллажа не загрузился");
    await page.locator(".collage", { has: page.locator(".collage__more") }).first()
      .locator(".collage__tile").first().click();
    await page.waitForTimeout(400);
    const окно = page.locator('[role="dialog"][aria-label="Просмотр снимков"]');
    if ((await окно.count()) === 0) {
      note("7.7 коллаж дня", "нажатие на снимок не открыло просмотр");
    } else {
      const снимок = async () => окно.locator("img").first().getAttribute("src");
      const был = await снимок();
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(200);
      if ((await снимок()) === был) note("7.7 коллаж дня", "клавиша → не сменила снимок просмотра");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      if ((await окно.count()) > 0) note("7.7 коллаж дня", "Esc не закрыл просмотр");
    }
  }

  /* 7.8. Блок стоит у руководителя на «Обзоре» каждой карточки — факты
     сняты по всем объектам; прорабу маршрут фактов закрыт, блока у него нет. */
  await page.goto(`${BASE}/#projects`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const коды = await page.$$eval(".objecttile__link", (ссылки) => ссылки
    .map((ссылка) => /#(R-\d+)$/u.exec(ссылка.getAttribute("href") ?? "")?.[1] ?? "")
    .filter((код) => код !== ""));
  if (коды.length === 0) note("7.8 следующее действие", "демонстрация: в портфеле нет ссылок на карточки");
  for (const код of коды) {
    await page.goto(`${BASE}/#${код}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const заголовок = (await page.locator("#overview-next-head").first().innerText().catch(() => "")).trim();
    if (!/^Выполнено \d+ из 9$/u.test(заголовок)) {
      note("7.8 следующее действие", `демонстрация, руководитель, ${код}: заголовок блока «${заголовок || "нет блока"}»`);
    }
  }
  await войти("Прораб");
  await page.goto(`${BASE}/#R-99`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  if ((await число(".nextstep")) > 0) note("7.8 следующее действие", "демонстрация: прораб видит блок «Выполнено N из M»");
}

/* --- Чей ход и поле «Ждём» (этап Э8, ДР-4) -----------------------------------
   Двойник отдаёт транши, акты и чеки R-99 из слепка, снятого до проверок:
   транш № 1 закрыт и не оплачен, его акт не подписан, черновик чека есть.
   Смена статуса в двойнике держит тот же контракт, что сервер. */
{
  await page.goto(`${BASE}/#home`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.click('.demorole .segmented__option:has-text("Руководитель")');
  await page.waitForTimeout(600);
  const ОЖИДАНИЕ = [
    ["tranches", ".tranche__row .turn", /^Закрыт \d{2}\.\d{2} · ждёт оплаты заказчиком · /u, "транша"],
    ["documents", ".record .turn", /^Сформирован · ждёт подписи заказчика$/u, "акта"],
    ["expenses", ".record .turn", /^Черновик · ждёт руководителя$/u, "черновика чека"],
  ];
  for (const [вкладка, где, образец, чего] of ОЖИДАНИЕ) {
    await page.goto(`${BASE}/#R-99/${вкладка}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    const строки = (await page.locator(где).allTextContents()).map((текст) => текст.trim());
    if (!строки.some((строка) => образец.test(строка))) {
      note("ДР-4 чей ход", `демонстрация, R-99: у ${чего} нет строки «чей ход» — «${строки.join(" | ") || "строк нет"}»`);
    }
  }
  await page.goto(`${BASE}/#R-99`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const открыть = page.locator('.summary__status button:has-text("Изменить статус")');
  if ((await открыть.count()) === 0) {
    note("ДР-4 ждём", "демонстрация: у руководителя нет «Изменить статус»");
  } else {
    await открыть.first().click();
    await page.waitForTimeout(300);
    const лист = page.locator('[role="dialog"][aria-label="Статус объекта"]');
    await лист.locator("button", { hasText: "Ждёт ответа" }).click();
    await page.waitForTimeout(200);
    await лист.locator('button[type="submit"]').click().catch(() => { /* поля нет — замечание ниже */ });
    await page.waitForTimeout(500);
    const отказ = ((await лист.locator(".field__error").first().textContent().catch(() => "")) ?? "").trim();
    if (!/«Ждём»/u.test(отказ)) note("ДР-4 ждём", `демонстрация: «Ждёт ответа» без поля — отказ «${отказ || "нет"}»`);
    await лист.locator("textarea").fill("Демонстрация: выбор плитки").catch(() => { /* поля нет */ });
    await лист.locator('button[type="submit"]').click().catch(() => { /* поля нет */ });
    await page.waitForTimeout(700);
    const вШтампе = ((await page.locator(".stamp .turn--waiting").first().textContent().catch(() => "")) ?? "").trim();
    if (вШтампе !== "Ждём: Демонстрация: выбор плитки") note("ДР-4 ждём", `демонстрация: в штампе «${вШтампе || "нет строки"}»`);
  }
}

/* --- Значки доказательности (этап Э8, ДР-7) ---------------------------------
   Пакеты приёмки и чеки R-99 в слепке — со снимками: значок у каждой строки. */
{
  await page.goto(`${BASE}/#home`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.click('.demorole .segmented__option:has-text("Руководитель")');
  await page.waitForTimeout(600);
  for (const [вкладка, строки, подтверждено, что] of [
    ["acceptance", ".accept__batch", ".accept__batch:has(img.accept__photo)", "пакеты приёмки"],
    ["expenses", ".record", ".record:has(img.record__photo)", "чеки"],
  ]) {
    await page.goto(`${BASE}/#R-99/${вкладка}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    const всего = await page.locator(подтверждено).count();
    const значков = await page.locator(`${строки} .evidence[role="img"][aria-label="Есть снимок"]`).count();
    if (всего === 0 || значков !== всего) {
      note("ДР-7 значки", `демонстрация, R-99, ${что}: строк со снимком ${всего}, значков «Есть снимок» ${значков}`);
    }
  }
}

/* --- Лента событий (этап Э8, ДР-5) ------------------------------------------
   Лента двойника снята с сервера от каждой роли: у записей есть группа
   отбора, у руководителя — приёмки. Отбор оставляет только записи вида. */
{
  for (const [роль, ждём] of [["Руководитель", "Все|Приёмка|Деньги|Смета|График|Документы"], ["Прораб", "Все|Приёмка|Деньги|Смета|График"], ["Заказчик", "Все|Смета|График"]]) {
    await page.goto(`${BASE}/#home`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await page.click(`.demorole .segmented__option:has-text("${роль}")`);
    await page.waitForTimeout(600);
    await page.goto(`${BASE}/#R-99`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    const пункты = (await page.locator("#panel-overview .feedfilter .segmented__option").allTextContents())
      .map((т) => т.trim()).join("|");
    if (пункты !== ждём) note("ДР-5 лента", `демонстрация, ${роль.toLowerCase()}: пункты отбора «${пункты || "нет отбора"}» вместо «${ждём}»`);
    if (роль === "Руководитель" && пункты === ждём) {
      await page.locator("#panel-overview .feedfilter .segmented__option", { hasText: "Приёмка" }).click();
      await page.waitForTimeout(250);
      const заголовки = (await page.locator("#panel-overview .feed__title").allTextContents()).map((т) => т.trim());
      if (заголовки.length === 0 || заголовки.some((з) => !/^(?:Приёмка|Чеки):/u.test(з))) {
        note("ДР-5 лента", `демонстрация, руководитель, отбор «Приёмка»: «${заголовки.slice(0, 3).join("», «") || "пусто"}»`);
      }
    }
  }
}

/* --- Сводка объекта в проекции роли (этап Э8, ДР-0; полный аудит, П-56) -----
   Двойник отдаёт сводку из слепка, снятого от каждой роли. Слепок, снятый
   прежним сервером, нёс заказчику ориентир по заявке, потраченное и остаток
   транша, — и демонстрация показала бы утечку, которой на сервере уже нет. */
{
  const ВЕЛИЧИНЫ = ["Ориентир по заявке", "Потрачено на материалы", "Остаток текущего транша"];
  for (const [роль, видно] of [["Руководитель", ВЕЛИЧИНЫ], ["Прораб", ВЕЛИЧИНЫ.slice(1)], ["Заказчик", []]]) {
    await page.goto(`${BASE}/#home`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await page.click(`.demorole .segmented__option:has-text("${роль}")`);
    await page.waitForTimeout(600);
    await page.goto(`${BASE}/#R-99`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    const подписи = (await page.locator(".figure__label").allTextContents()).map((текст) => текст.trim());
    for (const величина of ВЕЛИЧИНЫ) {
      const есть = подписи.some((подпись) => подпись.startsWith(величина));
      if (есть && !видно.includes(величина)) note("ДР-0 сводка по ролям", `демонстрация, ${роль.toLowerCase()}: в сводке R-99 стоит «${величина}»`);
      if (!есть && видно.includes(величина)) note("ДР-0 сводка по ролям", `демонстрация, ${роль.toLowerCase()}: в сводке R-99 нет «${величина}»`);
    }
  }
}

/* --- Очередь «Ждёт вашего действия» (этап Э8, ДР-1) -------------------------
   Двойник считает пункты R-99 по живому состоянию теми же правилами домена,
   что сервер: число пункта обязано совпасть с полосой отбора и с записями
   экрана, куда ведёт кнопка. У заказчика очередь — первый блок «Обзора». */
{
  const ЗАПИСИ = {
    expenses: "#panel-expenses .records > li",
    documents: "#panel-documents .records > li",
    tranches: "#panel-tranches .tranche__row",
    acceptance: "#panel-acceptance .accept__sections [role='tab']",
  };
  const сверено = [];
  for (const роль of ["Руководитель", "Бухгалтер", "Прораб", "Заказчик"]) {
    await page.goto(`${BASE}/#home`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await page.click(`.demorole .segmented__option:has-text("${роль}")`);
    await page.waitForTimeout(700);
    /* Адрес — после смены роли: «Главная» заказчику закрыта, и адрес,
       набранный до смены, у него откатывается на объект. */
    await page.goto(`${BASE}/${роль === "Заказчик" ? "#R-99" : "#home"}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.waitForSelector(".queue .queue__row, .queue .queue__empty", { timeout: 6000 })
      .catch(() => { note("ДР-1 очередь", `демонстрация, ${роль.toLowerCase()}: очереди нет`); });
    const первый = await page.evaluate((заказчик) => (заказчик
      ? document.querySelector("#panel-overview > .stack")
      : document.querySelector("main.container"))?.firstElementChild?.className ?? "", роль === "Заказчик");
    if (!первый.split(" ").includes("queue")) note("ДР-1 очередь", `демонстрация, ${роль.toLowerCase()}: первый блок «${первый}», а не очередь`);
    const пункты = await page.locator(".queue__row").evaluateAll((строки) => строки.map((строка) => ({
      текст: (строка.querySelector(".queue__what")?.textContent ?? "").trim(),
      адрес: строка.querySelector(".queue__go")?.getAttribute("href") ?? "",
      число: Number(строка.querySelector(".queue__go")?.getAttribute("data-count") ?? "0"),
    })));
    if (роль === "Руководитель" && пункты.length === 0) note("ДР-1 очередь", "демонстрация, руководитель: очередь пуста — проверять нечего");
    if (роль === "Заказчик" && пункты.length === 0) note("ДР-1 очередь", "демонстрация, заказчик: нового с прошлого входа нет — проверять нечего");
    сверено.push(`${роль.toLowerCase()} ${String(пункты.length)}`);
    for (const пункт of пункты) {
      if (!пункт.адрес.includes("?")) continue;
      await page.goto(`${BASE}/${пункт.адрес}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(900);
      const вПолосе = Number((await page.locator(".filterbar").first().getAttribute("data-count").catch(() => null)) ?? "-1");
      if (вПолосе !== пункт.число) note("ДР-1 очередь", `демонстрация, ${роль.toLowerCase()}, «${пункт.текст}»: пункт ${пункт.число}, полоса ${вПолосе}`);
      const экран = /^#[A-Z]-\d+\/([a-z]+)/u.exec(пункт.адрес)?.[1] ?? "";
      if (ЗАПИСИ[экран] !== undefined) {
        const записей = await page.locator(ЗАПИСИ[экран]).count();
        if (записей !== пункт.число) note("ДР-1 очередь", `демонстрация, ${роль.toLowerCase()}, «${пункт.текст}»: пункт ${пункт.число}, на экране ${записей}`);
      }
    }
  }
  console.log(`ДР-1: очередь демонстрации — пунктов ${сверено.join(", ")}; числа сверены с полосой отбора и экраном`);
}

/* --- «Как пользоваться» заказчика (этап Э8, ДР-11) ---------------------------
   Отметка захода в слепке есть, и сам экран не показывается; «Ещё → Как
   пользоваться» открывает его: три блока, «Как связаться» — организация. */
{
  await page.goto(`${BASE}/#home`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.click('.demorole .segmented__option:has-text("Заказчик")');
  await page.waitForTimeout(700);
  if ((await page.locator(".guide").count()) > 0) note("ДР-11 первый вход", "демонстрация: экран первого входа показан заказчику с отметкой захода");
  await page.locator(".appbar__more summary").click({ timeout: 5000 }).catch(() => { /* ниже — замечание */ });
  await page.locator('.appbar__menu .appbar__menu-item:has-text("Как пользоваться")').click({ timeout: 5000 })
    .catch(() => { note("ДР-11 первый вход", "демонстрация: в «Ещё» заказчика нет пункта «Как пользоваться»"); });
  await page.waitForTimeout(500);
  const заголовок = ((await page.locator(".cover h1").textContent().catch(() => "")) ?? "").trim();
  if (заголовок !== "Как пользоваться «Приёмкой»") note("ДР-11 первый вход", `демонстрация: «Ещё → Как пользоваться» — «${заголовок || "экрана нет"}»`);
  const блоки = (await page.locator(".guide h2").allTextContents()).map((текст) => текст.trim()).join("|");
  if (блоки !== "Что вы здесь видите|Что нужно от вас|Как связаться") note("ДР-11 первый вход", `демонстрация: блоки «${блоки}»`);
  console.log("ДР-11: «Как пользоваться» заказчика проверен из «Ещё»");
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
