import { describe, expect, test } from "vitest";

import { deriveMeasurementViewModel } from "@/domain/measure/measurement";
import { createOccAuthoringState } from "@/domain/modeling/occ/authoring-state";
import {
  packWorkspaceSnapshotRenderMeshes,
  unpackWorkspaceSnapshotRenderMeshes,
} from "@/domain/modeling/occ/mesh-transport";
import {
  getDefaultOpenCascadeInstance,
  type OpenCascadeInstance,
} from "@/domain/modeling/occ/runtime";
import { buildOccWorkspaceSnapshot } from "@/domain/modeling/occ/snapshot";
import { OCC_TESSELLATION_TIERS } from "@/domain/modeling/occ/tessellation";
import { trackNewSolidBody } from "@/domain/modeling/occ/topology";

// Logic lane (seam: `deriveMeasurementViewModel` on the product's own body
// meshes: an OCC solid tracked as a body, the snapshot's face meshes at the
// fine tier, through the worker's Float32 mesh transport). T17h review R-2
// and A-1: the mesher emits zero-area triangles at poles, apexes and fillet
// corners (two coincident corners), which the T17h closed-shell check first
// counted as an extra use of their edge (no Volume row for a sphere, cone or
// filleted box); and the kernel winds every face outward, so an inner void
// subtracts. Red before the review fixes: no Volume row for the first three,
// 1216 mm³ for the hollow box.

type Oc = OpenCascadeInstance;
type Shape = InstanceType<Oc["TopoDS_Shape"]>;

/**
 * The fine tier's mesh segments span at most φ (its angular deflection), so
 * an inscribed mesh is short of each curved direction's extent by at most
 * the fraction 1 − sin φ/φ: at most 2 (1 − sin φ/φ) of a doubly curved
 * body's volume. Plus the readout's rounding to 0.01 mm³.
 */
const FINE_ANGLE = OCC_TESSELLATION_TIERS.fine.angularDeflectionRadians;
const tessellationBound = (volume: number) =>
  2 * (1 - Math.sin(FINE_ANGLE) / FINE_ANGLE) * volume + 0.005;

function exactVolume(oc: Oc, shape: Shape) {
  const properties = new oc.GProp_GProps_1();
  oc.BRepGProp.VolumeProperties_1(shape, properties, false, false, false);
  return properties.Mass();
}

function measuredVolume(oc: Oc, shape: Shape) {
  const body = trackNewSolidBody(oc, {
    bodyId: "body_measured",
    label: "Measured body",
    ownerFeatureId: null,
    shape,
  });
  const snapshot = unpackWorkspaceSnapshotRenderMeshes(
    packWorkspaceSnapshotRenderMeshes(
      buildOccWorkspaceSnapshot(
        createOccAuthoringState(oc, { bodies: [body] }),
        [],
        { lodTierId: "fine" },
      ),
    ).snapshot,
  );
  const value = deriveMeasurementViewModel({
    activeToolId: "measure",
    selection: [{ kind: "body", bodyId: "body_measured" }],
    snapshot,
  })?.rows.find((row) => row.label === "Volume")?.value;
  return value === undefined ? null : Number(value.replace(" mm³", ""));
}

const box = (oc: Oc, at: number, size: number) =>
  new oc.BRepPrimAPI_MakeBox_3(
    new oc.gp_Pnt_3(at, at, at),
    size,
    size,
    size,
  ).Shape();

function filletAllEdges(oc: Oc, shape: Shape, radius: number) {
  const fillet = new oc.BRepFilletAPI_MakeFillet(
    shape,
    oc.ChFi3d_FilletShape.ChFi3d_Rational as never,
  );
  const edges = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
  );
  for (; edges.More(); edges.Next())
    fillet.Add_2(radius, oc.TopoDS.Edge_1(edges.Current()));
  fillet.Build(new oc.Message_ProgressRange_1());
  return fillet.Shape();
}

describe("T17h review: Measure Volume of real kernel bodies", () => {
  test("a sphere, an apex cone and an all-edges filleted box (degenerate mesh triangles) keep their Volume within the tessellation bound", async () => {
    const oc = await getDefaultOpenCascadeInstance();
    const cases: [string, Shape][] = [
      ["sphere r4", new oc.BRepPrimAPI_MakeSphere_1(4).Shape()],
      ["cone r3, apex, h5", new oc.BRepPrimAPI_MakeCone_1(3, 0, 5).Shape()],
      [
        "box 10×8×6, all edges filleted r1",
        filletAllEdges(oc, new oc.BRepPrimAPI_MakeBox_2(10, 8, 6).Shape(), 1),
      ],
    ];
    for (const [name, shape] of cases) {
      const exact = exactVolume(oc, shape);
      const measured = measuredVolume(oc, shape);
      expect(measured, `${name}: a Volume row`).not.toBeNull();
      expect(
        Math.abs(measured! - exact),
        `${name}: ${measured} vs exact ${exact}`,
      ).toBeLessThanOrEqual(tessellationBound(exact));
    }
  }, 120_000);

  test("a hollow box (an inner void shell) measures its material only: 784 mm³", async () => {
    const oc = await getDefaultOpenCascadeInstance();
    const cut = new oc.BRepAlgoAPI_Cut_3(
      box(oc, 0, 10),
      box(oc, 2, 6),
      new oc.Message_ProgressRange_1(),
    );
    cut.Build(new oc.Message_ProgressRange_1());
    const shape = cut.Shape();
    expect(exactVolume(oc, shape), "premise").toBeCloseTo(784, 6);
    expect(measuredVolume(oc, shape)).toBe(784);
  }, 120_000);
});
