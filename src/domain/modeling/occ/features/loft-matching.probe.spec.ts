import { expect, test, onTestFinished } from "vitest";

import type { DurableRef } from "@/contracts/shared/references";
import { getDefaultOpenCascadeInstance } from "@/infrastructure/occ/runtime";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import type { OpenCascadeNativeTopologyKernelHost } from "@/domain/modeling/occ/native-topology-payload";
import {
  parseNativeFeatureTransactionHistoryJson,
  parseNativeShimPayloadJson,
} from "@/domain/modeling/occ/native-topology-payload";
import { executeLoftFeature } from "@/domain/modeling/occ/features/loft";
import { createOccAuthoringState, rebuildOccAuthoringState } from "@/domain/modeling/occ/authoring-state";
import { trackNewSolidBody, resolveOccReference } from "@/domain/modeling/occ/topology";
import { releaseOccAuthoringStateObjects } from "@/domain/modeling/occ/memory";
import { withOccTemporaries } from "@/domain/modeling/occ/exact-edges";
import { getShapeVertexPoints } from "@/domain/modeling/occ/features/extrude";
import { add, scale, dot, subtract, cross, normalize, toGpPnt, toGpVec, type Vec3, toGpDir } from "@/domain/modeling/occ/geometry";
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION, type AdvancedSolidFeatureDefinition } from "@/contracts/modeling/advanced-solid";
import { executeOccFeature } from "@/domain/modeling/occ/features";
import { resolveFeatureDefinitionValues } from "@/domain/modeling/feature-value-expressions";
import { extractPlanarFaceData } from "@/domain/modeling/occ/planes";

// cadara-z4s: pinned production-asset failure; cadara-mpn qualifies the bounded
// production matcher below. This is not blanket semantic capability admission.
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

function expectMatchedEdge(oc: OpenCascadeInstance, shape: Shape, expected: Vec3 = [1, 0, 5]) {
  const explorer = new oc.TopExp_Explorer_2(
    shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE as never, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
  );
  let found = false;
  while (explorer.More()) {
    const current = explorer.Current();
    const edge = oc.TopoDS.Edge_1(current);
    const curve = new oc.BRepAdaptor_Curve_2(edge);
    const point = curve.Value((curve.FirstParameter() + curve.LastParameter()) / 2);
    found ||= Math.abs(point.X() - expected[0]) < 1e-8 &&
      Math.abs(point.Y() - expected[1]) < 1e-8 && Math.abs(point.Z() - expected[2]) < 1e-8;
    point.delete();
    curve.delete();
    edge.delete();
    current.delete();
    explorer.Next();
  }
  explorer.delete();
  expect(found, `The requested paired side must pass through ${JSON.stringify(expected)}.`).toBe(true);
}

async function productionFixture(options: { opposite?: boolean; sameFaceOrientation?: boolean; reversedNormal?: boolean; normal?: Vec3; upperPoints?: number[][] } = {}) {
  const oc = await getDefaultOpenCascadeInstance();
  const normal = normalize(options.normal ?? [0, 0, 1]);
  const xAxis = normalize(cross(Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], normal));
  const yAxis = cross(normal, xAxis);
  const world = (x: number, y: number, z: number) => add(add(scale(xAxis, x), scale(yAxis, y)), scale(normal, z));
  const makeSectionBody = (top: boolean) => withOccTemporaries(own => {
    const polygon = own(new oc.BRepBuilderAPI_MakePolygon_1());
    const points = top && options.upperPoints ? options.upperPoints : top && options.opposite ? [[0, 0], [2, 0], [2, 2], [0, 2]] : [[0, 0], [0, 2], [2, 2], [2, 0]];
    for (const [x, y] of points) polygon.Add_1(own(toGpPnt(oc, world(x!, y!, top ? 10 : 0))));
    polygon.Close();
    const wire = own(polygon.Wire());
    const faceBuilder = top && options.reversedNormal
      ? own(new oc.BRepBuilderAPI_MakeFace_16(own(new oc.gp_Pln_3(own(toGpPnt(oc, world(0, 0, 10))), own(toGpDir(oc, scale(normal, -1))))), wire, true))
      : own(new oc.BRepBuilderAPI_MakeFace_15(wire, true));
    const face = own(faceBuilder.Face());
    const prism = own(new oc.BRepPrimAPI_MakePrism_1(face, own(toGpVec(oc, scale(normal, top && !options.sameFaceOrientation ? 1 : -1))), false, true));
    return trackNewSolidBody(oc, {
      bodyId: top ? "body_match_upper" : "body_match_lower", label: "Section", ownerFeatureId: null, shape: prism.Shape(),
    });
  });
  const lower = makeSectionBody(false), upper = makeSectionBody(true);
  const context = createOccAuthoringState(oc, { bodies: [lower, upper] });
  const ownedStates = [context];
  onTestFinished(() => releaseOccAuthoringStateObjects({ ...context, bodies: ownedStates.flatMap(state => state.bodies) }));
  const faceAt = (body: typeof lower, z: number) => [...body.facesById].find(([, face]) => getShapeVertexPoints(oc, face).every(p => Math.abs(dot(p, normal) - z) < 1e-8))![0];
  const vertexAt = (body: typeof lower, target: Vec3) => [...body.verticesById].find(([, vertex]) => withOccTemporaries(own => {
    const p = own(oc.BRep_Tool.Pnt(vertex));
    return Math.hypot(...subtract([p.X(), p.Y(), p.Z()], target)) < 1e-8;
  }))![0];
  const definition: AdvancedSolidFeatureDefinition & { kind: "loft" } = {
    kind: "loft", featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: { participants: [{ role: "profile", targets: [
      { kind: "face", bodyId: lower.bodyId, faceId: faceAt(lower, 0) },
      { kind: "face", bodyId: upper.bodyId, faceId: faceAt(upper, 10) },
    ] }], options: { matchConnections: [{
      from: { kind: "vertex", bodyId: lower.bodyId, vertexId: vertexAt(lower, world(0, 0, 0)) },
      to: { kind: "vertex", bodyId: upper.bodyId, vertexId: vertexAt(upper, world(2, 0, 10)) },
    }] } },
  };
  const build = (value = definition) => {
    const result = executeLoftFeature(context, "feature_match", value);
    ownedStates.push({ ...context, bodies: result.bodies });
    const body = result.bodies.find(body => body.ownerFeatureId === "feature_match")!;
    return { result, body };
  };
  const windings = definition.parameters.participants[0]!.targets.map(target => withOccTemporaries(own => {
    if (target.kind !== "face") throw new Error("Expected face section.");
    const face = (target.bodyId === lower.bodyId ? lower : upper).facesById.get(target.faceId)!;
    const explorer = own(new oc.BRepTools_WireExplorer_2(own(oc.BRepTools.OuterWire(face))));
    const points: Vec3[] = [];
    while (explorer.More()) {
      const p = own(oc.BRep_Tool.Pnt(own(explorer.CurrentVertex())));
      points.push([p.X(), p.Y(), p.Z()]);
      explorer.Next();
    }
    return Math.sign(points.reduce((area, p, i) => area + dot(cross(p, points[(i + 1) % points.length]!), normal), 0));
  }));
  return { oc, context, definition, build, world, lower, upper, vertexAt, ownedStates, windings };
}

test.each([
  { opposite: false }, { opposite: true }, { opposite: true, reversedNormal: true },
  { opposite: true, normal: [1, 0, 0] as Vec3 },
  { opposite: true, reversedNormal: true, normal: [1, 2, 3] as Vec3 },
  { sameFaceOrientation: true },
  { sameFaceOrientation: true, normal: [1, 2, 3] as Vec3 },
])("production matcher preserves the selected pair without singular sides: %j", async options => {
  const { oc, build, world, upper, definition, windings } = await productionFixture(options);
  expect(windings[0]! * windings[1]!).toBe(options.sameFaceOrientation ? 1 : -1);
  if (options.reversedNormal) {
    const target = definition.parameters.participants[0]!.targets[1]!;
    if (target.kind !== "face") throw new Error("Expected face section.");
    const { frame, plane } = extractPlanarFaceData(oc, upper.facesById.get(target.faceId)!);
    try {
      expect(dot(frame.normal, normalize(options.normal ?? [0, 0, 1]))).toBeCloseTo(-1);
    } finally {
      plane.delete();
    }
  }
  const { result, body } = build();
  expectMatchedEdge(oc, body.shape, world(1, 0, 5));
  const samples = [...body.facesById.values()].flatMap(face => withOccTemporaries(own => {
    const surface = own(new oc.BRepAdaptor_Surface_2(face, true));
    return [0, 0.5, 1].flatMap(u => [0, 0.5, 1].map(v => {
      const p = own(new oc.gp_Pnt_1()), du = own(new oc.gp_Vec_1()), dv = own(new oc.gp_Vec_1());
      surface.D1(surface.FirstUParameter() + u * (surface.LastUParameter() - surface.FirstUParameter()), surface.FirstVParameter() + v * (surface.LastVParameter() - surface.FirstVParameter()), p, du, dv);
      return { point: [p.X(), p.Y(), p.Z()] as Vec3, du: du.Magnitude(), normal: own(du.Crossed(dv)).Magnitude() };
    }));
  }));
  for (const sample of samples) {
    expect(sample.du).toBeGreaterThan(1e-8);
    expect(sample.normal).toBeGreaterThan(1e-8);
  }
  for (const formerFold of [world(1, 0, 5), world(1, 2, 5)]) {
    expect(samples.some(sample => Math.hypot(...subtract(sample.point, formerFold)) < 1e-8)).toBe(true);
  }
  const stage = result.topologyStage!.outputs.get(body.bodyId)!;
  expect(stage.sourceTargets.size).toBe(26);
  expect(new Set([...stage.sourceTargets.values()].flat().map(subshapeId)).size).toBe(26);
});

function expectCompleteNativeHistory(oc: OpenCascadeInstance, shape: Shape, transform: InstanceType<OpenCascadeInstance["gp_Trsf_1"]>) {
  const host = oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const source = parseNativeShimPayloadJson(host.CadaraBuildNativeTopologyPayload!.BuildJson!(shape, "body_probe", "t0001", 0.001, 0.5));
  const transaction = host.CadaraExecuteNativeFeatureTransaction!.BuildTransformCommittedShapeTransactionWithHistory!(shape, transform, true, "body_probe", "t0001", "t0002", 0.001, 0.5);
  try {
    expect(transaction.IsDone()).toBe(true);
    const final = parseNativeShimPayloadJson(transaction.PayloadJson());
    expect(final.diagnostics).toEqual([]);
    const history = parseNativeFeatureTransactionHistoryJson(transaction.HistoryJson());
    expect(history.status).toBe("available");
    expect(history.records).toHaveLength(26);
    const sourceIds = new Set(source.topology.map(entry => entry.id));
    const finalIds = new Set(final.topology.map(entry => entry.id));
    expect(new Set(history.records.map(record => subshapeId(record.target)))).toEqual(sourceIds);
    expect(new Set(history.records.flatMap(record => record.successors.map(subshapeId)))).toEqual(finalIds);
    for (const record of history.records) {
      expect(record.reason).toBe("unique-successor");
      expect(record.successors).toHaveLength(1);
      expect(sourceIds.has(subshapeId(record.target))).toBe(true);
      expect(finalIds.has(subshapeId(record.successors[0]!))).toBe(true);
    }
  } finally {
    transaction.delete?.();
  }
}

test("production matched loft qualifies native translation and mirror without bypassing preparation", async () => {
  const { oc, build } = await productionFixture({ opposite: true });
  const { body } = build();
  withOccTemporaries(own => {
    const transform = own(new oc.gp_Trsf_1());
    transform.SetTranslation_1(own(toGpVec(oc, [0, 0, 3])));
    expectCompleteNativeHistory(oc, body.shape, transform);
    transform.SetMirror_3(own(new oc.gp_Ax2_3(own(toGpPnt(oc, [0, 0, 0])), own(new oc.gp_Dir_4(1, 0, 0)))));
    expectCompleteNativeHistory(oc, body.shape, transform);
  });
});

test.each([false, true])("production ordinary/path controls retain complete native transform and mirror history (path=%s)", async path => {
  const { oc, definition, build, lower } = await productionFixture();
  const pathEdge = [...lower.edgesById].find(([, edge]) => withOccTemporaries(own => {
    const curve = own(new oc.BRepAdaptor_Curve_2(edge));
    const start = own(curve.Value(curve.FirstParameter())), end = own(curve.Value(curve.LastParameter()));
    return Math.abs(end.Z() - start.Z()) > 0.9;
  }))![0];
  const { body } = build({ ...definition, parameters: { ...definition.parameters,
    participants: path ? [...definition.parameters.participants, { role: "path", targets: [{ kind: "edge", bodyId: lower.bodyId, edgeId: pathEdge }] }] : definition.parameters.participants,
    options: path ? { path: { sectionCount: 3 } } : {},
  } });
  withOccTemporaries(own => {
    const transform = own(new oc.gp_Trsf_1());
    transform.SetTranslation_1(own(toGpVec(oc, [0, 0, 3])));
    expectCompleteNativeHistory(oc, body.shape, transform);
    transform.SetMirror_3(own(new oc.gp_Ax2_3(own(toGpPnt(oc, [0, 0, 0])), own(toGpDir(oc, [1, 0, 0])))));
    expectCompleteNativeHistory(oc, body.shape, transform);
  });
});

test("matched loft rebuilds preserve source references and expose the existing mirror-copy lineage limit", async () => {
  const { oc, context, definition, ownedStates, upper, world, vertexAt } = await productionFixture({ opposite: true });
  let state = rebuildOccAuthoringState(context, [{ featureId: "feature_match", definition, suppressed: false }]);
  ownedStates.push(state);
  expect(state.diagnostics).toEqual([]);
  const first = state.bodies.find(body => body.ownerFeatureId === "feature_match")!;
  const refs: DurableRef[] = [
    ...[...first.facesById.keys()].map(faceId => ({ kind: "face" as const, bodyId: first.bodyId, faceId })),
    ...[...first.edgesById.keys()].map(edgeId => ({ kind: "edge" as const, bodyId: first.bodyId, edgeId })),
    ...[...first.verticesById.keys()].map(vertexId => ({ kind: "vertex" as const, bodyId: first.bodyId, vertexId })),
  ];
  const transform: AdvancedSolidFeatureDefinition & { kind: "transform" } = {
    kind: "transform", featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: { participants: [
      { role: "body", targets: [{ kind: "body", bodyId: first.bodyId }] },
      { role: "transformReference", targets: [{ kind: "construction", constructionId: "construction_plane-xy" }] },
    ], options: { distance: 3 } },
  };
  const mirror: AdvancedSolidFeatureDefinition & { kind: "mirror" } = {
    kind: "mirror", featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: { participants: [
      { role: "body", targets: [{ kind: "body", bodyId: first.bodyId }] },
      { role: "plane", targets: [{ kind: "construction", constructionId: "construction_plane-yz" }] },
    ], options: { copy: true } },
  };
  const pair = definition.parameters.options!.matchConnections as { from: VertexRef; to: VertexRef }[];
  let mirrorRefs: DurableRef[] = [];
  for (const to of [pair[0]!.to, { kind: "vertex" as const, bodyId: upper.bodyId, vertexId: vertexAt(upper, world(0, 2, 10)) }]) {
    const updated = { ...definition, parameters: { ...definition.parameters, options: { matchConnections: [{ from: pair[0]!.from, to }] } } };
    state = rebuildOccAuthoringState(state, [
      { featureId: "feature_match", definition: updated, suppressed: false },
      { featureId: "feature_match_move", definition: transform, suppressed: false },
      { featureId: "feature_match_mirror", definition: mirror, suppressed: false },
    ]);
    ownedStates.push(state);
    expect(state.diagnostics).toEqual([]);
    for (const ref of refs) {
      const resolved = resolveOccReference(state, ref);
      expect(resolved.diagnostics, JSON.stringify(ref)).toEqual([]);
      expect(resolved.resolution.invalidation).toBeNull();
    }
    const moved = state.bodies.find(body => body.bodyId === first.bodyId)!;
    expectMatchedEdge(oc, moved.shape, add(scale(add(world(0, 0, 0), to === pair[0]!.to ? world(2, 0, 10) : world(0, 2, 10)), 0.5), [0, 0, 3]));
    const mirrored = state.bodies.find(body => body.ownerFeatureId === "feature_match_mirror")!;
    expect(mirrored).toBeDefined();
    // Mirror copy deliberately has an unsupported producer stage today
    // (cadara-dd3.177). Do not confuse complete native transform history with
    // stable copy-output lineage, or use this test to claim full admission.
    for (const ref of mirrorRefs) {
      expect(resolveOccReference(state, ref).resolution.invalidation?.reason).toBe("occ-topology-unsupported-history");
    }
    mirrorRefs = [
      ...[...mirrored.facesById.keys()].map(faceId => ({ kind: "face" as const, bodyId: mirrored.bodyId, faceId })),
      ...[...mirrored.edgesById.keys()].map(edgeId => ({ kind: "edge" as const, bodyId: mirrored.bodyId, edgeId })),
      ...[...mirrored.verticesById.keys()].map(vertexId => ({ kind: "vertex" as const, bodyId: mirrored.bodyId, vertexId })),
    ];
    expect(Math.min(...faceCenterNormalMagnitudes(oc, mirrored.shape))).toBeGreaterThan(1e-8);
    // Consume old cap-face and boundary-edge references, not fresh selections.
    const faceReference = refs.find(ref => ref.kind === "face" && getShapeVertexPoints(oc, moved.facesById.get(ref.faceId)!).every(p => Math.abs(p[2] - 3) < 1e-8))!;
    const edgeReference = refs.find(ref => ref.kind === "edge" && getShapeVertexPoints(oc, moved.edgesById.get(ref.edgeId)!).every(p => Math.abs(p[2] - 3) < 1e-8))!;
    for (const reference of [faceReference, edgeReference]) {
      const resolved = resolveFeatureDefinitionValues({ definition: { ...transform, parameters: { ...transform.parameters, participants: [
        { role: "body", targets: [{ kind: "body", bodyId: mirrored.bodyId }] }, { role: reference.kind === "edge" ? "axis" : "transformReference", targets: [reference] },
      ], options: reference.kind === "edge" ? { transformType: "rotation", angle: 15 } : { distance: 3 } } }, variables: [] });
      if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics));
      const downstream = executeOccFeature(state, "feature_match_old_reference", resolved.definition);
      ownedStates.push({ ...state, bodies: downstream.bodies });
      expect(downstream.producedTargets).toHaveLength(1);
    }
  }
});

type VertexRef = Extract<DurableRef, { kind: "vertex" }>;

test("matching refuses collapse, extra pairs, edge pairs and off-boundary identity without mutating the source", async () => {
  const { oc, definition, build, context, upper, lower, world, vertexAt } = await productionFixture({ opposite: true });
  const before = context.bodies;
  const pair = definition.parameters.options!.matchConnections as { from: VertexRef; to: VertexRef }[];
  const options = (matchConnections: unknown) => ({ ...definition, parameters: { ...definition.parameters, options: { matchConnections } } });
  expect(() => build(options([{ from: pair[0]!.from, to: { ...pair[0]!.to, vertexId: vertexAt(upper, world(2, 2, 10)) } }]))).toThrow("degenerate, non-convex or self-intersecting correspondence");
  expect(() => build(options([...pair, ...pair]))).toThrow("one vertex connection across exactly two");
  expect(() => build({ ...definition, parameters: { ...definition.parameters, participants: [{ role: "profile", targets: [...definition.parameters.participants[0]!.targets, ...definition.parameters.participants[0]!.targets] }] } })).toThrow("exactly two");
  expect(() => build({ ...definition, parameters: { ...definition.parameters, participants: [...definition.parameters.participants, { role: "path", targets: [{ kind: "edge", bodyId: lower.bodyId, edgeId: lower.topology.edgeIds[0]! }] }] } })).toThrow("cannot be combined with a path");
  expect(() => build(options([{ from: { kind: "edge", bodyId: lower.bodyId, edgeId: lower.topology.edgeIds[0]! }, to: { kind: "edge", bodyId: upper.bodyId, edgeId: upper.topology.edgeIds[0]! } }]))).toThrow("edge pairing");
  expect(() => build(options([{ from: pair[0]!.from, to: { ...pair[0]!.to, vertexId: vertexAt(upper, world(2, 0, 11)) } }]))).toThrow("not an exact vertex");
  withOccTemporaries(own => {
    const builder = own(new oc.BRepBuilderAPI_MakeVertex(own(toGpPnt(oc, world(2, 0, 10)))));
    upper.verticesById.set("vertex_detached_same_coordinates", own(builder.Vertex()));
    try {
      expect(() => build(options([{ from: pair[0]!.from, to: { ...pair[0]!.to, vertexId: "vertex_detached_same_coordinates" } }]))).toThrow("not an exact vertex");
    } finally {
      upper.verticesById.delete("vertex_detached_same_coordinates");
    }
  });
  expect(context.bodies).toBe(before);
  expectMatchedEdge(oc, build().body.shape, world(1, 0, 5));
});

test("matching refuses nonparallel/coincident frames and ambiguous winding at modeling tolerance", async () => {
  const { oc, context, definition, build, upper, lower, vertexAt, world } = await productionFixture();
  const side = [...upper.facesById].find(([, face]) => {
    const points = getShapeVertexPoints(oc, face);
    return points.some(p => p[2] < 10.5) && points.some(p => p[2] > 10.5);
  })![0];
  expect(() => build({ ...definition, parameters: { ...definition.parameters, participants: [{ role: "profile", targets: [
    definition.parameters.participants[0]!.targets[0]!, { kind: "face", bodyId: upper.bodyId, faceId: side },
  ] }] } })).toThrow("parallel section planes");
  const pair = definition.parameters.options!.matchConnections as { from: VertexRef; to: VertexRef }[];
  expect(() => build({ ...definition, parameters: { ...definition.parameters, participants: [{ role: "profile", targets: [
    definition.parameters.participants[0]!.targets[0]!, definition.parameters.participants[0]!.targets[0]!,
  ] }], options: { matchConnections: [{ from: pair[0]!.from, to: { kind: "vertex", bodyId: lower.bodyId, vertexId: vertexAt(lower, world(2, 0, 0)) } }] } } })).toThrow("separated section planes");
  expect(() => executeLoftFeature({ ...context, modelingTolerance: 3 }, "feature_ambiguous", definition)).toThrow("ambiguous or degenerate winding");
});

test.each([
  { points: [[0, 0], [0, 2], [2, 2], [3, 1], [2, 0]], diagnostic: "equal edge counts" },
  { points: [[0, 0], [0, 2], [0.5, 0.5], [2, 0]], diagnostic: "non-convex or self-intersecting" },
])("matching refuses unqualified polygon boundaries: $diagnostic", async ({ points, diagnostic }) => {
  const { build } = await productionFixture({ upperPoints: points });
  expect(() => build()).toThrow(diagnostic);
});

test("matching refuses curved section edges instead of treating their chords as certified boundaries", async () => {
  const { oc, context, definition, ownedStates } = await productionFixture();
  const cylinder = withOccTemporaries(own => {
    const builder = own(new oc.BRepPrimAPI_MakeCylinder_1(2, 10));
    return trackNewSolidBody(oc, { bodyId: "body_curved_section", label: "Cylinder", ownerFeatureId: null, shape: builder.Shape() });
  });
  const faceId = [...cylinder.facesById].find(([, face]) => getShapeVertexPoints(oc, face).every(point => Math.abs(point[2] - 10) < 1e-8))![0];
  const vertexId = [...cylinder.verticesById].find(([, vertex]) => withOccTemporaries(own => Math.abs(own(oc.BRep_Tool.Pnt(vertex)).Z() - 10) < 1e-8))![0];
  const next = { ...context, bodies: [...context.bodies, cylinder] };
  ownedStates.push(next);
  const pair = definition.parameters.options!.matchConnections as { from: VertexRef; to: VertexRef }[];
  expect(() => executeLoftFeature(next, "feature_curved_match", { ...definition, parameters: { ...definition.parameters,
    participants: [{ role: "profile", targets: [definition.parameters.participants[0]!.targets[0]!, { kind: "face", bodyId: cylinder.bodyId, faceId }] }],
    options: { matchConnections: [{ from: pair[0]!.from, to: { kind: "vertex", bodyId: cylinder.bodyId, vertexId } }] },
  } })).toThrow("straight-edged boundaries");
});

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
