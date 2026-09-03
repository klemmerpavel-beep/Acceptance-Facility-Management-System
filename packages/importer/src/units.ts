/**
 * Нормализация единиц измерения.
 *
 * В действующем файле заказчика пятнадцать различных написаний, из них пять
 * для двух физических величин: `мп`, `м2/мп`, `п/м`, `м2/пм`, `мп ` с
 * пробелом на конце. Справочник сводит написания к канонической форме из
 * `docs/01_PROJECT.md`, раздел 7.
 *
 * Написания разделены на две группы намеренно. Однозначные приводятся сами.
 * Неоднозначные — те, где написание не определяет физическую величину, —
 * выносятся на подтверждение оператору с предложенным значением. Молча
 * решать за сметчика, что `м2/мп` означает квадратные метры, недопустимо:
 * это восемнадцать позиций сметы, и ошибка в них меняет объём работ.
 */

/** Канонический справочник единиц. */
export const CANONICAL_UNITS = [
  "м²", "м.п.", "шт", "точка", "ед", "рейс", "ч/ч", "этаж", "%",
] as const;
export type CanonicalUnit = (typeof CANONICAL_UNITS)[number];

/** Написания, приводимые к канонической форме без участия человека. */
const UNAMBIGUOUS: ReadonlyMap<string, CanonicalUnit> = new Map([
  ["м2", "м²"], ["м²", "м²"], ["m2", "м²"], ["кв.м", "м²"], ["кв. м", "м²"],
  ["мп", "м.п."], ["пм", "м.п."], ["п/м", "м.п."], ["м.п.", "м.п."], ["п.м.", "м.п."],
  ["шт", "шт"], ["шт.", "шт"],
  ["точка", "точка"],
  ["ед", "ед"], ["ед.", "ед"],
  ["рейс", "рейс"],
  ["ч/ч", "ч/ч"], ["чел/час", "ч/ч"], ["чел.-час", "ч/ч"],
  ["этаж", "этаж"],
  ["%", "%"],
]);

/**
 * Написания, требующие решения человека: составная запись не определяет,
 * какая из двух величин имеется в виду. Значение — предлагаемая единица.
 */
const AMBIGUOUS: ReadonlyMap<string, CanonicalUnit> = new Map([
  ["м2/мп", "м²"],
  ["м2/пм", "м²"],
  ["м2/п.м", "м²"],
  ["уп", "шт"],
]);

/**
 * Написания, сведённые к каждой канонической форме. Нужен экрану настроек:
 * справочник обязан показывать, что именно он умеет приводить, иначе
 * сметчик узнаёт об этом только по отчёту о расхождениях.
 *
 * Неоднозначные написания в список не входят: они не приводятся сами, а
 * выносятся на подтверждение оператору.
 */
export function unitAliases(): ReadonlyMap<CanonicalUnit, readonly string[]> {
  const grouped = new Map<CanonicalUnit, string[]>(CANONICAL_UNITS.map((unit) => [unit, []]));
  for (const [spelling, unit] of UNAMBIGUOUS) {
    grouped.get(unit)?.push(spelling);
  }
  return grouped;
}

export type UnitResolution =
  | { readonly kind: "resolved"; readonly unit: CanonicalUnit }
  | { readonly kind: "needs-decision"; readonly raw: string; readonly suggestion: CanonicalUnit }
  | { readonly kind: "unknown"; readonly raw: string };

/** Приводит написание к нижнему регистру и убирает пробелы по краям и внутри. */
export const normalizeSpelling = (raw: string): string =>
  raw.trim().toLowerCase().replace(/\s+/g, "");

export function resolveUnit(raw: string | null | undefined): UnitResolution {
  const spelling = raw === null || raw === undefined ? "" : normalizeSpelling(raw);
  if (spelling === "") return { kind: "unknown", raw: raw ?? "" };

  const canonical = UNAMBIGUOUS.get(spelling);
  if (canonical !== undefined) return { kind: "resolved", unit: canonical };

  const suggestion = AMBIGUOUS.get(spelling);
  if (suggestion !== undefined) return { kind: "needs-decision", raw: raw ?? "", suggestion };

  return { kind: "unknown", raw: raw ?? "" };
}

/** Сопоставление, подтверждённое оператором на экране импорта. */
export type UnitOverrides = ReadonlyMap<string, CanonicalUnit>;

/** Резолвер с учётом подтверждённых оператором сопоставлений. */
export function resolveUnitWith(raw: string | null | undefined, overrides: UnitOverrides): UnitResolution {
  const spelling = raw === null || raw === undefined ? "" : normalizeSpelling(raw);
  const override = overrides.get(spelling);
  if (override !== undefined) return { kind: "resolved", unit: override };
  return resolveUnit(raw);
}
