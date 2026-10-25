import { expect, test } from "vitest";

import type { PrimitiveRef } from "@/core/editor/schema";
import type { SketchEntityId, SketchId } from "@/contracts/shared/ids";
import {
  getSketchMarqueeMode,
  sampleSketchMarqueeGeometry,
  selectSketchMarqueeTargets,
} from "./marquee";

// Logic lane (domain seam): the sketch marquee's selection rule
// (cadara-h026.1), on screen polylines.

const entity = (id: string): PrimitiveRef => ({
  kind: "sketchEntity",
  sketchId: "sketch_a" as SketchId,
  entityId: id as SketchEntityId,
});
const inside = { target: entity("inside"), points: [{ x: 20, y: 20 }, { x: 40, y: 30 }] };
const crossing = { target: entity("crossing"), points: [{ x: 20, y: 20 }, { x: 200, y: 20 }] };
// A segment passing through the box with both ends outside it.
const through = { target: entity("through"), points: [{ x: -50, y: 50 }, { x: 150, y: 50 }] };
const outside = { target: entity("outside"), points: [{ x: 300, y: 300 }, { x: 310, y: 300 }] };
const candidates = [inside, crossing, through, outside];

test("left to right selects only what the box encloses", () => {
  const start = { x: 0, y: 0 };
  const end = { x: 100, y: 100 };
  expect(getSketchMarqueeMode(start, end)).toBe("enclosed");
  expect(selectSketchMarqueeTargets(candidates, start, end)).toEqual([
    inside.target,
  ]);
});

test("right to left also selects what the box crosses, even with no point in it", () => {
  const start = { x: 100, y: 0 };
  const end = { x: 0, y: 100 };
  expect(getSketchMarqueeMode(start, end)).toBe("crossing");
  expect(selectSketchMarqueeTargets(candidates, start, end)).toEqual([
    inside.target,
    crossing.target,
    through.target,
  ]);
});

test("duplicates and off-screen candidates are dropped", () => {
  expect(
    selectSketchMarqueeTargets(
      [inside, { target: inside.target, points: [{ x: 1, y: 1 }] }, { target: entity("hidden"), points: [] }],
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ),
  ).toEqual([inside.target]);
});

test("circles are sampled around their whole circumference", () => {
  const samples = sampleSketchMarqueeGeometry({
    kind: "circle",
    source: "local",
    id: "c",
    label: "Circle",
    target: entity("circle"),
    center: [0, 0],
    radius: 2,
  });
  expect(samples.length).toBeGreaterThan(32);
  for (const [x, y] of samples) {
    expect(Math.hypot(x, y)).toBeCloseTo(2, 9);
  }
  const xs = samples.map(([x]) => x);
  expect(Math.min(...xs)).toBeCloseTo(-2, 9);
  expect(Math.max(...xs)).toBeCloseTo(2, 9);
});
