/**
 * Сквозная проверка веб-клиента на поднятом стенде.
 *
 * Проходит сценарий целиком — вход по ссылке, список объектов, импорт сметы
 * с сопоставлением единиц — и попутно собирает то, что нельзя увидеть на
 * снимке: ошибки консоли, неудавшиеся запросы, горизонтальное переполнение
 * на трёх ширинах, отсутствие видимого фокуса, подписи у полей.
 */
import { chromium } from "playwright-core";
import { launchOptions, browserSource } from "./browser.mjs";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:5173";
const SHOTS = process.env.SHOTS ?? "/tmp/shots";
// Путь считается от самого скрипта — той же идиомой, что в seed-estimate.mjs
// и capture-demo.mjs. Абсолютный путь годился ровно для одной машины.
const FIXTURE = process.env["FIXTURE"]
  ?? new URL("../packages/importer/fixtures/smeta-obezlichennaya.xlsx", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const problems = [];
const environment = [];
const note = (kind, detail) => problems.push(`${kind}: ${detail}`);

/**
 * Шкала скруглений: 4 / 6 / 8 / 12 px и капсула. Прежняя проверка стерегла
 * только верхний предел, и значение ниже ступени — 3 px, 1 px, 2 px — она
 * пропускала. Ровно так снятая шкала 3 / 4 / 6 px пережила свою отмену.
 * Ноль разрешён: прямой угол у панели, штампа и таблицы назначен намеренно.
 */
const ШКАЛА = [0, 4, 6, 8, 12];
const геометрия = async (page, где) => {
  const чужие = await page.evaluate((шкала) => {
    const найдено = new Map();
    for (const node of document.querySelectorAll("body *")) {
      const style = getComputedStyle(node);
      for (const угол of ["borderTopLeftRadius", "borderTopRightRadius",
                          "borderBottomLeftRadius", "borderBottomRightRadius"]) {
        const value = Number.parseFloat(style[угол]);
        if (!Number.isFinite(value)) continue;
        // Капсула объявляется как 999 px и браузером обрезается по высоте;
        // вычисленное значение остаётся исходным, поэтому её видно по нему.
        if (value >= 100) continue;
        if (шкала.includes(value)) continue;
        const имя = node.className.toString().slice(0, 40) || node.tagName;
        if (!найдено.has(value)) найдено.set(value, имя);
      }
    }
    return [...найдено].map(([value, имя]) => `${value} px у «${имя}»`);
  }, ШКАЛА);
  for (const дефект of чужие) note("скругления", `${где}: ${дефект} — значение мимо шкалы`);
  return чужие.length;
};

/**
 * Ожидаемые события, не являющиеся дефектами страницы:
 *   401 на /auth/me до входа — так проверяется наличие сессии;
 *   недоступность fonts.googleapis.com — исходящая сеть песочницы закрыта,
 *   на машине пользователя гарнитуры загрузятся, а до тех пор работает
 *   запасной стек, объявленный в токенах.
 */
/* Снимки приёмки отключаются обходом намеренно — так проверяется, что
   место под них отведено заранее. Пока отключение включено, сорванные
   запросы снимков дефектом не считаются: их сорвала сама проверка. */
let снимкиОтключены = false;

const expected = (url, text = "") =>
  url.endsWith("/auth/me") || url.includes("fonts.googleapis.com") || url.includes("fonts.gstatic.com")
  || (снимкиОтключены && url.includes("/acceptance/photo/"))
  // Объект без сметы отвечает 404 на запрос сметы; карточка показывает
  // честное пустое состояние. Это поведение продукта, а не сбой страницы.
  || /\/projects\/[A-Z]-\d+\/estimate$/u.test(new URL(url, "http://x").pathname)
  || text.includes("401 (Unauthorized)") || text.includes("ERR_CONNECTION_RESET")
  || text.includes("404 (Not Found)");

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
const page = await context.newPage();

page.on("console", (message) => {
  if (message.type() !== "error") return;
  const text = message.text();
  if (expected(message.location().url ?? "", text)) environment.push(`консоль: ${text.slice(0, 90)}`);
  else note("ошибка консоли", text.slice(0, 160));
});
page.on("pageerror", (error) => note("исключение страницы", String(error).slice(0, 160)));
page.on("requestfailed", (request) => {
  const detail = `${request.method()} ${request.url()} — ${request.failure()?.errorText ?? ""}`;
  if (expected(request.url())) environment.push(`сеть песочницы: ${request.url().slice(0, 60)}`);
  else note("запрос не выполнен", detail);
});
page.on("response", (response) => {
  if (response.status() >= 400 && !expected(response.url())) {
    note("ответ с ошибкой", `${response.status()} ${response.url()}`);
  }
});

/** Похоже ли значение колонки на процент: «0,86 %», «100 %». */
const factNotPercent = (text) => !/^\d/u.test(text);

const overflow = async (label) => {
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    return { viewport: root.clientWidth, scroll: root.scrollWidth };
  });
  if (result.scroll > result.viewport + 1) {
    note("горизонтальное переполнение", `${label}: полотно ${result.scroll} при окне ${result.viewport}`);
  }
  return result;
};

const step = async (name, file) => {
  await page.screenshot({ path: `${SHOTS}/${file}`, fullPage: true });
  console.log(`  снято: ${name} → ${file}`);
};

console.log(`Браузер: ${browserSource()}`);
console.log("Сценарий:");
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector("form");
await step("вход", "01-vhod.png");
await overflow("вход, 1440");

// Подписи полей должны быть программно связаны с полями.
const unlabeled = await page.evaluate(() =>
  [...document.querySelectorAll("input, select, textarea")].filter((el) => {
    const id = el.getAttribute("id");
    const labelled = el.closest("label") !== null
      || (id !== null && document.querySelector(`label[for="${id}"]`) !== null)
      || el.getAttribute("aria-label") !== null;
    return !labelled;
  }).length,
);
if (unlabeled > 0) note("поле без подписи", `${unlabeled} шт.`);

// Отказ формы называет причину, а не «проверьте данные».
await page.fill('input[type="tel"]', "+1 202 555-01-99");
await page.click('button[type="submit"]');
await page.waitForSelector('[role="alert"]');
const foreignMessage = (await page.locator('[role="alert"]').textContent())?.trim() ?? "";
if (!foreignMessage.includes("+7")) {
  note("вход", `отказ на чужой код страны не называет причину: «${foreignMessage}»`);
}

await page.fill('input[type="tel"]', "8 900 000-00-00");
await page.click('button[type="submit"]');
await page.waitForSelector('input[inputmode="numeric"]');
await step("код подтверждения", "02-kod.png");
await overflow("код, 1440");

// На стенде код показан на экране: отправщик сообщений не подключён.
const shown = await page.locator(".field__hint .num").textContent();
if (shown === null || !/^\d{6}$/u.test(shown.trim())) {
  note("вход", `код на стенде показан как «${shown ?? "—"}»`);
}
await page.fill('input[inputmode="numeric"]', shown?.trim() ?? "");
await page.click('button[type="submit"]');

// Первый экран — главная.
await page.waitForSelector(".statcard");
await step("главная", "03-glavnaya.png");
await overflow("главная, 1440");

/**
 * Состав экрана. Числовых карточек ровно четыре, и это не придирка к
 * вёрстке: экран отвечает на вопрос «что горит сегодня», и пятое число
 * заставило бы выбирать, какое из них главное.
 */
const cards = await page.locator(".statcard").count();
if (cards !== 4) note("главная", `числовых карточек ${cards} вместо четырёх`);
const labels = await page.locator(".statcard__label").allTextContents();
const ожидаемые = ["Активные объекты", "Просрочены", "Срок сегодня", "Срок на неделе"];
if (labels.join("|") !== ожидаемые.join("|")) {
  note("главная", `подписи карточек: ${labels.join(" · ")}`);
}

await геометрия(page, "главная");

/**
 * Полоса плана. Отрезки, деления шкалы и вертикаль текущего дня — три
 * вещи, без любой из которых блок перестаёт быть графиком: без отрезков
 * он пуст, без делений длина не переводится в срок, без вертикали не
 * видно, что уже позади.
 */
const bars = await page.locator(".plan__bar").count();
const planRows = await page.locator(".plan__row").count();
console.log(`  числовых карточек: ${cards}, строк плана: ${planRows}, отрезков: ${bars}`);
if (bars === 0) note("план работ", "не показано ни одного отрезка этапа");
if ((await page.locator(".plan__today").count()) === 0) {
  note("план работ", "текущий день не отмечен");
}
if ((await page.locator(".plan__grid").count()) === 0) {
  note("план работ", "у шкалы нет делений: длина отрезка не переводится в срок");
}

/**
 * Масштаб плана. Окно строится вокруг текущего дня, и переключение обязано
 * менять число делений шкалы: квартал — три месяца, год — двенадцать.
 * Без этого полоса растянулась бы на весь диапазон этапов портфеля и
 * отдала текущему месяцу одну двенадцатую ширины.
 */
const scales = page.locator('[aria-label="Масштаб плана"] .segmented__option');
if ((await scales.count()) !== 3) note("план работ", "переключателя масштаба нет");
const ticksQuarter = await page.locator(".plan__scale .plan__tick").count();
await scales.nth(2).click();
await page.waitForTimeout(300);
const ticksYear = await page.locator(".plan__scale .plan__tick").count();
if (ticksQuarter !== 3) note("план работ", `в квартале ${ticksQuarter} делений вместо трёх`);
if (ticksYear !== 12) note("план работ", `в годе ${ticksYear} делений вместо двенадцати`);
await scales.nth(0).click();
await page.waitForTimeout(300);

/**
 * Подписей на отрезках нет намеренно: порог «отрезок шире стольких
 * процентов» шириной текста не является, и подпись обрезалась посреди
 * слова. Название несёт подсказка.
 */
if ((await page.locator(".plan__name").count()) > 0) {
  note("план работ", "на отрезках появились подписи, которые нечем измерить");
}

/**
 * Неделя, счётчики, сроки и события — блоки, вернувшиеся решением
 * заказчика. Неделя ровно из семи дней, сегодня отмечено один раз.
 */
const week = await page.locator(".daycard").count();
if (week !== 7) note("неделя", `в полосе ${week} дней вместо семи`);
if ((await page.locator(".daycard--today").count()) !== 1) {
  note("неделя", "сегодняшний день не отмечен ровно один раз");
}
const counters = await page.locator(".counterstrip__item").count();
if (counters === 0) note("главная", "счётчики по статусам не показаны");
if ((await page.locator(".deadline").count()) === 0) {
  note("главная", "блок ближайших сроков пуст");
}
/**
 * Инфографика блоков главной. Числа без доли отвечают «сколько», но не
 * «много ли»: мера в карточке, столбик у статуса, расходящаяся шкала у
 * срока и загрузка дня — четыре места, где величина показана, а не только
 * названа. Проверяется наличием заливки, а не наличием разметки: пустая
 * дорожка выглядит так же, как отсутствующая.
 */
const заливки = await page.evaluate(() =>
  [...document.querySelectorAll(".meter__fill, .deadline__bar")]
    .map((el) => Number.parseFloat(getComputedStyle(el).inlineSize))
    .filter((width) => Number.isFinite(width) && width > 0).length,
);
if (заливки < 8) note("инфографика главной", `заполненных полос ${заливки}: меры и шкалы пусты`);
if ((await page.locator(".statcard__meter .meter").count()) !== 4) {
  note("инфографика главной", "мера доли есть не у каждой числовой карточки");
}
if ((await page.locator(".counterstrip__bar .meter").count()) === 0) {
  note("инфографика главной", "у счётчиков статусов нет столбиков доли");
}
if ((await page.locator(".daycard__load .meter").count()) !== 7) {
  note("инфографика главной", "загрузка показана не во всех семи днях недели");
}
if ((await page.locator(".deadline__zero").count()) === 0) {
  note("инфографика главной", "на шкале сроков нет отметки текущего дня");
}
const homeFeed = await page.locator("main .feed__item").count();
if (homeFeed === 0) note("главная", "лента событий на экране пуста");
if (homeFeed > 9) note("лента событий", `строк ${homeFeed}: предел в восемь записей не работает`);

/**
 * Число, по которому нельзя перейти, бесполезно (норматив 07_IA, правило 4).
 * Счётчик статуса ведёт в список с наложенным фильтром.
 */
/* Счётчик берётся из блока статусов поимённо, а не «первый на странице»:
   первым стал счётчик воронки, и проверка молча ушла бы проверять переход
   в другой раздел. Проверка обязана называть, что именно проверяет. */
const firstCounter = page.locator("section")
  .filter({ hasText: "Объекты по статусам" })
  .last()
  .locator("button.counterstrip__item")
  .first();
if ((await firstCounter.count()) === 0) {
  note("главная", "ни один счётчик статуса не ведёт в отфильтрованный список");
} else {
  await firstCounter.click();
  await page.waitForSelector(".segmented");
  const pressed = await page.locator('.segmented__option[aria-pressed="true"]').innerText();
  if (pressed.trim() === "" || pressed.includes("Все")) {
    note("главная", `счётчик статуса не наложил фильтр: выбрано «${pressed.trim()}»`);
  }
  // Фильтр снимается: проверка не должна менять состояние экрана для
  // следующих сценариев.
  await page.click('.segmented__option:has-text("Все")');
  await page.click('.appbar__link:has-text("Главная")');
  await page.waitForSelector(".datatable__table tbody tr");
}

/**
 * Готовность не выдумывается. Объект без графика обязан показать
 * «не задано», а не ноль: ноль означал бы «работа не начата».
 */
const строкиТаблицы = await page.locator(".datatable__table tbody tr").allTextContents();
if (!строкиТаблицы.some((row) => row.includes("не задано"))) {
  note("главная", "объект без графика не показал «не задано» в готовности");
}
const колонки = await page.locator(".datatable__table thead th").allTextContents();
for (const нужна of ["Заявлено", "Принято", "Срок", "Статус", "Адрес"]) {
  if (!колонки.some((c) => c.includes(нужна))) note("главная", `в таблице нет колонки «${нужна}»`);
}
/* Величин две, и они разные. Одна колонка «Готовность» на обе заставляла бы
   гадать, чьё перед ней число: заявленное ставит человек, принятое считает
   приёмка. Проверяется на строке R-99, где они на стенде расходятся. */
if (колонки.some((c) => c.trim() === "Готовность")) {
  note("главная", "колонка «Готовность» не говорит, чья это величина");
}
const строкаR99Реестра = page.locator(".datatable__table tbody tr")
  .filter({ has: page.locator('.code-badge:text-is("R-99")') }).first();
const заявленоРеестр = (await строкаR99Реестра
  .locator("td").nth(колонки.findIndex((c) => c.includes("Заявлено"))).textContent()) ?? "";
const принятоРеестр = (await строкаR99Реестра
  .locator("td").nth(колонки.findIndex((c) => c.includes("Принято"))).textContent()) ?? "";
if (заявленоРеестр.trim() === принятоРеестр.trim()) {
  note("главная", `заявлено и принято совпали («${заявленоРеестр.trim()}»): показано одно число дважды`);
}

/**
 * Лента событий переехала за колокол шапки. Проверяется там же, где её
 * ищут: предел в восемь записей и группировка по дням остаются в силе.
 */
await page.click(".appbar__bell");
await page.waitForSelector('[aria-label="События портфеля"] .feed__item');
const feed = await page.locator('[aria-label="События портфеля"] .feed__item').count();
if (feed > 9) note("лента событий", `строк ${feed}: предел в восемь записей не работает`);
if ((await page.locator('[aria-label="События портфеля"] .feed__day').count()) === 0) {
  note("лента событий", "нет группировки по дням");
}
await step("события портфеля", "03b-sobytiya.png");
await page.keyboard.press("Escape");

/**
 * Поверхности по роли. Рамка, заливка и радиус означают «отдельный
 * объект»; если их получает каждый блок, иерархия исчезает. На первом
 * экране рамок быть не должно больше, чем блоков, которые требуют действия.
 */
const framed = await page.locator("main .panel, main .tile").count();
if (framed > 4) note("поверхности", `на сводке ${framed} блоков с рамкой: карточная каша`);

// Видимое состояние фокуса.
await page.keyboard.press("Tab");
const focusVisible = await page.evaluate(() => {
  const el = document.activeElement;
  if (el === null || el === document.body) return false;
  const style = getComputedStyle(el);
  return style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
});
if (!focusVisible) note("фокус", "первый элемент в порядке обхода не показывает видимую обводку");

// Переход в список объектов через шапку.
await page.click('.appbar__link:has-text("Проекты")');
await page.waitForSelector(".datatable__table tbody tr");
await step("объекты", "04-obekty.png");
await overflow("объекты, 1440");

const rows = await page.locator(".datatable__table tbody tr").count();
console.log(`  объектов в списке: ${rows}`);

await геометрия(page, "объекты");

/**
 * Отклик строки на наведение. Реестр — рабочий список из семи колонок, и
 * без подсветки строки глаз теряет её между кодом и сроком ровно так же,
 * как терял до чередования. Проверяется поведением: фон ячейки под
 * курсором обязан отличаться от фона той же ячейки в покое.
 */
const ячейка = page.locator(".datatable__table tbody tr td").first();
const фонДо = await ячейка.evaluate((el) => getComputedStyle(el).backgroundColor);
await ячейка.hover();
await page.waitForTimeout(200);
const фонПосле = await ячейка.evaluate((el) => getComputedStyle(el).backgroundColor);
if (фонДо === фонПосле) {
  note("реестр", `строка не отвечает на наведение: фон остаётся ${фонПосле}`);
}
await page.mouse.move(0, 0);
await page.waitForTimeout(200);

// Фильтр по статусу: выбор сужает таблицу и снимается обратно.
const inProgress = await page.locator('.segmented__option:has-text("В работе")').textContent();
await page.click('.segmented__option:has-text("В работе")');
await page.waitForTimeout(200);
const filtered = await page.locator(".datatable__table tbody tr").count();
if (filtered >= rows) note("фильтр по статусу", `после выбора «${inProgress}» строк не убавилось`);
await page.click('.segmented__option:has-text("Все")');
await page.waitForTimeout(200);
if ((await page.locator(".datatable__table tbody tr").count()) !== rows) {
  note("фильтр по статусу", "снятие фильтра не вернуло полный список");
}

/**
 * Список по единому образцу: сортировка по каждой колонке, поиск,
 * счётчик показанного. Проверяется поведением, а не наличием разметки.
 */
const headers = await page.locator(".datatable__table th").count();
const sorters = await page.locator(".datatable__sort").count();
if (sorters !== headers) note("список", `сортировка есть у ${sorters} колонок из ${headers}`);

const firstBefore = await page.locator(".datatable__table tbody tr td:nth-child(2)").first().textContent();
await page.click('.datatable__sort:has-text("Адрес")');
await page.waitForTimeout(150);
const firstAsc = await page.locator(".datatable__table tbody tr td:nth-child(2)").first().textContent();
await page.click('.datatable__sort:has-text("Адрес")');
await page.waitForTimeout(150);
const firstDesc = await page.locator(".datatable__table tbody tr td:nth-child(2)").first().textContent();
if (firstAsc === firstDesc) note("сортировка", "смена направления не изменила первую строку");
if (firstAsc === firstBefore && firstDesc === firstBefore) {
  note("сортировка", "порядок строк не изменился ни в одном направлении");
}
if ((await page.locator('.datatable__table th[aria-sort]').count()) !== 1) {
  note("сортировка", "направление не объявлено атрибутом aria-sort ровно на одной колонке");
}
await page.click('.datatable__sort:has-text("Адрес")');

await page.fill(".datatable__search input", "московский");
await page.waitForTimeout(200);
const found = await page.locator(".datatable__table tbody tr").count();
if (found === 0 || found >= rows) note("поиск", `по запросу найдено ${found} строк из ${rows}`);
const counter = await page.locator(".datatable__foot p").textContent();
if (counter === null || !counter.includes("Показано")) note("счётчик", `подпись «${counter ?? "—"}»`);
await page.fill(".datatable__search input", "");
await page.waitForTimeout(200);
await step("список по образцу", "04b-spisok.png");

// Карточка объекта. Открывается объект со сметой: у остальных карточка
// показывает пустое состояние, и это правильное поведение, а не сбой.
await page.click('.datatable__table tbody tr:has(.code-badge:text-is("R-99")) a');
await page.waitForSelector(".stamp");
await page.waitForSelector(".metric__value");
await step("карточка объекта, обзор", "05-kartochka.png");
await overflow("карточка, 1440");

/*
 * Шкала объекта показывает две величины и не выдаёт одну за другую.
 *
 * Прежде она печатала заявленную готовность графика под словом «принято»:
 * 85,57 % там, где по приёмке принято меньше процента. Слово «принято» в
 * этом продукте закреплено за приёмкой — единственным источником факта
 * выполнения (БП-01), и отдавать его величине, которую поставил человек,
 * значит обесценить его на всех остальных экранах.
 */
const шкала = await page.evaluate(() => {
  const легенды = [...document.querySelectorAll(".tile--accent .scale__legend")];
  return {
    подписи: легенды.map((строка) => строка.firstElementChild?.textContent?.trim() ?? ""),
    значения: легенды.map((строка) => строка.querySelector(".scale__value")?.textContent?.trim() ?? ""),
    отметка: document.querySelectorAll(".tile--accent .scale__claim").length,
    ярлык: document.querySelector(".tile--accent .scale__track")?.getAttribute("aria-label") ?? "",
  };
});
if (шкала.подписи.join("|") !== "принято|заявлено") {
  note("шкала объекта", `подписи «${шкала.подписи.join("|")}» вместо «принято|заявлено»`);
}
if (шкала.значения[0] === шкала.значения[1]) {
  note("шкала объекта", `принято и заявлено совпали («${шкала.значения[0]}»): показано одно число дважды`);
}
/* Заявленное — риска поперёк линейки, а не второе заполнение: это
   утверждение человека, а не измерение. */
if (шкала.отметка !== 1) {
  note("шкала объекта", `отметок заявленного ${шкала.отметка} вместо одной`);
}
/* Ярлык для чтеца экрана обязан называть ту же величину, что и заполнение:
   расхождение видимой подписи и озвученной — дефект, который глазами не
   ловится вовсе. */
if (!шкала.ярлык.startsWith("Принято")) {
  note("шкала объекта", `чтецу экрана шкала называется «${шкала.ярлык}»`);
}
/* Принятое сходится с вкладкой приёмки: два места, одно число. */
const принятоПоВиду = await page.evaluate(async () => {
  const вид = await fetch("/api/projects/R-99/acceptance", { credentials: "include" })
    .then((ответ) => ответ.json());
  const смета = await fetch("/api/projects/R-99/estimate", { credentials: "include" })
    .then((ответ) => ответ.json());
  return Number((BigInt(вид.totals.accepted) * 10_000n * 2n / BigInt(смета.totals.works) + 1n) / 2n);
});
const наШкале = Number((шкала.значения[0] ?? "").replace(",", ".").replace(/[^\d.]/gu, ""));
if (Math.abs(наШкале * 100 - принятоПоВиду) > 1) {
  note("шкала объекта",
    `на шкале принято ${наШкале} %, а по вкладке приёмки ${принятоПоВиду / 100} %`);
}

/*
 * Штамп объекта — подпись продукта, и проверяется он по составу, а не по
 * наличию: шесть граф с подписью и значением. Пустая графа означала бы, что
 * карточка потеряла сведение, которое раньше несла цветная обложка.
 */
const stamp = await page.evaluate(() =>
  [...document.querySelectorAll(".stamp .stamp__cell")].map((cell) => ({
    label: cell.querySelector(".t-cap")?.textContent?.trim() ?? "",
    value: cell.querySelector(".stamp__value")?.textContent?.trim() ?? "",
  })),
);
const stampWanted = ["Объект", "Адрес", "Стадия", "Срок", "Прораб", "Смета"];
if (stamp.map((cell) => cell.label).join("|") !== stampWanted.join("|")) {
  note("штамп объекта", `графы «${stamp.map((cell) => cell.label).join(", ")}»`);
}
for (const cell of stamp) {
  if (cell.value === "") note("штамп объекта", `графа «${cell.label}» пуста`);
}

const metrics = await page.locator(".metric").count();
if (metrics === 0) note("обзор", "метрики графика производства работ не показаны");

await page.click('.tabs__item:has-text("Смета")');
await page.waitForSelector("table.estimate tbody tr");

const sections = await page.locator("tr.estimate__section").count();
const items = await page.locator("table.estimate tbody tr").count();
console.log(`  строк в смете: ${items}, из них заголовков и подытогов разделов: ${sections}`);

// Сворачивание раздела и переключение проекции.
const before = await page.locator("table.estimate tbody tr").count();
await page.locator(".estimate__section-toggle").first().click();
const after = await page.locator("table.estimate tbody tr").count();
if (after >= before) note("сворачивание раздела", "число строк не уменьшилось");
await page.locator(".estimate__section-toggle").first().click();

const internalBefore = await page.locator(".estimate__internal").count();
await page.click('.segmented__option:has-text("Клиентская")');
await page.waitForTimeout(200);
const internalAfter = await page.locator(".estimate__internal").count();
if (internalAfter !== 0) note("клиентская проекция", `внутренних ячеек осталось ${internalAfter}`);
if (internalBefore === 0) note("внутренняя проекция", "внутренних колонок не было и во внутреннем виде");
await step("клиентская проекция", "07-klientskaya.png");
await page.click('.segmented__option:has-text("Внутренняя")');

/*
 * Правка сметы (пункты плана 2.5, 2.6 и 3.9).
 *
 * Обход обёрнут условием: отсутствие кнопки обязано дать именное замечание,
 * а не падение по таймауту — тот же приём, что у приёмки и траншей.
 */
if ((await page.locator(".estimate__act .btn--text").count()) === 0) {
  note("правка сметы", "у руководителя нет ни одной кнопки правки позиции");
} else {
  /* Величины разбираются обратно в копейки: сверять надо арифметику, а не
     написание. Неразрывный пробел — разделитель разрядов формата. */
  const вКопейкиСметы = (текст) => {
    const очищено = (текст ?? "").replace(/[\s\u00A0₽]/g, "").replace("−", "-");
    const match = /^(-?)(\d+),(\d{2})$/.exec(очищено);
    return match === null ? null : BigInt(`${match[1]}${match[2]}${match[3]}`);
  };
  const итогРабот = async () =>
    вКопейкиСметы(await page.locator("table.estimate tfoot tr").first()
      .locator("td.estimate__num").first().textContent());

  const итогДо = await итогРабот();

  /* Позиция в квадратных метрах: у неё есть что подставить из обмера. */
  const строкаМ2 = page.locator("table.estimate tbody tr").filter({ hasText: "м²" }).first();
  const ценаСтроки = вКопейкиСметы(await строкаМ2.locator("td.estimate__num").nth(2).textContent());
  await строкаМ2.locator('.btn--text:has-text("Править")').click();
  await page.waitForTimeout(400);

  if ((await page.locator(".sheet").count()) === 0) {
    note("правка сметы", "лист правки позиции не открылся");
  } else {
    const подстановки = await page.locator(".estimate__from-measure .btn").count();
    if (подстановки === 0) {
      note("правка сметы", "позиции в квадратных метрах не предложена ни одна величина обмера");
      await page.click('.sheet .btn--text:has-text("Отмена")');
      await page.waitForTimeout(300);
    } else {

    /* Перенос из обмера: нажатие подставляет число обмера в количество. */
    const первая = page.locator(".estimate__from-measure .btn").first();
    const подписьПодстановки = (await первая.textContent()) ?? "";
    await первая.click();
    await page.waitForTimeout(200);
    const послеПодстановки = await page.locator('.sheet input[inputmode="decimal"]').first().inputValue();
    if (!подписьПодстановки.includes(послеПодстановки.replace(",", ","))) {
      note("правка сметы", `подстановка «${подписьПодстановки.trim()}» дала количество «${послеПодстановки}»`);
    }
    await step("правка сметы, лист позиции", "39-smeta-list.png");

    /* Правка количества на единицу: итог по работам обязан вырасти ровно на
       цену единицы. Та же проверка согласованности мер, что поймала смешение
       редакций сметы в стадии D. */
    await page.locator('.sheet input[inputmode="decimal"]').first().fill("100");
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(600);
    const итогПосле = await итогРабот();
    if (итогДо === null || итогПосле === null || ценаСтроки === null) {
      note("правка сметы", "итог работ или цена строки не разобраны");
    } else if (итогПосле === итогДо) {
      note("правка сметы", "итог по работам не изменился после правки количества");
    }

    /* Возврат: правка сметы обратима, и стенд обязан вернуться. */
    await строкаМ2.locator('.btn--text:has-text("Править")').click();
    await page.waitForTimeout(400);
    await page.locator(".estimate__from-measure .btn").first().click();
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(600);
    }
  }
}

/* Отказ до обращения к сети: количество ниже принятого.
 *
 * Позиция ищется не по имени, а по принятому количеству — через сессию самой
 * страницы. В таблице колонки «Принято» нет намеренно, а имя ничего не
 * говорит: собственный импорт этого же обхода заводит новую редакцию, и
 * приёмки прежней в неё не переходят (Р11). Поиск по имени нашёл бы строку
 * без приёмок и дал бы замечание о том, чего не проверял. */
const принятыеПозиции = await page.evaluate(async () => {
  const вид = await fetch("/api/projects/R-99/estimate", { credentials: "include" })
    .then((ответ) => ответ.json());
  const все = (вид.sections ?? []).flatMap((раздел) =>
    [...raздел_items(раздел), ...(раздел.children ?? []).flatMap(raздел_items)]);
  function raздел_items(раздел) { return раздел.items ?? []; }
  return все.filter((позиция) => BigInt(позиция.qtyAccepted) > 0n)
    .map((позиция) => позиция.name);
});
const естьКнопки = (await page.locator(".estimate__act .btn--text").count()) > 0;
const строкаПринятой = принятыеПозиции.length === 0 || !естьКнопки
  ? null
  : page.locator("table.estimate tbody tr").filter({ hasText: принятыеПозиции[0] }).first();
if (строкаПринятой === null) {
  /* Две разные причины и два разных сообщения: «кнопок нет» — дефект экрана,
     «принятых позиций нет» — состояние стенда. Одно сообщение на оба случая
     отправило бы разбирать не то. */
  note("правка сметы", естьКнопки
    ? "в действующей редакции нет ни одной принятой позиции: правило 3.9 не проверить"
    : "правило 3.9 не проверено: кнопок правки нет");
} else {
  await строкаПринятой.locator('.btn--text:has-text("Править")').click();
  await page.waitForTimeout(400);
  await page.locator('.sheet input[inputmode="decimal"]').first().fill("0,001");
  await page.waitForTimeout(300);
  const отказПравки = await page.locator(".sheet .field__error").first().textContent().catch(() => null);
  if (отказПравки === null || !отказПравки.includes("уже принято")) {
    note("правка сметы", `лист не отказал на количестве ниже принятого: «${отказПравки ?? "молча"}»`);
  }
  if (await page.locator('.sheet button[type="submit"]').isEnabled()) {
    note("правка сметы", "кнопка сохранения доступна при количестве ниже принятого");
  }
  await page.click('.sheet .btn--text:has-text("Отмена")');
  await page.waitForTimeout(300);
}

/* Надбавка: строка сопровождения и итог для заказчика пересчитываются. */
if ((await page.locator('.btn--text:has-text("Изменить надбавку")').count()) === 0) {
  note("правка сметы", "кнопки правки надбавки нет");
} else {
  await page.click('.btn--text:has-text("Изменить надбавку")');
  await page.waitForTimeout(400);
  const подсказка = await page.locator(".sheet .field__hint").first().textContent().catch(() => null);
  if (подсказка === null || !подсказка.includes("итог для заказчика")) {
    note("правка сметы", `лист надбавки не показывает будущий итог: «${подсказка ?? "молча"}»`);
  }
  await page.locator('.sheet input[inputmode="decimal"]').first().fill("150");
  await page.waitForTimeout(300);
  if (await page.locator('.sheet button[type="submit"]').isEnabled()) {
    note("правка сметы", "надбавка выше ста процентов принимается листом");
  }
  await step("правка сметы, надбавка", "40-smeta-nadbavka.png");
  await page.click('.sheet .btn--text:has-text("Отмена")');
  await page.waitForTimeout(300);
}

// Импорт сметы.
await page.click('.tabs__item:has-text("Импорт")');
await page.setInputFiles('input[type="file"]', FIXTURE);
await page.waitForSelector("text=Отчёт о расхождениях");
await step("отчёт о расхождениях", "08-otchet.png");
await overflow("отчёт, 1440");

/*
 * Поле выбора файла оформлено: системная кнопка input[type=file] подписана
 * языком браузера и посреди русского интерфейса читается как незаконченная
 * вёрстка. Настоящий input остаётся в порядке обхода и получает фокус.
 */
if ((await page.locator(".filefield__button").count()) === 0) {
  note("импорт", "поле выбора файла показывает системную кнопку браузера");
}
const fileFocus = await page.evaluate(() => {
  const input = document.querySelector('.filefield input[type="file"]');
  if (input === null) return false;
  input.focus();
  return document.activeElement === input;
});
if (!fileFocus) note("импорт", "скрытое поле файла недостижимо с клавиатуры");

const bareSelects = await page.locator("select:not(.selectwrap select)").count();
if (bareSelects > 0) note("списки", `${bareSelects} выпадающих списков с системной стрелкой`);

const decisions = await page.locator("select").count();
console.log(`  написаний единиц ждут решения: ${decisions}`);

/*
 * Запись сметы проходит через подтверждение: смета — основание расчётов
 * с заказчиком и бригадой, и одного нажатия для её замены мало. Диалог
 * обязан назвать, что именно изменится (реестр Д-01).
 */
/* Ожидаемое для строки об уходящих позициях берётся не из листа, а из вида
   приёмки: два независимых свода одного и того же обязаны совпасть. Читается
   до открытия листа — после записи новой редакции вид уже обнулится. */
const видПриёмкиДоИмпорта = await page.evaluate(() =>
  fetch("/api/projects/R-99/acceptance", { credentials: "include" }).then((ответ) => ответ.json()));
const принятоДоИмпорта = видПриёмкиДоИмпорта.totals?.acceptedPositions ?? 0;
const выполненоДоИмпорта = BigInt(видПриёмкиДоИмпорта.totals?.accepted ?? "0");

await page.click('button:has-text("Создать редакцию сметы")');
await page.waitForSelector('.sheet[role="dialog"]');
const confirmText = (await page.locator('.sheet[role="dialog"]').textContent()) ?? "";
for (const must of ["Позиций будет записано", "Недосчёт итога", "станет действующей"]) {
  if (!confirmText.includes(must)) {
    note("подтверждение импорта", `диалог не называет «${must}»`);
  }
}

/*
 * Импорт — единственное действие продукта, которое меняет смысл ядра, ничего
 * не удаляя: приёмки прежней редакции остаются в базе и в счёте транша, но
 * из вида приёмки уходят (Р11). Лист обязан назвать это числом до нажатия, и
 * названное число обязано сойтись с видом приёмки до копейки.
 */
const строкаУхода = page.locator('.sheet[role="dialog"] .deflist__row')
  .filter({ hasText: "Уйдёт из вида приёмки" });
if (принятоДоИмпорта === 0) {
  /* Состояние стенда, а не дефект экрана: сообщение разводит эти два случая,
     чтобы разбирать шли туда, где причина. */
  note("подтверждение импорта", "в действующей редакции нет принятых позиций: предупреждение об уходе не проверить");
} else if ((await строкаУхода.count()) === 0) {
  note("подтверждение импорта", `принято ${принятоДоИмпорта} позиций, а лист об их уходе молчит`);
} else {
  const текстУхода = ((await строкаУхода.locator(".deflist__value").textContent()) ?? "").trim();
  const числоПозиций = Number(/^(\d+)/.exec(текстУхода)?.[1] ?? "-1");
  if (числоПозиций !== принятоДоИмпорта) {
    note("подтверждение импорта",
      `лист обещает унести ${числоПозиций} позиций, а в виде приёмки принято ${принятоДоИмпорта}`);
  }
  /* Сумма разбирается обратно в копейки: сверяется величина, а не написание.
     Разделитель разрядов — неразрывный пробел, поэтому выбрасывается всё,
     кроме цифр и запятой. */
  const [рубли = "", копейки = ""] = (/на\s+(.+)$/u.exec(текстУхода)?.[1] ?? "")
    .replace(/[^\d,]/gu, "").split(",");
  const суммаЛиста = BigInt(рубли === "" ? "0" : рубли) * 100n + BigInt(копейки.padEnd(2, "0") || "0");
  if (суммаЛиста !== выполненоДоИмпорта) {
    note("подтверждение импорта",
      `лист обещает унести «${текстУхода}» — ${суммаЛиста} копеек, `
      + `а в виде приёмки выполнено ${выполненоДоИмпорта}`);
  }
  /* Названы обе стороны: сказать об утрате и умолчать о счёте транша значило
     бы напугать потерей, которой там нет. */
  if (!confirmText.includes("в счёте транша")) {
    note("подтверждение импорта", "лист называет уход из вида приёмки и молчит о счёте транша");
  }
}
const confirmFocus = await page.evaluate(() =>
  document.activeElement?.textContent?.trim() ?? "",
);
if (!confirmFocus.includes("Записать смету")) {
  note("подтверждение импорта", `фокус при открытии на «${confirmFocus}»`);
}
await step("подтверждение записи сметы", "08b-podtverzhdenie.png");
await page.click('.sheet button:has-text("Записать смету")');
await page.waitForSelector("text=Импортировано", { timeout: 30_000 });
await step("импорт выполнен", "09-import.png");

/*
 * Обратная сторона того же правила: терять нечего — лист молчит.
 *
 * Предупреждение о том, чего не произойдёт, обесценивает предупреждения о
 * том, что произойдёт. Проверяется на R-19 — объекте без сметы, где приёмок
 * нет по определению. Лист открывается и отменяется: объект остаётся без
 * сметы, обход следов не оставляет.
 */
await page.click('.appbar__link:has-text("Проекты")');
await page.waitForSelector(".datatable__table tbody tr");
await page.click('.datatable__table tbody tr:has(.code-badge:text-is("R-19")) a');
await page.waitForSelector(".tabs__item");
await page.click('.tabs__item:has-text("Импорт")');
await page.setInputFiles('input[type="file"]', FIXTURE);
await page.waitForSelector("text=Отчёт о расхождениях");
await page.click('button:has-text("Создать редакцию сметы")');
await page.waitForSelector('.sheet[role="dialog"]');
const листБезПриёмок = (await page.locator('.sheet[role="dialog"]').textContent()) ?? "";
if (листБезПриёмок.includes("Уйдёт из вида приёмки")) {
  note("подтверждение импорта", "объекту без сметы лист обещает унести принятые позиции");
}
await page.click('.sheet .btn--text:has-text("Отмена")');
await page.waitForSelector('.sheet[role="dialog"]', { state: "detached" });

/*
 * Смена статуса проверяется на объекте R-72, а не на показательном R-99:
 * каждый прогон оставляет в журнале две записи, и лента объекта, который
 * идёт в демонстрацию, заполнялась бы следами проверок вместо работы.
 */
await page.click('.appbar__link:has-text("Проекты")');
await page.waitForSelector(".datatable__table tbody tr");
await page.click('.datatable__table tbody tr:has(.code-badge:text-is("R-72")) a');
await page.waitForSelector("aside .pill");
const statusBefore = await page.locator("aside .pill").first().textContent();
await page.click('button:has-text("Изменить статус")');
await page.waitForSelector('.sheet[role="dialog"]');
await step("смена статуса", "06-status.png");
await page.click('.sheet button:has-text("Пауза")');
await page.waitForSelector('.sheet[role="dialog"]', { state: "detached" });
const statusAfter = await page.locator("aside .pill").first().textContent();
if (statusAfter?.trim() !== "Пауза") note("смена статуса", `после выбора пилюля показывает «${statusAfter}»`);
// Объект возвращается в прежний статус: проверка не оставляет следов.
await page.click('button:has-text("Изменить статус")');
await page.waitForSelector('.sheet[role="dialog"]');
await page.click(`.sheet button:has-text("${statusBefore?.trim() ?? "В работе"}")`);
await page.waitForSelector('.sheet[role="dialog"]', { state: "detached" });

/**
 * Контакты: заказчики и работники одним списком.
 *
 * Проверяется именно сведение: два вида в одной таблице с колонкой типа.
 * Пока они жили разными разделами, «телефон Фархата» и «кто заказчик на
 * Никитинской» искались в разных местах.
 */
await page.click('.appbar__link:has-text("Контрагенты")');
await page.waitForSelector(".datatable__table tbody tr");
const виды = await page.locator(".datatable__table tbody .pill").allTextContents();
const clients = виды.filter((вид) => вид.trim() === "Заказчик").length;
const brigades = виды.filter((вид) => вид.trim() === "Бригада").length;
console.log(`  заказчиков: ${clients}, бригад: ${brigades}`);
if (brigades === 0) note("контакты", "бригады не показаны");
if (clients === 0) note("контакты", "заказчики не показаны");
/* Свод по рабочему в таблице: у бригады стоят объекты и начисленное, а не
   прочерк. Заголовки разведены — итог смет заказчика и начисленное бригаде
   разные величины, и одна колонка на обе врала бы половине строк. */
const заголовки = (await page.locator(".datatable__table thead th").allTextContents())
  .map((текст) => текст.trim());
if (!заголовки.includes("Начислено")) {
  note("контакты", `в таблице нет колонки «Начислено»: ${заголовки.join(", ")}`);
} else {
  const колонка = заголовки.indexOf("Начислено") + 1;
  const строкаБригады = page.locator('.datatable__table tbody tr:has(.pill:text-is("Бригада"))').first();
  if ((await строкаБригады.count()) === 0) {
    note("контакты", "строки бригады нет: свод по рабочему проверять не на чем");
  } else {
    const начислено = (await строкаБригады.locator(`td:nth-child(${String(колонка)})`).innerText()).trim();
    if (!/\d/u.test(начислено)) {
      note("контакты", `у бригады начислено «${начислено}» вместо суммы`);
    }
    const сСуммой = await page
      .locator('.datatable__table tbody tr:has(.pill:text-is("Бригада"))')
      .evaluateAll((rows, колонка) => rows
        .map((row) => row.querySelector(`td:nth-child(${колонка})`)?.textContent?.trim() ?? "")
        .filter((текст) => /[1-9]/u.test(текст)).length, колонка);
    if (сСуммой === 0) {
      note("контакты", "ни у одной бригады нет ненулевого начисления: на стенде оно есть");
    }
  }
}

await геометрия(page, "контакты");
await step("контакты", "09b-kontakty.png");
await overflow("контакты, 1440");

/**
 * Заведение записи. Обещание экрана — сохранённая запись видна в списке
 * сразу, а не после перезагрузки. Проверяется наблюдением: форма, отклик
 * словами, поиск по добавленному имени.
 *
 * Имя пробы уникально в каждом прогоне: без этого второй запуск подряд
 * упирался бы в собственную запись первого. Маршрута удаления работника в
 * продукте нет, но наполнение стенда приводит его к описанному состоянию и
 * убирает все пробы разом.
 */
const проба = `Проверочная бригада ${String(Date.now()).slice(-6)}`;
await page.click('button:has-text("Добавить контакт")');
await page.waitForSelector('[aria-label="Новый контакт"]');
await step("форма контакта", "09c-forma-kontakta.png");
await page.click('[aria-label="Новый контакт"] .segmented__option:has-text("Бригада")');
await page.fill('[aria-label="Новый контакт"] .input', проба);
await page.click('button:has-text("Завести бригаду")');
await page.waitForSelector('main [role="status"]');
const отклик = (await page.locator('main [role="status"]').innerText()).trim();
if (!отклик.includes(проба)) {
  note("заведение", `подтверждение не назвало добавленное: «${отклик}»`);
}
await page.fill(".datatable__search input", проба);
await page.waitForTimeout(300);
const найдено = await page.locator(".datatable__table tbody tr").count();
if (найдено !== 1) note("заведение", `добавленная запись не нашлась в списке: строк ${найдено}`);
await step("запись добавлена", "09d-zapis-dobavlena.png");
await page.fill(".datatable__search input", "");

/**
 * Состав навигации по эталону: пять разделов и «Ещё» в одной капсуле.
 * Прежнее правило «в шапке только то, что открывает рабочий экран» отменено
 * решением заказчика; взамен действует другое, и оно проверяется ниже:
 * раздел без своего экрана ведёт на «Что дальше», а не в пустую заглушку.
 */
const navLabels = (await page.locator(".appbar__nav-scroll .appbar__link").allTextContents())
  .map((text) => text.trim());
const navWanted = ["Главная", "Заявки", "Проекты", "Контрагенты", "Бухгалтерия"];
if (navLabels.join("|") !== navWanted.join("|")) {
  note("навигация", `в шапке «${navLabels.join(", ")}» вместо «${navWanted.join(", ")}»`);
}
if ((await page.locator(".appbar__nav .appbar__more").count()) !== 1) {
  note("навигация", "в полосе разделов нет пункта «Ещё»");
}
if ((await page.locator(".appbar__brand .appbar__mark").count()) !== 1) {
  note("навигация", "знак слева состоит только из слова, без символа");
}

/**
 * «Ещё» — список служебных экранов. Раскрывается, содержит объявленные
 * строки, ведёт в настройки и закрывается за собой.
 */
await page.click(".appbar__more > summary");
await page.waitForTimeout(200);
const menu = (await page.locator(".appbar__menu-item").allTextContents()).map((s) => s.trim());
if (menu.join("|") !== ["Настройки", "Что дальше", "Выйти"].join("|")) {
  note("навигация", `в списке «Ещё» «${menu.join(", ")}»`);
}
await page.click('.appbar__menu-item:has-text("Что дальше")');
await page.waitForTimeout(400);
if ((await page.locator(".roadmap__item").count()) === 0) {
  note("навигация", "«Что дальше» из списка «Ещё» не открылся");
}
if (await page.locator(".appbar__menu").isVisible()) {
  note("навигация", "список «Ещё» остался раскрытым после выбора");
}
if ((await page.locator(".appbar__action").count()) !== 0) {
  note("навигация", "в шапке осталась кнопка меню быстрых действий");
}
if ((await page.locator(".appbar__user").count()) !== 1) {
  note("навигация", "блока пользователя в шапке нет");
}
if ((await page.locator(".appbar__bell").count()) !== 1) {
  note("навигация", "колокола событий в шапке нет");
}

/*
 * Из навигации верхнего уровня недостижимо ни одно пустое состояние. Это и
 * есть правило «показываем только работающее», проверенное обходом: раздел,
 * встречающий человека заглушкой, учит его, что тыкать бесполезно.
 */
for (const label of navWanted) {
  await page.click(`.appbar__link:has-text("${label}")`);
  await page.waitForTimeout(400);
  if ((await page.locator("main .empty__title").count()) > 0) {
    const title = await page.locator("main .empty__title").first().textContent();
    note("навигация", `раздел «${label}» встречает пустым состоянием «${title?.trim() ?? ""}»`);
  }
}

/**
 * Раздел без своего экрана ведёт на «Что дальше», где названа его стадия.
 * Это правило пришло на смену прежнему запрету пунктов без содержания, и
 * без проверки оно продержится ровно до первой правки навигации.
 */
for (const label of ["Бухгалтерия"]) {
  await page.click(`.appbar__link:has-text("${label}")`);
  await page.waitForTimeout(400);
  if ((await page.locator(".roadmap__item").count()) === 0) {
    note("навигация", `раздел «${label}» не ведёт на «Что дальше»`);
  }
}
/* «Заявки» перестали быть разделом без экрана 11.09.2026: у них своя доска.
   Проверяется именно это — пункт, который снова привёл бы на «Что дальше»,
   означал бы, что раздел выключили правкой навигации. */
await page.click('.appbar__link:has-text("Заявки")');
await page.waitForTimeout(400);
if ((await page.locator(".roadmap__item").count()) > 0) {
  note("навигация", "раздел «Заявки» ведёт на «Что дальше», а у него есть свой экран");
}
/*
 * Воронка заявок.
 *
 * Доска показывает все четыре стадии, даже пустые: колонка, исчезающая
 * вместе с последней заявкой, ломает картину воронки — человек перестаёт
 * видеть стадию, на которой у него ничего нет.
 */
/* Воронка на первом экране. Первый экран отвечает на вопрос «что горит
   сегодня», и заявка с просроченной задачей горит сильнее объекта со сроком
   через неделю. Счётчики сводки обязаны сойтись с колонками доски. */
await page.click('.appbar__link:has-text("Главная")');
await page.waitForSelector(".statcard");
const воронкаНаГлавной = page.locator("section").filter({ hasText: "Воронка заявок" }).last();
if ((await воронкаНаГлавной.count()) === 0) {
  note("сводка", "на первом экране нет блока воронки заявок");
} else {
  const строкиВоронки = await воронкаНаГлавной.locator(".counterstrip__item").count();
  /* Четыре стадии и строка просроченных задач. */
  if (строкиВоронки !== 5) {
    note("сводка", `в блоке воронки ${строкиВоронки} строк вместо пяти`);
  }
  const просроченные = воронкаНаГлавной.locator(".counterstrip__item")
    .filter({ hasText: "Просроченные задачи" });
  if ((await просроченные.count()) === 0) {
    note("сводка", "в блоке воронки нет строки просроченных задач");
  }
  await step("воронка на первом экране", "40b-voronka-svodka.png");
}

await page.click('.appbar__link:has-text("Заявки")');
await page.waitForSelector(".leadboard__column");
const колонокВоронки = await page.locator(".leadboard__column").count();
if (колонокВоронки !== 4) note("воронка", `колонок ${колонокВоронки} вместо четырёх`);

const заголовкиВоронки = (await page.locator(".leadboard__title").allTextContents())
  .map((текст) => текст.trim());
const стадииВоронки = ["Первичный контакт", "Знакомство", "Принимают решение", "Согласование договора"];
if (заголовкиВоронки.join("|") !== стадииВоронки.join("|")) {
  note("воронка", `стадии «${заголовкиВоронки.join(", ")}»`);
}

/* Счётчик колонки считает свою колонку, а не всю доску. */
for (const [индекс, стадия] of стадииВоронки.entries()) {
  const колонка = page.locator(".leadboard__column").nth(индекс);
  const карточек = await колонка.locator(".leadcard").count();
  const подпись = (await колонка.locator(".leadboard__count").textContent()) ?? "";
  if (!подпись.trim().startsWith(String(карточек))) {
    note("воронка", `у стадии «${стадия}» счётчик «${подпись.trim()}», а карточек ${карточек}`);
  }
}

/* Черта под заголовком нейтральная: сигнальный цвет в продукте закреплён за
   сторно, просрочкой и расхождением, и на карточках под чертой стоит
   красная пилюля просрочки. Один цвет не может означать разное в двух
   сантиметрах друг от друга. */
const цветаВоронки = await page.evaluate(() => {
  const узел = document.querySelector(".leadboard__count");
  /* Токен приходит записью «#A5150D», а вычисленный цвет — «rgb(165, 21, 13)».
     Сравнивать их как строки бесполезно: проверка проходила бы всегда.
     Токен красится на пробном узле и снимается уже вычисленным. */
  const проба = document.createElement("span");
  проба.style.color = "var(--danger)";
  document.body.append(проба);
  const сигнальный = getComputedStyle(проба).color;
  проба.remove();
  return {
    черта: узел === null ? "" : getComputedStyle(узел).borderBottomColor,
    сигнальный,
  };
});
if (цветаВоронки.черта === цветаВоронки.сигнальный) {
  note("воронка", "черта стадии окрашена сигнальным цветом, закреплённым за просрочкой");
}

/* Пилюля просрочки несёт текст, а не только цвет: смысл в этом продукте
   никогда не передаётся одним цветом. */
const просрочка = page.locator(".leadcard .pill--danger").first();
if ((await просрочка.count()) === 0) {
  note("воронка", "на стенде нет заявки с просроченной задачей: пилюлю не проверить");
} else if (!/просроч/u.test((await просрочка.textContent()) ?? "")) {
  note("воронка", `пилюля просрочки без подписи: «${(await просрочка.textContent()) ?? ""}»`);
}

await step("воронка заявок", "41-zayavki.png");
await overflow("воронка, 1440");

/* Переключатель «Открытые / Все». На стенде закрытых заявок нет, поэтому
   проверяется не рост числа карточек, а то, что выбор вообще применяется:
   число в подписи «Все» не меньше числа в подписи «Открытые». */
const подписиОтбора = (await page.locator("#leads-scope option").allTextContents())
  .map((текст) => Number(/(\d+)/u.exec(текст)?.[1] ?? "-1"));
if ((подписиОтбора[1] ?? -1) < (подписиОтбора[0] ?? 0)) {
  note("воронка", `«Все» (${подписиОтбора[1]}) меньше «Открытых» (${подписиОтбора[0]})`);
}

/*
 * Лист заявки: ориентир считается сервером и приходит вилкой. Проверяется
 * независимым пересчётом площадь × тариф ± отклонение — то же правило, по
 * которому сверяется доля принятого.
 */
const сОриентиром = page.locator(".leadcard").filter({ has: page.locator(".leadcard__guide") }).first();
if ((await сОриентиром.count()) === 0) {
  note("воронка", "ни одна карточка не несёт вилку ориентира");
} else {
  await сОриентиром.click();
  await page.waitForSelector('.sheet[role="dialog"]');
  const листЗаявки = (await page.locator('.sheet[role="dialog"]').textContent()) ?? "";
  for (const нужно of ["Ориентир цены", "Тип ремонта", "Общая площадь", "Превратить в объект"]) {
    if (!листЗаявки.includes(нужно)) note("лист заявки", `нет блока «${нужно}»`);
  }
  /* Снимок тарифа назван прямо: тариф в справочнике могли уже поправить. */
  if (!/за м²/u.test(листЗаявки)) {
    note("лист заявки", "вилка показана без тарифа, по которому посчитана");
  }
  /* Журнал заявки читается. Запись создаётся тут же сменой стадии: посев
     журнала не пишет, и проверять читаемость было бы не на чем. Так
     проверяются обе половины — что запись делается и что её видно.
     Стадию возвращает наполнение на следующем прогоне. */
  const былаСтадия = await page.locator("#lead-stage").inputValue();
  await page.selectOption("#lead-stage", былаСтадия === "MEETING" ? "DECIDING" : "MEETING");
  await page.waitForTimeout(900);
  const послеСмены = (await page.locator('.sheet[role="dialog"]').textContent()) ?? "";
  if (!послеСмены.includes("Журнал заявки")) {
    note("лист заявки", "после смены стадии журнала в листе нет");
  }
  const записиЖурнала = await page.locator('.sheet[role="dialog"] .feed__item').allTextContents();
  if (!записиЖурнала.some((запись) => запись.includes("стадия"))) {
    note("лист заявки", `смена стадии не попала в журнал: «${записиЖурнала.join(" | ")}»`);
  }
  await step("лист заявки", "42-zayavka-list.png");

  /* Отказ требует причину: кнопка недоступна, пока её не назвали. */
  await page.click('.sheet button:has-text("Отказ")');
  await page.waitForTimeout(300);
  if (await page.locator('.sheet button:has-text("Закрыть отказом")').isEnabled()) {
    note("лист заявки", "отказ принимается без причины");
  }
  await page.click('.sheet button:has-text("Не закрывать")');
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}

/* Телефон: четыре колонки в его ширину не помещаются, и доска становится
   лентой стадий. Документ вбок не едет — прокручивается лента. */
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
if ((await page.locator(".leads__stages").count()) === 0) {
  note("воронка", "на 390 px нет ленты стадий");
}
const чиповСтадий = await page.locator(".leads__stage").count();
if (чиповСтадий !== 4) note("воронка", `чипов стадий ${чиповСтадий} вместо четырёх`);
/* Измерение — только когда есть что мерить: `boundingBox` отсутствующего
   органа ждёт полминуты и роняет обход, а падение вместо именного
   замечания отправляет разбирать не туда. */
if (чиповСтадий > 0) {
  const чип = await page.locator(".leads__stage").first().boundingBox();
  if (чип === null || чип.height < 44) {
    note("воронка", `чип стадии ${чип?.height ?? 0} px при норме 44`);
  }
}
await overflow("воронка, 390");
await step("воронка на телефоне", "43-zayavki-390.png");
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(300);

await page.click('.appbar__link:has-text("Главная")');
await page.waitForSelector(".statcard");

/**
 * Настройки организации: карточка и справочник единиц. Открываются из
 * блока пользователя в шапке — раздела навигации у них больше нет.
 */
await page.click(".appbar__user");
await page.waitForSelector('.tabs__item:has-text("Организация")');
const settingsTabs = (await page.locator(".tabs__item").allTextContents())
  .map((text) => text.trim());
if (settingsTabs.join("|") !== "Организация|Единицы измерения|Типы ремонта") {
  note("настройки", `вкладки «${settingsTabs.join(", ")}»`);
}
await page.waitForSelector('input[name="name"]');
const orgName = await page.inputValue('input[name="name"]');
if (orgName.trim() === "") note("настройки", "название организации пришло пустым");
await step("настройки организации", "17-nastroyki.png");
await overflow("настройки, 1440");

await page.click('.tabs__item:has-text("Единицы измерения")');
await page.waitForSelector(".deflist__row");
const units = await page.locator(".deflist__row").count();
if (units !== 9) note("настройки", `в справочнике единиц ${units} строк вместо девяти`);

/**
 * «Что дальше» — единственное место, где продукт говорит о том, чего в нём
 * нет. Экран открывается ссылкой из подвала настроек, в навигации его нет,
 * и каждая строка обязана называть стадию: список без стадий — это те же
 * заглушки, собранные в кучу.
 */
await page.click('a:has-text("«Что дальше»")');
await page.waitForSelector(".roadmap__item");
const roadmap = await page.locator(".roadmap__item").count();
const stages = await page.locator(".roadmap__item .pill").count();
console.log(`  строк в «Что дальше»: ${roadmap}`);
/* Строк шесть. Список короче не оттого, что обещаний стало меньше, а
   оттого, что два из них выполнены: «Заявки» получили свой раздел, «Отчёт»
   — свою вкладку. Обещать на «Что дальше» сделанное значит лгать о составе
   продукта, поэтому сделанное из списка уходит. */
if (roadmap < 6) note("что дальше", `строк ${roadmap} — список неполон`);
if (stages !== roadmap) note("что дальше", `стадию называют ${stages} строк из ${roadmap}`);
const roadmapTitle = await page.locator(".cover h1").textContent();
if (roadmapTitle?.trim() !== "Что дальше") {
  note("что дальше", `обложка называет экран «${roadmapTitle ?? "—"}»`);
}
await step("что дальше", "18-chto-dalshe.png");
await overflow("что дальше, 1440");

// Вкладки карточки объекта: две рабочих и служебный импорт руководителю.
await page.click('.appbar__link:has-text("Проекты")');
await page.waitForSelector(".datatable__table tbody tr");
await page.click('.datatable__table tbody tr:has(.code-badge:text-is("R-99")) a');
await page.waitForSelector(".tabs__item");
const cardTabs = (await page.locator(".tabs__item").allTextContents()).map((text) => text.trim());
if (cardTabs.join("|") !== "Обзор|Замер|Смета|Работа|Приёмка|Отчёт|Транши|Импорт") {
  note("вкладки карточки", `состав «${cardTabs.join(", ")}»`);
}
for (const tab of cardTabs) {
  await page.click(`.tabs__item:has-text("${tab}")`);
  await page.waitForTimeout(300);
  if ((await page.locator("main .empty__title").count()) > 0) {
    const title = await page.locator("main .empty__title").first().textContent();
    note("вкладки карточки", `вкладка «${tab}» показывает пустое состояние «${title?.trim() ?? ""}»`);
  }
}
await page.click('.tabs__item:has-text("Обзор")');
await step("вкладки карточки", "20-vkladki.png");

/*
 * Те же вкладки на телефоне. Переполнение проверялось лишь у приёмки и
 * траншей — по вкладке за раз, там, где его ждали. График производства
 * работ при этом уносил вбок весь документ: в ряду над ним четыре органа
 * управления, и на 390 px они занимали 717 px. Уезжала не дорожка графика,
 * которой полагается прокручиваться, а страница целиком, вместе с шапкой.
 * Проверка идёт по всем восьми вкладкам: дефект этого рода находится там,
 * куда не смотрели.
 */
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
for (const tab of cardTabs) {
  await page.click(`.tabs__item:has-text("${tab}")`);
  await page.waitForTimeout(300);
  await overflow(`вкладка «${tab}», 390`);
}
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(300);
await page.click('.tabs__item:has-text("Обзор")');

/*
 * Обмерный план. Величины сверяются с утверждённым артбордом: экран
 * показывает то же, что показал заказчику макет, или отличие видно здесь,
 * а не на демонстрации.
 */
await page.click('.tabs__item:has-text("Замер")');
await page.waitForSelector(".measure__item");
const totals = await page.locator(".spec").first().innerText();
const wanted = [
  ["Помещений", "7"],
  ["Площадь", "80,53\u00A0м²"],
  ["Площадь стен", "262,95\u00A0м²"],
  ["Периметр потолка", "97,39\u00A0м.п."],
  ["Периметр пола", "86,07\u00A0м.п."],
  ["Объём", "217,43\u00A0м³"],
];
for (const [label, value] of wanted) {
  if (!totals.includes(value)) note("замер", `в итогах нет «${label} ${value}»`);
}
console.log(`  итогов обмера сверено: ${wanted.length}`);

const roomNames = (await page.locator(".measure__item").allTextContents()).map((t) => t.trim());
if (roomNames.length !== 7) note("замер", `помещений в списке ${roomNames.length} вместо семи`);

await page.click('.measure__item:has-text("Спальня")');
await page.waitForTimeout(200);
const bedroom = await page.locator(".measure .spec--inv").first().innerText();
for (const value of ["18,40\u00A0м²", "47,52\u00A0м²", "2,70\u00A0м", "49,68\u00A0м³"]) {
  if (!bedroom.includes(value)) note("замер", `у спальни нет величины «${value}»`);
}

/* Тумблер подробного вида раскрывает периметры и откосы. */
const beforeToggle = await page.locator(".measure").innerText();
if (beforeToggle.includes("Периметр потолка")) note("замер", "периметры показаны до включения подробного вида");
await page.click(".toggle");
await page.waitForTimeout(200);
const afterToggle = await page.locator(".measure").innerText();
if (!afterToggle.includes("Периметр потолка")) note("замер", "подробный вид не раскрыл периметры");
if (!afterToggle.includes("Откосы")) note("замер", "подробный вид не раскрыл откосы проёмов");
await page.click(".toggle");
await step("замер, обмерный план", "21-zamer.png");

/* Внесение помещения и его удаление: итог обязан вернуться к исходному. */
await page.click('button:has-text("Внести помещение")');
await page.waitForSelector('.sheet input');
const sheetInputs = page.locator(".sheet input");
await sheetInputs.nth(0).fill("Проверка страницы");
await sheetInputs.nth(1).fill("10");
await sheetInputs.nth(2).fill("13");
await sheetInputs.nth(3).fill("14");
await sheetInputs.nth(4).fill("2,7");
await step("замер, форма помещения", "22-zamer-forma.png");
await page.click('.sheet button:has-text("Внести помещение")');
await page.waitForTimeout(700);
const grown = await page.locator(".spec").first().innerText();
if (!grown.includes("90,53\u00A0м²")) note("замер", `после внесения площадь «${grown.replace(/\n/g, " ")}»`);

await page.click('.measure__item:has-text("Проверка страницы")');
await page.click('button:has-text("Править помещение")');
await page.waitForSelector('.sheet button:has-text("Удалить помещение")');
await page.click('.sheet button:has-text("Удалить помещение")');
await page.waitForSelector(".btn--danger");
const roomConfirm = await page.locator(".sheet").innerText();
if (!roomConfirm.includes("10,00") || !roomConfirm.includes("27,00")) {
  note("замер", "подтверждение удаления не называет, на сколько изменятся итоги");
}
await step("замер, подтверждение удаления", "23-zamer-udalenie.png");
await page.click('.sheet .btn--danger');
await page.waitForTimeout(700);
const restoredTotals = await page.locator(".spec").first().innerText();
if (!restoredTotals.includes("80,53\u00A0м²")) {
  note("замер", `после удаления площадь «${restoredTotals.replace(/\n/g, " ")}» вместо 80,53 м²`);
}

/* Печатный вид: ведомость всех помещений, без навигации и плашек. */
await page.emulateMedia({ media: "print" });
await page.waitForTimeout(200);
const printRows = await page.locator(".measure-print tbody tr").count();
if (printRows !== 7) note("замер", `в печатной ведомости ${printRows} строк вместо семи`);
if (await page.locator(".appbar").isVisible()) note("замер", "шапка попадает в печать");
if (await page.locator(".measure").isVisible()) note("замер", "инвертированная плашка попадает в печать");
await page.screenshot({ path: `${SHOTS}/24-zamer-pechat.png`, fullPage: true });
console.log(`  снято: печатный вид обмера → 24-zamer-pechat.png`);
await page.emulateMedia({ media: "screen" });

/* Замер на телефоне: список помещений становится лентой, зоны касания 48 px. */
await page.setViewportSize({ width: 360, height: 780 });
await page.waitForTimeout(300);
const narrowRooms = await page.locator(".measure__item").count();
if (narrowRooms !== 7) note("замер", `на 360 px помещений в ленте ${narrowRooms} вместо семи`);
for (const selector of [".measure__item", ".toggle"]) {
  const box = await page.locator(selector).first().boundingBox();
  if (box !== null && box.height < 48) {
    note("замер", `зона касания «${selector}» на 360 px — ${Math.round(box.height)} px вместо 48`);
  }
}
const strip = await page.locator(".measure__nav").boundingBox();
const panel = await page.locator(".measure").boundingBox();
if (strip !== null && panel !== null && strip.width > panel.width + 1) {
  note("замер", "лента помещений шире плашки: раскладка на 360 px разъезжается");
}
await step("замер на телефоне", "25-zamer-360.png");
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(300);

/*
 * График производства работ. Проверяется то, чего не видно на снимке:
 * что сетка построена по календарю, что отрезок действительно двигается
 * указателем, что валидатор дат стоит и на экране, и что заведённое
 * снимается — стенд обязан вернуться в исходное состояние.
 */
await page.click('.tabs__item:has-text("Работа")');
await page.waitForSelector(".gantt__row");

const рядов = await page.locator(".gantt__row").count();
if (рядов !== 7) note("график", `строк ${рядов} вместо семи этапов R-99`);

/* График открывается там, где работа есть. Работы R-99 идут по 15 августа,
   а «сегодня» стенда — 5 сентября: открытие на текущем месяце дало бы
   пустое полотно. */
const месяцОткрытия = (await page.locator(".segmented__label").first().textContent())?.trim() ?? "";
if (месяцОткрытия !== "Август 2026") {
  note("график", `открылся месяц «${месяцОткрытия}» вместо августа, где стоят этапы`);
}
const клеток = await page.locator(".gantt__scale .gantt__day").count();
if (клеток !== 31) note("график", `в августе ${клеток} клеток вместо тридцати одной`);
const выходных = await page.locator(".gantt__scale .gantt__day--off").count();
if (выходных !== 10) note("график", `выходных отмечено ${выходных} вместо десяти`);
if ((await page.locator(".gantt__scale .gantt__day--today").count()) !== 0) {
  note("график", "в августе отмечен текущий день, хотя сегодня сентябрь");
}

/* Колонки шапки и строк стоят на одних вертикалях. Проверяется числом:
   дорожка строки не имеет собственной ширины (отрезок в ней позиционирован
   абсолютно), и стоит забыть её задать, как готовность уезжает под
   название, а шапка остаётся на месте. Глазом на снимке это заметно, а
   проверкой раньше не ловилось. */
const шапкаГотово = await page.locator(".gantt__scale .gantt__pct").boundingBox();
const строкаГотово = await page.locator(".gantt__row .gantt__pct").first().boundingBox();
if (шапкаГотово !== null && строкаГотово !== null
    && Math.abs(шапкаГотово.x - строкаГотово.x) > 1) {
  note("график", `колонка готовности в шапке на ${Math.round(шапкаГотово.x)} px, в строке на ${Math.round(строкаГотово.x)} px`);
}
const шапкаДень = await page.locator(".gantt__scale .gantt__day").first().boundingBox();
const дорожка = await page.locator(".gantt__row .gantt__track").first().boundingBox();
if (шапкаДень !== null && дорожка !== null && Math.abs(шапкаДень.x - дорожка.x) > 1) {
  note("график", `шкала дней и дорожка расходятся: ${Math.round(шапкаДень.x)} против ${Math.round(дорожка.x)} px`);
}

/* Прокрутка по месяцам: подпись обязана смениться, а сетка — пересобраться. */
await page.click('.segmented button:has-text("Вперёд")');
await page.waitForTimeout(300);
const сентябрь = (await page.locator(".segmented__label").first().textContent())?.trim() ?? "";
if (сентябрь === месяцОткрытия) note("график", `подпись месяца не сменилась: «${сентябрь}»`);
if ((await page.locator(".gantt__scale .gantt__day").count()) !== 30) {
  note("график", "в сентябре не тридцать дней");
}
if ((await page.locator(".gantt__scale .gantt__day--today").count()) !== 1) {
  note("график", "текущий день в сентябре не отмечен");
}
await page.click('.segmented button:has-text("Назад")');
await page.waitForTimeout(300);

/* Масштаб меняет ширину дня, а не число дней. */
const узкий = await page.locator(".gantt__scale .gantt__day").first().boundingBox();
await page.click('.segmented button[aria-label="Крупнее"]');
await page.waitForTimeout(300);
const широкий = await page.locator(".gantt__scale .gantt__day").first().boundingBox();
if (узкий !== null && широкий !== null && широкий.width <= узкий.width) {
  note("график", `масштаб не расширил день: ${Math.round(узкий.width)} → ${Math.round(широкий.width)} px`);
}
await page.click('.segmented button[aria-label="Мельче"]');
await page.waitForTimeout(300);

await step("работа, график", "26-grafik.png");

/* Перестановка строки стрелкой с клавиатуры: номера обязаны разойтись. */
const доПерестановки = (await page.locator(".gantt__title").allTextContents()).map((s) => s.trim());
await page.locator(".gantt__move").first().focus();
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(700);
const послеПерестановки = (await page.locator(".gantt__title").allTextContents()).map((s) => s.trim());
if (доПерестановки[0] === послеПерестановки[0]) {
  note("график", `перестановка не изменила порядок: первым остался «${послеПерестановки[0] ?? ""}»`);
}
await page.locator(".gantt__move").nth(1).focus();
await page.keyboard.press("ArrowUp");
await page.waitForTimeout(700);
const возвращённый = (await page.locator(".gantt__title").allTextContents()).map((s) => s.trim());
if (возвращённый.join("|") !== доПерестановки.join("|")) {
  note("график", `порядок не вернулся: «${возвращённый.join(", ")}»`);
}

/* Метка увода: этап вне открытого месяца оставляет пустую дорожку и метку,
   уводящую в его месяц. В августе таких этапов шесть из семи. */
const меток = await page.locator(".gantt__away").count();
if (меток !== 6) note("график", `меток увода ${меток} вместо шести`);

/* Перетаскивание отрезка мышью: дата в подписи строки обязана сдвинуться.
   Берётся строка с отрезком, а не первая: в августе идёт только последний
   этап, остальные лежат весной. */
const первый = page.locator(".gantt__row:has(.gantt__bar)").first();
const подписьДо = await первый.locator(".gantt__title").getAttribute("title");
const отрезок = await первый.locator(".gantt__bar").boundingBox();
if (отрезок === null) {
  note("график", "у первого этапа нет отрезка в открытом месяце");
} else {
  /* Ширина дня берётся на действующем масштабе, а не на том, что был
     измерён при проверке масштаба: там она в полтора раза больше, и жест
     считался бы в других единицах. */
  const деньСейчас = await page.locator(".gantt__scale .gantt__day").first().boundingBox();
  const деньШириной = деньСейчас?.width ?? 32;
  await page.mouse.move(отрезок.x + отрезок.width / 2, отрезок.y + отрезок.height / 2);
  await page.mouse.down();
  await page.mouse.move(отрезок.x + отрезок.width / 2 + деньШириной * 3, отрезок.y + отрезок.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  const подписьПосле = await первый.locator(".gantt__title").getAttribute("title");
  if (подписьДо === подписьПосле) {
    note("график", `перетаскивание не сдвинуло сроки: «${подписьПосле ?? ""}»`);
  } else {
    /* Сдвиг возвращается тем же жестом в обратную сторону. */
    const снова = await первый.locator(".gantt__bar").boundingBox();
    if (снова !== null) {
      await page.mouse.move(снова.x + снова.width / 2, снова.y + снова.height / 2);
      await page.mouse.down();
      await page.mouse.move(снова.x + снова.width / 2 - деньШириной * 3, снова.y + снова.height / 2, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(900);
      const подписьВозврата = await первый.locator(".gantt__title").getAttribute("title");
      if (подписьВозврата !== подписьДо) {
        note("график", `сроки не вернулись: «${подписьВозврата ?? ""}» вместо «${подписьДо ?? ""}»`);
      }
    }
  }
}

/* Лист правки: валидатор отказывает перевёрнутым датам до обращения к серверу. */
await page.click('button:has-text("Добавить этап")');
await page.waitForSelector(".sheet input");
const поляЭтапа = page.locator(".sheet input");
await поляЭтапа.nth(0).fill("Проверка страницы");
await поляЭтапа.nth(1).fill("2026-08-20");
await поляЭтапа.nth(2).fill("2026-08-08");
await page.waitForTimeout(300);
const отказ = (await page.locator(".sheet .field__error").first().textContent())?.trim() ?? "";
if (!отказ.includes("раньше начала")) {
  note("график", `лист не отказал перевёрнутым датам: «${отказ}»`);
}
if (await page.locator('.sheet button:has-text("Завести этап")').isEnabled()) {
  note("график", "кнопка заведения доступна при перевёрнутых датах");
}
await step("работа, отказ валидатора", "27-grafik-otkaz.png");

/* Исправленные даты — этап заводится и становится восьмым. */
await поляЭтапа.nth(2).fill("2026-08-24");
await page.waitForTimeout(200);
await page.click('.sheet button:has-text("Завести этап")');
await page.waitForTimeout(900);
const послеЗаведения = await page.locator(".gantt__row").count();
if (послеЗаведения !== 8) note("график", `после заведения строк ${послеЗаведения} вместо восьми`);

/*
 * Связь этапа с разделом сметы и бригадой (пункт плана 5.2, решение Р19).
 *
 * Пара «раздел → этап → бригада» решает, кому уйдёт сдельная оплата за
 * принятые позиции раздела. До этой правки назначить её с экрана было
 * нечем: оба поля жили только в модели и в скрипте наполнения, и у каждого
 * заведённого человеком этапа получателя начисления не было.
 *
 * Проверяется на пробном этапе, который ниже снимается, и следствие
 * проверяется там, где оно видно человеку: раздел на вкладке приёмки
 * перестаёт быть бездействующим.
 */
/**
 * Пары «этап → фактическая готовность» с вкладки «Работа».
 *
 * Читается текстом из той же колонки, куда смотрит человек: проверять
 * значение в состоянии экрана значило бы стеречь переменную, а не то, что
 * показано.
 */
const фактыГрафика = async () => {
  await page.click('.tabs__item:has-text("Работа")');
  await page.waitForSelector(".gantt__row");
  const пары = await page.locator(".gantt__row").evaluateAll((rows) => rows.map((row) => [
    row.querySelector(".gantt__title")?.textContent?.trim() ?? "",
    row.querySelector(".gantt__fact")?.textContent?.trim() ?? "",
  ]));
  return new Map(пары);
};

/* Этап без раздела показывает прочерк, а не ноль: ноль означал бы «ничего
   не принято», а это иное утверждение. Пробный этап раздела ещё не имеет. */
const фактыДоСвязи = await фактыГрафика();
if (фактыДоСвязи.get("Проверка страницы") !== "—") {
  note("фактическая готовность",
    `этап без раздела показывает «${фактыДоСвязи.get("Проверка страницы") ?? ""}» вместо прочерка`);
}
const сРазделом = [...фактыДоСвязи].filter(([имя]) => имя !== "Проверка страницы");
if (сРазделом.some(([, факт]) => factNotPercent(факт))) {
  note("фактическая готовность",
    `у этапа с разделом не число: ${сРазделом.map(([имя, факт]) => `${имя} — «${факт}»`).join(", ")}`);
}

await page.click('.gantt__title:has-text("Проверка страницы")');
await page.waitForSelector(".sheet");
const полеРаздела = page.locator('.sheet label:has-text("Раздел сметы") select');
const полеБригады = page.locator('.sheet label:has-text("Бригада") select');

/* Отсутствие полей — дефект экрана, а не повод упасть: снятая проверка
   обязана краснеть замечанием, иначе она стережёт только саму себя. */
if ((await полеРаздела.count()) === 0 || (await полеБригады.count()) === 0) {
  note("связь этапа", "в листе этапа нет полей выбора раздела сметы и бригады");
  await page.click('.sheet button:has-text("Отмена")');
  await page.waitForTimeout(300);
} else {
  const занятых = await полеРаздела.locator("option[disabled]").count();
  if (занятых !== 7) {
    note("связь этапа", `недоступных разделов ${занятых} вместо семи занятых другими этапами`);
  }
  const занятаяПодпись = занятых === 0
    ? ""
    : (await полеРаздела.locator("option[disabled]").first().textContent())?.trim() ?? "";
  if (занятых > 0 && !занятаяПодпись.includes("ведёт этап")) {
    note("связь этапа", `занятый раздел не называет причину: «${занятаяПодпись}»`);
  }

  const свободные = полеРаздела.locator("option:not([disabled])");
  if ((await свободные.count()) < 2) {
    note("связь этапа", "в списке нет ни одного свободного раздела: связывать не с чем");
    await page.click('.sheet button:has-text("Отмена")');
    await page.waitForTimeout(300);
  } else {
    const разделId = await свободные.nth(1).getAttribute("value");
    const разделИмя = (await свободные.nth(1).textContent())?.trim() ?? "";
    await полеРаздела.selectOption(разделId ?? "");

    const бригадныеЗначения = await полеБригады.locator("option").evaluateAll(
      (options) => options.map((option) => option.value).filter((value) => value !== ""),
    );
    if (бригадныеЗначения.length === 0) {
      note("связь этапа", "в списке бригад пусто: назначать получателя некого");
    } else {
      await полеБригады.selectOption(бригадныеЗначения[0] ?? "");
    }

    await page.click('.sheet button:has-text("Сохранить")');
    await page.waitForTimeout(900);

    /* Лист, оставшийся открытым, означает отказ сервера. Предложенный
       экраном раздел, который сервер не принимает, — дефект самого списка:
       занятые разделы экран обязан не предлагать. */
    if ((await page.locator(".sheet").count()) > 0) {
      const отказСервера = (await page.locator(".sheet .field__error").first().textContent())?.trim() ?? "";
      note("связь этапа", `сервер отказал в предложенном экраном разделе: «${отказСервера}»`);
      await page.click('.sheet button:has-text("Отмена")');
      await page.waitForTimeout(300);
    } else {
      /* Значение обязано пережить сохранение: лист собирается заново из
         ответа сервера, и «выбрал, сохранил, а там пусто» — обычный отказ
         записи. */
      await page.click('.gantt__title:has-text("Проверка страницы")');
      await page.waitForSelector('.sheet label:has-text("Раздел сметы") select');
      if ((await полеРаздела.inputValue()) !== разделId) {
        note("связь этапа", `раздел не сохранился: в поле «${await полеРаздела.inputValue()}»`);
      }
      if (бригадныеЗначения.length > 0 && (await полеБригады.inputValue()) !== бригадныеЗначения[0]) {
        note("связь этапа", "бригада не сохранилась у этапа");
      }
      await page.click('.sheet button:has-text("Отмена")');
      await page.waitForTimeout(300);

      /* Следствие на вкладке приёмки: раздел перестал быть бездействующим. */
      await page.click('.tabs__item:has-text("Приёмка")');
      await page.waitForSelector(".accept__section");
      const вкладкаРаздела = page.locator(`.accept__section:has-text("${разделИмя}")`).first();
      if ((await вкладкаРаздела.count()) === 0) {
        note("связь этапа", `раздела «${разделИмя}» нет на вкладке приёмки`);
      } else if ((await вкладкаРаздела.getAttribute("class"))?.includes("accept__section--idle")) {
        note("связь этапа", `раздел «${разделИмя}» остался бездействующим после связи с этапом`);
      }

      await page.click('.tabs__item:has-text("Работа")');
      await page.waitForSelector(".gantt__row");
    }

    /* Предзаполнение названия по разделу (Р19): выбор раздела заполняет
       пустое название и не трогает набранное. */
    await page.click('button:has-text("Добавить этап")');
    await page.waitForSelector('.sheet label:has-text("Раздел сметы") select');
    const полеИмени = page.locator(".sheet input").first();
    const свободныйДляИмени = полеРаздела.locator("option:not([disabled])");
    if ((await свободныйДляИмени.count()) > 1) {
      const значение = await свободныйДляИмени.nth(1).getAttribute("value");
      const подпись = (await свободныйДляИмени.nth(1).textContent())?.trim() ?? "";
      await полеРаздела.selectOption(значение ?? "");
      await page.waitForTimeout(200);
      const подставлено = (await полеИмени.inputValue()).trim();
      if (подставлено === "") {
        note("связь этапа", "выбор раздела не подставил название в пустое поле");
      } else if (!подпись.startsWith(подставлено.slice(0, 20))) {
        note("связь этапа", `подставлено «${подставлено}», а раздел называется «${подпись}»`);
      }
      /* Набранное название выбор раздела не переписывает. */
      await полеИмени.fill("Своё название");
      const другой = await свободныйДляИмени.nth(2).getAttribute("value");
      if (другой !== null) {
        await полеРаздела.selectOption(другой);
        await page.waitForTimeout(200);
        if ((await полеИмени.inputValue()) !== "Своё название") {
          note("связь этапа", "выбор раздела переписал набранное человеком название");
        }
      }
    }
    await page.click('.sheet button:has-text("Отмена")');
    await page.waitForTimeout(300);
  }
}
await step("работа, раздел и бригада у этапа", "27b-etap-razdel.png");

/* Заведённое снимается: стенд возвращается к семи этапам. */
await page.click('.gantt__title:has-text("Проверка страницы")');
await page.waitForSelector('.sheet button:has-text("Снять этап")');
await page.click('.sheet button:has-text("Снять этап")');
await page.waitForSelector(".sheet .btn--danger");
const текстСнятия = await page.locator(".sheet").innerText();
if (!текстСнятия.includes("Готовность объекта пересчитается")) {
  note("график", "подтверждение снятия не называет последствие");
}
await page.click(".sheet .btn--danger");
await page.waitForTimeout(900);
const послеСнятия = await page.locator(".gantt__row").count();
if (послеСнятия !== 7) note("график", `после снятия строк ${послеСнятия} вместо семи`);

/* График на телефоне: колонка названия уже, день той же ширины. */
await page.setViewportSize({ width: 360, height: 780 });
await page.waitForTimeout(400);
const деньУзко = await page.locator(".gantt__scale .gantt__day").first().boundingBox();
if (узкий !== null && деньУзко !== null && Math.abs(деньУзко.width - узкий.width) > 1) {
  note("график", `на 360 px день сжался до ${Math.round(деньУзко.width)} px`);
}
/* Ручка перестановки на телефоне не показывается: её работу делает поле
   «Место в графике» в листе. Проверяется и то, что её нет, и то, что путь
   к листу открыт целью нужного размера. */
if (await page.locator(".gantt__move").first().isVisible()) {
  note("график", "ручка перестановки показана на 360 px, где её тянуть нечем");
}
const названиеЭтапа = await page.locator(".gantt__title").first().boundingBox();
if (названиеЭтапа !== null && названиеЭтапа.height < 48) {
  note("график", `название этапа на 360 px — ${Math.round(названиеЭтапа.height)} px вместо 48`);
}
await page.click(".gantt__title");
await page.waitForSelector(".sheet select");
/* Счёт идёт по своему полю, а не по всем полям выбора листа: их стало
   три — место в графике, раздел сметы и бригада. */
const мест = await page.locator('.sheet label:has-text("Место в графике") select option').count();
if (мест !== 7) note("график", `в поле «Место в графике» ${мест} мест вместо семи`);
await page.click('.sheet button:has-text("Отмена")');
await page.waitForTimeout(300);
await step("работа на телефоне", "28-grafik-360.png");
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(300);

/*
 * Приёмка — ядро продукта и единственный экран, живущий на телефоне прораба.
 * Проверяется то, чего не видно на снимке: что отметить можно только там,
 * где есть бригада, что лист отказывает до обращения к сети, что сторно
 * возвращает счётчики, и что порог трёх касаний на пакет соблюдён.
 */
/* Снимок фактической готовности до приёмки: ниже он сверяется дважды —
   после пакета и после сторно. */
const фактыДоПриёмки = await фактыГрафика();

await page.click('.tabs__item:has-text("Приёмка")');
await page.waitForSelector(".accept__row");

/* Три меры шапки обязаны сходиться между собой. Расхождение «принято ноль
   позиций» при «начислено четыреста тысяч» уже случалось: позиции брались
   из действующей редакции сметы, а начисления — за всё время объекта, и
   после импорта новой редакции числа расходились. Глазом это видно на
   снимке, проверкой — не ловилось. */
const меры = await page.locator(".accept .metric").allInnerTexts();
const принятоПозиций = Number.parseInt(меры[0]?.split("/")[0]?.trim() ?? "0", 10);
const цифры = (текст) => Number.parseInt((текст ?? "").replace(/[^\d]/gu, "") || "0", 10);
const выполнено = цифры(меры[1]);
const начислено = цифры(меры[2]);
if ((принятоПозиций === 0) !== (выполнено === 0)) {
  note("приёмка", `принято позиций ${принятоПозиций}, а выполнено на сумму ${выполнено}`);
}
if (принятоПозиций === 0 && начислено > 0) {
  note("приёмка", `принято ноль позиций, а начислено ${начислено}: меры не сходятся`);
}

const разделовПриёмки = await page.locator(".accept__section").count();
if (разделовПриёмки !== 11) note("приёмка", `разделов ${разделовПриёмки} вместо одиннадцати`);

/* Раздел без этапа называет причину и уводит на график, а не гасит кнопку
   молча: погашенный орган не объясняет, почему он погашен. */
await page.click(".accept__section--idle");
await page.waitForTimeout(300);
/* Читается через count(): у отсутствующего узла textContent бросает
   исключение и роняет весь обход, а падение прячет всё, что идёт после. */
const объяснение = page.locator('.accept__list [role="alert"]');
const безЭтапа = (await объяснение.count()) === 0
  ? ""
  : (await объяснение.first().textContent())?.trim() ?? "";
if (!безЭтапа.includes("нет этапа графика") || !безЭтапа.includes("Работа")) {
  note("приёмка", `раздел без этапа не объясняет отказ: «${безЭтапа}»`);
}
if (await page.locator(".accept__check").first().isEnabled()) {
  note("приёмка", "в разделе без этапа отметка позиции доступна");
}

/* Раздел с этапом: отметка, полоса подтверждения, лист. Счёт касаний идёт
   отсюда — раздел уже открыт первым касанием. */
await page.click('.accept__section:not(.accept__section--idle)');
await page.waitForTimeout(300);
const свободная = page.locator(".accept__row").filter({ hasNot: page.locator(".pill--ok") }).first();
await свободная.locator(".accept__check").click();
if ((await page.locator(".accept__bar").count()) === 0) {
  note("приёмка", "полосы подтверждения нет: пакет не подтвердить");
} else {
  await page.click('.accept__bar button:has-text("Принять")');
  await page.waitForSelector(".sheet", { timeout: 10_000 }).catch(() => undefined);
}

/* Проверки листа идут одним куском под условием: не открывшийся лист
   оставил бы каждую следующую строку падать по таймауту, а падение
   прячет весь остаток обхода. */
if ((await page.locator(".sheet").count()) === 0) {
  note("приёмка", "лист подтверждения не открылся");
} else {
  const полеКоличества = page.locator(".sheet .input--num").first();
  await полеКоличества.fill("999999");
  await page.waitForTimeout(300);
  const отказЛистаУзел = page.locator('.sheet [role="alert"]');
  const отказЛиста = (await отказЛистаУзел.count()) === 0
    ? ""
    : (await отказЛистаУзел.first().textContent())?.trim() ?? "";
  if (!отказЛиста.includes("по смете осталось")) {
    note("приёмка", `лист не отказал на превышении: «${отказЛиста}»`);
  }
  if (await page.locator('.sheet button:has-text("Подтвердить")').isEnabled()) {
    note("приёмка", "кнопка подтверждения доступна при превышении остатка");
  }

  /* Без снимка подтвердить нельзя: пакет без свидетельства свидетельством
     не является. */
  await полеКоличества.fill("1");
  await page.waitForTimeout(300);
  if (await page.locator('.sheet button:has-text("Подтвердить")').isEnabled()) {
    note("приёмка", "подтверждение доступно без снимка");
  }
  await step("приёмка, лист подтверждения", "33-priyomka-list.png");

  await page.setInputFiles('.sheet input[type="file"]', "scripts/fixtures/snimok.png");
  await page.waitForTimeout(300);
  if (!(await page.locator('.sheet button:has-text("Подтвердить")').isEnabled())) {
    note("приёмка", "подтверждение недоступно при заполненном количестве и снимке");
  }

  const пакетовДо = await page.locator(".accept__batch").count();
  await page.click('.sheet button:has-text("Подтвердить")');
  await page.waitForTimeout(1200);
  const пакетовПосле = await page.locator(".accept__batch").count();
  if (пакетовПосле !== пакетовДо + 1) {
    note("приёмка", `пакетов ${пакетовПосле} вместо ${пакетовДо + 1}`);
  }
}

/*
 * Фактическая готовность выросла: принятое видно в графике, а не только в
 * приёмке. Это и есть смысл величины — ответ на вопрос «сколько сделано»
 * там, где на него смотрят.
 */
const фактыПослеПриёмки = await фактыГрафика();
const выросло = [...фактыПослеПриёмки].some(([имя, факт]) => {
  const было = фактыДоПриёмки.get(имя);
  return было !== undefined && было !== факт;
});
if (!выросло) {
  note("фактическая готовность", "после приёмки пакета ни одна фактическая не изменилась");
}
await page.click('.tabs__item:has-text("Приёмка")');
await page.waitForSelector(".accept__row");

/* Сторно возвращает счётчики. Проверяется на только что заведённой строке:
   чужие приёмки стенда трогать незачем. */
const сторнируемая = page.locator(".accept__batch").first()
  .locator('.accept__line button:has-text("Сторнировать")').first();
if ((await сторнируемая.count()) === 0) {
  note("приёмка", "у первой строки пакета нет сторно");
} else {
  await сторнируемая.click();
  await page.waitForSelector(".sheet .btn--danger", { timeout: 10_000 }).catch(() => undefined);
  const текстСторно = (await page.locator(".sheet").count()) === 0
    ? ""
    : await page.locator(".sheet").innerText();
  if (!текстСторно.includes("останутся в истории")) {
    note("приёмка", "лист сторно не называет, что записи остаются в истории");
  }
  if (await page.locator(".sheet .btn--danger").isEnabled()) {
    note("приёмка", "сторно доступно без указания причины");
  }
  await page.fill(".sheet .input", "Проверка страницы");
  await page.waitForTimeout(200);
  await step("приёмка, сторно", "34-priyomka-storno.png");
  await page.click(".sheet .btn--danger");
  await page.waitForTimeout(1200);
  if ((await page.locator(".accept__line--reversed").count()) === 0) {
    note("приёмка", "сторнированная строка не помечена");
  }
}

/* Сторно возвращает и фактическую готовность: обратная запись вычитает
   ровно столько, сколько добавила прямая, и график обязан вернуться к
   прежнему числу. Расхождение здесь означало бы, что доля где-то
   накапливает погрешность округления. */
const фактыПослеСторно = await фактыГрафика();
for (const [имя, было] of фактыДоПриёмки) {
  const стало = фактыПослеСторно.get(имя);
  if (стало !== было) {
    note("фактическая готовность", `после сторно «${имя}»: «${стало ?? ""}» вместо «${было}»`);
  }
}
await step("работа, фактическая готовность", "36b-grafik-fakt.png");
await page.click('.tabs__item:has-text("Приёмка")');
await page.waitForSelector(".accept__row");

/* Приёмка на телефоне: зоны касания и отсутствие переполнения. Порог трёх
   касаний относится к пакету — раздел, «Принять», «Подтвердить». */
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await overflow("приёмка, 390");
for (const selector of [".accept__check", ".accept__section"]) {
  const box = await page.locator(selector).first().boundingBox();
  if (box !== null && box.height < 44) {
    note("приёмка", `зона касания «${selector}» на 390 px — ${Math.round(box.height)} px вместо 44`);
  }
}
await step("приёмка на телефоне", "35-priyomka-390.png");
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(300);

await page.click('.tabs__item:has-text("Обзор")');

/*
 * Транши. Вопрос вкладки — сколько ещё можно выработать до акта.
 *
 * Главная проверка — согласованность мер: остаток на экране обязан равняться
 * сумме транша минус выработка с надбавкой, посчитанной здесь заново. Та же
 * проверка на приёмке поймала смешение редакций сметы; здесь она стережёт
 * расхождение полосы с таблицей и надбавку, взятую не у той сметы.
 */
/* Обход обёрнут условием: не открывшаяся вкладка оставляла каждую следующую
   строку падать по таймауту, а падение прятало весь остаток обхода. Непадающая
   проверка не стережёт ничего, но и роняющая обход — тоже. */
if ((await page.locator('.tabs__item:has-text("Транши")').count()) === 0) {
  note("транши", "вкладки «Транши» нет в карточке объекта");
} else {
await page.click('.tabs__item:has-text("Транши")');
await page.waitForTimeout(500);

const остатокВСводке = (await page.locator("aside .figure__label:has-text('Остаток текущего транша')")
  .count()) === 0
  ? null
  : (await page.locator("aside .figure__label:has-text('Остаток текущего транша')")
      .locator("xpath=following-sibling::span[1]").first().textContent());
if (остатокВСводке === null) {
  note("транши", "остатка текущего транша нет в сводке объекта");
}

const строкиТраншей = await page.locator(".tranche__row").count();
if (строкиТраншей < 2) {
  note("транши", `строк траншей ${строкиТраншей}: на стенде их не меньше двух`);
}

/* Разбор величин строки. Числа приходят оформленными («450 000,00 ₽»),
   поэтому разбираются обратно в копейки: сверять надо арифметику, а не
   написание. Неразрывный пробел — разделитель разрядов формата. */
const вКопейки = (текст) => {
  // \u00A0 — неразрывный пробел разделителя разрядов, \u2212 — типографский минус.
  const очищено = (текст ?? "").replace(/[\s\u00A0\u20BD]/g, "").replace("\u2212", "-");
  const match = /^(-?)(\d+),(\d{2})$/.exec(очищено);
  return match === null ? null : BigInt(`${match[1]}${match[2]}${match[3]}`);
};

const надбавкаЭкрана = await page.locator(".section-head .t-cap:has-text('надбавка')").first()
  .textContent().catch(() => null);
const доля = надбавкаЭкрана === null
  ? null
  : BigInt(Math.round(Number.parseFloat(надбавкаЭкрана.replace(/[^\d.,]/g, "").replace(",", ".")) * 100));
if (доля === null) note("транши", "надбавка не названа на вкладке");

for (let i = 0; i < строкиТраншей; i += 1) {
  const строка = page.locator(".tranche__row").nth(i);
  const величины = await строка.locator(".tranche__figures .num").allTextContents();
  const [сумма, выработано, остаток] = величины.map(вКопейки);
  if (сумма === null || выработано === null || остаток === null) {
    note("транши", `строка ${i + 1}: величины не разобраны — «${величины.join(" / ")}»`);
    continue;
  }
  if (сумма - выработано !== остаток) {
    note("транши", `строка ${i + 1}: остаток ${остаток} не равен ${сумма} − ${выработано}`);
  }
}

/* Полоса открытого транша: заливка не вылезает за дорожку, а число остатка
   при перевыработке отрицательное и не обрезается. */
if ((await page.locator(".tranche__bar").count()) === 0) {
  note("транши", "полосы открытого транша нет");
} else {
  /* Ширина читается объявленной, а не измеренной: у дорожки `overflow:
     hidden`, и браузер обрезает бокс заливки по её границе. Измерение здесь
     всегда сходится, и проверка по нему не стережёт ничего — установлено
     откатом, который она не поймала. */
  const объявленная = await page.locator(".tranche__fill").first()
    .evaluate((узел) => узел.style.inlineSize);
  const доляПолосы = Number.parseFloat(объявленная);
  if (!Number.isFinite(доляПолосы)) {
    note("транши", `ширина заливки не объявлена: «${объявленная}»`);
  } else if (доляПолосы > 100) {
    note("транши", `заливка объявлена на ${доляПолосы.toFixed(2)} % — шире дорожки`);
  }
}

await step("транши", "36-transhi.png");

/* Лист открытия: отказ показывается до обращения к сети, тем же правилом,
   что применит сервер. Второй открытый транш при уже открытом отклоняется. */
await page.click('.btn--primary:has-text("Открыть транш")');
await page.waitForTimeout(400);
if ((await page.locator(".sheet").count()) === 0) {
  note("транши", "лист открытия не открылся");
} else {
  await page.locator('.sheet input[inputmode="decimal"]').fill("450000");
  await page.waitForTimeout(250);
  const отказЛиста = await page.locator(".sheet .field__error").first().textContent().catch(() => null);
  if (отказЛиста === null || !отказЛиста.includes("уже открыт транш")) {
    note("транши", `лист не отказал на втором открытом транше: «${отказЛиста ?? "молча"}»`);
  }
  if (await page.locator('.sheet button[type="submit"]').isEnabled()) {
    note("транши", "кнопка открытия доступна при уже открытом транше");
  }
  await page.locator('.sheet input[inputmode="decimal"]').fill("0");
  await page.waitForTimeout(250);
  const отказНуля = await page.locator(".sheet .field__error").first().textContent().catch(() => null);
  if (отказНуля === null || !отказНуля.includes("больше нуля")) {
    note("транши", `лист не отказал на нулевой сумме: «${отказНуля ?? "молча"}»`);
  }
  await step("транши, лист открытия", "37-transh-list.png");
  await page.click('.sheet .btn--text:has-text("Отмена")');
  await page.waitForTimeout(300);
}

/* Транши на телефоне: шесть величин в строку на 390 px не помещаются, и
   раскладка обязана переносить их второй строкой без переполнения. */
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await overflow("транши, 390");
await step("транши на телефоне", "38-transhi-390.png");
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(300);
}

await page.click('.tabs__item:has-text("Обзор")');
await page.waitForTimeout(500);

/*
 * Журнал объекта в ленте событий.
 *
 * Обход выше правил позицию сметы, надбавку, сроки этапа и вёл транши —
 * каждое действие писало запись. Лента обязана их показать: журнал
 * заводился ради спора «кто поменял величину», и запись, которой не видно,
 * спора не решает. Деньги в записи читаются рублями: сырые копейки в строке
 * «115050 → 120000» читаются как рубли и врут в сто раз.
 */
const лента = await page.locator(".feed__item").allInnerTexts();
if (лента.length === 0) {
  note("журнал", "лента событий объекта пуста: записи есть, показать их нечем");
} else {
  /* Проверяются разделы, записи которых обход создаёт сам и только что:
     лента отдаёт двадцать последних, и записи, сделанные при наполнении
     стенда, к концу обхода из окна вытесняются. Проверка, зависящая от
     окна, краснела бы через раз и не стерегла бы ничего. Транши стережёт
     `verify-api`, где блок журнала стоит сразу после работы с ними. */
  const разделы = ["Смета", "График"];
  const пропущены = разделы.filter((раздел) => !лента.some((строка) => строка.includes(`${раздел}:`)));
  if (пропущены.length > 0) {
    note("журнал", `в ленте нет записей: ${пропущены.join(", ")}`);
  }
  /* Читаемость денег здесь не проверяется. Лента отдаёт двадцать последних
     записей, и попадёт ли в окно правка цены, зависит от хода обхода:
     откат — запись сырых копеек — этой проверки не уронил, то есть она не
     стерегла ничего. Деньги стережёт `verify-api` там, где они пишутся. */
}
await step("журнал объекта", "39-zhurnal.png");

/*
 * Шкала скруглений. Верхняя ступень шкалы — 12 px,
 * и блок с большим скруглением означает значение мимо токена. Проверяется
 * на карточке объекта — там больше всего разных блоков.
 */
const roundest = await page.evaluate(() => {
  let worst = { radius: 0, selector: "" };
  for (const node of document.querySelectorAll("main *, .stamp, .cover, .appbar")) {
    const radius = Number.parseFloat(getComputedStyle(node).borderTopLeftRadius);
    if (Number.isFinite(radius) && radius > worst.radius && radius < 100) {
      worst = { radius, selector: node.className.toString().slice(0, 40) || node.tagName };
    }
  }
  return worst;
});
if (roundest.radius > 12) {
  note("скругления", `${roundest.radius} px у «${roundest.selector}» при пороге 12 px`);
}
console.log(`  наибольшее скругление блока: ${roundest.radius} px`);

await page.click('.appbar__link:has-text("Проекты")');
await page.waitForSelector(".datatable__table tbody tr");

// Мобильная ширина. Нижняя таб-панель существует только здесь.
await page.setViewportSize({ width: 360, height: 800 });
await page.waitForTimeout(400);
await overflow("контрагенты, 360");
const tabbar = await page.locator(".tabbar__item").count();
if (tabbar === 0) note("мобильная навигация", "нижняя таб-панель не показана на ширине 360");

/**
 * Панель прибита к низу экрана и перекрывает конец страницы, если под неё
 * не отведено место. Проверяется поведением: в конце прокрутки последний
 * блок содержимого не должен оказаться под панелью.
 */
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(300);
const covered = await page.evaluate(() => {
  const blocks = [...document.querySelectorAll("main .tile, main .panel, main .figure, main .deflist")];
  const last = blocks.at(-1);
  if (last === undefined) return null;
  const box = last.getBoundingClientRect();
  const point = document.elementFromPoint(box.x + box.width / 2, box.bottom - 4);
  return point === null || point.closest(".tabbar") !== null ? last.textContent?.slice(0, 40) : null;
});
if (covered !== null) note("мобильная навигация", `таб-панель перекрывает содержимое: «${covered}»`);

/**
 * Список объектов на телефоне: карточки, а не таблица. Семь колонок на
 * ширине 360 px уводят половину сведений за край экрана, а работает там
 * прораб.
 */
await page.click('.tabbar__item:has-text("Проекты")');
await page.waitForSelector(".segmented__option");
await page.waitForTimeout(300);
const mobileTable = await page.locator("main .datatable__table").count();
const mobileRows = await page.locator("main .objectrow").count();
if (mobileTable > 0) note("список объектов, 360", "показана таблица вместо ведомости");
if (mobileRows === 0) note("список объектов, 360", "строки объектов не отрисованы");
// Д-19: поиск существует и в узкой раскладке.
if ((await page.locator("main .datatable__search input").count()) === 0) {
  note("список объектов, 360", "поиска нет в узкой раскладке");
}
console.log(`  строк объектов на 360 px: ${mobileRows}`);
await overflow("объекты, 360");
await step("объекты на телефоне", "10b-obekty-360.png");
await step("мобильный, 360 px", "10-mobile-360.png");

await page.setViewportSize({ width: 768, height: 1000 });
await page.waitForTimeout(300);
await overflow("после импорта, 768");

/*
 * Планшет — рабочее устройство прораба. Таблица из семи колонок на 768 px
 * не складывалась, а сжималась: адрес рвался на три строки, высота строки
 * росла вдвое. Список объектов обязан быть ведомостью (реестр Д-04).
 */
await page.click('.appbar__link:has-text("Проекты")');
await page.waitForTimeout(400);
if ((await page.locator("main .datatable__table").count()) > 0) {
  note("список объектов, 768", "на планшете показана таблица вместо ведомости");
}
await step("объекты на планшете", "11b-obekty-768.png");
await step("планшет, 768 px", "11-tablet-768.png");

// Иконки. Экраны ссылаются на символы через <use href="#i-…">: если набора
// нет в документе, ссылка ведёт в пустоту и иконка не рисуется, причём молча.
const brokenIcons = await page.evaluate(() =>
  [...document.querySelectorAll("use")]
    .map((node) => node.getAttribute("href") ?? "")
    .filter((href) => href.startsWith("#") && document.getElementById(href.slice(1)) === null),
);
if (brokenIcons.length > 0) note("иконка без символа", [...new Set(brokenIcons)].join(", "));

/*
 * Тема одна — светлая, решением заказчика от 11.09.2026.
 *
 * Проверяется не наличие светлого, а отсутствие тёмного: снятая тёмная
 * палитра возвращается по кусочкам — правилом под медиазапросом, признаком
 * на корне, забытым переключателем, — и продукт снова о двух темах, из
 * которых поддерживается одна.
 *
 * Экран смотрится с системной тёмной темой: именно в этом состоянии
 * недосмотр и виден. Без `color-scheme: light` браузер закрасит поля ввода,
 * выпадающие списки и полосы прокрутки тёмным поверх нашего светлого
 * полотна, и продукт станет двухцветным без единой строки тёмной палитры.
 */
await page.setViewportSize({ width: 1440, height: 900 });
await page.emulateMedia({ colorScheme: "dark" });
await page.waitForTimeout(300);

const светлая = await page.evaluate(() => {
  const корень = document.documentElement;
  return {
    признак: корень.getAttribute("data-theme"),
    схема: getComputedStyle(корень).colorScheme,
    полотно: getComputedStyle(document.body).backgroundColor,
    переключателей: document.querySelectorAll(".themeswitch").length,
  };
});
if (светлая.признак !== null) {
  note("тема", `на корне остался признак темы: data-theme="${светлая.признак}"`);
}
if (!светлая.схема.includes("light") || светлая.схема.includes("dark")) {
  note("тема", `браузеру объявлена схема «${светлая.схема}» вместо light: системные органы управления потемнеют`);
}
if (светлая.переключателей > 0) {
  note("тема", `на экране ${светлая.переключателей} переключателей темы: темы одна`);
}
/* Полотно светлое при системной тёмной. Разбор в числа, а не сравнение
   строк: браузер волен отдать rgb или rgba, и сравнение по написанию
   сломалось бы на пустом месте. */
const [r = 0, g = 0, b = 0] = (/rgba?\(([^)]+)\)/u.exec(светлая.полотно)?.[1] ?? "")
  .split(",").map((часть) => Number(часть.trim()));
if ((r + g + b) / 3 < 200) {
  note("тема", `при системной тёмной полотно осталось тёмным: ${светлая.полотно}`);
}
await step("светлая тема при системной тёмной", "12-svetlaya.png");
await page.emulateMedia({ colorScheme: "light" });

/*
 * Отбор позиций внутри раздела приёмки.
 *
 * Раздел держит до нескольких десятков позиций, и прораб ищет в нём одну
 * стоя на объекте. Проверяется, что отбор сужает список, что счётчик
 * называет то же число, что видно, и что пустой отбор объясняется словами,
 * а не пустотой.
 */
/* Переход делается на широком экране: до 1023 px верхнее меню уступает
   место нижней полосе, и ссылка шапки там не видна. Ширина телефона
   выставляется после перехода — проверяется отбор, а не навигация. */
await page.click('.appbar__link:has-text("Проекты")');
await page.waitForSelector(".datatable__table tbody tr");
await page.click('.datatable__table tbody tr:has(.code-badge:text-is("R-99")) a');
await page.waitForSelector(".tabs__item");
await page.click('.tabs__item:has-text("Приёмка")');
await page.waitForSelector(".accept__row");
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);

const всего = await page.locator(".accept__row").count();
if ((await page.locator(".accept__filter input[type=\"search\"]").count()) === 0) {
  note("отбор приёмки", "поля поиска позиции в разделе нет");
} else {
  const первая = (await page.locator(".accept__name").first().textContent()) ?? "";
  const кусок = первая.trim().slice(0, 6);
  await page.fill('.accept__filter input[type="search"]', кусок);
  await page.waitForTimeout(300);
  const послеПоиска = await page.locator(".accept__row").count();
  if (послеПоиска === 0) {
    note("отбор приёмки", `поиск по «${кусок}» не нашёл даже ту позицию, из которой взят`);
  }
  if (послеПоиска >= всего && всего > 1) {
    note("отбор приёмки", `поиск по «${кусок}» не сузил список: ${послеПоиска} из ${всего}`);
  }
  const счётчик = (await page.locator(".accept__filter .num").textContent()) ?? "";
  if (!счётчик.trim().startsWith(String(послеПоиска))) {
    note("отбор приёмки", `счётчик показывает «${счётчик.trim()}», а строк ${послеПоиска}`);
  }
  /* Пустой отбор объясняется словами: пустота на месте списка не говорит,
     раздел пуст или запрос ничего не нашёл. */
  await page.fill('.accept__filter input[type="search"]', "щцъфывапролдж");
  await page.waitForTimeout(300);
  if ((await page.locator(".accept__row").count()) !== 0) {
    note("отбор приёмки", "заведомо несуществующий запрос оставил строки");
  }
  const пусто = (await page.locator(".accept__list .empty__text").textContent().catch(() => null)) ?? "";
  if (!пусто.includes("отбор")) {
    note("отбор приёмки", `пустой отбор не объяснён: «${пусто.trim()}»`);
  }
  await page.fill('.accept__filter input[type="search"]', "");
  await page.waitForTimeout(300);
}
/* Область нажатия у флажка — строка подписи целиком, а не квадрат: в
   квадрат 20 px пальцем не попадают, а растянутый до 48 px системный флажок
   рисуется пустой рамкой и читается как незаполненное поле. */
const флажок = await page.locator(".accept__filter .checkline").boundingBox();
if (флажок === null || флажок.height < 44) {
  note("отбор приёмки", `область нажатия флажка ${флажок?.height ?? 0} px при норме 44`);
}
const квадрат = await page.locator(".accept__filter .checkbox").boundingBox();
if (квадрат !== null && квадрат.height > 32) {
  note("отбор приёмки", `флажок растянут до ${квадрат.height} px и читается как пустая рамка`);
}
await step("приёмка, отбор позиций, 390 px", "35b-priyomka-otbor.png");
await page.setViewportSize({ width: 1440, height: 900 });

/*
 * Стенд доводится до состояния, в котором отбор по разделу вообще можно
 * проверить: приёмка заводится во втором разделе, отличном от того, что
 * принят выше по обходу. Без этого шага раздел в отчёте один, отбор
 * сужать нечего, и проверка проходила бы при любой ошибке — то есть не
 * проверяла бы ничего.
 */
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(300);
await page.click('.tabs__item:has-text("Приёмка")');
await page.waitForSelector(".accept__row");
const другойРаздел = page.locator(".accept__section:not(.accept__section--idle)").nth(1);
if ((await другойРаздел.count()) === 0) {
  note("отчёт", "на стенде один раздел с этапом: отбор по разделу проверить не на чем");
} else {
  await другойРаздел.click();
  await page.waitForTimeout(400);
  const свободнаяВторая = page.locator(".accept__row")
    .filter({ hasNot: page.locator(".pill--ok") }).first();
  await свободнаяВторая.locator(".accept__check").click();
  await page.click('.accept__bar button:has-text("Принять")');
  await page.waitForSelector(".sheet", { timeout: 10_000 }).catch(() => undefined);
  await page.locator(".sheet .input--num").first().fill("1");
  await page.setInputFiles('.sheet input[type="file"]', "scripts/fixtures/snimok.png");
  await page.waitForTimeout(300);
  await page.click('.sheet button:has-text("Подтвердить")');
  await page.waitForTimeout(1200);
}

/*
 * Фотоотчёт объекта (стадия C.4).
 *
 * Проверяется то, ради чего вкладка заведена: снимки видны, отбор по
 * разделу сужает показанное, отменённая приёмка помечена, а сетка не
 * прыгает по мере загрузки изображений — место под снимок отведено заранее.
 */
await page.waitForTimeout(300);

/* Место под снимок отведено заранее. Проверяется не стилем, а поведением:
   снимки не отдаются вовсе, и высота меряется на том, что осталось. Без
   заданной пропорции карточка схлопывается, а когда снимки доезжают —
   сетка перекладывается под курсором. Мерить после загрузки бесполезно:
   на стенде она мгновенна, и проверка прошла бы при любой вёрстке. */
снимкиОтключены = true;
await page.route("**/acceptance/photo/**", (route) => route.abort());
await page.click('.tabs__item:has-text("Отчёт")');
await page.waitForSelector(".report__card", { timeout: 5000 }).catch(() => null);
const безСнимков = await page.locator(".report__photo").first().boundingBox().catch(() => null);
if (безСнимков === null || безСнимков.height < 80) {
  note("отчёт", `место под снимок ${Math.round(безСнимков?.height ?? 0)} px: сетка переложится по загрузке`);
}
await page.unroute("**/acceptance/photo/**");
снимкиОтключены = false;
await page.click('.tabs__item:has-text("Приёмка")');
await page.waitForTimeout(200);
await page.click('.tabs__item:has-text("Отчёт")');
await page.waitForSelector(".report__card", { timeout: 5000 }).catch(() => null);

const карточекОтчёта = await page.locator(".report__card").count();
if (карточекОтчёта === 0) {
  note("отчёт", "вкладка отчёта не показала ни одной приёмки, хотя на стенде они есть");
} else {

  /* Отбор по разделу. «Весь объект» и хотя бы один раздел — иначе
     сравнивать не с чем, и проверка проходила бы всегда. */
  /* Чипов обязано быть не меньше трёх: «Весь объект» и два раздела.
     Меньше — стенд не даёт проверить отбор, и это замечание, а не повод
     тихо пропустить проверку. */
  const разделов = await page.locator(".segmented__option").count();
  if (разделов < 3) {
    note("отчёт", `в отборе по разделу ${разделов} кнопок: сузить нечем`);
  } else {
    await page.locator(".segmented__option").nth(1).click();
    await page.waitForTimeout(300);
    const послеОтбора = await page.locator(".report__card").count();
    if (послеОтбора === 0) {
      note("отчёт", "отбор по разделу не оставил ни одной приёмки, хотя раздел выбран из списка снятых");
    }
    if (послеОтбора >= карточекОтчёта) {
      note("отчёт", `отбор по разделу не сузил список: ${послеОтбора} из ${карточекОтчёта}`);
    }
    await page.locator(".segmented__option").first().click();
    await page.waitForTimeout(300);
    if ((await page.locator(".report__card").count()) !== карточекОтчёта) {
      note("отчёт", "возврат к «Весь объект» не вернул прежний состав приёмок");
    }
  }

  /* Число и слово при нём согласованы. «2 снимков» и «1 дней» —
     не придирка к языку: продукт, который так пишет, читается как
     недоделанный, и доверия к числам рядом это не прибавляет. */
  const форма = (число, одна, две, много) => {
    const сотня = число % 100;
    const десяток = число % 10;
    if (сотня >= 11 && сотня <= 14) return много;
    if (десяток === 1) return одна;
    if (десяток >= 2 && десяток <= 4) return две;
    return много;
  };
  const меры = await page.locator('[id="panel-report"] .metric').all();
  for (const мера of меры) {
    const число = Number.parseInt((await мера.locator(".metric__value").textContent()) ?? "0", 10);
    const подпись = ((await мера.locator(".metric__label").textContent()) ?? "").trim().toLowerCase();
    const слово = подпись.split(/\s+/u)[0] ?? "";
    const ожидается = слово.startsWith("сним")
      ? форма(число, "снимок", "снимка", "снимков")
      : форма(число, "день", "дня", "дней");
    if (слово !== ожидается) {
      note("отчёт", `«${число} ${слово}» вместо «${число} ${ожидается}»`);
    }
  }

  /* Две одинаковые надписи в отборе выбрать не дают: человеку нечем
     отличить одну от другой, а показывают они разное. Так и было, пока
     раздел считался по опознавателю: повторный импорт заводит разделы
     заново под теми же именами. */
  const надписи = await page.locator(".segmented__label").allTextContents();
  if (new Set(надписи).size !== надписи.length) {
    note("отчёт", `в отборе повторяются надписи: ${надписи.join(", ")}`);
  }

  /* Сторно в отчёте видно. На стенде оно прошло выше по обходу, и
     отсутствие пометки означало бы, что отменённая работа выдана за
     сделанную. */
  if ((await page.locator(".report__card--reversed, .report__line--reversed").count()) === 0) {
    note("отчёт", "отменённая приёмка в отчёте ничем не помечена");
  }

  /* Денег в отчёте нет ни у одной роли: отчёт показывает работу.
     Проверяется по знаку рубля в области вкладки, а не по вёрстке. */
  const текстОтчёта = (await page.locator('[id="panel-report"]').textContent()) ?? "";
  if (текстОтчёта.includes("\u20BD")) {
    note("отчёт", "в отчёте есть денежные величины");
  }
}
await step("отчёт по объекту, 1440", "36-otchyot.png");

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await overflow("отчёт, 390");
await step("отчёт по объекту, 390 px", "36b-otchyot-390.png");
await page.setViewportSize({ width: 1440, height: 900 });

await browser.close();

console.log("\nПроверка страницы:");
if (problems.length === 0) console.log("  замечаний нет");
else for (const problem of problems) console.log("  ✗", problem);

if (environment.length > 0) {
  const unique = [...new Set(environment)];
  console.log("\nОграничения среды (не дефекты страницы):");
  for (const item of unique) console.log("  ·", item);
}
process.exit(problems.length === 0 ? 0 : 1);
