import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test, expect } from "vitest";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";

import {
  assembleFixtureMountsBundle,
  FIXTURE_PART_STUDIO_ID,
} from "@/cli/commands/onshape-capture/fixtures/capture-bundle-fixture";
import type { StudioReadResult } from "@/domain/import/onshape/bundle-reader";
import { readPartStudio } from "@/domain/import/onshape/bundle-reader";
import { planStudioFidelity } from "@/domain/import/onshape/fidelity-planner";
import { makeWaveXSurfaceExtrudeCaptureBundle } from "@/domain/import/onshape/wave-x-capture-fixtures";
import {
  projectPointToSketchPlaneFrame,
  translateSketch,
  verifySketchTranslationSolveConsistency,
} from "@/domain/import/onshape/sketch-translator";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import {
  validateOnshapeCaptureBundle,
  type OnshapeCaptureBundle,
  type OnshapeRollbackSnapshot,
} from "@/contracts/import/onshape-capture-bundle";

test("src/domain/import/onshape/fidelity-planner.spec.ts", async () => {
  const bundle = await assembleFixtureMountsBundle();
  const read = readPartStudio(bundle, FIXTURE_PART_STUDIO_ID);
  const plan = planStudioFidelity(read);
  expect(read.features[0]?.constraints?.map((entry) => entry.constraintType)).toEqual([
    "HORIZONTAL",
    "LENGTH",
    "OFFSET",
  ]);

  const byId = new Map(
    plan.featurePlans.map((entry) => [entry.onshapeFeatureId, entry]),
  );

  const firstSketch = byId.get("FOoap8tw3jKAJf5_0");
  expect(
    firstSketch?.tier === "parametric" &&
      firstSketch.target.kind === "sketch" &&
      firstSketch.target.planeKey === "xy",
    "A sketch on the captured Top datum plane should plan as a parametric XY sketch.",
  ).toBeTruthy();

  const extrude = byId.get("FG094ehBlsq34dl_0");
  expect(
    extrude?.tier === "parametric" && extrude.reasonCodes.length === 0,
    "A server-certified profile witness should promote the captured extrude without guessing.",
  ).toBeTruthy();

  expect(plan.bakeStrategy).toEqual({ kind: "none" });
  expect(plan.requiresStudioBake).toBe(false);
  expect(plan.tierCounts).toEqual({ parametric: 3, baked: 0, geometryOnly: 0 });
});


const realBundleCases = [
  [
    "40a51fb8fa82fd4565151114.onshape-capture.json",
    { parametric: 5, baked: 5, geometryOnly: 0 },
  ],
  [
    "9841e486906fa2ce62d74d8e.onshape-capture.json",
    { parametric: 6, baked: 35, geometryOnly: 0 },
  ],
] as const;

test.skipIf(realBundleCases.some(([fileName]) => !existsSync(fileName)))(
  "src/domain/import/onshape/fidelity-planner.spec.ts real bundles contain no Wave A features and retain baseline counts",
  async () => {
  for (const [fileName, expected] of realBundleCases) {
    const parsed = validateOnshapeCaptureBundle(JSON.parse(await readFile(fileName, "utf8")));
    if (!parsed.success) throw new Error(`Real capture ${fileName} must validate.`);
    const studio = parsed.data.partStudios[0]!;
    const read = readPartStudio(parsed.data, studio.elementId);
    expect(
      read.features.some((feature) =>
        ["revolve", "thicken", "sweep", "loft"].includes(feature.featureType),
      ),
    ).toBe(false);
    const plan = planStudioFidelity(read, {
      captureFormatVersion: parsed.data.formatVersion,
      historyProbeAvailable: true,
    });
    expect(plan.tierCounts).toEqual(expected);
    expect(plan.bakeStrategy.kind).toBe("segments");
    expect(plan.requiresStudioBake).toBe(false);
  }
});

test("src/domain/import/onshape/fidelity-planner.spec.ts keeps the two local SURFACE Extrude 4 forms out of solid plans and body lineage", () => {
  const bundle = makeWaveXSurfaceExtrudeCaptureBundle();
  expect(bundle.partStudios).toHaveLength(2);
  for (const studio of bundle.partStudios) {
    const plan = planStudioFidelity(readPartStudio(bundle, studio.elementId));
    const surface = plan.featurePlans.find((feature) => feature.label === "Extrude 4");
    const downstreamCut = plan.featurePlans.find(
      (feature) => feature.onshapeFeatureId === "E_SOLID_CUT",
    );

    expect(surface).toMatchObject({
      tier: "baked",
      reasonCodes: ["extrude-body-type-unsupported"],
      suppressed: true,
    });
    expect(surface?.plannedExtrude).toBeUndefined();
    expect(downstreamCut).toMatchObject({
      tier: "baked",
      reasonCodes: ["needs-history-probe"],
    });
  }
});

const CAPTURED_SKETCH_MATRIX = [
  1, 0, 0, 0,
  0, 0, -1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1,
];

function makeSketchMatrixBundle(input: {
  sketchMatrix?: unknown;
  includeSketchPlaneQuery?: boolean;
  sketchPlaneQuery?: { queryString?: string; deterministicIds?: string[] };
  sketchPlaneQueries?: unknown[];
  resolvedReferences?: OnshapeCaptureBundle["partStudios"][number]["resolvedReferences"];
}): OnshapeCaptureBundle {
  const defaultSketchPlaneQuery = {
    queryString: 'query = qCreatedBy(id + "Extrude 1", EntityType.FACE);',
  };
  const sketchPlaneParameter = input.includeSketchPlaneQuery
    ? [{
        parameterId: "sketchPlane",
        queries: input.sketchPlaneQueries ?? [input.sketchPlaneQuery ?? defaultSketchPlaneQuery],
      }]
    : [];
  return {
    formatVersion: 2,
    provenance: {
      capturedAt: "2026-01-01T00:00:00.000Z",
      cliVersion: "test",
      apiVersion: "v10",
      baseUrl: "https://cad.onshape.com/api/v10",
      documentId: "0123456789abcdef01234567",
      wvm: "w",
      wvmId: "0123456789abcdef01234567",
      microversion: "0123456789abcdef01234567",
    },
    document: {},
    elements: {},
    partStudios: [{
      elementId: "e1",
      name: "Matrix sketch",
      features: {
        features: [{
            featureType: "newSketch",
            featureId: "S_MATRIX",
            name: "Matrix sketch",
            parameters: sketchPlaneParameter,
          },
          {
            featureType: "extrude",
            featureId: "E_MATRIX",
            name: "Matrix extrude",
            parameters: [
              {
                parameterId: "entities",
                queries: [{ queryString: 'query = qSketchRegion(id + "S_MATRIX", true);' }],
              },
              { parameterId: "endBound", value: "BLIND" },
              { parameterId: "depth", expression: "10 mm", value: 0.01 },
              { parameterId: "operationType", value: "NEW" },
            ],
          },
        ],
      },
      sketches: {
        sketches: [{
          featureId: "S_MATRIX",
          sketchSolveStatus: "WELL_DEFINED",
          ...(input.sketchMatrix ? { sketchMatrix: input.sketchMatrix } : {}),
          entities: [{
              sketchEntityId: "vertical_world_line",
              sketchEntityType: "skLineSegment",
              isConstruction: true,
              startPosition3d: { x: -0.004, y: 0, z: 0.01 },
              endPosition3d: { x: -0.004, y: 0, z: 0 },
            },
            {
              sketchEntityId: "profile_circle",
              sketchEntityType: "skCircle",
              geometry: { center3d: { x: 0, y: 0, z: 0 }, radius: 0.005 },
            },
          ],
        }],
      },
      parts: {},
      featureSpecs: { present: false, reason: "n/a" },
      resolvedReferences: input.resolvedReferences ?? [],
      profileEvidence: [{
        consumingFeatureId: "E_MATRIX", parameterId: "entities",
        queryIndex: 0, resultIndex: 0, deterministicId: "matrix-profile",
        evaluatedAt: "historyPoint", kind: "sketchRegion", sourceSketchFeatureId: "S_MATRIX",
        interiorPoint3d: [0, 0, 0],
      }],
      groundTruth: { hasBodies: false },
      rollbackSnapshots: [],
    }],
  };
}

async function expectNoDegenerateLineDiagnostic(translation: ReturnType<typeof translateSketch>) {
  const sketchId = translation.definition.points[0]?.target.sketchId;
  expect(sketchId).toBeTruthy();
  const verified = await verifySketchTranslationSolveConsistency({
    solver: new SketchConstraintSolverAdapter({
      documentId: "doc_captured_frame_projection",
      revisionId: "rev_captured_frame_projection",
    }),
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_captured_frame_projection",
    revisionId: "rev_captured_frame_projection",
    sketchId: sketchId!,
    plane: translation.plane,
    definition: translation.definition,
    relationshipSummary: translation.relationshipSummary,
  });
  expect(verified.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("degenerate-line-segment");
}

test("src/domain/import/onshape/fidelity-planner.spec.ts captured sketchMatrix plans unresolved sketch plane on captured frame", async () => {
  const bundle = makeSketchMatrixBundle({
    sketchMatrix: CAPTURED_SKETCH_MATRIX,
    includeSketchPlaneQuery: true,
  });
  const read = readPartStudio(bundle, "e1");
  const plan = planStudioFidelity(read, { captureFormatVersion: 2, historyProbeAvailable: true });
  const sketchPlan = plan.featurePlans[0];
  expect(sketchPlan).toMatchObject({
    tier: "parametric",
    reasonCodes: ["sketch-on-captured-frame"],
    target: { kind: "sketch", planeKey: "xy" },
    inputDependencies: [],
  });
  if (sketchPlan?.target.kind !== "sketch" || !sketchPlan.target.capturedFrame) {
    throw new Error("Expected captured frame sketch target.");
  }

  const solved = read.solvedSketchesByFeatureId.get("S_MATRIX")!;
  const line = solved.entities[0]!;
  const start = projectPointToSketchPlaneFrame(line.start3d!, sketchPlan.target.capturedFrame);
  const end = projectPointToSketchPlaneFrame(line.end3d!, sketchPlan.target.capturedFrame);
  expect(start).toEqual([-4, 10]);
  expect(end).toEqual([-4, 0]);
  expect(Math.hypot(start[0] - end[0], start[1] - end[1])).toBe(10);

  const translation = translateSketch({
    featureId: "S_MATRIX",
    label: "Matrix sketch",
    planeKey: "xy",
    plane: {
      support: { kind: "construction", constructionId: "construction_pending_S_MATRIX" },
      frame: sketchPlan.target.capturedFrame,
      key: null,
    },
    entities: [{
      entityId: line.entityId,
      entityType: "lineSegment",
      isConstruction: line.isConstruction,
      start,
      end,
    }],
  });
  expect(translation.definition.points.map((point) => point.position)).toEqual([[-4, 10], [-4, 0]]);
  await expectNoDegenerateLineDiagnostic(translation);
});

test.each([
  ["TopplaneOp", "xy"],
  ["RightplaneOp", "yz"],
  ["FrontplaneOp", "xz"],
] as const)(
  "src/domain/import/onshape/fidelity-planner.spec.ts %s sketchPlane query maps to canonical %s",
  (operationId, planeKey) => {
    const read = readPartStudio(makeSketchMatrixBundle({
      sketchMatrix: CAPTURED_SKETCH_MATRIX,
      includeSketchPlaneQuery: true,
      sketchPlaneQuery: {
        queryString: `query = qCreatedBy(id + "${operationId}", EntityType.FACE);`,
      },
    }), "e1");
    expect(planStudioFidelity(read).featurePlans[0]).toMatchObject({
      tier: "parametric",
      reasonCodes: ["sketch-on-canonical-plane"],
      target: { kind: "sketch", planeKey },
    });
  },
);

test("src/domain/import/onshape/fidelity-planner.spec.ts absent sketchPlane keeps canonical XY fallback", () => {
  const read = readPartStudio(makeSketchMatrixBundle({ includeSketchPlaneQuery: false }), "e1");
  const sketchPlan = planStudioFidelity(read).featurePlans[0];
  expect(sketchPlan).toMatchObject({
    tier: "parametric",
    reasonCodes: ["sketch-on-canonical-plane"],
    target: { kind: "sketch", planeKey: "xy" },
  });
});

test("src/domain/import/onshape/fidelity-planner.spec.ts empty sketchPlane query list keeps canonical XY fallback", () => {
  const read = readPartStudio(makeSketchMatrixBundle({
    includeSketchPlaneQuery: true,
    sketchPlaneQueries: [],
  }), "e1");
  const sketchPlan = planStudioFidelity(read).featurePlans[0];
  expect(sketchPlan).toMatchObject({
    tier: "parametric",
    reasonCodes: ["sketch-on-canonical-plane"],
    target: { kind: "sketch", planeKey: "xy" },
  });
});

test("src/domain/import/onshape/fidelity-planner.spec.ts deterministic sketchPlane without queryString stays baked despite sketchMatrix", () => {
  const read = readPartStudio(makeSketchMatrixBundle({
    sketchMatrix: CAPTURED_SKETCH_MATRIX,
    includeSketchPlaneQuery: true,
    sketchPlaneQuery: { deterministicIds: ["face-id"] },
  }), "e1");
  expect(planStudioFidelity(read).featurePlans[0]).toMatchObject({
    tier: "baked",
    reasonCodes: ["needs-history-probe"],
    target: { kind: "suppressed" },
  });
});

test("src/domain/import/onshape/fidelity-planner.spec.ts cPlane sketchPlane query does not use sketchMatrix fallback", () => {
  const read = readPartStudio(makeSketchMatrixBundle({
    sketchMatrix: CAPTURED_SKETCH_MATRIX,
    includeSketchPlaneQuery: true,
    sketchPlaneQuery: {
      queryString: 'query = qCreatedBy(id + "C_PLANE" + "planeOp", EntityType.FACE);',
    },
  }), "e1");
  expect(planStudioFidelity(read).featurePlans[0]).toMatchObject({
    tier: "baked",
    reasonCodes: ["needs-history-probe"],
    target: { kind: "suppressed" },
  });
});

test("src/domain/import/onshape/fidelity-planner.spec.ts unresolved sketchPlane without valid matrix stays baked", () => {
  const read = readPartStudio(makeSketchMatrixBundle({ includeSketchPlaneQuery: true }), "e1");
  const sketchPlan = planStudioFidelity(read).featurePlans[0];
  expect(sketchPlan).toMatchObject({
    tier: "baked",
    reasonCodes: ["needs-history-probe"],
    target: { kind: "suppressed" },
  });
});

test("src/domain/import/onshape/fidelity-planner.spec.ts nonorthogonal sketchMatrix is rejected", () => {
  const invalidMatrix = [...CAPTURED_SKETCH_MATRIX];
  invalidMatrix[1] = 0.5;
  const read = readPartStudio(makeSketchMatrixBundle({
    sketchMatrix: invalidMatrix,
    includeSketchPlaneQuery: true,
  }), "e1");
  expect(read.solvedSketchesByFeatureId.get("S_MATRIX")?.sketchFrame).toBeUndefined();
  const sketchPlan = planStudioFidelity(read).featurePlans[0];
  expect(sketchPlan).toMatchObject({
    tier: "baked",
    reasonCodes: ["needs-history-probe"],
    target: { kind: "suppressed" },
  });
});

test.skipIf(!existsSync("40a51fb8fa82fd4565151114.onshape-capture.json"))(
  "src/domain/import/onshape/fidelity-planner.spec.ts real Mounts Sketch 2 uses captured frame projection",
  async () => {
    const parsed = validateOnshapeCaptureBundle(
      JSON.parse(await readFile("40a51fb8fa82fd4565151114.onshape-capture.json", "utf8")),
    );
    if (!parsed.success) throw new Error("Real Mounts capture must validate.");
    const studio = parsed.data.partStudios[0]!;
    const read = readPartStudio(parsed.data, studio.elementId);
    const plan = planStudioFidelity(read, {
      captureFormatVersion: parsed.data.formatVersion,
      historyProbeAvailable: true,
    });
    const sketchPlan = plan.featurePlans.find((entry) => entry.onshapeFeatureId === "FkkBVfXRKopMlIW_1");
    expect(sketchPlan).toMatchObject({
      tier: "baked",
      reasonCodes: ["needs-history-probe"],
      target: { kind: "suppressed" },
    });
  },
);


test("src/domain/import/onshape/fidelity-planner.spec.ts prefers the consuming feature's history-point record", () => {
  const read: StudioReadResult = {
    studio: {
      elementId: "e1",
      name: "History point",
      features: null,
      sketches: null,
      parts: null,
      featureSpecs: { present: false, reason: "n/a" },
      resolvedReferences: [
        {
          deterministicId: "plane-id",
          evaluatedAt: "finalState",
          unresolved: { reason: "consumed later" },
        },
        {
          deterministicId: "plane-id",
          evaluatedAt: "historyPoint",
          consumingFeatureId: "S1",
          signature: {
            entityClass: "face",
            geometryType: "PLANE",
            definingData: { normal: [0, 0, 1] },
            isDefaultPlane: true,
          },
        },
      ],
      groundTruth: { hasBodies: false },
      rollbackSnapshots: null,
    },
    features: [
      {
        featureType: "newSketch",
        featureId: "S1",
        parameters: [
          {
            parameterId: "sketchPlane",
            queries: [{ deterministicIds: ["plane-id"] }],
          },
        ],
      },
    ],
    solvedSketchesByFeatureId: new Map(),
    diagnostics: [],
  };

  const plan = planStudioFidelity(read);
  expect(plan.featurePlans[0]?.tier).toBe("parametric");
  expect(plan.featurePlans[0]?.target).toMatchObject({ kind: "sketch", planeKey: "xy" });
});

test("src/domain/import/onshape/fidelity-planner.spec.ts retains v1 final-state planning", () => {
  const read = makeStudioRead({
    sketchEntities: [{ entityId: "c1", entityType: "circle", center3d: [0, 0, 0], radius: 0.005 }],
    extrudeOperation: "NEW",
  });
  const plan = planStudioFidelity(read, { captureFormatVersion: 1 });
  expect(plan.featurePlans[0]?.tier).toBe("parametric");
  expect(plan.bakeStrategy).toEqual({ kind: "none" });
});

// ---- Synthetic seam coverage for scope-ambiguity and selector-failure -----

function makeStudioRead(input: {
  sketchEntities: {
    entityId: string;
    entityType: "circle" | "lineSegment";
    center3d?: [number, number, number];
    radius?: number;
    start3d?: [number, number, number];
    end3d?: [number, number, number];
  }[];
  extrudeOperation: string;
  priorExtrudes?: { featureId: string; operation: string }[];
  sketchConstraints?: StudioReadResult["features"][number]["constraints"];
}): StudioReadResult {
  const sketchFeatureId = "S1";
  const makeExtrude = (featureId: string, operation: string) => ({
    featureType: "extrude",
    featureId,
    name: featureId,
    parameters: [
      {
        parameterId: "entities",
        queries: [
          {
            queryString: `query = qSketchRegion(id + "${sketchFeatureId}", true);`,
          },
        ],
      },
      { parameterId: "endBound", value: "BLIND" },
      { parameterId: "depth", expression: "10 mm", value: 0.01 },
      { parameterId: "operationType", value: operation },
    ],
  });
  const features: StudioReadResult["features"] = [
    {
      featureType: "newSketch",
      featureId: sketchFeatureId,
      name: "Sketch 1",
      constraints: input.sketchConstraints,
    },
    ...(input.priorExtrudes ?? []).map((prior) =>
      makeExtrude(prior.featureId, prior.operation),
    ),
    makeExtrude("E_TARGET", input.extrudeOperation),
  ];
  return {
    studio: {
      elementId: "e1",
      name: "Synthetic",
      features: null,
      sketches: null,
      parts: null,
      featureSpecs: { present: false, reason: "n/a" },
      resolvedReferences: [],
      profileEvidence: features
        .filter((feature) => feature.featureType === "extrude")
        .map((feature) => ({
          consumingFeatureId: feature.featureId,
          parameterId: "entities" as const,
          queryIndex: 0,
          resultIndex: 0,
          deterministicId: `synthetic-profile:${feature.featureId}`,
          evaluatedAt: "historyPoint" as const,
          kind: "sketchRegion" as const,
          sourceSketchFeatureId: sketchFeatureId,
          interiorPoint3d: input.sketchEntities.find((entity) => entity.entityType === "circle")?.center3d ?? [0, 0, 0] as [number, number, number],
        })),
      groundTruth: { hasBodies: false },
      rollbackSnapshots: null,
    },
    features,
    solvedSketchesByFeatureId: new Map([
      [
        sketchFeatureId,
        {
          featureId: sketchFeatureId,
          entities: input.sketchEntities.map((entity) => ({
            entityId: entity.entityId,
            entityType: entity.entityType,
            onshapeEntityType:
              entity.entityType === "circle" ? "skCircle" : "skLineSegment",
            isConstruction: false,
            center3d: entity.center3d,
            radius: entity.radius,
            start3d: entity.start3d,
            end3d: entity.end3d,
          })),
        },
      ],
    ]),
    diagnostics: [],
  };
}

test("src/domain/import/onshape/fidelity-planner.spec.ts relationship-bearing fixture sketch remains parametric", () => {
  const read = makeStudioRead({
    sketchEntities: [
      {
        entityId: "seed_line",
        entityType: "lineSegment",
        start3d: [0, 0, 0],
        end3d: [0.01, 0, 0],
      },
      {
        entityId: "offset_line",
        entityType: "lineSegment",
        start3d: [0, 0.002, 0],
        end3d: [0.01, 0.002, 0],
      },
      { entityId: "profile", entityType: "circle", center3d: [0, 0, 0], radius: 0.005 },
    ],
    sketchConstraints: [
      {
        constraintType: "HORIZONTAL",
        entityId: "seed-horizontal",
        parameters: [{ parameterId: "localFirst", value: "seed_line", hasExternalQuery: false }],
      },
      {
        constraintType: "LENGTH",
        entityId: "seed-length",
        parameters: [
          { parameterId: "localFirst", value: "seed_line", hasExternalQuery: false },
          { parameterId: "length", expression: "10 mm", hasExternalQuery: false },
        ],
      },
      {
        constraintType: "OFFSET",
        entityId: "seed-offset",
        parameters: [
          { parameterId: "localMaster", value: "seed_line", hasExternalQuery: false },
          { parameterId: "localOffset", value: "offset_line", hasExternalQuery: false },
          { parameterId: "halfSpace0", value: "RIGHT", hasExternalQuery: false },
        ],
      },
    ],
    extrudeOperation: "NEW",
  });

  const plan = planStudioFidelity(read);
  const sketch = plan.featurePlans.find((entry) => entry.onshapeFeatureId === "S1");
  const extrude = plan.featurePlans.find((entry) => entry.onshapeFeatureId === "E_TARGET");
  expect(
    sketch?.tier === "parametric" && extrude?.tier === "parametric",
    "Constraint/dimension/derivation records on a fixture sketch should not demote otherwise translatable sketch/extrude planning.",
  ).toBeTruthy();
});

test("src/domain/import/onshape/fidelity-planner.spec.ts default-scope cut with a single upstream body plans parametric", () => {
  const read = makeStudioRead({
    sketchEntities: [
      { entityId: "c1", entityType: "circle", center3d: [0, 0, 0], radius: 0.005 },
    ],
    priorExtrudes: [{ featureId: "E_BASE", operation: "NEW" }],
    extrudeOperation: "REMOVE",
  });
  const plan = planStudioFidelity(read);
  const cut = plan.featurePlans.find((entry) => entry.onshapeFeatureId === "E_TARGET");
  expect(
    cut?.tier === "parametric" &&
      cut.plannedExtrude?.boolean.kind === "deferredBody" &&
      cut.plannedExtrude.boolean.sourceFeatureId === "E_BASE",
    "A default-scope cut with exactly one prior body-producing extrude should plan parametric with a deferred body reference.",
  ).toBeTruthy();
});

test("src/domain/import/onshape/fidelity-planner.spec.ts ambiguous default-scope boolean stays probe-gated", () => {
  const read = makeStudioRead({
    sketchEntities: [
      { entityId: "c1", entityType: "circle", center3d: [0, 0, 0], radius: 0.005 },
    ],
    extrudeOperation: "REMOVE",
  });
  const plan = planStudioFidelity(read);
  const cut = plan.featurePlans.find((entry) => entry.onshapeFeatureId === "E_TARGET");
  expect(
    cut?.tier === "baked" &&
      cut.reasonCodes.includes("needs-history-probe") &&
      !cut.reasonCodes.includes("needs-region-resolution"),
    "A default-scope cut with zero upstream bodies is a scope problem, not a region problem: it must be probe-gated.",
  ).toBeTruthy();
});

function rollbackSnapshot(
  featureId: string,
  bodyEnd: number | null,
): OnshapeRollbackSnapshot {
  return {
    featureId,
    tessellationTolerance: 0.0001,
    tessellatedFaces: {
      bodies: bodyEnd === null ? [] : [{
        id: "A",
        faces: [{
          id: "A-face",
          facets: [{
            vertices: [
              { x: 0, y: 0, z: 0 },
              { x: bodyEnd, y: 0, z: 0 },
              { x: bodyEnd, y: 1, z: 1 },
            ],
          }],
        }],
      }],
    },
  };
}

test("src/domain/import/onshape/fidelity-planner.spec.ts reviewer demotion replans a v2 body run into a segment", () => {
  const read = makeStudioRead({
    sketchEntities: [
      { entityId: "c1", entityType: "circle", center3d: [0, 0, 0], radius: 0.005 },
    ],
    priorExtrudes: [{ featureId: "E_BASE", operation: "NEW" }],
    extrudeOperation: "REMOVE",
  });
  read.studio.groundTruth = {
    hasBodies: true,
    tessellationTolerance: 0.0001,
    tessellatedFaces: {},
    step: "",
  };
  read.studio.rollbackSnapshots = [
    rollbackSnapshot("S1", null),
    rollbackSnapshot("E_BASE", 1),
    rollbackSnapshot("E_TARGET", 2),
  ];

  const baseline = planStudioFidelity(read, { captureFormatVersion: 2 });
  expect(baseline.bakeStrategy).toEqual({ kind: "none" });

  const demoted = planStudioFidelity(read, {
    captureFormatVersion: 2,
    demotedFeatureIds: ["E_TARGET"],
  });
  expect(demoted.requiresStudioBake).toBe(false);
  expect(demoted.bakeStrategy).toMatchObject({
    kind: "segments",
    segments: [{
      fromFeatureId: "E_TARGET",
      boundaryFeatureId: "E_TARGET",
      checkpointBodyDeterministicIds: ["A"],
      consumedBodyDeterministicIds: ["A"],
      replacementProducerFeatureIds: ["E_BASE"],
    }],
  });
  expect(demoted.featurePlans.find((plan) => plan.onshapeFeatureId === "E_TARGET")?.tier)
    .toBe("baked");
});

function makeTwoBranchStudioRead(): StudioReadResult {
  const sketchFeature = (
    featureId: string,
    name: string,
  ) => ({ featureType: "newSketch", featureId, name });
  const extrudeFeature = (
    featureId: string,
    sketchFeatureId: string,
    operation: string,
  ) => ({
    featureType: "extrude",
    featureId,
    name: featureId,
    parameters: [
      {
        parameterId: "entities",
        queries: [
          {
            queryString: `query = qSketchRegion(id + "${sketchFeatureId}", true);`,
          },
        ],
      },
      { parameterId: "endBound", value: "BLIND" },
      { parameterId: "depth", expression: "10 mm", value: 0.01 },
      { parameterId: "operationType", value: operation },
    ],
  });

  return {
    studio: {
      elementId: "e1",
      name: "Two branch",
      features: null,
      sketches: null,
      parts: null,
      featureSpecs: { present: false, reason: "n/a" },
      resolvedReferences: [],
      profileEvidence: [
        ["E_BAD", "S_BAD", [0, 0, 0]],
        ["E_GOOD", "S_GOOD", [0.05, 0.05, 0]],
        ["E_CUT", "S_GOOD", [0.05, 0.05, 0]],
      ].map(([consumingFeatureId, sourceSketchFeatureId, interiorPoint3d]) => ({
        consumingFeatureId,
        parameterId: "entities" as const,
        queryIndex: 0,
        resultIndex: 0,
        deterministicId: `two-branch-profile:${consumingFeatureId}`,
        evaluatedAt: "historyPoint" as const,
        kind: "sketchRegion" as const,
        sourceSketchFeatureId,
        interiorPoint3d: interiorPoint3d as [number, number, number],
      })),
      groundTruth: { hasBodies: true },
      rollbackSnapshots: null,
    },
    features: [
      sketchFeature("S_BAD", "Baked sketch source"),
      extrudeFeature("E_BAD", "S_BAD", "NEW"),
      sketchFeature("S_GOOD", "Independent sketch"),
      extrudeFeature("E_GOOD", "S_GOOD", "NEW"),
      extrudeFeature("E_CUT", "S_GOOD", "REMOVE"),
    ],
    solvedSketchesByFeatureId: new Map([
      [
        "S_BAD",
        {
          featureId: "S_BAD",
          entities: [
            {
              entityId: "bad_line",
              entityType: "lineSegment",
              onshapeEntityType: "skLineSegment",
              isConstruction: false,
              start3d: [0, 0, 0],
              end3d: [0.01, 0, 0],
            },
          ],
        },
      ],
      [
        "S_GOOD",
        {
          featureId: "S_GOOD",
          entities: [
            {
              entityId: "good_circle",
              entityType: "circle",
              onshapeEntityType: "skCircle",
              isConstruction: false,
              center3d: [0.05, 0.05, 0],
              radius: 0.005,
            },
          ],
        },
      ],
    ]),
    diagnostics: [],
  };
}

test("src/domain/import/onshape/fidelity-planner.spec.ts independent branch stays parametric after a baked branch", () => {
  const plan = planStudioFidelity(makeTwoBranchStudioRead());
  const byId = new Map(plan.featurePlans.map((entry) => [entry.onshapeFeatureId, entry]));
  const baked = byId.get("E_BAD");
  const independent = byId.get("E_GOOD");

  expect(
    baked?.tier === "baked" &&
      baked.reasonCodes.includes("needs-region-resolution") &&
      !baked.reasonCodes.includes("downstream-of-baked"),
    "The first branch should bake for its own selector failure, not because of cascade.",
  ).toBeTruthy();
  expect(
    independent?.tier === "parametric" &&
      independent.target.kind === "feature" &&
      independent.inputDependencies.some(
        (input) => input.kind === "sketch" && input.featureId === "S_GOOD",
      ) &&
      !independent.reasonCodes.includes("downstream-of-baked"),
    "An independent sketch/extrude branch after a baked branch should remain live.",
  ).toBeTruthy();
});

test("src/domain/import/onshape/fidelity-planner.spec.ts true dependent of baked body lineage still bakes", () => {
  const plan = planStudioFidelity(makeTwoBranchStudioRead());
  const cut = plan.featurePlans.find((entry) => entry.onshapeFeatureId === "E_CUT");

  expect(
    cut?.tier === "baked" &&
      cut.reasonCodes.includes("extrude-default-scope-ambiguous") &&
      !cut.reasonCodes.includes("needs-region-resolution") &&
      !cut.reasonCodes.includes("downstream-of-baked"),
    "A default-scope boolean with multiple body candidates should retain its specific scope-ambiguity reason rather than silently targeting the visible parametric body.",
  ).toBeTruthy();
});

test("src/domain/import/onshape/fidelity-planner.spec.ts deferred body from a baked lineage propagates downstream-of-baked", () => {
  const read = makeTwoBranchStudioRead();
  read.features = read.features.filter((feature) => feature.featureId !== "E_GOOD");
  const plan = planStudioFidelity(read);
  const cut = plan.featurePlans.find((entry) => entry.onshapeFeatureId === "E_CUT");

  expect(
    cut?.tier === "baked" &&
      cut.reasonCodes.includes("downstream-of-baked") &&
      cut.inputDependencies.some(
        (input) => input.kind === "body" && input.featureId === "E_BAD",
      ) &&
      cut.inputFeatureIds.includes("E_BAD"),
    "When the only body lineage candidate is baked, the consuming boolean is a true dependent and carries downstream-of-baked.",
  ).toBeTruthy();
});

test("src/domain/import/onshape/fidelity-planner.spec.ts assignVariable label", () => {
  const read: StudioReadResult = {
    studio: {
      elementId: "e1",
      name: "Vars",
      features: null,
      sketches: null,
      parts: null,
      featureSpecs: { present: false, reason: "n/a" },
      resolvedReferences: [],
      groundTruth: { hasBodies: false },
      rollbackSnapshots: null,
    },
    features: [
      {
        featureType: "assignVariable",
        featureId: "FVAR_1",
        name: "Variable 1",
        parameters: [
          { parameterId: "name", value: "nail" },
          { parameterId: "value", expression: "4 mm", value: 0.004 },
        ],
      },
    ],
    solvedSketchesByFeatureId: new Map(),
    diagnostics: [],
  };

  const plan = planStudioFidelity(read);
  expect(
    plan.featurePlans[0]?.label,
    "An assignVariable feature should be labelled by its authored variable name, not the generic feature name.",
  ).toBe("nail");
  expect(
    plan.featurePlans[0]?.tier === "parametric" &&
      plan.featurePlans[0]?.target.kind === "variable",
    "assignVariable should plan as a parametric document variable.",
  ).toBeTruthy();
});
