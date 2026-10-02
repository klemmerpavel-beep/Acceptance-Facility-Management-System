import { BadRequestException } from "@nestjs/common";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { безМетаданных } from "./clean-image";

/**
 * Снимок без метаданных (полный аудит 30.09.2026, П-39). Свойства: после
 * очистки в файле нет сегмента EXIF — ни координат, ни модели устройства;
 * вертикальный кадр с телефона остаётся вертикальным; нечитаемый файл
 * отвергается словами, а не падением сервера.
 */
const кадр = () => sharp({ create: { width: 40, height: 20, channels: 3, background: { r: 200, g: 120, b: 60 } } });

const сМетаданными = (формат: "jpeg" | "png" | "webp"): Promise<Buffer> =>
  кадр()[формат]()
    .withExif({
      IFD0: { Make: "Телефон прораба", Model: "Модель" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "55/1 45/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "37/1 37/1 0/1" },
    })
    .toBuffer();

describe("снимок без метаданных", () => {
  for (const [формат, тип] of [["jpeg", "image/jpeg"], ["png", "image/png"], ["webp", "image/webp"]] as const) {
    it(`${формат}: сегмент EXIF снят, тип файла сохранён`, async () => {
      const исходный = await сМетаданными(формат);
      expect((await sharp(исходный).metadata()).exif).toBeDefined();

      const чистый = await безМетаданных(исходный, тип);
      const сведения = await sharp(чистый).metadata();
      expect(сведения.exif).toBeUndefined();
      expect(сведения.format).toBe(формат);
      expect(чистый.toString("latin1")).not.toContain("Model");
    });
  }

  it("ориентация кадра применяется, а не теряется вместе с метаданными", async () => {
    /* Ориентация 6 — «повернуть на 90° по часовой»: так пишет телефон,
       снятый вертикально. Кадр 40×20 обязан выйти 20×40. */
    const повёрнутый = await кадр().jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const чистый = await безМетаданных(повёрнутый, "image/jpeg");
    const сведения = await sharp(чистый).metadata();
    expect([сведения.width, сведения.height]).toEqual([20, 40]);
    expect(сведения.orientation).toBeUndefined();
  });

  it("подпись JPEG без изображения — отказ словами, а не сбой", async () => {
    const подделка = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("не изображение")]);
    await expect(безМетаданных(подделка, "image/jpeg")).rejects.toBeInstanceOf(BadRequestException);
  });
});
