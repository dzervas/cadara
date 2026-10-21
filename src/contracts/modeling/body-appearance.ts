import type { tags } from "typia";

import type { BodyId } from "@/contracts/shared/ids";

/**
 * The "Filament" body palette. Slot order is part of the persisted document
 * contract: a body stores its slot, not the hex, so a palette tweak here
 * recolours every auto-coloured body. This is document data shared by the
 * viewport theme and model exporters (3MF), so the hex table lives in
 * contracts rather than in the Mantine-bound `src/theme/workbench-theme.ts`
 * (see the allowlist in `test/static/workbench-theme-regression.spec.ts`).
 */
export const BODY_PALETTE = [
  { name: "Natural", hex: "#efece5" },
  { name: "Berry", hex: "#c97ba6" },
  { name: "Jade", hex: "#86c09b" },
  { name: "Violet", hex: "#a68dd0" },
  { name: "Coral", hex: "#e08d86" },
  { name: "Aqua", hex: "#73c3c4" },
] as const;

export const BODY_PALETTE_SLOT_COUNT = BODY_PALETTE.length;

export type BodyPaletteSlot = 0 | 1 | 2 | 3 | 4 | 5;

/** Lowercase six-digit `#rrggbb`. */
export type BodyAppearanceHex = string & tags.Pattern<"^#[0-9a-f]{6}$">;

export type BodyAppearance =
  | { kind: "palette"; slot: BodyPaletteSlot }
  | { kind: "custom"; hex: BodyAppearanceHex };

export interface AuthoredBodyAppearanceRecord {
  bodyId: BodyId;
  appearance: BodyAppearance;
}

const BODY_APPEARANCE_HEX_PATTERN = /^#[0-9a-f]{6}$/;

/** Structural check for request boundaries that are not Typia-validated. */
export function isBodyAppearance(value: unknown): value is BodyAppearance {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(",");
  if (record.kind === "palette") {
    return (
      keys === "kind,slot" &&
      typeof record.slot === "number" &&
      Number.isInteger(record.slot) &&
      record.slot >= 0 &&
      record.slot < BODY_PALETTE_SLOT_COUNT
    );
  }
  return (
    record.kind === "custom" &&
    keys === "hex,kind" &&
    typeof record.hex === "string" &&
    BODY_APPEARANCE_HEX_PATTERN.test(record.hex)
  );
}

/** The auto palette slot of the `index`-th appearance record ever assigned. */
export function bodyPaletteSlotForIndex(index: number): BodyPaletteSlot {
  return (index % BODY_PALETTE_SLOT_COUNT) as BodyPaletteSlot;
}

/**
 * `appearances` plus an auto palette slot for each of `bodyIds` (in order)
 * that has no record yet. Slots round-robin over the number of records ever
 * assigned, so existing records are never reshuffled and the first six bodies
 * of a document never repeat. Returns `appearances` itself when unchanged.
 */
export function withAutoBodyAppearances(
  appearances: ReadonlyMap<BodyId, BodyAppearance>,
  bodyIds: Iterable<BodyId>,
): ReadonlyMap<BodyId, BodyAppearance> {
  let next: Map<BodyId, BodyAppearance> | null = null;
  for (const bodyId of bodyIds) {
    if ((next ?? appearances).has(bodyId)) continue;
    next ??= new Map(appearances);
    next.set(bodyId, {
      kind: "palette",
      slot: bodyPaletteSlotForIndex(next.size),
    });
  }
  return next ?? appearances;
}

/** The display colour of `appearance` as lowercase `#rrggbb`. */
export function resolveBodyAppearanceHex(
  appearance: BodyAppearance,
): BodyAppearanceHex {
  return appearance.kind === "palette"
    ? BODY_PALETTE[appearance.slot].hex
    : appearance.hex;
}
