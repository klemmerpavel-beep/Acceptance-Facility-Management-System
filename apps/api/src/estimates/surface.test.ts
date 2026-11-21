import { describe, expect, it } from "vitest";
import { SurfaceKind } from "@prisma/client";
import { qtySourceSchema, surfaceKindSchema } from "@priyomka/contracts";
import { QTY_SOURCES, SURFACE_KINDS } from "@priyomka/domain";

/**
 * Перечни адреса поверхности (этап Э11, шаг 2) объявлены трижды: в схеме
 * базы (`SurfaceKind`), в домене (`SURFACE_KINDS`, `QTY_SOURCES`) и в
 * контракте. Контракт от домена не зависит, а схема — отдельный язык, и
 * связать их одним объявлением нечем. Расхождение молчало бы до первого
 * ответа: вид, которого нет в контракте, уронил бы разбор сметы на клиенте,
 * а источник, которого нет в домене, служба сочла бы чужой строкой.
 */
describe("перечни адреса поверхности совпадают", () => {
  it("вид поверхности: схема, домен и контракт", () => {
    expect([...SURFACE_KINDS]).toEqual(Object.values(SurfaceKind));
    expect([...SURFACE_KINDS]).toEqual(surfaceKindSchema.options);
  });

  it("источник подстановки: домен и контракт", () => {
    expect([...QTY_SOURCES]).toEqual(qtySourceSchema.options);
  });
});
