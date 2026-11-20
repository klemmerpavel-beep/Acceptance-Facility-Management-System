import { describe, expect, it } from "vitest";
import { SECTIONS, разделДоступен, разделыРоли } from "./sections.js";

/**
 * Разделы шапки по роли (K9 фазы 0, П-65; ответ 20 «б» раунда 1). Прорабу
 * «Заявки» и «Бухгалтерия» не показываются тем же отбором, что заказчику
 * объекта: оба раздела ему закрыты стражем ролей, и пункт, отвечающий
 * отказом, был бы обещанием доступа, которого нет. Руководитель и бухгалтер
 * видят все пять.
 */
const подписи = (role: Parameters<typeof разделыРоли>[0]): string =>
  разделыРоли(role).map((item) => item.label).join("|");

describe("разделы шапки по роли", () => {
  it("руководитель и бухгалтер — все пять разделов", () => {
    expect(подписи("OWNER")).toBe("Главная|Заявки|Проекты|Контакты|Бухгалтерия");
    expect(подписи("ACCOUNTANT")).toBe(SECTIONS.map((item) => item.label).join("|"));
  });

  it("прораб — без «Заявок» и «Бухгалтерии»", () => {
    expect(подписи("FOREMAN")).toBe("Главная|Проекты|Контакты");
  });

  it("заказчик — только «Проекты»", () => {
    expect(подписи("CLIENT")).toBe("Проекты");
  });

  it("адрес закрытого раздела роли экрана не открывает", () => {
    expect(разделДоступен("FOREMAN", "requests")).toBe(false);
    expect(разделДоступен("FOREMAN", "accounting")).toBe(false);
    expect(разделДоступен("FOREMAN", "home")).toBe(true);
    expect(разделДоступен("FOREMAN", "settings")).toBe(true);
    expect(разделДоступен("ACCOUNTANT", "settings")).toBe(false);
    expect(разделДоступен("ACCOUNTANT", "accounting")).toBe(true);
    expect(разделДоступен("CLIENT", "home")).toBe(false);
  });

  it("каждый раздел шапки роли открывается её адресом", () => {
    for (const role of ["OWNER", "FOREMAN", "ACCOUNTANT", "CLIENT"] as const) {
      for (const item of разделыРоли(role)) expect(разделДоступен(role, item.key), `${role} ${item.key}`).toBe(true);
    }
  });
});
