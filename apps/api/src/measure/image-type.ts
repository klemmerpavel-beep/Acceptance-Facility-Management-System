/**
 * Тип изображения по первым байтам файла.
 *
 * Заголовок `content-type` от клиента и расширение имени файла — это то,
 * что назвал отправитель, а не то, чем файл является. Сервер отдаёт этот
 * файл обратно браузеру с того же источника, что и приложение; поверить
 * отправителю на слово значит позволить ему выбрать, как браузер будет
 * трактовать содержимое.
 *
 * Отсюда же перечень допустимого. SVG отвергается не по вкусу: это
 * документ со скриптами, и браузер исполнит их в контексте приложения.
 * PDF отвергается по другой причине — план показывается тегом `img`, а
 * PDF в нём не отображается, и принять его значило бы принять файл,
 * который потом нечем показать.
 */

/** Три сигнатуры, три допустимых типа. Больше в продукте не нужно. */
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export const IMAGE_EXTENSION: Readonly<Record<ImageType, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const starts = (buffer: Buffer, bytes: readonly number[]): boolean =>
  buffer.length >= bytes.length && bytes.every((byte, index) => buffer[index] === byte);

/** Распознанный тип либо `null`, если сигнатура не совпала ни с одной. */
export function detectImageType(buffer: Buffer): ImageType | null {
  if (starts(buffer, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // WebP: «RIFF» ‹четыре байта длины› «WEBP».
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}
