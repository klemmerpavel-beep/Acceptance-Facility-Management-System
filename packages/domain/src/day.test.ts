import { describe, expect, it } from "vitest";
import { dayInZone } from "./day.js";

describe("день организации (этап Э8)", () => {
  it("полночь по Москве — уже новые сутки, хотя по UTC ещё вчера", () => {
    const мгновение = new Date("2026-10-04T21:30:00Z");
    expect(dayInZone(мгновение, "UTC")).toBe("2026-10-04");
    expect(dayInZone(мгновение, "Europe/Moscow")).toBe("2026-10-05");
  });

  it("день записывается ГГГГ-ММ-ДД с ведущими нулями", () => {
    expect(dayInZone(new Date("2026-01-02T12:00:00Z"), "Europe/Moscow")).toBe("2026-01-02");
  });

  it("неизвестный пояс — ошибка, а не тихий UTC", () => {
    expect(() => dayInZone(new Date(), "Луна/Море_Спокойствия")).toThrow();
  });
});
