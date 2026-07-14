import { test, expect } from "vitest";
import { ResultAsync, createAppError } from "@/contracts/errors";

import type { ImportPreparedActions } from "@/contracts/import/actions";
import type { ResolvedImportSource } from "@/contracts/import/source";
import type { CreateFeatureRequest } from "@/contracts/modeling/schema";
import { CONTRACT_VERSION, PLANE_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import { assembleFixtureCaptureBundle } from "@/cli/commands/onshape-capture/fixtures/capture-bundle-fixture";
import { FIXTURE_PART_STUDIO_ID } from "@/cli/commands/onshape-capture/fixtures/capture-bundle-fixture";
import { onshapeImportProvider } from "@/domain/import/onshape/provider";
import {
  applyImportPreparedActions,
  createImportCapabilities,
  prepareImportActions,
} from "@/domain/import/orchestrator";
import { readPartStudio } from "@/domain/import/onshape/bundle-reader";
import { projectPointToPlane, translateSketch } from "@/domain/import/onshape/sketch-translator";
import { createModelingService } from "@/domain/modeling/modeling-service";
import { createMemoryGeometryAssetStore } from "@/domain/modeling/geometry-asset-store";
import { createGeometryAssetComposition } from "@/infrastructure/modeling/browser-geometry-asset-store";
import type { ModelingService } from "@/domain/modeling/modeling-service";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import type { SketchSolverAdapter } from "@/contracts/solver/adapter";
import type { DocumentId, RevisionId } from "@/contracts/shared/ids";

// Use the REAL sketch constraint solver (pure TS, always available). It solves
// against any revision, so we delegate each call to an instance configured for
// that request's revision. The mock solver previously masked commit-seam
// defects (dropped geometry, id mismatch) that only the real solver surfaces.
function createRevisionAgnosticRealSolver(): SketchSolverAdapter {
  return new Proxy({} as SketchSolverAdapter, {
    get(_target, property) {
      return (request: { documentId: DocumentId; revisionId: RevisionId }) => {
        const adapter = new SketchConstraintSolverAdapter({
          documentId: request.documentId,
          revisionId: request.revisionId,
        });
        const method = (adapter as unknown as Record<string, unknown>)[
          property as string
        ] as (input: unknown) => unknown;
        return method.call(adapter, request);
      };
    },
  });
}

function sourceFromBundle(bundle: unknown): ResolvedImportSource {
  return {
    name: "mounts.onshape-capture.json",
    origin: { kind: "localFile", fileName: "mounts.onshape-capture.json" },
    mediaType: "application/json",
    bytes: new TextEncoder().encode(JSON.stringify(bundle)),
    fingerprint: `sha256:${"a".repeat(64)}`,
  };
}

function createTestModelingService() {
  const adapter = new MockKernelAdapter({
    solverAdapter: createRevisionAgnosticRealSolver(),
  });
  const service = createModelingService(adapter, {
    currentDocumentId: "doc_workspace",
  });
  return { adapter, service };
}

function extrudeRequest(input: {
  featureLabel: string;
  profileActionIndex: number;
  bodyActionIndex?: number;
  selectorPoint?: readonly [number, number];
}): CreateFeatureRequest {
  return {
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace",
    baseRevisionId: "rev_ignored" as RevisionId,
    featureLabel: input.featureLabel,
    definition: {
      kind: "extrude",
      featureTypeVersion: "feature-type/extrude/v1alpha1",
      parameters: {
        profiles: [
          {
            kind: "regionOf",
            actionIndex: input.profileActionIndex,
            selector: {
              kind: "interiorPoint",
              point: input.selectorPoint ?? [0, 0],
            },
          },
        ],
        startExtent: { kind: "profilePlane" },
        extent: {
          mode: "oneSide",
          end: {
            kind: "blind",
            direction: "positive",
            distance: { source: "literal", value: 5 },
          },
        },
        operation: {
          source: "literal",
          value: input.bodyActionIndex === undefined ? "newBody" : "cut",
        },
        booleanScope:
          input.bodyActionIndex === undefined
            ? { kind: "standalone" }
            : {
                kind: "targetBody",
                bodyId: { kind: "bodyOf", actionIndex: input.bodyActionIndex },
              },
      },
    },
  } as CreateFeatureRequest;
}

async function translatedFixtureSketchAction() {
  const bundle = await assembleFixtureCaptureBundle();
  const mounts = readPartStudio(bundle, FIXTURE_PART_STUDIO_ID);
  for (const solved of mounts.solvedSketchesByFeatureId.values()) {
    const entities = solved.entities.map((curve) => ({
      entityId: curve.entityId,
      entityType: curve.entityType,
      isConstruction: curve.isConstruction,
      start: curve.start3d ? projectPointToPlane(curve.start3d, "xy") : undefined,
      end: curve.end3d ? projectPointToPlane(curve.end3d, "xy") : undefined,
      center: curve.center3d ? projectPointToPlane(curve.center3d, "xy") : undefined,
      radius: curve.radius === undefined ? undefined : curve.radius * 1000,
    }));
    const translation = translateSketch({
      featureId: solved.featureId,
      label: "Fixture sketch",
      planeKey: "xy",
      entities,
    });
    const circle = translation.definition.entities.find(
      (entity) => entity.kind === "circle",
    );
    const centerPoint =
      circle?.kind === "circle"
        ? translation.definition.points.find(
            (point) => point.pointId === circle.centerPointId,
          )
        : null;
    const selectorPoint =
      centerPoint?.position ??
      (translation.definition.points.length > 0
        ? ([
            translation.definition.points.reduce(
              (total, point) => total + point.position[0],
              0,
            ) / translation.definition.points.length,
            translation.definition.points.reduce(
              (total, point) => total + point.position[1],
              0,
            ) / translation.definition.points.length,
          ] as const)
        : null);
    if (!selectorPoint || translation.definition.entities.length === 0) {
      continue;
    }
    return {
      action: {
        contractVersion: CONTRACT_VERSION,
        documentId: "doc_workspace" as DocumentId,
        baseRevisionId: "rev_ignored" as RevisionId,
        solverCorrelation: {
          requestId: "request_import_fixture_deferred",
          projectionRequestId: "request_import_fixture_deferred_project",
          validationRequestId: "request_import_fixture_deferred_validate",
          solveRequestId: "request_import_fixture_deferred_solve",
          regionRequestId: "request_import_fixture_deferred_regions",
        },
        sketchId: null,
        sketchLabel: "Fixture sketch",
        plane: translation.plane,
        definition: translation.definition,
      },
      selectorPoint,
    };
  }
  throw new Error("Fixture must contain at least one translatable sketch.");
}

function nestedCircleSketchAction() {
  const translation = translateSketch({
    featureId: "nested_rectangles",
    label: "Nested rectangles",
    planeKey: "xy",
    entities: [
      { entityId: "outer_bottom", entityType: "lineSegment", start: [-10, -10], end: [10, -10] },
      { entityId: "outer_right", entityType: "lineSegment", start: [10, -10], end: [10, 10] },
      { entityId: "outer_top", entityType: "lineSegment", start: [10, 10], end: [-10, 10] },
      { entityId: "outer_left", entityType: "lineSegment", start: [-10, 10], end: [-10, -10] },
      { entityId: "inner_bottom", entityType: "lineSegment", start: [-4, -4], end: [4, -4] },
      { entityId: "inner_right", entityType: "lineSegment", start: [4, -4], end: [4, 4] },
      { entityId: "inner_top", entityType: "lineSegment", start: [4, 4], end: [-4, 4] },
      { entityId: "inner_left", entityType: "lineSegment", start: [-4, 4], end: [-4, -4] },
    ],
  });
  return {
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace" as DocumentId,
    baseRevisionId: "rev_ignored" as RevisionId,
    solverCorrelation: {
      requestId: "request_import_nested_deferred",
      projectionRequestId: "request_import_nested_deferred_project",
      validationRequestId: "request_import_nested_deferred_validate",
      solveRequestId: "request_import_nested_deferred_solve",
      regionRequestId: "request_import_nested_deferred_regions",
    },
    sketchId: null,
    sketchLabel: "Nested rectangles",
    plane: translation.plane,
    definition: translation.definition,
  };
}

function recordCreateFeatureInputs(service: ModelingService) {
  const createFeature = service.createFeature.bind(service);
  const requests: CreateFeatureRequest[] = [];
  service.createFeature = ((input) => {
    requests.push(input as CreateFeatureRequest);
    return createFeature(input);
  }) as ModelingService["createFeature"];
  return requests;
}

function recordCreateFeatureInputsWithCreatedBody(service: ModelingService) {
  const createFeature = service.createFeature.bind(service);
  const requests: CreateFeatureRequest[] = [];
  service.createFeature = ((input) => {
    requests.push(input as CreateFeatureRequest);
    return createFeature(input).map((value) => ({
      ...value,
      changedTargets:
        requests.length === 1
          ? [
              ...value.changedTargets,
              { kind: "body" as const, bodyId: "body_imported_base" as const },
            ]
          : value.changedTargets,
    }));
  }) as ModelingService["createFeature"];
  return requests;
}

function recordSuccessfulCreateFeatureInputs(service: ModelingService) {
  const requests: CreateFeatureRequest[] = [];
  service.createFeature = ((input) => {
    requests.push(input as CreateFeatureRequest);
    return ResultAsync.fromPromise(
      Promise.resolve({
        revisionId: "rev_nested_feature" as RevisionId,
        featureId: "feature_nested" as const,
        revisionState: "advanced" as const,
        rebuildResult: "reused" as const,
        changedTargets: [],
        diagnostics: [],
      }),
      (error) =>
        createAppError({ code: "unknown", message: String(error) }),
    );
  }) as ModelingService["createFeature"];
  return requests;
}

// Seam tests: prepared actions must apply cleanly through the *real* modeling
// service against the mock kernel adapter — the same path the workbench commit
// uses. Provider-produced fixture coverage below protects Onshape translation.
// The hand-authored deferred consumers later in this file are intentionally
// separate import-contract coverage; do not delete/merge them when provider
// deferred emission lands, because they prove the generic deferred-reference
// contract independently of Onshape planning.
test("src/domain/import/onshape/apply-pipeline.spec.ts", async () => {
  const { adapter, service } = createTestModelingService();
  const snapshotResponse = await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace",
  });
  const snapshot = snapshotResponse.snapshot;
  const capabilities = createImportCapabilities(service, snapshot);

  const bundle = await assembleFixtureCaptureBundle();
  const source = sourceFromBundle(bundle);

  const review = await onshapeImportProvider.review({ source, capabilities });
  const selections = onshapeImportProvider.createDefaultSelections(review);
  const actions = await prepareImportActions({
    provider: onshapeImportProvider,
    source,
    review,
    selections,
    capabilities,
  });

  // The provider must own solver correlation ids for every sketch commit.
  for (const commit of actions.commitSketches ?? []) {
    expect(
      commit.solverCorrelation !== null &&
        commit.solverCorrelation.requestId.startsWith("request_import_"),
      "Each imported sketch commit should carry provider-owned request_import_ correlation ids.",
    ).toBeTruthy();
  }

  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: snapshot.document.revisionId,
    actions,
  });

  expect(
    result.diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    "Applying imported actions through the real service must not surface adapter errors.",
  ).toBeTruthy();

  const committedSketches = actions.commitSketches?.length ?? 0;
  expect(
    result.createdEntityIds.sketchIds.length,
    "Every prepared sketch commit should produce a durable sketch through the adapter.",
  ).toBe(committedSketches);
  expect(
    committedSketches,
    "The Mounts fixture should yield at least one parametric sketch commit.",
  ).toBeGreaterThanOrEqual(1);

  // Prove real solved geometry survives translation+projection (not an empty
  // sketch): at least one committed sketch carries a circle entity.
  const hasCircle = (actions.commitSketches ?? []).some((commit) =>
    commit.definition.entities.some((entity) => entity.kind === "circle"),
  );
  expect(
    hasCircle,
    "The translated sketch should contain the circle parsed from the real solved-sketch payload.",
  ).toBeTruthy();
});

test("applyImportPreparedActions resolves a fixture sketch region into a concrete extrude profile", async () => {
  const { adapter, service } = createTestModelingService();
  const snapshot = (await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace",
  })).snapshot;
  const { action: sketchAction, selectorPoint } = await translatedFixtureSketchAction();
  const createFeatureRequests = recordCreateFeatureInputs(service);
  const actions: ImportPreparedActions = {
    commitSketches: [sketchAction],
    createFeatures: [
      extrudeRequest({
        featureLabel: "Fixture region extrude",
        profileActionIndex: 0,
        selectorPoint,
      }) as ImportPreparedActions["createFeatures"] extends (infer Entry)[] | undefined ? Entry : never,
    ],
    orderedActions: [
      { kind: "commitSketch", index: 0 },
      { kind: "createFeature", index: 0 },
    ],
  };

  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: snapshot.document.revisionId,
    actions,
  });

  expect(
    result.diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    "Deferred region extrude should apply without import diagnostics.",
  ).toBeTruthy();
  expect(result.createdEntityIds.featureIds.length).toBe(1);
  expect(
    createFeatureRequests[0]?.definition.kind === "extrude" &&
      createFeatureRequests[0].definition.parameters.profiles[0]?.kind === "region",
    "The deferred regionOf profile should be materialized to a concrete region profile before createFeature.",
  ).toBeTruthy();
});

test("applyImportPreparedActions resolves bodyOf scope for a sketch-extrude-cut chain", async () => {
  const { adapter, service } = createTestModelingService();
  const snapshot = (await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace",
  })).snapshot;
  const { action: sketchAction, selectorPoint } = await translatedFixtureSketchAction();
  const createFeatureRequests = recordCreateFeatureInputsWithCreatedBody(service);
  const actions: ImportPreparedActions = {
    commitSketches: [sketchAction],
    createFeatures: [
      extrudeRequest({
        featureLabel: "Fixture base extrude",
        profileActionIndex: 0,
        selectorPoint,
      }) as ImportPreparedActions["createFeatures"] extends (infer Entry)[] | undefined ? Entry : never,
      extrudeRequest({
        featureLabel: "Fixture cut extrude",
        profileActionIndex: 0,
        bodyActionIndex: 1,
        selectorPoint,
      }) as ImportPreparedActions["createFeatures"] extends (infer Entry)[] | undefined ? Entry : never,
    ],
    orderedActions: [
      { kind: "commitSketch", index: 0 },
      { kind: "createFeature", index: 0 },
      { kind: "createFeature", index: 1 },
    ],
  };

  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: snapshot.document.revisionId,
    actions,
  });

  expect(result.createdEntityIds.featureIds.length).toBe(2);
  expect(
    createFeatureRequests[1]?.definition.kind === "extrude" &&
      createFeatureRequests[1].definition.parameters.booleanScope.kind === "targetBody" &&
      typeof createFeatureRequests[1].definition.parameters.booleanScope.bodyId === "string",
    "The deferred bodyOf scope should be materialized to the first extrude's created body id before the cut applies.",
  ).toBeTruthy();
});

test("applyImportPreparedActions materializes a baked checkpoint that supersedes prior parametric body outputs", async () => {
  const { assetStore, resolver } = createGeometryAssetComposition(
    createMemoryGeometryAssetStore(),
  );
  const adapter = new MockKernelAdapter({
    solverAdapter: createRevisionAgnosticRealSolver(),
    assetResolver: resolver,
  });
  const service = createModelingService(adapter, { currentDocumentId: "doc_workspace" });
  const snapshot = (await service.getCurrentDocumentSnapshot());
  const { action: sketchAction, selectorPoint } = await translatedFixtureSketchAction();
  const requests = recordCreateFeatureInputsWithCreatedBody(service);
  const bytes = new TextEncoder().encode(JSON.stringify({
    kind: "bakedMeshGeometry",
    schemaVersion: "baked-mesh-geometry/v1alpha1",
    vertices: [[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]],
    indices: [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]],
  }));
  const reference = await createImportCapabilities(service, snapshot, { assetStore })
    .modeling.bakeGeometry({ bytes, format: "baked-mesh" });
  const actions: ImportPreparedActions = {
    commitSketches: [sketchAction],
    createFeatures: [
      extrudeRequest({
        featureLabel: "Parametric source body",
        profileActionIndex: 0,
        selectorPoint,
      }) as ImportPreparedActions["createFeatures"] extends (infer Entry)[] | undefined ? Entry : never,
      {
        contractVersion: CONTRACT_VERSION,
        documentId: "doc_workspace" as DocumentId,
        baseRevisionId: "rev_ignored" as RevisionId,
        featureLabel: "Final studio checkpoint",
        definition: {
          kind: "bakedBody",
          featureTypeVersion: "feature-type/baked-body/v1alpha1",
          parameters: {
            ...reference,
            label: "Final studio checkpoint",
            provenance: { source: "onshape", reason: "onshape-studio-bake-required" },
            replacement: { kind: "replaceBodyOutputs", actionIndexes: [1] },
          },
        },
      },
    ],
    orderedActions: [
      { kind: "commitSketch", index: 0 },
      { kind: "createFeature", index: 0 },
      { kind: "createFeature", index: 1 },
    ],
  };

  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: snapshot.document.revisionId,
    actions,
  });
  const finalSnapshot = await service.getCurrentDocumentSnapshot();
  expect(result.rolledBack).toBe(false);
  expect(finalSnapshot.document.bodies).toHaveLength(2);
  expect(finalSnapshot.document.bodies.filter((body) =>
    body.label === "Final studio checkpoint",
  )).toHaveLength(1);
  expect(finalSnapshot.document.features).toHaveLength(
    snapshot.document.features.length + 2,
  );
  expect(finalSnapshot.document.features.at(-2)?.producedTargets).toHaveLength(1);
  expect(finalSnapshot.document.features.at(-1)?.producedTargets).toHaveLength(1);
  expect(
    requests[1]?.definition.kind === "bakedBody" &&
      requests[1].definition.parameters.replacement,
  ).toEqual({ kind: "replaceBodies", bodyIds: ["body_imported_base"] });
});

test("applyImportPreparedActions rolls back when a deferred region selector cannot resolve", async () => {
  const { adapter, service } = createTestModelingService();
  const snapshot = (await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace",
  })).snapshot;
  const { action: sketchAction } = await translatedFixtureSketchAction();
  let rolledBackCount = 0;
  const actions: ImportPreparedActions = {
    commitSketches: [sketchAction],
    createFeatures: [
      extrudeRequest({
        featureLabel: "Unresolvable region extrude",
        profileActionIndex: 0,
        selectorPoint: [1_000_000, 1_000_000],
      }) as ImportPreparedActions["createFeatures"] extends (infer Entry)[] | undefined ? Entry : never,
    ],
    orderedActions: [
      { kind: "commitSketch", index: 0 },
      { kind: "createFeature", index: 0 },
    ],
  };

  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: snapshot.document.revisionId,
    actions,
    rollback: async (count) => {
      rolledBackCount = count;
    },
  });

  expect(result.rolledBack).toBe(true);
  expect(rolledBackCount).toBe(1);
  expect(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "import-apply-failed" &&
        diagnostic.message.includes("regionOf") &&
        diagnostic.message.includes("selector"),
    ),
    "Unresolvable deferred region failures should name the reference and selector in rollback diagnostics.",
  ).toBeTruthy();
});


test("applyImportPreparedActions preserves the apply failure when rollback also fails", async () => {
  const { adapter, service } = createTestModelingService();
  const snapshot = (await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace",
  })).snapshot;
  const { action: sketchAction } = await translatedFixtureSketchAction();

  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: snapshot.document.revisionId,
    actions: {
      commitSketches: [sketchAction],
      createFeatures: [
        extrudeRequest({
          featureLabel: "Unresolvable region extrude",
          profileActionIndex: 0,
          selectorPoint: [1_000_000, 1_000_000],
        }) as ImportPreparedActions["createFeatures"] extends (infer Entry)[] | undefined
          ? Entry
          : never,
      ],
      orderedActions: [
        { kind: "commitSketch", index: 0 },
        { kind: "createFeature", index: 0 },
      ],
    },
    rollback: async () => {
      throw new Error("repository undo synchronization failed");
    },
  });

  expect(result.rolledBack).toBe(false);
  expect(result.rollbackAttempted).toBe(true);
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "import-apply-failed",
  );
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "import-rollback-failed",
  );
  expect(
    result.diagnostics.find(
      (diagnostic) => diagnostic.code === "import-apply-failed",
    )?.message,
  ).toContain("regionOf");
  expect(
    result.diagnostics.find(
      (diagnostic) => diagnostic.code === "import-rollback-failed",
    )?.message,
  ).toContain("repository undo synchronization failed");
});

test("applyImportPreparedActions uses innermost containment for nested region selectors", async () => {
  const { adapter, service } = createTestModelingService();
  const snapshot = (await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace",
  })).snapshot;
  const createFeatureRequests = recordSuccessfulCreateFeatureInputs(service);
  const actions: ImportPreparedActions = {
    commitSketches: [nestedCircleSketchAction()],
    createFeatures: [
      extrudeRequest({
        featureLabel: "Nested inner extrude",
        profileActionIndex: 0,
        selectorPoint: [0, 0],
      }) as ImportPreparedActions["createFeatures"] extends (infer Entry)[] | undefined ? Entry : never,
    ],
    orderedActions: [
      { kind: "commitSketch", index: 0 },
      { kind: "createFeature", index: 0 },
    ],
  };

  const getSnapshot = service.getCurrentDocumentSnapshot.bind(service);
  service.getCurrentDocumentSnapshot = async () => {
    const snapshotWithSketch = await getSnapshot();
    const sketch = snapshotWithSketch.document.sketches.find(
      (entry) => entry.sketchId === "sketch_2",
    ) as ((typeof snapshotWithSketch.document.sketches)[number] & {
      sketch?: { regions?: unknown[]; definition?: typeof actions.commitSketches extends (infer Entry)[] ? Entry extends { definition: infer Definition } ? Definition : never : never };
      regions?: unknown[];
      definition?: typeof actions.commitSketches extends (infer Entry)[] ? Entry extends { definition: infer Definition } ? Definition : never : never;
    }) | undefined;
    if (sketch) {
      const definition = (sketch.sketch?.definition ?? sketch.definition)!;
      const line = (label: string) =>
        definition.entities.find(
          (entity) => entity.kind === "lineSegment" && entity.label === label,
        ) as Extract<(typeof definition.entities)[number], { kind: "lineSegment" }>;
      const makeRegion = (regionId: string, labels: string[]) => ({
        regionId,
        label: regionId,
        target: { kind: "region", sketchId: sketch.sketchId, regionId },
        sourceSketch: { kind: "sketch", sketchId: sketch.sketchId },
        loops: [
          {
            loopId: `${regionId}_loop`,
            role: "outer",
            orientation: "counterClockwise",
            segments: labels.map((label) => ({
              source: { kind: "entity", entityId: line(label).entityId },
              startPointId: line(label).startPointId,
              endPointId: line(label).endPointId,
            })),
            boundaryPointIds: labels.map((label) => line(label).startPointId),
            isClosed: true,
          },
        ],
        isClosed: true,
      });
      const regions = [
        makeRegion("region_outer", ["outer_bottom", "outer_right", "outer_top", "outer_left"]),
        makeRegion("region_inner", ["inner_bottom", "inner_right", "inner_top", "inner_left"]),
      ];
      if (sketch.sketch) {
        sketch.sketch.regions = regions;
      } else {
        sketch.regions = regions;
      }
    }
    return snapshotWithSketch;
  };

  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: snapshot.document.revisionId,
    actions,
  });
  const innerRegion = { regionId: "region_inner" };

  expect(result.createdEntityIds.featureIds.length).toBe(1);
  expect(
    createFeatureRequests[0]?.definition.kind === "extrude" &&
      createFeatureRequests[0].definition.parameters.profiles[0]?.kind === "region" &&
      createFeatureRequests[0].definition.parameters.profiles[0].regionId === innerRegion?.regionId,
    "A selector inside nested regions should resolve to the innermost containing region.",
  ).toBeTruthy();
});

test("applyImportPreparedActions keeps the no-deferred-reference path unchanged", async () => {
  const { adapter, service } = createTestModelingService();
  const snapshot = (await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace",
  })).snapshot;
  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: snapshot.document.revisionId,
    actions: {},
  });

  expect(result.appliedOperationCount).toBe(0);
  expect(result.rolledBack).toBe(false);
});

// Composition-seam test: both the import baking capability (writer) and the
// kernel asset resolver (reader) are obtained from the SAME production
// composition helper against one store. The definition-carried asset reference
// is what threads writer output to reader input, so the baked body materializes
// without an assetMissing diagnostic and without any session registry.
test("applyImportPreparedActions applies a baked body through the shared composition seam", async () => {
  const { assetStore, resolver } = createGeometryAssetComposition(
    createMemoryGeometryAssetStore(),
  );
  const adapter = new MockKernelAdapter({
    solverAdapter: createRevisionAgnosticRealSolver(),
    assetResolver: resolver,
  });
  const service = createModelingService(adapter, {
    currentDocumentId: "doc_workspace",
  });
  const snapshot = (
    await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: "doc_workspace",
    })
  ).snapshot;
  const capabilities = createImportCapabilities(service, snapshot, {
    assetStore,
  });

  // Writer end: bake bytes through the capability into the shared store.
  const bakedMeshBytes = new TextEncoder().encode(
    JSON.stringify({
      kind: "bakedMeshGeometry",
      schemaVersion: "baked-mesh-geometry/v1alpha1",
      vertices: [
        [0, 0, 0],
        [10, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
      ],
      indices: [
        [0, 2, 1],
        [0, 1, 3],
        [1, 2, 3],
        [2, 0, 3],
      ],
    }),
  );
  const reference = await capabilities.modeling.bakeGeometry({
    bytes: bakedMeshBytes,
    format: "baked-mesh",
  });
  expect(reference.hash.startsWith("sha256:")).toBeTruthy();
  expect(reference.byteLength).toBe(bakedMeshBytes.byteLength);

  // The definition carries the full reference (id, format, hash, byteLength):
  // the reader end resolves it from the same store with no session registry.
  const actions: ImportPreparedActions = {
    createFeatures: [
      {
        contractVersion: CONTRACT_VERSION,
        documentId: "doc_workspace" as DocumentId,
        baseRevisionId: "rev_ignored" as RevisionId,
        featureLabel: "Imported baked body",
        definition: {
          kind: "bakedBody",
          featureTypeVersion: "feature-type/baked-body/v1alpha1",
          parameters: {
            ...reference,
            label: "Imported baked body",
            provenance: {
              source: "onshape",
              sourceName: "Pipeline studio",
              reason: "onshape-studio-bake-required",
            },
            replacement: { kind: "replaceBodyOutputs", actionIndexes: [] },
          },
        },
      } as ImportPreparedActions["createFeatures"] extends (infer Entry)[] | undefined
        ? Entry
        : never,
    ],
    orderedActions: [{ kind: "createFeature", index: 0 }],
  };

  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: snapshot.document.revisionId,
    actions,
  });

  expect(
    result.diagnostics.every(
      (diagnostic) => diagnostic.code !== "baked-body-assetMissing",
    ),
    `No assetMissing diagnostic should appear when writer and reader share the store; diagnostics: ${JSON.stringify(
      result.diagnostics.map((diagnostic) => diagnostic.code),
    )}`,
  ).toBeTruthy();
  expect(result.rolledBack).toBe(false);
  expect(result.createdEntityIds.featureIds.length).toBe(1);
  const finalSnapshot = await service.getCurrentDocumentSnapshot();
  expect(
    finalSnapshot.document.bodies.some(
      (body) => body.label === "Imported baked body",
    ),
    "A baked body should be materialized in the final snapshot.",
  ).toBeTruthy();
});

function explicitFramePlaneAction() {
  return {
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace" as DocumentId,
    baseRevisionId: "rev_ignored" as RevisionId,
    featureLabel: "Imported datum plane",
    definition: {
      kind: "plane" as const,
      featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
      parameters: {
        mode: "explicitFrame" as const,
        frame: {
          origin: [0, 0, 0] as const,
          xAxis: [1, 0, 0] as const,
          yAxis: [0, 1, 0] as const,
          normal: [0, 0, 1] as const,
          linearUnit: "documentLength" as const,
          handedness: "rightHanded" as const,
        },
      },
    },
  };
}

test("applyImportPreparedActions applies a plane -> sketch -> extrude chain via constructionOf and regionOf", async () => {
  const { service } = createTestModelingService();
  const snapshot = await service.getCurrentDocumentSnapshot();
  const { action: sketchAction, selectorPoint } =
    await translatedFixtureSketchAction();
  const actions: ImportPreparedActions = {
    createFeatures: [
      explicitFramePlaneAction() as ImportPreparedActions["createFeatures"] extends
        | (infer Entry)[]
        | undefined
        ? Entry
        : never,
      extrudeRequest({
        featureLabel: "Extrude on translated plane",
        profileActionIndex: 1,
        selectorPoint,
      }) as ImportPreparedActions["createFeatures"] extends
        | (infer Entry)[]
        | undefined
        ? Entry
        : never,
    ],
    commitSketches: [
      {
        ...sketchAction,
        plane: {
          ...sketchAction.plane,
          support: { kind: "constructionOf" as const, actionIndex: 0 },
        },
      },
    ],
    orderedActions: [
      { kind: "createFeature", index: 0 },
      { kind: "commitSketch", index: 0 },
      { kind: "createFeature", index: 1 },
    ],
  };

  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: snapshot.document.revisionId,
    actions,
  });

  expect(
    result.diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    `A plane\u2192sketch\u2192extrude chain must apply cleanly; diagnostics: ${JSON.stringify(
      result.diagnostics.map((diagnostic) => diagnostic.message),
    )}`,
  ).toBeTruthy();
  expect(
    result.createdEntityIds.featureIds.length,
    "The plane feature and the extrude feature must both be created.",
  ).toBe(2);
  expect(
    result.createdEntityIds.sketchIds.length,
    "The dependent sketch must commit on the resolved construction support.",
  ).toBe(1);
  expect(result.rolledBack).toBe(false);

  const finalSnapshot = await service.getCurrentDocumentSnapshot();
  const committed = finalSnapshot.document.sketches.find(
    (entry) => entry.sketchId === result.createdEntityIds.sketchIds[0],
  );
  expect(
    committed?.plane.support.kind === "construction",
    "The committed sketch's support must be a concrete construction the plane feature produced.",
  ).toBeTruthy();
  expect(
    finalSnapshot.document.bodies.length,
    "The extrude on the translated plane's sketch must produce a solid body.",
  ).toBeGreaterThanOrEqual(1);
});

test("applyImportPreparedActions rolls back atomically when a constructionOf producer emits no construction", async () => {
  const { service } = createTestModelingService();
  // Stub createFeature to succeed but produce no construction target, so the
  // deferred constructionOf reference cannot resolve at apply time.
  recordSuccessfulCreateFeatureInputs(service);
  const snapshot = await service.getCurrentDocumentSnapshot();
  const { action: sketchAction } = await translatedFixtureSketchAction();
  let rolledBackCount: number | null = null;
  const actions: ImportPreparedActions = {
    createFeatures: [
      explicitFramePlaneAction() as ImportPreparedActions["createFeatures"] extends
        | (infer Entry)[]
        | undefined
        ? Entry
        : never,
    ],
    commitSketches: [
      {
        ...sketchAction,
        plane: {
          ...sketchAction.plane,
          support: { kind: "constructionOf" as const, actionIndex: 0 },
        },
      },
    ],
    orderedActions: [
      { kind: "createFeature", index: 0 },
      { kind: "commitSketch", index: 0 },
    ],
  };

  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: snapshot.document.revisionId,
    actions,
    rollback: async (count) => {
      rolledBackCount = count;
    },
  });

  expect(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "import-apply-failed" &&
        diagnostic.message.includes("produced no construction id"),
    ),
    `The failure must name the unresolvable construction producer; diagnostics: ${JSON.stringify(
      result.diagnostics.map((diagnostic) => diagnostic.message),
    )}`,
  ).toBeTruthy();
  expect(
    rolledBackCount,
    "The applied plane-feature operation must be rolled back atomically.",
  ).toBe(1);
  expect(result.rolledBack).toBe(true);
  expect(result.createdEntityIds.sketchIds.length).toBe(0);
});
