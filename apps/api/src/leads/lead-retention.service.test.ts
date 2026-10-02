import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LeadRetentionService } from "./lead-retention.service";
import { ОБЕЗЛИЧЕНО } from "./anonymize";

/**
 * Обход срока хранения отказных заявок (П-40, решение от 02.10.2026).
 * Свойства, которые стенд проверяет только на двух заявках наполнения:
 * граница срока; обезличивание и запись журнала — одной транзакцией;
 * заявка, обезличенная руководителем между выборкой и записью, второй
 * записи журнала не получает; сбой базы не роняет сервер.
 */
const СЕЙЧАС = new Date("2026-10-02T12:00:00Z");
const днейНазад = (дни: number): Date => new Date(СЕЙЧАС.getTime() - дни * 86_400_000);

function стенд(кандидаты: { id: string; lostAt: Date | null }[], уже = new Set<string>()) {
  const обновления: { id: string; data: Record<string, unknown> }[] = [];
  const журнал: Record<string, unknown>[] = [];
  const tx = {
    lead: {
      updateMany: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        if (уже.has(where.id)) return Promise.resolve({ count: 0 });
        обновления.push({ id: where.id, data });
        return Promise.resolve({ count: 1 });
      }),
    },
  };
  const prisma = {
    lead: {
      findMany: vi.fn(() => Promise.resolve(кандидаты.map((заявка) => ({ ...заявка, orgId: "орг" })))),
    },
    $transaction: vi.fn((работа: (клиент: typeof tx) => Promise<void>) => работа(tx)),
  };
  const audit = {
    record: vi.fn((запись: Record<string, unknown>, клиент: unknown) => {
      expect(клиент).toBe(tx);
      журнал.push(запись);
      return Promise.resolve();
    }),
  };
  const служба = new LeadRetentionService(prisma as never, audit);
  return { служба, prisma, обновления, журнал };
}

describe("обход срока хранения отказных заявок", () => {
  beforeAll(() => { Logger.overrideLogger(false); });

  it("обезличивает заявку старше тридцати дней и не трогает младшую", async () => {
    const { служба, обновления, журнал } = стенд([
      { id: "старая", lostAt: днейНазад(31) },
      { id: "свежая", lostAt: днейНазад(29) },
    ]);
    expect(await служба.обойти(СЕЙЧАС)).toBe(1);
    expect(обновления.map((запись) => запись.id)).toEqual(["старая"]);
    expect(обновления[0]?.data).toMatchObject({ name: ОБЕЗЛИЧЕНО, phone: "", address: null, note: null });
    expect(журнал).toHaveLength(1);
  });

  it("запись журнала — без автора и без персональных данных", async () => {
    const { служба, журнал } = стенд([{ id: "старая", lostAt: днейНазад(45) }]);
    await служба.обойти(СЕЙЧАС);
    expect(журнал[0]).toMatchObject({ actorId: null, entity: "Lead", entityId: "старая", oldValue: null });
    expect(String(журнал[0]?.newValue)).toBe("обезличены по сроку хранения: 30 дней после отказа");
  });

  it("заявка, обезличенная руководителем после выборки, второй записи журнала не получает", async () => {
    const { служба, журнал } = стенд([{ id: "гонка", lostAt: днейНазад(40) }], new Set(["гонка"]));
    expect(await служба.обойти(СЕЙЧАС)).toBe(0);
    expect(журнал).toHaveLength(0);
  });

  it("отказ без даты не обезличивается: срок не от чего считать", async () => {
    const { служба, prisma } = стенд([{ id: "без даты", lostAt: null }]);
    expect(await служба.обойти(СЕЙЧАС)).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("сбой базы пишется в журнал запуска, а не роняет сервер", async () => {
    const { служба, prisma } = стенд([]);
    prisma.lead.findMany.mockImplementationOnce(() => Promise.reject(new Error("база недоступна")));
    const ошибка = vi.spyOn(Logger.prototype, "error");
    await expect(служба.обойти(СЕЙЧАС)).resolves.toBe(0);
    expect(ошибка).toHaveBeenCalledWith(expect.stringContaining("обход не выполнен: Error: база недоступна"));
    ошибка.mockRestore();
  });
});
