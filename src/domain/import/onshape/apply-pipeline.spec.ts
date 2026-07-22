import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test, expect } from "vitest";
import { ResultAsync, createAppError } from "@/contracts/errors";

import type { ImportPreparedActions } from "@/contracts/import/actions";
import type {
  HistoryProbeTopologySignature,
  ImportCapabilities,
} from "@/contracts/import/capabilities";
import type { OnshapeCaptureBundleV2 } from "@/contracts/import/onshape-capture-bundle";
import type { ResolvedImportSource } from "@/contracts/import/source";
import type {
  CommitSketchRequest,
  CreateFeatureRequest,
} from "@/contracts/modeling/schema";
import {
  CONTRACT_VERSION,
  PLANE_FEATURE_SCHEMA_VERSION,
  SHELL_FEATURE_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from "@/contracts/modeling/advanced-solid";
import { validateFeatureDefinitionAuthoredValueInvariants } from "@/contracts/modeling/feature-authored-values";
import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import { assembleFixtureCaptureBundle } from "@/cli/commands/onshape-capture/fixtures/capture-bundle-fixture";
import { FIXTURE_PART_STUDIO_ID } from "@/cli/commands/onshape-capture/fixtures/capture-bundle-fixture";
import { onshapeImportProvider } from "@/domain/import/onshape/provider";
import { makeWaveARevolveCaptureBundle } from "@/domain/import/onshape/wave-a-capture-fixtures";
import {
  makeWaveBBodyCaptureBundle,
  makeWaveBHoleCaptureBundle,
  makeWaveBSegmentedApplyCaptureBundle,
} from "@/domain/import/onshape/wave-b-capture-fixtures";
import { makeWaveWPatternCaptureBundle } from "@/domain/import/onshape/wave-w-pattern-capture-fixtures";
import {
  applyImportPreparedActions,
  createImportCapabilities,
  prepareImportActions,
} from "@/domain/import/orchestrator";
import { prepareRollbackCheckpointBake } from "@/domain/import/onshape/rollback-bake";
import {
  readPartStudio,
  type OnshapeSketchConstraint,
} from "@/domain/import/onshape/bundle-reader";
import {
  projectPointToPlane,
  translateSketch,
  verifySketchTranslationSolveConsistency,
} from "@/domain/import/onshape/sketch-translator";
import { createModelingService } from "@/domain/modeling/modeling-service";
import { createMemoryGeometryAssetStore } from "@/domain/modeling/geometry-asset-store";
import { createGeometryAssetComposition } from "@/infrastructure/modeling/browser-geometry-asset-store";
import type { ModelingService } from "@/domain/modeling/modeling-service";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { createKernelHistoryProbeSession } from "@/domain/import/kernel-history-probe";
import { deriveLiveBodySignatures } from "@/domain/import/live-body-signatures";
import type { SketchSolverAdapter } from "@/contracts/solver/adapter";
import type { BodyId, DocumentId, FaceId, RevisionId, SketchPointId } from "@/contracts/shared/ids";
import boxFixture from "@/domain/modeling/occ/fixtures/topology-signatures/box.payload.json";
import {
  createOccNativeExactBrepPayloadFromShimPayload,
  parseNativeShimPayloadJson,
} from "@/domain/modeling/occ/native-topology-payload";

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

function fixtureRelationship(
  constraintType: string,
  entityId: string,
  parameters: OnshapeSketchConstraint["parameters"],
): OnshapeSketchConstraint {
  return { constraintType, entityId, parameters };
}

async function verifiedConstrainedLineAction(length: number) {
  const translation = translateSketch({
    featureId: "fixture_constrained_line",
    label: "Constrained fixture line",
    planeKey: "xy",
    entities: [
      {
        entityId: "line",
        entityType: "lineSegment",
        start: [0, 0],
        end: [10, 0],
      },
    ],
    constraints: [
      fixtureRelationship("HORIZONTAL", "horizontal", [
        { parameterId: "localFirst", value: "line", hasExternalQuery: false },
      ]),
      fixtureRelationship("LENGTH", "length", [
        { parameterId: "localFirst", value: "line", hasExternalQuery: false },
        { parameterId: "length", value: length, hasExternalQuery: false },
      ]),
    ],
  });
  const verified = await verifySketchTranslationSolveConsistency({
    solver: createRevisionAgnosticRealSolver(),
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace" as DocumentId,
    revisionId: "rev_0001" as RevisionId,
    sketchId: "sketch_import_consistency" as never,
    plane: translation.plane,
    definition: translation.definition,
    relationshipSummary: translation.relationshipSummary,
  });

  return {
    translation,
    verified,
    action: {
      contractVersion: CONTRACT_VERSION,
      documentId: "doc_workspace" as DocumentId,
      baseRevisionId: "rev_ignored" as RevisionId,
      solverCorrelation: {
        requestId: "request_import_consistency",
        projectionRequestId: "request_import_consistency_project",
        validationRequestId: "request_import_consistency_validate",
        solveRequestId: "request_import_consistency_solve",
        regionRequestId: "request_import_consistency_regions",
      },
      sketchId: null,
      sketchLabel: "Constrained fixture line",
      plane: translation.plane,
      definition: verified.definition,
    },
  };
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

type CustomOpenCascadeMainJSForImportTest = new (
  module: Record<string, unknown>,
) => Promise<OpenCascadeInstance>;

let realOccImportTestRuntime: Promise<OpenCascadeInstance> | null = null;

function loadRealOccForImportTest() {
  realOccImportTestRuntime ??= (async () => {
    const module = (await import("../../../../public/cadara-occ.js")) as {
      default: CustomOpenCascadeMainJSForImportTest;
    };
    const wasmBinary = new Uint8Array(
      await readFile(new URL("../../../../public/cadara-occ.wasm", import.meta.url)),
    );
    return new module.default({ wasmBinary });
  })();
  return realOccImportTestRuntime;
}

function createRealOccModelingService(oc: OpenCascadeInstance) {
  const createSolver = (revisionId: RevisionId | null) =>
    new SketchConstraintSolverAdapter({
      documentId: "doc_workspace" as DocumentId,
      revisionId,
    });
  const adapter = new OpenCascadeKernelAdapter({
    solverAdapter: createSolver(null),
    solverAdapterFactory: createSolver,
    getOpenCascadeInstance: async () => oc,
  });
  const service = createModelingService(adapter, {
    currentDocumentId: "doc_workspace",
    sketchSolver: createSolver(null),
  });
  return { adapter, service };
}

function signatureRadius(signature: HistoryProbeTopologySignature) {
  const radius = (signature.definingData as { radius?: unknown } | undefined)?.radius;
  return typeof radius === "number" ? radius : null;
}

function makeRealOccHoleReviewBundle() {
  const bundle = structuredClone(makeWaveBHoleCaptureBundle());
  const low = { x: -0.004, y: -0.00397084, z: 0 };
  const high = { x: 0.004, y: 0.00397084, z: 0.01 };
  for (const studio of bundle.partStudios) {
    for (const snapshot of studio.rollbackSnapshots ?? []) {
      for (const body of snapshot.tessellatedFaces.bodies) {
        body.faces = [{
          id: `${body.id}_face`,
          facets: [
            { vertices: [low, { x: high.x, y: low.y, z: low.z }, high] },
            { vertices: [low, high, { x: low.x, y: high.y, z: high.z }] },
          ],
        }];
      }
    }
  }
  return bundle;
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

function shellOffsetAllFacesRequest(bodyId: BodyId): CreateFeatureRequest {
  return {
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace",
    baseRevisionId: "rev_ignored" as RevisionId,
    featureLabel: "Shell offset all faces",
    definition: {
      kind: "shell",
      featureTypeVersion: SHELL_FEATURE_SCHEMA_VERSION,
      parameters: {
        mode: "offsetAllFaces",
        bodyTarget: { kind: "body", bodyId },
        faceTargets: [],
        thickness: { source: "literal", value: 2.5 },
        direction: "inside",
        operation: { source: "literal", value: "newBody" },
        booleanScope: { kind: "standalone" },
      },
    },
  };
}

async function translatedFixtureSketchAction() {
  const bundle = await assembleFixtureCaptureBundle();
  const mounts = readPartStudio(bundle, FIXTURE_PART_STUDIO_ID);
  for (const solved of mounts.solvedSketchesByFeatureId.values()) {
    const feature = mounts.features.find(
      (entry) => entry.featureId === solved.featureId,
    );
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
      constraints: feature?.constraints,
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

function sketchPointAction() {
  const translation = translateSketch({
    featureId: "import_hole_points",
    label: "Hole point sketch",
    planeKey: "xy",
    entities: [
      {
        entityId: "hole_center",
        entityType: "point",
        position: [0, 0],
      },
    ],
  });
  const pointId = translation.definition.points[0]?.pointId;
  if (!pointId) {
    throw new Error("Hole point translation should produce a sketch point id.");
  }
  return {
    pointId,
    action: {
      contractVersion: CONTRACT_VERSION,
      documentId: "doc_workspace" as DocumentId,
      baseRevisionId: "rev_ignored" as RevisionId,
      solverCorrelation: {
        requestId: "request_import_hole_point",
        projectionRequestId: "request_import_hole_point_project",
        validationRequestId: "request_import_hole_point_validate",
        solveRequestId: "request_import_hole_point_solve",
        regionRequestId: "request_import_hole_point_regions",
      },
      sketchId: null,
      sketchLabel: "Hole point sketch",
      plane: translation.plane,
      definition: translation.definition,
    },
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
        revisionState: { kind: "accepted" as const },
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

// Seam tests: prepared actions must apply cleanly through the modeling service.
// Most tests below use the mock kernel adapter for speed; the hole acceptance
// case uses the real OCC adapter to pin kernel execution. Provider-produced
// fixture coverage below protects Onshape translation.
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

test("generic deferred sketch-point participants apply authored hole features through the mock kernel", async () => {
  const adapter = new MockKernelAdapter();
  const service = createModelingService(adapter, {
    currentDocumentId: "doc_workspace",
  });
  const requests = recordCreateFeatureInputs(service);
  const before = await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace",
  });
  const { action: pointSketchAction, pointId } = sketchPointAction();
  const actions: ImportPreparedActions = {
    commitSketches: [pointSketchAction],
    createFeatures: [
      {
        contractVersion: CONTRACT_VERSION,
        documentId: "doc_workspace" as DocumentId,
        baseRevisionId: "rev_ignored" as RevisionId,
        featureLabel: "Imported through-all hole",
        definition: {
          kind: "hole",
          featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
          parameters: {
            participants: [
              {
                role: "location",
                targets: [
                  {
                    kind: "sketchPoint",
                    sketchId: { kind: "sketchIdOf", actionIndex: 0 },
                    pointId: pointId as SketchPointId,
                  },
                ],
              },
              {
                role: "body",
                targets: [{ kind: "body", bodyId: "body_part-1" as BodyId }],
              },
            ],
            options: {
              style: "countersink",
              mainDiameter: 1,
              countersinkDiameter: 2,
              countersinkAngleDegrees: 90,
              direction: "forward",
              termination: "throughAll",
            },
          },
        },
      },
    ],
    orderedActions: [
      { kind: "commitSketch", index: 0 },
      { kind: "createFeature", index: 0 },
    ],
  };

  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: before.snapshot.document.revisionId,
    actions,
  });
  const forwarded = requests[0];
  const after = await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace",
  });

  expect(
    forwarded,
    "Hole create request should be forwarded after deferred materialization.",
  ).toBeDefined();
  expect(
    JSON.stringify(forwarded).includes("sketchIdOf"),
    "Forwarded hole requests must not retain deferred sketch ids.",
  ).toBeFalsy();
  expect(
    forwarded.definition.kind === "hole" &&
      forwarded.definition.parameters.participants[0]?.targets[0]?.kind ===
        "sketchPoint" &&
      typeof forwarded.definition.parameters.participants[0].targets[0].sketchId ===
        "string",
    "Deferred sketchIdOf should materialize to a live sketchPoint participant.",
  ).toBeTruthy();
  expect(
    result.diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    "Applying the materialized hole through the mock kernel should succeed.",
  ).toBeTruthy();
  expect(
    result.createdEntityIds.featureIds.length,
    "The authored hole action should create a feature.",
  ).toBe(1);
  expect(
    after.snapshot.document.bodies.some((body) => body.bodyId === "body_part-1"),
    "Mock hole application should keep the scoped base body live.",
  ).toBeTruthy();
});

test("Onshape hole fixture translates through provider and applies with materialized sketch points", async () => {
  const { adapter, service } = createTestModelingService();
  const before = await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace",
  });
  const capabilities = createImportCapabilities(service, before.snapshot, {
    history: {
      async evaluateHistoryProbe(input) {
        const count = input.actions.orderedActions?.length ?? 0;
        return {
          steps: Array.from({ length: count }, (_, index) => ({
            status: "rebuilt" as const,
            signatures: index >= 1
              ? [{
                  entityClass: "body" as const,
                  geometryType: "solid",
                  boundingBox: { low: [-4, -3, 12] as [number, number, number], high: [4, 3, 12] as [number, number, number] },
                  centroid: [0, 0, 12] as [number, number, number],
                  reference: { kind: "body" as const, bodyId: "probe_hole_body" as never },
                }]
              : [],
          })),
        };
      },
    },
  });
  const source = sourceFromBundle(makeWaveBHoleCaptureBundle());
  const review = await onshapeImportProvider.review({ source, capabilities });
  const plans = review.providerReview.studios.flatMap((studio) => studio.featurePlans);
  expect(plans.filter((plan) => plan.featureType === "hole").map((plan) => plan.reasonCodes), JSON.stringify(plans)).toEqual([[], [], []]);

  const actions = await prepareImportActions({
    provider: onshapeImportProvider,
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities,
  });
  const preparedHole = actions.createFeatures?.find((request) => request.definition.kind === "hole");
  expect(preparedHole?.definition.parameters.participants).toEqual(expect.arrayContaining([
    expect.objectContaining({ role: "location", targets: [expect.objectContaining({ kind: "sketchPoint", sketchId: expect.objectContaining({ kind: "sketchIdOf" }) })] }),
  ]));

  const requests = recordCreateFeatureInputs(service);
  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: before.snapshot.document.revisionId,
    actions,
  });
  expect(result.diagnostics.every((diagnostic) => diagnostic.severity !== "error"), JSON.stringify(result.diagnostics)).toBe(true);
  const forwardedHoles = requests.filter((request) => request.definition.kind === "hole");
  expect(forwardedHoles).toHaveLength(1);
  expect(JSON.stringify(forwardedHoles)).not.toContain("sketchIdOf");
  expect(forwardedHoles.every((request) =>
    request.definition.kind === "hole" &&
    request.definition.parameters.participants.some((participant) =>
      participant.role === "location" &&
      participant.targets.every((target) => target.kind === "sketchPoint" && typeof target.sketchId === "string"),
    ),
  )).toBe(true);
  const after = await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace",
  });
  expect(after.snapshot.document.bodies.length).toBeGreaterThan(0);
});

test("Onshape hole fixture applies through the real OCC import service with materialized locations", async () => {
  const oc = await loadRealOccForImportTest();
  const bundle = makeRealOccHoleReviewBundle();
  const source = sourceFromBundle(bundle);

  async function prepareAndApplyHoleStudio(elementId: string) {
    const { service } = createRealOccModelingService(oc);
    const before = await service.getCurrentDocumentSnapshot();
    const capabilities = createImportCapabilities(service, before, {
      history: createKernelHistoryProbeSession({
        createService: () => createRealOccModelingService(oc).service,
      }),
    });
    const review = await onshapeImportProvider.review({ source, capabilities });
    const plans = review.providerReview.studios
      .find((studio) => studio.elementId === elementId)
      ?.featurePlans ?? [];
    const holePlan = plans.find((plan) => plan.featureType === "hole");
    expect(holePlan, JSON.stringify(plans)).toMatchObject({
      tier: "parametric",
      reasonCodes: [],
    });

    const actions = await prepareImportActions({
      provider: onshapeImportProvider,
      source,
      review,
      selections: { studioElementId: elementId, demotedFeatureIds: [] },
      capabilities,
    });
    const preparedHoles = actions.createFeatures?.filter(
      (request) => request.definition.kind === "hole",
    ) ?? [];
    expect(preparedHoles, JSON.stringify(actions)).toHaveLength(1);
    expect(JSON.stringify(preparedHoles)).toContain("sketchIdOf");

    const forwarded = recordCreateFeatureInputs(service);
    const result = await applyImportPreparedActions({
      modelingService: service,
      baseRevisionId: before.document.revisionId,
      actions,
    });
    expect(
      result.diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
      JSON.stringify(result.diagnostics),
    ).toBe(true);
    expect(result.rolledBack).toBe(false);

    const forwardedHole = forwarded.find((request) => request.definition.kind === "hole");
    expect(forwardedHole, JSON.stringify(forwarded)).toBeDefined();
    const forwardedHoleJson = JSON.stringify(forwardedHole);
    expect(forwardedHoleJson).not.toContain("sketchIdOf");
    expect(forwardedHoleJson).not.toContain("sketchPointFromFeature");
    expect(forwardedHoleJson).not.toContain("bodyOf");
    expect(
      forwardedHole?.definition.kind === "hole" &&
        forwardedHole.definition.parameters.participants.some((participant) =>
          participant.role === "location" &&
          participant.targets.every(
            (target) =>
              target.kind === "sketchPoint" &&
              typeof target.sketchId === "string" &&
              typeof target.pointId === "string",
          ),
        ),
      "Deferred sketchPoint targets should materialize to live sketchId/pointId values.",
    ).toBe(true);

    const after = await service.getCurrentDocumentSnapshot();
    expect(after.document.bodies.length, "Hole application should retain the scoped body.").toBe(1);
    const signatureResult = await deriveLiveBodySignatures({ snapshot: after, service });
    expect(signatureResult.status, JSON.stringify(signatureResult.diagnostics)).toBe("available");
    if (signatureResult.status !== "available") throw new Error("Expected live OCC topology signatures.");
    expect(
      signatureResult.diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
      JSON.stringify(signatureResult.diagnostics),
    ).toBe(true);
    return { result, signatures: signatureResult.signatures };
  }

  const simple = await prepareAndApplyHoleStudio("wave-b-hole-simple");
  const simpleCylinderRadii = simple.signatures
    .filter((signature) => signature.entityClass === "face" && signature.geometryType === "cylinder")
    .map(signatureRadius)
    .filter((radius): radius is number => radius !== null);
  expect(
    simpleCylinderRadii.some((radius) => Math.abs(radius - 2) < 0.05),
    JSON.stringify(simple.signatures),
  ).toBe(true);

  const countersink = await prepareAndApplyHoleStudio("wave-b-hole-countersink");
  expect(
    countersink.signatures.some(
      (signature) => signature.entityClass === "face" && signature.geometryType === "cone",
    ),
    JSON.stringify(countersink.signatures),
  ).toBe(true);
});


test("Onshape pattern fixture applies through provider and mock kernel without unresolved refs", async () => {
  const { adapter, service } = createTestModelingService();
  const before = await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace",
  });
  const capabilities = createImportCapabilities(service, before.snapshot, {
    history: {
      async evaluateHistoryProbe(input) {
        const signatures = [
          { entityClass: "body" as const, geometryType: "solid", boundingBox: { low: [0, 0, 0] as [number, number, number], high: [2, 2, 2] as [number, number, number] }, centroid: [1, 1, 1] as [number, number, number], reference: { kind: "body" as const, bodyId: "probe_linear" as never } },
          { entityClass: "body" as const, geometryType: "solid", boundingBox: { low: [10, -0.992709, 0] as [number, number, number], high: [12, 0.992709, 2] as [number, number, number] }, centroid: [11, 0, 1] as [number, number, number], reference: { kind: "body" as const, bodyId: "probe_circular" as never } },
        ];
        return { steps: (input.actions.orderedActions ?? []).map(() => ({ status: "rebuilt" as const, signatures })) };
      },
    },
  });
  const source = sourceFromBundle(makeWaveWPatternCaptureBundle());
  const review = await onshapeImportProvider.review({ source, capabilities });
  const actions = await prepareImportActions({
    provider: onshapeImportProvider,
    source,
    review,
    selections: { studioElementId: "wave-w-pattern-linear", demotedFeatureIds: [] },
    capabilities,
  });
  const preparedPattern = actions.createFeatures?.find((request) => request.definition.kind === "linearPattern");
  expect(JSON.stringify(preparedPattern)).toContain("topologyOf");
  expect(JSON.stringify(preparedPattern)).toContain("sketchIdOf");
  if (preparedPattern?.definition.kind === "linearPattern") {
    preparedPattern.definition.parameters.participants = preparedPattern.definition.parameters.participants.map((participant) =>
      participant.role === "body"
        ? { ...participant, targets: [{ kind: "body" as const, bodyId: "body_part-1" as BodyId }] }
        : participant,
    );
    preparedPattern.topologyFallback = undefined;
  }

  const forwarded = recordCreateFeatureInputs(service);
  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: before.snapshot.document.revisionId,
    actions,
  });
  expect(result.diagnostics.every((diagnostic) => diagnostic.severity !== "error"), JSON.stringify(result.diagnostics)).toBe(true);
  const forwardedPattern = forwarded.find((request) => request.definition.kind === "linearPattern");
  expect(forwardedPattern, JSON.stringify(forwarded)).toBeDefined();
  const forwardedJson = JSON.stringify(forwardedPattern);
  expect(forwardedJson).not.toContain("topologyOf");
  expect(forwardedJson).not.toContain("sketchIdOf");
  expect(forwardedJson).not.toContain("sketchEntityFromFeature");
  expect(result.createdEntityIds.featureIds.length).toBeGreaterThan(0);
});

test("Onshape circular pattern fixture applies through the real OCC import service in four quadrants", async () => {
  const oc = await loadRealOccForImportTest();
  const { service } = createRealOccModelingService(oc);
  const before = await service.getCurrentDocumentSnapshot();
  const capabilities = createImportCapabilities(service, before, {
    history: createKernelHistoryProbeSession({
      createService: () => createRealOccModelingService(oc).service,
    }),
  });
  const source = sourceFromBundle(makeWaveWPatternCaptureBundle());
  const review = await onshapeImportProvider.review({ source, capabilities });
  const circularPlan = review.providerReview.studios
    .find((studio) => studio.elementId === "wave-w-pattern-circular")
    ?.featurePlans.find((plan) => plan.featureType === "circularPattern");
  expect(circularPlan, JSON.stringify(review.providerReview.studios)).toMatchObject({
    tier: "parametric",
    reasonCodes: [],
  });
  const actions = await prepareImportActions({
    provider: onshapeImportProvider,
    source,
    review,
    selections: { studioElementId: "wave-w-pattern-circular", demotedFeatureIds: [] },
    capabilities,
  });
  const forwarded = recordCreateFeatureInputs(service);
  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: before.document.revisionId,
    actions,
  });
  expect(result.diagnostics.every((diagnostic) => diagnostic.severity !== "error"), JSON.stringify(result.diagnostics)).toBe(true);
  const forwardedPattern = forwarded.find((request) => request.definition.kind === "circularPattern");
  expect(forwardedPattern, JSON.stringify(forwarded)).toBeDefined();
  const forwardedJson = JSON.stringify(forwardedPattern);
  expect(forwardedJson).not.toContain("topologyOf");
  expect(forwardedJson).not.toContain("sketchIdOf");

  const after = await service.getCurrentDocumentSnapshot();
  expect(after.document.bodies.length).toBe(4);
  const signatureResult = await deriveLiveBodySignatures({ snapshot: after, service });
  expect(signatureResult.status, JSON.stringify(signatureResult.diagnostics)).toBe("available");
  if (signatureResult.status !== "available") throw new Error("Expected live OCC topology signatures.");
  const bodyBoxes = signatureResult.signatures
    .filter((signature) => signature.entityClass === "body" && signature.boundingBox)
    .map((signature) => signature.boundingBox!);
  const centers = bodyBoxes.map((box) => [
    (box.low[0] + box.high[0]) / 2,
    (box.low[1] + box.high[1]) / 2,
  ] as const);
  expect(centers.some(([x, y]) => x > 9 && Math.abs(y) < 2), JSON.stringify(bodyBoxes)).toBe(true);
  expect(centers.some(([x, y]) => y > 9 && Math.abs(x) < 2), JSON.stringify(bodyBoxes)).toBe(true);
  expect(centers.some(([x, y]) => x < -9 && Math.abs(y) < 2), JSON.stringify(bodyBoxes)).toBe(true);
  expect(centers.some(([x, y]) => y < -9 && Math.abs(x) < 2), JSON.stringify(bodyBoxes)).toBe(true);
});

test("segmented provider actions apply two checkpoints with rematch, closure, fallback, and neutral continuation", async () => {
  const bundle = makeWaveBSegmentedApplyCaptureBundle();
  const source = sourceFromBundle(bundle);
  const assetStore = createMemoryGeometryAssetStore();
  const emptySnapshot = {
    document: { documentId: "doc_workspace", revisionId: "rev_segment_0" },
  } as never;
  const signature = (
    bodyId: string,
    low: [number, number, number],
    high: [number, number, number],
  ) => ({
    entityClass: "body" as const,
    geometryType: "solid",
    boundingBox: { low, high },
    centroid: [
      (low[0] + high[0]) / 2,
      (low[1] + high[1]) / 2,
      (low[2] + high[2]) / 2,
    ] as [number, number, number],
    reference: { kind: "body" as const, bodyId: bodyId as never },
  });
  const capabilities = createImportCapabilities({} as never, emptySnapshot, {
    assetStore,
    history: {
      async evaluateHistoryProbe(input) {
        const labels = (input.actions.createFeatures ?? []).map(
          (request) => request.featureLabel,
        );
        const afterSecondCheckpoint = labels.some((label) =>
          label === "Boolean after first checkpoint",
        );
        return {
          steps: (input.actions.orderedActions ?? []).map(() => ({
            status: "rebuilt" as const,
            signatures: afterSecondCheckpoint
              ? [
                  signature("probe-A-two", [0, 0, 0], [50, 50, 50]),
                  signature("probe-B-two", [30, 0, 0], [41, 11, 11]),
                ]
              : [
                  signature("probe-A-one", [0, 0, 0], [12, 12, 12]),
                  signature("probe-B-one", [30, 0, 0], [40, 10, 10]),
                ],
          })),
        };
      },
    },
  });
  const review = await onshapeImportProvider.review({ source, capabilities });
  const studio = review.providerReview.studios[0];
  expect(
    studio?.featurePlans.find((plan) => plan.onshapeFeatureId === "BOOLEAN"),
    JSON.stringify(studio?.featurePlans),
  ).toMatchObject({ tier: "parametric", reasonCodes: [] });
  expect(
    studio?.featurePlans.find((plan) => plan.onshapeFeatureId === "MOVE_AFTER"),
    JSON.stringify(studio?.featurePlans),
  ).toMatchObject({ tier: "parametric", reasonCodes: [] });
  expect(studio?.bakeStrategy).toMatchObject({
    kind: "segments",
    segments: [
      {
        boundaryFeatureId: "ROTATE_ONE",
        checkpointBodyDeterministicIds: ["A", "B"],
        carriedBodyDeterministicIds: ["B"],
        replacementProducerFeatureIds: ["E_BASE"],
      },
      {
        boundaryFeatureId: "ROTATE_TWO",
        checkpointBodyDeterministicIds: ["A", "B"],
        carriedBodyDeterministicIds: ["B"],
        replacementProducerFeatureIds: ["BOOLEAN"],
      },
    ],
  });

  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities,
  });
  const checkpointRequests = (actions.createFeatures ?? []).filter(
    (request) => request.definition.kind === "bakedBody",
  );
  expect(checkpointRequests).toHaveLength(2);
  expect(
    actions.orderedActions?.filter((action) => action.kind === "addDocumentVariable"),
  ).toHaveLength(3);
  const booleanRequest = actions.createFeatures?.find(
    (request) => request.definition.kind === "combine",
  );
  const moveRequest = actions.createFeatures?.find(
    (request) => request.featureLabel === "Move after second checkpoint",
  );
  expect(JSON.stringify(booleanRequest)).toContain("topologyOf");
  expect(JSON.stringify(moveRequest)).toContain("topologyOf");
  expect(moveRequest?.topologyFallback?.definition.kind).toBe("bakedBody");

  type LiveBody = {
    id: string;
    low: [number, number, number];
    high: [number, number, number];
  };
  const { service: backingService } = createTestModelingService();
  const backingInitialSnapshot = await backingService.getCurrentDocumentSnapshot();
  let revision = 0;
  let currentRevisionId = backingInitialSnapshot.document.revisionId;
  let liveBodies: LiveBody[] = [];
  const created: CreateFeatureRequest[] = [];
  const appliedVariables: string[] = [];
  const workspaceSnapshot = async () => {
    const backingSnapshot = await backingService.getCurrentDocumentSnapshot();
    return {
      ...backingSnapshot,
      document: {
        ...backingSnapshot.document,
        revisionId: currentRevisionId,
        bodies: liveBodies.map((body) => ({
          bodyId: body.id,
          topologyPresentation: "bodyOnlyMesh",
        })),
        render: {
          ...backingSnapshot.document.render,
          records: liveBodies.map((body) => ({
            ownerBodyId: body.id,
            geometry: {
              kind: "mesh",
              vertexPositions: [
                body.low,
                [body.high[0], body.low[1], body.low[2]],
                [body.low[0], body.high[1], body.low[2]],
                body.high,
              ],
            },
          })),
        },
      },
    } as never;
  };
  const success = (changedTargets: { kind: "body"; bodyId: string }[] = []) => {
    revision += 1;
    currentRevisionId = `rev_segment_${revision}` as RevisionId;
    return {
      revisionId: currentRevisionId,
      featureId: `feature_segment_${revision}` as never,
      revisionState: { kind: "accepted" as const },
      rebuildResult: "rebuilt" as const,
      changedTargets,
      diagnostics: [],
    };
  };
  const service = {
    async getCurrentDocumentSnapshot() {
      return workspaceSnapshot();
    },
    async buildNativeExactBrepPayload() {
      throw new Error("Body-only checkpoint meshes must not request native topology.");
    },
    addDocumentVariable(request: { name: string }) {
      appliedVariables.push(request.name);
      const result = success();
      return ResultAsync.fromPromise(
        Promise.resolve({
          ...result,
          variableId: `variable_segment_${revision}` as never,
        }),
        (error) => createAppError({ code: "unknown", message: String(error) }),
      );
    },
    commitSketch(request: Parameters<ModelingService["commitSketch"]>[0]) {
      return backingService.commitSketch(request).map((result) => {
        currentRevisionId = result.revisionId;
        return result;
      });
    },
    createFeature(request: CreateFeatureRequest) {
      created.push(request);
      if (request.definition.kind === "extrude") {
        liveBodies = [
          { id: "live-base-A", low: [0, 0, 0], high: [10, 10, 10] },
          { id: "live-base-B", low: [30, 0, 0], high: [40, 10, 10] },
        ];
      } else if (request.definition.kind === "combine") {
        expect(JSON.stringify(request)).not.toContain("topologyOf");
        expect(request.definition.parameters.participants.map(
          (participant) => participant.role,
        )).toEqual(["targetBody", "toolBody"]);
        liveBodies = [
          { id: "live-boolean-A", low: [0, 0, 0], high: [45, 45, 45] },
          { id: "live-boolean-B", low: [30, 0, 0], high: [41, 11, 11] },
        ];
      } else if (request.definition.kind === "bakedBody") {
        const toFeatureId = request.definition.parameters.provenance.featureSpan?.toFeatureId;
        if (toFeatureId === "ROTATE_ONE") {
          expect(request.definition.parameters.replacement).toEqual({
            kind: "replaceBodies",
            bodyIds: ["live-base-A", "live-base-B"],
          });
          liveBodies = [
            { id: "live-checkpoint-one-A", low: [0, 0, 0], high: [12, 12, 12] },
            { id: "live-checkpoint-one-B", low: [30, 0, 0], high: [40, 10, 10] },
          ];
        } else if (toFeatureId === "ROTATE_TWO") {
          expect(request.definition.parameters.replacement).toEqual({
            kind: "replaceBodies",
            bodyIds: ["live-boolean-A", "live-boolean-B"],
          });
          // Deliberately coincident apply-time bodies force MOVE_AFTER to use
          // its same-position post-feature fallback.
          liveBodies = [
            { id: "live-checkpoint-two-A", low: [0, 0, 0], high: [50, 50, 50] },
            { id: "live-checkpoint-two-B", low: [0, 0, 0], high: [50, 50, 50] },
          ];
        } else if (toFeatureId === "MOVE_AFTER") {
          expect(request.definition.parameters.replacement).toEqual({
            kind: "replaceBodies",
            bodyIds: ["live-checkpoint-two-A", "live-checkpoint-two-B"],
          });
          liveBodies = [
            { id: "live-fallback-A", low: [5, 0, 0], high: [55, 50, 50] },
            { id: "live-fallback-B", low: [30, 0, 0], high: [41, 11, 11] },
          ];
        }
      }
      const changedTargets = liveBodies.map((body) => ({
        kind: "body" as const,
        bodyId: body.id,
      }));
      return ResultAsync.fromPromise(
        Promise.resolve(success(changedTargets)),
        (error) => createAppError({ code: "unknown", message: String(error) }),
      );
    },
  } as ModelingService;

  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: backingInitialSnapshot.document.revisionId,
    actions,
  });

  expect(
    result.rolledBack,
    JSON.stringify({ result, created, liveBodies, appliedVariables }),
  ).toBe(false);
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "topology-apply-rematch-failed",
  );
  expect(created.filter((request) => request.definition.kind === "bakedBody")).toHaveLength(3);
  expect(created.some((request) => request.definition.kind === "transform")).toBe(false);
  expect(appliedVariables).toEqual([
    "betweenCheckpoints",
    "afterCheckpoints",
    "afterFallback",
  ]);
  expect(liveBodies.map((body) => body.id)).toEqual([
    "live-fallback-A",
    "live-fallback-B",
  ]);
  expect(JSON.stringify(created)).not.toContain("topologyOf");
});

test("legacy v1 preparation and apply remain equivalent with or without history probing", async () => {
  const legacyBundle = structuredClone(
    makeWaveBSegmentedApplyCaptureBundle(),
  ) as unknown as {
    formatVersion: 1;
    partStudios: Array<{ rollbackSnapshots: null }>;
  };
  legacyBundle.formatVersion = 1;
  legacyBundle.partStudios[0]!.rollbackSnapshots = null;
  const source = sourceFromBundle(legacyBundle);
  const assetStore = createMemoryGeometryAssetStore();

  const prepareCase = async (historyProbeAvailable: boolean) => {
    const { resolver } = createGeometryAssetComposition(assetStore);
    const adapter = new MockKernelAdapter({
      solverAdapter: createRevisionAgnosticRealSolver(),
      assetResolver: resolver,
    });
    const service = createModelingService(adapter, {
      currentDocumentId: "doc_workspace",
    });
    const snapshot = await service.getCurrentDocumentSnapshot();
    const capabilities = createImportCapabilities(service, snapshot, {
      assetStore,
      history: historyProbeAvailable
        ? {
            async evaluateHistoryProbe(input) {
              return {
                steps: (input.actions.orderedActions ?? []).map(() => ({
                  status: "rebuilt" as const,
                  signatures: [],
                })),
              };
            },
          }
        : undefined,
    });
    const review = await onshapeImportProvider.review({ source, capabilities });
    expect(review.providerReview.studios[0]?.bakeStrategy).toEqual({
      kind: "wholeStudioLegacy",
      reason: "capture-v1",
    });
    const actions = await onshapeImportProvider.prepare({
      source,
      review,
      selections: onshapeImportProvider.createDefaultSelections(review),
      capabilities,
    });
    return { actions, service, snapshot };
  };

  const withoutHistory = await prepareCase(false);
  const withHistory = await prepareCase(true);
  const actionShape = (actions: ImportPreparedActions) => ({
    addDocumentVariables: actions.addDocumentVariables,
    commitSketches: actions.commitSketches,
    createFeatures: actions.createFeatures,
    orderedActions: actions.orderedActions,
  });
  expect(actionShape(withHistory.actions)).toEqual(actionShape(withoutHistory.actions));
  const bakedIndexes = (withoutHistory.actions.createFeatures ?? []).flatMap(
    (request, index) => request.definition.kind === "bakedBody" ? [index] : [],
  );
  expect(bakedIndexes).toHaveLength(1);
  expect(withoutHistory.actions.orderedActions?.at(-1)).toEqual({
    kind: "createFeature",
    index: bakedIndexes[0],
  });

  for (const prepared of [withoutHistory, withHistory]) {
    const result = await applyImportPreparedActions({
      modelingService: prepared.service,
      baseRevisionId: prepared.snapshot.document.revisionId,
      actions: prepared.actions,
    });
    expect(
      result.diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
      JSON.stringify(result.diagnostics),
    ).toBe(true);
    expect(result.rolledBack).toBe(false);
  }
});

test("import apply accepts an authored imported two-distance chamfer", async () => {
  const created: CreateFeatureRequest[] = [];
  const service = {
    createFeature(request: CreateFeatureRequest) {
      created.push(request);
      expect(validateFeatureDefinitionAuthoredValueInvariants(request.definition).map((issue) => issue.message)).toEqual([]);
      return ResultAsync.fromPromise(
        Promise.resolve({
          contractVersion: CONTRACT_VERSION,
          revisionId: "rev_chamfer_next" as RevisionId,
          featureId: "feature_chamfer" as const,
          revisionState: { kind: "accepted" as const },
          rebuildResult: "rebuilt" as const,
          changedTargets: [],
          diagnostics: [],
        }),
        (error) => createAppError({ code: "unknown", message: String(error) }),
      );
    },
  } as ModelingService;

  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: "rev_chamfer" as RevisionId,
    actions: {
      createFeatures: [{
        documentId: "doc_workspace" as DocumentId,
        baseRevisionId: "rev_chamfer" as RevisionId,
        definition: {
          kind: "chamfer",
          featureTypeVersion: "advanced-solid-feature/v0",
          parameters: {
            participants: [{
              role: "edge",
              targets: [{ kind: "edge", bodyId: "body_1", edgeId: "edge_1" }],
            }],
            options: {
              widthForm: "twoOffsets",
              distance1: { source: "literal", value: 2 },
              distance2: { source: "literal", value: 3 },
            },
          },
        },
      }],
    },
  });

  expect(result.diagnostics).toEqual([]);
  expect(created).toHaveLength(1);
  expect(created[0]?.definition.kind).toBe("chamfer");
  expect(created[0]?.definition.parameters.options).toMatchObject({
    widthForm: "twoOffsets",
    distance1: { source: "literal", value: 2 },
    distance2: { source: "literal", value: 3 },
});
});

test("compact v2 checkpoint replaces an apply-ambiguous consumer at the same position and later replacements continue", async () => {
  const created: CreateFeatureRequest[] = [];
  const snapshot = {
    document: {
      documentId: "doc_workspace",
      revisionId: "rev_v2",
      bodies: [],
    },
  } as never;
  const service = {
    async getCurrentDocumentSnapshot() {
      return snapshot;
    },
    async buildNativeExactBrepPayload() {
      throw new Error("No live bodies should require payload derivation.");
    },
    createFeature(request: CreateFeatureRequest) {
      created.push(request);
      return ResultAsync.fromPromise(
        Promise.resolve({
          revisionId: "rev_v2_next" as RevisionId,
          featureId: "feature_checkpoint" as const,
          revisionState: { kind: "accepted" as const },
          rebuildResult: "rebuilt" as const,
          changedTargets: created.length === 1
            ? [{ kind: "body" as const, bodyId: "body_checkpoint_live" as const }]
            : [],
          diagnostics: [],
        }),
        (error) => createAppError({ code: "unknown", message: String(error) }),
      );
    },
  } as ModelingService;
  const capabilities = createImportCapabilities(service, snapshot);
  const checkpoint = await prepareRollbackCheckpointBake({
    snapshot: {
      featureId: "F_CHAMFER",
      tessellationTolerance: 0.001,
      tessellatedFaces: {
        bodies: [{
          id: "checkpoint-body",
          faces: [{
            facets: [{
              vertices: [
                { x: 0, y: 0, z: 0 },
                { x: 0.001, y: 0, z: 0 },
                { x: 0, y: 0.001, z: 0 },
              ],
            }],
          }],
        }],
      },
    },
    capabilities,
    featureLabel: "Chamfer checkpoint",
    studioElementId: "studio-v2",
    studioName: "Synthetic v2",
    replacementActionIndexes: [],
  });
  if (checkpoint.kind !== "ready") throw new Error("Expected a v2 checkpoint.");

  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: "rev_v2" as RevisionId,
    actions: {
      createFeatures: [{
        ...checkpoint.request,
        featureLabel: "Deferred combine",
        definition: {
          kind: "combine",
          featureTypeVersion: "advanced-solid-feature/v0",
          parameters: {
            participants: [{
              role: "targetBody",
              targets: [{
                kind: "topologyOf",
                expectedKind: "body",
                capturedSignature: { entityClass: "body", geometryType: "unknown" },
                tolerance: {
                  linear: 0.001,
                  angularRadians: 0.001,
                  relative: 0.000001,
                  ambiguityMargin: 0.000001,
                },
                source: {
                  consumerFeatureId: "F_CHAMFER",
                  parameterId: "targets",
                  deterministicId: "J_BODY",
                },
              }],
            }],
          },
        },
        topologyFallback: checkpoint.request,
      }, {
        ...checkpoint.request,
        featureLabel: "Downstream checkpoint",
        definition: {
          ...checkpoint.request.definition,
          parameters: {
            ...checkpoint.request.definition.parameters,
            replacement: { kind: "replaceBodyOutputs", actionIndexes: [0] },
          },
        },
      }],
      orderedActions: [
        { kind: "createFeature", index: 0 },
        { kind: "createFeature", index: 1 },
      ],
    },
  });

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "topology-apply-rematch-failed",
  );
  expect(created).toHaveLength(2);
  expect(created[0]?.definition.kind).toBe("bakedBody");
  expect(created[1]?.definition.kind).toBe("bakedBody");
  if (created[1]?.definition.kind !== "bakedBody") {
    throw new Error("Expected the downstream checkpoint to apply.");
  }
  expect(created[1].definition.parameters.replacement).toEqual({
    kind: "replaceBodies",
    bodyIds: ["body_checkpoint_live"],
  });
  expect(JSON.stringify(created)).not.toContain("topologyOf");
});

const realBundleCases = [
  [
    "40a51fb8fa82fd4565151114.onshape-capture.json",
    { parametric: 7, baked: 3, geometryOnly: 0 },
  ],
  [
    "9841e486906fa2ce62d74d8e.onshape-capture.json",
    { parametric: 6, baked: 35, geometryOnly: 0 },
  ],
] as const;

test.skipIf(realBundleCases.some(([fileName]) => !existsSync(fileName)))(
  "root capture bundles degrade honestly without a history capability",
  async () => {
  // Without a history capability the static plan keeps honest reasons. A v2
  // capture without rollback snapshots takes the legacy probe-less path and
  // topology consumers carry both evidence-missing codes; a snapshot-backed
  // capture keeps the static needs-history-probe reason. Snapshot presence is
  // derived from the local bundle because captures are refreshed over time.
  for (const [fileName, expectedCounts] of realBundleCases) {
    const bundle = JSON.parse(await readFile(fileName, "utf8"));
    expect(bundle.formatVersion).toBe(2);
    const legacySnapshotless = bundle.partStudios[0]?.rollbackSnapshots === null;
    const { service } = createTestModelingService();
    const snapshot = await service.getCurrentDocumentSnapshot();
    const capabilities = createImportCapabilities(service, snapshot);
    const source = sourceFromBundle(bundle);
    const review = await onshapeImportProvider.review({ source, capabilities });
    expect(review.providerReview.studios[0]?.tierCounts).toEqual(expectedCounts);
    const consumers = review.providerReview.studios[0]?.featurePlans.filter((plan) =>
      ["booleanBodies", "deleteBodies", "transform", "splitPart", "split"].includes(plan.featureType),
    ) ?? [];
    expect(consumers.length).toBeGreaterThan(0);
    for (const consumer of consumers) {
      expect(consumer.tier).toBe("baked");
      if (consumer.featureType === "transform") {
        expect(consumer.reasonCodes.some((reason) =>
          reason === "needs-history-probe" || reason === "transform-rotation-axis-unresolved"
        )).toBe(true);
      } else if (legacySnapshotless) {
        expect(consumer.reasonCodes).toContain("topology-history-evidence-missing");
        expect(consumer.reasonCodes).toContain("topology-bake-snapshot-missing");
      } else {
        expect(consumer.reasonCodes).toContain("needs-history-probe");
      }
    }
    if (legacySnapshotless) {
      expect(
        review.providerReview.studios[0]?.featurePlans.some(
          (plan) =>
            plan.reasonCodes.includes("topology-history-evidence-missing") &&
            plan.reasonCodes.includes("topology-bake-snapshot-missing"),
        ),
      ).toBe(true);
    }
    const actions = await onshapeImportProvider.prepare({
      source,
      review,
      selections: onshapeImportProvider.createDefaultSelections(review),
      capabilities,
    });
    expect(
      actions.createFeatures?.some((request) => request.definition.kind === "bakedBody"),
    ).toBe(true);
  }
});

test.each([
  ["boolean", "combine"],
  ["transform", "transform"],
  ["split", "split"],
  ["delete", "deleteSolid"],
] as const)("applies synthetic v2 extrude topology path for %s with only live durable refs", async (fixtureKind, expectedKind) => {
  const { service } = createTestModelingService();
  const snapshot = await service.getCurrentDocumentSnapshot();
  const capabilities = createImportCapabilities(service, snapshot, {
    history: {
      async evaluateHistoryProbe(input) {
        const count = input.actions.orderedActions?.length ?? 0;
        return {
          steps: Array.from({ length: count }, (_, index) => ({
            status: "rebuilt" as const,
            signatures: [
              ...(index >= 1 ? [{
                entityClass: "body" as const,
                geometryType: "solid",
                boundingBox: { low: [-4, -3, 12] as [number, number, number], high: [4, 3, 12] as [number, number, number] },
                centroid: [0, 0, 12] as [number, number, number],
                reference: { kind: "body" as const, bodyId: "probe_body_1" as never },
              }] : []),
              ...(index >= 3 ? [{
                entityClass: "body" as const,
                geometryType: "solid",
                boundingBox: { low: [-2, -3, 12] as [number, number, number], high: [6, 3, 12] as [number, number, number] },
                centroid: [2, 0, 12] as [number, number, number],
                reference: { kind: "body" as const, bodyId: "probe_body_2" as never },
              }] : []),
            ],
          })),
        };
      },
    },
  });
  const source = sourceFromBundle(makeWaveBBodyCaptureBundle(fixtureKind));
  const review = await onshapeImportProvider.review({ source, capabilities });
  const studio = review.providerReview.studios[0];
  expect(studio?.featurePlans.at(-1), JSON.stringify(studio?.featurePlans)).toMatchObject({ tier: "parametric", reasonCodes: [] });
  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities,
  });
  if (fixtureKind === "boolean" || fixtureKind === "split") {
    const preparedConsumer = actions.createFeatures?.find((request) => request.definition.kind === expectedKind);
    expect(preparedConsumer?.definition.kind).toBe(expectedKind);
    expect(preparedConsumer?.topologyFallback?.definition.kind).toBe("bakedBody");
    expect(JSON.stringify(preparedConsumer)).toContain("topologyOf");
    if (
      preparedConsumer?.definition.kind !== "combine" &&
      preparedConsumer?.definition.kind !== "split"
    ) {
      throw new Error("Expected an ordered Boolean or Split body consumer.");
    }
    expect(
      preparedConsumer.definition.parameters.participants.map(
        (participant) => participant.role,
      ),
    ).toEqual(["targetBody", "toolBody"]);
    expect(
      preparedConsumer.topologyFallback?.definition.parameters.replacement,
    ).toMatchObject({ kind: "replaceBodyOutputs", actionIndexes: [1, 3] });
    return;
  }
  const requests = recordSuccessfulCreateFeatureInputs(service);
  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: snapshot.document.revisionId,
    actions,
  });
  expect(result.diagnostics.every((diagnostic) => diagnostic.severity !== "error"), JSON.stringify(result.diagnostics)).toBe(true);
  const consumer = requests.find((request) => request.definition.kind === expectedKind);
  expect(consumer?.definition.kind).toBe(expectedKind);
  expect(JSON.stringify(consumer)).not.toContain("topologyOf");
  if (consumer?.definition.kind === "combine" || consumer?.definition.kind === "split") {
    expect(consumer.definition.parameters.participants.map((participant) => participant.role)).toEqual(["targetBody", "toolBody"]);
  }
  if (consumer?.definition.kind === "deleteSolid" || consumer?.definition.kind === "transform") {
    expect(consumer.definition.parameters.participants[0]?.targets[0]?.kind).toBe("body");
  }
});

test("a body consumer over a baked producer reports topology-upstream-baked, not a matching failure", async () => {
  const { service } = createTestModelingService();
  const snapshot = await service.getCurrentDocumentSnapshot();
  const capabilities = createImportCapabilities(service, snapshot, {
    history: {
      async evaluateHistoryProbe(input) {
        const count = input.actions.orderedActions?.length ?? 0;
        return {
          steps: Array.from({ length: count }, () => ({
            status: "rebuilt" as const,
            signatures: [],
          })),
        };
      },
    },
  });
  const source = sourceFromBundle(makeWaveBBodyCaptureBundle("delete", { bakedProducer: true }));
  const review = await onshapeImportProvider.review({ source, capabilities });
  const studio = review.providerReview.studios[0];
  const producer = studio?.featurePlans.find((plan) => plan.onshapeFeatureId === "E1");
  const consumer = studio?.featurePlans.find((plan) => plan.onshapeFeatureId === "C");
  expect(producer?.tier).toBe("baked");
  expect(consumer, JSON.stringify(studio?.featurePlans)).toMatchObject({
    tier: "baked",
    reasonCodes: ["topology-upstream-baked"],
  });
});

test("a failed pre-consumer prefix probe degrades to topology-history-evidence-missing", async () => {
  const { service } = createTestModelingService();
  const snapshot = await service.getCurrentDocumentSnapshot();
  const capabilities = createImportCapabilities(service, snapshot, {
    history: {
      async evaluateHistoryProbe(input) {
        const count = input.actions.orderedActions?.length ?? 0;
        // Prefix probes (no final tessellation) fail; the whole-plan probe rebuilds.
        if (!input.includeFinalTessellation) {
          return { steps: [{ status: "failed" as const, diagnostics: [] }] };
        }
        return {
          steps: Array.from({ length: count }, () => ({
            status: "rebuilt" as const,
            signatures: [],
          })),
        };
      },
    },
  });
  const source = sourceFromBundle(makeWaveBBodyCaptureBundle("delete"));
  const review = await onshapeImportProvider.review({ source, capabilities });
  const consumer = review.providerReview.studios[0]?.featurePlans.find(
    (plan) => plan.onshapeFeatureId === "C",
  );
  expect(consumer).toMatchObject({
    tier: "baked",
    reasonCodes: ["topology-history-evidence-missing"],
  });
});


test("apply pipeline materializes the provider-produced parametric revolve profile and local axis", async () => {
  const { service } = createTestModelingService();
  const snapshot = await service.getCurrentDocumentSnapshot();
  const capabilities = createImportCapabilities(service, snapshot);
  const source = sourceFromBundle(makeWaveARevolveCaptureBundle());
  const review = await onshapeImportProvider.review({ source, capabilities });
  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities,
  });
  const requests = recordSuccessfulCreateFeatureInputs(service);

  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: snapshot.document.revisionId,
    actions,
  });

  expect(
    result.diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    JSON.stringify({ diagnostics: result.diagnostics, requests }),
  ).toBe(true);
  const revolve = requests.find((request) => request.definition.kind === "revolve");
  expect(revolve?.definition.kind).toBe("revolve");
  if (revolve?.definition.kind !== "revolve") {
    throw new Error("Expected the apply pipeline to receive a revolve request.");
  }
  expect(revolve.definition.parameters.profiles[0]?.kind).toBe("region");
  expect(revolve.definition.parameters.axis.kind).toBe("sketchEntity");
  if (revolve.definition.parameters.axis.kind === "sketchEntity") {
    expect(typeof revolve.definition.parameters.axis.sketchId).toBe("string");
  }
});

test("applyImportPreparedActions keeps a faithful constrained fixture position-stable with the real solver", async () => {
  const { service } = createTestModelingService();
  const snapshot = await service.getCurrentDocumentSnapshot();
  const { translation, verified, action } =
    await verifiedConstrainedLineAction(10);

  expect(verified.diagnostics).toEqual([]);
  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: snapshot.document.revisionId,
    actions: { commitSketches: [action] },
  });
  const committedId = result.createdEntityIds.sketchIds[0];
  const committed = (await service.getCurrentDocumentSnapshot()).document.sketches.find(
    (sketch) => sketch.sketchId === committedId,
  );
  const solvedById = new Map(
    committed?.sketch.solvedSnapshot.solvedPoints.map((point) => [
      point.pointId,
      point.solvedPosition,
    ]),
  );
  for (const seeded of translation.definition.points) {
    const solved = solvedById.get(seeded.pointId);
    expect(solved?.[0]).toBeCloseTo(seeded.position[0], 6);
    expect(solved?.[1]).toBeCloseTo(seeded.position[1], 6);
  }
});

test("applyImportPreparedActions commits seeded geometry after isolating a broken translated dimension", async () => {
  const { service } = createTestModelingService();
  const snapshot = await service.getCurrentDocumentSnapshot();
  const { translation, verified, action } =
    await verifiedConstrainedLineAction(20);

  expect(verified.diagnostics).toHaveLength(1);
  expect(verified.diagnostics[0]).toMatchObject({
    code: "onshape-sketch-solve-consistency-failed",
    relationshipKind: "lineLength",
    reason: "solve-consistency",
  });
  expect(verified.definition.dimensions).toEqual([]);
  expect(verified.definition.constraints.map((constraint) => constraint.kind)).toEqual([
    "horizontal",
  ]);

  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: snapshot.document.revisionId,
    actions: { commitSketches: [action] },
  });
  const committedId = result.createdEntityIds.sketchIds[0];
  const committed = (await service.getCurrentDocumentSnapshot()).document.sketches.find(
    (sketch) => sketch.sketchId === committedId,
  );
  const solvedById = new Map(
    committed?.sketch.solvedSnapshot.solvedPoints.map((point) => [
      point.pointId,
      point.solvedPosition,
    ]),
  );
  for (const seeded of translation.definition.points) {
    const solved = solvedById.get(seeded.pointId);
    expect(solved?.[0]).toBeCloseTo(seeded.position[0], 6);
    expect(solved?.[1]).toBeCloseTo(seeded.position[1], 6);
  }
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

test("applyImportPreparedActions materializes a deferred sketchEntity rotation axis before mock create", async () => {
  const { action: sketchAction } = await verifiedConstrainedLineAction(10);
  const created: CreateFeatureRequest[] = [];
  let revision = 0;
  const service = {
    async getCurrentDocumentSnapshot() {
      throw new Error("not used");
    },
    async buildNativeExactBrepPayload() {
      throw new Error("not used");
    },
    commitSketch() {
      revision += 1;
      return ResultAsync.fromPromise(
        Promise.resolve({
          revisionId: `rev_axis_${revision}` as RevisionId,
          sketchId: "sketch_live_axis" as never,
          revisionState: { kind: "accepted" as const },
          rebuildResult: { kind: "rebuilt" as const },
          changedTargets: [],
          diagnostics: [],
        }),
        (error) => createAppError({ code: "unknown", message: String(error) }),
      );
    },
    createFeature(request: CreateFeatureRequest) {
      created.push(request);
      revision += 1;
      return ResultAsync.fromPromise(
        Promise.resolve({
          revisionId: `rev_axis_${revision}` as RevisionId,
          featureId: "feature_rotation" as never,
          revisionState: { kind: "accepted" as const },
          rebuildResult: "rebuilt" as const,
          changedTargets: [],
          diagnostics: [],
        }),
        (error) => createAppError({ code: "unknown", message: String(error) }),
      );
    },
  } as unknown as ModelingService;
  const actions: ImportPreparedActions = {
    commitSketches: [sketchAction],
    createFeatures: [{
      contractVersion: CONTRACT_VERSION,
      documentId: "doc_workspace",
      baseRevisionId: "rev_ignored" as RevisionId,
      featureLabel: "Transform 1",
      definition: {
        kind: "transform",
        featureTypeVersion: "advanced-solid-feature/v0",
        parameters: {
          options: { transformType: "rotation", angle: 90 },
          participants: [
            { role: "body", targets: [{ kind: "body", bodyId: "body_live" as never }] },
            {
              role: "axis",
              targets: [{
                kind: "sketchEntity",
                sketchId: { kind: "sketchIdOf", actionIndex: 0 },
                entityId: "line" as never,
              }],
            },
          ],
        },
      },
    }],
    orderedActions: [
      { kind: "commitSketch", index: 0 },
      { kind: "createFeature", index: 0 },
    ],
  };

  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: "rev_ignored" as RevisionId,
    actions,
  });

  expect(result.diagnostics.every((diagnostic) => diagnostic.severity !== "error"), JSON.stringify(result.diagnostics)).toBe(true);
  expect(created[0]?.definition).toMatchObject({
    kind: "transform",
    parameters: {
      participants: [
        { role: "body" },
        { role: "axis", targets: [{ kind: "sketchEntity", sketchId: "sketch_live_axis", entityId: "line" }] },
      ],
    },
  });
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


test("generic prepared pattern actions materialize constructionOf and sketchEntity refs", async () => {
  const adapter = new MockKernelAdapter({
    solverAdapter: createRevisionAgnosticRealSolver(),
  });
  const service = createModelingService(adapter, { currentDocumentId: "doc_workspace" });
  const snapshot = await service.getCurrentDocumentSnapshot();
  const createFeatureRequests = recordCreateFeatureInputs(service);
  const axisSketchAction = {
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace" as DocumentId,
    baseRevisionId: "rev_ignored" as RevisionId,
    solverCorrelation: {
      requestId: "request_import_axis_sketch",
      projectionRequestId: "request_import_axis_sketch_project",
      validationRequestId: "request_import_axis_sketch_validate",
      solveRequestId: "request_import_axis_sketch_solve",
      regionRequestId: "request_import_axis_sketch_regions",
    },
    sketchId: null,
    sketchLabel: "Imported pattern axis sketch",
    plane: {
      support: { kind: "constructionOf" as const, actionIndex: 0 },
      key: null,
      frame: {
        origin: [0, 0, 0] as const,
        xAxis: [1, 0, 0] as const,
        yAxis: [0, 1, 0] as const,
        normal: [0, 0, 1] as const,
        linearUnit: "documentLength" as const,
        handedness: "rightHanded" as const,
      },
    },
    definition: {
      schemaVersion: "sketch-definition/v1alpha1" as const,
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_import_axis_start", "sketch_point_import_axis_end"],
      points: [
        {
          pointId: "sketch_point_import_axis_start" as never,
          label: "Axis start",
          target: { kind: "sketchPoint" as const, sketchId: "sketch_import_axis" as never, pointId: "sketch_point_import_axis_start" as never },
          position: [0, 0] as const,
          isConstruction: true,
        },
        {
          pointId: "sketch_point_import_axis_end" as never,
          label: "Axis end",
          target: { kind: "sketchPoint" as const, sketchId: "sketch_import_axis" as never, pointId: "sketch_point_import_axis_end" as never },
          position: [10, 0] as const,
          isConstruction: true,
        },
      ],
      entityIds: ["sketch_entity_import_axis_line"],
      entities: [
        {
          kind: "lineSegment" as const,
          entityId: "sketch_entity_import_axis_line" as never,
          label: "Pattern axis",
          target: { kind: "sketchEntity" as const, sketchId: "sketch_import_axis" as never, entityId: "sketch_entity_import_axis_line" as never },
          isConstruction: true,
          startPointId: "sketch_point_import_axis_start" as never,
          endPointId: "sketch_point_import_axis_end" as never,
        },
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    },
  };
  const downstreamPlane = {
    ...explicitFramePlaneAction(),
    featureLabel: "Downstream neutral plane",
  };
  const actions: ImportPreparedActions = {
    commitSketches: [axisSketchAction],
    createFeatures: [
      explicitFramePlaneAction() as ImportPreparedActions["createFeatures"] extends (infer Entry)[] | undefined ? Entry : never,
      {
        contractVersion: CONTRACT_VERSION,
        documentId: "doc_workspace" as DocumentId,
        baseRevisionId: "rev_ignored" as RevisionId,
        featureLabel: "Imported circular pattern",
        definition: {
          kind: "circularPattern",
          featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
          parameters: {
            participants: [
              { role: "body", targets: [{ kind: "body", bodyId: "body_part-1" as BodyId }] },
              {
                role: "axis",
                targets: [
                  {
                    kind: "sketchEntity",
                    sketchId: { kind: "sketchIdOf", actionIndex: 1 },
                    entityId: "sketch_entity_import_axis_line" as never,
                  },
                ],
              },
            ],
            options: {
              instanceCount: createLiteralAuthoredValue(3),
              angleDegrees: createLiteralAuthoredValue(180),
              equalSpace: createLiteralAuthoredValue(true),
              oppositeDirection: createLiteralAuthoredValue(false),
            },
          },
        },
      },
      downstreamPlane as ImportPreparedActions["createFeatures"] extends (infer Entry)[] | undefined ? Entry : never,
    ],
    orderedActions: [
      { kind: "createFeature", index: 0 },
      { kind: "commitSketch", index: 0 },
      { kind: "createFeature", index: 1 },
      { kind: "createFeature", index: 2 },
    ],
  };

  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: snapshot.document.revisionId,
    actions,
  });
  const after = await service.getCurrentDocumentSnapshot();
  const patternRequest = createFeatureRequests[1];

  expect(result.diagnostics.every((diagnostic) => diagnostic.severity !== "error")).toBeTruthy();
  expect(result.createdEntityIds.featureIds.length).toBe(3);
  expect(
    after.document.sketches.some(
      (sketch) => sketch.label === "Imported pattern axis sketch" && sketch.plane.support.kind === "construction",
    ),
    "Deferred constructionOf should materialize as the committed sketch plane support.",
  ).toBeTruthy();
  expect(
    patternRequest?.definition.kind === "circularPattern" &&
      patternRequest.definition.parameters.participants[1]?.targets[0]?.kind === "sketchEntity" &&
      typeof patternRequest.definition.parameters.participants[1].targets[0].sketchId === "string",
    "Deferred sketchIdOf should materialize inside advanced sketchEntity participants before pattern create.",
  ).toBeTruthy();
  expect(
    after.document.features.some((feature) => feature.label === "Downstream neutral plane"),
    "A downstream neutral action should continue after the materialized pattern.",
  ).toBeTruthy();
});

test("generic prepared pattern bodyOf outputs reject multi-body consumers", async () => {
  const adapter = new MockKernelAdapter();
  const service = createModelingService(adapter, { currentDocumentId: "doc_workspace" });
  const snapshot = await service.getCurrentDocumentSnapshot();
  const profile = snapshot.document.sketches[0]?.sketch.regions[0]?.target;
  if (!profile) throw new Error("Mock snapshot must expose a seed region.");
  const actions: ImportPreparedActions = {
    createFeatures: [
      {
        contractVersion: CONTRACT_VERSION,
        documentId: "doc_workspace" as DocumentId,
        baseRevisionId: "rev_ignored" as RevisionId,
        featureLabel: "Multi-output linear pattern",
        definition: {
          kind: "linearPattern",
          featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
          parameters: {
            participants: [
              { role: "body", targets: [{ kind: "body", bodyId: "body_part-1" as BodyId }] },
              { role: "direction", targets: [{ kind: "construction", constructionId: "construction_plane-yz" as never }] },
            ],
            options: { instanceCount: createLiteralAuthoredValue(3), spacing: createLiteralAuthoredValue(10), centered: createLiteralAuthoredValue(false), oppositeDirection: createLiteralAuthoredValue(false) },
          },
        },
      },
      {
        contractVersion: CONTRACT_VERSION,
        documentId: "doc_workspace" as DocumentId,
        baseRevisionId: "rev_ignored" as RevisionId,
        featureLabel: "Invalid bodyOf cut",
        definition: {
          kind: "extrude",
          featureTypeVersion: "feature-type/extrude/v1alpha1",
          parameters: {
            profiles: [profile],
            startExtent: { kind: "profilePlane" },
            extent: { mode: "oneSide", end: { kind: "blind", direction: "positive", distance: 1 } },
            operation: "cut",
            booleanScope: { kind: "targetBody", bodyId: { kind: "bodyOf", actionIndex: 0 } },
          },
        },
      } as never,
    ],
    orderedActions: [
      { kind: "createFeature", index: 0 },
      { kind: "createFeature", index: 1 },
    ],
  };

  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: snapshot.document.revisionId,
    actions,
  });

  expect(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.severity === "error" &&
        diagnostic.message.includes("produced 2 body ids, expected exactly one"),
    ),
    "A bodyOf consumer should reject multi-output pattern producers through the existing apply policy.",
  ).toBeTruthy();
});

test("generic prepared topologyOf participants can seed authored body patterns", async () => {
  const adapter = new MockKernelAdapter();
  const service = createModelingService(adapter, { currentDocumentId: "doc_workspace" });
  const snapshot = await service.getCurrentDocumentSnapshot();
  const actions: ImportPreparedActions = {
    createFeatures: [
      {
        contractVersion: CONTRACT_VERSION,
        documentId: "doc_workspace" as DocumentId,
        baseRevisionId: "rev_ignored" as RevisionId,
        featureLabel: "Topology rematched linear pattern",
        definition: {
          kind: "linearPattern",
          featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
          parameters: {
            participants: [
              {
                role: "body",
                targets: [
                  {
                    kind: "topologyOf",
                    expectedKind: "body",
                    capturedSignature: {
                      entityClass: "body",
                      geometryType: "solid",
                      boundingBox: { low: [-4, -3, 12], high: [4, 3, 12] },
                      centroid: [0, 0, 12],
                      reference: { kind: "body", bodyId: "body_part-1" as BodyId },
                    },
                    tolerance: { linear: 1e-6, angularRadians: 1e-6, relative: 1e-6, ambiguityMargin: 1e-6 },
                    source: {
                      consumerFeatureId: "pattern_topology_seed",
                      parameterId: "body",
                      deterministicId: "seed_body",
                    },
                  },
                ],
              },
              { role: "direction", targets: [{ kind: "construction", constructionId: "construction_plane-yz" as never }] },
            ],
            options: { instanceCount: createLiteralAuthoredValue(2), spacing: createLiteralAuthoredValue(10), centered: createLiteralAuthoredValue(false), oppositeDirection: createLiteralAuthoredValue(false) },
          },
        },
      },
    ],
    orderedActions: [{ kind: "createFeature", index: 0 }],
  };

  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: snapshot.document.revisionId,
    actions,
  });

  expect(result.diagnostics.every((diagnostic) => diagnostic.severity !== "error")).toBeTruthy();
  expect(result.createdEntityIds.featureIds.length).toBe(1);
});

test("applyImportPreparedActions forwards whole-solid shell offsets to mock create", async () => {
  const { service } = createTestModelingService();
  const snapshot = await service.getCurrentDocumentSnapshot();
  const createFeatureRequests = recordSuccessfulCreateFeatureInputs(service);
  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: snapshot.document.revisionId,
    actions: {
      createFeatures: [shellOffsetAllFacesRequest("body_apply_shell" as BodyId)],
      orderedActions: [{ kind: "createFeature", index: 0 }],
    },
  });

  expect(result.diagnostics).toEqual([]);
  expect(createFeatureRequests[0]?.definition).toMatchObject({
    kind: "shell",
    parameters: {
      mode: "offsetAllFaces",
      bodyTarget: { kind: "body", bodyId: "body_apply_shell" },
      faceTargets: [],
    },
  });
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

// A face sketch the provider promoted to `sketch-on-probed-face` carries its
// plane support as a deferred `topologyOf` face selector. At apply time the
// selector must rematch against the live document's derived face signatures and
// resolve to a concrete face reference before the sketch commits.
function makePromotedFaceSketchBundle(): OnshapeCaptureBundleV2 {
  return {
    formatVersion: 1,
    provenance: {
      capturedAt: "2026-07-08T00:00:00.000Z",
      cliVersion: "test",
      apiVersion: "v10",
      baseUrl: "https://cad.onshape.com/api/v10",
      documentId: "d".repeat(24),
      wvm: "w",
      wvmId: "w".repeat(24),
      microversion: "m".repeat(24),
    },
    document: {},
    elements: {},
    diagnostics: [],
    partStudios: [{
      elementId: "e1",
      name: "Probe",
      features: {
        features: [
          { featureType: "newSketch", featureId: "S_BASE", name: "Base sketch" },
          {
            featureType: "extrude",
            featureId: "E_BASE",
            name: "Base extrude",
            parameters: [
              {
                parameterId: "entities",
                queries: [{ queryString: 'query = qSketchRegion(id + "S_BASE", true);' }],
              },
              { parameterId: "endBound", value: "BLIND" },
              { parameterId: "depth", expression: "3 mm", value: 0.003 },
              { parameterId: "operationType", value: "NEW" },
            ],
          },
          {
            featureType: "newSketch",
            featureId: "S_FACE",
            name: "Face sketch",
            parameters: [
              { parameterId: "sketchPlane", queries: [{ deterministicIds: ["face_ref"] }] },
            ],
          },
        ],
      },
      sketches: {
        sketches: [
          {
            featureId: "S_BASE",
            entities: [{
              sketchEntityId: "cb",
              sketchEntityType: "skCircle",
              geometry: { center3d: { x: 0.0005, y: 0.001, z: 0 }, radius: 0.0004 },
              isConstruction: false,
            }],
          },
          {
            featureId: "S_FACE",
            entities: [{
              sketchEntityId: "c1",
              sketchEntityType: "skCircle",
              geometry: { center3d: { x: 0.0005, y: 0.001, z: 0.003 }, radius: 0.0001 },
              isConstruction: false,
            }],
          },
        ],
      },
      parts: null,
      featureSpecs: { present: false, reason: "n/a" },
      resolvedReferences: [{
        deterministicId: "face_ref",
        evaluatedAt: "historyPoint",
        consumingFeatureId: "S_FACE",
        signature: {
          entityClass: "face",
          geometryType: "plane",
          definingData: { origin: [0, 0, 0.003], normal: [0, 0, 1] },
          centroid: [0.0005, 0.001, 0.003],
          boundingBox: { low: [0, 0, 0.003], high: [0.001, 0.002, 0.003] },
        },
      }],
      groundTruth: {
        hasBodies: true,
        tessellationTolerance: 0.001,
        tessellatedFaces: {},
        step: "",
      },
      rollbackSnapshots: null,
    }],
  } as unknown as OnshapeCaptureBundleV2;
}

function probeFaceSignature(id: string): HistoryProbeTopologySignature {
  return {
    entityClass: "face",
    geometryType: "plane",
    definingData: { origin: [0, 0, 3], normal: [0, 0, 1], xDirection: [1, 0, 0] },
    centroid: [0.5, 1, 3],
    boundingBox: { low: [0, 0, 3], high: [1, 2, 3] },
    reference: { kind: "face", bodyId: "body_probe" as BodyId, faceId: id as FaceId },
  };
}

function probeCapabilities(
  signatures: readonly HistoryProbeTopologySignature[],
): ImportCapabilities {
  return {
    context: {
      contractVersion: CONTRACT_VERSION,
      documentId: "doc_workspace",
      baseRevisionId: "rev_1" as RevisionId,
    },
    modeling: {
      async bakeGeometry() { throw new Error("not used"); },
      async reconstructMeshToBrep() { throw new Error("not used"); },
    },
    sketch: {
      async convertVectorToSketch() { throw new Error("not used"); },
    },
    assets: {
      async registerGeometryAsset() { throw new Error("not used"); },
      async storeEmbeddedBinary() { throw new Error("not used"); },
    },
    history: {
      async evaluateHistoryProbe(input) {
        return {
          steps: Array.from(
            { length: Math.max(1, input.actions.orderedActions?.length ?? 0) },
            () => ({ status: "rebuilt" as const, signatures: [...signatures] }),
          ),
        };
      },
    },
  } as ImportCapabilities;
}

test("a provider-promoted sketch-on-face applies with its topologyOf plane support rematched to a live face", async () => {
  const source = sourceFromBundle(makePromotedFaceSketchBundle());
  const reviewCapabilities = probeCapabilities([probeFaceSignature("face_match")]);
  const review = await onshapeImportProvider.review({
    source,
    capabilities: reviewCapabilities,
  });
  const faceSketchPlan = review.providerReview.studios[0]?.featurePlans.find(
    (plan) => plan.onshapeFeatureId === "S_FACE",
  );
  expect(faceSketchPlan, JSON.stringify(review.providerReview.studios[0]?.featurePlans))
    .toMatchObject({ tier: "parametric", reasonCodes: ["sketch-on-probed-face"] });

  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities: reviewCapabilities,
  });
  const promotedSketch = (actions.commitSketches ?? []).find(
    (commit) =>
      commit.plane.support.kind === "topologyOf" &&
      commit.plane.support.expectedKind === "face",
  );
  expect(
    promotedSketch,
    "The promoted face sketch must carry a deferred topologyOf face support.",
  ).toBeDefined();
  if (!promotedSketch) throw new Error("Expected a promoted face sketch commit.");

  // Live document with a single non-mesh body whose native BREP resolves the box
  // fixture; its top face (centroid [0.5, 1, 3]) matches the captured signature.
  const recordedCommits: CommitSketchRequest[] = [];
  const boxPayload = () =>
    createOccNativeExactBrepPayloadFromShimPayload({
      revisionId: "rev_apply_0" as RevisionId,
      target: { kind: "body", bodyId: "body_box" as BodyId },
      bodyId: "body_box" as BodyId,
      bodyLabel: "Box",
      nativePayload: parseNativeShimPayloadJson(JSON.stringify(boxFixture.exactBrep)),
    });
  const snapshot = {
    document: {
      documentId: "doc_workspace",
      revisionId: "rev_apply_0" as RevisionId,
      bodies: [{ bodyId: "body_box", topologyPresentation: "exact" }],
      render: { records: [] },
    },
  } as never;
  const service = {
    async getCurrentDocumentSnapshot() {
      return snapshot;
    },
    async buildNativeExactBrepPayload() {
      return {
        kind: "nativeTopologyPayload" as const,
        payload: boxPayload(),
        diagnostics: [],
      };
    },
    commitSketch(request: CommitSketchRequest) {
      recordedCommits.push(request);
      return ResultAsync.fromPromise(
        Promise.resolve({
          revisionId: "rev_apply_1" as RevisionId,
          sketchId: "sketch_applied" as never,
          revisionState: { kind: "accepted" as const },
          rebuildResult: "rebuilt" as const,
          changedTargets: [],
          diagnostics: [],
        }),
        (error) => createAppError({ code: "unknown", message: String(error) }),
      );
    },
  } as unknown as ModelingService;

  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: "rev_apply_0" as RevisionId,
    actions: {
      commitSketches: [promotedSketch],
      orderedActions: [{ kind: "commitSketch", index: 0 }],
    },
  });

  expect(
    result.diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    JSON.stringify(result.diagnostics),
  ).toBe(true);
  expect(result.rolledBack).toBe(false);
  expect(result.createdEntityIds.sketchIds).toEqual(["sketch_applied"]);

  const appliedSupport = recordedCommits[0]?.plane.support;
  expect(
    appliedSupport,
    "The commit must receive a concrete rematched face support, not the deferred selector.",
  ).toMatchObject({ kind: "face", bodyId: "body_box" });
  expect(JSON.stringify(recordedCommits)).not.toContain("topologyOf");
});

test("applyImportPreparedActions rolls back prior operations when a modeling mutation is rejected", async () => {
  let callCount = 0;
  const rollbackCounts: number[] = [];
  const service = {
    createFeature() {
      callCount += 1;
      return ResultAsync.fromPromise(
        Promise.resolve(callCount === 1
          ? {
              revisionId: "rev_rejected_1" as RevisionId,
              featureId: "feature_first" as never,
              revisionState: { kind: "accepted" as const },
              rebuildResult: { kind: "rebuilt" as const },
              changedTargets: [],
              diagnostics: [],
            }
          : {
              revisionId: "rev_rejected_1" as RevisionId,
              featureId: "feature_rejected" as never,
              revisionState: {
                kind: "rejected" as const,
                reasonCode: "advanced-feature-unsupported-kernel-case",
              },
              rebuildResult: { kind: "skipped" as const },
              changedTargets: [],
              diagnostics: [{
                code: "advanced-feature-unsupported-kernel-case",
                severity: "error" as const,
                message: "Rejected imported feature.",
                target: null,
                detail: null,
              }],
            }),
        (error) => createAppError({ code: "unknown", message: String(error) }),
      );
    },
  } as unknown as ModelingService;

  const request = {
    documentId: "doc_workspace" as DocumentId,
    baseRevisionId: "rev_rejected_0" as RevisionId,
    definition: { kind: "fixture" },
  } as never;
  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: "rev_rejected_0" as RevisionId,
    actions: {
      createFeatures: [request, request],
      orderedActions: [
        { kind: "createFeature", index: 0 },
        { kind: "createFeature", index: 1 },
      ],
    },
    rollback: async (count) => {
      rollbackCounts.push(count);
    },
  });

  expect(rollbackCounts).toEqual([1]);
  expect(result).toMatchObject({
    revisionId: "rev_rejected_0",
    createdEntityIds: { featureIds: [] },
    appliedOperationCount: 1,
    rolledBack: true,
    rollbackAttempted: true,
  });
  expect(result.diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({
      code: "advanced-feature-unsupported-kernel-case",
      message: "Rejected imported feature.",
    }),
    expect.objectContaining({ code: "import-apply-failed" }),
  ]));
});
