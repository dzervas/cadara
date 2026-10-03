import { beforeAll, describe, expect, test } from "vitest";

import type { NeutralCurveQueryCapability } from "@/contracts/modeling/neutral-curve-query";
import {
  makeSketchFixture,
  type SketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import { createSketchArrangementDeriver } from "@/contracts/sketch/region-extraction";
import {
  addCircleAnnulusForTest,
  addRoundedRectangleForTest,
  addSplineLobeForTest,
  ROUNDED_RECTANGLE_FOR_TEST,
  sketchSnapshotRecordForTest,
} from "@/contracts/sketch/region-record.fixtures";
import type { SplinePoles } from "@/contracts/sketch/spline-geometry";
import { measureSketchRegion } from "@/domain/measure/measurement";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import { createStandardPlaneDefinition } from "@/domain/modeling/opencascade-kernel-seed";

let capability: NeutralCurveQueryCapability;
beforeAll(async () => {
  capability = await createCertifiedNeutralCurveQueryCapabilityForTest();
});

async function committed(build: (sketch: SketchFixture) => void) {
  const sketch = makeSketchFixture();
  build(sketch);
  const input = sketch.build();
  const { regions } =
    await createSketchArrangementDeriver(capability).derive(input);
  return {
    input,
    regions,
    record: sketchSnapshotRecordForTest(
      input,
      regions,
      createStandardPlaneDefinition("xy"),
    ),
  };
}

function measured(
  record: Awaited<ReturnType<typeof committed>>["record"],
  index = 0,
) {
  const result = measureSketchRegion(record, record.sketch.regions[index]!);
  if (result.kind === "failed") throw new Error(result.message);
  return result;
}

const expectRelative = (actual: number, oracle: number, bound: number) =>
  expect(
    Math.abs(actual - oracle) / Math.abs(oracle),
    `${actual} vs oracle ${oracle}`,
  ).toBeLessThanOrEqual(bound);

// Independent oracles (spec-only): the exact power-basis Green integral of a
// cubic, and an adaptive Simpson arc length, written apart from the owner's
// interval Green forms and Gauss–Legendre length.
function cubicGreenArea([p0, p1, p2, p3]: SplinePoles): number {
  const power = (axis: 0 | 1) => [
    p0[axis],
    3 * (p1[axis] - p0[axis]),
    3 * (p0[axis] - 2 * p1[axis] + p2[axis]),
    -p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis],
  ];
  const [x, y] = [power(0), power(1)];
  let integral = 0;
  for (let j = 0; j < 4; j += 1)
    for (let k = 1; k < 4; k += 1)
      integral += (k * (x[j]! * y[k]! - y[j]! * x[k]!)) / (j + k);
  return integral / 2;
}

function cubicLengthSimpson([p0, p1, p2, p3]: SplinePoles): number {
  const speed = (u: number) => {
    const v = 1 - u;
    const d = (axis: 0 | 1) =>
      3 *
      (v * v * (p1[axis] - p0[axis]) +
        2 * u * v * (p2[axis] - p1[axis]) +
        u * u * (p3[axis] - p2[axis]));
    return Math.hypot(d(0), d(1));
  };
  const simpson = (a: number, b: number) =>
    ((b - a) / 6) * (speed(a) + 4 * speed((a + b) / 2) + speed(b));
  const adapt = (
    a: number,
    b: number,
    whole: number,
    depth: number,
  ): number => {
    const m = (a + b) / 2;
    const [left, right] = [simpson(a, m), simpson(m, b)];
    if (depth > 40 || Math.abs(left + right - whole) <= 1e-15)
      return left + right + (left + right - whole) / 15;
    return adapt(a, m, left, depth + 1) + adapt(m, b, right, depth + 1);
  };
  return adapt(0, 1, simpson(0, 1), 0);
}

function splinePoles(input: Awaited<ReturnType<typeof committed>>["input"]) {
  const record = input.solvedSnapshot.solvedEntities.find(
    (entity) => entity.kind === "spline",
  );
  if (record?.kind !== "spline") throw new Error("fixture spline missing");
  return record.reconstruction.spans.map((span) => span.poles);
}

describe("measurement: committed region area and perimeter come from the exact boundary owner (T10e)", () => {
  test("rounded rectangle: w·h − (4 − π)r² and 2(w + h) − 8r + 2πr", async () => {
    const { record } = await committed(addRoundedRectangleForTest);
    expect(record.sketch.regions).toHaveLength(1);
    const { w, h, r } = ROUNDED_RECTANGLE_FOR_TEST;
    const result = measured(record);
    expectRelative(result.area, w * h - (4 - Math.PI) * r * r, 1e-12);
    expectRelative(
      result.perimeter,
      2 * (w + h) - 8 * r + 2 * Math.PI * r,
      1e-12,
    );
    expect(result.approximate).toBe(false);
  }, 60_000);

  test("annulus of concentric circles: π(R² − r²), holes subtract, perimeter 2π(R + r)", async () => {
    const { record } = await committed(addCircleAnnulusForTest);
    const index = record.sketch.regions.findIndex(
      (region) => region.loops.length === 2,
    );
    expect(index).toBeGreaterThanOrEqual(0);
    const result = measured(record, index);
    expectRelative(result.area, Math.PI * (25 - 4), 1e-12);
    expectRelative(result.perimeter, 2 * Math.PI * 7, 1e-12);
    expect(result.loops.map((loop) => Math.sign(loop.signedArea))).toEqual([
      1, -1,
    ]);
    expectRelative(result.loops[1]!.length, 4 * Math.PI, 1e-12);
  }, 60_000);

  test("spline lobe closed by a line: exact Green area of the spans and their arc length", async () => {
    const { input, record } = await committed(addSplineLobeForTest);
    expect(record.sketch.regions).toHaveLength(1);
    const poles = splinePoles(input);
    expect(poles).toHaveLength(2);
    // The chord runs along y = 0 through the origin, so its Green term is 0.
    const area = Math.abs(
      poles.reduce((sum, span) => sum + cubicGreenArea(span), 0),
    );
    const length =
      6 + poles.reduce((sum, span) => sum + cubicLengthSimpson(span), 0);
    const result = measured(record);
    expectRelative(result.area, area, 1e-12);
    expectRelative(result.perimeter, length, 1e-12);
    expect(result.approximate).toBe(false);
    // The legacy fill/measure polygon through the authored corners A, B is
    // degenerate (2 points): the exact area is far from it.
    expect(result.area).toBeGreaterThan(10);
  }, 60_000);

  test("a region that does not resolve against the record's pair fails closed with the owner's code", async () => {
    const { record } = await committed(addRoundedRectangleForTest);
    const forged = structuredClone(record.sketch.regions[0]!);
    const result = measureSketchRegion(record, forged);
    expect(result.kind).toBe("failed");
    expect(result.kind === "failed" && result.code).toBe(
      "profile-boundary-unresolved",
    );
  }, 60_000);
});
