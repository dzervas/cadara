import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type {
  ModelingDiagnostic,
  WorkspaceSnapshot,
} from "@/contracts/modeling/schema";
import type { RevisionId } from "@/contracts/shared/ids";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import {
  createCertifiedNeutralCurveQueryCapabilityForTest,
  createRecordingNeutralCurveQueryCapabilityForTest,
} from "@/domain/modeling/neutral-curve-certification/query";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";

// Lane: logic (docs/testing.md, src/domain adapter conformance). Seams: the
// production OCC kernel adapter's feature replay diagnostics for the T10 plan
// §2.9 reselection causes, the mock adapter's parity (review A9), and "one
// sketch solver per kernel adapter" (A10) observed through the neutral-curve
// queries it issues across revisions.

type OpenCascadeModule = new (
  module: Record<string, unknown>,
) => Promise<OpenCascadeInstance>;

async function loadOcc() {
  const module = (await import("../../../public/cadara-occ.js")) as {
    default: OpenCascadeModule;
  };
  const wasmBinary = new Uint8Array(
    await readFile(new URL("../../../public/cadara-occ.wasm", import.meta.url)),
  );
  return new module.default({ wasmBinary });
}

function createAdapter(oc: OpenCascadeInstance) {
  return new OpenCascadeKernelAdapter({
    createSolverAdapter: (revisionId) =>
      new SketchConstraintSolverAdapter({
        neutralCurveQueries:
          createCertifiedNeutralCurveQueryCapabilityForTest(),
        revisionId,
      }),
    getOpenCascadeInstance: async () => oc,
  });
}

/** The mock seed: one sketch and Extrude 1 on its region. */
async function seedDocument() {
  return new MockKernelAdapter().exportAuthoredModelDocument("doc_workspace");
}

function extrudeRegion(document: AuthoredModelDocument) {
  const extrude = document.features.find(
    (feature) => feature.featureId === "feature_extrude-1",
  )!;
  if (extrude.definition.kind !== "extrude")
    throw new Error("Expected the seed Extrude 1.");
  const profile = extrude.definition.parameters.profiles[0]!;
  if (profile.kind !== "region") throw new Error("Expected a region profile.");
  return profile;
}

/** A requirement on a missing entity: the sketch stays invalid (1 error). */
function withMissingGeometryReference(
  definition: SketchDefinition,
): SketchDefinition {
  return {
    ...structuredClone(definition),
    constraintIds: [...definition.constraintIds, "constraint_missing_entity"],
    constraints: [
      ...definition.constraints,
      {
        constraintId: "constraint_missing_entity",
        kind: "horizontal",
        label: "Missing line requirement",
        entityId: "sketch_entity_missing",
      },
    ],
  };
}

function featureDiagnostics(snapshot: WorkspaceSnapshot) {
  return snapshot.document.diagnostics.filter(
    (diagnostic) => diagnostic.featureId === "feature_extrude-1",
  );
}

async function snapshotOf(
  adapter: OpenCascadeKernelAdapter | MockKernelAdapter,
) {
  return (
    await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    })
  ).snapshot;
}

function errorCount(snapshot: WorkspaceSnapshot, sketchId: string) {
  return snapshot.document.sketches
    .find((sketch) => sketch.sketchId === sketchId)!
    .sketch.derivedValidity.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error",
    ).length;
}

test("OCC: a region id missing from its current sketch asks for reselection with profile-region-reselect", async () => {
  const oc = await loadOcc();
  const document = await seedDocument();
  const region = extrudeRegion(document);
  region.regionId =
    `${region.regionId.slice(0, -4)}dead` as typeof region.regionId;
  const adapter = createAdapter(oc);
  await adapter.restoreAuthoredModelDocument(document);
  const snapshot = await snapshotOf(adapter);

  expect(
    featureDiagnostics(snapshot).map((diagnostic) => ({
      code: diagnostic.code,
      fieldId: diagnostic.fieldId,
      repairGuidance: diagnostic.repairGuidance,
      target: diagnostic.target,
    })),
    "The dangling region is reported once, on the profile field, with the existing guidance.",
  ).toEqual([
    {
      code: "profile-region-reselect",
      fieldId: "profiles",
      repairGuidance: "Edit Extrude 1 and choose a valid profile selection.",
      target: region,
    },
  ]);
  expect(
    snapshot.document.bodies.some(
      (body) => body.ownerFeatureId === "feature_extrude-1",
    ),
    "The feature produces no body.",
  ).toBe(false);

  // Editing the feature previews it in place: the preview names the same
  // region and cause, so the profile field can mark it.
  const extrude = document.features.find(
    (feature) => feature.featureId === "feature_extrude-1",
  )!;
  const preview = await adapter.evaluatePreview({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: snapshot.document.revisionId,
    previewId: "preview_edit",
    replacesFeatureId: "feature_extrude-1",
    definition: extrude.definition,
  });
  expect(
    preview.diagnostics.filter(
      (diagnostic) => diagnostic.code === "profile-region-reselect",
    ),
  ).toMatchObject([
    {
      target: region,
      repairGuidance: "Edit Extrude 1 and choose a valid profile selection.",
    },
  ]);
  adapter.dispose();
});

test("OCC: an invalid sketch keeps the profile selection (profile-region-sketch-not-current) and reconnects by identity once corrected", async () => {
  const oc = await loadOcc();
  const document = await seedDocument();
  const region = { ...extrudeRegion(document) };
  const sketch = document.sketches.find(
    (entry) => entry.sketchId === region.sketchId,
  )!;
  const validDefinition = structuredClone(sketch.definition);
  sketch.definition = withMissingGeometryReference(sketch.definition);
  const adapter = createAdapter(oc);
  await adapter.restoreAuthoredModelDocument(document);
  const invalid = await snapshotOf(adapter);
  const errors = errorCount(invalid, region.sketchId);
  expect(errors, "The fixture sketch has error diagnostics.").toBeGreaterThan(
    0,
  );

  const [diagnostic, ...rest] = featureDiagnostics(invalid);
  expect(rest).toEqual([]);
  expect(diagnostic).toMatchObject({
    code: "profile-region-sketch-not-current",
    fieldId: "profiles",
    target: region,
    repairGuidance: `Correct ${sketch.label} (${errors} error${errors === 1 ? "" : "s"}); the profile will resolve again.`,
  } satisfies Partial<ModelingDiagnostic>);
  const authored = await adapter.exportAuthoredModelDocument("doc_workspace");
  expect(
    extrudeRegion(authored),
    "The selection is kept, not cleared or replaced.",
  ).toEqual(region);

  const corrected = await adapter.commitSketch({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: invalid.document.revisionId,
    solverCorrelation: {
      requestId: "request_corrected",
      projectionRequestId: "request_corrected:project",
      validationRequestId: "request_corrected:validate",
      solveRequestId: "request_corrected:solve",
      regionRequestId: "request_corrected:regions",
    },
    sketchId: sketch.sketchId,
    sketchLabel: sketch.label,
    plane: sketch.plane,
    definition: validDefinition,
  });
  expect(corrected.revisionState.kind).toBe("accepted");
  const reconnected = await snapshotOf(adapter);
  expect(
    featureDiagnostics(reconnected),
    "The same canonical region returns, so the kept selection resolves again.",
  ).toEqual([]);
  expect(
    reconnected.document.bodies.some(
      (body) => body.ownerFeatureId === "feature_extrude-1",
    ),
  ).toBe(true);
  adapter.dispose();
});

test("OCC: one sketch solver per kernel adapter; its exact-query cache answers a later revision's identical requests", async () => {
  const oc = await loadOcc();
  const document = await seedDocument();
  const recording = createRecordingNeutralCurveQueryCapabilityForTest();
  const factoryRevisions: (RevisionId | null)[] = [];
  const adapter = new OpenCascadeKernelAdapter({
    createSolverAdapter: (revisionId) => {
      factoryRevisions.push(revisionId);
      return new SketchConstraintSolverAdapter({
        neutralCurveQueries: recording.capability,
        revisionId,
      });
    },
    getOpenCascadeInstance: async () => oc,
  });
  await adapter.restoreAuthoredModelDocument(document);
  const afterRestore = recording.modelingTolerances.length;
  expect(afterRestore, "Restore derives the seed regions.").toBeGreaterThan(0);

  const restored = await snapshotOf(adapter);
  const sketch = restored.document.sketches[0]!;
  const commit = (baseRevisionId: RevisionId, label: string) =>
    adapter.commitSketch({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId,
      solverCorrelation: {
        requestId: `request_${label}`,
        projectionRequestId: `request_${label}:project`,
        validationRequestId: `request_${label}:validate`,
        solveRequestId: `request_${label}:solve`,
        regionRequestId: `request_${label}:regions`,
      },
      sketchId: sketch.sketchId,
      sketchLabel: sketch.label,
      plane: sketch.plane,
      definition: sketch.sketch.definition,
    });
  const first = await commit(restored.document.revisionId, "first");
  const second = await commit(first.revisionId, "second");
  expect(first.revisionState.kind).toBe("accepted");
  expect(second.revisionState.kind).toBe("accepted");
  expect(second.revisionId).not.toBe(restored.document.revisionId);
  expect(
    recording.modelingTolerances.length,
    "Re-committing the same sketch at two later revisions issues no new query: every exact request hits the shared cache.",
  ).toBe(afterRestore);

  await adapter.restoreAuthoredModelDocument(
    await adapter.exportAuthoredModelDocument("doc_workspace"),
  );
  expect(
    recording.modelingTolerances.length,
    "A later restore of the same document reuses the cache too.",
  ).toBe(afterRestore);
  expect(
    factoryRevisions,
    "The solver is built once, revision-agnostic.",
  ).toEqual([null]);
  adapter.dispose();
});

test("mock parity: missing region → profile-region-reselect; invalid sketch → profile-region-sketch-not-current", async () => {
  const document = await seedDocument();
  const region = extrudeRegion(document);
  const extrude = document.features.find(
    (feature) => feature.featureId === "feature_extrude-1",
  )!;
  const adapter = new MockKernelAdapter();
  const base = await snapshotOf(adapter);
  const preview = (profile: typeof region) =>
    adapter.evaluatePreview({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: base.document.revisionId,
      previewId: "preview_reselection",
      definition: {
        ...extrude.definition,
        parameters: {
          ...(extrude.definition.parameters as object),
          profiles: [profile],
        },
      } as typeof extrude.definition,
    });

  const missing = {
    ...region,
    regionId: `${region.regionId}_gone`,
  } as typeof region;
  expect(
    (await preview(missing)).diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      target: diagnostic.target,
      repairGuidance: diagnostic.repairGuidance,
    })),
  ).toEqual([
    {
      code: "profile-region-reselect",
      target: missing,
      repairGuidance: "Edit the extrude and choose a valid profile selection.",
    },
  ]);

  // Review R-2: a region of a sketch that does not exist asks for
  // reselection, as in OCC (not "correct the sketch").
  const orphan = {
    ...region,
    sketchId: "sketch_gone",
  } as typeof region;
  expect(
    (await preview(orphan)).diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      target: diagnostic.target,
      repairGuidance: diagnostic.repairGuidance,
    })),
  ).toEqual([
    {
      code: "profile-region-reselect",
      target: orphan,
      repairGuidance: "Edit the extrude and choose a valid profile selection.",
    },
  ]);

  const sketch = document.sketches.find(
    (entry) => entry.sketchId === region.sketchId,
  )!;
  const committed = await adapter.commitSketch({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: base.document.revisionId,
    solverCorrelation: {
      requestId: "request_invalid",
      projectionRequestId: "request_invalid:project",
      validationRequestId: "request_invalid:validate",
      solveRequestId: "request_invalid:solve",
      regionRequestId: "request_invalid:regions",
    },
    sketchId: sketch.sketchId,
    sketchLabel: sketch.label,
    plane: sketch.plane,
    definition: withMissingGeometryReference(sketch.definition),
  });
  expect(committed.revisionState.kind).toBe("accepted");
  const invalid = await snapshotOf(adapter);
  const errors = errorCount(invalid, region.sketchId);
  expect(errors).toBeGreaterThan(0);
  const response = await adapter.evaluatePreview({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: invalid.document.revisionId,
    previewId: "preview_not_current",
    definition: extrude.definition,
  });
  expect(
    response.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      target: diagnostic.target,
      repairGuidance: diagnostic.repairGuidance,
    })),
  ).toEqual([
    {
      code: "profile-region-sketch-not-current",
      target: region,
      repairGuidance: `Correct ${sketch.label} (${errors} error${errors === 1 ? "" : "s"}); the profile will resolve again.`,
    },
  ]);
});

test("mock: one owned solver serves every revision (its query cache is shared)", async () => {
  let queries = 0;
  class CountingMockKernelAdapter extends MockKernelAdapter {
    override async queryNeutralCurves(
      request: Parameters<MockKernelAdapter["queryNeutralCurves"]>[0],
    ) {
      queries += 1;
      return super.queryNeutralCurves(request);
    }
    override async queryNeutralCurveSelfIntersections(
      request: Parameters<
        MockKernelAdapter["queryNeutralCurveSelfIntersections"]
      >[0],
    ) {
      queries += 1;
      return super.queryNeutralCurveSelfIntersections(request);
    }
    override async queryNeutralCurveJoin(
      request: Parameters<MockKernelAdapter["queryNeutralCurveJoin"]>[0],
    ) {
      queries += 1;
      return super.queryNeutralCurveJoin(request);
    }
  }
  const adapter = new CountingMockKernelAdapter();
  const base = await snapshotOf(adapter);
  const sketch = base.document.sketches[0]!;
  const commit = (baseRevisionId: RevisionId, label: string) =>
    adapter.commitSketch({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId,
      solverCorrelation: {
        requestId: `request_${label}`,
        projectionRequestId: `request_${label}:project`,
        validationRequestId: `request_${label}:validate`,
        solveRequestId: `request_${label}:solve`,
        regionRequestId: `request_${label}:regions`,
      },
      sketchId: sketch.sketchId,
      sketchLabel: sketch.label,
      plane: sketch.plane,
      definition: sketch.sketch.definition,
    });
  const first = await commit(base.document.revisionId, "first");
  expect(first.revisionState.kind).toBe("accepted");
  const afterFirst = queries;
  expect(
    afterFirst,
    "The first commit derives through the queries.",
  ).toBeGreaterThan(0);
  const second = await commit(first.revisionId, "second");
  expect(second.revisionState.kind).toBe("accepted");
  expect(
    queries,
    "The identical commit at the next revision is answered by the shared cache.",
  ).toBe(afterFirst);
});
