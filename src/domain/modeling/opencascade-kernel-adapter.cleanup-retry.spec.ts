// Lane: logic (docs/testing.md).
// Seam: exported OpenCascadeKernelAdapter / ModelingService commit, projection,
// and disposal use real OCC wrappers; runtime binding patches inject cleanup failures.
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import { test, expect } from "vitest";
import { makeOccWrapperTracker } from "../../../test/helpers/occ-wrapper-tracker";
import { readFile } from "node:fs/promises";

import type { FaceId, RevisionId } from "@/contracts/shared/ids";
import { createOccAuthoringState } from "@/infrastructure/occ/authoring-state";
import type { OpenCascadeInstance } from "@/infrastructure/occ/kernel-capabilities";
import { collectOccCleanupErrors } from "@/infrastructure/occ/memory";
import { resetRegionRenderRecordCacheForTest } from "@/infrastructure/occ/snapshot";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { createModelingService } from "@/domain/modeling/modeling-service";
import { SketchConstraintSolverAdapter } from "@/application/solver/sketch-constraint-solver-adapter";
import { EXTRUDE_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import { buildConstructionPlaneFromPlanarFace, getExtrusionNormalForPlanarFace } from "@/infrastructure/occ/sketch-profile";
import { extractPlanarFaceData } from "@/infrastructure/occ/planes";
import { trackNewSolidBody } from "@/infrastructure/occ/topology";
import { SOLVER_SCHEMA_VERSION } from "@/contracts/solver/schema";

type OC = OpenCascadeInstance;
async function loadOc(): Promise<OC> {
  const mod = (await import("../../../public/cadara-occ.js")) as unknown as {
    default: new (m: Record<string, unknown>) => Promise<OC>;
  };
  const wasmBinary = new Uint8Array(
    await readFile(new URL("../../../public/cadara-occ.wasm", import.meta.url)),
  );
  return new mod.default({ wasmBinary });
}

const req = {
  contractVersion: "modeling-contract/v1alpha1",
  documentId: "doc_workspace",
} as const;

async function adapterWithExtrudedBody(oc: OC) {
  const createSolver = (revisionId: RevisionId | null) =>
    new SketchConstraintSolverAdapter({
      neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
      revisionId,
    });
  const adapter = new OpenCascadeKernelAdapter({
    createSolverAdapter: createSolver,
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

  const tracker = makeOccWrapperTracker(oc);
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
  const tracker = makeOccWrapperTracker(oc);
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

test("cadara-o5k: planar consumers retain no plane handles on success or cleanup failure", async () => {
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
  const tracker = makeOccWrapperTracker(oc);
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
    await tracker.record(() => {
      expect(getExtrusionNormalForPlanarFace(oc, face, "positive")).toEqual(x.frame.normal);
      expect(buildConstructionPlaneFromPlanarFace(oc, face, faceId, {
        kind: "face", bodyId: body.bodyId, faceId,
      }).frame).toEqual(x.frame);
    });
    expect(tracker.of("gp_Pln").length).toBeGreaterThan(2);
    expect(tracker.of("gp_Pln").filter((plane) => !plane.isDeleted?.())).toHaveLength(0);

    const cleanupError = new Error("injected plane release failure");
    tracker.arm("gp_Pln", cleanupError);
    let releaseFailure: unknown;
    try {
      await tracker.record(() => getExtrusionNormalForPlanarFace(oc, face, "negative"));
    } catch (error) {
      releaseFailure = error;
    }
    const [cleanup] = collectOccCleanupErrors(releaseFailure);
    expect(cleanup?.errors).toContain(cleanupError);
    const [failed] = tracker.failing();
    expect(tracker.attempts(failed!)).toBe(1);
    // The cleanup error retains the only failed owner for an explicit retry.
    const failedPlane = tracker.of("gp_Pln").filter((plane) => !plane.isDeleted?.());
    expect(failedPlane).toHaveLength(1);
    cleanup!.retry();
    expect(tracker.of("gp_Pln").filter((plane) => !plane.isDeleted?.())).toHaveLength(0);
  } finally {
    adapter.dispose();
    tracker.leftovers();
    tracker.restore();
  }
});

/**
 * F2 / F2b: a `BRep_Tool.Pnt` release failure during the service's
 * projection-time snapshot read is an OccCleanupError, retained (one
 * attempt, not deleted) until dispose retries it. The snapshot reads vertex
 * points at several sites (T10c review R-3): `site` picks the one armed, and
 * the failing wrapper's recorded stack proves which site was exercised.
 */
async function expectProjectionSnapshotVertexPointRetention(site: string) {
  const oc = await loadOc();
  const { adapter } = await adapterWithExtrudedBody(oc);
  const current = await adapter.getDocumentSnapshot(req);
  const service = createModelingService(adapter, {
    currentDocumentId: "doc_workspace",
  });
  const tracker = makeOccWrapperTracker(oc);
  let disposed = false;
  try {
    // F3 variant (WARM=0): arm before service initialization's own snapshot read.
    if (process.env.F2_WARM !== "0") await service.getCurrentDocumentSnapshot();
    // The armed read must build the region profile again, not reuse the warm
    // snapshot's region meshes (cadara-lyi).
    resetRegionRenderRecordCacheForTest();
    const cleanupError = new Error(
      `injected projection-snapshot vertex point release failure (${site})`,
    );
    tracker.arm("gp_Pnt(vertex)", cleanupError, (stack) =>
      stack.includes(site),
    );
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
    expect(failed, `premise: a vertex point was read at ${site}`).toBeDefined();
    expect(
      tracker.stack(failed!),
      `the injected release failure is the ${site} read`,
    ).toContain(site);
    const cleanup = collectOccCleanupErrors(rejected);
    expect(rejected).toBe(cleanup[0]);
    expect(cleanup).toHaveLength(1);
    expect(cleanup[0]!.errors).toContain(cleanupError);
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
}

test("F2: service.projectSketchExternalReferences snapshot cleanup failure retention, region profile path (admitCurveEndAtVertex vertex point; non-serialized main-thread read)", async () => {
  await expectProjectionSnapshotVertexPointRetention("admitCurveEndAtVertex");
});

test("F2b: service.projectSketchExternalReferences snapshot cleanup failure retention, body vertex render (buildVertexRenderRecord vertex point; non-serialized main-thread read)", async () => {
  await expectProjectionSnapshotVertexPointRetention("buildVertexRenderRecord");
});
