import { describe, expect, it } from "vitest";
import type { EstimateItem, EstimateView, MeasureRoom, MeasureView } from "@priyomka/contracts";
import {
  createOpening, createRoom, deleteRoom, fetchEstimate, fetchMeasure, setDemoRole, updateEstimateItem,
  updateOpening, updateRoom,
} from "./api.demo.js";

/**
 * Стены, проёмы двух помещений и адрес поверхности в двойнике демонстрации
 * (этап Э11, шаг 2) — теми же правилами, что сервер: двойник, послушнее
 * продукта, показывал бы не продукт, а макет. Ожидания — правила службы
 * замера и сметы (`measure.service.ts`, `estimates.service.ts`) и проверки
 * `scripts/verify-api.mjs` того же шага; числа посчитаны здесь вручную.
 */

const помещение = (вид: MeasureView, имя: string): MeasureRoom => {
  const найдено = вид.rooms.find((строка) => строка.name === имя);
  if (найдено === undefined) throw new Error(`в наборе нет помещения «${имя}»`);
  return найдено;
};

const позиции = (вид: EstimateView): EstimateItem[] =>
  вид.sections.flatMap((раздел) => [...раздел.items, ...раздел.children.flatMap((вложенный) => вложенный.items)]);

/** Тело сохранения помещения: четыре величины как есть. */
const величины = (комната: MeasureRoom) => ({
  name: комната.name,
  floorArea: комната.floorArea,
  floorPerimeter: комната.floorPerimeter,
  ceilingPerimeter: комната.ceilingPerimeter,
  height: комната.height,
});

describe("двойник: стены и проёмы двух помещений (этап Э11, шаг 2)", () => {
  setDemoRole("OWNER");

  it("первая стена снимает итоги проёмов; стены и итоги в одном теле — отказ", async () => {
    const спальня = помещение(await fetchMeasure("R-99", "INITIAL"), "Спальня");
    expect(спальня.walls).toEqual([]);
    expect(спальня.openings.length).toBe(2);
    await expect(updateRoom("R-99", спальня.id, {
      walls: [{ length: "4000" }],
      openings: [{ kind: "WINDOW", count: 1, area: "2100", reveal: "5800" }],
    })).rejects.toThrow(/итогов проёмов нет/u);

    /* 4,00 + 4,60 + 4,00 + 4,60 = 17,20 против периметра 17,60: 0,40 больше
       допуска 0,352 — предупреждение Д15. Брутто 17,20 × 2,70 = 46,44. */
    const вид = await updateRoom("R-99", спальня.id, {
      ...величины(спальня),
      walls: [{ label: "у окна", length: "4000" }, { length: "4600" }, { length: "4000" }, { length: "4600" }],
    });
    const после = помещение(вид, "Спальня");
    expect(после.openings).toEqual([]);
    expect(после.walls.map((стена) => стена.name)).toEqual(["Стена 1 · у окна", "Стена 2", "Стена 3", "Стена 4"]);
    expect(после.wallArea).toBe("46440");
    expect(после.wallAreaNet).toBe("46440");
    expect(после.wallsLength).toBe("17200");
    expect(после.wallsWarning).toMatch(/меньше периметра потолка 17,60.*на 0,40.*допуска 0,35/u);
  });

  it("проём со строки стены, сторона Б — только стена соседа того же набора", async () => {
    const вид = await fetchMeasure("R-99", "INITIAL");
    const спальня = помещение(вид, "Спальня");
    const стена3 = спальня.walls[2];
    if (стена3 === undefined) throw new Error("нет третьей стены");
    const коридор = помещение(вид, "Коридор");
    /* Откосы второй стороны без её стены — отказ, как у сервера. */
    await expect(createOpening("R-99", стена3.id, {
      kind: "DOOR", width: "800", height: "2100", reveal: "5000", adjoiningReveal: "4000",
    })).rejects.toThrow(/вместе с её стеной/u);
    /* Дверь к коридору без стен — односторонняя и предложена к привязке. */
    const сДверью = await createOpening("R-99", стена3.id, { kind: "DOOR", width: "800", height: "2100", reveal: "5000" });
    const дверь = помещение(сДверью, "Спальня").walls[2]?.openings[0];
    expect(дверь?.side).toBe("A");
    expect(дверь?.other).toBeNull();
    expect(дверь?.area).toBe("1680");
    expect(помещение(сДверью, "Спальня").walls[2]?.wallAreaNet).toBe("9120");
    expect(сДверью.unboundOpenings.some((проём) => проём.id === дверь?.id)).toBe(true);
    expect(коридор.walls).toEqual([]);

    /* Коридору заводят стены — привязка одним касанием: сторона Б на его
       стене, и нетто коридора считается по стенам с вычетом двери. */
    const коридорСоСтенами = await updateRoom("R-99", коридор.id, {
      ...величины(коридор),
      walls: [{ length: "4650" }, { length: "4650" }, { length: "4650" }, { length: "4650" }],
    });
    const стенаКоридора = помещение(коридорСоСтенами, "Коридор").walls[0];
    if (стенаКоридора === undefined || дверь === undefined) throw new Error("нет стены коридора или двери");
    /* Стена другого набора — отказ. */
    const лоджия = помещение(await fetchMeasure("R-99", "REPLANNED"), "Лоджия");
    await expect(updateOpening("R-99", дверь.id, { adjoiningWallId: лоджия.walls[0]?.id ?? "" }))
      .rejects.toThrow(/другого набора/u);
    const привязано = await updateOpening("R-99", дверь.id, { adjoiningWallId: стенаКоридора.id, adjoiningReveal: "4200" });
    const сторонаБ = помещение(привязано, "Коридор").walls[0]?.openings[0];
    expect(сторонаБ?.side).toBe("B");
    expect(сторонаБ?.reveal).toBe("4200");
    expect(сторонаБ?.other?.roomName).toBe("Спальня");
    /* 4,65 × 2,70 = 12,555 − дверь 1,68 = 10,875. */
    expect(помещение(привязано, "Коридор").walls[0]?.wallAreaNet).toBe("10875");
    expect(привязано.unboundOpenings.some((проём) => проём.id === дверь.id)).toBe(false);
  });

  it("удаление стены стороны А передаёт проём соседу, откосы меняются местами", async () => {
    const вид = await fetchMeasure("R-99", "INITIAL");
    const спальня = помещение(вид, "Спальня");
    const остаются = спальня.walls.filter((стена) => стена.order !== 3)
      .map((стена) => ({ id: стена.id, label: стена.label, length: стена.length }));
    const после = await updateRoom("R-99", спальня.id, { walls: остаются });
    expect(помещение(после, "Спальня").walls.length).toBe(3);
    const перешёл = помещение(после, "Коридор").walls[0]?.openings[0];
    expect(перешёл?.side).toBe("A");
    expect(перешёл?.other).toBeNull();
    expect(перешёл?.reveal).toBe("4200");
  });

  it("удаление помещения с позициями сметы — отказ с числом, как у сервера", async () => {
    const вид = await fetchMeasure("R-99", "REPLANNED");
    const кухня = помещение(вид, "Кухня-гостиная");
    await expect(deleteRoom("R-99", кухня.id)).rejects.toThrow(/привязано позиций сметы: \d+/u);
  });
});

describe("двойник: адрес поверхности, источник и признак (этап Э11, шаг 2)", () => {
  setDemoRole("OWNER");

  it("подстановка с адресом, признак после правки обмера, ручная правка снимает источник", async () => {
    const обмер = await fetchMeasure("R-99", "REPLANNED");
    const кухня = помещение(обмер, "Кухня-гостиная");
    const стена1 = кухня.walls[0];
    if (стена1 === undefined) throw new Error("у кухни-гостиной в слепке нет стен");
    /* 11,15 × 2,70 = 30,105 − два окна по 1,50 × 1,80 = 24,705. */
    expect(стена1.wallAreaNet).toBe("24705");
    const позиция = позиции(await fetchEstimate("R-99"))
      .find((строка) => строка.room?.id === кухня.id && строка.unit === "м²" && строка.qtyAccepted === "0");
    if (позиция === undefined) throw new Error("на кухне-гостиной нет позиции в м² без приёмки");
    expect(позиция.surface).toEqual({ kind: null, wall: null, source: null });

    /* Источник не того адреса и не то число — отказы домена. */
    await expect(updateEstimateItem("R-99", позиция.id, {
      surfaceKind: "WALL", wallId: стена1.id, qty: "24705", qtySource: "room:wallAreaNet",
    })).rejects.toThrow(/не относится к поверхности/u);
    await expect(updateEstimateItem("R-99", позиция.id, {
      surfaceKind: "WALL", wallId: стена1.id, qty: "20000", qtySource: "wall:wallAreaNet",
    })).rejects.toThrow(/обмер изменился, пока лист был открыт/u);

    const сАдресом = позиции(await updateEstimateItem("R-99", позиция.id, {
      surfaceKind: "WALL", wallId: стена1.id, qty: "24705", qtySource: "wall:wallAreaNet",
    })).find((строка) => строка.id === позиция.id);
    expect(сАдресом?.surface?.wall?.name).toBe("Стена 1 · окна");
    expect(сАдресом?.surface?.source?.state).toBe("same");
    expect(сАдресом?.surface?.source?.note).toContain("стена «Стена 1 · окна»: площадь стены нетто, 24,705");

    /* Стену удлинили до 11,30: 30,51 − 5,40 = 25,11 — признак, количество то же. */
    const кухняСейчас = помещение(await fetchMeasure("R-99", "REPLANNED"), "Кухня-гостиная");
    await updateRoom("R-99", кухня.id, {
      walls: кухняСейчас.walls.map((стена) => ({
        id: стена.id, label: стена.label, length: стена.order === 1 ? "11300" : стена.length,
      })),
    });
    const сПризнаком = позиции(await fetchEstimate("R-99")).find((строка) => строка.id === позиция.id);
    expect(сПризнаком?.qty).toBe("24705");
    expect(сПризнаком?.surface?.source?.state).toBe("changed");
    expect(сПризнаком?.surface?.source?.drift).toBe("Подставлено 24,705\u00A0м², сейчас 25,11\u00A0м². Количество само не меняется.");

    /* Стену, на которую ссылается позиция, удалить нельзя; число позиций
       стоит в ответе обмера — лист показывает по нему отказ вместо кнопки
       (норматив 55.5; П-88). */
    const соСтеной = помещение(await fetchMeasure("R-99", "REPLANNED"), "Кухня-гостиная");
    expect(соСтеной.walls[0]?.estimateItems).toEqual({ current: 1, previous: 0 });
    expect(соСтеной.walls[1]?.estimateItems).toEqual({ current: 0, previous: 0 });
    await expect(updateRoom("R-99", кухня.id, {
      walls: соСтеной.walls.filter((стена) => стена.order !== 1)
        .map((стена) => ({ id: стена.id, label: стена.label, length: стена.length })),
    })).rejects.toThrow(/Стена 1 · окна — 1 позиция/u);

    /* Ручная правка количества снимает источник, адрес остаётся. */
    const руками = позиции(await updateEstimateItem("R-99", позиция.id, { qty: "25000" }))
      .find((строка) => строка.id === позиция.id);
    expect(руками?.surface?.source).toBeNull();
    expect(руками?.surface?.kind).toBe("WALL");
    expect(руками?.surface?.wall?.id).toBe(стена1.id);

    /* Смена помещения позиции сохраняется (П-82): прежде двойник не читал
       `roomId`, и выбранное в листе помещение в демонстрации пропадало. Вид
       остаётся, стена чужого помещения снимается — как у сервера. */
    const лоджия = помещение(await fetchMeasure("R-99", "REPLANNED"), "Лоджия");
    const вЛоджии = позиции(await updateEstimateItem("R-99", позиция.id, { roomId: лоджия.id }))
      .find((строка) => строка.id === позиция.id);
    expect(вЛоджии?.room?.id).toBe(лоджия.id);
    expect(вЛоджии?.surface?.kind).toBe("WALL");
    expect(вЛоджии?.surface?.wall).toBeNull();
  });
});

/**
 * Перевод позиций на одноимённое помещение перепланировки (П-93) — правило
 * `перевестиПозиции` сервера: прежде двойник его не повторял, и в
 * демонстрации позиции оставались «из начального обмера», а правило Э11-2.8
 * «перевод снимает стену» не было видно вовсе.
 */
describe("двойник: перевод позиций на перепланировку (этап Э11, шаг 2)", () => {
  setDemoRole("OWNER");

  it("одноимённое помещение перепланировки переводит позиции: вид остаётся, стена снимается, источник удалён", async () => {
    const начальный = await fetchMeasure("R-99", "INITIAL");
    const именаПосле = new Set((await fetchMeasure("R-99", "REPLANNED")).rooms.map((строка) => строка.name));
    const смета = позиции(await fetchEstimate("R-99"));
    const комната = начальный.rooms.find((строка) => !именаПосле.has(строка.name)
      && смета.some((п) => п.room?.id === строка.id && п.unit === "м²" && п.qtyAccepted === "0"));
    if (комната === undefined) throw new Error("в слепке нет помещения начального обмера без пары в перепланировке");
    const наКомнате = смета.filter((п) => п.room?.id === комната.id);
    const позиция = наКомнате.find((п) => п.unit === "м²" && п.qtyAccepted === "0");
    if (позиция === undefined) throw new Error("на помещении нет позиции в м² без приёмки");

    /* Стена начального обмера и позиция с адресом «одна стена» и источником с неё. */
    const соСтеной = помещение(await updateRoom("R-99", комната.id, { walls: [{ length: "3000" }] }), комната.name);
    const стена = соСтеной.walls[0];
    if (стена === undefined) throw new Error("стена начального обмера не заведена");
    await updateEstimateItem("R-99", позиция.id, {
      surfaceKind: "WALL", wallId: стена.id, qty: стена.wallAreaNet, qtySource: "wall:wallAreaNet",
    });

    const заведено = await createRoom("R-99", "REPLANNED", величины(комната));
    const новое = помещение(заведено, комната.name);
    const после = await fetchEstimate("R-99");
    const переведены = позиции(после).filter((п) => п.room?.id === новое.id);
    expect(переведены.map((п) => п.id).sort()).toEqual(наКомнате.map((п) => п.id).sort());
    expect(позиции(после).filter((п) => п.room?.id === комната.id)).toEqual([]);
    expect(после.rooms.some((строка) => строка.id === новое.id && строка.set === "REPLANNED")).toBe(true);

    const переведена = позиции(после).find((п) => п.id === позиция.id);
    expect(переведена?.room).toEqual({ id: новое.id, name: комната.name, set: "REPLANNED" });
    expect(переведена?.qty).toBe(стена.wallAreaNet);
    expect(переведена?.surface?.kind).toBe("WALL");
    expect(переведена?.surface?.wall).toBeNull();
    expect(переведена?.surface?.source?.state).toBe("removed");
    expect(переведена?.surface?.source?.drift).toContain("Позицию перевели на обмер после перепланировки");
  });
});
