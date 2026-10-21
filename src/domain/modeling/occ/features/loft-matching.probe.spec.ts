import { expect, test } from "vitest";

import type { DurableRef } from "@/contracts/shared/references";
import { getDefaultOpenCascadeInstance } from "@/infrastructure/occ/runtime";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import type { OpenCascadeNativeTopologyKernelHost } from "@/domain/modeling/occ/native-topology-payload";
import {
  parseNativeFeatureTransactionHistoryJson,
  parseNativeShimPayloadJson,
} from "@/domain/modeling/occ/native-topology-payload";

// cadara-z4s: pinned production-asset reproduction, not loft capability admission.
// Opposite section winding with CheckCompatibility(false) folds two faces to
// zero-width at z=5, despite BRepCheck reporting valid. The native transaction
// throws in CadaraPrepareCommittedShape -> ShapeUpgrade_UnifySameDomain::Build
// (face unification, before history). Probe-only wasm32 exception inspection
// decoded Standard_ConstructionError: "gp_Dir() - input vector has zero norm".
// The shipped Emscripten 3.1.14 build exposes no getExceptionMessage helper.
// Do not pin allocator-dependent exception pointers or bypass preparation:
// correcting winding BEFORE loft construction preserves the selected vertices.

type Shape = InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;

function expectNativeException(run: () => void) {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught, "The pinned failure must be a native C++ exception, not a JS wrapper error.").toBeTypeOf("number");
}

function subshapeId(target: DurableRef) {
  switch (target.kind) {
    case "face": return target.faceId;
    case "edge": return target.edgeId;
    case "vertex": return target.vertexId;
    default: throw new Error(`Expected subshape history, received ${target.kind}.`);
  }
}

function buildLoft(
  oc: OpenCascadeInstance,
  options: { normalizeTopWinding?: boolean; ordinary?: boolean } = {},
) {
  const builder = new oc.BRepOffsetAPI_ThruSections(true, false, 0.001);
  builder.CheckCompatibility(options.ordinary ?? false);
  const sections = options.ordinary ? [0, 5, 10] : [0, 10];
  for (const z of sections) {
    const polygon = new oc.BRepBuilderAPI_MakePolygon_1();
    // The top wire has opposite winding, as can happen with selected box faces.
    const points = z === 10 && !options.ordinary
      ? [[0, 0], [2, 0], [2, 2], [0, 2]]
      : [[0, 0], [0, 2], [2, 2], [2, 0]];
    for (const [x, y] of points) {
      const point = new oc.gp_Pnt_3(x! + (z === 5 ? 3 : 0), y!, z);
      polygon.Add_1(point);
      point.delete();
    }
    polygon.Close();
    const wire = polygon.Wire();
    const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
    const face = faceBuilder.Face();
    const outer = oc.BRepTools.OuterWire(face);

    if (options.ordinary) {
      builder.AddWire(outer);
    } else {
      // Prototype only: these XY sections have a known opposing winding.
      // A production matcher must establish winding in a common section frame.
      if (z === 10 && options.normalizeTopWinding) outer.Reverse();
      const explorer = new oc.BRepTools_WireExplorer_2(outer);
      const edges: InstanceType<OpenCascadeInstance["TopoDS_Edge"]>[] = [];
      let selectedIndex = -1;
      let selectedVertex: InstanceType<OpenCascadeInstance["TopoDS_Vertex"]> | null = null;
      while (explorer.More()) {
        const vertex = explorer.CurrentVertex();
        const point = oc.BRep_Tool.Pnt(vertex);
        if (point.X() === (z === 10 ? 2 : 0) && point.Y() === 0) {
          selectedIndex = edges.length;
          selectedVertex = vertex;
        } else {
          vertex.delete();
        }
        point.delete();
        edges.push(explorer.Current());
        explorer.Next();
      }
      expect(selectedIndex).toBeGreaterThanOrEqual(0);
      const reordered = new oc.BRepBuilderAPI_MakeWire_1();
      for (let i = 0; i < edges.length; i++) {
        reordered.Add_1(edges[(i + selectedIndex) % edges.length]!);
      }
      const result = reordered.Wire();
      const resultExplorer = new oc.BRepTools_WireExplorer_2(result);
      const firstVertex = resultExplorer.CurrentVertex();
      expect(firstVertex.IsSame(selectedVertex!)).toBe(true);
      firstVertex.delete();
      resultExplorer.delete();
      selectedVertex!.delete();
      builder.AddWire(result);
      result.delete();
      reordered.delete();
      edges.forEach(edge => edge.delete());
      explorer.delete();
    }
    outer.delete();
    face.delete();
    faceBuilder.delete();
    wire.delete();
    polygon.delete();
  }
  const progress = new oc.Message_ProgressRange_1();
  builder.Build(progress);
  expect(builder.IsDone()).toBe(true);
  const shape = builder.Shape();
  progress.delete();
  builder.delete();
  return shape;
}

function faceCenterNormalMagnitudes(oc: OpenCascadeInstance, shape: Shape) {
  const explorer = new oc.TopExp_Explorer_2(
    shape, oc.TopAbs_ShapeEnum.TopAbs_FACE as never, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
  );
  const magnitudes: number[] = [];
  while (explorer.More()) {
    const current = explorer.Current();
    const face = oc.TopoDS.Face_1(current);
    const surface = new oc.BRepAdaptor_Surface_2(face, true);
    const point = new oc.gp_Pnt_1();
    const du = new oc.gp_Vec_1();
    const dv = new oc.gp_Vec_1();
    surface.D1(
      (surface.FirstUParameter() + surface.LastUParameter()) / 2,
      (surface.FirstVParameter() + surface.LastVParameter()) / 2,
      point, du, dv,
    );
    const normal = du.Crossed(dv);
    magnitudes.push(normal.Magnitude());
    normal.delete();
    dv.delete();
    du.delete();
    point.delete();
    surface.delete();
    face.delete();
    current.delete();
    explorer.Next();
  }
  explorer.delete();
  return magnitudes;
}

function expectMatchedEdge(oc: OpenCascadeInstance, shape: Shape) {
  const explorer = new oc.TopExp_Explorer_2(
    shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE as never, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
  );
  let found = false;
  while (explorer.More()) {
    const current = explorer.Current();
    const edge = oc.TopoDS.Edge_1(current);
    const curve = new oc.BRepAdaptor_Curve_2(edge);
    const point = curve.Value((curve.FirstParameter() + curve.LastParameter()) / 2);
    found ||= Math.abs(point.X() - 1) < 1e-8 &&
      Math.abs(point.Y()) < 1e-8 && Math.abs(point.Z() - 5) < 1e-8;
    point.delete();
    curve.delete();
    edge.delete();
    current.delete();
    explorer.Next();
  }
  explorer.delete();
  expect(found, "The requested [0,0,0] -> [2,0,10] side must pass through [1,0,5].").toBe(true);
}

function withTranslatedLoft(
  oc: OpenCascadeInstance,
  shape: Shape,
  run: (transform: InstanceType<OpenCascadeInstance["gp_Trsf_1"]>, rawShape: Shape) => void,
) {
  const analyzer = new oc.BRepCheck_Analyzer(shape, true, false);
  const transform = new oc.gp_Trsf_1();
  const vector = new oc.gp_Vec_4(0, 0, 3);
  transform.SetTranslation_1(vector);
  const raw = new oc.BRepBuilderAPI_Transform_2(shape, transform, true);
  const progress = new oc.Message_ProgressRange_1();
  raw.Build(progress);
  const rawShape = raw.Shape();
  try {
    expect(analyzer.IsValid_2()).toBe(true);
    expect(raw.IsDone()).toBe(true);
    run(transform, rawShape);
  } finally {
    rawShape.delete();
    progress.delete();
    raw.delete();
    vector.delete();
    transform.delete();
    analyzer.delete();
    shape.delete();
  }
}

test("opposite-winding matched loft reaches the native face-unification failure before history", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const host = oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const shape = buildLoft(oc);
  expectMatchedEdge(oc, shape);
  expect(faceCenterNormalMagnitudes(oc, shape).filter(value => value < 1e-12)).toHaveLength(2);
  withTranslatedLoft(oc, shape, (transform, rawShape) => {
    expect(() => host.CadaraBuildNativeTopologyPayload!.BuildJson!(
      rawShape, "body_probe", "t0002", 0.001, 0.5,
    )).not.toThrow();
    const edgesOnly = new oc.ShapeUpgrade_UnifySameDomain_2(rawShape, true, false, true);
    const facesOnly = new oc.ShapeUpgrade_UnifySameDomain_2(rawShape, false, true, true);
    try {
      expect(() => edgesOnly.Build()).not.toThrow();
      expectNativeException(() => facesOnly.Build());
      expectNativeException(() => host.CadaraExecuteNativeFeatureTransaction!
        .BuildTransformCommittedShapeTransactionWithHistory!(
          shape, transform, true, "body_probe", "t0001", "t0002", 0.001, 0.5,
        ));
    } finally {
      facesOnly.delete();
      edgesOnly.delete();
    }
  });
});

test.each([false, true])("winding-normalized prototype and ordinary control retain exact transform history (ordinary=%s)", async ordinary => {
  const oc = await getDefaultOpenCascadeInstance();
  const host = oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const shape = buildLoft(oc, { normalizeTopWinding: true, ordinary });
  expect(Math.min(...faceCenterNormalMagnitudes(oc, shape))).toBeGreaterThan(1e-8);
  if (!ordinary) expectMatchedEdge(oc, shape);
  withTranslatedLoft(oc, shape, transform => {
    const source = parseNativeShimPayloadJson(
      host.CadaraBuildNativeTopologyPayload!.BuildJson!(
        shape, "body_probe", "t0001", 0.001, 0.5,
      ),
    );
    const transaction = host.CadaraExecuteNativeFeatureTransaction!
      .BuildTransformCommittedShapeTransactionWithHistory!(
        shape, transform, true, "body_probe", "t0001", "t0002", 0.001, 0.5,
      );
    try {
      expect(transaction.IsDone()).toBe(true);
      const payload = parseNativeShimPayloadJson(transaction.PayloadJson());
      expect(payload.diagnostics).toEqual([]);
      const history = parseNativeFeatureTransactionHistoryJson(transaction.HistoryJson());
      expect(history.status).toBe("available");
      expect(history.records).toHaveLength(26);
      expect(history.records.every(record =>
        record.reason === "unique-successor" && record.successors.length === 1,
      )).toBe(true);
      const sourceIds = new Set(source.topology.map(entry => entry.id));
      const finalIds = new Set(payload.topology.map(entry => entry.id));
      for (const record of history.records) {
        expect(sourceIds.has(subshapeId(record.target))).toBe(true);
        for (const successor of record.successors) {
          expect(finalIds.has(subshapeId(successor))).toBe(true);
        }
      }
    } finally {
      transaction.delete?.();
    }
  });
});
