// Lane: logic (docs/testing.md).
// Seam: exported OpenCascadeKernelAdapter / ModelingService commit, projection,
// and disposal use real OCC wrappers; runtime binding patches inject cleanup failures.
import { test, expect } from "vitest";
import { readFile } from "node:fs/promises";

import type { FaceId, RevisionId } from "@/contracts/shared/ids";
import { createOccAuthoringState } from "@/domain/modeling/occ/authoring-state";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { collectOccCleanupErrors } from "@/domain/modeling/occ/memory";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { createModelingService } from "@/domain/modeling/modeling-service";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import { EXTRUDE_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import { extractPlanarFaceData } from "@/domain/modeling/occ/planes";
import { trackNewSolidBody } from "@/domain/modeling/occ/topology";
import { SOLVER_SCHEMA_VERSION } from "@/contracts/solver/schema";

type OC = OpenCascadeInstance;
type W = { delete(): void; isDeleted?(): boolean };
type AnyFn = (...args: unknown[]) => unknown;
type Patchable = Record<string, unknown>;

async function loadOc(): Promise<OC> {
  const mod = (await import("../../../public/cadara-occ.js")) as unknown as {
    default: new (m: Record<string, unknown>) => Promise<OC>;
  };
  const wasmBinary = new Uint8Array(
    await readFile(new URL("../../../public/cadara-occ.wasm", import.meta.url)),
  );
  return new mod.default({ wasmBinary });
}

/** Minimal independent tracker: records wrappers by kind, counts deletes, arms first-delete failures. */
function makeTracker(oc: OC) {
  const module = oc as unknown as Patchable;
  const created = new Map<string, W[]>();
  const attempts = new Map<W, number>();
  const stacks = new Map<W, string>();
  const armed = new Map<string, Error[]>();
  const failing = new Map<W, Error>();
  const restorers: Array<() => void> = [];
  let on = false;
  const record = (kind: string, v: unknown) => {
    if (!on || typeof v !== "object" || v === null) return v;
    const w = v as W;
    (created.get(kind) ?? created.set(kind, []).get(kind)!).push(w);
    stacks.set(w, new Error().stack ?? "");
    const queue = armed.get(kind);
    if (queue?.length) failing.set(w, queue.shift()!);
    const native = w.delete.bind(w);
    attempts.set(w, 0);
    w.delete = () => {
      const n = (attempts.get(w) ?? 0) + 1;
      attempts.set(w, n);
      const f = failing.get(w);
      if (f && n === 1) throw f;
      native();
    };
    return w;
  };
  const patch = (owner: Patchable, name: string, wrap: (o: AnyFn) => AnyFn) => {
    const original = owner[name] as AnyFn;
    if (typeof original !== "function") throw new Error(`missing ${name}`);
    owner[name] = wrap(original);
    restorers.push(() => (owner[name] = original));
  };
  const proto = (c: string) =>
    (module[c] as { prototype: Patchable }).prototype;
  const result = (owner: Patchable, name: string, kind: string) =>
    patch(
      owner,
      name,
      (o) =>
        function (this: unknown, ...a: unknown[]) {
          return record(kind, o.apply(this, a));
        },
    );
  const ctor = (name: string, kind: string) => {
    const original = module[name] as new (...a: unknown[]) => object;
    module[name] = new Proxy(original, {
      construct: (t, a) => record(kind, Reflect.construct(t, a)) as object,
    });
    restorers.push(() => (module[name] = original));
  };
  ctor("TopLoc_Location_1", "TopLoc_Location");
  ctor("BRepAdaptor_Surface_2", "BRepAdaptor_Surface");
  ctor("BRepAdaptor_Curve_2", "BRepAdaptor_Curve");
  ctor("TopTools_IndexedMapOfShape_1", "TopTools_IndexedMapOfShape");
  const bt = module.BRep_Tool as Patchable;
  result(bt, "Triangulation", "Handle_Poly_Triangulation");
  result(bt, "PolygonOnTriangulation_1", "Handle_Poly_PolygonOnTriangulation");
  result(bt, "Polygon3D", "Handle_Poly_Polygon3D");
  result(bt, "Pnt", "gp_Pnt(vertex)");
  result(module.TopoDS as Patchable, "Face_1", "TopoDS_Face(Face_1)");
  result(
    proto("TopTools_IndexedMapOfShape"),
    "FindKey",
    "TopoDS_Shape(FindKey)",
  );
  result(proto("TopLoc_Location"), "Transformation", "gp_Trsf");
  result(proto("Poly_Triangulation"), "Node", "gp_Pnt(node)");
  result(proto("Poly_Triangulation"), "Normal_1", "gp_Dir(normal)");
  result(proto("Poly_Triangulation"), "Triangle", "Poly_Triangle");
  result(proto("gp_Pnt"), "Transformed", "gp_Pnt(transformed)");
  result(proto("gp_Dir"), "Transformed", "gp_Dir(transformed)");
  result(proto("BRepAdaptor_Surface"), "Plane", "gp_Pln");
  result(proto("gp_Pln"), "Position", "gp_Ax3");
  for (const n of ["Location", "XDirection", "YDirection", "Direction"])
    result(proto("gp_Ax3"), n, "gp_Ax3 component");
  result(proto("BRepAdaptor_Curve"), "Value", "gp_Pnt(curve)");
  result(proto("Poly_Polygon3D"), "Nodes", "TColgp_Array1OfPnt");
  result(proto("TColgp_Array1OfPnt"), "Value", "gp_Pnt(polygon)");
  const live = (w: W) => !w.isDeleted?.();
  return {
    patch,
    proto,
    async record<T>(f: () => T | Promise<T>) {
      on = true;
      try {
        return await f();
      } finally {
        on = false;
      }
    },
    arm(kind: string, e: Error) {
      (armed.get(kind) ?? armed.set(kind, []).get(kind)!).push(e);
    },
    of: (k: string) => created.get(k) ?? [],
    attempts: (w: W) => attempts.get(w) ?? 0,
    stack: (w: W) => stacks.get(w) ?? "",
    failing: () => [...failing.keys()],
    liveByKind() {
      return Object.fromEntries(
        [...created]
          .map(([k, ws]) => [k, ws.filter(live).length])
          .filter(([, n]) => (n as number) > 0),
      );
    },
    created() {
      return Object.fromEntries([...created].map(([k, ws]) => [k, ws.length]));
    },
    siblingsNotOnce() {
      const f = new Set(failing.keys());
      return [...created.values()]
        .flat()
        .filter((w) => !f.has(w) && (attempts.get(w) !== 1 || live(w))).length;
    },
    clear() {
      created.clear();
      attempts.clear();
      armed.clear();
      failing.clear();
      stacks.clear();
    },
    leftovers() {
      failing.clear();
      for (const ws of created.values())
        for (const w of ws) if (live(w)) w.delete();
    },
    restore() {
      for (const r of restorers.reverse()) r();
      restorers.length = 0;
    },
  };
}

const req = {
  contractVersion: "modeling-contract/v1alpha1",
  documentId: "doc_workspace",
} as const;

async function adapterWithExtrudedBody(oc: OC) {
  const createSolver = (revisionId: RevisionId | null) =>
    new SketchConstraintSolverAdapter({ revisionId });
  const adapter = new OpenCascadeKernelAdapter({
    solverAdapter: createSolver(null),
    solverAdapterFactory: createSolver,
    getOpenCascadeInstance: async () => oc,
  });
  const seed = await new MockKernelAdapter().getDocumentSnapshot(req);
  const src = seed.snapshot.document.sketches[0]!;
  const empty = await adapter.getDocumentSnapshot(req);
  const committed = await adapter.commitSketch({
    ...req,
    baseRevisionId: empty.snapshot.document.revisionId,
    solverCorrelation: {
      requestId: "request_rv",
      projectionRequestId: "request_rv:project",
      validationRequestId: "request_rv:validate",
      solveRequestId: "request_rv:solve",
      regionRequestId: "request_rv:regions",
    },
    sketchId: src.sketchId,
    restoreRecordedSketchId: true,
    sketchLabel: src.label,
    plane: src.plane,
    definition: src.sketch.definition,
  });
  expect(committed.revisionState.kind).toBe("accepted");
  const after = await adapter.getDocumentSnapshot(req);
  const sketch = after.snapshot.document.sketches[0]!;
  const extruded = await adapter.createFeature({
    ...req,
    baseRevisionId: after.snapshot.document.revisionId,
    definition: {
      kind: "extrude",
      featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
      parameters: {
        resultBodyType: "solid",
        profiles: [
          {
            kind: "region",
            sketchId: sketch.sketchId,
            regionId: sketch.sketch.regions[0]!.regionId,
          },
        ],
        startExtent: { kind: "profilePlane" },
        extent: {
          mode: "oneSide",
          end: {
            kind: "blind",
            direction: "positive",
            distance: { source: "literal", value: 2 },
          },
        },
        operation: { source: "literal", value: "newBody" },
        booleanScope: { kind: "standalone" },
      },
    },
  });
  expect(extruded.revisionState.kind).toBe("accepted");
  return { adapter, src };
}

test("F1: commitSketch face-support planar-extraction cleanup failure routing", async () => {
  const oc = await loadOc();
  const { adapter, src } = await adapterWithExtrudedBody(oc);
  const state = (
    adapter as unknown as {
      runtimeState: {
        authoringState: ReturnType<typeof createOccAuthoringState>;
      };
    }
  ).runtimeState.authoringState;
  const body = state.bodies[0]!;
  let support: {
    faceId: FaceId;
    frame: ReturnType<typeof extractPlanarFaceData>["frame"];
  } | null = null;
  for (const [faceId, face] of body.facesById) {
    const x = extractPlanarFaceData(oc, face);
    x.plane.delete();
    support = { faceId: faceId as FaceId, frame: x.frame };
    break;
  }
  if (!support) throw new Error("no planar face");
  const plane = {
    support: {
      kind: "face" as const,
      bodyId: body.bodyId,
      faceId: support.faceId,
    },
    frame: support.frame,
    key: null,
  };
  const current = await adapter.getDocumentSnapshot(req);
  const commit = (id: string) =>
    adapter.commitSketch({
      ...req,
      baseRevisionId: current.snapshot.document.revisionId,
      solverCorrelation: {
        requestId: id,
        projectionRequestId: `${id}:project`,
        validationRequestId: `${id}:validate`,
        solveRequestId: `${id}:solve`,
        regionRequestId: `${id}:regions`,
      },
      sketchId: null,
      sketchLabel: "Face sketch",
      plane,
      definition: src.sketch.definition,
    } as never);

  const invalid = await adapter.commitSketch({
    ...req,
    baseRevisionId: current.snapshot.document.revisionId,
    solverCorrelation: {
      requestId: "request_rv_invalid",
      projectionRequestId: "request_rv_invalid:project",
      validationRequestId: "request_rv_invalid:validate",
      solveRequestId: "request_rv_invalid:solve",
      regionRequestId: "request_rv_invalid:regions",
    },
    sketchId: null,
    sketchLabel: "Invalid Face sketch",
    plane: {
      ...plane,
      support: { ...plane.support, faceId: "face_missing" as FaceId },
    },
    definition: src.sketch.definition,
  } as never);
  expect(invalid.revisionState.kind).toBe("rejected");
  expect(invalid.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "occ-validation-error" }),
    ]),
  );

  const tracker = makeTracker(oc);
  const service = createModelingService(adapter, {
    currentDocumentId: "doc_workspace",
  });
  let disposed = false;
  try {
    const cleanupError = new Error(
      "injected face-support adaptor release failure",
    );
    tracker.arm("BRepAdaptor_Surface", cleanupError);
    let outcome: { resolved: unknown } | { rejected: unknown };
    try {
      outcome = {
        resolved: await tracker.record(() => commit("request_rv_f1")),
      };
    } catch (error) {
      outcome = { rejected: error };
    }
    const [failed] = tracker.failing();
    expect(
      failed,
      "the armed adaptor was constructed during commitSketch",
    ).toBeDefined();
    const firstStack = tracker.stack(failed!);
    expect("rejected" in outcome).toBe(true);
    expect("rejected" in outcome ? outcome.rejected : undefined).toBeInstanceOf(
      Error,
    );
    const cleanupErrors = collectOccCleanupErrors(
      "rejected" in outcome ? outcome.rejected : undefined,
    );
    expect(cleanupErrors).toHaveLength(1);
    expect("rejected" in outcome ? outcome.rejected : undefined).toBe(
      cleanupErrors[0],
    );
    expect(cleanupErrors[0]!.errors).toContain(cleanupError);
    expect(tracker.attempts(failed!)).toBe(1);
    expect(failed!.isDeleted?.()).toBe(false);
    expect(firstStack).toContain("validateSketchPlaneSupport");
    service.dispose();
    disposed = true;
    expect(tracker.attempts(failed!)).toBe(2);
    expect(failed!.isDeleted?.()).toBe(true);
    expect(tracker.siblingsNotOnce()).toBe(0);
  } finally {
    if (!disposed) service.dispose();
    tracker.leftovers();
    tracker.restore();
  }
});

test("F1: non-planar face and cleanup failure retain both errors and retry", async () => {
  const oc = await loadOc();
  const { adapter, src } = await adapterWithExtrudedBody(oc);
  const state = (
    adapter as unknown as {
      runtimeState: {
        authoringState: ReturnType<typeof createOccAuthoringState>;
      };
    }
  ).runtimeState.authoringState;
  const maker = new oc.BRepPrimAPI_MakeCylinder_1(1, 2);
  maker.Build(new oc.Message_ProgressRange_1());
  const body = trackNewSolidBody(oc, {
    bodyId: "body_cleanup_cylinder" as never,
    label: "cleanup cylinder",
    ownerFeatureId: "feature_cleanup_cylinder" as never,
    shape: maker.Shape(),
  });
  state.bodies = [...state.bodies, body];
  maker.delete();
  let curvedFaceId: FaceId | null = null;
  for (const [faceId, face] of body.facesById) {
    try {
      extractPlanarFaceData(oc, face).plane.delete();
    } catch {
      curvedFaceId = faceId as FaceId;
      break;
    }
  }
  if (!curvedFaceId) throw new Error("Cylinder requires a curved face.");
  const current = await adapter.getDocumentSnapshot(req);
  const tracker = makeTracker(oc);
  const service = createModelingService(adapter, {
    currentDocumentId: "doc_workspace",
  });
  let disposed = false;
  try {
    const cleanupError = new Error(
      "injected non-planar adaptor release failure",
    );
    tracker.arm("BRepAdaptor_Surface", cleanupError);
    let rejected: unknown;
    try {
      await tracker.record(() =>
        adapter.commitSketch({
          ...req,
          baseRevisionId: current.snapshot.document.revisionId,
          solverCorrelation: {
            requestId: "request_rv_nonplanar",
            projectionRequestId: "request_rv_nonplanar:project",
            validationRequestId: "request_rv_nonplanar:validate",
            solveRequestId: "request_rv_nonplanar:solve",
            regionRequestId: "request_rv_nonplanar:regions",
          },
          sketchId: null,
          sketchLabel: "Non-planar sketch",
          plane: {
            support: {
              kind: "face",
              bodyId: body.bodyId,
              faceId: curvedFaceId,
            },
            frame: {
              origin: [0, 0, 0],
              xAxis: [1, 0, 0],
              yAxis: [0, 1, 0],
              normal: [0, 0, 1],
            },
            key: null,
          },
          definition: src.sketch.definition,
        } as never),
      );
    } catch (error) {
      rejected = error;
    }
    const [failed] = tracker.failing();
    expect(rejected).toBeInstanceOf(AggregateError);
    expect((rejected as AggregateError).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "Face is not planar." }),
      ]),
    );
    expect(collectOccCleanupErrors(rejected)[0]!.errors).toContain(
      cleanupError,
    );
    expect(tracker.attempts(failed!)).toBe(1);
    service.dispose();
    disposed = true;
    expect(tracker.attempts(failed!)).toBe(2);
    expect(failed!.isDeleted?.()).toBe(true);
    expect(tracker.siblingsNotOnce()).toBe(0);
  } finally {
    if (!disposed) service.dispose();
    tracker.leftovers();
    tracker.restore();
  }
});

test("F1 control: same commit without injection is accepted and leaves no live adaptor", async () => {
  const oc = await loadOc();
  const { adapter, src } = await adapterWithExtrudedBody(oc);
  const state = (
    adapter as unknown as {
      runtimeState: {
        authoringState: ReturnType<typeof createOccAuthoringState>;
      };
    }
  ).runtimeState.authoringState;
  const body = state.bodies[0]!;
  const [faceId, face] = [...body.facesById][0]!;
  const x = extractPlanarFaceData(oc, face);
  x.plane.delete();
  const current = await adapter.getDocumentSnapshot(req);
  const tracker = makeTracker(oc);
  try {
    const res = await tracker.record(() =>
      adapter.commitSketch({
        ...req,
        baseRevisionId: current.snapshot.document.revisionId,
        solverCorrelation: {
          requestId: "request_rv_ctrl",
          projectionRequestId: "request_rv_ctrl:project",
          validationRequestId: "request_rv_ctrl:validate",
          solveRequestId: "request_rv_ctrl:solve",
          regionRequestId: "request_rv_ctrl:regions",
        },
        sketchId: null,
        sketchLabel: "Face sketch",
        plane: {
          support: {
            kind: "face",
            bodyId: body.bodyId,
            faceId: faceId as FaceId,
          },
          frame: x.frame,
          key: null,
        },
        definition: src.sketch.definition,
      } as never),
    );
    expect(res.revisionState.kind).toBe("accepted");
  } finally {
    adapter.dispose();
    tracker.leftovers();
    tracker.restore();
  }
});

test("F2: service.projectSketchExternalReferences snapshot cleanup failure retention (non-serialized main-thread read)", async () => {
  const oc = await loadOc();
  const { adapter } = await adapterWithExtrudedBody(oc);
  const current = await adapter.getDocumentSnapshot(req);
  const service = createModelingService(adapter, {
    currentDocumentId: "doc_workspace",
  });
  const tracker = makeTracker(oc);
  let disposed = false;
  try {
    // F3 variant (WARM=0): arm before service initialization's own snapshot read.
    if (process.env.F2_WARM !== "0") await service.getCurrentDocumentSnapshot();
    const cleanupError = new Error(
      "injected projection-snapshot vertex point release failure",
    );
    tracker.arm("gp_Pnt(vertex)", cleanupError);
    let rejected: unknown;
    try {
      await tracker.record(() =>
        service.projectSketchExternalReferences({
          solverSchemaVersion: SOLVER_SCHEMA_VERSION,
          requestId: "request_rv_f2",
          revisionId: current.snapshot.document.revisionId,
          sketchId: current.snapshot.document.sketches[0]!.sketchId,
          plane: current.snapshot.document.sketches[0]!.plane.frame,
          tolerances: {
            coincidence: 1e-6,
            angleRadians: 1e-9,
            minimumSegmentLength: 1e-6,
          },
          references: [],
        } as never),
      );
    } catch (error) {
      rejected = error;
    }
    const [failed] = tracker.failing();
    const cleanup = collectOccCleanupErrors(rejected);
    expect(rejected).toBe(cleanup[0]);
    expect(cleanup).toHaveLength(1);
    expect(cleanup[0]!.errors).toContain(cleanupError);
    expect(failed).toBeDefined();
    expect(tracker.attempts(failed!)).toBe(1);
    expect(failed!.isDeleted?.()).toBe(false);
    expect(tracker.siblingsNotOnce()).toBe(0);
    service.dispose();
    disposed = true;
    expect(tracker.attempts(failed!)).toBe(2);
    expect(failed!.isDeleted?.()).toBe(true);
    expect(tracker.siblingsNotOnce()).toBe(0);
  } finally {
    if (!disposed) service.dispose();
    tracker.leftovers();
    tracker.restore();
  }
});
