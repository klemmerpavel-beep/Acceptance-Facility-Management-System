import { describe, expect, it } from "vitest";
import { типСкана } from "./scan-type";

/** Тип скана подписанного акта (план, пункт 4.10): PDF или снимок — по содержимому. */
describe("тип скана акта", () => {
  it("PDF узнаётся по подписи «%PDF-», расширение — pdf", () => {
    expect(типСкана(Buffer.from("%PDF-1.7\n%âãÏÓ", "latin1"))).toEqual({ type: "application/pdf", extension: "pdf" });
  });

  it("снимок принимается тем же правилом, что снимки приёмки", () => {
    expect(типСкана(Buffer.from([0xff, 0xd8, 0xff, 0xe1]))).toEqual({ type: "image/jpeg", extension: "jpg" });
  });

  it("текст под любым именем, HTML и обрезанная подпись PDF — отказ", () => {
    expect(типСкана(Buffer.from("это не скан"))).toBeNull();
    expect(типСкана(Buffer.from("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(типСкана(Buffer.from("%PDF"))).toBeNull();
    expect(типСкана(Buffer.from(" %PDF-1.4"))).toBeNull();
  });
});
