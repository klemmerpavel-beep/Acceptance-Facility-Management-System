import { describe, expect, it } from "vitest";
import {
  formatPhone, isMobileNumber, isPhoneNumber, maskPhone, parseContactPhone, parsePhone,
  type PhoneNumber,
} from "./phone.js";

const ok = (input: string): string => {
  const parsed = parsePhone(input);
  if (!parsed.ok) throw new Error(`Ожидался разбор, получен отказ: ${parsed.reason}`);
  return parsed.value;
};

const rejection = (input: string): string => {
  const parsed = parsePhone(input);
  if (parsed.ok) throw new Error(`Ожидался отказ, получен разбор: ${parsed.value}`);
  return parsed.reason;
};

describe("разбор номера телефона", () => {
  it("один и тот же номер в разной записи даёт один результат", () => {
    const формы = [
      "+7 900 000-00-00",
      "8 900 0000000",
      "+7(900)000-00-00",
      "+79000000000",
      "9000000000",
      "8 (900) 000 00 00",
      "  +7 900 000 00 00  ",
    ];
    const результаты = new Set(формы.map(ok));
    expect(результаты).toEqual(new Set(["+79000000000"]));
  });

  it("неразрывный пробел и длинное тире в разделителях не мешают", () => {
    expect(ok("+7\u00a0900\u2013000\u201100\u201300")).toBe("+79000000000");
  });

  it("короткий номер отклоняется", () => {
    expect(rejection("+7 900 000")).toBe("wrong-length");
    expect(rejection("900000000")).toBe("wrong-length");
  });

  it("буквы отклоняются, а не выбрасываются молча", () => {
    // Если посторонние знаки просто отбросить, «90O» превратится в короткий
    // номер, и человек получит сообщение о длине вместо сообщения об опечатке.
    expect(rejection("+7 90O 000-00-00")).toBe("stray-characters");
    expect(rejection("телефон")).toBe("stray-characters");
  });

  it("чужой код страны отклоняется, а не переписывается на +7", () => {
    expect(rejection("+1 202 555-01-99")).toBe("foreign-code");
    expect(rejection("+380 44 000-00-00")).toBe("foreign-code");
    expect(rejection("+49 30 000000000")).toBe("foreign-code");
  });

  it("плюс не первым знаком — опечатка", () => {
    expect(rejection("7+9000000000")).toBe("stray-characters");
  });

  it("восьмёрка после плюса не считается кодом страны", () => {
    expect(rejection("+8 900 000-00-00")).toBe("wrong-length");
  });

  it("немобильный код отклоняется: код подтверждения идёт сообщением", () => {
    expect(rejection("+7 473 000-00-00")).toBe("not-mobile");
    expect(rejection("8 495 000 00 00")).toBe("not-mobile");
  });

  it("пустой ввод отклоняется отдельной причиной", () => {
    expect(rejection("")).toBe("empty");
    expect(rejection("   ")).toBe("empty");
  });

  it("сообщение об отказе называет, что делать", () => {
    const parsed = parsePhone("+1 202 555-01-99");
    if (parsed.ok) throw new Error("ожидался отказ");
    expect(parsed.message).toContain("+7");
  });
});

describe("контактный номер организации", () => {
  it("городской код принимается: номер печатается на счёте, а не входит в систему", () => {
    const parsed = parseContactPhone("+7 (473) 000-00-00");
    expect(parsed.ok && parsed.value).toBe("+74730000000");
  });

  it("остальные правила те же, что и на входе", () => {
    for (const input of ["+1 202 555-01-99", "+7 900 000", "телефон", ""]) {
      expect(parseContactPhone(input).ok).toBe(false);
    }
  });

  it("вход по городскому номеру всё равно невозможен", () => {
    expect(parsePhone("+7 473 000-00-00").ok).toBe(false);
  });
});

describe("показ номера", () => {
  const номер = "+79000000000" as PhoneNumber;

  it("признаёт нормализованный номер и отвергает прочее", () => {
    expect(isPhoneNumber("+79000000000")).toBe(true);
    expect(isPhoneNumber("+74730000000")).toBe(true);
    expect(isPhoneNumber("89000000000")).toBe(false);
    expect(isPhoneNumber("+7900000000")).toBe(false);
  });

  it("мобильный номер отличается от городского", () => {
    expect(isMobileNumber("+79000000000")).toBe(true);
    expect(isMobileNumber("+74730000000")).toBe(false);
  });

  it("разбивает номер на группы и не рвёт его переносом", () => {
    expect(formatPhone(номер)).toBe("+7\u00a0(900)\u00a0000-00-00");
    expect(formatPhone(номер)).not.toContain("\u0020");
  });

  it("скрывает середину, оставляя код оператора и две последние цифры", () => {
    expect(maskPhone(номер)).toBe("+7\u00a0(900)\u00a0\u2022\u2022\u2022-\u2022\u2022-00");
  });

  it("разбор и показ обратимы", () => {
    expect(ok(formatPhone(номер))).toBe(номер);
  });
});
