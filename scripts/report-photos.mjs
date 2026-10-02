/**
 * Снимки приёмки для наполнения стенда и демонстрации (план, пункт 7.7).
 *
 * Коллаж дня проверяется только на нескольких разных снимках одного дня, а
 * стенд до сих пор держал один пакет с одним снимком. Сторонние фотографии
 * не берутся: снимки рисуются здесь — схематичная комната с окном, дверью,
 * плиткой или розетками, — и переводятся в растр `sharp`, который уже стоит
 * в зависимостях сервера (решение заказчика от 01.10.2026, П-39). Новых
 * зависимостей нет: модуль берётся из пакета сервера, как в `verify-api`.
 *
 * Текста на снимках нет намеренно: гарнитуры в контейнерах сборки разные, и
 * подпись, нарисованная в одном, в другом легла бы иначе — снимок перестал
 * бы быть воспроизводимым. Различаются снимки сюжетом и тоном.
 *
 * Запуск с ключом `--demo` пишет снимки в каталог демонстрации
 * (`apps/web/src/demo/report/`): там их берёт двойник API.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const sharp = createRequire(new URL("../apps/api/package.json", import.meta.url))("sharp");

/* Цвета — токены слоя стилей (`tokens.css`), а не литералы: снимок
   рисуется в оттенках продукта, и правило «цвет только токеном» держится и
   здесь. Берётся первое объявление токена — светлая тема. */
const ТОКЕНЫ = readFileSync(new URL("../packages/ui/src/styles/tokens.css", import.meta.url), "utf8");
const т = (имя) => {
  const найдено = new RegExp(`--${имя}:\\s*([^;\\s]+)`, "u").exec(ТОКЕНЫ);
  if (найдено === null) throw new Error(`В tokens.css нет токена --${имя}`);
  return найдено[1];
};

/** Тона стены и пола: светлые нейтральные, как у отделки под покраску. */
const ТОНА = [
  [т("bg"), т("line-strong")],
  [т("surface-2"), т("status-new-bar")],
  [т("status-wait-soft"), т("status-wait-bar")],
  [т("status-done-soft"), т("status-done-bar")],
  [т("status-pause-soft"), т("claim")],
  [т("neutral-soft"), т("ink-3")],
];

/** Сюжеты: что видно в кадре. */
const СЮЖЕТЫ = [
  // окно на стене и подоконник
  (стена) => `<rect x="300" y="120" width="360" height="300" fill="${т("surface")}" stroke="${стена}" stroke-width="14"/>
    <line x1="480" y1="120" x2="480" y2="420" stroke="${стена}" stroke-width="10"/>
    <rect x="280" y="420" width="400" height="22" fill="${т("surface")}"/>`,
  // дверной проём с наличником
  (стена) => `<rect x="380" y="140" width="200" height="420" fill="${т("ink-2")}" stroke="${стена}" stroke-width="18"/>
    <circle cx="545" cy="360" r="9" fill="${т("line")}"/>`,
  // плитка на стене санузла
  () => Array.from({ length: 6 }, (_, ряд) => Array.from({ length: 8 }, (__, кол) =>
    `<rect x="${String(140 + кол * 85)}" y="${String(110 + ряд * 70)}" width="80" height="65" fill="${т("bg")}" stroke="${т("line-strong")}" stroke-width="3"/>`).join("")).join(""),
  // розетки и выключатель после черновой электрики
  () => `<rect x="250" y="380" width="70" height="70" rx="8" fill="${т("surface")}" stroke="${т("line-strong")}" stroke-width="4"/>
    <rect x="340" y="380" width="70" height="70" rx="8" fill="${т("surface")}" stroke="${т("line-strong")}" stroke-width="4"/>
    <rect x="620" y="250" width="70" height="90" rx="8" fill="${т("surface")}" stroke="${т("line-strong")}" stroke-width="4"/>
    <path d="M285 380 V240 H655 V250" fill="none" stroke="${т("status-wait-bar")}" stroke-width="6" stroke-dasharray="14 10"/>`,
  // стяжка пола с маяками
  (стена) => `<path d="M0 540 L960 540 L960 720 L0 720 Z" fill="${стена}"/>
    ${Array.from({ length: 5 }, (_, и) => `<line x1="${String(80 + и * 200)}" y1="540" x2="${String(30 + и * 230)}" y2="720" stroke="${т("ink-3")}" stroke-width="6"/>`).join("")}`,
  // штукатурка: полосы маяков на стене
  () => Array.from({ length: 6 }, (_, и) => `<rect x="${String(110 + и * 140)}" y="80" width="10" height="460" fill="${т("ink-3")}"/>`).join(""),
];

/** Снимок номер `номер` (с нуля): PNG 960 × 720. */
export async function снимокОтчёта(номер) {
  const [стена, пол] = ТОНА[номер % ТОНА.length];
  const сюжет = СЮЖЕТЫ[номер % СЮЖЕТЫ.length](пол);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720">
    <rect width="960" height="720" fill="${стена}"/>
    <path d="M0 560 L960 560 L960 720 L0 720 Z" fill="${пол}" opacity="0.55"/>
    <line x1="0" y1="560" x2="960" y2="560" stroke="${пол}" stroke-width="6"/>
    ${сюжет}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Сколько снимков пишет `--demo`. */
export const СНИМКОВ_ДЕМОНСТРАЦИИ = 6;

if (process.argv.includes("--demo")) {
  const каталог = new URL("../apps/web/src/demo/report/", import.meta.url);
  mkdirSync(каталог, { recursive: true });
  for (let номер = 0; номер < СНИМКОВ_ДЕМОНСТРАЦИИ; номер += 1) {
    const png = await снимокОтчёта(номер);
    const webp = await sharp(png).resize(640, 480).webp({ quality: 72 }).toBuffer();
    writeFileSync(new URL(`snimok-${String(номер + 1)}.webp`, каталог), webp);
  }
  console.log(`Снимки демонстрации записаны: ${String(СНИМКОВ_ДЕМОНСТРАЦИИ)} файлов в apps/web/src/demo/report/`);
}
