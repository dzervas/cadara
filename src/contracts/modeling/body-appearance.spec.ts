// Logic lane; seam: the body appearance contract helpers shared by the
// kernel, the viewport and exporters.
import { expect, test } from "vitest";

import {
  BODY_PALETTE,
  isBodyAppearance,
  resolveBodyAppearanceHex,
  withAutoBodyAppearances,
  type BodyAppearance,
} from "@/contracts/modeling/body-appearance";
import type { BodyId } from "@/contracts/shared/ids";

test("the Filament palette resolves slots in order, and custom colours as stored", () => {
  expect(BODY_PALETTE.map(({ name, hex }) => `${name} ${hex}`)).toEqual([
    "Natural #efece5",
    "Berry #c97ba6",
    "Jade #86c09b",
    "Violet #a68dd0",
    "Coral #e08d86",
    "Aqua #73c3c4",
  ]);
  expect(resolveBodyAppearanceHex({ kind: "palette", slot: 3 })).toBe(
    "#a68dd0",
  );
  expect(resolveBodyAppearanceHex({ kind: "custom", hex: "#123abc" })).toBe(
    "#123abc",
  );
  expect(isBodyAppearance({ kind: "custom", hex: "#123ABC" })).toBe(false);
  expect(isBodyAppearance({ kind: "palette", slot: 6 })).toBe(false);
});

test("auto slots round-robin over every record ever assigned and never move existing records", () => {
  const ids = (count: number) =>
    Array.from({ length: count }, (_, index) => `body_${index}` as BodyId);
  const first = withAutoBodyAppearances(new Map(), ids(7));
  expect([...first.values()]).toEqual(
    [0, 1, 2, 3, 4, 5, 0].map((slot) => ({ kind: "palette", slot })),
  );

  const custom: BodyAppearance = { kind: "custom", hex: "#336699" };
  const existing = new Map<BodyId, BodyAppearance>([
    ["body_kept" as BodyId, custom],
    ["body_gone" as BodyId, { kind: "palette", slot: 1 }],
  ]);
  const next = withAutoBodyAppearances(existing, [
    "body_kept" as BodyId,
    "body_new" as BodyId,
  ]);
  expect([...next]).toEqual([
    ["body_kept", custom],
    ["body_gone", { kind: "palette", slot: 1 }],
    ["body_new", { kind: "palette", slot: 2 }],
  ]);
  expect(
    withAutoBodyAppearances(next, ["body_new" as BodyId]),
    "no new body, no new map",
  ).toBe(next);
});
