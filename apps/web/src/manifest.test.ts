import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Приложение на главном экране телефона (этап Э8, ДР-12).
 *
 * Манифест и значки собирает `scripts/build-icons.mjs` из токенов продукта.
 * Тест держит обе половины правила: цвета манифеста и `theme-color` в
 * страницах равны токенам (правка токенов без пересборки краснеет здесь),
 * а сервис-воркера нет нигде — ни файла, ни регистрации.
 */
const WEB = new URL("../", import.meta.url);
const ТОКЕНЫ = readFileSync(new URL("../../../packages/ui/src/styles/tokens.css", import.meta.url), "utf8");
const токен = (имя: string): string =>
  (new RegExp(`--${имя}:\\s*(#[0-9A-Fa-f]{6})`, "u").exec(ТОКЕНЫ)?.[1] ?? "").toUpperCase();

interface Манифест {
  name: string;
  short_name: string;
  display: string;
  start_url: string;
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
}
const манифест = JSON.parse(readFileSync(new URL("public/manifest.webmanifest", WEB), "utf8")) as Манифест;

describe("манифест приложения", () => {
  it("имя «Приёмка», отдельное окно, путь относительный", () => {
    expect(манифест.name).toBe("Приёмка");
    expect(манифест.short_name).toBe("Приёмка");
    expect(манифест.display).toBe("standalone");
    expect(манифест.start_url.startsWith("/")).toBe(false);
  });

  it("цвет темы — полоса шапки, фон заставки — полотно: из токенов", () => {
    expect(токен("band")).not.toBe("");
    expect(манифест.theme_color).toBe(токен("band"));
    expect(манифест.background_color).toBe(токен("bg"));
  });

  it("значки лежат рядом с манифестом: 192 и 512 px и маскируемый", () => {
    for (const значок of манифест.icons) expect(existsSync(new URL(`public/${значок.src}`, WEB)), значок.src).toBe(true);
    const размеры = манифест.icons.filter((значок) => значок.type === "image/png").map((значок) => значок.sizes);
    expect(размеры).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(манифест.icons.some((значок) => значок.purpose === "maskable")).toBe(true);
  });

  it.each(["index.html", "index.demo.html"])("%s ссылается на манифест и несёт цвет темы токена", (страница) => {
    const разметка = readFileSync(new URL(страница, WEB), "utf8");
    expect(разметка).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(разметка).toContain(`<meta name="theme-color" content="${токен("band")}" />`);
  });

  it("сервис-воркера нет: ни файла, ни регистрации", () => {
    const файлы = readdirSync(new URL("public/", WEB));
    expect(файлы.filter((имя) => /(?:^sw|service-?worker)\.js$/iu.test(имя))).toEqual([]);
    const исходники = readdirSync(new URL("src/", WEB))
      .filter((имя) => /\.tsx?$/u.test(имя) && !имя.includes(".test."))
      .map((имя) => readFileSync(new URL(`src/${имя}`, WEB), "utf8"));
    expect(исходники.some((текст) => /serviceWorker\s*\.\s*register/u.test(текст))).toBe(false);
  });
});
