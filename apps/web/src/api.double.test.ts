import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Двойник демонстрации держит ту же поверхность, что боевой слой.
 *
 * Сборка демонстрации подменяет `api.ts` двойником `api.demo.ts`
 * (`vite.demo.config.ts`): экраны просят `./api.js`, и запрос разрешается в
 * двойника. Имя, которого у двойника нет, до этой подмены никак себя не
 * проявляет — ни линт, ни проверка типов, ни тесты его не видят: боевой
 * слой полон, экраны компилируются, и сборка демонстрации падает уже в
 * Rollup сообщением «"fetchForemen" is not exported by "src/api.demo.ts"».
 *
 * Это не предположение. Ровно так 12.09.2026 в основную ветку ушла
 * поломанная сборка: три прогона публикации подряд завершились неудачей, а
 * опубликованная страница осталась на предыдущем срезе. Правило ниже
 * опрокидывает такую правку на `pnpm test`, то есть до слияния.
 *
 * Требование ставится по потребителям, а не по списку экспорта: двойнику
 * обязательно то, что просят экраны. `OfflineError` живёт внутри боевого
 * слоя и наружу не выходит — требовать его от двойника значило бы завести
 * правило шире надобности и получать замечание на пустом месте.
 */
const КОРЕНЬ = new URL("./", import.meta.url).pathname;

const исходники = readdirSync(КОРЕНЬ, { withFileTypes: true })
  .filter((узел) => узел.isFile())
  .map((узел) => узел.name)
  .filter((имя) => /\.tsx?$/u.test(имя))
  .filter((имя) => !имя.endsWith(".test.ts") && !имя.endsWith(".test.tsx"))
  .filter((имя) => имя !== "api.ts" && имя !== "api.demo.ts");

/** Имена, которые модуль просит у `./api.js`. `import { a as b }` — это «a». */
const просит = (текст: string): string[] => {
  const имена: string[] = [];
  const образец = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"\.\/api\.js"/gu;
  for (const совпадение of текст.matchAll(образец)) {
    for (const кусок of (совпадение[1] ?? "").split(",")) {
      const имя = кусок.trim().split(/\s+as\s+/u)[0]?.trim() ?? "";
      if (имя !== "" && имя !== "type") имена.push(имя.replace(/^type\s+/u, ""));
    }
  }
  return имена;
};

/** Имена, которые модуль отдаёт наружу. */
const отдаёт = (текст: string): Set<string> => {
  const имена = new Set<string>();
  const образец = /^export\s+(?:async\s+)?(?:const|function|let|class|type|interface)\s+([\p{L}_$][\p{L}\p{N}_$]*)/gmu;
  for (const совпадение of текст.matchAll(образец)) {
    if (совпадение[1] !== undefined) имена.add(совпадение[1]);
  }
  return имена;
};

const боевой = отдаёт(readFileSync(`${КОРЕНЬ}api.ts`, "utf8"));
const двойник = отдаёт(readFileSync(`${КОРЕНЬ}api.demo.ts`, "utf8"));

const спрос = new Map<string, string[]>();
for (const имя of исходники) {
  for (const просимое of просит(readFileSync(`${КОРЕНЬ}${имя}`, "utf8"))) {
    спрос.set(просимое, [...(спрос.get(просимое) ?? []), имя]);
  }
}

describe("двойник демонстрации", () => {
  it("экраны действительно просят у слоя данных", () => {
    expect(спрос.size).toBeGreaterThan(20);
  });

  it.each([...спрос.keys()].sort())("«%s» есть у боевого слоя", (имя) => {
    expect(боевой.has(имя), `${имя} просят ${(спрос.get(имя) ?? []).join(", ")}`).toBe(true);
  });

  it.each([...спрос.keys()].sort())("«%s» есть у двойника", (имя) => {
    expect(двойник.has(имя), `${имя} просят ${(спрос.get(имя) ?? []).join(", ")}`).toBe(true);
  });
});
