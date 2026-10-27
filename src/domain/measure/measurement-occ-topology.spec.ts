import { describe, expect, test } from "vitest";

import type {
  MeasureTopologyResponse,
  TopologyMeasure,
} from "@/contracts/modeling/topology-measure";
import type { BodyId } from "@/contracts/shared/ids";
import { deriveMeasurementViewModel } from "@/core/measure/measurement";
import { createOccAuthoringState } from "@/domain/modeling/occ/authoring-state";
import { type OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { buildOccWorkspaceSnapshot } from "@/domain/modeling/occ/snapshot";
import {
  trackNewSolidBody,
  type OccTrackedBody,
} from "@/domain/modeling/occ/topology";
import { measureOccTopology } from "@/domain/modeling/occ/topology-measure";
import { getDefaultOpenCascadeInstance } from "@/infrastructure/occ/runtime";

// Logic lane (cadara-h026.5). Seam: `measureOccTopology` on bodies built by
// the production kernel (public/cadara-occ, so a binding the shipped ABI
// lacks fails here), then `deriveMeasurementViewModel` given those measures.
// Exact values are checked against closed forms and against an independent
// BRepGProp run on the same kernel shapes, within 1e-6.

type Oc = OpenCascadeInstance;
type Shape = InstanceType<Oc["TopoDS_Shape"]>;
const TOLERANCE = 1e-6;

function track(oc: Oc, bodyId: string, shape: Shape) {
  return trackNewSolidBody(oc, {
    bodyId: bodyId as BodyId,
    label: "Wheel",
    ownerFeatureId: null,
    shape,
  });
}

function measureAll(oc: Oc, body: OccTrackedBody) {
  return measureOccTopology(
    oc,
    [body],
    [
      { kind: "body", bodyId: body.bodyId },
      ...[...body.facesById.keys()].map((faceId) => ({
        kind: "face" as const,
        bodyId: body.bodyId,
        faceId,
      })),
      ...[...body.edgesById.keys()].map((edgeId) => ({
        kind: "edge" as const,
        bodyId: body.bodyId,
        edgeId,
      })),
    ],
  );
}

const faces = (measures: readonly TopologyMeasure[]) =>
  measures.flatMap((measure) => ("surface" in measure ? [measure] : []));
const edges = (measures: readonly TopologyMeasure[]) =>
  measures.flatMap((measure) => ("curve" in measure ? [measure] : []));

function gpropMass(oc: Oc, shape: Shape, kind: "length" | "area" | "volume") {
  const properties = new oc.GProp_GProps_1();
  if (kind === "length")
    oc.BRepGProp.LinearProperties(shape, properties, true, false);
  else if (kind === "area")
    oc.BRepGProp.SurfaceProperties_1(shape, properties, false, false);
  else oc.BRepGProp.VolumeProperties_1(shape, properties, false, false, false);
  const mass = properties.Mass();
  properties.delete();
  return mass;
}

function centroidZ(oc: Oc, shape: Shape) {
  const properties = new oc.GProp_GProps_1();
  oc.BRepGProp.SurfaceProperties_1(shape, properties, false, false);
  const centre = properties.CentreOfMass();
  const z = centre.Z();
  centre.delete();
  properties.delete();
  return z;
}

function revolve(oc: Oc, kind: "torus" | "cone") {
  const origin = new oc.gp_Pnt_3(0, 0, 0);
  const axis = new oc.gp_Ax1_2(origin, new oc.gp_Dir_4(0, 0, 1));
  const wire = new oc.BRepBuilderAPI_MakeWire_1();
  if (kind === "torus") {
    // A circle of radius 1 centred 4 from the axis, in the XZ plane.
    wire.Add_1(
      new oc.BRepBuilderAPI_MakeEdge_8(
        new oc.gp_Circ_2(
          new oc.gp_Ax2_2(
            new oc.gp_Pnt_3(4, 0, 0),
            new oc.gp_Dir_4(0, 1, 0),
            new oc.gp_Dir_4(1, 0, 0),
          ),
          1,
        ),
      ).Edge(),
    );
  } else {
    // Radius 3 base, apex 5 up the axis.
    const points = [origin, new oc.gp_Pnt_3(3, 0, 0), new oc.gp_Pnt_3(0, 0, 5)];
    for (let i = 0; i < points.length; i++)
      wire.Add_1(
        new oc.BRepBuilderAPI_MakeEdge_3(
          points[i]!,
          points[(i + 1) % points.length]!,
        ).Edge(),
      );
  }
  const face = new oc.BRepBuilderAPI_MakeFace_15(wire.Wire(), true);
  const revol = new oc.BRepPrimAPI_MakeRevol_2(face.Face(), axis, false);
  revol.Build(new oc.Message_ProgressRange_1());
  return revol.Shape();
}

describe("cadara-h026.5: exact topology measures of production-kernel bodies", () => {
  test("a cylinder r3 h5: circular edges, a cylindrical and two planar faces, matching closed forms and BRepGProp", async () => {
    const oc = await getDefaultOpenCascadeInstance();
    const body = track(
      oc,
      "body_cylinder",
      new oc.BRepPrimAPI_MakeCylinder_1(3, 5).Shape(),
    );
    const measures = measureAll(oc, body);

    const cylinder = faces(measures).filter(
      (face) => face.surface.kind === "cylinder",
    );
    expect(cylinder).toHaveLength(1);
    const lateral = cylinder[0]!;
    if (lateral.surface.kind !== "cylinder") throw new Error("premise");
    expect(lateral.surface.radius).toBeCloseTo(3, 9);
    expect(lateral.surface.axis.direction.map(Math.abs)).toEqual([0, 0, 1]);
    expect(Math.abs(lateral.area - 2 * Math.PI * 3 * 5)).toBeLessThan(
      TOLERANCE,
    );
    expect(
      Math.abs(
        lateral.area -
          gpropMass(oc, body.facesById.get(lateral.target.faceId)!, "area"),
      ),
    ).toBeLessThan(TOLERANCE);

    const planes = faces(measures).filter(
      (face) => face.surface.kind === "plane",
    );
    expect(planes).toHaveLength(2);
    for (const plane of planes) {
      if (plane.surface.kind !== "plane") throw new Error("premise");
      expect(Math.abs(plane.area - Math.PI * 9)).toBeLessThan(TOLERANCE);
      expect(Math.abs(plane.surface.perimeter - 6 * Math.PI)).toBeLessThan(
        TOLERANCE,
      );
    }
    // Outward normals: the cap at z = 0 faces down, the cap at z = 5 up.
    for (const plane of planes) {
      if (plane.surface.kind !== "plane") throw new Error("premise");
      const z = centroidZ(oc, body.facesById.get(plane.target.faceId)!);
      expect(plane.surface.normal[2], `cap at z = ${z}`).toBeCloseTo(
        z > 2.5 ? 1 : -1,
        9,
      );
      expect(plane.surface.polygonal, "a circle bounds the cap").toBe(false);
    }

    const circles = edges(measures).filter(
      (edge) => edge.curve.kind === "circle",
    );
    expect(circles).toHaveLength(2);
    for (const circle of circles) {
      if (circle.curve.kind !== "circle") throw new Error("premise");
      expect(circle.curve.radius).toBeCloseTo(3, 9);
      expect(circle.curve.isFull).toBe(true);
      expect(Math.abs(circle.length - 6 * Math.PI)).toBeLessThan(TOLERANCE);
      expect(
        Math.abs(
          circle.length -
            gpropMass(oc, body.edgesById.get(circle.target.edgeId)!, "length"),
        ),
      ).toBeLessThan(TOLERANCE);
    }
    expect(
      edges(measures).filter((edge) => edge.curve.kind === "line"),
    ).toHaveLength(1);

    const whole = measures.find((measure) => "volume" in measure);
    if (!whole || !("volume" in whole)) throw new Error("premise");
    expect(Math.abs(whole.volume! - Math.PI * 9 * 5)).toBeLessThan(TOLERANCE);
    expect(
      Math.abs(whole.surfaceArea - (2 * Math.PI * 9 + 30 * Math.PI)),
    ).toBeLessThan(TOLERANCE);
  }, 60_000);

  test("a half cylinder's curved edges are arcs; a torus, a cone and a box classify their surfaces and curves", async () => {
    const oc = await getDefaultOpenCascadeInstance();
    const half = measureAll(
      oc,
      track(
        oc,
        "body_half",
        new oc.BRepPrimAPI_MakeCylinder_2(3, 5, Math.PI).Shape(),
      ),
    );
    const arcs = edges(half).filter((edge) => edge.curve.kind === "circle");
    expect(arcs).toHaveLength(2);
    for (const arc of arcs) {
      expect(arc.curve.kind === "circle" && arc.curve.isFull).toBe(false);
      expect(Math.abs(arc.length - 3 * Math.PI)).toBeLessThan(TOLERANCE);
    }

    const torus = faces(
      measureAll(oc, track(oc, "body_torus", revolve(oc, "torus"))),
    );
    expect(torus.map((face) => face.surface)).toEqual([
      expect.objectContaining({ kind: "torus" }),
    ]);
    const ring = torus[0]!.surface;
    if (ring.kind !== "torus") throw new Error("premise");
    expect(ring.majorRadius).toBeCloseTo(4, 9);
    expect(ring.minorRadius).toBeCloseTo(1, 9);
    expect(Math.abs(torus[0]!.area - 4 * Math.PI ** 2 * 4 * 1)).toBeLessThan(
      TOLERANCE,
    );

    const cone = faces(
      measureAll(oc, track(oc, "body_cone", revolve(oc, "cone"))),
    );
    const conical = cone.find((face) => face.surface.kind === "cone");
    if (conical?.surface.kind !== "cone") throw new Error("no conical face");
    expect(conical.surface.semiAngleRadians).toBeCloseTo(Math.atan(3 / 5), 9);
    expect(
      Math.abs(conical.area - Math.PI * 3 * Math.hypot(3, 5)),
    ).toBeLessThan(TOLERANCE);

    const box = measureAll(
      oc,
      track(oc, "body_box", new oc.BRepPrimAPI_MakeBox_2(4, 3, 2).Shape()),
    );
    expect(new Set(faces(box).map((face) => face.surface.kind))).toEqual(
      new Set(["plane"]),
    );
    expect(new Set(edges(box).map((edge) => edge.curve.kind))).toEqual(
      new Set(["line"]),
    );
  }, 60_000);

  test("the readout shows a circular edge's and a cylindrical face's exact values, named by their kind, and a mesh-only readout stays approximate", async () => {
    const oc = await getDefaultOpenCascadeInstance();
    const body = track(
      oc,
      "body_wheel",
      new oc.BRepPrimAPI_MakeCylinder_1(3, 5).Shape(),
    );
    const box = track(
      oc,
      "body_box",
      new oc.BRepPrimAPI_MakeBox_2(4, 3, 2).Shape(),
    );
    const snapshot = buildOccWorkspaceSnapshot(
      createOccAuthoringState(oc, { bodies: [body, box] }),
      [],
      { lodTierId: "fine" },
    );
    const measures = [...measureAll(oc, body), ...measureAll(oc, box)];
    const response: MeasureTopologyResponse = {
      contractVersion: "modeling-contract/v1alpha1",
      revisionId: snapshot.document.revisionId,
      measures,
    };
    const ofBody = (bodyId: string) =>
      measures.filter((measure) => measure.target.bodyId === bodyId);
    const circle = edges(measures).find(
      (edge) => edge.curve.kind === "circle",
    )!;
    const lateral = faces(measures).find(
      (face) => face.surface.kind === "cylinder",
    )!;
    const readout = (
      target: TopologyMeasure["target"],
      topologyMeasures: MeasureTopologyResponse | null,
    ) =>
      deriveMeasurementViewModel({
        source: "measureTool",
        selection: [target],
        snapshot,
        topologyMeasures,
      });

    const edgeReadout = readout(circle.target, response);
    expect(edgeReadout?.targetLabels).toEqual(["Circular edge · Wheel"]);
    expect(edgeReadout?.rows.map((row) => [row.label, row.value])).toEqual([
      ["Radius", "3 mm"],
      ["Diameter", "6 mm"],
      ["Circumference", "18.85 mm"],
      ["Center", expect.stringMatching(/^0, 0, (0|5) mm$/)],
    ]);

    const faceReadout = readout(lateral.target, response);
    expect(faceReadout?.targetLabels).toEqual(["Cylindrical face · Wheel"]);
    expect(faceReadout?.rows.map((row) => [row.label, row.value])).toEqual([
      ["Radius", "3 mm"],
      ["Diameter", "6 mm"],
      ["Axis", expect.stringMatching(/^0, 0, -?1$/)],
      ["Area", "94.25 mm²"],
    ]);

    // A measure of another revision is stale: mesh values, marked ≈.
    const stale = readout(lateral.target, {
      ...response,
      revisionId: "rev_stale",
    });
    expect(stale?.targetLabels).toEqual(["Face · Wheel"]);
    expect(stale?.rows.every((row) => row.value.startsWith("≈ "))).toBe(true);

    // Two circles: centre to centre is the height.
    const [bottom, top] = edges(measures).filter(
      (edge) => edge.curve.kind === "circle",
    );
    const distance = (first: TopologyMeasure, second: TopologyMeasure) =>
      deriveMeasurementViewModel({
        source: "measureTool",
        selection: [first.target, second.target],
        snapshot,
        topologyMeasures: response,
      });
    const pair = distance(bottom!, top!);
    expect(pair?.rows).toContainEqual({
      id: "center-distance",
      label: "Center Distance",
      value: "5 mm",
    });
    // Distances on render meshes are exact only between straight edges and
    // planar faces bounded by straight edges.
    const pairDistance = (first: TopologyMeasure, second: TopologyMeasure) =>
      distance(first, second)?.rows.find((row) => row.id === "distance")?.value;
    expect(pairDistance(bottom!, top!), "two circles").toMatch(/^≈ /);
    const [lowCap, highCap] = faces(ofBody("body_wheel")).filter(
      (face) => face.surface.kind === "plane",
    );
    expect(pairDistance(lowCap!, highCap!), "circle-bounded caps").toBe(
      "≈ 5 mm",
    );
    const [boxBottom, boxTop] = faces(ofBody("body_box")).filter(
      (face) =>
        face.surface.kind === "plane" && Math.abs(face.surface.normal[2]) > 0.5,
    );
    expect(pairDistance(boxBottom!, boxTop!), "box faces").toBe("2 mm");
  }, 60_000);
});
