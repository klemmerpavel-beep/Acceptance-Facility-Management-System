import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TokenSweepService } from "./token-sweep.service";

/**
 * Уборка просроченных токенов входа (ADR-0008, п. 7; П-63). Свойства, которых
 * стенд за один прогон не видит: граница — сутки после истечения, а не само
 * истечение (иначе уборка снимала бы суточный предел кодов); сбой базы не
 * роняет сервер.
 */
const СЕЙЧАС = new Date("2026-11-07T12:00:00Z");

function стенд() {
  const prisma = {
    authToken: {
      deleteMany: vi.fn((запрос: { where: { expiresAt: { lt: Date } } }) => Promise.resolve({ count: запрос.where.expiresAt.lt.getTime() > 0 ? 3 : 0 })),
    },
  };
  return { prisma, служба: new TokenSweepService(prisma as never) };
}

describe("уборка просроченных токенов входа", () => {
  beforeAll(() => { Logger.overrideLogger(false); });

  it("удаляет токены, истёкшие больше суток назад", async () => {
    const { prisma, служба } = стенд();
    expect(await служба.обойти(СЕЙЧАС)).toBe(3);
    expect(prisma.authToken.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: new Date("2026-11-06T12:00:00Z") } },
    });
  });

  it("сбой базы пишется в журнал запуска, а не роняет сервер", async () => {
    const { prisma, служба } = стенд();
    prisma.authToken.deleteMany.mockImplementationOnce(() => Promise.reject(new Error("база недоступна")));
    const ошибка = vi.spyOn(Logger.prototype, "error");
    await expect(служба.обойти(СЕЙЧАС)).resolves.toBe(0);
    expect(ошибка).toHaveBeenCalledWith(expect.stringContaining("обход не выполнен: Error: база недоступна"));
    ошибка.mockRestore();
  });
});
