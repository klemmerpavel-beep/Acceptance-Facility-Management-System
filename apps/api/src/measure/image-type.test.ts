import { describe, expect, it } from "vitest";
import { IMAGE_EXTENSION, detectImageType } from "./image-type";

/**
 * Тип снимка по первым байтам. Свойство, ради которого модуль заведён:
 * решает содержимое, а не имя файла и не заявленный тип, — SVG со
 * скриптом под именем `.png` снимком не признаётся.
 */
const байты = (...числа: number[]): Buffer => Buffer.from(числа);

describe("тип снимка по содержимому", () => {
  it("узнаёт три допустимые сигнатуры", () => {
    expect(detectImageType(байты(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(detectImageType(байты(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(detectImageType(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"))).toBe("image/webp");
  });

  it("SVG, PDF и текст снимком не признаются", () => {
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'))).toBeNull();
    expect(detectImageType(Buffer.from("%PDF-1.4"))).toBeNull();
    expect(detectImageType(Buffer.from("обычный текст"))).toBeNull();
  });

  it("обрезанная сигнатура и пустой файл — не снимок", () => {
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
    expect(detectImageType(байты(0xff, 0xd8))).toBeNull();
    expect(detectImageType(байты(0x89, 0x50, 0x4e, 0x47))).toBeNull();
    expect(detectImageType(Buffer.from("RIFF\0\0\0\0WEB", "latin1"))).toBeNull();
  });

  it("RIFF без метки WEBP — не снимок: так начинается и звук WAV", () => {
    expect(detectImageType(Buffer.from("RIFF\0\0\0\0WAVEfmt ", "latin1"))).toBeNull();
  });

  it("у каждого допустимого типа есть расширение ключа хранилища", () => {
    expect(Object.keys(IMAGE_EXTENSION).sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });
});
