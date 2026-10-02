import { describe, expect, it } from "vitest";
import {
  createEstimateItem, createEstimateSection, fetchEstimate, removeEstimateItem, removeEstimateSection,
  renameEstimateSection, setDemoRole,
} from "./api.demo.js";

/**
 * Двойник демонстрации заводит и удаляет позиции и разделы в памяти (план,
 * пункт 7.3) — теми же правилами домена, что сервер: демонстрация,
 * послушнее продукта, показывала бы не продукт, а макет.
 */
describe("двойник: заведение и удаление позиций и разделов сметы (пункт 7.3)", () => {
  setDemoRole("OWNER");

  it("заведённая позиция встаёт в раздел, итоги и счётчики пересчитываются, удаление возвращает их", async () => {
    /* Двойник держит одну изменяемую копию сметы: числа снимаются до
       действия, а не сравниваются с тем же объектом после. */
    const вид = await fetchEstimate("R-99");
    const до = { positions: вид.positions, works: вид.totals.works, wage: вид.totals.wage };
    const раздел = вид.sections[0];
    if (раздел === undefined) throw new Error("в слепке нет разделов");
    const после = await createEstimateItem("R-99", {
      sectionId: раздел.id, name: "Проверка двойника", unit: "м²",
      qty: "2000", unitPrice: "10000", unitWage: "4000", roomId: null,
    });
    expect(после.positions).toBe(до.positions + 1);
    expect(BigInt(после.totals.works) - BigInt(до.works)).toBe(20000n);
    expect(BigInt(после.totals.wage ?? "0") - BigInt(до.wage ?? "0")).toBe(8000n);
    const новая = после.sections[0]?.items.find((позиция) => позиция.name === "Проверка двойника");
    expect(новая?.unitWage).toBe("4000");
    if (новая === undefined) throw new Error("позиция не заведена");
    const вернулась = await removeEstimateItem("R-99", новая.id);
    expect(вернулась.positions).toBe(до.positions);
    expect(вернулась.totals.works).toBe(до.works);
  });

  it("принятую позицию двойник не удаляет: отказ называет принятое и путь через сторно", async () => {
    const вид = await fetchEstimate("R-99");
    const обход = (узлы: typeof вид.sections): typeof вид.sections[number]["items"] =>
      узлы.flatMap((узел) => [...узел.items, ...обход(узел.children)]);
    const принятая = обход(вид.sections).find((позиция) => BigInt(позиция.qtyAccepted) > 0n);
    if (принятая === undefined) throw new Error("в слепке нет принятой позиции — отказ не на чем проверить");
    await expect(removeEstimateItem("R-99", принятая.id)).rejects.toThrow(/Сторнируйте приёмку/u);
  });

  it("раздел заводится, переименовывается и удаляется пустым; непустой — отказ", async () => {
    const вид = await fetchEstimate("R-99");
    const верхнихДо = вид.sectionsTopLevel;
    const непустой = вид.sections.find((раздел) => раздел.items.length > 0);
    const заведён = await createEstimateSection("R-99", { name: "Проверка раздела", parentId: null });
    expect(заведён.sectionsTopLevel).toBe(верхнихДо + 1);
    const новый = заведён.sections.find((раздел) => раздел.name === "Проверка раздела");
    if (новый === undefined) throw new Error("раздел не заведён");
    const переименован = await renameEstimateSection("R-99", новый.id, { name: "Проверка раздела 2" });
    expect(переименован.sections.some((раздел) => раздел.name === "Проверка раздела 2")).toBe(true);
    if (непустой === undefined) throw new Error("в слепке нет непустого раздела");
    await expect(removeEstimateSection("R-99", непустой.id)).rejects.toThrow(/не пуст/u);
    const после = await removeEstimateSection("R-99", новый.id);
    expect(после.sectionsTopLevel).toBe(верхнихДо);
  });
});
