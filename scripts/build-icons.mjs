/**
 * Значки и манифест приложения (этап Э8, ДР-12).
 *
 * Приложение ставится на главный экран телефона: имя «Приёмка», значок,
 * отдельное окно без строки браузера (`display: standalone`) и цвет темы.
 * Цвета берутся из токенов продукта (`tokens.css`): полоса шапки `--band` —
 * цвет темы и фон значка, полотно `--bg` — фон заставки. Второй палитры,
 * набранной здесь от руки, нет: она разошлась бы с продуктом на первой
 * правке токенов, и тест `manifest.test.ts` это ловит.
 *
 * Сервис-воркера нет намеренно: работа без сети — отдельное решение со
 * своей ценой (устаревшие данные на экране), и манифест его не требует.
 *
 * Знак — тот же, что в шапке (`#i-mark`), белым по полосе. Растровые
 * значки рисует `sharp` — зависимость сервера, новой не заводится.
 * Запуск: `node scripts/build-icons.mjs` после правки токенов или знака.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const root = new URL("../", import.meta.url);
const sharp = createRequire(new URL("apps/api/package.json", root))("sharp");
const tokens = readFileSync(new URL("packages/ui/src/styles/tokens.css", root), "utf8");
const токен = (имя) => {
  const найден = new RegExp(`--${имя}:\\s*(#[0-9A-Fa-f]{6})`, "u").exec(tokens);
  if (найден === null) throw new Error(`В tokens.css нет токена --${имя}`);
  return найден[1].toUpperCase();
};
const полоса = токен("band");
const полотно = токен("bg");
const знак = токен("band-ink");

/* Знак занимает средние 50 % значка: так он целиком в безопасной зоне
   маскируемого значка (круг 80 %), и один рисунок годится обоим видам. */
const значок = (размер) => `<svg xmlns="http://www.w3.org/2000/svg" width="${размер}" height="${размер}" viewBox="0 0 20 20">
<rect width="20" height="20" fill="${полоса}"/>
<g transform="translate(5 5) scale(0.5)" fill="none" stroke="${знак}" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter">
<path d="M4 3h7l5 5v4l-5 5H4z"/><path d="M8 7h4"/>
</g>
</svg>
`;

const public_ = new URL("apps/web/public/", root);
writeFileSync(new URL("icon.svg", public_), значок(512));
for (const размер of [192, 512]) {
  await sharp(Buffer.from(значок(размер))).png().toFile(new URL(`icon-${размер}.png`, public_).pathname);
}

const манифест = {
  name: "Приёмка",
  short_name: "Приёмка",
  description: "Объекты ремонта: смета, приёмка, транши и документы",
  lang: "ru",
  start_url: "./",
  scope: "./",
  display: "standalone",
  theme_color: полоса,
  background_color: полотно,
  icons: [
    { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};
writeFileSync(new URL("manifest.webmanifest", public_), `${JSON.stringify(манифест, null, 2)}\n`);
console.log(`Значки и манифест собраны: цвет темы ${полоса}, фон ${полотно}`);
