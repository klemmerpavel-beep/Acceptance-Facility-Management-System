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
 * Ожидаемые события, не являющиеся дефектами страницы:
 *   401 на /auth/me до входа — так проверяется наличие сессии;
 *   недоступность fonts.googleapis.com — исходящая сеть песочницы закрыта,
 *   на машине пользователя гарнитуры загрузятся, а до тех пор работает
 *   запасной стек, объявленный в токенах.
 */
const expected = (url, text = "") =>
  url.endsWith("/auth/me") || url.includes("fonts.googleapis.com") || url.includes("fonts.gstatic.com")
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

// Первый экран — сводка по портфелю.
await page.waitForSelector(".weekstrip");
await step("сводка", "03-svodka.png");
await overflow("сводка, 1440");

const cards = await page.locator(".figrow > .figure").count();
const week = await page.locator(".daycard").count();
const feed = await page.locator(".feed__item").count();
console.log(`  величин сводки: ${cards}, дней в неделе: ${week}, строк в ленте: ${feed}`);
if (week !== 7) note("неделя", `в полосе ${week} дней вместо семи`);
if (cards < 3) note("сводка", `величин ${cards}: ряд денежных величин не собран`);
if ((await page.locator(".daycard--today").count()) !== 1) {
  note("неделя", "сегодняшний день не отмечен ровно один раз");
}

/**
 * Лента ограничена и сгруппирована по дням. Без предела она вырастает
 * длиннее всей страницы: смена статуса и импорт повторяются десятками.
 */
if (feed > 9) note("лента событий", `строк ${feed}: предел в восемь записей не работает`);
if ((await page.locator(".feed__day").count()) === 0) {
  note("лента событий", "нет группировки по дням");
}

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
await page.click('.appbar__link:has-text("Объекты")');
await page.waitForSelector(".datatable__table tbody tr");
await step("объекты", "04-obekty.png");
await overflow("объекты, 1440");

const rows = await page.locator(".datatable__table tbody tr").count();
console.log(`  объектов в списке: ${rows}`);

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
await page.click('button:has-text("Создать редакцию сметы")');
await page.waitForSelector('.sheet[role="dialog"]');
const confirmText = (await page.locator('.sheet[role="dialog"]').textContent()) ?? "";
for (const must of ["Позиций будет записано", "Недосчёт итога", "станет действующей"]) {
  if (!confirmText.includes(must)) {
    note("подтверждение импорта", `диалог не называет «${must}»`);
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
 * Смена статуса проверяется на объекте R-72, а не на показательном R-99:
 * каждый прогон оставляет в журнале две записи, и лента объекта, который
 * идёт в демонстрацию, заполнялась бы следами проверок вместо работы.
 */
await page.click('.appbar__link:has-text("Объекты")');
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

// Контрагенты: заказчики и бригады.
await page.click('.appbar__link:has-text("Контрагенты")');
await page.waitForSelector('h2:has-text("Заказчики")');
const clients = await page.locator(".datatable__table tbody tr").count();
const brigades = await page.locator('section:has(h2:text-is("Бригады")) .deflist__row').count();
console.log(`  заказчиков: ${clients}, бригад: ${brigades}`);
if (brigades === 0) note("контрагенты", "бригады не показаны");
if (clients === 0) note("контрагенты", "список заказчиков пуст");
await step("контрагенты", "09b-kontragenty.png");
await overflow("контрагенты, 1440");

/**
 * Состав навигации. Правило: в шапке только то, что открывает рабочий
 * экран. Четыре раздела — «Главная», «Объекты», «Контрагенты»,
 * «Настройки»; ни «Ещё», ни меню быстрых действий, ни заглушек.
 */
const navLabels = (await page.locator(".appbar__nav .appbar__link").allTextContents())
  .map((text) => text.trim());
const navWanted = ["Главная", "Объекты", "Контрагенты", "Настройки"];
if (navLabels.join("|") !== navWanted.join("|")) {
  note("навигация", `в шапке «${navLabels.join(", ")}»`);
}
if ((await page.locator(".appbar__action").count()) !== 0) {
  note("навигация", "в шапке осталась кнопка меню быстрых действий");
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

// Настройки организации: карточка и справочник единиц.
await page.click('.appbar__link:has-text("Настройки")');
await page.waitForSelector('.tabs__item:has-text("Организация")');
const settingsTabs = (await page.locator(".tabs__item").allTextContents())
  .map((text) => text.trim());
if (settingsTabs.join("|") !== "Организация|Единицы измерения") {
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
if (roadmap < 8) note("что дальше", `строк ${roadmap} — список неполон`);
if (stages !== roadmap) note("что дальше", `стадию называют ${stages} строк из ${roadmap}`);
const roadmapTitle = await page.locator(".cover h1").textContent();
if (roadmapTitle?.trim() !== "Что дальше") {
  note("что дальше", `обложка называет экран «${roadmapTitle ?? "—"}»`);
}
await step("что дальше", "18-chto-dalshe.png");
await overflow("что дальше, 1440");

// Вкладки карточки объекта: две рабочих и служебный импорт руководителю.
await page.click('.appbar__link:has-text("Объекты")');
await page.waitForSelector(".datatable__table tbody tr");
await page.click('.datatable__table tbody tr:has(.code-badge:text-is("R-99")) a');
await page.waitForSelector(".tabs__item");
const cardTabs = (await page.locator(".tabs__item").allTextContents()).map((text) => text.trim());
if (cardTabs.join("|") !== "Обзор|Замер|Смета|Импорт") {
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

await page.click('.tabs__item:has-text("Обзор")');

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

await page.click('.appbar__link:has-text("Объекты")');
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
await page.click('.tabbar__item:has-text("Объекты")');
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
await page.click('.appbar__link:has-text("Объекты")');
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

// Тёмная тема по системной настройке.
await page.setViewportSize({ width: 1440, height: 900 });
await page.emulateMedia({ colorScheme: "dark" });
await page.waitForTimeout(300);
await step("тёмная тема", "12-dark.png");

/**
 * Переключатель темы. Смысл проверки не в атрибуте, а в том, что явный выбор
 * побеждает системную настройку: браузер здесь эмулирует системную тёмную,
 * и выбранная светлая обязана её перекрыть.
 */
const themeState = async () =>
  page.evaluate(() => ({
    attribute: document.documentElement.getAttribute("data-theme"),
    background: getComputedStyle(document.body).backgroundColor,
    scheme: getComputedStyle(document.documentElement).colorScheme,
  }));

const systemDark = await themeState();
if (systemDark.attribute !== null) note("тема", `в системном режиме признак не снят: ${systemDark.attribute}`);

await page.click('.themeswitch__option[title="Светлая тема"]');
await page.waitForTimeout(200);
const forcedLight = await themeState();
if (forcedLight.attribute !== "light") note("тема", "выбор светлой не выставил data-theme");
if (forcedLight.background === systemDark.background) {
  note("тема", `светлая не перекрыла системную тёмную: фон остался ${forcedLight.background}`);
}
if (!forcedLight.scheme.includes("light") || forcedLight.scheme.includes("dark")) {
  note("тема", `светлая не сообщена браузеру: color-scheme = ${forcedLight.scheme}`);
}
await step("светлая тема поверх системной тёмной", "13-svetlaya.png");

await page.emulateMedia({ colorScheme: "light" });
await page.click('.themeswitch__option[title="Тёмная тема"]');
await page.waitForTimeout(200);
const forcedDark = await themeState();
if (forcedDark.attribute !== "dark") note("тема", "выбор тёмной не выставил data-theme");
if (forcedDark.background === forcedLight.background) {
  note("тема", `тёмная не перекрыла системную светлую: фон остался ${forcedDark.background}`);
}
await step("тёмная тема поверх системной светлой", "14-tyomnaya.png");

await page.click('.themeswitch__option[title="Как в системе"]');
await page.waitForTimeout(200);
const backToSystem = await themeState();
if (backToSystem.attribute !== null) note("тема", "возврат к системной не снял признак");
if (backToSystem.background !== forcedLight.background) {
  note("тема", "возврат к системной не вернул системный фон");
}

// Выбор обязан пережить перезагрузку: иначе переключатель бесполезен.
await page.click('.themeswitch__option[title="Тёмная тема"]');
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(300);
const afterReload = await themeState();
if (afterReload.attribute !== "dark") note("тема", "выбор не пережил перезагрузку страницы");

// Переключатель на узком экране: он стоит в шапке рядом с выходом.
await page.setViewportSize({ width: 360, height: 800 });
await page.waitForTimeout(300);
await overflow("шапка с переключателем темы, 360");
const tap = await page.locator(".themeswitch__option").first().boundingBox();
if (tap === null || tap.width < 44 || tap.height < 44) {
  note("область нажатия", `переключатель темы ${tap?.width ?? 0}×${tap?.height ?? 0} при норме 44×44`);
}
await step("переключатель темы, 360 px", "15-tema-360.png");

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
