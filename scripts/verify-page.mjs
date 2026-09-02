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
await page.waitForSelector("table.estimate");
await step("объекты", "03-obekty.png");
await overflow("объекты, 1440");

const rows = await page.locator("table.estimate tbody tr").count();
console.log(`  объектов в списке: ${rows}`);

// Видимое состояние фокуса.
await page.keyboard.press("Tab");
const focusVisible = await page.evaluate(() => {
  const el = document.activeElement;
  if (el === null || el === document.body) return false;
  const style = getComputedStyle(el);
  return style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
});
if (!focusVisible) note("фокус", "первый элемент в порядке обхода не показывает видимую обводку");

// Карточка объекта. Открывается объект со сметой: у остальных карточка
// показывает пустое состояние, и это правильное поведение, а не сбой.
await page.click('table.estimate tbody tr:has(.code-badge:text-is("R-99")) a');
await page.waitForSelector(".cover__title .code-badge");
await page.waitForSelector("table.estimate tbody tr");
await step("карточка объекта", "04-kartochka.png");
await overflow("карточка, 1440");

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
await step("клиентская проекция", "05-klientskaya.png");
await page.click('.segmented__option:has-text("Внутренняя")');

// Импорт сметы.
await page.click('.tabs__item:has-text("Импорт")');
await page.setInputFiles('input[type="file"]', FIXTURE);
await page.waitForSelector("text=Отчёт о расхождениях");
await step("отчёт о расхождениях", "06-otchet.png");
await overflow("отчёт, 1440");

const decisions = await page.locator("select").count();
console.log(`  написаний единиц ждут решения: ${decisions}`);

await page.click('button:has-text("Импортировать")');
await page.waitForSelector("text=Импортировано", { timeout: 30_000 });
await step("импорт выполнен", "07-import.png");

// Мобильная ширина на том же состоянии.
await page.setViewportSize({ width: 360, height: 800 });
await page.waitForTimeout(400);
await overflow("после импорта, 360");
await step("мобильный, 360 px", "08-mobile-360.png");

await page.setViewportSize({ width: 768, height: 1000 });
await page.waitForTimeout(300);
await overflow("после импорта, 768");
await step("планшет, 768 px", "09-tablet-768.png");

// Тёмная тема.
await page.setViewportSize({ width: 1440, height: 900 });
await page.emulateMedia({ colorScheme: "dark" });
await page.waitForTimeout(300);
await step("тёмная тема", "10-dark.png");

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
