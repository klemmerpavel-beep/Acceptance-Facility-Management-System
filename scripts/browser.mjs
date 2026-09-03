import { existsSync } from "node:fs";

/**
 * Где брать Chromium для браузерных проверок.
 *
 * Путь был вписан в два скрипта константой и годился ровно для одной среды.
 * В сборке GitHub Actions такого пути нет, а без проверок страницы и канвы
 * сборка не имеет смысла — поэтому выбор вынесен сюда и делается по порядку:
 *
 *   1. переменная `CHROMIUM`, если задана явно;
 *   2. путь песочницы разработки, если он существует;
 *   3. ничего — тогда `playwright-core` ищет браузер в своём реестре
 *      (`PLAYWRIGHT_BROWSERS_PATH`), как это устроено в официальном образе
 *      Playwright, которым идёт работа CI.
 *
 * Третий случай — не запасной, а основной для сервера: версия образа
 * совпадает с версией `playwright-core`, и браузер находится сам.
 */
const SANDBOX = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

export function launchOptions() {
  const explicit = process.env["CHROMIUM"];
  const path = explicit !== undefined && explicit !== ""
    ? explicit
    : existsSync(SANDBOX) ? SANDBOX : null;

  return {
    // `--no-sandbox` нужен и в песочнице разработки, и в контейнере CI:
    // в обоих случаях процесс идёт от root, а Chromium это запрещает.
    args: ["--no-sandbox"],
    ...(path === null ? {} : { executablePath: path }),
  };
}

/** Откуда взят браузер — печатается в отчёте, чтобы прогон был воспроизводим. */
export function browserSource() {
  const { executablePath } = launchOptions();
  return executablePath ?? "реестр playwright-core";
}
