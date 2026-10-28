/**
 * Kernel limitation (docs/testing.md "Kernel limitations"): OCC ChFi3d cannot
 * build an equal-distance chamfer on two adjacent edges when the corner mitre
 * has to trim a face that is not adjacent to either chamfered edge. This spec is
 * EXPECTED TO FAIL against our production OCC build: it asserts what a correct
 * kernel does, and our kernel does not. When it starts passing, the limitation
 * is lifted. Revisit the refusal message in
 * src/infrastructure/occ/features/fillet-chamfer.ts (it links here) and move
 * this spec into a normal lane, or delete it.
 *
 * How we found it: the Onshape "Laptop Stand" import (cadara-1le, cadara-ybk).
 * Its Chamfer 1 is a 1.5 mm equal-offset chamfer on the 4 top-inner edges of a
 * 3 mm wall frame. Fillet 2 had already rounded the frame's outer vertical
 * corners with r6. Each inner sharp corner sits 3√2 ≈ 4.24 mm from its fillet
 * axis. The chamfer's mitre point on the top face sits (3 + d)√2 from that
 * axis, so once d > 6/√2 − 3 ≈ 1.2426 mm the mitre breaks through the fillet
 * surface. Measured on the real body: single edges and opposite pairs build at
 * 1.5 mm, but every adjacent pair fails. At 1.25 mm the builder reports done
 * but the solid is invalid. From 1.3 mm up, IsDone() is false. Onshape
 * (Parasolid) builds it by cutting into the fillet faces: 23 → 30 faces, with
 * the top ring face split into 4 strips.
 *
 * Cause: ChFi3d only trims a chamfer corner against the faces adjacent to the
 * chamfered edges; the r6 fillet face is not one of them. Our pin is the
 * OCCT-7.6 branch, commit bb368e27 (Apr 2022). Since then, upstream ChFi3d
 * corner code has had only tolerance and refactoring changes. Upstream records:
 * - https://github.com/Open-Cascade-SAS/OCCT/issues/1177 (open: fillet/chamfer
 *   cannot meet opposite edges / remove a face)
 * - https://github.com/Open-Cascade-SAS/OCCT/pull/1449 ("Enhance fillet and
 *   chamfer handling. Part 2", master only, not yet tested against this case)
 *
 * Minimal reproduction: a 30 × 30 × 10 box minus a 24 × 24 through-box (3 mm
 * walls), with ONE outer vertical corner (x = 0, y = 0) filleted r6 (axis at
 * x = y = 6). The two top-inner edges meet at (3, 3, 10).
 */
import { expect, test } from "vitest";

import { getDefaultOpenCascadeInstance } from "@/infrastructure/occ/runtime";

type Oc = Awaited<ReturnType<typeof getDefaultOpenCascadeInstance>>;
type Shape = InstanceType<Oc["TopoDS_Shape"]>;
type Edge = InstanceType<Oc["TopoDS_Edge"]>;

const WALL = 3;
const OUTER = 30;
const HEIGHT = 10;
const FILLET_RADIUS = 6;
/** The mitre point reaches the r6 fillet surface at d = 6/√2 − 3 ≈ 1.2426. */
const MITRE_BREAKTHROUGH_DISTANCE = FILLET_RADIUS / Math.SQRT2 - WALL;
const TOLERANCE = 1e-6;

function makeBox(
  oc: Oc,
  origin: readonly [number, number, number],
  size: readonly [number, number, number],
) {
  const box = new oc.BRepPrimAPI_MakeBox_3(new oc.gp_Pnt_3(...origin), ...size);
  box.Build(new oc.Message_ProgressRange_1());
  return box.Shape();
}

function edgeEndpoints(oc: Oc, edge: Edge) {
  const curve = new oc.BRepAdaptor_Curve_2(edge);
  const ends = [curve.FirstParameter(), curve.LastParameter()].map((u) => {
    const point = curve.Value(u);
    return [point.X(), point.Y(), point.Z()] as const;
  });
  return ends;
}

/** The straight edge of `shape` whose endpoints are exactly `a` and `b`. */
function findLineEdge(
  oc: Oc,
  shape: Shape,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
) {
  const near = (p: readonly number[], q: readonly [number, number, number]) =>
    p.every((value, index) => Math.abs(value - q[index]!) < TOLERANCE);
  const explorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
  );
  for (; explorer.More(); explorer.Next()) {
    const edge = oc.TopoDS.Edge_1(explorer.Current());
    const [first, last] = edgeEndpoints(oc, edge);
    if (
      (near(first!, a) && near(last!, b)) ||
      (near(first!, b) && near(last!, a))
    ) {
      return edge;
    }
  }
  throw new Error(`No edge from (${a.join(", ")}) to (${b.join(", ")}).`);
}

/** The 3 mm wall frame with its (0, 0) outer vertical corner filleted r6. */
function makeFilletedFrame(oc: Oc) {
  const frame = new oc.BRepAlgoAPI_Cut_3(
    makeBox(oc, [0, 0, 0], [OUTER, OUTER, HEIGHT]),
    makeBox(
      oc,
      [WALL, WALL, -1],
      [OUTER - 2 * WALL, OUTER - 2 * WALL, HEIGHT + 2],
    ),
    new oc.Message_ProgressRange_1(),
  );
  frame.Build(new oc.Message_ProgressRange_1());
  expect(frame.IsDone(), "The 3 mm wall frame must build.").toBe(true);

  const fillet = new oc.BRepFilletAPI_MakeFillet(
    frame.Shape(),
    oc.ChFi3d_FilletShape.ChFi3d_Rational as never,
  );
  fillet.Add_2(
    FILLET_RADIUS,
    findLineEdge(oc, frame.Shape(), [0, 0, 0], [0, 0, HEIGHT]),
  );
  fillet.Build(new oc.Message_ProgressRange_1());
  expect(fillet.IsDone(), "The r6 outer corner fillet must build.").toBe(true);
  expect(isValidSolid(oc, fillet.Shape())).toBe(true);
  return fillet.Shape();
}

/** The two top-inner edges that meet at the inner corner next to the fillet. */
function topInnerCornerEdges(oc: Oc, shape: Shape) {
  const corner = [WALL, WALL, HEIGHT] as const;
  return {
    alongX: findLineEdge(oc, shape, corner, [OUTER - WALL, WALL, HEIGHT]),
    alongY: findLineEdge(oc, shape, corner, [WALL, OUTER - WALL, HEIGHT]),
  };
}

function isValidSolid(oc: Oc, shape: Shape) {
  return new oc.BRepCheck_Analyzer(shape, true, false).IsValid_2();
}

function chamfer(oc: Oc, shape: Shape, distance: number, edges: Edge[]) {
  const builder = new oc.BRepFilletAPI_MakeChamfer(shape);
  for (const edge of edges) builder.Add_2(distance, edge);
  builder.Build(new oc.Message_ProgressRange_1());
  const isDone = builder.IsDone();
  return {
    isDone,
    isValid: isDone ? isValidSolid(oc, builder.Shape()) : false,
  };
}

test("documents the mitre breakthrough threshold d = 6/√2 − 3", () => {
  expect(MITRE_BREAKTHROUGH_DISTANCE).toBeCloseTo(1.2426, 4);
});

test("control: below the breakthrough threshold both corner edges chamfer validly", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const frame = makeFilletedFrame(oc);
  const { alongX, alongY } = topInnerCornerEdges(oc, frame);
  expect(chamfer(oc, frame, 1.2, [alongX, alongY])).toEqual({
    isDone: true,
    isValid: true,
  });
});

test("control: at 1.5 mm each corner edge alone chamfers validly", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const frame = makeFilletedFrame(oc);
  const { alongX, alongY } = topInnerCornerEdges(oc, frame);
  expect(chamfer(oc, frame, 1.5, [alongX]), "edge along x").toEqual({
    isDone: true,
    isValid: true,
  });
  expect(chamfer(oc, frame, 1.5, [alongY]), "edge along y").toEqual({
    isDone: true,
    isValid: true,
  });
});

test("KERNEL LIMITATION: a 1.5 mm chamfer on both corner edges builds a valid solid through the r6 fillet", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const frame = makeFilletedFrame(oc);
  const { alongX, alongY } = topInnerCornerEdges(oc, frame);
  const result = chamfer(oc, frame, 1.5, [alongX, alongY]);
  expect(
    result.isDone,
    "BRepFilletAPI_MakeChamfer.IsDone() must be true: the corner mitre has to cut into the non-adjacent r6 fillet face, which Parasolid does and ChFi3d (OCCT 7.6 pin) refuses.",
  ).toBe(true);
  expect(result.isValid, "The chamfered solid must pass BRepCheck.").toBe(true);
});
