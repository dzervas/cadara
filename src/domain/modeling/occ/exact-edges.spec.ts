import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";

import {
  admitCurveEndAtVertex,
  arcSourceInterval,
  buildExactArcEdge,
  evaluateOccCircle,
  type OccCircleSupport,
} from "@/domain/modeling/occ/exact-edges";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import type { Vec3 } from "@/domain/modeling/occ/geometry";

// Logic lane, seam: the exported arc-edge / vertex-handoff helper on the
// shipped `public/cadara-occ` build (the browser's runtime).
async function loadProductionOcc() {
  const module = (await import("../../../../public/cadara-occ.js")) as {
    default: new (
      module: Record<string, unknown>,
    ) => Promise<OpenCascadeInstance>;
  };
  const wasmBinary = new Uint8Array(
    await readFile(
      new URL("../../../../public/cadara-occ.wasm", import.meta.url),
    ),
  );
  return new module.default({ wasmBinary });
}

const support: OccCircleSupport = {
  center: [1, 1, 0],
  normal: [0, 0, 1],
  xAxis: [1, 0, 0],
  radius: 2,
};

function vertexAt(oc: OpenCascadeInstance, position: Vec3) {
  const point = new oc.gp_Pnt_3(...position);
  const builder = new oc.BRepBuilderAPI_MakeVertex(point);
  const vertex = builder.Vertex();
  builder.delete();
  point.delete();
  return vertex;
}

test("src/domain/modeling/occ/exact-edges.spec.ts", async () => {
  const oc = await loadProductionOcc();

  expect(
    arcSourceInterval({
      center: [0, 0],
      start: [0, 1],
      end: [1, 0],
      sweepDirection: "clockwise",
    }),
    "a clockwise arc is the reversed traversal of its counter-clockwise interval [end, start]",
  ).toEqual([0, Math.PI / 2]);
  expect(
    arcSourceInterval({
      center: [0, 0],
      start: [0, -1],
      end: [-1, 0],
      sweepDirection: "counterClockwise",
    }),
    "an interval that wraps past π continues past it (hi += 2π), as arcDraft",
  ).toEqual([-Math.PI / 2, Math.PI]);

  // R3: a θ0 < 0 range builds; OCC may shift it by 2π, so ends are compared
  // by position, never by parameter identity.
  for (const interval of [
    [-2, 1],
    [0.3, 0.3 + Math.PI],
    [2.5, 6.5],
  ] as const) {
    const low = vertexAt(oc, evaluateOccCircle(support, interval[0]));
    const high = vertexAt(oc, evaluateOccCircle(support, interval[1]));
    const edge = buildExactArcEdge(oc, support, interval, "test arc", {
      low,
      high,
    });
    const adaptor = new oc.BRepAdaptor_Curve_2(edge);
    const [first, last] = [adaptor.FirstParameter(), adaptor.LastParameter()];
    const shift = first - interval[0];
    expect(
      Math.abs(shift - 2 * Math.PI * Math.round(shift / (2 * Math.PI))),
      `[${interval}] keeps the source angles mod 2π`,
    ).toBeLessThanOrEqual(1e-15);
    expect(last - first, `[${interval}] keeps the sweep`).toBeCloseTo(
      interval[1] - interval[0],
      14,
    );
    for (const object of [adaptor, edge, low, high]) object.delete();
  }
  expect(
    () => buildExactArcEdge(oc, support, [1, 1 + 2 * Math.PI], "full turn"),
    "a full turn is not an arc",
  ).toThrow(/empty or full-turn interval/);

  // Vertex handoff: gap 0 → default; gap within the cap → tolerance = gap;
  // gap above the cap → profile-vertex-gap-exceeds-join.
  const end = evaluateOccCircle(support, 0.5);
  const cap = 5e-4;
  const exact = vertexAt(oc, end);
  const defaultTolerance = oc.BRep_Tool.Tolerance_3(exact);
  admitCurveEndAtVertex(oc, exact, end, cap, 3, "test arc");
  expect(oc.BRep_Tool.Tolerance_3(exact), "gap 0 keeps the default").toBe(
    defaultTolerance,
  );
  const half = vertexAt(oc, [end[0] + cap / 2, end[1], end[2]]);
  admitCurveEndAtVertex(oc, half, end, cap, 3, "test arc");
  expect(
    Math.abs(oc.BRep_Tool.Tolerance_3(half) - cap / 2),
    "gap ½·cap sets the measured gap (within the rounding bound)",
  ).toBeLessThanOrEqual(1e-13);
  const beyond = vertexAt(oc, [end[0] + 2 * cap, end[1], end[2]]);
  expect(
    () => admitCurveEndAtVertex(oc, beyond, end, cap, 3, "test arc"),
    "a gap above the cap fails closed before any widening",
  ).toThrow(/^profile-vertex-gap-exceeds-join: /);
  expect(
    oc.BRep_Tool.Tolerance_3(beyond),
    "a rejected vertex is not widened",
  ).toBe(defaultTolerance);
  for (const object of [exact, half, beyond]) object.delete();
});
