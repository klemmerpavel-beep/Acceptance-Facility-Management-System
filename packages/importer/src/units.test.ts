import { describe, expect, it } from "vitest";
import { CANONICAL_UNITS, resolveUnit, unitAliases } from "./units.js";

describe("справочник единиц", () => {
  it("каждая каноническая форма присутствует в перечне написаний", () => {
    const aliases = unitAliases();
    expect([...aliases.keys()]).toEqual([...CANONICAL_UNITS]);
  });

  it("каждое перечисленное написание действительно приводится к своей форме", () => {
    // Перечень существует для экрана настроек. Если он разойдётся с
    // резолвером, справочник начнёт обещать то, чего импорт не делает.
    for (const [unit, spellings] of unitAliases()) {
      for (const spelling of spellings) {
        expect(resolveUnit(spelling)).toEqual({ kind: "resolved", unit });
      }
    }
  });

  it("пять написаний двух величин из файла заказчика сведены", () => {
    const aliases = unitAliases();
    expect(aliases.get("м²")).toContain("м2");
    expect(aliases.get("м.п.")).toEqual(expect.arrayContaining(["мп", "пм", "п/м"]));
  });

  it("неоднозначные написания в перечень не попадают: их решает человек", () => {
    const listed = [...unitAliases().values()].flat();
    expect(listed).not.toContain("м2/мп");
    expect(resolveUnit("м2/мп").kind).toBe("needs-decision");
  });
});
