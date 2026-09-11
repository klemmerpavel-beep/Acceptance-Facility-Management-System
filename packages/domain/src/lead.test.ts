import { describe, expect, it } from "vitest";
import { basisPoints, kopecks, milliunits } from "./money.js";
import { estimateAgainstGuideline, guidelineRange, taskState } from "./lead.js";

describe("вилка ориентира", () => {
  /* Тариф 25 000 ₽ за м², площадь 62,5 м², отклонение ±15 %.
     Центр: 2 500 000 коп. × 62 500 тыс. / 1000 = 156 250 000 коп.
     Отклонение: 15 % = 23 437 500 коп. */
  const тариф = kopecks(2_500_000n);
  const площадь = milliunits(62_500n);

  it("считает вилку от центра", () => {
    const вилка = guidelineRange(площадь, тариф, basisPoints(1500));
    expect(вилка?.low).toBe(132_812_500n);
    expect(вилка?.high).toBe(179_687_500n);
  });

  it("нулевое отклонение даёт точку", () => {
    const вилка = guidelineRange(площадь, тариф, basisPoints(0));
    expect(вилка?.low).toBe(вилка?.high);
    expect(вилка?.low).toBe(156_250_000n);
  });

  /* Считать не из чего — не ноль, а пусто: ноль означал бы «ремонт
     бесплатный», а это иное утверждение. */
  it("нулевая площадь не даёт вилки", () => {
    expect(guidelineRange(milliunits(0), тариф, basisPoints(1500))).toBeNull();
  });

  it("нулевой тариф не даёт вилки", () => {
    expect(guidelineRange(площадь, kopecks(0), basisPoints(1500))).toBeNull();
  });

  /* Половина копейки уходит вверх — тем же правилом, что вся арифметика
     денег продукта. Площадь 1,001 м² × 1,00 ₽ = 100,1 коп. → 100. */
  it("округляет половину вверх", () => {
    const вилка = guidelineRange(milliunits(1_005n), kopecks(100n), basisPoints(0));
    expect(вилка?.low).toBe(101n);
  });
});

describe("сверка сметы с ориентиром", () => {
  const вилка = { low: kopecks(132_812_500n), high: kopecks(179_687_500n) };

  it("итог внутри вилки расхождения не даёт", () => {
    expect(estimateAgainstGuideline(kopecks(150_000_000n), вилка))
      .toEqual({ verdict: "внутри", delta: 0n });
  });

  it("итог выше меряется до верхней границы", () => {
    expect(estimateAgainstGuideline(kopecks(200_000_000n), вилка))
      .toEqual({ verdict: "выше", delta: 20_312_500n });
  });

  it("итог ниже меряется до нижней границы", () => {
    expect(estimateAgainstGuideline(kopecks(100_000_000n), вилка))
      .toEqual({ verdict: "ниже", delta: 32_812_500n });
  });

  /* Край вилки — попадание, а не промах: вилка объявлена целиком. */
  it("итог ровно на границе считается попаданием", () => {
    expect(estimateAgainstGuideline(вилка.high, вилка).verdict).toBe("внутри");
    expect(estimateAgainstGuideline(вилка.low, вилка).verdict).toBe("внутри");
  });
});

describe("состояние задачи", () => {
  it("выполненная не просрочена, даже если срок прошёл", () => {
    expect(taskState("2026-09-01", "2026-09-05", "2026-09-11")).toBe("выполнена");
  });

  /* День срока — ещё рабочий день, а не просрочка. */
  it("в день срока задача ждёт", () => {
    expect(taskState("2026-09-11", null, "2026-09-11")).toBe("ждёт");
  });

  it("на следующий день после срока задача просрочена", () => {
    expect(taskState("2026-09-10", null, "2026-09-11")).toBe("просрочена");
  });
});
