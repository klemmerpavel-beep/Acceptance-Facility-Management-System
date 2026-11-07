import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { местныйДень } from "./today.js";

/**
 * «Сегодня» форм чека и платежа — местный день, а не UTC (фаза 0, дефект
 * K10). Служба уже считала день организации, а форма чека — по UTC: в
 * Воронеже с полуночи до трёх ночи она подставляла вчерашнюю дату и
 * отклоняла сегодняшний чек как чек из будущего, не дойдя до сервера.
 *
 * Граница та же, что у теста служб (`apps/api/src/common/org-day.test.ts`):
 * 00:30 седьмого ноября по Москве — по UTC ещё шестое. Рендер-тестов в
 * клиенте нет, поэтому второй рубеж — сами формы: правило дня у них одно,
 * и вписанный рядом день по UTC вернул бы дефект молча.
 */
const ГРАНИЦА = new Date("2026-11-06T21:30:00Z");

describe("местный день форм (K10)", () => {
  it("в 00:30 по Москве день — седьмое, хотя по UTC ещё шестое", () => {
    expect(ГРАНИЦА.toISOString().slice(0, 10)).toBe("2026-11-06");
    expect(местныйДень(ГРАНИЦА, "Europe/Moscow")).toBe("2026-11-07");
  });

  it("без пояса — день по часам браузера", () => {
    const сейчас = new Date();
    const двумя = (число: number): string => String(число).padStart(2, "0");
    expect(местныйДень(сейчас))
      .toBe(`${String(сейчас.getFullYear())}-${двумя(сейчас.getMonth() + 1)}-${двумя(сейчас.getDate())}`);
  });

  it.each(["ExpenseSheet.tsx", "PaymentSheet.tsx"])("%s берёт день помощником, а не срезом UTC", (имя) => {
    const текст = readFileSync(new URL(`./${имя}`, import.meta.url), "utf8");
    expect(текст).toContain('import { местныйДень } from "./today.js";');
    expect(текст).not.toMatch(/\.slice\(0, 10\)/u);
  });
});
