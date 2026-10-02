import { IMAGE_EXTENSION, detectImageType, type ImageType } from "../measure/image-type";

export type ТипСкана =
  | { type: "application/pdf"; extension: "pdf" }
  | { type: ImageType; extension: string };

/**
 * Тип скана подписанного акта по содержимому: снимок (JPEG, PNG, WebP) или
 * PDF (план, пункт 4.10). Расширение и заявленный браузером тип не
 * проверяются — их подделать проще, чем подпись файла.
 */
export function типСкана(body: Buffer): ТипСкана | null {
  if (body.length >= 5 && body.toString("latin1", 0, 5) === "%PDF-") {
    return { type: "application/pdf", extension: "pdf" };
  }
  const снимок = detectImageType(body);
  return снимок === null ? null : { type: снимок, extension: IMAGE_EXTENSION[снимок] };
}
