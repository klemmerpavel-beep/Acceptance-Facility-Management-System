/**
 * Сквозная проверка веб-клиента на поднятом стенде.
 *
 * Проходит сценарий целиком — вход по ссылке, список объектов, импорт сметы
 * с сопоставлением единиц — и попутно собирает то, что нельзя увидеть на
 * снимке: ошибки консоли, неудавшиеся запросы, горизонтальное переполнение
 * на трёх ширинах, отсутствие видимого фокуса, подписи у полей.
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:5173";
const SHOTS = process.env.SHOTS ?? "/tmp/shots";
const FIXTURE = "/home/user/acceptance-facility-management-system/packages/importer/fixtures/smeta-obezlichennaya.xlsx";
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
  || text.includes("401 (Unauthorized)") || text.includes("ERR_CONNECTION_RESET");

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
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

await page.fill('input[type="email"]', "owner@dolgiy.studio");
await page.click('button[type="submit"]');
await page.waitForSelector('a.btn:has-text("Открыть ссылку входа")');
await step("ссылка выдана", "02-ssylka.png");

// Переход по ссылке входа: сервер ставит куку и возвращает JSON.
const href = await page.getAttribute('a.btn:has-text("Открыть ссылку входа")', "href");
await page.goto(`${BASE}${href}`);
await page.goto(BASE, { waitUntil: "networkidle" });

// Первый экран — сводка по портфелю.
await page.waitForSelector(".weekstrip");
await step("сводка", "03-svodka.png");
await overflow("сводка, 1440");

const cards = await page.locator(".cards .panel").count();
const week = await page.locator(".daycard").count();
const feed = await page.locator(".feed__item").count();
console.log(`  карточек сводки: ${cards}, дней в неделе: ${week}, событий в ленте: ${feed}`);
if (week !== 7) note("неделя", `в полосе ${week} дней вместо семи`);
if (cards < 3) note("сводка", `карточек ${cards}: ряд денежных величин не собран`);
if ((await page.locator(".daycard--today").count()) !== 1) {
  note("неделя", "сегодняшний день не отмечен ровно один раз");
}

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
await page.waitForSelector("table.estimate tbody tr");
await step("объекты", "04-obekty.png");
await overflow("объекты, 1440");

const rows = await page.locator("table.estimate tbody tr").count();
console.log(`  объектов в списке: ${rows}`);

// Фильтр по статусу: выбор сужает таблицу и снимается обратно.
const inProgress = await page.locator('.segmented__option:has-text("В работе")').textContent();
await page.click('.segmented__option:has-text("В работе")');
await page.waitForTimeout(200);
const filtered = await page.locator("table.estimate tbody tr").count();
if (filtered >= rows) note("фильтр по статусу", `после выбора «${inProgress}» строк не убавилось`);
await page.click('.segmented__option:has-text("Все")');
await page.waitForTimeout(200);
if ((await page.locator("table.estimate tbody tr").count()) !== rows) {
  note("фильтр по статусу", "снятие фильтра не вернуло полный список");
}

// Карточка объекта. Открывается объект со сметой: у остальных карточка
// показывает пустое состояние, и это правильное поведение, а не сбой.
await page.click('table.estimate tbody tr:has(.code-badge:text-is("R-99")) a');
await page.waitForSelector(".cover__title .code-badge");
await page.waitForSelector(".metric__value");
await step("карточка объекта, обзор", "05-kartochka.png");
await overflow("карточка, 1440");

const metrics = await page.locator(".metric").count();
if (metrics === 0) note("обзор", "метрики графика производства работ не показаны");

// Смена статуса: лист открывается, значение меняется, пилюля обновляется.
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

const decisions = await page.locator("select").count();
console.log(`  написаний единиц ждут решения: ${decisions}`);

await page.click('button:has-text("Импортировать")');
await page.waitForSelector("text=Импортировано", { timeout: 30_000 });
await step("импорт выполнен", "09-import.png");

// Контрагенты: заказчики и бригады.
await page.click('.appbar__link:has-text("Контрагенты")');
await page.waitForSelector('h2:has-text("Заказчики")');
const clients = await page.locator("table.estimate tbody tr").count();
const brigades = await page.locator(".tile").count();
console.log(`  заказчиков: ${clients}, бригад: ${brigades}`);
if (clients === 0) note("контрагенты", "список заказчиков пуст");
await step("контрагенты", "09b-kontragenty.png");
await overflow("контрагенты, 1440");

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
  const blocks = [...document.querySelectorAll("main .tile, main .panel, main .counter")];
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
const mobileTable = await page.locator("main table.estimate").count();
const mobileCards = await page.locator("main .panel--pad .code-badge").count();
if (mobileTable > 0) note("список объектов, 360", "показана таблица вместо карточек");
if (mobileCards === 0) note("список объектов, 360", "карточки объектов не отрисованы");
console.log(`  карточек объектов на 360 px: ${mobileCards}`);
await overflow("объекты, 360");
await step("объекты на телефоне", "10b-obekty-360.png");
await step("мобильный, 360 px", "10-mobile-360.png");

await page.setViewportSize({ width: 768, height: 1000 });
await page.waitForTimeout(300);
await overflow("после импорта, 768");
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
