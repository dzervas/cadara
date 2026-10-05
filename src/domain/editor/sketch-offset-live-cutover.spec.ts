// T08b-g5a acceptance (logic lane). Seam: the live offset cutover driven from
// native session authoring (spline/line/rectangle tools → Offset tool →
// U-G3 commit wait → live solve → contracts publish), with the real
// kernel-free query and certifier; plus the persistence boundary
// (normalization, runtime schema), the solver's shell residual / U-G2 and
// the authored-action history.
import { describe, expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";

import type { AuthoredActionState } from "@/contracts/modeling/authored-actions";
import { getAuthoredLiteralValue } from "@/contracts/modeling/authored-values";
import type { ModelingDocumentSettings } from "@/contracts/modeling/schema";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import {
  CONTRACT_VERSION,
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  REVOLVE_FEATURE_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from "@/contracts/modeling/advanced-solid";
import {
  evaluateSketchDerivationJvp,
  evaluateSketchDerivations,
  prepareSketchDerivationPullback,
} from "@/contracts/sketch/derived-geometry";
import {
  applyOffsetPublications,
  isAcceptedOffsetOutput,
  isOffsetReplanRound,
  nonAcceptedOffsetOutputPoints,
  publishSketchOffsets,
  solvedPairDefinition,
} from "@/contracts/sketch/offset-publication";
import { extractDeclaredOffsetChainConnectivity } from "@/contracts/sketch/offset-chain-connectivity";
import { OFFSET_DIAGNOSTIC_CODES } from "@/contracts/sketch/offset-geometry";
import {
  validateSketchDefinition,
  validateSketchRecord,
  validateSolvedSketchSnapshot,
} from "@/contracts/sketch/runtime-schema";
import type {
  RegionRecord,
  SketchDefinition,
  SketchRecord,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import {
  DERIVED_SHELL_REQUIREMENT_UNSUPPORTED,
  OFFSET_REQUIREMENT_BLOCKED,
  evaluateSketchScalarConstraintForTest,
  getSketchSolveInitialValuesForTest,
  solveSketchDefinitionCore,
  validateSketchDefinitionCore,
} from "@/contracts/sketch/solver-core";
import {
  SOLVER_SCHEMA_VERSION,
  type DeriveSketchRegionsRequest,
  type DeriveSketchRegionsResponse,
  type SketchOffsetPublicationRecord,
  type SolveSketchRequest,
  type SolveSketchResponse,
} from "@/contracts/solver/schema";
import {
  acceptSketchDraw,
  finalizeSketchDraw,
  beginSketchGeometryDrag,
  beginSketchTool,
  completeSketchOffsetPreviewPublication,
  createNewSketchSessionFromSupport,
  createSketchSessionFromSnapshot,
  deleteSelectedSketchGeometry,
  finishSketchGeometryDrag,
  getSketchSessionDerivedValidity,
  getSketchSessionDisplayRenderables,
  patchSketchEditToolValue,
  publishSketchLiveRegions,
  selectSketchEditToolTarget,
  startSketchDraw,
  updateSketchGeometryDrag,
  updateSketchPointer,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import {
  completeSketchEditQueriesForTest,
  deriveSketchRegionsForTest,
} from "@/domain/editor/state-machine-test-builder";
import {
  initialEditorState,
  transitionEditorState,
  type EditorEffect,
  type EditorEffectRuntime,
  type EditorState,
  type SelectionCommandEditorState,
  type SketchEditorState,
} from "@/core/editor/state-machine";
import { runEditorEffect } from "@/application/editor/effect-registry";
import { resolveSessionSnap } from "@/domain/editor/sketch-session/tools";
import { TRIM_TOO_FEW_CUTS_MESSAGE } from "@/contracts/sketch/edit-intersections";
import {
  DERIVED_SHELL_DELETE_MESSAGE,
  DERIVED_SHELL_POINT_DELETE_MESSAGE,
  NON_ACCEPTED_OFFSET_EDIT_INPUT_CODE,
  offsetEditInputGate,
  refreshSketchEditToolAfterOffsetRound,
} from "@/domain/editor/sketch-session/editing";
import { AuthoredActionHistory } from "@/domain/modeling/authored-action-history";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import {
  normalizeSketchDefinition,
  normalizeSolvedSketchSnapshot,
} from "@/domain/modeling/modeling-service/normalization";
import { createCertifiedCubicTubeChain } from "@/domain/modeling/neutral-curve-certification/cubic-tube-chain";
import { createCertifiedNeutralCurveRequestQuery } from "@/domain/modeling/neutral-curve-certification/query";
import {
  OCC_KERNEL_SETTINGS,
  createStandardPlaneDefinition,
} from "@/domain/modeling/opencascade-kernel-seed";
import {
  executeOccFeature,
  type OccFeatureExecutionContext,
} from "@/domain/modeling/occ/features";
import { createOccTopologyProvenanceIndex } from "@/domain/modeling/occ/topology-stage";
import { trackNewSolidBody } from "@/domain/modeling/occ/topology";
import {
  NON_ACCEPTED_OFFSET_FEATURE_INPUT_CODE,
  nonAcceptedOffsetFeatureInputMessage,
} from "@/domain/modeling/sketch-feature-input";
import {
  createSketchDerivedTransformContribution,
  createSketchFilletMutation,
  createSketchOffsetDerivationContribution,
  offsetSideForSketchPoint,
} from "@/domain/sketch-editing/operations";
import {
  withLineLength,
  withoutFilletRelationships,
} from "@/contracts/sketch/offset-chain.fixtures";
import {
  createSessionCommitFactories,
  rebuildSessionForDefinition,
  withLiveSolveBasis,
} from "@/domain/editor/sketch-session/internals";
import {
  DEFAULT_MOCK_SKETCH_PLANE_FRAME,
  MockSketchSolverAdapter,
} from "@/domain/solver/mock-sketch-solver-adapter";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import {
  createSketchArrangementDeriver,
  offsetArrangementInput,
} from "@/contracts/sketch/region-extraction";
import { evaluateSplineSpan } from "@/contracts/sketch/spline-geometry";
import { getStableSketchSessionDisplayRenderables } from "@/domain/editor/sketch-session";
import {
  getDerivedShellDisplayValidity,
  getSketchSessionDisplaySolvedSnapshot,
} from "@/domain/editor/sketch-session/display";
import { getEntityAnchor } from "@/domain/editor/sketch-session/annotations";
import { collectSketchInteractionGeometry } from "@/domain/sketch-interaction/geometry";
import { collectSketchSnapGeometries } from "@/domain/sketch-snapping/snap-candidates";
import { deriveMeasurementViewModel } from "@/domain/measure/measurement";
import { buildSketchVectorExportModel } from "@/domain/export/sketch-vector-export-model";
import { buildOccRenderExport } from "@/domain/modeling/occ/snapshot";
import {
  getDefaultOpenCascadeInstance,
  type OpenCascadeInstance,
} from "@/domain/modeling/occ/runtime";
import {
  buildRegionProfileFace,
  regionBoundaryBasisOfSketchRecord,
  releaseBuiltSketchProfileFace,
} from "@/domain/modeling/occ/sketch-profile";
import { resolveRegionBoundaryCurve } from "@/contracts/sketch/region-boundary-curves";
import {
  NON_ACCEPTED_OFFSET_OUTPUT_PROJECTION_CODE,
  projectSketchExternalReferencesFromSnapshot,
} from "@/domain/modeling/sketch-reference-projection";
import {
  closedCurvesSignedArea,
  cubicOracle,
  lineOracle,
  type OracleCurve,
} from "@/contracts/sketch/region-extraction.fixtures";

/**
 * T08b-g7b fabricated triggers (spec-only): when a toggle names a
 * relationship, its solve frame fails as a plan/adoption failure, or its
 * frame derivative's pullback is unavailable (a singular joint). Both
 * toggles are off by default, so every other row runs the real module.
 */
const fabricated = vi.hoisted(() => ({
  planFailure: null as string | null,
  singularPullback: null as string | null,
}));
vi.mock(
  "@/contracts/sketch/offset-derivation-frame",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/contracts/sketch/offset-derivation-frame")
      >();
    return {
      ...actual,
      solveOffsetFrame: (
        ...args: Parameters<typeof actual.solveOffsetFrame>
      ): ReturnType<typeof actual.solveOffsetFrame> => {
        const relationship = args[0].relationship;
        if (fabricated.planFailure !== relationship.derivationId)
          return actual.solveOffsetFrame(...args);
        const seedEntityId = relationship.seedEntityIds[0]!;
        const failure = {
          ok: false as const,
          code: "derived-offset-knot-incidence-unproven" as const,
          message:
            "Declared vertex 0 is not buildable in the solve frame: fabricated adoption failure (spec-only).",
          seedEntityId,
        };
        return {
          ok: false,
          derivationId: relationship.derivationId,
          failure,
          diagnostic: {
            code: failure.code,
            severity: "error",
            message: `Offset relationship ${relationship.derivationId}: ${failure.message}`,
            target: { kind: "entity", entityId: seedEntityId },
          },
        } as ReturnType<typeof actual.solveOffsetFrame>;
      },
      prepareOffsetFrameDerivatives: (
        ...args: Parameters<typeof actual.prepareOffsetFrameDerivatives>
      ) => {
        const derivatives = actual.prepareOffsetFrameDerivatives(...args);
        if (fabricated.singularPullback !== args[0].relationship.derivationId)
          return derivatives;
        return {
          sourceDofs: derivatives.sourceDofs,
          jvp: (variations: Parameters<typeof derivatives.jvp>[0]) =>
            derivatives.jvp(variations),
          pullback: () => ({
            ok: false as const,
            code: "derived-offset-derivative-unavailable" as const,
            message: "fabricated singular joint (spec-only)",
            seedEntityId: null,
          }),
        };
      },
    };
  },
);

/** The shipped `public/cadara-occ` runtime (T10 T-1: the browser's bindings). */
let productionOcc: Promise<OpenCascadeInstance> | null = null;
function loadProductionOcc() {
  productionOcc ??= (async () => {
    const module = (await import("../../../public/cadara-occ.js")) as {
      default: new (
        module: Record<string, unknown>,
      ) => Promise<OpenCascadeInstance>;
    };
    const wasmBinary = new Uint8Array(
      await readFile(new URL("../../../public/cadara-occ.wasm", import.meta.url)),
    );
    return new module.default({ wasmBinary });
  })();
  return productionOcc;
}

const XY = {
  kind: "construction",
  constructionId: "construction_plane-xy",
} as const;
const capabilities = () => ({
  query: createCertifiedNeutralCurveRequestQuery(),
  certifier: createCertifiedCubicTubeChain(),
});
const SPLINE: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0.6],
  [2, -0.4],
];

function newSession(modelingTolerance = OCC_KERNEL_SETTINGS.modelingTolerance) {
  const settings: ModelingDocumentSettings = {
    ...OCC_KERNEL_SETTINGS,
    modelingTolerance,
  };
  return createNewSketchSessionFromSupport(XY, settings);
}

function drawSpline(
  session: SketchSessionState,
  points: readonly (readonly [number, number])[],
) {
  let next = beginSketchTool(session, "spline");
  next = startSketchDraw(next, points[0]!);
  for (const point of points.slice(1)) next = acceptSketchDraw(next, point);
  // A fit-point spline commits when it is finalized (T11i).
  return finalizeSketchDraw(next);
}

function drawLine(
  session: SketchSessionState,
  start: readonly [number, number],
  end: readonly [number, number],
) {
  return acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "line"), start),
    end,
  );
}

function stagedOffset(
  session: SketchSessionState,
  entityIds: readonly SketchEntityId[],
  distance: number,
) {
  let next = beginSketchTool(session, "offset");
  for (const entityId of entityIds) {
    const entity = next.definition.entities.find(
      (candidate) => candidate.entityId === entityId,
    )!;
    next = selectSketchEditToolTarget(next, entity.target);
  }
  return patchSketchEditToolValue(next, { value: distance });
}

/** Runs the staged preview's real publication, as the derivation worker does. */
function previewPublications(session: SketchSessionState) {
  const publication = session.activeEditTool!.offsetPublication!;
  const basis = publication.basis!;
  return {
    derivationId: publication.derivationId,
    publications: publishSketchOffsets({
      definition: basis.definition,
      solvedSnapshot: basis.solvedSnapshot,
      modelingTolerance: basis.modelingTolerance,
      capabilities: capabilities(),
    }),
  };
}

/** U-G3: Commit, then deliver the preview's publication (one G3 re-author at most). */
function commitCertified(session: SketchSessionState) {
  let next = patchSketchEditToolValue(session, { intent: "commitOffset" });
  for (let round = 0; round < 2; round += 1) {
    if (next.activeEditTool?.offsetPublication?.status !== "pending") break;
    const { derivationId, publications } = previewPublications(next);
    next = completeSketchOffsetPreviewPublication(
      next,
      derivationId,
      publications,
    );
  }
  return next;
}

/** The live publication round of a committed session (the derive effect). */
function livePublications(session: SketchSessionState) {
  const live = session.liveSolve!;
  return publishSketchOffsets({
    definition: live.definition,
    solvedSnapshot: live.solvedSnapshot,
    modelingTolerance: session.modelingTolerance,
    capabilities: capabilities(),
  });
}

function shellRecord(snapshot: SolvedSketchSnapshot) {
  const shell = snapshot.solvedEntities.find(
    (entity) => entity.kind === "derivedPiecewiseCubic",
  );
  if (shell?.kind !== "derivedPiecewiseCubic") throw new Error("no shell");
  return shell;
}

function offsetSplineSession(modelingTolerance?: number, distance = 0.2) {
  const drawn = drawSpline(newSession(modelingTolerance), SPLINE);
  const seed = drawn.definition.entities[0]!.entityId;
  const committed = commitCertified(stagedOffset(drawn, [seed], distance));
  return { drawn, seed, committed };
}

function solve(definition: SketchDefinition, modelingTolerance = 1e-3) {
  return solveSketchDefinitionCore({
    definition,
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    modelingTolerance,
    partialSolvePolicy: "bestEffort",
  });
}

/** Row 2's source-span edit: a fit point inserted into the seed spline. */
function withInsertedSeedOccurrence(
  definition: SketchDefinition,
  seed: SketchEntityId,
): SketchDefinition {
  const inserted = "sketch_point_g5a_inserted" as SketchPointId;
  return {
    ...definition,
    pointIds: [...definition.pointIds, inserted],
    points: [
      ...definition.points,
      {
        ...definition.points[0]!,
        pointId: inserted,
        label: "inserted",
        target: { ...definition.points[0]!.target, pointId: inserted },
        position: [1.5, 0.3],
      },
    ],
    entities: definition.entities.map((entity) =>
      entity.entityId === seed && entity.kind === "spline"
        ? {
            ...entity,
            pointOccurrenceIds: [
              ...entity.pointOccurrenceIds.slice(0, 2),
              "occ_inserted",
              ...entity.pointOccurrenceIds.slice(2),
            ],
            pointOccurrences: [
              ...entity.pointOccurrences.slice(0, 2),
              {
                occurrenceId: "occ_inserted",
                pointId: inserted,
                tangent: { kind: "automatic" },
              },
              ...entity.pointOccurrences.slice(2),
            ],
          }
        : entity,
    ),
  };
}

/**
 * SS-60 at d = 0.01, labelled: a native spline commit plus a second spline
 * fabricated on its end point (a shared point; the native tool would declare
 * a coincidence instead). Its first-choice representatives land outside the
 * certifier's witness bounds, so its first publication is `planChanged`.
 */
function ss60TwoSplines() {
  const drawn = drawSpline(newSession(), [
    [0, 0],
    [1, 0.1],
    [2, 0],
  ]);
  const first = drawn.definition.entities[0]!;
  if (first.kind !== "spline") throw new Error("spline");
  const template = drawn.definition.points[0]!;
  const extra = (
    [
      [2.5, 0.7],
      [3, 1.6],
    ] as const
  ).map((position, index) => ({
    ...template,
    pointId: `sketch_point_ss60_${index}` as SketchPointId,
    label: `ss60 ${index}`,
    target: {
      ...template.target,
      pointId: `sketch_point_ss60_${index}` as SketchPointId,
    },
    position,
  }));
  const secondId = "sketch_entity_ss60" as SketchEntityId;
  const occurrences = [
    first.pointOccurrences.at(-1)!.pointId,
    ...extra.map((point) => point.pointId),
  ].map((pointId, index) => ({
    occurrenceId: `ss60_${index}`,
    pointId,
    tangent: { kind: "automatic" as const },
  }));
  const twoSplines = {
    ...drawn,
    definition: {
      ...drawn.definition,
      pointIds: [
        ...drawn.definition.pointIds,
        ...extra.map((point) => point.pointId),
      ],
      points: [...drawn.definition.points, ...extra],
      entityIds: [...drawn.definition.entityIds, secondId],
      entities: [
        ...drawn.definition.entities,
        {
          ...first,
          entityId: secondId,
          label: "ss60",
          target: { ...first.target, entityId: secondId },
          pointOccurrenceIds: occurrences.map((item) => item.occurrenceId),
          pointOccurrences: occurrences,
        },
      ],
    } as SketchDefinition,
  };
  return { twoSplines, first, secondId };
}

describe("T08b-g5a live offset cutover", () => {
  test("row 1: two document tolerances are routed into the solve frame and the publish", () => {
    const coarse = offsetSplineSession(1e-3);
    const fine = offsetSplineSession(1e-6);
    for (const { committed } of [coarse, fine]) {
      expect(
        committed.definition.entities.some(
          (entity) => entity.kind === "derivedPiecewiseCubic",
        ),
        "Native authoring commits a derived shell once certified (U-G3).",
      ).toBe(true);
      expect(livePublications(committed)).toMatchObject([
        { status: "certified" },
      ]);
    }
    const coarseSpans = shellRecord(coarse.committed.liveSolve!.solvedSnapshot);
    const fineSpans = shellRecord(fine.committed.liveSolve!.solvedSnapshot);
    expect(
      fineSpans.spans.length,
      "A tighter document tolerance refines the owner partition (τ reaches the frame).",
    ).toBeGreaterThan(coarseSpans.spans.length);
    expect(
      Math.max(...fineSpans.spans.map((span) => span.certifiedError)),
    ).toBeLessThanOrEqual(1e-6);
    expect(
      coarseSpans.publication,
      "The solved shell is provisional until the session applies a publication (G7).",
    ).toBe("provisional");

    const adapter = new SketchConstraintSolverAdapter({
      revisionId: null,
      neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
    });
    const request = {
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: "request_missing_tau" as never,
      documentId: "doc_workspace" as never,
      revisionId: "rev_0001" as never,
      sketchId: "sketch_g5a" as never,
      plane: coarse.committed.plane.frame,
      tolerances: coarse.committed.solverTolerances,
      partialSolvePolicy: "bestEffort" as const,
      definition: coarse.committed.definition,
      projectedReferences: [],
    };
    return expect(
      adapter.solveSketch(request as never),
      "A solve request without the document modelingTolerance is rejected explicitly ([TECH] G12).",
    ).rejects.toThrow(/modelingTolerance/);
  });

  test("row 2: shell identity survives a partition change; a source-span change is topologyChanged with the authored edit kept", () => {
    const { committed, seed } = offsetSplineSession();
    const definition = committed.definition;
    const seedEntity = definition.entities.find((e) => e.entityId === seed)!;
    if (seedEntity.kind !== "spline") throw new Error("seed");
    const middle = seedEntity.pointOccurrences[1]!.pointId;
    const base = shellRecord(solve(definition).solvedSnapshot);
    const ids = (spans: readonly { outputSpanId: string }[]) => [
      ...new Set(spans.map((span) => span.outputSpanId)),
    ];
    let refined = false;
    for (const lift of [0.2, 0.9, 1.4, -0.6]) {
      const moved = {
        ...definition,
        points: definition.points.map((point) =>
          point.pointId === middle
            ? { ...point, position: [1, 0.6 + lift] as const }
            : point,
        ),
      };
      const shell = shellRecord(solve(moved).solvedSnapshot);
      expect(
        ids(shell.spans),
        "Output span identity is per source span, never per owner sub-span (D1).",
      ).toEqual(ids(base.spans));
      if (shell.spans.length !== base.spans.length) refined = true;
    }
    expect(refined, "The probe drag must change the owner partition.").toBe(
      true,
    );

    // Insert a fit point: the source-span set changes.
    const edited = withInsertedSeedOccurrence(definition, seed);
    const evaluation = evaluateSketchDerivations({
      definition: edited,
      modelingTolerance: 1e-3,
    });
    // [TECH] G16′: the failure is scoped to the relationship.
    expect(evaluation.diagnostics).toEqual([]);
    expect(
      evaluation.offsetFailures.find(
        (failure) =>
          failure.diagnostic.code === OFFSET_DIAGNOSTIC_CODES.topologyChanged,
      )?.diagnostic,
      "A source-span change is a targeted topologyChanged diagnostic.",
    ).toMatchObject({
      severity: "error",
      target: { kind: "entity", entityId: seed },
    });
    expect(
      evaluation.definition.derivedRelationships,
      "Authored intent is kept.",
    ).toEqual(edited.derivedRelationships);
  });

  test("row 3: atomic per-relationship failure (forged plan / outputs) — the other relationship certifies; stale display plus a source-linked diagnostic", () => {
    let session = drawSpline(newSession(), SPLINE);
    session = drawLine(session, [0, 3], [2, 3]);
    session = drawLine(session, [2, 3], [2, 5]);
    const [spline, lineA, lineB] = session.definition.entities
      .filter((entity) => entity.kind !== "point")
      .map((entity) => entity.entityId);
    session = commitCertified(stagedOffset(session, [spline!], 0.2));
    session = commitCertified(stagedOffset(session, [lineA!, lineB!], 0.3));
    const offsets = (session.definition.derivedRelationships ?? []).filter(
      (relationship) => relationship.kind === "offset",
    );
    expect(offsets, "Both offsets are authored (U-G3).").toHaveLength(2);
    const live = session.liveSolve!;
    expect(livePublications(session).map((item) => item.status)).toEqual([
      "certified",
      "certified",
    ]);

    // Forge: the line relationship's plan claims a certified hint and one of
    // its driven outputs is nudged by one ulp.
    const lineRelationship = offsets[1]!;
    if (lineRelationship.kind !== "offset") throw new Error("offset");
    const nudged = lineRelationship.outputs[0]!.outputPointIds[0]!;
    const forged: SolvedSketchSnapshot = {
      ...live.solvedSnapshot,
      solvedPoints: live.solvedSnapshot.solvedPoints.map((point) =>
        point.pointId === nudged
          ? {
              ...point,
              solvedPosition: [
                point.solvedPosition[0] + Number.EPSILON * 8,
                point.solvedPosition[1],
              ],
            }
          : point,
      ),
      offsetFramePlans: live.solvedSnapshot.offsetFramePlans!.map((record) =>
        record.derivationId === lineRelationship.derivationId
          ? { ...record, plan: { ...record.plan, origin: "certified" } }
          : record,
      ),
    };
    const publications = publishSketchOffsets({
      definition: live.definition,
      solvedSnapshot: forged,
      modelingTolerance: session.modelingTolerance,
      capabilities: capabilities(),
    });
    expect(
      publications[0]!.status,
      "The other relationship publishes (G5).",
    ).toBe("certified");
    expect(
      publications[1],
      "A forged plan/output can only fail closed, never certify other geometry (G17).",
    ).toMatchObject({
      derivationId: lineRelationship.derivationId,
      status: "failed",
      diagnostic: {
        code: OFFSET_DIAGNOSTIC_CODES.topologyUncertain,
        severity: "error",
        target: { kind: "entity" },
      },
    });

    // A forged hint that does not even fit is ignored: only the reproduced
    // (snapshot) frame can certify.
    const nonsense = publishSketchOffsets({
      definition: live.definition,
      solvedSnapshot: {
        ...live.solvedSnapshot,
        offsetFramePlans: live.solvedSnapshot.offsetFramePlans!.map(
          (record) => ({
            ...record,
            plan: {
              origin: "certified" as const,
              adjacencies: [{ kind: "arc" as const }, { kind: "arc" as const }],
            },
          }),
        ),
      },
      modelingTolerance: session.modelingTolerance,
      capabilities: capabilities(),
    });
    expect(nonsense.map((item) => item.status)).toEqual([
      "certified",
      "certified",
    ]);

    const published = publishSketchLiveRegions(session, [], [], publications);
    expect(
      shellRecord(published.liveSolve!.solvedSnapshot).publication,
      "The certified relationship's shell is marked certified (G7).",
    ).toBe("certified");
    const validity = getSketchSessionDerivedValidity(published);
    expect(
      validity.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === OFFSET_DIAGNOSTIC_CODES.topologyUncertain,
      ),
      "The failure is shown as a relationship-scoped diagnostic (G16).",
    ).toBe(true);
    expect(
      published.liveSolve!.solvedSnapshot.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === OFFSET_DIAGNOSTIC_CODES.topologyUncertain,
      ),
      "Publish failures never enter the solved snapshot (G16).",
    ).toBe(false);
    expect(
      applyOffsetPublications(live.definition, live.solvedSnapshot, [
        publications[1]!,
      ]),
      "A failed relationship certifies nothing.",
    ).toBe(live.solvedSnapshot);
  });

  test("row 4: JVP/adjoint and the point-on-shell gradient match finite differences through the solver", () => {
    const { committed, seed } = offsetSplineSession();
    const definition = committed.definition;
    const shell = definition.entities.find(
      (entity) => entity.kind === "derivedPiecewiseCubic",
    )!;
    const seedEntity = definition.entities.find((e) => e.entityId === seed)!;
    if (seedEntity.kind !== "spline") throw new Error("seed");
    // An authored tangent on the seed (native commit + tangent edit).
    const withTangent: SketchDefinition = {
      ...definition,
      entities: definition.entities.map((entity) =>
        entity.entityId === seed && entity.kind === "spline"
          ? {
              ...entity,
              pointOccurrences: entity.pointOccurrences.map(
                (occurrence, index) =>
                  index === 2
                    ? {
                        ...occurrence,
                        tangent: {
                          kind: "authored" as const,
                          vector: [0.9, -0.3] as const,
                        },
                      }
                    : occurrence,
              ),
            }
          : entity,
      ),
    };
    const evaluation = evaluateSketchDerivations({
      definition: withTangent,
      modelingTolerance: 1e-3,
    });
    expect(evaluation.diagnostics).toEqual([]);
    const occurrenceId = seedEntity.pointOccurrences[2]!.occurrenceId;
    const v = {
      points: Object.fromEntries(
        seedEntity.pointOccurrences.map((occurrence, index) => [
          occurrence.pointId,
          [0.3 - 0.2 * index, 0.1 + 0.4 * index] as const,
        ]),
      ),
      splineTangents: { [seed]: { [occurrenceId]: [0.5, -0.7] as const } },
    };
    const jvp = evaluateSketchDerivationJvp(evaluation, v);
    const relationship = withTangent.derivedRelationships!.find(
      (candidate) => candidate.kind === "offset",
    )!;
    if (relationship.kind !== "offset") throw new Error("offset");
    const output = relationship.piecewiseCubicOutputs[0]!;
    const w = {
      points: {
        [output.startPointId]: [0.7, -0.2] as const,
        [output.endPointId]: [-0.4, 0.9] as const,
      },
    };
    const pulled = prepareSketchDerivationPullback(evaluation)(w);
    const dot = (a: readonly number[], b: readonly number[]) =>
      a[0]! * b[0]! + a[1]! * b[1]!;
    const forward = Object.entries(w.points).reduce(
      (sum, [pointId, value]) =>
        sum + dot(jvp.points[pointId as SketchPointId]!, value),
      0,
    );
    const reverse =
      Object.entries(v.points).reduce(
        (sum, [pointId, value]) =>
          sum + dot(pulled.points?.[pointId as SketchPointId] ?? [0, 0], value),
        0,
      ) +
      dot(
        pulled.splineTangents?.[seed]?.[occurrenceId] ?? [0, 0],
        v.splineTangents[seed][occurrenceId],
      );
    expect(
      reverse,
      "⟨Jv, w⟩ = ⟨v, Jᵀw⟩ through the frame pullback.",
    ).toBeCloseTo(forward, 10);
    expect(
      Math.hypot(...(pulled.splineTangents?.[seed]?.[occurrenceId] ?? [0, 0])),
      "Seed authored tangents are pulled (no false zero).",
    ).toBeGreaterThan(1e-6);
    // FD of the shell terminal JVP.
    const h = 1e-6;
    const shifted = (sign: number) =>
      evaluateSketchDerivations({
        definition: {
          ...withTangent,
          points: withTangent.points.map((point) => {
            const delta = v.points[point.pointId];
            return delta
              ? {
                  ...point,
                  position: [
                    point.position[0] + sign * h * delta[0],
                    point.position[1] + sign * h * delta[1],
                  ] as const,
                }
              : point;
          }),
          entities: withTangent.entities.map((entity) =>
            entity.entityId === seed && entity.kind === "spline"
              ? {
                  ...entity,
                  pointOccurrences: entity.pointOccurrences.map((occurrence) =>
                    occurrence.occurrenceId === occurrenceId &&
                    occurrence.tangent.kind === "authored"
                      ? {
                          ...occurrence,
                          tangent: {
                            kind: "authored" as const,
                            vector: [
                              occurrence.tangent.vector[0] + sign * h * 0.5,
                              occurrence.tangent.vector[1] - sign * h * 0.7,
                            ] as const,
                          },
                        }
                      : occurrence,
                  ),
                }
              : entity,
          ),
        },
        modelingTolerance: 1e-3,
      }).definition.points.find((point) => point.pointId === output.endPointId)!
        .position;
    const fd = [
      (shifted(1)[0] - shifted(-1)[0]) / (2 * h),
      (shifted(1)[1] - shifted(-1)[1]) / (2 * h),
    ];
    const analytic = jvp.points[output.endPointId]!;
    expect(Math.abs(fd[0]! - analytic[0])).toBeLessThan(1e-6);
    expect(Math.abs(fd[1]! - analytic[1])).toBeLessThan(1e-6);

    // The point-on-shell residual's gradient against central FD.
    const pointId = "sketch_point_g5a_on_shell" as SketchPointId;
    const probe: SketchDefinition = {
      ...withTangent,
      pointIds: [...withTangent.pointIds, pointId],
      points: [
        ...withTangent.points,
        {
          ...withTangent.points[0]!,
          pointId,
          label: "on shell",
          target: { ...withTangent.points[0]!.target, pointId },
          position: [1, 0.45],
        },
      ],
      constraintIds: [...withTangent.constraintIds, "constraint_g5a_on_shell"],
      constraints: [
        ...withTangent.constraints,
        {
          constraintId: "constraint_g5a_on_shell",
          kind: "pointOnCurve",
          label: "on shell",
          point: { kind: "localPoint", pointId },
          curve: { kind: "localEntity", entityId: shell.entityId },
        } as SketchDefinition["constraints"][number],
      ],
    };
    const tolerances = {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    };
    const values = getSketchSolveInitialValuesForTest(probe, tolerances, 1e-3);
    const evaluate = (at: Float64Array) =>
      evaluateSketchScalarConstraintForTest({
        definition: probe,
        constraintId: "constraint_g5a_on_shell",
        values: at,
        tolerances,
        modelingTolerance: 1e-3,
      });
    const base = evaluate(values);
    expect(Number.isFinite(base.residual) && base.residual > 0).toBe(true);
    let checked = 0;
    for (let index = 0; index < values.length; index += 1) {
      const plus = values.slice();
      const minus = values.slice();
      plus[index] += 1e-6;
      minus[index] -= 1e-6;
      const fdi = (evaluate(plus).residual - evaluate(minus).residual) / 2e-6;
      expect(
        Math.abs(fdi - base.gradient[index]!),
        `point-on-shell gradient index ${index}`,
      ).toBeLessThan(1e-5 * Math.max(1, Math.abs(fdi)));
      if (Math.abs(fdi) > 1e-6) checked += 1;
    }
    expect(
      checked,
      "The gradient reaches seed points and tangents.",
    ).toBeGreaterThan(2);
  });

  test("row 5: a point-on-shell constraint moves seed points and authored tangents (U-G2: point-on-curve only)", () => {
    const { committed, seed } = offsetSplineSession();
    const definition = committed.definition;
    const shell = definition.entities.find(
      (entity) => entity.kind === "derivedPiecewiseCubic",
    )!;
    const seedEntity = definition.entities.find((e) => e.entityId === seed)!;
    if (seedEntity.kind !== "spline") throw new Error("seed");
    const pointId = "sketch_point_g5a_target" as SketchPointId;
    const constrained: SketchDefinition = {
      ...definition,
      entities: definition.entities.map((entity) =>
        entity.entityId === seed && entity.kind === "spline"
          ? {
              ...entity,
              pointOccurrences: entity.pointOccurrences.map(
                (occurrence, index) =>
                  index === 1
                    ? {
                        ...occurrence,
                        tangent: {
                          kind: "authored" as const,
                          vector: [1.2, -0.4] as const,
                        },
                      }
                    : occurrence,
              ),
            }
          : entity,
      ),
      pointIds: [...definition.pointIds, pointId],
      points: [
        ...definition.points,
        {
          ...definition.points[0]!,
          pointId,
          label: "target",
          target: { ...definition.points[0]!.target, pointId },
          position: [1, 0.95],
        },
      ],
      constraintIds: [
        ...definition.constraintIds,
        "constraint_g5a_fix",
        "constraint_g5a_poc",
        "constraint_g5a_fix_start",
        "constraint_g5a_fix_end",
      ],
      constraints: [
        ...definition.constraints,
        {
          constraintId: "constraint_g5a_fix",
          kind: "fixPoint",
          label: "fix",
          pointId,
          position: [1, 0.95],
        },
        {
          constraintId: "constraint_g5a_poc",
          kind: "pointOnCurve",
          label: "on offset",
          point: { kind: "localPoint", pointId },
          curve: { kind: "localEntity", entityId: shell.entityId },
        },
        {
          constraintId: "constraint_g5a_fix_start",
          kind: "fixPoint",
          label: "fix start",
          pointId: seedEntity.pointOccurrences[0]!.pointId,
          position: [0, 0],
        },
        {
          constraintId: "constraint_g5a_fix_end",
          kind: "fixPoint",
          label: "fix end",
          pointId: seedEntity.pointOccurrences[2]!.pointId,
          position: [2, -0.4],
        },
      ] as SketchDefinition["constraints"],
    };
    const solved = solve(constrained);
    expect(
      solved.status.solveState,
      JSON.stringify([
        solved.solvedSnapshot.diagnostics,
        solved.solvedSnapshot.constraintStatuses,
      ]),
    ).toBe("solved");
    expect(
      solved.solvedSnapshot.constraintStatuses.find(
        (status) => status.constraintId === "constraint_g5a_poc",
      )?.status,
    ).toBe("satisfied");
    const middle = solved.solvedSnapshot.solvedPoints.find(
      (point) => point.pointId === seedEntity.pointOccurrences[1]!.pointId,
    )!.solvedPosition;
    expect(
      Math.hypot(middle[0] - 1, middle[1] - 0.6),
      "The seed's free fit point moves to satisfy the shell constraint.",
    ).toBeGreaterThan(1e-3);
    const seedRecord = solved.solvedSnapshot.solvedEntities.find(
      (entity) => entity.entityId === seed,
    );
    if (
      seedRecord?.kind !== "spline" ||
      seedRecord.reconstruction.validity !== "valid"
    )
      throw new Error("seed record");
    const handle = seedRecord.reconstruction.handles[1]!;
    const authored = solvedPairDefinition(
      constrained,
      solved.solvedSnapshot,
    ).entities.find((entity) => entity.entityId === seed);
    expect(authored?.kind).toBe("spline");
    expect(
      Math.hypot(handle[0] - 1.2, handle[1] + 0.4),
      "The authored tangent is solver authority for the offset (no false zero).",
    ).toBeGreaterThan(1e-6);

    const tangentToShell = validateSketchDefinitionCore({
      definition: {
        ...definition,
        constraintIds: [...definition.constraintIds, "constraint_g5a_bad"],
        constraints: [
          ...definition.constraints,
          {
            constraintId: "constraint_g5a_bad",
            kind: "tangent",
            label: "tangent to offset",
            entityIds: [seed, shell.entityId],
          } as SketchDefinition["constraints"][number],
        ],
      },
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      modelingTolerance: 1e-3,
    });
    expect(
      tangentToShell.diagnostics.find(
        (diagnostic) =>
          diagnostic.code === DERIVED_SHELL_REQUIREMENT_UNSUPPORTED,
      ),
      "Any other constraint on a shell is an explicit error (U-G2).",
    ).toMatchObject({
      severity: "error",
      target: { kind: "constraint", constraintId: "constraint_g5a_bad" },
    });
  });

  test("row 6: v1alpha2 round trip; v1alpha1 and old fit-point offset payloads are rejected explicitly", () => {
    const { committed } = offsetSplineSession();
    const definition = committed.definition;
    const snapshot = committed.liveSolve!.solvedSnapshot;
    expect(validateSketchDefinition(definition).success).toBe(true);
    expect(validateSolvedSketchSnapshot(snapshot).success).toBe(true);
    const roundTripped = normalizeSketchDefinition(
      JSON.parse(JSON.stringify(definition)),
    );
    expect(
      roundTripped.derivedRelationships?.map((relationship) =>
        relationship.kind === "offset"
          ? [relationship.piecewiseCubicOutputs, relationship.jointOutputs]
          : null,
      ),
    ).toEqual(
      definition.derivedRelationships?.map((relationship) =>
        relationship.kind === "offset"
          ? [relationship.piecewiseCubicOutputs, relationship.jointOutputs]
          : null,
      ),
    );
    expect(roundTripped.entities).toEqual(
      JSON.parse(JSON.stringify(definition.entities)),
    );
    const solvedRoundTrip = JSON.parse(JSON.stringify(snapshot));
    expect(validateSolvedSketchSnapshot(solvedRoundTrip).success).toBe(true);
    expect(solvedRoundTrip).toEqual(snapshot);
    // The hand-written normalizer has no solved spline case (pre-existing);
    // its shell and plan cases are checked on the shell-only snapshot.
    const shellOnly = normalizeSolvedSketchSnapshot(
      JSON.parse(
        JSON.stringify({
          ...snapshot,
          solvedEntities: [shellRecord(snapshot)],
        }),
      ),
    );
    expect(shellRecord(shellOnly)).toEqual(shellRecord(snapshot));
    expect(shellOnly.offsetFramePlans).toEqual(snapshot.offsetFramePlans);

    const retired = {
      ...definition,
      schemaVersion: "sketch-definition/v1alpha1",
    };
    const rejected = validateSketchDefinition(retired);
    expect(rejected.success).toBe(false);
    expect(rejected.success ? null : rejected.issues[0]!.message).toMatch(
      /sketch-definition\/v1alpha1.*no migration/,
    );
    expect(() => normalizeSketchDefinition(retired)).toThrow(
      /sketch-definition\/v1alpha1/,
    );
    expect(
      validateSolvedSketchSnapshot({
        ...snapshot,
        schemaVersion: "solved-sketch/v1alpha1",
      }).success,
    ).toBe(false);
    expect(() =>
      normalizeSolvedSketchSnapshot({
        ...snapshot,
        schemaVersion: "solved-sketch/v1alpha1",
      }),
    ).toThrow(/solved-sketch\/v1alpha1/);

    // An old refit payload: the spline seed published as a fit-point output.
    const relationship = definition.derivedRelationships!.find(
      (candidate) => candidate.kind === "offset",
    )!;
    if (relationship.kind !== "offset") throw new Error("offset");
    const refit: SketchDefinition = {
      ...definition,
      derivedRelationships: [
        {
          ...relationship,
          outputs: [
            {
              seedEntityId: relationship.seedEntityIds[0]!,
              outputEntityId:
                relationship.piecewiseCubicOutputs[0]!.outputEntityId,
              instanceIndex: 1,
              seedPointIds: [],
              outputPointIds: [],
            },
          ],
        },
      ],
    };
    const refitResult = validateSketchDefinition(refit);
    expect(refitResult.success).toBe(false);
    expect(
      refitResult.success
        ? []
        : refitResult.issues.map((issue) => issue.message),
    ).toContain(
      "An offset spline seed has no fit-point output; its output is a derived shell.",
    );
    expect(() =>
      normalizeSketchDefinition(
        JSON.parse(
          JSON.stringify({
            ...definition,
            derivedRelationships: [
              { ...relationship, piecewiseCubicOutputs: undefined },
            ],
          }),
        ),
      ),
    ).toThrow(/offset derivation payload/);
    // Deleting the shell alone leaves the relationship naming a missing shell.
    const orphaned: SketchDefinition = {
      ...definition,
      entityIds: definition.entityIds.filter(
        (id) => id !== relationship.piecewiseCubicOutputs[0]!.outputEntityId,
      ),
      entities: definition.entities.filter(
        (entity) => entity.kind !== "derivedPiecewiseCubic",
      ),
    };
    expect(validateSketchDefinition(orphaned).success).toBe(false);
  });

  test("row 6b: the persisted sketch record validates solved offset frame plans as revision data: one per existing offset relationship (G17)", async () => {
    const { committed } = offsetSplineSession();
    const base = (
      await new MockKernelAdapter().getDocumentSnapshot({
        contractVersion: CONTRACT_VERSION,
        documentId: "doc_workspace",
      })
    ).snapshot.document.sketches[0]!.sketch;
    const snapshot = committed.liveSolve!.solvedSnapshot;
    const plans = snapshot.offsetFramePlans!;
    expect(plans, "premise: one solved plan").toHaveLength(1);
    const record = (offsetFramePlans: typeof plans) => ({
      ...structuredClone(base),
      definition: committed.definition,
      solvedSnapshot: { ...snapshot, offsetFramePlans },
      regions: [],
    });
    expect(validateSketchRecord(record(plans)).success).toBe(true);
    const issues = (offsetFramePlans: typeof plans) => {
      const result = validateSketchRecord(record(offsetFramePlans));
      return result.success ? [] : result.issues.map((issue) => issue.message);
    };
    expect(issues([...plans, plans[0]!])).toContain(
      "Solved offset frame plans must name each relationship once.",
    );
    expect(
      issues([{ ...plans[0]!, derivationId: "sketch_derivation_unknown" }]),
    ).toContain(
      "A solved offset frame plan must reference an existing offset relationship.",
    );
  });

  test("row 7: an invalid save/reopen gives equivalent diagnostics", () => {
    const { committed, seed } = offsetSplineSession();
    // Invalid edit: the seed's middle point collapses the inward offset
    // locally (the source-span set is unchanged; the frame fails).
    const definition = committed.definition;
    const invalid: SketchDefinition = {
      ...definition,
      derivedRelationships: definition.derivedRelationships!.map(
        (relationship) =>
          relationship.kind === "offset"
            ? { ...relationship, distance: 5 }
            : relationship,
      ),
    };
    const first = solve(invalid);
    // [TECH] G16′ (T08b-g7b): the frame failure is relationship-scoped. The
    // sketch stays solved, its snapshot carries no error, and the
    // publication round reports the relationship's diagnostic.
    expect(first.status.solveState).toBe("solved");
    expect(
      first.solvedSnapshot.diagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      ),
    ).toEqual([]);
    const publish = (
      definition: SketchDefinition,
      snapshot: SolvedSketchSnapshot,
    ) =>
      publishSketchOffsets({
        definition,
        solvedSnapshot: snapshot,
        modelingTolerance: 1e-3,
        capabilities: capabilities(),
      });
    const errorCodes = publish(invalid, first.solvedSnapshot).flatMap(
      (publication) =>
        publication.status === "failed" &&
        publication.diagnostic?.severity === "error"
          ? [publication.diagnostic]
          : [],
    );
    expect(errorCodes.length, "The invalid edit is diagnosed.").toBeGreaterThan(
      0,
    );
    expect(
      errorCodes.some(
        (diagnostic) =>
          diagnostic.target?.kind === "entity" &&
          diagnostic.target.entityId === seed,
      ),
      "The diagnostic is source-linked to the seed.",
    ).toBe(true);
    const reopened = normalizeSketchDefinition(
      JSON.parse(JSON.stringify(invalid)),
    );
    const second = solve(reopened);
    expect(
      second.solvedSnapshot.diagnostics,
      "Reopening the saved invalid document yields the same diagnostics (C8, T05).",
    ).toEqual(first.solvedSnapshot.diagnostics);
    expect(
      publish(reopened, second.solvedSnapshot),
      "Reopening yields the same relationship-scoped diagnostics (G16′).",
    ).toEqual(publish(invalid, first.solvedSnapshot));
    expect(validateSketchDefinition(reopened).success).toBe(true);
  });

  test("row 8: Offset Commit waits for the preview's certification and a failed check commits nothing (U-G3)", () => {
    const drawn = drawSpline(newSession(), SPLINE);
    const seed = drawn.definition.entities[0]!.entityId;
    const staged = stagedOffset(drawn, [seed], 0.2);
    expect(staged.activeEditTool?.offsetPublication).toMatchObject({
      status: "pending",
      commitRequested: false,
    });
    const waiting = patchSketchEditToolValue(staged, {
      intent: "commitOffset",
    });
    expect(waiting.definition, "Nothing is committed while pending.").toBe(
      staged.definition,
    );
    expect(waiting.activeEditTool?.offsetPublication).toMatchObject({
      status: "pending",
      commitRequested: true,
    });
    const derivationId =
      waiting.activeEditTool!.offsetPublication!.derivationId;
    expect(
      completeSketchOffsetPreviewPublication(waiting, "other_derivation", []),
      "A stale publication is ignored.",
    ).toBe(waiting);
    const failure: SketchOffsetPublicationRecord = {
      derivationId,
      status: "failed",
      diagnostic: {
        code: OFFSET_DIAGNOSTIC_CODES.topologyClearanceUnproven,
        severity: "error",
        message: "Offset relationship x: the offset could not be proved.",
        target: { kind: "entity", entityId: seed },
      },
    };
    const failed = completeSketchOffsetPreviewPublication(
      waiting,
      derivationId,
      [failure],
    );
    expect(failed.definition, "A failed check commits nothing.").toBe(
      staged.definition,
    );
    expect(failed.validationMessage).toBe(failure.diagnostic!.message);
    expect(failed.activeEditTool?.offsetPublication).toMatchObject({
      status: "failed",
      commitRequested: false,
    });
    expect(
      failed.toolPresentation?.validation?.[0]?.message ??
        JSON.stringify(failed.toolPresentation),
      "The error is shown on the preview.",
    ).toContain("could not be proved");
    expect(
      patchSketchEditToolValue(failed, { intent: "commitOffset" }).definition,
      "Commit stays refused after a failed check.",
    ).toBe(staged.definition);

    const certified = commitCertified(staged);
    expect(
      certified.definition.entities.some(
        (entity) => entity.kind === "derivedPiecewiseCubic",
      ),
    ).toBe(true);
  });

  test("row 8b: a planChanged preview publication re-solves ONCE with the certifier's hint and then certifies and commits (G3/G17)", () => {
    const { twoSplines, first, secondId } = ss60TwoSplines();
    const waiting = patchSketchEditToolValue(
      stagedOffset(twoSplines, [first.entityId, secondId], 0.01),
      { intent: "commitOffset" },
    );
    const round1 = previewPublications(waiting);
    expect(
      round1.publications.map((item) => item.status),
      "premise: the first publication asks for a re-solve",
    ).toEqual(["planChanged"]);
    const hint = round1.publications[0]!.plan!;
    expect(hint.origin).toBe("certified");
    const replanned = completeSketchOffsetPreviewPublication(
      waiting,
      round1.derivationId,
      round1.publications,
    );
    const pending = replanned.activeEditTool!.offsetPublication!;
    expect(pending).toMatchObject({
      status: "pending",
      replanned: true,
      commitRequested: true,
    });
    expect(
      pending.basis!.solvedSnapshot.offsetFramePlans,
      "The re-solve runs the certifier's hint unchanged.",
    ).toEqual([{ derivationId: pending.derivationId, plan: hint }]);
    const round2 = previewPublications(replanned);
    expect(round2.publications.map((item) => item.status)).toEqual([
      "certified",
    ]);
    const committed = completeSketchOffsetPreviewPublication(
      replanned,
      round2.derivationId,
      round2.publications,
    );
    expect(
      committed.definition.derivedRelationships?.map(
        (relationship) => relationship.derivationId,
      ),
      "The certified re-solved preview is committed.",
    ).toEqual([pending.derivationId]);
    expect(
      livePublications(committed).map((item) => item.status),
      "The published plan seeds the live solve: it certifies without another re-solve.",
    ).toEqual(["certified"]);
  });

  test("row 9: an unacceptable solve gets no certification (U-G1)", () => {
    const { committed, seed } = offsetSplineSession();
    const seedEntity = committed.definition.entities.find(
      (entity) => entity.entityId === seed,
    )!;
    if (seedEntity.kind !== "spline") throw new Error("seed");
    const pointId = seedEntity.pointOccurrences[0]!.pointId;
    const conflicting: SketchDefinition = {
      ...committed.definition,
      constraintIds: [...committed.definition.constraintIds, "c_a", "c_b"],
      constraints: [
        ...committed.definition.constraints,
        {
          constraintId: "c_a",
          kind: "fixPoint",
          label: "a",
          pointId,
          position: [0, 0],
        },
        {
          constraintId: "c_b",
          kind: "fixPoint",
          label: "b",
          pointId,
          position: [9, 0],
        },
      ] as SketchDefinition["constraints"],
    };
    const solved = solve(conflicting);
    expect(
      publishSketchOffsets({
        definition: conflicting,
        solvedSnapshot: solved.solvedSnapshot,
        modelingTolerance: 1e-3,
        capabilities: capabilities(),
      }),
      "Offsets certify only from an accepted solve.",
    ).toEqual([]);
    const preview = stagedOffset(
      { ...committed, definition: conflicting },
      [seed],
      0.1,
    );
    expect(preview.activeEditTool?.offsetPublication).toMatchObject({
      status: "failed",
      basis: null,
    });
  });

  test("row 10: a shell is never a seed of an offset, mirror, pattern or transform, and is not deleted alone (U-G2)", () => {
    const { committed } = offsetSplineSession();
    const shell = committed.definition.entities.find(
      (entity) => entity.kind === "derivedPiecewiseCubic",
    )!;
    const reoffset = stagedOffset(committed, [shell.entityId], 0.1);
    expect(reoffset.validationMessage).toBe(
      "An offset spline curve cannot be offset again yet.",
    );
    expect(reoffset.activeEditTool?.offsetPublication).toBeUndefined();
    for (const operatorKind of ["linearPattern", "transform"] as const) {
      const result = createSketchDerivedTransformContribution({
        definition: committed.definition,
        operatorKind,
        entityIds: [shell.entityId],
        value: 1,
        sequence: 99,
        factories: createSessionCommitFactories(99, "sketch_draft" as never),
        modelingTolerance: 1e-3,
      });
      expect(result).toMatchObject({
        valid: false,
        contribution: null,
        message:
          "An offset spline curve cannot be mirrored, patterned or transformed yet.",
      });
    }
    const deleted = deleteSelectedSketchGeometry(committed, [shell.target]);
    expect(deleted.definition).toBe(committed.definition);
    expect(deleted.validationMessage).toBe(DERIVED_SHELL_DELETE_MESSAGE);
  });

  test("row 11: the offset action's shell lives and dies with its relationship in the authored-action history", () => {
    const { drawn, committed } = offsetSplineSession();
    const identity = {
      actorId: "actor-g5a",
      documentId: "doc-g5a",
      context: { kind: "sketch" as const, sketchId: "sketch-g5a" },
    };
    const state = (definition: SketchDefinition): AuthoredActionState =>
      ({
        documentId: "doc-g5a",
        context: { kind: "sketch", sketchId: "sketch-g5a" },
        data: {
          sketchId: "sketch-g5a",
          label: "Sketch",
          plane: drawn.plane,
          definition,
        },
      }) as AuthoredActionState;
    const history = new AuthoredActionHistory();
    const before = state(drawn.definition);
    const after = state(committed.definition);
    const authored = history.commit(identity, before, after, "Offset", before);
    expect(authored.status).toBe("applied");
    if (authored.status !== "applied") return;
    const undone = history.undo(identity, authored.state);
    expect(undone.status).toBe("applied");
    if (undone.status !== "applied") return;
    const undoneDefinition = (
      undone.state.data as { definition: SketchDefinition }
    ).definition;
    expect(
      undoneDefinition.entities.some(
        (entity) => entity.kind === "derivedPiecewiseCubic",
      ) ||
        (undoneDefinition.derivedRelationships ?? []).length > 0 ||
        undoneDefinition.points.length !== drawn.definition.points.length,
      "Undo removes the relationship, the shell and its driven points in one action.",
    ).toBe(false);
    const redone = history.redo(identity, undone.state);
    expect(redone.status).toBe("applied");
    if (redone.status !== "applied") return;
    expect(
      validateSketchDefinition(
        (redone.state.data as { definition: SketchDefinition }).definition,
      ).success,
      "Redo restores a valid shell + relationship.",
    ).toBe(true);
  });
});

function offsetRelationshipOf(definition: SketchDefinition) {
  const relationship = definition.derivedRelationships?.findLast(
    (candidate) => candidate.kind === "offset",
  );
  if (relationship?.kind !== "offset") throw new Error("no offset");
  return relationship;
}

const KERNEL_REQUEST = {
  contractVersion: CONTRACT_VERSION,
  documentId: "doc_workspace",
} as const;

/** Finish through the mock kernel (commit), then read the saved record back. */
async function commitToMockKernel(
  definition: SketchDefinition,
  solverAdapter?: MockSketchSolverAdapter | SketchConstraintSolverAdapter,
) {
  const adapter = new MockKernelAdapter(
    solverAdapter ? { solverAdapter } : undefined,
  );
  const before = await adapter.getDocumentSnapshot(KERNEL_REQUEST);
  const response = await adapter.commitSketch({
    ...KERNEL_REQUEST,
    baseRevisionId: before.snapshot.document.revisionId,
    solverCorrelation: {
      requestId: "request_g5a_fix",
      projectionRequestId: "request_g5a_fix:project",
      validationRequestId: "request_g5a_fix:validate",
      solveRequestId: "request_g5a_fix:solve",
      regionRequestId: "request_g5a_fix:regions",
    },
    sketchId: null,
    sketchLabel: "G5a review fixes",
    plane: before.snapshot.document.sketches[0]!.plane,
    definition,
  });
  const after = await adapter.getDocumentSnapshot(KERNEL_REQUEST);
  const record = after.snapshot.document.sketches.find(
    (entry) => entry.sketchId === response.sketchId,
  )?.sketch;
  return { response, record };
}

/** A mock solver that records its solve requests and can forge a round (spec-only fake port). */
class RecordingSolverAdapter extends MockSketchSolverAdapter {
  readonly solves: SolveSketchRequest[] = [];
  readonly solved: SolveSketchResponse[] = [];
  forgeSolve?: (request: SolveSketchRequest) => SolveSketchRequest;
  forgeDerive?: (
    response: DeriveSketchRegionsResponse,
    request: DeriveSketchRegionsRequest,
  ) => DeriveSketchRegionsResponse;

  constructor() {
    super({
      neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
    });
  }

  override async solveSketch(request: SolveSketchRequest) {
    this.solves.push(request);
    const response = await super.solveSketch(
      this.forgeSolve ? this.forgeSolve(request) : request,
    );
    this.solved.push(response);
    return response;
  }

  override async deriveSketchRegions(request: DeriveSketchRegionsRequest) {
    const response = await super.deriveSketchRegions(request);
    return this.forgeDerive ? this.forgeDerive(response, request) : response;
  }
}

/**
 * [TECH] G18: a broken seed is a valid authored state. It validates, shows
 * its diagnostic, keeps the shell non-consumable, survives Finish (mock
 * commit), save (record validation) and reopen with equal diagnostics, and
 * Undo recovers the certified offset.
 */
async function expectRetainedBrokenSeed(
  committed: SketchSessionState,
  broken: SketchSessionState,
  code: string,
  seed: SketchEntityId,
) {
  const relationship = offsetRelationshipOf(committed.definition);
  const diagnosed = (
    diagnostics: readonly { code: string; target: unknown }[],
  ) =>
    diagnostics.some(
      (diagnostic) =>
        diagnostic.code === code &&
        JSON.stringify(diagnostic.target) ===
          JSON.stringify({ kind: "entity", entityId: seed }),
    );
  expect(
    validateSketchDefinition(broken.definition).success,
    "G18: the broken-seed definition passes the persistence schema.",
  ).toBe(true);
  expect(
    offsetRelationshipOf(broken.definition),
    "The relationship (authored intent) is kept.",
  ).toEqual(relationship);
  expect(
    broken.definition.entities.some(
      (entity) => entity.kind === "derivedPiecewiseCubic",
    ),
  ).toBe(true);
  // [TECH] G16′ (T08b-g7b): the relationship's failure is scoped to it and
  // reported by the live publication round; the sketch stays solved.
  expect(broken.liveSolve!.solvedSnapshot.status.solveState).toBe("solved");
  expect(
    diagnosed(
      getSketchSessionDerivedValidity(
        publishSketchLiveRegions(broken, [], [], livePublications(broken)),
      ).diagnostics,
    ),
    "The session reports the source-linked diagnostic.",
  ).toBe(true);
  expect(
    livePublications(broken).filter((item) => item.status === "certified"),
    "The broken relationship never certifies.",
  ).toEqual([]);
  expect(shellRecord(broken.liveSolve!.solvedSnapshot).publication).toBe(
    "provisional",
  );

  const { response, record } = await commitToMockKernel(broken.definition);
  expect(response.revisionState.kind, "Finish is accepted.").toBe("accepted");
  if (!record) throw new Error("no saved record");
  expect(
    validateSketchRecord(record).success,
    "The saved record validates.",
  ).toBe(true);
  expect(diagnosed(record.derivedValidity.diagnostics)).toBe(true);
  expect(shellRecord(record.solvedSnapshot).publication).toBe("provisional");
  const reopened = normalizeSketchDefinition(
    JSON.parse(JSON.stringify(record.definition)),
  );
  expect(validateSketchDefinition(reopened).success).toBe(true);
  expect(
    offsetRelationshipOf(reopened).piecewiseCubicOutputs,
    "The shell outputs survive save and reopen.",
  ).toEqual(relationship.piecewiseCubicOutputs);
  expect(
    solve(reopened).solvedSnapshot.diagnostics,
    "Reopening gives equal diagnostics (C8, T05).",
  ).toEqual(solve(broken.definition).solvedSnapshot.diagnostics);
  const reopenedRound = await commitToMockKernel(reopened);
  expect(
    reopenedRound.record?.derivedValidity.diagnostics,
    "Reopening and saving again gives equal relationship-scoped diagnostics (G16′).",
  ).toEqual(record.derivedValidity.diagnostics);

  const identity = {
    actorId: "actor-g5a",
    documentId: "doc-g5a",
    context: { kind: "sketch" as const, sketchId: "sketch-g5a" },
  };
  const state = (definition: SketchDefinition): AuthoredActionState =>
    ({
      documentId: "doc-g5a",
      context: { kind: "sketch", sketchId: "sketch-g5a" },
      data: {
        sketchId: "sketch-g5a",
        label: "Sketch",
        plane: committed.plane,
        definition,
      },
    }) as AuthoredActionState;
  const history = new AuthoredActionHistory();
  const before = state(committed.definition);
  const applied = history.commit(
    identity,
    before,
    state(broken.definition),
    "Edit",
    before,
  );
  if (applied.status !== "applied") throw new Error("not applied");
  const undone = history.undo(identity, applied.state);
  if (undone.status !== "applied") throw new Error("not undone");
  const restored = (undone.state.data as { definition: SketchDefinition })
    .definition;
  const sortedIds = (definition: SketchDefinition) => [
    [...definition.pointIds].sort(),
    [...definition.entityIds].sort(),
  ];
  expect(sortedIds(restored), "Undo restores the seed records.").toEqual(
    sortedIds(committed.definition),
  );
  expect(offsetRelationshipOf(restored)).toEqual(relationship);
  expect(
    livePublications(
      rebuildSessionForDefinition(broken, { definition: restored }),
    ).map((item) => item.status),
    "Undo restores the seed and the offset certifies again.",
  ).toEqual(["certified"]);
}

describe("T08b-g5a review fixes", () => {
  test("row 12 (B1, [TECH] G18): deleting the offset seed survives validation, Finish, save and reopen with the missing-seed diagnostic; the shell stays non-consumable; Undo recovers", async () => {
    const { committed, seed } = offsetSplineSession();
    const seedEntity = committed.definition.entities.find(
      (entity) => entity.entityId === seed,
    )!;
    const deleted = deleteSelectedSketchGeometry(committed, [
      seedEntity.target,
    ]);
    expect(
      deleted.definition.entities.some((entity) => entity.entityId === seed),
      "premise: the seed is deleted",
    ).toBe(false);
    await expectRetainedBrokenSeed(
      committed,
      deleted,
      OFFSET_DIAGNOSTIC_CODES.unsupportedSeed,
      seed,
    );
  });

  test("row 12b (B1, [TECH] G18): a fit point inserted into the seed survives validation, Finish, save and reopen as topologyChanged with the authored edit kept; Undo recovers", async () => {
    const { committed, seed } = offsetSplineSession();
    const edited = rebuildSessionForDefinition(committed, {
      definition: withInsertedSeedOccurrence(committed.definition, seed),
    });
    await expectRetainedBrokenSeed(
      committed,
      edited,
      OFFSET_DIAGNOSTIC_CODES.topologyChanged,
      seed,
    );
    const { record } = await commitToMockKernel(edited.definition);
    const savedSeed = record!.definition.entities.find(
      (entity) => entity.entityId === seed,
    );
    expect(
      savedSeed?.kind === "spline" ? savedSeed.pointOccurrenceIds : null,
      "The authored seed edit is saved.",
    ).toContain("occ_inserted");
  });

  test("row 13 (B2): deleting unrelated geometry keeps the shell's driven terminal points and the offset still certifies; a terminal alone is not deletable; a missing terminal is invalid", () => {
    const { committed } = offsetSplineSession();
    const terminals = offsetRelationshipOf(
      committed.definition,
    ).piecewiseCubicOutputs.flatMap((output) => [
      output.startPointId,
      output.endPointId,
    ]);
    const withLine = drawLine(committed, [5, 5], [6, 6]);
    const line = withLine.definition.entities.find(
      (entity) => entity.kind === "lineSegment",
    )!;
    const afterDelete = deleteSelectedSketchGeometry(withLine, [line.target]);
    expect(
      afterDelete.definition.entities.some(
        (entity) => entity.entityId === line.entityId,
      ),
      "premise: the line is deleted",
    ).toBe(false);
    expect(
      terminals.map((id) => afterDelete.definition.pointIds.includes(id)),
      "The shell's driven terminals are referenced by their relationship.",
    ).toEqual(terminals.map(() => true));
    expect(
      afterDelete.definition.entities.some(
        (entity) => entity.kind === "derivedPiecewiseCubic",
      ),
    ).toBe(true);
    expect(validateSketchDefinition(afterDelete.definition).success).toBe(true);
    expect(
      livePublications(afterDelete).map((item) => item.status),
      "The offset still publishes.",
    ).toEqual(["certified"]);

    const terminal = afterDelete.definition.points.find(
      (point) => point.pointId === terminals[0],
    )!;
    const rejected = deleteSelectedSketchGeometry(afterDelete, [
      terminal.target,
    ]);
    expect(rejected.definition, "Nothing is deleted.").toBe(
      afterDelete.definition,
    );
    expect(rejected.validationMessage).toBe(DERIVED_SHELL_POINT_DELETE_MESSAGE);

    const missing: SketchDefinition = {
      ...afterDelete.definition,
      pointIds: afterDelete.definition.pointIds.filter(
        (id) => id !== terminals[0],
      ),
      points: afterDelete.definition.points.filter(
        (point) => point.pointId !== terminals[0],
      ),
    };
    const result = validateSketchDefinition(missing);
    expect(
      result.success ? [] : result.issues.map((issue) => issue.message),
    ).toContain(
      "A derived shell's driven terminal point must exist (it is deleted only with its relationship).",
    );
  });

  test("row 14 (R1, [TECH] G9): the side test measures the closest point of the exact chain (an arc's sweep, not its circle) and agrees with the committed relationship's sign", () => {
    /** Commits the offset staged at `pointer` and returns its side. */
    const committedSide = (
      session: SketchSessionState,
      seeds: readonly SketchEntityId[],
      pointer: readonly [number, number],
    ) => {
      const staged = updateSketchPointer(
        stagedOffset(session, seeds, 0.1),
        pointer as never,
      );
      const committed = commitCertified(staged);
      const distance = getAuthoredLiteralValue<number>(
        offsetRelationshipOf(committed.definition).distance,
      )!;
      return { side: distance > 0 ? "left" : "right", committed };
    };
    const sideOf = (
      session: SketchSessionState,
      seeds: readonly SketchEntityId[],
      point: readonly [number, number],
    ) =>
      offsetSideForSketchPoint({
        definition: session.definition,
        entityIds: seeds,
        point: point as never,
      });

    // Line chain.
    const line = drawLine(newSession(), [0, 0], [10, 0]);
    const lineSeeds = [line.definition.entities[0]!.entityId];
    expect(sideOf(line, lineSeeds, [5, 1])).toBe("left");
    expect(sideOf(line, lineSeeds, [5, -1])).toBe("right");
    for (const [pointer, expected] of [
      [[5, 1], "left"],
      [[5, -1], "right"],
    ] as const) {
      const { side, committed } = committedSide(line, lineSeeds, pointer);
      expect(side).toBe(expected);
      const outputs = committed.definition.points.filter(
        (point) => !line.definition.pointIds.includes(point.pointId),
      );
      expect(
        outputs.every((point) => Math.sign(point.position[1]) === pointer[1]),
        "The committed offset lies on the pointer's side.",
      ).toBe(true);
    }

    // Line → counter-clockwise arc (centre (0,5), (0,0) → (5,5)); the review
    // probe's off-sweep pointer (0,10.5) is 0.5 from the arc's circle but
    // closest to the arc's end (5,5), whose tangent (0,1) puts it left.
    const base = drawLine(newSession(), [-10, 0], [0, 0]);
    const lineEntity = base.definition.entities[0]!;
    if (lineEntity.kind !== "lineSegment") throw new Error("line");
    const template = base.definition.points[0]!;
    const point = (name: string, position: readonly [number, number]) => ({
      ...template,
      pointId: `sketch_point_g9_${name}` as SketchPointId,
      label: name,
      target: {
        ...template.target,
        pointId: `sketch_point_g9_${name}` as SketchPointId,
      },
      position,
    });
    const arcId = "sketch_entity_g9_arc" as SketchEntityId;
    const extra = [point("center", [0, 5]), point("end", [5, 5])];
    const arcSession = rebuildSessionForDefinition(base, {
      definition: {
        ...base.definition,
        pointIds: [
          ...base.definition.pointIds,
          ...extra.map((item) => item.pointId),
        ],
        points: [...base.definition.points, ...extra],
        entityIds: [...base.definition.entityIds, arcId],
        entities: [
          ...base.definition.entities,
          {
            kind: "arc",
            entityId: arcId,
            label: "arc",
            target: { ...lineEntity.target, entityId: arcId },
            isConstruction: false,
            centerPointId: extra[0]!.pointId,
            startPointId: lineEntity.endPointId,
            endPointId: extra[1]!.pointId,
            sweepDirection: "counterClockwise",
          } as SketchDefinition["entities"][number],
        ],
      },
    });
    const arcSeeds = [lineEntity.entityId, arcId];
    expect(sideOf(arcSession, arcSeeds, [0, 10.5]), "off the sweep").toBe(
      "left",
    );
    expect(sideOf(arcSession, arcSeeds, [4, 1]), "outside the arc").toBe(
      "right",
    );
    expect(sideOf(arcSession, arcSeeds, [2.5, 2.5]), "inside the arc").toBe(
      "left",
    );
    expect(sideOf(arcSession, arcSeeds, [6, 5]), "outside the arc's end").toBe(
      "right",
    );
    // Off the sweep past the arc's end: 0.41 outside its circle, but left of
    // the end tangent.
    expect(sideOf(arcSession, arcSeeds, [4.5, 8]), "past the arc's end").toBe(
      "left",
    );
    expect(committedSide(arcSession, arcSeeds, [0, 10.5]).side).toBe("left");
    expect(committedSide(arcSession, arcSeeds, [4, 1]).side).toBe("right");

    // Spline chain.
    const spline = drawSpline(newSession(), SPLINE);
    const splineSeeds = [spline.definition.entities[0]!.entityId];
    expect(sideOf(spline, splineSeeds, [1, 1.2])).toBe("left");
    expect(sideOf(spline, splineSeeds, [1, 0])).toBe("right");
    expect(committedSide(spline, splineSeeds, [1, 1.2]).side).toBe("left");
    expect(committedSide(spline, splineSeeds, [1, 0]).side).toBe("right");

    // A reversed first piece: N2 traverses (10,0) → (0,0) → (−10,0), the
    // second line first and against its natural direction.
    const reversedBase = drawLine(newSession(), [0, 0], [-10, 0]);
    const first = reversedBase.definition.entities[0]!;
    if (first.kind !== "lineSegment") throw new Error("line");
    const secondId = "sketch_entity_g9_second" as SketchEntityId;
    const far = point("far", [10, 0]);
    const reversed = rebuildSessionForDefinition(reversedBase, {
      definition: {
        ...reversedBase.definition,
        pointIds: [...reversedBase.definition.pointIds, far.pointId],
        points: [...reversedBase.definition.points, far],
        entityIds: [...reversedBase.definition.entityIds, secondId],
        entities: [
          ...reversedBase.definition.entities,
          {
            ...first,
            entityId: secondId,
            label: "second",
            target: { ...first.target, entityId: secondId },
            startPointId: first.startPointId,
            endPointId: far.pointId,
          },
        ],
      },
    });
    const reversedSeeds = [first.entityId, secondId];
    const connectivity = extractDeclaredOffsetChainConnectivity({
      definition: reversed.definition,
      seedIds: reversedSeeds,
    });
    expect(
      connectivity.ok
        ? [
            connectivity.pieces[0]!.seedEntityId,
            connectivity.pieces[0]!.reversed,
          ]
        : null,
      "premise: the first traversed piece is reversed",
    ).toEqual([secondId, true]);
    // The traversal runs towards −x: below is left, on both pieces.
    expect(sideOf(reversed, reversedSeeds, [5, -1])).toBe("left");
    expect(sideOf(reversed, reversedSeeds, [5, 1])).toBe("right");
    expect(sideOf(reversed, reversedSeeds, [-5, 1])).toBe("right");
    expect(committedSide(reversed, reversedSeeds, [5, -1]).side).toBe("left");
    expect(committedSide(reversed, reversedSeeds, [5, 1]).side).toBe("right");
  });

  test("row 15 (R2, [TECH] G3): the kernel commit round re-solves ONCE on planChanged, persists certified shells with published-origin plans; a forced second mismatch fails closed with no third round", async () => {
    const { twoSplines, first, secondId } = ss60TwoSplines();
    const committed = commitCertified(
      stagedOffset(twoSplines, [first.entityId, secondId], 0.01),
    );
    const definition = committed.definition;
    const derivationId = offsetRelationshipOf(definition).derivationId;

    // (a) planChanged → one hinted re-solve → certified.
    const solver = new RecordingSolverAdapter();
    const { record } = await commitToMockKernel(definition, solver);
    expect(solver.solves, "exactly two solves").toHaveLength(2);
    expect(
      solver.solves[1]!.offsetPlans?.map((item) => item.plan.origin),
      "The re-solve runs the certifier's hint unchanged.",
    ).toEqual(["certified"]);
    expect(
      record!.solvedSnapshot.solvedEntities
        .filter((entity) => entity.kind === "derivedPiecewiseCubic")
        .map((entity) =>
          entity.kind === "derivedPiecewiseCubic" ? entity.publication : null,
        ),
    ).toEqual(["certified", "certified"]);
    expect(
      record!.solvedSnapshot.offsetFramePlans?.map((item) => [
        item.derivationId,
        item.plan.origin,
      ]),
      "Persisted plans are carried as published hints (review A1).",
    ).toEqual([[derivationId, "published"]]);

    // (b) A forged round-2 hint that is not the certifier's plan (the
    // round-1 first choice, origin certified) fails closed in publish.
    const forged = new RecordingSolverAdapter();
    forged.forgeSolve = (request) =>
      request.offsetPlans
        ? {
            ...request,
            offsetPlans: forged.solved[0]!.solvedSnapshot.offsetFramePlans!.map(
              (item) => ({
                ...item,
                plan: { ...item.plan, origin: "certified" as const },
              }),
            ),
          }
        : request;
    const failed = (await commitToMockKernel(definition, forged)).record!;
    expect(forged.solves, "no third round").toHaveLength(2);
    const isUncertain = (diagnostic: { code: string }) =>
      diagnostic.code === OFFSET_DIAGNOSTIC_CODES.topologyUncertain;
    expect(
      failed.derivedValidity.diagnostics.filter(isUncertain),
      "A relationship-scoped, source-linked diagnostic.",
    ).toMatchObject([{ target: { kind: "entity", entityId: first.entityId } }]);
    expect(
      failed.solvedSnapshot.diagnostics.some(isUncertain),
      "Never a solve diagnostic (G16).",
    ).toBe(false);
    expect(shellRecord(failed.solvedSnapshot).publication).toBe("provisional");

    // (c) A planChanged left after the re-solve fails closed (no third round).
    const again = new RecordingSolverAdapter();
    again.forgeDerive = (response, request) =>
      request.requestId.endsWith(":offset-replan")
        ? {
            ...response,
            offsetPublications: response.offsetPublications.map((item) => ({
              derivationId: item.derivationId,
              status: "planChanged" as const,
              plan: item.plan!,
            })),
          }
        : response;
    const closed = (await commitToMockKernel(definition, again)).record!;
    expect(again.solves).toHaveLength(2);
    expect(
      closed.derivedValidity.diagnostics.filter(isUncertain),
    ).toMatchObject([
      {
        message: expect.stringContaining(
          "changed again after its one re-solve",
        ),
        target: { kind: "entity", entityId: first.entityId },
      },
    ]);
    expect(shellRecord(closed.solvedSnapshot).publication).toBe("provisional");
  });

  test("row 15b (R2, [TECH] G3, review A1): the live session re-solves ONCE on planChanged; a certifier hint is consumed by that one re-solve; a forced second mismatch fails closed; an edit between the rounds re-solves once again", () => {
    const { twoSplines, first, secondId } = ss60TwoSplines();
    const committed = commitCertified(
      stagedOffset(twoSplines, [first.entityId, secondId], 0.01),
    );
    const unhinted = withLiveSolveBasis(
      { ...committed, offsetPlans: undefined },
      committed.definition,
    );
    const round1 = livePublications(unhinted);
    expect(
      round1.map((item) => item.status),
      "premise: the unhinted live solve asks for a re-solve",
    ).toEqual(["planChanged"]);

    const replanned = publishSketchLiveRegions(unhinted, [], [], round1);
    expect(replanned.liveRegions).toMatchObject({
      status: "pending",
      generation: unhinted.liveRegions.generation + 1,
    });
    expect(
      replanned.liveSolve!.solvedSnapshot.offsetFramePlans,
      "The re-solve runs the certifier's hint unchanged.",
    ).toEqual([
      { derivationId: round1[0]!.derivationId, plan: round1[0]!.plan },
    ]);
    expect(
      replanned.offsetPlans?.map((item) => item.plan.origin),
      "Later solves carry the hint as published (A1).",
    ).toEqual(["published"]);

    const round2 = livePublications(replanned);
    expect(round2.map((item) => item.status)).toEqual(["certified"]);
    const published = publishSketchLiveRegions(replanned, [], [], round2);
    expect(published.liveRegions).toMatchObject({
      status: "current",
      generation: replanned.liveRegions.generation,
    });
    expect(published.offsetPlans?.map((item) => item.plan.origin)).toEqual([
      "published",
    ]);
    expect(shellRecord(published.liveSolve!.solvedSnapshot).publication).toBe(
      "certified",
    );

    // Forced second mismatch on the re-solve round: fails closed, no third round.
    const forced = publishSketchLiveRegions(replanned, [], [], round1);
    expect(forced.liveRegions).toMatchObject({
      status: "current",
      generation: replanned.liveRegions.generation,
    });
    expect(forced.offsetPublicationDiagnostics).toMatchObject([
      {
        code: OFFSET_DIAGNOSTIC_CODES.topologyUncertain,
        target: { kind: "entity", entityId: first.entityId },
      },
    ]);
    expect(
      forced.liveSolve!.solvedSnapshot.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === OFFSET_DIAGNOSTIC_CODES.topologyUncertain,
      ),
    ).toBe(false);

    // A drag between the rounds: its solve carries the hint as published,
    // so a disagreement there re-solves once again instead of failing.
    const moved = "sketch_point_ss60_1" as SketchPointId;
    const dragged = withLiveSolveBasis(replanned, {
      ...replanned.definition,
      points: replanned.definition.points.map((point) =>
        point.pointId === moved
          ? { ...point, position: [3, 1.601] as const }
          : point,
      ),
    });
    expect(isOffsetReplanRound(dragged.liveSolve!.solvedSnapshot)).toBe(false);
    expect(livePublications(dragged).map((item) => item.status)).not.toContain(
      "failed",
    );
    const resolvedAgain = publishSketchLiveRegions(dragged, [], [], round1);
    expect(resolvedAgain.liveRegions).toMatchObject({
      status: "pending",
      generation: dragged.liveRegions.generation + 1,
    });
  });
});

// ---------------------------------------------------------------------------
// T08b-g5b (logic lane). Seams: the live derivation boundary
// (`SketchConstraintSolverAdapter.deriveSketchRegions`: publish → region
// input → regions) and the exported arrangement owner with
// `offsetArrangementInput`; the consumer seams (session display renderables,
// sketch-interaction geometry, snap geometries, measurement view model,
// vector export model, OCC render export) against the certified poles and
// `queryDomain`; and the solver's shell `pointOnCurve` residual.
// ---------------------------------------------------------------------------

const regionAdapter = new SketchConstraintSolverAdapter({
  revisionId: null,
  neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
});

/** A native closed loop: a 3-point spline closed by a line (snapped ends). */
function splineLoopSession() {
  let session = drawSpline(newSession(), [
    [0, 0],
    [1, 0.4],
    [2, 0],
  ]);
  session = drawLine(session, [2, 0], [0, 0]);
  const seeds = session.definition.entities
    .filter((entity) => entity.kind !== "point")
    .map((entity) => entity.entityId);
  return { session, seeds };
}

function committedOffsetOnSide(
  session: SketchSessionState,
  seeds: readonly SketchEntityId[],
  distance: number,
  side: "left" | "right",
) {
  let next = beginSketchTool(session, "offset");
  for (const entityId of seeds)
    next = selectSketchEditToolTarget(
      next,
      next.definition.entities.find((entity) => entity.entityId === entityId)!
        .target,
    );
  next = patchSketchEditToolValue(next, {
    intent: "setOffsetSide",
    value: side,
  });
  return commitCertified(patchSketchEditToolValue(next, { value: distance }));
}

/** The live derive effect, through the real derivation boundary. */
function liveDerive(session: SketchSessionState) {
  const live = session.liveSolve!;
  return regionAdapter.deriveSketchRegions({
    contractVersion: CONTRACT_VERSION,
    solverSchemaVersion: SOLVER_SCHEMA_VERSION,
    requestId: "request_g5b_live" as never,
    documentId: "doc_workspace" as never,
    revisionId: "rev_0001" as never,
    sketchId: "sketch_g5b" as never,
    definition: live.definition,
    solvedSnapshot: live.solvedSnapshot,
    projectedReferences: [],
    modelingTolerance: session.modelingTolerance,
  });
}

/** Derive + publish, re-solving once on `planChanged` as the editor loop does. */
async function liveRound(session: SketchSessionState) {
  let next = session;
  for (let round = 0; round < 2; round += 1) {
    const response = await liveDerive(next);
    next = publishSketchLiveRegions(
      next,
      response.regions,
      response.diagnostics,
      response.offsetPublications,
    );
    if (next.liveRegions.status === "current")
      return { session: next, response };
  }
  throw new Error("the live round did not settle after one re-solve");
}

function shellIdOf(session: SketchSessionState) {
  return session.definition.entities.find(
    (entity) => entity.kind === "derivedPiecewiseCubic",
  )!.entityId;
}

const sameBits = (left: number, right: number) => Object.is(left, right);

/**
 * Spec-only oracle: the drawn tessellation of solved shell spans, computed
 * from the record's poles and `queryDomain` alone (local domain ends exact
 * at untrimmed ends), `samples` steps per span, the shared knot once.
 */
function drawnOracle(
  spans: ReturnType<typeof shellRecord>["spans"],
  samples: number,
) {
  return spans.flatMap((span, index) => {
    const [low, high] = span.sourceDomain;
    const local = (value: number, end: number, exact: number) =>
      value === end ? exact : (value - low) / (high - low);
    const from = local(span.queryDomain[0], low, 0);
    const to = local(span.queryDomain[1], high, 1);
    return Array.from({ length: samples + (index === 0 ? 1 : 0) }, (_, k) => {
      const step = k + (index === 0 ? 0 : 1);
      return evaluateSplineSpan(
        {
          interval: span.sourceDomain,
          poles: span.poles,
          differential: {
            interval: [0, 0],
            poles: [
              [0, 0],
              [0, 0],
              [0, 0],
              [0, 0],
            ],
          },
        },
        {
          kind: "local",
          value: step === samples ? to : from + ((to - from) * step) / samples,
        },
      ).position;
    });
  });
}

function sketchRecordOf(session: SketchSessionState) {
  const live = session.liveSolve!;
  return {
    sketchId: "sketch_g5b",
    label: "Sketch g5b",
    plane: session.plane,
    ownerFeatureId: null,
    sketch: {
      definition: live.definition,
      solvedSnapshot: live.solvedSnapshot,
      regions: session.liveRegions.regions,
      projectedReferences: [],
      derivedValidity: getSketchSessionDerivedValidity(session),
    },
  } as never;
}

const xy = (point: readonly number[]) => [point[0]!, point[1]!];

/** Oracle curves of one region loop, read back from the solved snapshot (spec-only). */
function loopOracleCurves(
  loop: RegionRecord["loops"][number],
  snapshot: SolvedSketchSnapshot,
): OracleCurve[] {
  const solved = new Map(
    snapshot.solvedEntities.map((entity) => [entity.entityId, entity]),
  );
  return loop.segments.map((segment): OracleCurve => {
    const [lo, hi] = segment.sourceParameterInterval;
    const [from, to] =
      segment.traversalDirection === "forward" ? [lo, hi] : [hi, lo];
    const source = segment.branch.source;
    if (source.kind !== "entity") throw new Error("a projected segment");
    const geometry = solved.get(source.entityId)!;
    if (geometry.kind === "derivedPiecewiseCubic") {
      const span = geometry.spans.find(
        (candidate) =>
          candidate.outputSpanId === segment.branch.spanId &&
          candidate.sourceDomain[0] <= lo &&
          hi <= candidate.sourceDomain[1],
      )!;
      return cubicOracle(span.poles, span.sourceDomain, from, to);
    }
    if (geometry.kind === "lineSegment")
      return {
        ...lineOracle(geometry.startPosition, geometry.endPosition),
        from,
        to,
      };
    if (geometry.kind === "arc") {
      const [cx, cy] = geometry.centerPosition;
      const radius = Math.hypot(
        geometry.startPosition[0] - cx,
        geometry.startPosition[1] - cy,
      );
      return {
        point: (t) => [cx + radius * Math.cos(t), cy + radius * Math.sin(t)],
        derivative: (t) => [-radius * Math.sin(t), radius * Math.cos(t)],
        from,
        to,
      };
    }
    if (geometry.kind === "spline") {
      const span = geometry.reconstruction.spans.find(
        (candidate) =>
          `${candidate.source.startOccurrenceId}>${candidate.source.endOccurrenceId}` ===
          segment.branch.spanId,
      )!;
      return cubicOracle(span.poles, span.interval, from, to);
    }
    throw new Error(`no oracle for ${geometry.kind}`);
  });
}

/**
 * The inward offset of a native spline-and-line loop publishes the drawn
 * picture ([TECH] G14′): an annulus whose outer loop is the source loop and
 * whose hole is the offset loop, plus the inner disk, with no diagnostic.
 * Areas against independent oracles (the source spline's spans and line;
 * the shell's spans clipped to `queryDomain` and the line output), and every
 * shell segment inside its sub-span's `queryDomain`, ending bitwise at the
 * trims (the drawn geometry, no tail).
 */
function expectInwardLoopRegions(
  session: SketchSessionState,
  response: DeriveSketchRegionsResponse,
  label: string,
) {
  const snapshot = session.liveSolve!.solvedSnapshot;
  const definition = session.liveSolve!.definition;
  const relationship = definition.derivedRelationships![0]!;
  if (relationship.kind !== "offset") throw new Error("offset");
  expect(relationship.jointOutputs, `${label}: premise, no joint arc`).toEqual(
    [],
  );
  expect(response.diagnostics, `${label}: no diagnostic`).toEqual([]);
  const annulus = response.regions.filter(
    (region) => region.loops.length === 2,
  );
  const disks = response.regions.filter((region) => region.loops.length === 1);
  expect(
    [annulus.length, disks.length],
    `${label}: an annulus and a disk`,
  ).toEqual([1, 1]);
  const shell = shellRecord(snapshot);
  const sourceSpline = snapshot.solvedEntities.find(
    (entity) => entity.kind === "spline",
  )!;
  if (sourceSpline.kind !== "spline") throw new Error("spline");
  const sourceLine = snapshot.solvedEntities.find(
    (entity) =>
      entity.kind === "lineSegment" &&
      !relationship.outputs.some(
        (output) => output.outputEntityId === entity.entityId,
      ),
  )!;
  if (sourceLine.kind !== "lineSegment") throw new Error("line");
  const sourceArea = Math.abs(
    closedCurvesSignedArea([
      ...sourceSpline.reconstruction.spans.map((span) =>
        cubicOracle(span.poles, span.interval, ...span.interval),
      ),
      lineOracle(sourceLine.startPosition, sourceLine.endPosition),
    ]),
  );
  const drawn = shell.spans.map((span) =>
    cubicOracle(span.poles, span.sourceDomain, ...span.queryDomain),
  );
  const drawnEnd = drawn.at(-1)!.point(drawn.at(-1)!.to);
  const outputs = relationship.outputs.map((output) => {
    const line = snapshot.solvedEntities.find(
      (entity) => entity.entityId === output.outputEntityId,
    )!;
    if (line.kind !== "lineSegment") throw new Error("line output");
    return line;
  });
  expect(outputs, `${label}: premise, one line output`).toHaveLength(1);
  const [a, b] = [outputs[0]!.startPosition, outputs[0]!.endPosition];
  const near = (p: readonly number[], q: readonly number[]) =>
    Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!);
  const closing =
    near(a, drawnEnd) < near(b, drawnEnd) ? lineOracle(a, b) : lineOracle(b, a);
  const publishedArea = Math.abs(closedCurvesSignedArea([...drawn, closing]));
  const area = (loop: RegionRecord["loops"][number]) =>
    closedCurvesSignedArea(loopOracleCurves(loop, snapshot));
  const close = (actual: number, oracle: number, what: string) =>
    expect(
      Math.abs(actual - oracle),
      `${label}: ${what} ${actual} = oracle ${oracle}`,
    ).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(oracle)));
  const outer = annulus[0]!.loops.find((loop) => loop.role === "outer")!;
  const hole = annulus[0]!.loops.find((loop) => loop.role === "inner")!;
  close(Math.abs(area(outer)), sourceArea, "annulus outer = source loop");
  close(Math.abs(area(hole)), publishedArea, "annulus hole = offset loop");
  close(
    Math.abs(area(disks[0]!.loops[0]!)),
    publishedArea,
    "disk = offset loop",
  );
  const entityIds = (loop: RegionRecord["loops"][number]) =>
    new Set(
      loop.segments.map((segment) =>
        segment.branch.source.kind === "entity"
          ? segment.branch.source.entityId
          : "projected",
      ),
    );
  expect(
    entityIds(outer),
    `${label}: the outer loop is the source loop`,
  ).toEqual(new Set([sourceSpline.entityId, sourceLine.entityId]));
  expect(entityIds(hole), `${label}: the hole is the offset loop`).toEqual(
    new Set([shell.entityId, outputs[0]!.entityId]),
  );
  for (const region of response.regions)
    for (const loop of region.loops) {
      const segments = loop.segments.filter(
        (segment) =>
          segment.branch.source.kind === "entity" &&
          segment.branch.source.entityId === shell.entityId,
      );
      for (const segment of segments) {
        const [lo, hi] = segment.sourceParameterInterval;
        expect(
          shell.spans.some(
            (span) =>
              span.outputSpanId === segment.branch.spanId &&
              span.queryDomain[0] <= lo &&
              hi <= span.queryDomain[1],
          ),
          `${label}: shell segment [${lo}, ${hi}] lies in the published domain`,
        ).toBe(true);
      }
      if (segments.length === 0) continue;
      const ends = segments.flatMap(
        (segment) => segment.sourceParameterInterval,
      );
      expect(
        ends.some((end) => sameBits(end, shell.spans[0]!.queryDomain[0])) &&
          ends.some((end) => sameBits(end, shell.spans.at(-1)!.queryDomain[1])),
        `${label}: the shell's loop ends bitwise at both trims`,
      ).toBe(true);
    }
}

describe("T08b-g5b consumers and region wiring", () => {
  test("g5b-1: an offset loop's regions close through the live derivation and keep their ids across the owner's partition refinement", async () => {
    const { session, seeds } = splineLoopSession();
    const committed = committedOffsetOnSide(session, seeds, 0.01, "left");
    const shellId = shellIdOf(committed);
    let { session: live, response } = await liveRound(committed);
    expect(response.offsetPublications.map((item) => item.status)).toEqual([
      "certified",
    ]);
    expect(
      shellRecord(live.liveSolve!.solvedSnapshot).publication,
      "The live round certifies the shell (G7).",
    ).toBe("certified");
    expect(
      response.diagnostics,
      "The outward loop derives with no diagnostic.",
    ).toEqual([]);
    const bounded = response.regions.filter((region) =>
      region.loops.some((loop) =>
        loop.segments.some(
          (segment) =>
            segment.branch.source.kind === "entity" &&
            segment.branch.source.entityId === shellId,
        ),
      ),
    );
    expect(
      bounded.map((region) => [region.isClosed, region.loops.length]),
      "The offset loop bounds one closed annulus whose hole is the source loop.",
    ).toEqual([[true, 2]]);
    const outputSpanIds = new Set(
      shellRecord(live.liveSolve!.solvedSnapshot).spans.map(
        (span) => span.outputSpanId,
      ),
    );
    for (const segment of bounded[0]!.loops.flatMap((loop) => loop.segments))
      if (
        segment.branch.source.kind === "entity" &&
        segment.branch.source.entityId === shellId
      )
        expect(
          outputSpanIds.has(segment.branch.spanId),
          "A shell segment's branch is (shell, outputSpanId) (region identity).",
        ).toBe(true);
    const ids = response.regions.map((region) => region.regionId).sort();
    expect(ids, "The annulus and the source region.").toHaveLength(2);

    const spline = live.definition.entities.find(
      (entity) => entity.kind === "spline",
    )!;
    if (spline.kind !== "spline") throw new Error("spline");
    const middle = spline.pointOccurrences[1]!.pointId;
    const partitions = new Set<number>();
    for (const height of [0.5, 0.6, 0.7, 0.85]) {
      const definition = {
        ...live.definition,
        points: live.definition.points.map((point) =>
          point.pointId === middle
            ? { ...point, position: [1, height] as const }
            : point,
        ),
      };
      ({ session: live, response } = await liveRound(
        withLiveSolveBasis({ ...live, definition }, definition),
      ));
      partitions.add(shellRecord(live.liveSolve!.solvedSnapshot).spans.length);
      expect(
        response.regions.map((region) => region.regionId).sort(),
        `height ${height}: region ids survive the refinement`,
      ).toEqual(ids);
    }
    expect(
      partitions.size,
      "premise: the drag changes the owner partition",
    ).toBeGreaterThan(1);
  }, 300_000);

  test("T10e review R-2: a published shell-bounded region fills against the round's own pair (publications applied)", async () => {
    const { session, seeds } = splineLoopSession();
    const committed = committedOffsetOnSide(session, seeds, 0.01, "left");
    const { session: live, response } = await liveRound(committed);
    expect(response.offsetPublications.map((item) => item.status)).toEqual([
      "certified",
    ]);
    expect(
      getSketchSessionDerivedValidity(live).diagnostics.filter(
        (diagnostic) => diagnostic.code === "profile-boundary-unresolved",
      ),
      "Every published region resolves against the stored basis.",
    ).toEqual([]);
    const fills = getSketchSessionDisplayRenderables(live).filter(
      (renderable) => renderable.semanticClass === "region",
    );
    expect(fills, "The annulus and the source region both fill.").toHaveLength(
      response.regions.length,
    );
    const annulus = response.regions.find(
      (region) => region.loops.length === 2,
    )!;
    const fill = fills.find((renderable) =>
      renderable.id.startsWith(`renderable_sketch_region_${annulus.regionId}_`),
    )!;
    if (fill.geometry.kind !== "mesh") throw new Error("fill is not a mesh");
    // The source loop's chord lies on y = 0; the outward shell runs 0.01 below.
    const lowest = Math.min(
      ...fill.geometry.vertexPositions.map((point) => point[1]),
    );
    expect(lowest).toBeLessThan(-0.009);
    expect(lowest).toBeGreaterThan(-0.011);
  }, 300_000);

  test("g5b-1b ([TECH] G14′, D2 re-pin): an inward offset of the loop certifies, and its trimmed-off tails' crossings of the source line are not events: an annulus (outer = source, hole = offset) plus the inner disk, areas by oracle, ids stable across the drag", async () => {
    const { session, seeds } = splineLoopSession();
    const committed = committedOffsetOnSide(session, seeds, 0.01, "right");
    let { session: live, response } = await liveRound(committed);
    expect(response.offsetPublications.map((item) => item.status)).toEqual([
      "certified",
    ]);
    expectInwardLoopRegions(live, response, "g5b-1b");
    const ids = response.regions.map((region) => region.regionId).sort();
    const spline = live.definition.entities.find(
      (entity) => entity.kind === "spline",
    )!;
    if (spline.kind !== "spline") throw new Error("spline");
    const middle = spline.pointOccurrences[1]!.pointId;
    for (const height of [0.5, 0.6, 0.7, 0.85]) {
      const definition = {
        ...live.definition,
        points: live.definition.points.map((point) =>
          point.pointId === middle
            ? { ...point, position: [1, height] as const }
            : point,
        ),
      };
      ({ session: live, response } = await liveRound(
        withLiveSolveBasis({ ...live, definition }, definition),
      ));
      expectInwardLoopRegions(live, response, `g5b-1b height ${height}`);
      expect(
        response.regions.map((region) => region.regionId).sort(),
        `height ${height}: region ids survive the drag`,
      ).toEqual(ids);
    }
  }, 600_000);

  test("T08b-g5d (U-G6): the g5b-1b loop at inward d = 0.1 (deep trims on inner leaves of the terminal source span) commits, publishes certified and derives the annulus + disk with oracle areas; the shell record omits the removed sub-spans", async () => {
    const { session, seeds } = splineLoopSession();
    const committed = committedOffsetOnSide(session, seeds, 0.1, "right");
    expect(
      committed.definition.entities.some(
        (entity) => entity.kind === "derivedPiecewiseCubic",
      ),
      "Commit created the shell (formerly: no converged transverse trim)",
    ).toBe(true);
    const { session: live, response } = await liveRound(committed);
    expect(response.offsetPublications.map((item) => item.status)).toEqual([
      "certified",
    ]);
    const shell = shellRecord(live.liveSolve!.solvedSnapshot);
    expect(shell.publication).toBe("certified");
    // The owner partition has 8 leaves; the two removed vertex leaves are
    // not in the record, whose first and last sub-spans are trimmed inside.
    expect(shell.spans).toHaveLength(6);
    for (const [span, end] of [
      [shell.spans[0]!, 0],
      [shell.spans.at(-1)!, 1],
    ] as const) {
      const [s0, s1] = span.sourceDomain;
      expect(span.queryDomain[end]).toBeGreaterThan(s0);
      expect(span.queryDomain[end]).toBeLessThan(s1);
    }
    expectInwardLoopRegions(live, response, "g5d d = 0.1");
  }, 300_000);

  test("g5b-2: a provisional shell is never region input (G7); it is excluded with a targeted unpublished diagnostic (G19)", async () => {
    const { session, seeds } = splineLoopSession();
    const committed = committedOffsetOnSide(session, seeds, 0.01, "left");
    const shellId = shellIdOf(committed);
    const live = committed.liveSolve!;
    expect(shellRecord(live.solvedSnapshot).publication).toBe("provisional");
    const derivationId = live.definition.derivedRelationships![0]!.derivationId;
    const deriver = createSketchArrangementDeriver(
      createCertifiedNeutralCurveQueryCapabilityForTest(),
    );
    for (const [label, publications] of [
      [
        "certified relationship, provisional record",
        [{ derivationId, status: "certified" }],
      ],
      ["pending re-solve", [{ derivationId, status: "planChanged" }]],
      ["unpublished (no publication)", []],
    ] as const) {
      const input = offsetArrangementInput(
        live.definition,
        live.solvedSnapshot,
        publications as readonly SketchOffsetPublicationRecord[],
      );
      expect(
        input.derivedCurves,
        `${label}: only a certified record of a certified relationship is a derived curve`,
      ).toEqual([]);
      const result = await deriver.derive({
        documentId: "doc_workspace" as never,
        revisionId: "rev_0001" as never,
        sketchId: "sketch_g5b" as never,
        definition: live.definition,
        solvedSnapshot: live.solvedSnapshot,
        projectedReferences: [],
        modelingTolerance: 1e-3,
        ...input,
      });
      expect(
        result.regions.some((region) =>
          region.loops.some((loop) =>
            loop.segments.some(
              (segment) =>
                segment.branch.source.kind === "entity" &&
                segment.branch.source.entityId === shellId,
            ),
          ),
        ),
        `${label}: no region is bounded by the provisional shell`,
      ).toBe(false);
      expect(
        result.diagnostics.some(
          (diagnostic) =>
            diagnostic.code === "region-derived-unpublished" &&
            diagnostic.target?.kind === "entity" &&
            diagnostic.target.entityId === shellId,
        ),
        `${label}: the shell is excluded with a targeted unpublished diagnostic`,
      ).toBe(true);
    }
    const certified = applyOffsetPublications(
      live.definition,
      live.solvedSnapshot,
      [{ derivationId, status: "certified" }],
    );
    expect(
      offsetArrangementInput(live.definition, certified, [
        { derivationId, status: "certified" },
      ]).derivedCurves?.map((curve) => curve.outputEntityId),
      "Control: the certified record of a certified relationship is the one derived curve.",
    ).toEqual([shellId]);
  }, 300_000);

  test("g5b-3: line/arc outputs of a failed or pending relationship never bound regions (G5, g5a review A2); a certified one does", async () => {
    let session = acceptSketchDraw(
      startSketchDraw(beginSketchTool(newSession(), "rectangle"), [0, 0]),
      [4, 2],
    );
    const seeds = session.definition.entities
      .filter((entity) => entity.kind === "lineSegment")
      .map((entity) => entity.entityId);
    session = committedOffsetOnSide(session, seeds, 0.5, "left");
    const live = session.liveSolve!;
    const relationship = live.definition.derivedRelationships![0]!;
    if (relationship.kind !== "offset") throw new Error("offset");
    const outputIds = new Set([
      ...relationship.outputs.map((output) => output.outputEntityId),
      ...relationship.jointOutputs.map((output) => output.outputEntityId),
    ]);
    const usesOutputs = (
      regions: readonly {
        loops: readonly {
          segments: readonly {
            branch: { source: { kind: string; entityId?: unknown } };
          }[];
        }[];
      }[],
    ) =>
      regions.some((region) =>
        region.loops.some((loop) =>
          loop.segments.some(
            (segment) =>
              segment.branch.source.kind === "entity" &&
              outputIds.has(segment.branch.source.entityId as SketchEntityId),
          ),
        ),
      );
    const certified = await liveDerive(session);
    expect(certified.offsetPublications.map((item) => item.status)).toEqual([
      "certified",
    ]);
    expect(
      usesOutputs(certified.regions),
      "Control: a certified relationship's outputs bound the offset region.",
    ).toBe(true);
    const deriver = createSketchArrangementDeriver(
      createCertifiedNeutralCurveQueryCapabilityForTest(),
    );
    for (const status of ["failed", "planChanged"] as const) {
      const result = await deriver.derive({
        documentId: "doc_workspace" as never,
        revisionId: "rev_0001" as never,
        sketchId: "sketch_g5b" as never,
        definition: live.definition,
        solvedSnapshot: live.solvedSnapshot,
        projectedReferences: [],
        modelingTolerance: 1e-3,
        ...offsetArrangementInput(live.definition, live.solvedSnapshot, [
          { derivationId: relationship.derivationId, status },
        ]),
      });
      expect(
        usesOutputs(result.regions),
        `${status}: no region is bounded by the relationship's line/arc outputs`,
      ).toBe(false);
      const targeted = new Set(
        result.diagnostics.flatMap((diagnostic) =>
          diagnostic.code === "region-derived-unpublished" &&
          diagnostic.target?.kind === "entity" &&
          diagnostic.message.includes(relationship.derivationId)
            ? [diagnostic.target.entityId]
            : [],
        ),
      );
      expect(
        [...outputIds].every((entityId) => targeted.has(entityId)),
        `${status}: every output (lines and joint arcs) has its targeted diagnostic`,
      ).toBe(true);
    }
  }, 300_000);

  test("g5b-5: shell display state — provisional while pending or dragged is stale (normal colour, U-A); settled uncertified is invalid; certified is current; no handles", async () => {
    const { session, seeds } = splineLoopSession();
    const committed = committedOffsetOnSide(session, seeds, 0.01, "left");
    const shellId = shellIdOf(committed);
    const shellRenderable = (state: SketchSessionState) =>
      getStableSketchSessionDisplayRenderables(state).find(
        (item) => item.id === `renderable_sketch_shell_${shellId}`,
      );
    expect(committed.liveRegions.status, "premise: the round is pending").toBe(
      "pending",
    );
    expect(
      shellRenderable(committed)?.regionValidity,
      "A provisional shell whose publication is pending is stale (normal colour).",
    ).toBe("stale");
    const derivationId =
      committed.definition.derivedRelationships![0]!.derivationId;
    const failed = publishSketchLiveRegions(
      committed,
      [],
      [],
      [
        {
          derivationId,
          status: "failed",
          diagnostic: {
            code: OFFSET_DIAGNOSTIC_CODES.topologyUncertain,
            severity: "error",
            message: "forged failure",
            target: null,
          },
        },
      ],
    );
    expect(
      shellRenderable(failed)?.regionValidity,
      "A shell whose round settled without certifying it is invalid (the existing red tint).",
    ).toBe("invalid");
    const { session: live } = await liveRound(committed);
    expect(
      shellRenderable(live)?.regionValidity,
      "A certified shell is current.",
    ).toBe("current");
    const dragging = { ...failed, activeDrag: {} as never };
    expect(
      getDerivedShellDisplayValidity(dragging, "provisional"),
      "During a drag a provisional shell is stale (U-A: normal colour).",
    ).toBe("stale");
    expect(
      getStableSketchSessionDisplayRenderables(live).some(
        (item) =>
          item.target?.kind === "sketchPoint" && item.id.includes(shellId),
      ),
      "A shell has no handle renderables of its own.",
    ).toBe(false);
  }, 300_000);

  test("g5b-6: a shell's annotation anchor lies on the drawn curve (middle of its queryDomain range); without its solved record, the start terminal point", async () => {
    const { session, seeds } = splineLoopSession();
    const committed = committedOffsetOnSide(session, seeds, 0.01, "right");
    const shellId = shellIdOf(committed);
    const live = committed.liveSolve!;
    const record = shellRecord(live.solvedSnapshot);
    const anchor = getEntityAnchor(
      live.definition,
      shellId,
      live.solvedSnapshot,
    )!;
    const from = record.spans[0]!.queryDomain[0];
    const to = record.spans.at(-1)!.queryDomain[1];
    const middle = (from + to) / 2;
    const span = record.spans.find(
      (candidate) =>
        candidate.queryDomain[0] <= middle &&
        middle <= candidate.queryDomain[1],
    )!;
    const expected = evaluateSplineSpan(
      {
        interval: span.sourceDomain,
        poles: span.poles,
        differential: {
          interval: [0, 0],
          poles: [
            [0, 0],
            [0, 0],
            [0, 0],
            [0, 0],
          ],
        },
      },
      { kind: "source", value: middle },
    ).position;
    expect(
      Math.hypot(anchor[0] - expected[0], anchor[1] - expected[1]),
      "The anchor is the curve point at the middle of the drawn parameter range.",
    ).toBeLessThan(1e-12);
    const relationship = live.definition.derivedRelationships![0]!;
    if (relationship.kind !== "offset") throw new Error("offset");
    const start = live.definition.points.find(
      (point) =>
        point.pointId === relationship.piecewiseCubicOutputs[0]!.startPointId,
    )!.position;
    expect(
      getEntityAnchor(live.definition, shellId),
      "Without the solved snapshot the anchor is the start terminal point.",
    ).toEqual(start);
  }, 300_000);

  test("g5b-4: display, pick, snap, measure, vector export and the OCC snapshot read the same certified spans clipped to queryDomain; the shell pointOnCurve binds only inside the drawn domain", async () => {
    const { session, seeds } = splineLoopSession();
    const committed = committedOffsetOnSide(session, seeds, 0.01, "right");
    const shellId = shellIdOf(committed);
    const { session: live } = await liveRound(committed);
    const record = shellRecord(live.liveSolve!.solvedSnapshot);
    expect(record.publication).toBe("certified");
    const trimmed = record.spans.filter(
      (span) =>
        !sameBits(span.queryDomain[0], span.sourceDomain[0]) ||
        !sameBits(span.queryDomain[1], span.sourceDomain[1]),
    );
    expect(
      trimmed.length,
      "premise: the inward shell is trimmed at both ends",
    ).toBe(2);
    const expected16 = drawnOracle(record.spans, 16);

    // Display (session renderables).
    const renderable = getStableSketchSessionDisplayRenderables(live).find(
      (item) => item.id === `renderable_sketch_shell_${shellId}`,
    );
    expect(renderable?.target).toMatchObject({ entityId: shellId });
    expect(renderable?.regionValidity, "A certified shell is current.").toBe(
      "current",
    );
    expect(
      renderable?.geometry.kind === "polyline" &&
        renderable.geometry.points.map(xy),
      "Display draws the certified spans clipped to queryDomain.",
    ).toEqual(expected16);

    // Pick.
    const pick = collectSketchInteractionGeometry(live).find(
      (geometry) => geometry.id === `sketch-entity:${shellId}`,
    );
    // T10f: pick and snap carry the record's spans (drawn domains kept);
    // drawn with the oracle they are exactly the displayed polyline.
    const drawnSpans = record.spans.map((span) => ({
      interval: span.sourceDomain,
      poles: span.poles,
      queryDomain: span.queryDomain,
    }));
    expect(
      pick?.kind === "cubicSpans" && pick.spans,
      "Pick uses exactly the displayed spans.",
    ).toEqual(drawnSpans);
    expect(
      pick?.kind === "cubicSpans" &&
        drawnOracle(
          pick.spans.map((span, index) => ({
            ...record.spans[index]!,
            sourceDomain: span.interval,
            poles: span.poles,
            queryDomain: span.queryDomain!,
          })),
          16,
        ),
      "Pick's spans draw exactly the displayed polyline.",
    ).toEqual(expected16);

    // Snap.
    const snap = collectSketchSnapGeometries({
      definition: live.definition,
      solvedSnapshot: live.liveSolve!.solvedSnapshot,
    }).find(
      (geometry) =>
        geometry.source.kind === "localEntity" &&
        geometry.source.entityId === shellId,
    );
    expect(
      snap?.kind === "spline" && snap.spans,
      "Snap uses exactly the displayed spans.",
    ).toEqual(drawnSpans);

    // Measure (a committed sketch record).
    const measured = deriveMeasurementViewModel({
      activeToolId: "measure",
      selection: [
        {
          kind: "sketchEntity",
          sketchId: "sketch_g5b",
          entityId: shellId,
        } as never,
      ],
      snapshot: { document: { sketches: [sketchRecordOf(live)] } } as never,
    });
    const witness = measured?.witnesses[0];
    expect(
      witness?.kind === "polyline" && witness.points.map(xy),
      "Measure samples the same clipped spans (48 steps per span).",
    ).toEqual(drawnOracle(record.spans, 48));

    // Vector export: SVG cubics clipped to queryDomain.
    const exported = buildSketchVectorExportModel({
      documentId: "doc_workspace" as never,
      revisionId: "rev_0001" as never,
      sketches: [sketchRecordOf(live)],
      target: { kind: "sketch", sketchId: "sketch_g5b" } as never,
    });
    if ("diagnostic" in exported) throw new Error(exported.diagnostic.message);
    const entity = exported.entities.find(
      (candidate) => candidate.entityId === shellId,
    );
    if (entity?.kind !== "spline") throw new Error("exported shell");
    expect(entity.spans).toHaveLength(record.spans.length);
    const bezier = (poles: readonly (readonly number[])[], s: number) =>
      [0, 1].map(
        (axis) =>
          (1 - s) ** 3 * poles[0]![axis]! +
          3 * s * (1 - s) ** 2 * poles[1]![axis]! +
          3 * s * s * (1 - s) * poles[2]![axis]! +
          s ** 3 * poles[3]![axis]!,
      );
    record.spans.forEach((span, index) => {
      const poles = entity.spans[index]!;
      const ends = drawnOracle([span], 1);
      expect(
        [xy(poles[0]), xy(poles[3])],
        `span ${index}: the exported cubic ends are the drawn ends`,
      ).toEqual(ends);
      if (!trimmed.includes(span)) {
        expect(
          poles,
          `span ${index}: an untrimmed span exports its own poles`,
        ).toEqual(span.poles);
        return;
      }
      const drawn = drawnOracle([span], 8);
      drawn.forEach((point, k) => {
        const at = bezier(poles, k / 8);
        expect(
          Math.hypot(at[0]! - point[0]!, at[1]! - point[1]!),
          `span ${index}: the clipped cubic is the drawn sub-curve (s = ${k}/8)`,
        ).toBeLessThan(1e-12);
      });
    });

    // OCC snapshot (committed render export).
    const occ = buildOccRenderExport(
      { constructions: [], bodies: [], sketches: [] } as never,
      new Map(),
      {},
      [sketchRecordOf(live)],
    ).records.find(
      (item) =>
        item.binding.target.kind === "sketchEntity" &&
        item.binding.target.entityId === shellId,
    );
    expect(
      occ?.geometry.kind === "polyline" && occ.geometry.points.map(xy),
      "The OCC snapshot draws the same clipped spans.",
    ).toEqual(expected16);

    // Routed check: the shell pointOnCurve binds only inside the drawn
    // domain. A point just past the start tail's undrawn end binds to the
    // displayed start (the trim), not to the closer tail.
    const first = record.spans[0]!;
    expect(trimmed).toContain(first);
    const tailEnd = first.poles[0];
    const drawnStart = expected16[0]!;
    const pointPosition = [
      tailEnd[0] + (tailEnd[0] - drawnStart[0]!) * 0.5,
      tailEnd[1] + (tailEnd[1] - drawnStart[1]!) * 0.5,
    ] as const;
    const pointId = "sketch_point_g5b_probe" as SketchPointId;
    const definition = live.liveSolve!.definition;
    const probe: SketchDefinition = {
      ...definition,
      pointIds: [...definition.pointIds, pointId],
      points: [
        ...definition.points,
        {
          ...definition.points[0]!,
          pointId,
          label: "probe",
          target: { ...definition.points[0]!.target, pointId },
          position: pointPosition,
        },
      ],
      constraintIds: [...definition.constraintIds, "constraint_g5b_probe"],
      constraints: [
        ...definition.constraints,
        {
          constraintId: "constraint_g5b_probe",
          kind: "pointOnCurve",
          label: "probe",
          point: { kind: "localPoint", pointId },
          curve: { kind: "localEntity", entityId: shellId },
        } as SketchDefinition["constraints"][number],
      ],
    };
    const tolerances = {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    };
    const values = getSketchSolveInitialValuesForTest(probe, tolerances, 1e-3);
    const evaluated = evaluateSketchScalarConstraintForTest({
      definition: probe,
      constraintId: "constraint_g5b_probe",
      values,
      tolerances,
      modelingTolerance: 1e-3,
    });
    const at = [...values.keys()].find(
      (index) =>
        sameBits(values[index]!, pointPosition[0]) &&
        sameBits(values[index + 1]!, pointPosition[1]),
    )!;
    const bound = [
      pointPosition[0] - evaluated.gradient[at]!,
      pointPosition[1] - evaluated.gradient[at + 1]!,
    ];
    expect(
      Math.hypot(bound[0]! - drawnStart[0]!, bound[1]! - drawnStart[1]!),
      "The residual binds the probe to the displayed trimmed start.",
    ).toBeLessThan(1e-12);
    expect(
      Math.hypot(pointPosition[0] - tailEnd[0], pointPosition[1] - tailEnd[1]),
      "premise: the undrawn tail is closer to the probe than the drawn domain",
    ).toBeLessThan(
      Math.hypot(pointPosition[0] - bound[0]!, pointPosition[1] - bound[1]!),
    );
  }, 300_000);

  test("g5b-7 → T10c (A1/A2, review R1): on native OCC (stock and production assets) the outward shell annulus (joint arcs) and the inward annulus (shell sub-spans across knots) build exact faces whose areas and prism volumes equal the oracle; each shell edge is its selected sub-span's untrimmed poles over the record interval", async () => {
    for (const [side, distance] of [
      ["left", 0.01],
      ["right", 0.1],
    ] as const) {
      const label = `${side === "left" ? "outward" : "inward"} d = ${distance}`;
      const { session, seeds } = splineLoopSession();
      const committed = committedOffsetOnSide(session, seeds, distance, side);
      const shellId = shellIdOf(committed);
      const { session: live, response } = await liveRound(committed);
      const solved = live.liveSolve!;
      const relationship = solved.definition.derivedRelationships![0]!;
      if (relationship.kind !== "offset") throw new Error("offset");
      const shell = shellRecord(solved.solvedSnapshot);
      if (side === "left")
        expect(
          relationship.jointOutputs.length,
          `${label}: premise, the outward loop carries joint arcs`,
        ).toBeGreaterThan(0);
      else
        expect(
          shell.spans.length,
          `${label}: premise, an output span is split into sub-spans (knots inside it)`,
        ).toBeGreaterThan(new Set(shell.spans.map((span) => span.outputSpanId)).size);
      const sketch: SketchRecord = {
        ownerDocumentId: "doc_workspace" as never,
        ownerRevisionId: "rev_0001" as never,
        ownerFeatureId: null,
        ownerSketchId: "sketch_g5b" as never,
        ownerBodyId: null,
        sketchId: "sketch_g5b" as never,
        label: "Sketch g5b",
        planeSupport: XY as never,
        definition: solved.definition,
        solvedSnapshot: solved.solvedSnapshot,
        derivedValidity: { state: "current", diagnostics: [] },
        projectedReferences: [],
        regions: response.regions,
      };
      const snapshot = {
        ...sketch,
        plane: live.plane,
        sketch,
      } as unknown as OccFeatureExecutionContext["sketches"][number];
      const usesShell = (region: RegionRecord) =>
        region.loops.some((loop) =>
          loop.segments.some(
            (segment) =>
              segment.branch.source.kind === "entity" &&
              segment.branch.source.entityId === shellId,
          ),
        );
      expect(
        response.regions.filter(usesShell).length,
        `${label}: premise, the shell bounds regions`,
      ).toBeGreaterThan(0);
      if (side === "left")
        expect(
          response.regions.some(
            (region) =>
              usesShell(region) &&
              region.loops.some((loop) =>
                loop.segments.some((segment) =>
                  relationship.jointOutputs.some(
                    (joint) =>
                      segment.branch.source.kind === "entity" &&
                      segment.branch.source.entityId === joint.outputEntityId,
                  ),
                ),
              ),
          ),
          `${label}: premise, the annulus boundary runs through a joint arc`,
        ).toBe(true);

      // Sub-span selection (A2): every shell segment resolves to the one
      // sub-span of its output span whose source domain holds its interval,
      // untrimmed poles (the record's own objects), u by the documented map.
      const basis = regionBoundaryBasisOfSketchRecord(sketch);
      const crossesKnot: boolean[] = [];
      for (const region of response.regions)
        for (const loop of region.loops)
          for (const segment of loop.segments) {
            if (
              segment.branch.source.kind !== "entity" ||
              segment.branch.source.entityId !== shellId
            )
              continue;
            const [a, b] = segment.sourceParameterInterval;
            const holders = shell.spans.filter(
              (span) =>
                span.outputSpanId === segment.branch.spanId &&
                span.sourceDomain[0] <= a &&
                b <= span.sourceDomain[1],
            );
            expect(holders, `${label}: one sub-span holds [${a}, ${b}]`).toHaveLength(1);
            const [span] = holders;
            crossesKnot.push(
              shell.spans.filter(
                (candidate) => candidate.outputSpanId === segment.branch.spanId,
              ).length > 1,
            );
            const resolved = resolveRegionBoundaryCurve(basis, segment);
            if (resolved.kind !== "resolved" || resolved.curve.kind !== "cubicBezier")
              throw new Error(`${label}: the shell segment resolves to a cubic`);
            expect(
              resolved.curve.poles,
              `${label}: the selected sub-span's untrimmed poles`,
            ).toBe(span!.poles);
            expect(resolved.curve.sourceDomain).toBe(span!.sourceDomain);
            const [s0, s1] = span!.sourceDomain;
            const local = (t: number) =>
              t === s0 ? 0 : t === s1 ? 1 : (t - s0) / (s1 - s0);
            expect(resolved.kernelInterval).toEqual([local(a), local(b)]);
          }
      if (side === "right")
        expect(
          crossesKnot.some(Boolean),
          `${label}: premise, a shell segment's output span has several sub-spans`,
        ).toBe(true);

      for (const [runtime, loadRuntime] of [
        ["production", loadProductionOcc],
        ["stock", getDefaultOpenCascadeInstance],
      ] as const) {
        const oc = await loadRuntime();
        for (const [index, region] of response.regions.entries()) {
          const name = `${label} ${runtime} region ${index} (${region.loops.length} loops)`;
          const oracle = region.loops.reduce(
            (total, loop) =>
              total +
              closedCurvesSignedArea(
                loopOracleCurves(loop, solved.solvedSnapshot),
              ),
            0,
          );
          const built = buildRegionProfileFace(
            oc,
            { plane: live.plane, sketch, modelingTolerance: 1e-3 },
            region,
          );
          try {
            const analyzer = new oc.BRepCheck_Analyzer(built.face, true, false);
            try {
              expect(analyzer.IsValid_2(), `${name}: BRepCheck accepts the face`).toBe(true);
            } finally {
              analyzer.delete();
            }
            const props = new oc.GProp_GProps_1();
            try {
              oc.BRepGProp.SurfaceProperties_1(built.face, props, false, false);
              expect(
                Math.abs(props.Mass() - oracle) / oracle,
                `${name}: face area ${props.Mass()} = oracle ${oracle}`,
              ).toBeLessThanOrEqual(1e-9);
            } finally {
              props.delete();
            }
            // Each shell edge is the Bézier of its selected sub-span over the
            // mapped interval (no re-poling): OCC's own curve at its range
            // ends equals the sub-span's poles evaluated at u.
            const allSegments = region.loops.flatMap((loop) => loop.segments);
            for (const segment of allSegments) {
              if (
                segment.branch.source.kind !== "entity" ||
                segment.branch.source.entityId !== shellId
              )
                continue;
              const base = `${shellId}@${segment.branch.spanId}`;
              const shared =
                allSegments.filter(
                  (other) =>
                    other.branch.source.kind === "entity" &&
                    other.branch.source.entityId === shellId &&
                    other.branch.spanId === segment.branch.spanId,
                ).length > 1;
              const edge = built.provenance.edges.get(
                (shared ? `${base}#${segment.sourceSegmentOrdinal}` : base) as never,
              );
              expect(edge, `${name}: the shell segment's edge is keyed by span and ordinal`).toBeDefined();
              const resolved = resolveRegionBoundaryCurve(basis, segment);
              if (resolved.kind !== "resolved" || resolved.curve.kind !== "cubicBezier")
                throw new Error("cubic");
              const poles = resolved.curve.poles;
              const adaptor = new oc.BRepAdaptor_Curve_2(edge!);
              try {
                expect(
                  adaptor.GetType(),
                  `${name}: the shell edge is an exact Bézier curve`,
                ).toBe(oc.GeomAbs_CurveType.GeomAbs_BezierCurve);
                expect(
                  [adaptor.FirstParameter(), adaptor.LastParameter()],
                  `${name}: the edge range is the mapped record interval`,
                ).toEqual([...resolved.kernelInterval]);
                for (const u of resolved.kernelInterval) {
                  const value = adaptor.Value(u);
                  const v = 1 - u;
                  const expected = [0, 1].map(
                    (axis) =>
                      v * v * v * poles[0][axis]! +
                      3 * v * v * u * poles[1][axis]! +
                      3 * v * u * u * poles[2][axis]! +
                      u * u * u * poles[3][axis]!,
                  );
                  try {
                    expect(
                      Math.hypot(value.X() - expected[0]!, value.Y() - expected[1]!, value.Z()),
                      `${name}: OCC's curve value at u = ${u} is the sub-span's`,
                    ).toBeLessThanOrEqual(1e-12);
                  } finally {
                    value.delete();
                  }
                }
              } finally {
                adaptor.delete();
              }
            }
          } finally {
            releaseBuiltSketchProfileFace(built);
          }
          const extruded = executeOccFeature(
            await occFeatureContext([snapshot], [], oc),
            `feature_t10c_shell_${index}` as never,
            {
              kind: "extrude",
              featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
              parameters: {
                resultBodyType: "solid",
                profiles: [
                  { kind: "region", sketchId: "sketch_g5b", regionId: region.regionId },
                ],
                startExtent: { kind: "profilePlane" },
                extent: {
                  mode: "oneSide",
                  end: { kind: "blind", direction: "positive", distance: 2 },
                },
                operation: "newBody",
                booleanScope: { kind: "standalone" },
              },
            } as never,
          );
          const volume = new oc.GProp_GProps_1();
          try {
            oc.BRepGProp.VolumeProperties_1(
              extruded.bodies[0]!.shape as never,
              volume,
              false,
              false,
              false,
            );
            expect(
              Math.abs(volume.Mass() - 2 * oracle) / (2 * oracle),
              `${name}: prism volume ${volume.Mass()} = 2 × oracle area`,
            ).toBeLessThanOrEqual(1e-9);
          } finally {
            volume.delete();
          }
        }
      }
    }
  }, 600_000);
});

// ---------------------------------------------------------------------------
// T08b-g5c: [TECH] G14′ native rows (inward loops publish the drawn picture)
// and [TECH] G19/G19a (non-accepted offset outputs, every consumer).
// ---------------------------------------------------------------------------

/** A native closed loop: a spline through `fit`, closed by a line (snapped ends). */
function loopSession(fit: readonly (readonly [number, number])[]) {
  let session = drawSpline(newSession(), fit);
  session = drawLine(session, fit.at(-1)!, fit[0]!);
  const seeds = session.definition.entities
    .filter((entity) => entity.kind !== "point")
    .map((entity) => entity.entityId);
  return { session, seeds };
}

/** Two native rectangles: the offset source (0,0)–(4,2) and an unrelated one (10,0)–(12,2). */
function rectanglesSession() {
  let session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(newSession(), "rectangle"), [0, 0]),
    [4, 2],
  );
  const seeds = session.definition.entities
    .filter((entity) => entity.kind === "lineSegment")
    .map((entity) => entity.entityId);
  session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "rectangle"), [10, 0]),
    [12, 2],
  );
  return { session, seeds };
}

function offsetOutputIds(session: SketchSessionState) {
  const relationship = session.definition.derivedRelationships![0]!;
  if (relationship.kind !== "offset") throw new Error("offset");
  return {
    derivationId: relationship.derivationId,
    outputs: [
      ...relationship.outputs.map((output) => output.outputEntityId),
      ...relationship.jointOutputs.map((output) => output.outputEntityId),
    ],
  };
}

/** The committed session with a settled `failed` publication round (forged failure). */
function failedRound(session: SketchSessionState) {
  const { derivationId } = offsetOutputIds(session);
  return publishSketchLiveRegions(
    session,
    [],
    [],
    [
      {
        derivationId,
        status: "failed",
        diagnostic: {
          code: OFFSET_DIAGNOSTIC_CODES.topologyUncertain,
          severity: "error",
          message: "forged failure",
          target: null,
        },
      },
    ],
  );
}

const usesAny = (
  regions: readonly RegionRecord[],
  entityIds: readonly SketchEntityId[],
) =>
  regions.some((region) =>
    region.loops.some((loop) =>
      loop.segments.some(
        (segment) =>
          segment.branch.source.kind === "entity" &&
          entityIds.includes(segment.branch.source.entityId),
      ),
    ),
  );

/** A minimal workspace snapshot holding one committed sketch record (projection seam). */
function projectionSnapshot(session: SketchSessionState) {
  const record = sketchRecordOf(session) as unknown as {
    sketchId: string;
    plane: SketchSessionState["plane"];
  };
  return {
    document: {
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketches: [record],
      cursor: { kind: "sketch", sketchId: record.sketchId },
      render: { records: [] },
    },
    presentation: {
      documentHistory: [
        {
          id: "history_g5c",
          label: "Sketch",
          description: "Sketch",
          kind: "sketch",
          target: { kind: "sketch", sketchId: record.sketchId },
          sketchId: record.sketchId,
          featureId: null,
        },
      ],
    },
  } as never;
}

function project(
  session: SketchSessionState,
  source:
    | { kind: "sketchEntity"; entityId: SketchEntityId }
    | { kind: "sketch" },
) {
  return projectSketchExternalReferencesFromSnapshot(
    projectionSnapshot(session),
    {
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: "request_g5c_project",
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_g5c_target",
      plane: session.plane.frame,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      references: [
        {
          referenceId: "ref_g5c",
          reference: {
            referenceId: "ref_g5c",
            kind: "sketchReference",
            label: "g5c",
            source:
              source.kind === "sketch"
                ? { kind: "sketch", sketchId: "sketch_g5b" }
                : {
                    kind: "sketchEntity",
                    sketchId: "sketch_g5b",
                    entityId: source.entityId,
                  },
            projectionMode: "projectAlongPlaneNormal",
          },
        },
      ],
    } as never,
  ).projectedReferences[0]!;
}

describe("T08b-g5c inward offsets publish the drawn picture ([TECH] G14′)", () => {
  test.each([
    [
      "h0.8 (38.7° corners)",
      [
        [0, 0],
        [1, 0.8],
        [2, 0],
      ],
      0.01,
    ],
    [
      "h0.8 (38.7° corners)",
      [
        [0, 0],
        [1, 0.8],
        [2, 0],
      ],
      0.03,
    ],
    [
      "h0.8 (38.7° corners)",
      [
        [0, 0],
        [1, 0.8],
        [2, 0],
      ],
      0.05,
    ],
    [
      "h1.6 (58.0° corners)",
      [
        [0, 0],
        [1, 1.6],
        [2, 0],
      ],
      0.01,
    ],
    [
      "h1.6 (58.0° corners)",
      [
        [0, 0],
        [1, 1.6],
        [2, 0],
      ],
      0.03,
    ],
    [
      "h1.6 (58.0° corners)",
      [
        [0, 0],
        [1, 1.6],
        [2, 0],
      ],
      0.05,
    ],
    [
      "h1.6 (58.0° corners)",
      [
        [0, 0],
        [1, 1.6],
        [2, 0],
      ],
      0.1,
    ],
    [
      "lean (114.0° and 20.6° corners)",
      [
        [0, 0],
        [-0.4, 0.9],
        [2, 0],
      ],
      0.03,
    ],
  ] as const)(
    "native inward loop %s, d = %s: certified; an annulus (outer = source, hole = offset) plus the inner disk, areas by oracle",
    async (_name, fit, distance) => {
      const { session, seeds } = loopSession(fit);
      const committed = committedOffsetOnSide(
        session,
        seeds,
        distance,
        "right",
      );
      expect(
        committed.definition.derivedRelationships ?? [],
        "premise: the offset commits",
      ).toHaveLength(1);
      const { session: live, response } = await liveRound(committed);
      expect(response.offsetPublications.map((item) => item.status)).toEqual([
        "certified",
      ]);
      expectInwardLoopRegions(live, response, `${_name} d=${distance}`);
    },
    600_000,
  );
});

describe("T08b-g5c non-accepted offset outputs ([TECH] G19/G19a, U-G5)", () => {
  test.each(["left", "right"] as const)(
    "regions: the rectangle offset 0.5 %s plus an unrelated rectangle; certified → the offset regions and the far one; failed, pending or unpublished → the source and far regions survive (ids as without the offset), one targeted diagnostic per output, no output bounds a region",
    async (side) => {
      const { session, seeds } = rectanglesSession();
      const baseline = await liveDerive(session);
      const baseIds = baseline.regions.map((region) => region.regionId).sort();
      expect(baseIds, "premise: the two rectangles").toHaveLength(2);
      const committed = committedOffsetOnSide(session, seeds, 0.5, side);
      const { derivationId, outputs } = offsetOutputIds(committed);
      const certified = await liveDerive(committed);
      expect(certified.offsetPublications.map((item) => item.status)).toEqual([
        "certified",
      ]);
      expect(
        certified.regions,
        `${side}: certified, 2 + 1 regions`,
      ).toHaveLength(3);
      expect(usesAny(certified.regions, outputs), side).toBe(true);
      const certifiedIds = certified.regions.map((region) => region.regionId);
      // Inward (left: trimmed lines) the source region gains the offset as
      // a hole, so only the far region keeps its id; outward (right: lines
      // and joint arcs) the source region is unchanged too.
      expect(
        baseIds.filter((id) => certifiedIds.includes(id)),
        `${side}: the far rectangle's region (and outward the source's) is unchanged`,
      ).toHaveLength(side === "left" ? 1 : 2);
      const live = committed.liveSolve!;
      expect(
        live.solvedSnapshot.certifiedOffsetDerivationIds,
        "premise: the live solve itself certifies nothing",
      ).toBeUndefined();
      const deriver = createSketchArrangementDeriver(
        createCertifiedNeutralCurveQueryCapabilityForTest(),
      );
      for (const publications of [
        [{ derivationId, status: "failed" }],
        [{ derivationId, status: "planChanged" }],
        [],
      ] as const) {
        const state = publications[0]?.status ?? "unpublished";
        const result = await deriver.derive({
          documentId: "doc_workspace" as never,
          revisionId: "rev_0001" as never,
          sketchId: "sketch_g5b" as never,
          definition: live.definition,
          solvedSnapshot: live.solvedSnapshot,
          projectedReferences: [],
          modelingTolerance: 1e-3,
          ...offsetArrangementInput(
            live.definition,
            live.solvedSnapshot,
            publications as readonly SketchOffsetPublicationRecord[],
          ),
        });
        const where = `${side} ${state}`;
        expect(
          result.regions.map((region) => region.regionId).sort(),
          `${where}: the source and far regions, ids as without the offset`,
        ).toEqual(baseIds);
        expect(usesAny(result.regions, outputs), where).toBe(false);
        expect(
          [...new Set(result.diagnostics.map((d) => d.code))],
          `${where}: only the targeted exclusion diagnostics`,
        ).toEqual(["region-derived-unpublished"]);
        const targets = result.diagnostics.map((d) =>
          d.target?.kind === "entity" ? d.target.entityId : null,
        );
        expect(
          [...targets].sort(),
          `${where}: exactly one diagnostic per output`,
        ).toEqual([...outputs].sort());
        expect(
          result.diagnostics.every((d) => d.message.includes(derivationId)),
          `${where}: each names the relationship`,
        ).toBe(true);
      }
    },
    600_000,
  );

  test("consumers: outputs (lines and joint arcs) of a failed relationship are not measured, exported, snapped or projected, draw invalid (stale while pending), and stay pickable; certified ones are ordinary", async () => {
    const { session, seeds } = rectanglesSession();
    const committed = committedOffsetOnSide(session, seeds, 0.5, "right");
    const { derivationId, outputs } = offsetOutputIds(committed);
    expect(
      outputs.length,
      "premise: line outputs and joint arcs",
    ).toBeGreaterThan(4);
    const source = seeds[0]!;
    const failed = failedRound(committed);
    const { session: certified } = await liveRound(committed);
    expect(
      certified.liveSolve!.solvedSnapshot.certifiedOffsetDerivationIds,
      "G19a: the certified round records its relationship",
    ).toEqual([derivationId]);
    expect(
      failed.liveSolve!.solvedSnapshot.certifiedOffsetDerivationIds,
      "G19a: a failed round records nothing",
    ).toBeUndefined();

    // Measurement.
    const measure = (state: SketchSessionState, entityId: SketchEntityId) =>
      deriveMeasurementViewModel({
        activeToolId: "measure",
        selection: [
          { kind: "sketchEntity", sketchId: "sketch_g5b", entityId } as never,
        ],
        snapshot: { document: { sketches: [sketchRecordOf(state)] } } as never,
      })?.witnesses ?? [];
    for (const output of outputs) {
      expect(
        measure(failed, output),
        `failed: ${output} is not measured`,
      ).toEqual([]);
      expect(
        measure(certified, output).length,
        `certified: ${output} is measured`,
      ).toBeGreaterThan(0);
    }
    expect(
      measure(failed, source).length,
      "the source is measured",
    ).toBeGreaterThan(0);

    // Vector export.
    const exportOf = (state: SketchSessionState) => {
      const model = buildSketchVectorExportModel({
        documentId: "doc_workspace" as never,
        revisionId: "rev_0001" as never,
        sketches: [sketchRecordOf(state)],
        target: { kind: "sketch", sketchId: "sketch_g5b" } as never,
      });
      if ("diagnostic" in model) throw new Error(model.diagnostic.message);
      return model;
    };
    const failedExport = exportOf(failed);
    expect(
      failedExport.entities.filter((entity) =>
        outputs.includes(entity.entityId as SketchEntityId),
      ),
      "failed: no output is exported",
    ).toEqual([]);
    expect(
      failedExport.entities.some((entity) => entity.entityId === source),
      "the source is exported",
    ).toBe(true);
    const skipped = failedExport.diagnostics.filter(
      (diagnostic) => diagnostic.code === "sketch-vector-uncertified-offset",
    );
    expect(skipped, "failed: one warning per output").toHaveLength(
      outputs.length,
    );
    expect(
      outputs.every((output) =>
        skipped.some((diagnostic) => diagnostic.message.includes(output)),
      ),
    ).toBe(true);
    const certifiedExport = exportOf(certified);
    expect(
      outputs.every((output) =>
        certifiedExport.entities.some((entity) => entity.entityId === output),
      ),
      "certified: every output is exported",
    ).toBe(true);
    expect(
      certifiedExport.diagnostics.some(
        (diagnostic) => diagnostic.code === "sketch-vector-uncertified-offset",
      ),
    ).toBe(false);

    // Snapping.
    const snapIds = (state: SketchSessionState) =>
      collectSketchSnapGeometries({
        definition: state.liveSolve!.definition,
        solvedSnapshot: state.liveSolve!.solvedSnapshot,
      }).flatMap((geometry) =>
        geometry.source.kind === "localEntity"
          ? [geometry.source.entityId]
          : [],
      );
    expect(
      snapIds(failed).filter((id) => outputs.includes(id)),
      "failed: no output snaps",
    ).toEqual([]);
    expect(snapIds(failed)).toContain(source);
    expect(
      outputs.every((output) => snapIds(certified).includes(output)),
      "certified: every output snaps",
    ).toBe(true);

    // Display (sketch mode) and pick.
    const validityOf = (state: SketchSessionState, entityId: SketchEntityId) =>
      getStableSketchSessionDisplayRenderables(state)
        .filter(
          (item) =>
            item.target?.kind === "sketchEntity" &&
            item.target.entityId === entityId &&
            item.semanticClass !== "region",
        )
        .map((item) => item.regionValidity);
    expect(committed.liveRegions.status, "premise: pending").toBe("pending");
    for (const output of outputs) {
      expect(validityOf(failed, output), `failed: ${output} invalid`).toEqual([
        "invalid",
      ]);
      expect(validityOf(committed, output), `pending: ${output} stale`).toEqual(
        ["stale"],
      );
      expect(
        validityOf(certified, output),
        `certified: ${output} ordinary`,
      ).toEqual([undefined]);
      expect(
        collectSketchInteractionGeometry(failed).some(
          (geometry) => geometry.id === `sketch-entity:${output}`,
        ),
        `failed: ${output} stays pickable`,
      ).toBe(true);
    }
    expect(validityOf(failed, source), "the source is ordinary").toEqual([
      undefined,
    ]);

    // Part mode: the committed render export still draws and binds them.
    const occIds = buildOccRenderExport(
      { constructions: [], bodies: [], sketches: [] } as never,
      new Map(),
      {},
      [sketchRecordOf(failed)],
    ).records.flatMap((record) =>
      record.binding.target.kind === "sketchEntity"
        ? [record.binding.target.entityId]
        : [],
    );
    expect(
      outputs.every((output) => occIds.includes(output)),
      "failed: part mode still draws and binds every output (pickable)",
    ).toBe(true);

    // Projection (modeling consumption).
    const output = outputs[0]!;
    const one = project(failed, { kind: "sketchEntity", entityId: output });
    expect(one.status).toBe("unsupportedSource");
    expect(one.geometry).toEqual([]);
    expect(one.diagnostics.map((d) => d.code)).toEqual([
      NON_ACCEPTED_OFFSET_OUTPUT_PROJECTION_CODE,
    ]);
    expect(one.diagnostics[0]!.message).toContain(derivationId);
    expect(
      project(certified, { kind: "sketchEntity", entityId: output }).status,
      "certified: the output projects",
    ).toBe("projected");
    const whole = project(failed, { kind: "sketch" });
    expect(whole.status).toBe("projected");
    expect(
      whole.diagnostics.map((d) => d.code),
      "failed: one warning per skipped output",
    ).toEqual(outputs.map(() => NON_ACCEPTED_OFFSET_OUTPUT_PROJECTION_CODE));
    const wholeCertified = project(certified, { kind: "sketch" });
    expect(wholeCertified.diagnostics).toEqual([]);
    expect(
      wholeCertified.geometry.length - whole.geometry.length,
      "the skipped geometry is exactly the outputs",
    ).toBe(outputs.length);
  }, 600_000);

  test("G19a: certifiedOffsetDerivationIds is solved revision data written only for certified relationships, validated (unique, existing offset relationship) and round-tripped by normalization; absent otherwise", async () => {
    const { session, seeds } = rectanglesSession();
    const committed = committedOffsetOnSide(session, seeds, 0.5, "left");
    const { derivationId } = offsetOutputIds(committed);
    const raw = committed.liveSolve!.solvedSnapshot;
    const definition = committed.liveSolve!.definition;
    expect(
      applyOffsetPublications(definition, raw, [
        { derivationId, status: "failed" } as never,
      ]),
      "no certified relationship: the snapshot object is returned as it is",
    ).toBe(raw);
    expect(applyOffsetPublications(definition, raw, [])).toBe(raw);
    const published = applyOffsetPublications(definition, raw, [
      { derivationId, status: "certified" } as never,
    ]);
    expect(published.certifiedOffsetDerivationIds).toEqual([derivationId]);
    expect(
      applyOffsetPublications(definition, published, [
        { derivationId, status: "certified" } as never,
      ]),
      "idempotent (equal; a round's ids replace the recorded ones, review advisory 4)",
    ).toEqual(published);
    expect(validateSolvedSketchSnapshot(published).success).toBe(true);
    expect(normalizeSolvedSketchSnapshot(published)).toEqual(published);
    expect(
      "certifiedOffsetDerivationIds" in normalizeSolvedSketchSnapshot(raw),
      "absent stays absent",
    ).toBe(false);
    const duplicate = validateSolvedSketchSnapshot({
      ...published,
      certifiedOffsetDerivationIds: [derivationId, derivationId],
    });
    expect(
      duplicate.success ? [] : duplicate.issues.map((issue) => issue.message),
    ).toContain(
      "Certified offset relationship ids must name each relationship once.",
    );
    const base = (
      await new MockKernelAdapter().getDocumentSnapshot({
        contractVersion: CONTRACT_VERSION,
        documentId: "doc_workspace",
      })
    ).snapshot.document.sketches[0]!.sketch;
    const record = (ids: string[]) =>
      validateSketchRecord({
        ...structuredClone(base),
        definition,
        solvedSnapshot: { ...published, certifiedOffsetDerivationIds: ids },
        regions: [],
      });
    expect(record([derivationId]).success).toBe(true);
    const unknown = record(["sketch_derivation_unknown"]);
    expect(
      unknown.success ? [] : unknown.issues.map((issue) => issue.message),
    ).toContain(
      "A certified offset relationship id must reference an existing offset relationship.",
    );
    expect(() =>
      normalizeSolvedSketchSnapshot({
        ...published,
        certifiedOffsetDerivationIds: [1],
      }),
    ).toThrow("Invalid certified offset relationship id payload.");
  }, 300_000);
});

// ---------------------------------------------------------------------------
// T08b-g5c review fixes (logic lane). REQUIRED-1: feature execution (OCC
// `executeOccFeature`, the mock kernel's `createFeature`) consumes a sketch
// entity only when it is accepted geometry ([TECH] G19). Advisory 3: driven
// points of non-accepted outputs ([TECH] G19b). Advisory 4: a round's
// certified ids replace the recorded ones.
// ---------------------------------------------------------------------------

/**
 * A mock solver whose every solve nudges one driven output point by 8 ulp:
 * the relationship's publication then fails honestly in the commit round
 * (spec-only fake port; the certifier and region derivation are real).
 */
class NudgingSolverAdapter extends MockSketchSolverAdapter {
  readonly nudged: SketchPointId;

  constructor(nudged: SketchPointId) {
    super({
      neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
    });
    this.nudged = nudged;
  }

  override async solveSketch(request: SolveSketchRequest) {
    const response = await super.solveSketch(request);
    return {
      ...response,
      solvedSnapshot: {
        ...response.solvedSnapshot,
        solvedPoints: response.solvedSnapshot.solvedPoints.map((point) =>
          point.pointId === this.nudged
            ? {
                ...point,
                solvedPosition: [
                  point.solvedPosition[0] + Number.EPSILON * 8,
                  point.solvedPosition[1],
                ] as const,
              }
            : point,
        ),
      },
    };
  }
}

/**
 * The two rectangles with the source offset 0.5 outward, committed through
 * the mock kernel: certified, or with its publication failed by a nudged
 * driven point. Returns the kernel, the committed snapshot sketch record and
 * the horizontal line output on y = -0.5 (the bottom edge's offset).
 */
async function committedOffsetFeatureSketch(failed: boolean) {
  const { session, seeds } = rectanglesSession();
  const committed = committedOffsetOnSide(session, seeds, 0.5, "right");
  const relationship = offsetRelationshipOf(committed.definition);
  const adapter = new MockKernelAdapter({
    solverAdapter: failed
      ? new NudgingSolverAdapter(relationship.outputs[0]!.outputPointIds[0]!)
      : new MockSketchSolverAdapter({
          neutralCurveQueries:
            createCertifiedNeutralCurveQueryCapabilityForTest(),
        }),
  });
  const before = await adapter.getDocumentSnapshot(KERNEL_REQUEST);
  const response = await adapter.commitSketch({
    ...KERNEL_REQUEST,
    baseRevisionId: before.snapshot.document.revisionId,
    solverCorrelation: {
      requestId: "request_g5c_feature",
      projectionRequestId: "request_g5c_feature:project",
      validationRequestId: "request_g5c_feature:validate",
      solveRequestId: "request_g5c_feature:solve",
      regionRequestId: "request_g5c_feature:regions",
    },
    sketchId: null,
    sketchLabel: "G5c feature inputs",
    plane: before.snapshot.document.sketches[0]!.plane,
    definition: committed.definition,
  });
  const after = await adapter.getDocumentSnapshot(KERNEL_REQUEST);
  const entry = after.snapshot.document.sketches.find(
    (candidate) => candidate.sketchId === response.sketchId,
  )!;
  const solved = new Map(
    entry.sketch.solvedSnapshot.solvedEntities.map((record) => [
      record.entityId,
      record,
    ]),
  );
  const axisLine = relationship.outputs
    .map((output) => output.outputEntityId)
    .find((entityId) => {
      const record = solved.get(entityId);
      return (
        record?.kind === "lineSegment" &&
        Math.abs(record.startPosition[1] + 0.5) < 1e-9 &&
        Math.abs(record.endPosition[1] + 0.5) < 1e-9
      );
    })!;
  // The far rectangle's own (accepted) lines and region.
  const farLine = entry.sketch.definition.entities.find((entity) => {
    const record = solved.get(entity.entityId);
    return (
      record?.kind === "lineSegment" &&
      record.startPosition[0] >= 10 &&
      record.endPosition[0] >= 10
    );
  })!.entityId;
  const farRegion = entry.sketch.regions.find((region) =>
    region.loops.some((loop) =>
      loop.segments.some(
        (segment) =>
          segment.branch.source.kind === "entity" &&
          segment.branch.source.entityId === farLine,
      ),
    ),
  )!;
  // [TECH] G19c: the axis line's driven end point with the larger x.
  const solvedPoints = new Map(
    entry.sketch.solvedSnapshot.solvedPoints.map((point) => [
      point.pointId,
      point.solvedPosition,
    ]),
  );
  const drivenPoint = [
    ...relationship.outputs.find(
      (output) => output.outputEntityId === axisLine,
    )!.outputPointIds,
  ].sort(
    (left, right) => solvedPoints.get(right)![0] - solvedPoints.get(left)![0],
  )[0]!;
  return {
    adapter,
    entry,
    derivationId: relationship.derivationId,
    axisLine,
    farLine,
    farRegion,
    drivenPoint,
    drivenPosition: solvedPoints.get(drivenPoint)!,
  };
}

async function occFeatureContext(
  sketches: OccFeatureExecutionContext["sketches"],
  bodies: OccFeatureExecutionContext["bodies"] = [],
  oc?: OpenCascadeInstance,
): Promise<OccFeatureExecutionContext> {
  return {
    oc: oc ?? (await getDefaultOpenCascadeInstance()),
    documentId: "doc_workspace",
    revisionId: "rev_0001",
    modelingTolerance: 1e-3,
    sketches,
    constructions: [],
    constructionPlanes: new Map(),
    bodies,
    assets: { records: [] },
    assetBlobs: new Map(),
    resolvedGeometryAssets: new Map(),
    bakedShapeCache: new Map(),
    previousTopologyStage: null,
    topologyProvenanceIndex: createOccTopologyProvenanceIndex({
      stages: new Map(),
      previousLineage: new Map(),
      historyOrder: [],
    }),
  };
}

const sketchEntityRef = (sketchId: string, entityId: SketchEntityId) =>
  ({ kind: "sketchEntity", sketchId, entityId }) as never;

const surfaceExtrude = (sketchId: string, entityId: SketchEntityId) =>
  ({
    kind: "extrude",
    featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
    parameters: {
      resultBodyType: "surface",
      profiles: [sketchEntityRef(sketchId, entityId)],
      startExtent: { kind: "profilePlane" },
      extent: {
        mode: "oneSide",
        end: { kind: "blind", direction: "positive", distance: 2 },
      },
    },
  }) as never;

const surfaceRevolve = (
  sketchId: string,
  profile: SketchEntityId,
  axis: SketchEntityId,
) =>
  ({
    kind: "revolve",
    featureTypeVersion: REVOLVE_FEATURE_SCHEMA_VERSION,
    parameters: {
      resultBodyType: "surface",
      profiles: [sketchEntityRef(sketchId, profile)],
      axis: sketchEntityRef(sketchId, axis),
      startAngle: 0,
      extent: { mode: "oneSide", end: { kind: "full" } },
    },
  }) as never;

const sketchPathSweep = (
  profileSketchId: string,
  regionId: string,
  sketchId: string,
  path: SketchEntityId,
) =>
  ({
    kind: "sweep",
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      operationIntent: "create",
      participants: [
        {
          role: "profile",
          targets: [{ kind: "region", sketchId: profileSketchId, regionId }],
        },
        { role: "path", targets: [sketchEntityRef(sketchId, path)] },
      ],
    },
  }) as never;

const sketchDirectionPattern = (
  bodyId: string,
  sketchId: string,
  direction: SketchEntityId,
) =>
  ({
    kind: "linearPattern",
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      participants: [
        { role: "body", targets: [{ kind: "body", bodyId }] },
        { role: "direction", targets: [sketchEntityRef(sketchId, direction)] },
      ],
      options: {
        instanceCount: 2,
        spacing: 10,
        centered: false,
        oppositeDirection: false,
      },
    },
  }) as never;

const sketchPointRef = (sketchId: string, pointId: SketchPointId) =>
  ({ kind: "sketchPoint", sketchId, pointId }) as never;

const pointHole = (sketchId: string, pointId: SketchPointId, bodyId: string) =>
  ({
    kind: "hole",
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      participants: [
        { role: "location", targets: [sketchPointRef(sketchId, pointId)] },
        { role: "body", targets: [{ kind: "body", bodyId }] },
      ],
      options: {
        style: "simple",
        mainDiameter: 0.2,
        termination: "throughAll",
      },
    },
  }) as never;

/** A solid extrude of `regionId` whose start extent or up-to terminator is a sketch point. */
const pointExtentExtrude = (
  profileSketchId: string,
  regionId: string,
  sketchId: string,
  pointId: SketchPointId,
  extent: "start" | "upToVertex",
) =>
  ({
    kind: "extrude",
    featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
    parameters: {
      resultBodyType: "solid",
      profiles: [{ kind: "region", sketchId: profileSketchId, regionId }],
      startExtent:
        extent === "start"
          ? {
              kind: "sketchPointOffset",
              target: sketchPointRef(sketchId, pointId),
            }
          : { kind: "profilePlane" },
      extent: {
        mode: "oneSide",
        end:
          extent === "start"
            ? { kind: "blind", direction: "positive", distance: 1 }
            : {
                kind: "upToVertex",
                direction: "positive",
                target: sketchPointRef(sketchId, pointId),
              },
      },
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    },
  }) as never;

function occFailure(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  return null;
}

describe("T08b-g5c review fixes", () => {
  test("REQUIRED-1 (OCC): a failed relationship's line output is not an open profile, revolve axis, sweep path or pattern direction (targeted feature-input-offset-not-certified naming the output and relationship); the certified output builds each feature", async () => {
    const failed = await committedOffsetFeatureSketch(true);
    const certified = await committedOffsetFeatureSketch(false);
    expect(
      failed.entry.sketch.solvedSnapshot.certifiedOffsetDerivationIds,
      "premise: the nudged commit round certifies nothing",
    ).toBeUndefined();
    expect(
      failed.entry.sketch.derivedValidity.state,
      "premise: the sketch itself stays current (G16), so only G19 can refuse the output",
    ).toBe("current");
    expect(
      certified.entry.sketch.solvedSnapshot.certifiedOffsetDerivationIds,
    ).toEqual([certified.derivationId]);
    expect(failed.axisLine, "premise: the bottom offset line").toBeDefined();
    expect(
      failed.farRegion,
      "premise: the far rectangle's region",
    ).toBeDefined();

    for (const { label, fixture, expectFailure } of [
      { label: "failed", fixture: failed, expectFailure: true },
      { label: "certified", fixture: certified, expectFailure: false },
    ]) {
      const { entry, axisLine, farLine, farRegion, derivationId } = fixture;
      const sketchId = entry.sketchId;
      // A second record of the same sketch on YZ: a sweep profile across
      // the XY path (spec-only fixture).
      const profileSketch = {
        ...entry,
        sketchId: "sketch_g5c_profile",
        plane: createStandardPlaneDefinition("yz"),
      } as typeof entry;
      const context = await occFeatureContext([entry, profileSketch]);
      const solidExtrude = executeOccFeature(
        context,
        "feature_g5c_seed" as never,
        {
          kind: "extrude",
          featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
          parameters: {
            resultBodyType: "solid",
            profiles: [
              { kind: "region", sketchId, regionId: farRegion.regionId },
            ],
            startExtent: { kind: "profilePlane" },
            extent: {
              mode: "oneSide",
              end: { kind: "blind", direction: "positive", distance: 1 },
            },
            operation: "newBody",
            booleanScope: { kind: "standalone" },
          },
        } as never,
      );
      const seedBody = solidExtrude.bodies[0]!;
      const patternContext = await occFeatureContext([entry], [seedBody]);
      const rows = [
        {
          use: "an open profile curve",
          run: () =>
            executeOccFeature(
              context,
              "feature_g5c_open" as never,
              surfaceExtrude(sketchId, axisLine),
            ),
        },
        {
          use: "an axis or direction",
          run: () =>
            executeOccFeature(
              context,
              "feature_g5c_axis" as never,
              surfaceRevolve(sketchId, farLine, axisLine),
            ),
        },
        {
          use: "a sweep path",
          run: () =>
            executeOccFeature(
              context,
              "feature_g5c_sweep" as never,
              sketchPathSweep(
                profileSketch.sketchId,
                farRegion.regionId,
                sketchId,
                axisLine,
              ),
            ),
        },
        {
          use: "an axis or direction",
          run: () =>
            executeOccFeature(
              patternContext,
              "feature_g5c_pattern" as never,
              sketchDirectionPattern(seedBody.bodyId, sketchId, axisLine),
            ),
        },
      ];
      for (const [index, row] of rows.entries()) {
        const where = `${label} row ${index} (${row.use})`;
        const message = occFailure(row.run);
        if (expectFailure)
          expect(message, where).toBe(
            `${NON_ACCEPTED_OFFSET_FEATURE_INPUT_CODE}: Sketch entity ${axisLine} is an output of offset relationship ${derivationId}, which is not certified, so it cannot be used as ${row.use}.`,
          );
        else expect(message, `${where}: builds`).toBeNull();
      }
    }
  }, 600_000);

  test("G19c (OCC): a failed relationship's driven point is not a hole location, an extrude start-extent point or an up-to-vertex terminator (targeted feature-input-offset-not-certified naming the point and relationship); the certified point builds each feature", async () => {
    for (const failedRound of [true, false]) {
      const fixture = await committedOffsetFeatureSketch(failedRound);
      const { entry, farRegion, drivenPoint, drivenPosition, derivationId } =
        fixture;
      const label = failedRound ? "failed" : "certified";
      expect(
        entry.sketch.solvedSnapshot.certifiedOffsetDerivationIds,
        `premise: ${label}`,
      ).toEqual(failedRound ? undefined : [derivationId]);
      const sketchId = entry.sketchId;
      const profileSketch = {
        ...entry,
        sketchId: "sketch_g5c_profile",
        plane: createStandardPlaneDefinition("yz"),
      } as typeof entry;
      const oc = await getDefaultOpenCascadeInstance();
      const box = new oc.BRepPrimAPI_MakeBox_3(
        new oc.gp_Pnt_3(drivenPosition[0] - 1, drivenPosition[1] - 1, -2),
        2,
        2,
        4,
      );
      box.Build(new oc.Message_ProgressRange_1());
      const body = trackNewSolidBody(oc, {
        bodyId: "body_g5c_hole" as never,
        label: "body_g5c_hole",
        ownerFeatureId: "feature_g5c_box" as never,
        shape: box.Shape(),
      });
      const context = await occFeatureContext([entry, profileSketch], [body]);
      expect(
        drivenPosition[0],
        "premise: the terminator lies ahead of the YZ profile plane",
      ).toBeGreaterThan(1);
      const rows = [
        {
          use: "a hole location",
          run: () =>
            executeOccFeature(
              context,
              "feature_g5c_hole" as never,
              pointHole(sketchId, drivenPoint, body.bodyId),
            ),
        },
        {
          use: "an extrude extent point",
          run: () =>
            executeOccFeature(
              context,
              "feature_g5c_start" as never,
              pointExtentExtrude(
                sketchId,
                farRegion.regionId,
                sketchId,
                drivenPoint,
                "start",
              ),
            ),
        },
        {
          use: "an extrude extent point",
          run: () =>
            executeOccFeature(
              context,
              "feature_g5c_up_to" as never,
              pointExtentExtrude(
                profileSketch.sketchId,
                farRegion.regionId,
                sketchId,
                drivenPoint,
                "upToVertex",
              ),
            ),
        },
      ];
      for (const [index, row] of rows.entries()) {
        const where = `${label} point row ${index} (${row.use})`;
        const message = occFailure(row.run);
        if (failedRound)
          expect(message, where).toBe(
            `${NON_ACCEPTED_OFFSET_FEATURE_INPUT_CODE}: Sketch point ${drivenPoint} is a driven point of an output of offset relationship ${derivationId}, which is not certified, so it cannot be used as ${row.use}.`,
          );
        else expect(message, `${where}: builds`).toBeNull();
      }
    }
  }, 600_000);

  test("G19c (mock kernel): createFeature rejects a failed relationship's driven point as a hole location or an extrude start-extent point with the targeted diagnostic on that point; the certified point is accepted", async () => {
    for (const failedRound of [true, false]) {
      const fixture = await committedOffsetFeatureSketch(failedRound);
      const { adapter, entry, farRegion, drivenPoint, derivationId } = fixture;
      const sketchId = entry.sketchId;
      for (const [index, definition] of [
        pointHole(sketchId, drivenPoint, "body_part-1"),
        pointExtentExtrude(
          sketchId,
          farRegion.regionId,
          sketchId,
          drivenPoint,
          "start",
        ),
      ].entries()) {
        const kind = (definition as { kind: string }).kind;
        const where = `${failedRound ? "failed" : "certified"} ${kind} point row ${index}`;
        const baseRevisionId = (
          await adapter.getDocumentSnapshot(KERNEL_REQUEST)
        ).snapshot.document.revisionId;
        const response = await adapter.createFeature({
          ...KERNEL_REQUEST,
          baseRevisionId,
          definition,
        } as never);
        const offsetDiagnostics = response.diagnostics.filter(
          (diagnostic) =>
            diagnostic.code === NON_ACCEPTED_OFFSET_FEATURE_INPUT_CODE,
        );
        if (failedRound) {
          expect(response.revisionState, where).toEqual({
            kind: "rejected",
            baseRevisionId,
            reasonCode: NON_ACCEPTED_OFFSET_FEATURE_INPUT_CODE,
          });
          expect(offsetDiagnostics, where).toEqual([
            {
              code: NON_ACCEPTED_OFFSET_FEATURE_INPUT_CODE,
              severity: "error",
              message: `Sketch point ${drivenPoint} is a driven point of an output of offset relationship ${derivationId}, which is not certified, so it cannot be used as an input of ${kind}.`,
              target: { kind: "sketchPoint", sketchId, pointId: drivenPoint },
              detail: null,
            },
          ]);
        } else {
          expect(offsetDiagnostics, `${where}: no G19c refusal`).toEqual([]);
          expect(response.revisionState.kind, `${where}: accepted`).toBe(
            "accepted",
          );
        }
      }
    }
  }, 600_000);

  test("REQUIRED-1 (mock kernel): createFeature rejects a failed relationship's line output as a sweep path, pattern direction, open profile or revolve axis with the targeted diagnostic on that output; the certified output is accepted", async () => {
    for (const failedRound of [true, false]) {
      const fixture = await committedOffsetFeatureSketch(failedRound);
      const { adapter, entry, axisLine, farRegion, derivationId } = fixture;
      const sketchId = entry.sketchId;
      const create = async (definition: never) => {
        const baseRevisionId = (
          await adapter.getDocumentSnapshot(KERNEL_REQUEST)
        ).snapshot.document.revisionId;
        return {
          baseRevisionId,
          response: await adapter.createFeature({
            ...KERNEL_REQUEST,
            baseRevisionId,
            definition,
          } as never),
        };
      };
      const rows = [
        sketchPathSweep(sketchId, farRegion.regionId, sketchId, axisLine),
        sketchDirectionPattern("body_part-1", sketchId, axisLine),
        surfaceExtrude(sketchId, axisLine),
        surfaceRevolve(sketchId, axisLine, axisLine),
      ];
      for (const [index, definition] of rows.entries()) {
        const { baseRevisionId, response } = await create(definition);
        const kind = (definition as { kind: string }).kind;
        const where = `${failedRound ? "failed" : "certified"} ${kind} row ${index}`;
        const offsetDiagnostics = response.diagnostics.filter(
          (diagnostic) =>
            diagnostic.code === NON_ACCEPTED_OFFSET_FEATURE_INPUT_CODE,
        );
        if (failedRound) {
          expect(response.revisionState, where).toEqual({
            kind: "rejected",
            baseRevisionId,
            reasonCode: NON_ACCEPTED_OFFSET_FEATURE_INPUT_CODE,
          });
          expect(offsetDiagnostics, where).toEqual([
            {
              code: NON_ACCEPTED_OFFSET_FEATURE_INPUT_CODE,
              severity: "error",
              message: `Sketch entity ${axisLine} is an output of offset relationship ${derivationId}, which is not certified, so it cannot be used as an input of ${kind}.`,
              target: { kind: "sketchEntity", sketchId, entityId: axisLine },
              detail: null,
            },
          ]);
        } else {
          expect(offsetDiagnostics, `${where}: no G19 refusal`).toEqual([]);
          // Revolve is not implemented by the mock kernel; the rest build.
          if (kind !== "revolve")
            expect(response.revisionState.kind, `${where}: accepted`).toBe(
              "accepted",
            );
        }
      }
    }
  }, 600_000);

  test("G19b (advisory 3): the driven points of a failed relationship's outputs are not snap candidates and are not measurable; certified ones are", async () => {
    const { session, seeds } = rectanglesSession();
    const committed = committedOffsetOnSide(session, seeds, 0.5, "right");
    const relationship = offsetRelationshipOf(committed.definition);
    const drivenPoints = [
      ...new Set([
        ...relationship.outputs.flatMap((output) => output.outputPointIds),
        ...relationship.jointOutputs.flatMap((joint) => [
          joint.startPointId,
          joint.endPointId,
          joint.centerPointId,
        ]),
      ]),
    ];
    const failed = failedRound(committed);
    const { session: certified } = await liveRound(committed);
    const sourcePoint = (
      committed.definition.entities.find(
        (entity) => entity.entityId === seeds[0],
      ) as { startPointId: SketchPointId }
    ).startPointId;
    expect(
      [
        ...nonAcceptedOffsetOutputPoints(
          failed.liveSolve!.definition,
          failed.liveSolve!.solvedSnapshot,
        ).keys(),
      ].sort(),
      "the predicate names exactly the driven points",
    ).toEqual([...drivenPoints].sort());
    expect(
      nonAcceptedOffsetOutputPoints(
        certified.liveSolve!.definition,
        certified.liveSolve!.solvedSnapshot,
      ).size,
    ).toBe(0);

    const snapPointIds = (state: SketchSessionState) =>
      collectSketchSnapGeometries({
        definition: state.liveSolve!.definition,
        solvedSnapshot: state.liveSolve!.solvedSnapshot,
      }).flatMap((geometry) =>
        geometry.source.kind === "localPoint" ? [geometry.source.pointId] : [],
      );
    const measured = (state: SketchSessionState, pointId: SketchPointId) =>
      deriveMeasurementViewModel({
        activeToolId: "measure",
        selection: [
          { kind: "sketchPoint", sketchId: "sketch_g5b", pointId } as never,
        ],
        snapshot: { document: { sketches: [sketchRecordOf(state)] } } as never,
      })?.witnesses ?? [];
    const centers = new Set(
      relationship.jointOutputs.map((joint) => joint.centerPointId),
    );
    for (const pointId of drivenPoints) {
      expect(
        snapPointIds(failed),
        `failed: ${pointId} is not a snap candidate`,
      ).not.toContain(pointId);
      // Arc centers are never point candidates (existing rule).
      if (!centers.has(pointId))
        expect(
          snapPointIds(certified),
          `certified: ${pointId} snaps`,
        ).toContain(pointId);
      expect(measured(failed, pointId), `failed: ${pointId}`).toEqual([]);
      expect(
        measured(certified, pointId).length,
        `certified: ${pointId} is measurable`,
      ).toBeGreaterThan(0);
    }
    expect(snapPointIds(failed), "a source point snaps").toContain(sourcePoint);
    expect(measured(failed, sourcePoint).length).toBeGreaterThan(0);
  }, 600_000);

  test("advisory 4: applyOffsetPublications replaces the recorded certified ids with the round's; a relationship that has since failed (or is no longer published) is not accepted", async () => {
    const { session, seeds } = rectanglesSession();
    const committed = committedOffsetOnSide(session, seeds, 0.5, "right");
    const { derivationId, outputs } = offsetOutputIds(committed);
    const definition = committed.liveSolve!.definition;
    const published = applyOffsetPublications(
      definition,
      committed.liveSolve!.solvedSnapshot,
      [{ derivationId, status: "certified" } as never],
    );
    expect(published.certifiedOffsetDerivationIds).toEqual([derivationId]);
    for (const publications of [
      [{ derivationId, status: "failed" }],
      [{ derivationId, status: "planChanged" }],
      [],
    ]) {
      const state = publications[0]?.status ?? "unpublished";
      const later = applyOffsetPublications(
        definition,
        published,
        publications as never,
      );
      expect(
        "certifiedOffsetDerivationIds" in later,
        `${state} after certified: no recorded id survives`,
      ).toBe(false);
      expect(
        outputs.filter((output) =>
          isAcceptedOffsetOutput(definition, later, output),
        ),
        `${state} after certified: no output is accepted`,
      ).toEqual([]);
      expect(validateSolvedSketchSnapshot(later).success).toBe(true);
    }
  }, 300_000);
});

// ---------------------------------------------------------------------------
// T08b-g7a (logic lane). Seam: the live session after an edit of a filleted
// outline carrying an offset (audit C1, user decision U-G8): the rectangle
// tool, the Fillet edit operation and the Offset tool, then source edits
// through `rebuildSessionForDefinition` and the live G17 rounds.
// ---------------------------------------------------------------------------

describe("T08b-g7a live two-edit sequence (audit C1, U-G8)", () => {
  /** One live round: publish, and once more after a planChanged re-solve. */
  const settle = (session: SketchSessionState) => {
    let current = session;
    let publications = livePublications(current);
    current = publishSketchLiveRegions(current, [], [], publications);
    if (publications.some((item) => item.status === "planChanged")) {
      publications = livePublications(current);
      current = publishSketchLiveRegions(current, [], [], publications);
    }
    return { session: current, publication: publications[0]! };
  };
  const withDimensionValue = (
    definition: SketchDefinition,
    value: number,
  ): SketchDefinition => ({
    ...definition,
    dimensions: definition.dimensions.map((dimension) =>
      dimension.dimensionId === "dimension_c1_edit"
        ? ({ ...dimension, value } as typeof dimension)
        : dimension,
    ),
  });

  /**
   * Rectangle + Fillet r = 0.2 at its first corner. "beforeG7F": a fillet
   * authored before T08b-g7-F (no tangency, unbound arc), the only native way
   * an edit still kinks it (existing documents are not migrated).
   */
  const filletedRectangle = (fillets: "beforeG7F" | "native") => {
    const session = acceptSketchDraw(
      startSketchDraw(beginSketchTool(newSession(), "rectangle"), [0, 0]),
      [2, 1],
    );
    const lines = session.definition.entities
      .filter((entity) => entity.kind === "lineSegment")
      .map((entity) => entity.entityId);
    const filleted = createSketchFilletMutation({
      definition: session.definition,
      entityIds: [lines[0]!, lines[1]!],
      radius: 0.2,
      sequence: 90,
      factories: createSessionCommitFactories(90, session.sketchId!),
    });
    if (!filleted.valid || !filleted.definition)
      throw new Error(`fillet: ${filleted.message}`);
    return rebuildSessionForDefinition(session, {
      definition:
        fillets === "native"
          ? filleted.definition
          : withoutFilletRelationships(filleted.definition),
    });
  };

  test("rect + 1 fillet (authored before T08b-g7-F), inward d = 0.1: edit 1 (+0.2, a convex A4 kink) fails with the D5 topologyChanged and drops the published plan; edit 2 (+0.05) then solves UNHINTED, reads solved (never partiallySolved) and certifies", () => {
    const session = filletedRectangle("beforeG7F");
    const seeds = session.definition.entities
      .filter(
        (entity) => entity.kind === "lineSegment" || entity.kind === "arc",
      )
      .map((entity) => entity.entityId);
    const committed = settle(
      committedOffsetOnSide(session, seeds, 0.1, "left"),
    );
    expect(committed.publication.status).toBe("certified");
    expect(committed.session.offsetPlans).toHaveLength(1);
    const line = seeds.find(
      (id) =>
        committed.session.definition.entities.find(
          (entity) => entity.entityId === id,
        )?.kind === "lineSegment",
    )!;

    const edited = withLineLength(committed.session.definition, line, 0.2);
    const first = settle(
      rebuildSessionForDefinition(committed.session, { definition: edited }),
    );
    expect(first.session.liveSolve!.accepted).toBe(true);
    expect(first.publication).toMatchObject({
      status: "failed",
      diagnostic: {
        code: OFFSET_DIAGNOSTIC_CODES.topologyChanged,
        message: expect.stringContaining("now needs an offset arc"),
      },
    });
    expect(
      first.session.offsetPlans ?? [],
      "a failed publication carries no plan into the next solve",
    ).toEqual([]);

    const dimension = edited.dimensions.find(
      (item) => item.dimensionId === "dimension_c1_edit",
    )!;
    const second = rebuildSessionForDefinition(first.session, {
      definition: withDimensionValue(
        first.session.definition,
        (dimension as { value: number }).value - 0.15,
      ),
    });
    expect(
      second.liveSolve!.solvedSnapshot.offsetFramePlans?.[0]?.plan.origin,
      "premise: the second edit solves without a hint",
    ).toBe("firstChoice");
    expect(second.liveSolve!.accepted).toBe(true);
    expect(second.liveRegions.status).toBe("pending");
    expect(settle(second).publication.status).toBe("certified");
  }, 120_000);

  test("rect + 1 native fillet, inward d = 0.1: the edits that kinked a pre-T08b-g7-F fillet (+0.2, then +0.05) keep the fillet tangent (≤ 0.3°) and certify, carrying the published plan", () => {
    const session = filletedRectangle("native");
    const seeds = session.definition.entities
      .filter(
        (entity) => entity.kind === "lineSegment" || entity.kind === "arc",
      )
      .map((entity) => entity.entityId);
    const committed = settle(
      committedOffsetOnSide(session, seeds, 0.1, "left"),
    );
    expect(committed.publication.status).toBe("certified");
    const line = seeds.find(
      (id) =>
        committed.session.definition.entities.find(
          (entity) => entity.entityId === id,
        )?.kind === "lineSegment",
    )!;
    const edited = withLineLength(committed.session.definition, line, 0.2);
    const first = settle(
      rebuildSessionForDefinition(committed.session, { definition: edited }),
    );
    expect(first.session.liveSolve!.accepted).toBe(true);
    expect(
      first.publication.status,
      `${first.publication.diagnostic?.message}`,
    ).toBe("certified");
    expect(first.session.offsetPlans ?? []).toHaveLength(1);
    const positions = new Map(
      first.session.liveSolve!.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    const turns = filletEndTurns(
      edited,
      positions,
      seeds.filter(
        (id) =>
          edited.entities.find((entity) => entity.entityId === id)?.kind ===
          "arc",
      ),
    );
    expect(turns).toHaveLength(2);
    for (const turn of turns) expect(turn).toBeLessThanOrEqual(0.3);

    const second = settle(
      rebuildSessionForDefinition(first.session, {
        definition: withDimensionValue(
          first.session.definition,
          (
            edited.dimensions.find(
              (item) => item.dimensionId === "dimension_c1_edit",
            ) as { value: number }
          ).value - 0.15,
        ),
      }),
    );
    expect(second.session.liveSolve!.accepted).toBe(true);
    expect(second.publication.status).toBe("certified");
  }, 120_000);
});

/** Turn (degrees) between each fillet end's line and the arc's tangent. */
function filletEndTurns(
  definition: SketchDefinition,
  positions: ReadonlyMap<string, readonly [number, number]>,
  arcIds: readonly SketchEntityId[],
) {
  return definition.entities.flatMap((arc) =>
    arc.kind !== "arc" || !arcIds.includes(arc.entityId)
      ? []
      : definition.entities.flatMap((line) =>
          line.kind !== "lineSegment"
            ? []
            : [arc.startPointId, arc.endPointId]
                .filter(
                  (end) => line.startPointId === end || line.endPointId === end,
                )
                .map((end) => {
                  const c = positions.get(arc.centerPointId)!;
                  const e = positions.get(end)!;
                  const o = positions.get(
                    line.startPointId === end
                      ? line.endPointId
                      : line.startPointId,
                  )!;
                  const r = [e[0] - c[0], e[1] - c[1]];
                  const t = [o[0] - e[0], o[1] - e[1]];
                  return (
                    (Math.abs(
                      Math.asin(
                        (r[0]! * t[0]! + r[1]! * t[1]!) /
                          (Math.hypot(r[0]!, r[1]!) * Math.hypot(t[0]!, t[1]!)),
                      ),
                    ) *
                      180) /
                    Math.PI
                  );
                }),
        ),
  );
}

// ---------------------------------------------------------------------------
// T08b-g7-F (logic lane). Seam: the live session and the authored-action
// history around a native Fillet (issue 06: a primitive's defining
// relationships are authored with it; sizing decision B: no radius).
// ---------------------------------------------------------------------------

describe("T08b-g7-F Fillet relationships through the session (issue 06)", () => {
  const rectangle = () =>
    acceptSketchDraw(
      startSketchDraw(beginSketchTool(newSession(), "rectangle"), [0, 0]),
      [2, 1],
    );
  /** The session's Fillet edit tool on two lines, committed (one authored action). */
  const filletThroughSession = (
    session: SketchSessionState,
    first: SketchEntityId,
    second: SketchEntityId,
  ) => {
    const targetOf = (entityId: SketchEntityId) =>
      session.definition.entities.find(
        (entity) => entity.entityId === entityId,
      )!.target;
    let next = beginSketchTool(session, "sketchFillet");
    next = selectSketchEditToolTarget(next, targetOf(first));
    next = selectSketchEditToolTarget(next, targetOf(second));
    next = patchSketchEditToolValue(next, { value: 0.2 });
    return patchSketchEditToolValue(next, {
      intent: "commitSketchEditOperator",
    });
  };
  test("a native Fillet commits two tangent constraints (arc ↔ each trimmed line) and the two arc-endpoint dimensions, no radius dimension; all are satisfied after Finish; Undo removes every one of them in one step", async () => {
    const drawn = rectangle();
    const lines = drawn.definition.entities
      .filter((entity) => entity.kind === "lineSegment")
      .map((entity) => entity.entityId);
    const filleted = filletThroughSession(drawn, lines[0]!, lines[1]!);
    const definition = filleted.definition;
    const arc = definition.entities.find((entity) => entity.kind === "arc");
    if (arc?.kind !== "arc") throw new Error("no fillet arc");
    const before = new Set<string>([
      ...drawn.definition.constraintIds,
      ...drawn.definition.dimensionIds,
    ]);
    const addedConstraints = definition.constraints.filter(
      (constraint) => !before.has(constraint.constraintId),
    );
    const addedDimensions = definition.dimensions.filter(
      (dimension) => !before.has(dimension.dimensionId),
    );
    expect(
      addedConstraints.map((constraint) =>
        constraint.kind === "tangent"
          ? [constraint.kind, ...constraint.entityIds]
          : [constraint.kind],
      ),
    ).toEqual([
      ["tangent", arc.entityId, lines[0]],
      ["tangent", arc.entityId, lines[1]],
    ]);
    expect(
      addedDimensions.map((dimension) =>
        dimension.kind === "arcStartPointCoincident" ||
        dimension.kind === "arcEndPointCoincident"
          ? [dimension.kind, dimension.entityId, dimension.pointId]
          : [dimension.kind],
      ),
    ).toEqual([
      ["arcStartPointCoincident", arc.entityId, arc.startPointId],
      ["arcEndPointCoincident", arc.entityId, arc.endPointId],
    ]);
    expect(validateSketchDefinition(definition).success).toBe(true);

    // Finish with the production solver (the mock solver does not evaluate
    // local tangency or arc-endpoint dimensions, for any arc tool).
    const { response, record } = await commitToMockKernel(
      definition,
      new SketchConstraintSolverAdapter({
        revisionId: null,
        neutralCurveQueries:
          createCertifiedNeutralCurveQueryCapabilityForTest(),
      }),
    );
    expect(response.revisionState.kind, "Finish is accepted.").toBe("accepted");
    if (!record) throw new Error("no saved record");
    expect(record.solvedSnapshot.status).toEqual({
      solveState: "solved",
      constraintState: "wellConstrained",
    });
    expect(
      record.solvedSnapshot.constraintStatuses
        .filter((status) =>
          addedConstraints.some(
            (constraint) => constraint.constraintId === status.constraintId,
          ),
        )
        .map((status) => status.status),
      "The Fillet's tangencies are satisfied after Finish.",
    ).toEqual(["satisfied", "satisfied"]);
    expect(
      record.solvedSnapshot.dimensionStatuses
        .filter((status) =>
          addedDimensions.some(
            (dimension) => dimension.dimensionId === status.dimensionId,
          ),
        )
        .map((status) => status.status),
      "The Fillet's arc-endpoint dimensions are satisfied after Finish.",
    ).toEqual(["driving", "driving"]);

    const identity: Parameters<AuthoredActionHistory["commit"]>[0] = {
      actorId: "actor-g7f",
      documentId: "doc-g7f" as never,
      context: { kind: "sketch", sketchId: "sketch-g7f" as never },
    };
    const state = (value: SketchDefinition): AuthoredActionState =>
      ({
        documentId: "doc-g7f",
        context: { kind: "sketch", sketchId: "sketch-g7f" },
        data: {
          sketchId: "sketch-g7f",
          label: "Sketch",
          plane: drawn.plane,
          definition: value,
        },
      }) as unknown as AuthoredActionState;
    const history = new AuthoredActionHistory();
    const start = state(drawn.definition);
    const applied = history.commit(
      identity,
      start,
      state(definition),
      "Fillet",
      start,
    );
    if (applied.status !== "applied") throw new Error("not applied");
    const undone = history.undo(identity, applied.state);
    if (undone.status !== "applied") throw new Error("not undone");
    const restored = (undone.state.data as { definition: SketchDefinition })
      .definition;
    expect(
      restored,
      "One Undo restores the pre-Fillet definition: no tangent constraint, no arc-endpoint dimension, no arc.",
    ).toEqual(drawn.definition);
    expect(
      restored.constraints.some((constraint) => constraint.kind === "tangent"),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T08b-g7b (logic lane). Seam: native session authoring → live solve →
// the real derivation boundary (publish + regions) and the mock-kernel
// commit. [TECH] G16′ (U-G9): every solve-frame offset failure is
// relationship-scoped: the sketch stays solved (its status reflects only its
// own requirements), the relationship gets one source-linked diagnostic, its
// outputs are non-accepted and held, and unrelated regions are derived.
// ---------------------------------------------------------------------------

/** A unit rectangle far from every offset row (its region is "unrelated"). */
function withUnrelatedRectangle(session: SketchSessionState) {
  const before = new Set(session.definition.entityIds);
  const drawn = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "rectangle"), [10, 10]),
    [11, 11],
  );
  return {
    session: drawn,
    lines: drawn.definition.entities
      .filter((entity) => !before.has(entity.entityId))
      .map((entity) => entity.entityId),
  };
}

/** The Offset tool's relationship authored on `seeds` at signed `distance` (one action). */
function withOffsetRelationship(
  definition: SketchDefinition,
  seeds: readonly SketchEntityId[],
  distance: number,
  sequence = 700,
): SketchDefinition {
  const result = createSketchOffsetDerivationContribution({
    definition,
    entityIds: seeds,
    distance: Math.abs(distance),
    side: distance >= 0 ? "left" : "right",
    sequence,
    factories: createSessionCommitFactories(sequence, "sketch_g7b" as never),
    modelingTolerance: 1e-3,
  });
  if (!result.valid || !result.contribution)
    throw new Error(`offset: ${result.message}`);
  const contribution = result.contribution;
  const points = [...definition.points, ...contribution.points];
  const entities = [...definition.entities, ...contribution.entities];
  const relationships = [
    ...(definition.derivedRelationships ?? []),
    ...(contribution.derivedRelationships ?? []),
  ];
  return {
    ...definition,
    pointIds: points.map((point) => point.pointId),
    points,
    entityIds: entities.map((entity) => entity.entityId),
    entities,
    derivedRelationships: relationships,
  };
}

/** An authored distance edit of one offset relationship (the Offset value field). */
function withOffsetDistance(
  definition: SketchDefinition,
  derivationId: string,
  distance: number,
): SketchDefinition {
  return {
    ...definition,
    derivedRelationships: definition.derivedRelationships!.map(
      (relationship) =>
        relationship.derivationId === derivationId &&
        relationship.kind === "offset"
          ? { ...relationship, distance }
          : relationship,
    ),
  };
}

/** Rectangle (0,0)–(2,1) with one native Fillet r = 0.2 (the session's Fillet tool), plus the unrelated rectangle. */
function nativeFilletedRectangle() {
  const session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(newSession(), "rectangle"), [0, 0]),
    [2, 1],
  );
  const lines = session.definition.entities
    .filter((entity) => entity.kind === "lineSegment")
    .map((entity) => entity.entityId);
  const targetOf = (entityId: SketchEntityId) =>
    session.definition.entities.find((entity) => entity.entityId === entityId)!
      .target;
  let filleted = beginSketchTool(session, "sketchFillet");
  filleted = selectSketchEditToolTarget(filleted, targetOf(lines[0]!));
  filleted = selectSketchEditToolTarget(filleted, targetOf(lines[1]!));
  filleted = patchSketchEditToolValue(filleted, { value: 0.2 });
  filleted = patchSketchEditToolValue(filleted, {
    intent: "commitSketchEditOperator",
  });
  const arc = filleted.definition.entities.find(
    (entity) => entity.kind === "arc",
  );
  if (!arc) throw new Error("no fillet arc");
  const seeds = filleted.definition.entities
    .filter((entity) => entity.kind === "lineSegment" || entity.kind === "arc")
    .map((entity) => entity.entityId);
  return {
    ...withUnrelatedRectangle(filleted),
    seeds,
    line: lines[0]!,
    arc: arc.entityId,
  };
}

/** A native spline (3 fit points) closed by a native line snapped at both ends, plus the unrelated rectangle. */
function nativeSplineLoop(
  fit: readonly (readonly [number, number])[],
  closing: readonly [readonly [number, number], readonly [number, number]],
) {
  const loop = drawLine(drawSpline(newSession(), fit), closing[0], closing[1]);
  const seeds = loop.definition.entities
    .filter((entity) => entity.kind !== "point")
    .map((entity) => entity.entityId);
  return { ...withUnrelatedRectangle(loop), seeds };
}

const offsetIdsOf = (definition: SketchDefinition) =>
  (definition.derivedRelationships ?? []).flatMap((relationship) =>
    relationship.kind === "offset" ? [relationship.derivationId] : [],
  );

/** Every output entity of one offset relationship. */
function outputEntityIds(definition: SketchDefinition, derivationId: string) {
  const relationship = definition.derivedRelationships!.find(
    (candidate) => candidate.derivationId === derivationId,
  );
  if (relationship?.kind !== "offset") throw new Error("no offset");
  return [
    ...relationship.outputs,
    ...relationship.jointOutputs,
    ...relationship.piecewiseCubicOutputs,
  ].map((output) => output.outputEntityId);
}

/** Every driven output point of one offset relationship. */
function outputPointIds(definition: SketchDefinition, derivationId: string) {
  const relationship = definition.derivedRelationships!.find(
    (candidate) => candidate.derivationId === derivationId,
  );
  if (relationship?.kind !== "offset") throw new Error("no offset");
  return [
    ...relationship.outputs.flatMap((output) => output.outputPointIds),
    ...relationship.jointOutputs.flatMap((output) => [
      output.centerPointId,
      output.startPointId,
      output.endPointId,
    ]),
    ...relationship.piecewiseCubicOutputs.flatMap((output) => [
      output.startPointId,
      output.endPointId,
    ]),
  ];
}

const positionsOf = (snapshot: SolvedSketchSnapshot) =>
  new Map(
    snapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition]),
  );

/** Whether a derived region is bounded exactly by the unrelated rectangle's lines. */
const isUnrelatedRegion =
  (lines: readonly SketchEntityId[]) => (region: RegionRecord) => {
    const sources = new Set(
      region.loops.flatMap((loop) =>
        loop.segments.map((segment) =>
          segment.branch.source.kind === "entity"
            ? segment.branch.source.entityId
            : null,
        ),
      ),
    );
    return (
      region.loops.length === 1 &&
      sources.size === lines.length &&
      lines.every((line) => sources.has(line))
    );
  };

/**
 * The U-G9 row contract on one settled live round: the sketch is solved,
 * the failing relationship has exactly one source-linked failed diagnostic
 * with `code` (publication and session validity; none in the snapshot), its
 * outputs are non-accepted, every other relationship certifies, and the
 * unrelated rectangle's region is derived.
 */
async function expectScopedFailure(input: {
  readonly session: SketchSessionState;
  readonly failing: string;
  readonly code: string;
  readonly seed: SketchEntityId;
  readonly unrelated: readonly SketchEntityId[];
}) {
  const { session, failing, code, seed, unrelated } = input;
  const live = session.liveSolve!;
  expect(live.solvedSnapshot.status, "the sketch stays solved").toEqual({
    solveState: "solved",
    constraintState: expect.any(String),
  });
  expect(live.accepted).toBe(true);
  expect(
    live.solvedSnapshot.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error",
    ),
    "an accepted solve never carries the relationship's failure (G16)",
  ).toEqual([]);
  const { session: settled, response } = await liveRound(session);
  const failed = response.offsetPublications.find(
    (publication) => publication.derivationId === failing,
  );
  expect(
    failed?.status,
    `${failing}: ${failed?.diagnostic?.message ?? "no publication"}`,
  ).toBe("failed");
  expect(failed!.diagnostic).toMatchObject({
    code,
    severity: "error",
    target: { kind: "entity", entityId: seed },
  });
  expect(
    getSketchSessionDerivedValidity(settled).diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === code && diagnostic.message.includes(failing),
    ),
    "the relationship has exactly one diagnostic",
  ).toHaveLength(1);
  const snapshot = settled.liveSolve!.solvedSnapshot;
  expect(snapshot.certifiedOffsetDerivationIds ?? []).not.toContain(failing);
  for (const entityId of outputEntityIds(settled.definition, failing))
    expect(
      isAcceptedOffsetOutput(settled.definition, snapshot, entityId),
      `output ${entityId} is non-accepted`,
    ).toBe(false);
  for (const other of offsetIdsOf(settled.definition).filter(
    (id) => id !== failing,
  ))
    expect(
      response.offsetPublications.find(
        (publication) => publication.derivationId === other,
      )?.status,
      `the other relationship ${other} certifies`,
    ).toBe("certified");
  expect(
    response.regions.filter(isUnrelatedRegion(unrelated)),
    "the unrelated rectangle's region is derived",
  ).toHaveLength(1);
  return { settled, response };
}

describe("T08b-g7b relationship-scoped solve-frame failures ([TECH] G16′, U-G9)", () => {
  test("arc-collapse (native, the T08b-g7-F inward d = 0.15, Δ = 0.2 cell): rect + 1 native fillet, the edit shrinks the fillet below the offset; the sketch stays solved, the offset reports arc-collapse, the outputs are held and non-accepted, the unrelated region is derived", async () => {
    const built = nativeFilletedRectangle();
    const authored = withOffsetRelationship(
      built.session.definition,
      built.seeds,
      0.15,
    );
    const [derivationId] = offsetIdsOf(authored);
    const base = rebuildSessionForDefinition(built.session, {
      definition: authored,
    });
    const baseRound = await liveRound(base);
    expect(
      baseRound.response.offsetPublications.map((item) => item.status),
      "premise: the unedited offset certifies",
    ).toEqual(["certified"]);
    const edited = rebuildSessionForDefinition(baseRound.session, {
      definition: withLineLength(baseRound.session.definition, built.line, 0.2),
    });
    const before = positionsOf(baseRound.session.liveSolve!.solvedSnapshot);
    const after = positionsOf(edited.liveSolve!.solvedSnapshot);
    for (const pointId of outputPointIds(authored, derivationId!))
      expect(after.get(pointId), `${pointId} is held`).toEqual(
        before.get(pointId),
      );
    await expectScopedFailure({
      session: edited,
      failing: derivationId!,
      code: OFFSET_DIAGNOSTIC_CODES.arcCollapse,
      seed: built.arc,
      unrelated: built.lines,
    });
  }, 120_000);

  test("arc-collapse at a large inward d (native): an authored distance edit 0.1 → 0.5 on the rect + 1 native fillet; Finish, save, reopen and Undo give equivalent diagnostics", async () => {
    const built = nativeFilletedRectangle();
    const authored = withOffsetRelationship(
      built.session.definition,
      built.seeds,
      0.1,
    );
    const [derivationId] = offsetIdsOf(authored);
    const broken = withOffsetDistance(authored, derivationId!, 0.5);
    await expectScopedFailure({
      session: rebuildSessionForDefinition(built.session, {
        definition: broken,
      }),
      failing: derivationId!,
      code: OFFSET_DIAGNOSTIC_CODES.arcCollapse,
      seed: built.arc,
      unrelated: built.lines,
    });

    const production = () =>
      new SketchConstraintSolverAdapter({
        revisionId: null,
        neutralCurveQueries:
          createCertifiedNeutralCurveQueryCapabilityForTest(),
      });
    const { response, record } = await commitToMockKernel(broken, production());
    expect(response.revisionState.kind, "Finish is accepted").toBe("accepted");
    if (!record) throw new Error("no saved record");
    expect(validateSketchRecord(record).success).toBe(true);
    expect(record.solvedSnapshot.status.solveState).toBe("solved");
    expect(
      record.derivedValidity.state,
      "a relationship-scoped failure never changes the sketch's validity (G5/G16)",
    ).toBe("current");
    expect(
      record.derivedValidity.diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => diagnostic.code),
      "the saved record carries the relationship's one diagnostic",
    ).toEqual([OFFSET_DIAGNOSTIC_CODES.arcCollapse]);
    expect(
      record.regions.filter(isUnrelatedRegion(built.lines)),
      "the unrelated region is saved",
    ).toHaveLength(1);
    const reopened = normalizeSketchDefinition(
      JSON.parse(JSON.stringify(record.definition)),
    );
    const again = await commitToMockKernel(reopened, production());
    expect(
      again.record?.derivedValidity,
      "save and reopen give equivalent diagnostics",
    ).toEqual(record.derivedValidity);

    const identity: Parameters<AuthoredActionHistory["commit"]>[0] = {
      actorId: "actor-g7b",
      documentId: "doc-g7b" as never,
      context: { kind: "sketch", sketchId: "sketch-g7b" as never },
    };
    const state = (definition: SketchDefinition): AuthoredActionState =>
      ({
        documentId: "doc-g7b",
        context: { kind: "sketch", sketchId: "sketch-g7b" },
        data: {
          sketchId: "sketch-g7b",
          label: "Sketch",
          plane: built.session.plane,
          definition,
        },
      }) as unknown as AuthoredActionState;
    const history = new AuthoredActionHistory();
    const start = state(authored);
    const applied = history.commit(
      identity,
      start,
      state(broken),
      "Offset distance",
      start,
    );
    if (applied.status !== "applied") throw new Error("not applied");
    const undone = history.undo(identity, applied.state);
    if (undone.status !== "applied") throw new Error("not undone");
    const restored = (undone.state.data as { definition: SketchDefinition })
      .definition;
    expect(
      (await commitToMockKernel(restored, production())).record?.derivedValidity
        .diagnostics,
      "Undo restores the certifying offset: no diagnostic",
    ).toEqual([]);
    const redone = history.redo(identity, undone.state);
    if (redone.status !== "applied") throw new Error("not redone");
    expect(
      (
        await commitToMockKernel(
          (redone.state.data as { definition: SketchDefinition }).definition,
          production(),
        )
      ).record?.derivedValidity,
      "Redo gives the same relationship-scoped diagnostics again",
    ).toEqual(record.derivedValidity);
  }, 180_000);

  test("owner spline-fit-failure on a cusp (native SL lean, inward d = 0.01 → 0.1)", async () => {
    const built = nativeSplineLoop(
      [
        [0, 0],
        [-0.4, 0.9],
        [2, 0],
      ],
      [
        [2, 0],
        [0, 0],
      ],
    );
    const authored = withOffsetRelationship(
      built.session.definition,
      built.seeds,
      -0.01,
    );
    const [derivationId] = offsetIdsOf(authored);
    await expectScopedFailure({
      session: rebuildSessionForDefinition(built.session, {
        definition: withOffsetDistance(authored, derivationId!, -0.1),
      }),
      failing: derivationId!,
      code: OFFSET_DIAGNOSTIC_CODES.splineFitFailure,
      seed: built.seeds[0]!,
      unrelated: built.lines,
    });
  }, 120_000);

  test("Newton non-convergence (native SL h0.4 5pt row, inward d = 0.01 → 0.2: no converged transverse trim)", async () => {
    const spline = drawSpline(newSession(), [
      [0, 0],
      [0.5, 0.3],
      [1, 0.4],
    ]);
    const opened = drawLine(spline, [2, 0], [0, 0]);
    const seeds = opened.definition.entities
      .filter((entity) => entity.kind !== "point")
      .map((entity) => entity.entityId);
    const built = withUnrelatedRectangle(opened);
    const authored = withOffsetRelationship(
      built.session.definition,
      seeds,
      -0.01,
    );
    const [derivationId] = offsetIdsOf(authored);
    await expectScopedFailure({
      session: rebuildSessionForDefinition(built.session, {
        definition: withOffsetDistance(authored, derivationId!, -0.2),
      }),
      failing: derivationId!,
      code: OFFSET_DIAGNOSTIC_CODES.jointUnsatisfied,
      seed: expect.any(String) as never,
      unrelated: built.lines,
    });
  }, 120_000);

  test("topology change after a fit-point insert (native spline offset) and unsupported seed (the seed deleted): each scoped to its relationship", async () => {
    const { committed, seed } = offsetSplineSession();
    const built = withUnrelatedRectangle(committed);
    const [derivationId] = offsetIdsOf(built.session.definition);
    await expectScopedFailure({
      session: rebuildSessionForDefinition(built.session, {
        definition: withInsertedSeedOccurrence(built.session.definition, seed),
      }),
      failing: derivationId!,
      code: OFFSET_DIAGNOSTIC_CODES.topologyChanged,
      seed,
      unrelated: built.lines,
    });
    const seedEntity = built.session.definition.entities.find(
      (entity) => entity.entityId === seed,
    )!;
    await expectScopedFailure({
      session: deleteSelectedSketchGeometry(built.session, [seedEntity.target]),
      failing: derivationId!,
      code: OFFSET_DIAGNOSTIC_CODES.unsupportedSeed,
      seed,
      unrelated: built.lines,
    });
  }, 120_000);

  test("two offsets in one sketch, one failing (an edit to 0.5 collapses it): the other certifies and the unrelated region is derived", async () => {
    const built = nativeFilletedRectangle();
    const first = withOffsetRelationship(
      built.session.definition,
      built.seeds,
      0.1,
      700,
    );
    const both = withOffsetRelationship(first, built.seeds, 0.05, 710);
    const [healthy, failing] = offsetIdsOf(both);
    await expectScopedFailure({
      session: rebuildSessionForDefinition(built.session, {
        definition: withOffsetDistance(both, failing!, 0.5),
      }),
      failing: failing!,
      code: OFFSET_DIAGNOSTIC_CODES.arcCollapse,
      seed: built.arc,
      unrelated: built.lines,
    });
    expect(healthy).toBeDefined();
  }, 180_000);

  test("a requirement on a failed offset's output is blocked ([TECH] G16″), never silently satisfied or dropped: status blocked with a targeted diagnostic, the sketch stays solved and the unrelated region is derived, the held output does not drive the rest; when the offset recovers the requirement solves again; Finish, save and reopen are equal", async () => {
    const built = nativeFilletedRectangle();
    const authored = withOffsetRelationship(
      built.session.definition,
      built.seeds,
      0.1,
    );
    const [derivationId] = offsetIdsOf(authored);
    const healthy = rebuildSessionForDefinition(built.session, {
      definition: authored,
    });
    const outputPoint = outputPointIds(authored, derivationId!)[0]!;
    const held = positionsOf(healthy.liveSolve!.solvedSnapshot).get(
      outputPoint,
    )!;
    // An unrelated rectangle corner is pinned to the offset output point
    // (a distance dimension of 0 between them would be the same seam).
    const corner = built.session.definition.points.find(
      (point) =>
        point.position[0] === 10 &&
        point.position[1] === 10 &&
        built.session.definition.entities.some(
          (entity) =>
            entity.kind === "lineSegment" &&
            built.lines.includes(entity.entityId) &&
            (entity.startPointId === point.pointId ||
              entity.endPointId === point.pointId),
        ),
    )!;
    const requirement = {
      dimensionId: "dimension_g7b_on_output",
      kind: "distance",
      label: "Output to unrelated corner",
      pointIds: [outputPoint, corner.pointId],
      axis: "horizontal",
      value: 10 - held[0],
    } as unknown as SketchDefinition["dimensions"][number];
    const withRequirement = (definition: SketchDefinition) => ({
      ...definition,
      dimensionIds: [...definition.dimensionIds, requirement.dimensionId],
      dimensions: [...definition.dimensions, requirement],
    });
    const control = rebuildSessionForDefinition(built.session, {
      definition: withRequirement(authored),
    });
    expect(
      control.liveSolve!.solvedSnapshot.dimensionStatuses.find(
        (status) => status.dimensionId === requirement.dimensionId,
      )?.status,
      "premise: without a failure the requirement is ordinary and satisfied",
    ).toBe("driving");
    expect(control.liveSolve!.solvedSnapshot.status.solveState).toBe("solved");

    const brokenDefinition = withRequirement(
      withOffsetDistance(authored, derivationId!, 0.5),
    );
    const broken = rebuildSessionForDefinition(built.session, {
      definition: brokenDefinition,
    });
    const snapshot = broken.liveSolve!.solvedSnapshot;
    expect(
      snapshot.dimensionStatuses.find(
        (status) => status.dimensionId === requirement.dimensionId,
      )?.status,
      "the requirement is reported blocked",
    ).toBe("blocked");
    expect(
      snapshot.diagnostics.filter(
        (diagnostic) => diagnostic.code === OFFSET_REQUIREMENT_BLOCKED,
      ),
    ).toEqual([
      expect.objectContaining({
        severity: "warning",
        target: { kind: "dimension", dimensionId: requirement.dimensionId },
        message: expect.stringContaining(derivationId!),
      }),
    ]);
    expect(
      snapshot.status.solveState,
      "a blocked requirement does not count against the sketch's status",
    ).toBe("solved");
    const positions = positionsOf(snapshot);
    expect(positions.get(outputPoint), "the output is held").toEqual(held);
    expect(
      positions.get(corner.pointId),
      "the held output does not drive the unrelated corner",
    ).toEqual([10, 10]);
    // The relationship's own failure, the non-accepted outputs and the
    // unrelated region: the full U-G9 contract.
    await expectScopedFailure({
      session: broken,
      failing: derivationId!,
      code: OFFSET_DIAGNOSTIC_CODES.arcCollapse,
      seed: built.arc,
      unrelated: built.lines,
    });

    const recovered = rebuildSessionForDefinition(broken, {
      definition: withRequirement(authored),
    });
    expect(
      recovered.liveSolve!.solvedSnapshot.dimensionStatuses.find(
        (status) => status.dimensionId === requirement.dimensionId,
      )?.status,
      "when the offset recovers, the requirement solves again",
    ).toBe("driving");
    expect(
      recovered.liveSolve!.solvedSnapshot.diagnostics.filter(
        (diagnostic) => diagnostic.code === OFFSET_REQUIREMENT_BLOCKED,
      ),
    ).toEqual([]);
    expect(
      (await liveRound(recovered)).response.offsetPublications.map(
        (publication) => publication.status,
      ),
    ).toEqual(["certified"]);

    const production = () =>
      new SketchConstraintSolverAdapter({
        revisionId: null,
        neutralCurveQueries:
          createCertifiedNeutralCurveQueryCapabilityForTest(),
      });
    const { response, record } = await commitToMockKernel(
      brokenDefinition,
      production(),
    );
    expect(response.revisionState.kind).toBe("accepted");
    if (!record) throw new Error("no saved record");
    expect(validateSketchRecord(record).success).toBe(true);
    expect(record.solvedSnapshot.status.solveState).toBe("solved");
    expect(
      record.solvedSnapshot.dimensionStatuses.find(
        (status) => status.dimensionId === requirement.dimensionId,
      )?.status,
      "the saved record keeps the blocked status",
    ).toBe("blocked");
    expect(record.derivedValidity.state).toBe("current");
    expect(record.regions.filter(isUnrelatedRegion(built.lines))).toHaveLength(
      1,
    );
    expect(
      normalizeSolvedSketchSnapshot(
        JSON.parse(JSON.stringify(record.solvedSnapshot)),
      ),
      "a persisted blocked status round-trips",
    ).toEqual(record.solvedSnapshot);
    const reopened = normalizeSketchDefinition(
      JSON.parse(JSON.stringify(record.definition)),
    );
    const again = await commitToMockKernel(reopened, production());
    expect(again.record?.solvedSnapshot.dimensionStatuses).toEqual(
      record.solvedSnapshot.dimensionStatuses,
    );
    expect(
      again.record?.derivedValidity,
      "reopen gives equal diagnostics",
    ).toEqual(record.derivedValidity);
  }, 180_000);

  test("a point-on-shell requirement on a failed relationship (fit point inserted into the seed) is blocked instead of making the whole loss unbounded", () => {
    const { committed, seed } = offsetSplineSession();
    const built = withUnrelatedRectangle(committed);
    const shell = built.session.definition.entities.find(
      (entity) => entity.kind === "derivedPiecewiseCubic",
    )!;
    const free = drawLine(built.session, [0.5, 2], [1, 3]);
    const line = free.definition.entities.at(-1)!;
    if (line.kind !== "lineSegment") throw new Error("line");
    const onShell = {
      constraintId: "constraint_g7b_on_shell",
      kind: "pointOnCurve",
      label: "On shell",
      point: { kind: "localPoint", pointId: line.startPointId },
      curve: { kind: "localEntity", entityId: shell.entityId },
    } as unknown as SketchDefinition["constraints"][number];
    const definition = withInsertedSeedOccurrence(
      {
        ...free.definition,
        constraintIds: [...free.definition.constraintIds, onShell.constraintId],
        constraints: [...free.definition.constraints, onShell],
      },
      seed,
    );
    const result = solve(definition);
    expect(
      result.solvedSnapshot.constraintStatuses.find(
        (status) => status.constraintId === onShell.constraintId,
      )?.status,
    ).toBe("blocked");
    expect(
      result.solvedSnapshot.status.solveState,
      "[TECH] G16″: the blocked requirement does not count",
    ).toBe("solved");
    expect(
      result.solvedSnapshot.diagnostics
        .filter((diagnostic) => diagnostic.code === OFFSET_REQUIREMENT_BLOCKED)
        .map((diagnostic) => diagnostic.target),
    ).toEqual([{ kind: "constraint", constraintId: onShell.constraintId }]);
    expect(
      result.solvedSnapshot.diagnostics.some(
        (diagnostic) => diagnostic.code === "solver-residual-too-large",
      ),
      "the loss stays bounded (no +∞ term)",
    ).toBe(false);
    expect(
      result.solvedSnapshot.solvedPoints.every((point) =>
        point.solvedPosition.every(Number.isFinite),
      ),
    ).toBe(true);
  });

  test("determinism: two failing offsets are scoped in relationship order, the same in the snapshot (unaccepted), in the publications (accepted) and on every re-solve", () => {
    const built = nativeFilletedRectangle();
    const both = withOffsetRelationship(
      withOffsetRelationship(built.session.definition, built.seeds, 0.1, 700),
      built.seeds,
      0.05,
      710,
    );
    const [first, second] = offsetIdsOf(both);
    const broken = withOffsetDistance(
      withOffsetDistance(both, first!, 0.5),
      second!,
      0.6,
    );
    const accepted = solve(broken).solvedSnapshot;
    expect(accepted.status.solveState).toBe("solved");
    const publications = publishSketchOffsets({
      definition: broken,
      solvedSnapshot: accepted,
      modelingTolerance: 1e-3,
      capabilities: capabilities(),
    });
    expect(
      publications.map((item) => [item.derivationId, item.status]),
    ).toEqual([
      [first, "failed"],
      [second, "failed"],
    ]);
    // A requirement on the second offset's output is blocked; a conflicting
    // pair of fixes on the unrelated rectangle makes the solve unaccepted,
    // so the snapshot then reports both relationships, in order.
    const outputPoint = outputPointIds(broken, second!)[0]!;
    const corner = broken.points.find(
      (point) => point.position[0] === 0 && point.position[1] === 1,
    )!;
    const unrelatedCorner = broken.points.find(
      (point) => point.position[0] === 10 && point.position[1] === 10,
    )!;
    const unaccepted: SketchDefinition = {
      ...broken,
      constraintIds: [
        ...broken.constraintIds,
        "constraint_g7b_fix_a",
        "constraint_g7b_fix_b",
      ],
      constraints: [
        ...broken.constraints,
        ...[
          [10, 10],
          [12, 10],
        ].map(
          (position, index) =>
            ({
              constraintId:
                index === 0 ? "constraint_g7b_fix_a" : "constraint_g7b_fix_b",
              kind: "fixPoint",
              label: "Conflicting fix",
              pointId: unrelatedCorner.pointId,
              position,
            }) as unknown as SketchDefinition["constraints"][number],
        ),
      ],
      dimensionIds: [...broken.dimensionIds, "dimension_g7b_order"],
      dimensions: [
        ...broken.dimensions,
        {
          dimensionId: "dimension_g7b_order",
          kind: "distance",
          label: "Order",
          pointIds: [outputPoint, corner.pointId],
          axis: "aligned",
          value: 1,
        } as unknown as SketchDefinition["dimensions"][number],
      ],
    };
    const codes = (snapshot: SolvedSketchSnapshot) =>
      snapshot.diagnostics
        .filter(
          (diagnostic) =>
            diagnostic.severity === "error" ||
            diagnostic.code === OFFSET_REQUIREMENT_BLOCKED,
        )
        .map((diagnostic) => [
          diagnostic.code,
          [first, second].find((id) => diagnostic.message.includes(id!)),
        ]);
    const snapshot = solve(unaccepted).solvedSnapshot;
    expect(codes(snapshot)).toEqual([
      [OFFSET_REQUIREMENT_BLOCKED, second],
      [OFFSET_DIAGNOSTIC_CODES.arcCollapse, first],
      [OFFSET_DIAGNOSTIC_CODES.arcCollapse, second],
    ]);
    for (let round = 0; round < 3; round += 1) {
      expect(solve(unaccepted).solvedSnapshot).toEqual(snapshot);
      expect(solve(broken).solvedSnapshot).toEqual(accepted);
    }
  }, 120_000);

  test("plan or adoption failure (fabricated: the solve frame fails with knot-incidence-unproven on the native spline loop)", async () => {
    const built = nativeSplineLoop(
      [
        [0, 0],
        [1, 0.4],
        [2, 0],
      ],
      [
        [2, 0],
        [0, 0],
      ],
    );
    const authored = withOffsetRelationship(
      built.session.definition,
      built.seeds,
      -0.01,
    );
    const [derivationId] = offsetIdsOf(authored);
    fabricated.planFailure = derivationId!;
    try {
      await expectScopedFailure({
        session: rebuildSessionForDefinition(built.session, {
          definition: authored,
        }),
        failing: derivationId!,
        code: OFFSET_DIAGNOSTIC_CODES.knotIncidenceUnproven,
        seed: built.seeds[0]!,
        unrelated: built.lines,
      });
    } finally {
      fabricated.planFailure = null;
    }
  }, 120_000);

  test("derivative unavailable (fabricated singular pullback, review R1): the requirement on the offset output keeps its real residual and only loses its gradient through the offset, never blocked or forced to 0: met → driving with a targeted warning, solved, certified, unrelated region derived; violated → unsatisfied and the sketch is not solved; recovery solves the requirement", async () => {
    const built = nativeFilletedRectangle();
    const authored = withOffsetRelationship(
      built.session.definition,
      built.seeds,
      0.1,
    );
    const [derivationId] = offsetIdsOf(authored);
    const outputPoint = outputPointIds(authored, derivationId!)[0]!;
    const healthy = solve(authored).solvedSnapshot;
    const at = positionsOf(healthy).get(outputPoint)!;
    // A translation-invariant requirement between the offset output and a
    // source corner: only a shape change (through the pullback) can meet it.
    const corner = authored.points.find(
      (point) => point.position[0] === 0 && point.position[1] === 1,
    )!;
    const requirement = {
      dimensionId: "dimension_g7b_output_corner",
      kind: "distance",
      label: "Output to corner",
      pointIds: [outputPoint, corner.pointId],
      axis: "aligned",
      value: Math.hypot(at[0] - 0, at[1] - 1) + 0.05,
    } as unknown as SketchDefinition["dimensions"][number];
    // The filleted rectangle's width and height dimensions are removed so
    // the requirement is satisfiable by a shape change (the healthy control
    // below solves it).
    const kept = authored.dimensions.filter(
      (dimension) =>
        !(
          dimension.dimensionId.startsWith("dimension_1_width") ||
          dimension.dimensionId.startsWith("dimension_1_height")
        ),
    );
    expect(kept.length, "premise: two rectangle sizes removed").toBe(
      authored.dimensions.length - 2,
    );
    const definition: SketchDefinition = {
      ...authored,
      dimensionIds: [
        ...kept.map((dimension) => dimension.dimensionId),
        requirement.dimensionId,
      ],
      dimensions: [...kept, requirement],
    };
    fabricated.singularPullback = derivationId!;
    try {
      const session = rebuildSessionForDefinition(built.session, {
        definition,
      });
      const snapshot = session.liveSolve!.solvedSnapshot;
      expect(
        snapshot.dimensionStatuses.find(
          (status) => status.dimensionId === requirement.dimensionId,
        )?.status,
        "the real residual is met (through the source corner's own gradient): an ordinary status, never blocked",
      ).toBe("driving");
      expect(
        snapshot.diagnostics.map((diagnostic) => [
          diagnostic.code,
          diagnostic.severity,
          diagnostic.target,
        ]),
        "only the requirement's targeted warning (it names the cause)",
      ).toEqual([
        [
          OFFSET_DIAGNOSTIC_CODES.derivativeUnavailable,
          "warning",
          { kind: "dimension", dimensionId: requirement.dimensionId },
        ],
      ]);
      expect(snapshot.diagnostics[0]!.message).toContain(
        "derivative is unavailable",
      );
      expect(snapshot.diagnostics[0]!.message).toContain(derivationId!);
      expect(snapshot.status.solveState).toBe("solved");
      expect(
        snapshot.offsetFramePlans?.map((plan) => plan.derivationId),
        "the frame itself built: its outputs are valid geometry",
      ).toEqual([derivationId]);
      const { response } = await liveRound(session);
      expect(
        response.offsetPublications.map((item) => item.status),
        "a singular derivative is not a geometry failure: the outputs certify",
      ).toEqual(["certified"]);
      expect(
        response.regions.filter(isUnrelatedRegion(built.lines)),
        "the unrelated rectangle's region is derived",
      ).toHaveLength(1);

      // Violated at the final values: a fix on the output point itself has
      // no gradient left once the pullback is dropped, so its real residual
      // stays and it is reported unsatisfied (never blocked, never 0).
      const fix = {
        constraintId: "constraint_g7b_fix_output",
        kind: "fixPoint",
        label: "Fix output",
        pointId: outputPoint,
        position: [at[0] + 0.05, at[1]],
      } as unknown as SketchDefinition["constraints"][number];
      const violated = rebuildSessionForDefinition(built.session, {
        definition: {
          ...definition,
          constraintIds: [...definition.constraintIds, fix.constraintId],
          constraints: [...definition.constraints, fix],
        },
      }).liveSolve!.solvedSnapshot;
      expect(
        violated.constraintStatuses.find(
          (status) => status.constraintId === fix.constraintId,
        )?.status,
        "the violated requirement keeps its real residual: unsatisfied",
      ).toBe("unsatisfied");
      expect(
        violated.status.solveState,
        "an unsatisfied requirement counts against the sketch",
      ).toBe("partiallySolved");
      expect(
        violated.diagnostics
          .filter(
            (diagnostic) =>
              diagnostic.code === OFFSET_DIAGNOSTIC_CODES.derivativeUnavailable,
          )
          .map((diagnostic) => diagnostic.target),
      ).toContainEqual({
        kind: "constraint",
        constraintId: fix.constraintId,
      });
      expect(
        violated.diagnostics.some(
          (diagnostic) => diagnostic.code === OFFSET_REQUIREMENT_BLOCKED,
        ),
        "never blocked",
      ).toBe(false);
    } finally {
      fabricated.singularPullback = null;
    }
    // A fresh definition object: the evaluation memo (and its per-frame
    // derivative cache) would otherwise replay the fabricated derivative.
    expect(
      solve({ ...definition }).solvedSnapshot.dimensionStatuses.find(
        (status) => status.dimensionId === requirement.dimensionId,
      )?.status,
      "with the derivative available again the requirement solves",
    ).toBe("driving");
  }, 120_000);

  test("drag through a failure and back (U-A): the rest keeps following while the offset is held at the last accepted frame; release publishes failed; dragging back recovers and certifies; the same drag replays identically (no oscillation)", async () => {
    const setup = () => {
      // The native 3-point arch closed by a line, inward d = 0.1; dragging
      // its middle fit point toward the lean cusp row fails the offset's
      // solve frame (owner spline-fit-failure) and dragging back recovers.
      // The unrelated rectangle's constraints put the drag on the
      // interactive solve session.
      const built = nativeSplineLoop(
        [
          [0, 0],
          [1, 0.4],
          [2, 0],
        ],
        [
          [2, 0],
          [0, 0],
        ],
      );
      const offset = withOffsetRelationship(
        built.session.definition,
        built.seeds,
        -0.1,
      );
      const spline = offset.entities.find((entity) => entity.kind === "spline");
      if (spline?.kind !== "spline") throw new Error("spline");
      // Fix the arch's ends (requirements on seeds, not on offset outputs),
      // so the drag reshapes the spline instead of translating the loop.
      const fixes = [0, 2].map((index) => {
        const pointId = spline.pointOccurrences[index]!.pointId;
        return {
          constraintId: `constraint_g7b_fix_${index}`,
          kind: "fixPoint",
          label: `Fix ${index}`,
          pointId,
          position: offset.points.find((point) => point.pointId === pointId)!
            .position,
        } as unknown as SketchDefinition["constraints"][number];
      });
      const authored: SketchDefinition = {
        ...offset,
        constraintIds: [
          ...offset.constraintIds,
          ...fixes.map((fix) => fix.constraintId),
        ],
        constraints: [...offset.constraints, ...fixes],
      };
      return { built, authored, spline };
    };
    const base = setup();
    const run = async ({ built, authored, spline }: typeof base) => {
      const [derivationId] = offsetIdsOf(authored);
      let session = rebuildSessionForDefinition(built.session, {
        definition: authored,
      });
      const middle = authored.points.find(
        (point) => point.pointId === spline.pointOccurrences[1]!.pointId,
      )!;
      const outputs = outputPointIds(authored, derivationId!);
      const frames: {
        status: string | undefined;
        failed: boolean;
        snapshot: SolvedSketchSnapshot;
      }[] = [];
      const settle = async (current: SketchSessionState) =>
        (await liveRound(current)).response.offsetPublications[0]!;
      const along = (t: number): [number, number] => [
        1 - 1.4 * t,
        0.4 + 0.5 * t,
      ];
      session = beginSketchGeometryDrag(session, middle.target, [1, 0.4]);
      for (const t of [0.5, 0.75, 1, 0.75, 0.5, 0]) {
        session = updateSketchGeometryDrag(session, along(t));
        const snapshot = session.liveSolve!.solvedSnapshot;
        frames.push({
          status: session.activeDrag?.status,
          failed: !snapshot.offsetFramePlans?.some(
            (plan) => plan.derivationId === derivationId,
          ),
          snapshot,
        });
        if (t === 1) {
          // Release inside the failure: publish re-evaluates.
          const released = finishSketchGeometryDrag(session, along(t));
          const publication = await settle(released);
          expect(publication).toMatchObject({
            status: "failed",
            diagnostic: { code: OFFSET_DIAGNOSTIC_CODES.splineFitFailure },
          });
          session = beginSketchGeometryDrag(released, middle.target, along(t));
        }
      }
      const released = finishSketchGeometryDrag(session, along(0));
      return { frames, outputs, final: await settle(released), built };
    };
    const first = await run(base);
    expect(
      first.frames.map((frame) => frame.status),
      "every frame follows the drag (none blocked)",
    ).toEqual(Array(6).fill("dragging"));
    for (const frame of first.frames)
      expect(frame.snapshot.status.solveState).toBe("solved");
    const failedFrames = first.frames.map((frame) => frame.failed);
    expect(
      failedFrames,
      "premise: the drag passes through a failure and back",
    ).toContain(true);
    expect(failedFrames.at(-1)).toBe(false);
    for (let index = 1; index < first.frames.length; index += 1) {
      if (!first.frames[index]!.failed) continue;
      const previous = positionsOf(first.frames[index - 1]!.snapshot);
      const current = positionsOf(first.frames[index]!.snapshot);
      for (const pointId of first.outputs)
        expect(
          current.get(pointId),
          `frame ${index}: ${pointId} is held at the last accepted frame`,
        ).toEqual(previous.get(pointId));
    }
    expect(first.final.status, "dragging back recovers and certifies").toBe(
      "certified",
    );
    const second = await run(base);
    expect(
      second.frames.map((frame) => [frame.failed, frame.snapshot]),
      "the same drag gives the same scoping and geometry (deterministic, no oscillation)",
    ).toEqual(first.frames.map((frame) => [frame.failed, frame.snapshot]));
  }, 240_000);

  test("review R3 ([TECH] G16‴): G19 non-acceptance follows derived dependents: a transform of a non-accepted offset's outputs is excluded from regions (one targeted diagnostic per copy, naming the offset), refused as a feature input and has non-accepted driven points; a mirror whose axis is a non-accepted output is non-accepted too; with the offset certified every copy is ordinary", async () => {
    const { session, seeds } = rectanglesSession();
    const committed = committedOffsetOnSide(session, seeds, 0.5, "right");
    const { derivationId, outputs } = offsetOutputIds(committed);
    const derive = (
      definition: SketchDefinition,
      operatorKind: "transform" | "mirror",
      entityIds: readonly SketchEntityId[],
    ) => {
      const result = createSketchDerivedTransformContribution({
        definition,
        operatorKind,
        entityIds,
        value: 30,
        sequence: 97,
        factories: createSessionCommitFactories(97, "sketch_draft" as never),
        modelingTolerance: 1e-3,
      });
      const contribution = result.contribution;
      if (!result.valid || !contribution) throw new Error(result.message!);
      const relationship = contribution.derivedRelationships![0]!;
      return {
        definition: {
          ...definition,
          pointIds: [
            ...definition.pointIds,
            ...contribution.points.map((point) => point.pointId),
          ],
          points: [...definition.points, ...contribution.points],
          entityIds: [
            ...definition.entityIds,
            ...contribution.entities.map((entity) => entity.entityId),
          ],
          entities: [...definition.entities, ...contribution.entities],
          derivedRelationships: [
            ...(definition.derivedRelationships ?? []),
            relationship,
          ],
        },
        copies: relationship.outputs.map((output) => output.outputEntityId),
        copyPoints: relationship.outputs.flatMap(
          (output) => output.outputPointIds,
        ),
      };
    };
    // The offset loop (lines and joint arcs) translated by 30: a closed
    // loop of its own, far from everything else.
    const translated = derive(committed.definition, "transform", outputs);
    const withCopy = rebuildSessionForDefinition(committed, {
      definition: translated.definition,
    });
    const { session: certified, response } = await liveRound(withCopy);
    expect(
      response.offsetPublications.map((item) => item.status),
      "premise: the offset certifies",
    ).toEqual(["certified"]);
    expect(
      usesAny(response.regions, translated.copies),
      "certified: the translated loop bounds a region",
    ).toBe(true);
    const certifiedSketch = {
      definition: certified.liveSolve!.definition,
      solvedSnapshot: certified.liveSolve!.solvedSnapshot,
    };
    for (const copy of translated.copies)
      expect(
        nonAcceptedOffsetFeatureInputMessage(
          certifiedSketch,
          copy,
          "a sweep path",
        ),
        `certified: ${copy} is an ordinary feature input`,
      ).toBeNull();

    // Not certified (a failed publication): every copy is non-accepted.
    const live = withCopy.liveSolve!;
    expect(live.solvedSnapshot.certifiedOffsetDerivationIds).toBeUndefined();
    const deriver = createSketchArrangementDeriver(
      createCertifiedNeutralCurveQueryCapabilityForTest(),
    );
    const failed = await deriver.derive({
      documentId: "doc_workspace" as never,
      revisionId: "rev_0001" as never,
      sketchId: "sketch_g5b" as never,
      definition: live.definition,
      solvedSnapshot: live.solvedSnapshot,
      projectedReferences: [],
      modelingTolerance: 1e-3,
      ...offsetArrangementInput(live.definition, live.solvedSnapshot, [
        { derivationId, status: "failed" },
      ] as readonly SketchOffsetPublicationRecord[]),
    });
    expect(
      usesAny(failed.regions, [...outputs, ...translated.copies]),
      "failed: neither the offset's outputs nor their copies bound a region",
    ).toBe(false);
    const excluded = failed.diagnostics.filter(
      (diagnostic) =>
        diagnostic.target?.kind === "entity" &&
        translated.copies.includes(diagnostic.target.entityId),
    );
    expect(
      excluded
        .map((diagnostic) =>
          diagnostic.target?.kind === "entity"
            ? diagnostic.target.entityId
            : null,
        )
        .sort(),
      "failed: exactly one targeted exclusion per copy",
    ).toEqual([...translated.copies].sort());
    for (const diagnostic of excluded) {
      expect(diagnostic.code).toBe("region-derived-unpublished");
      expect(diagnostic.message).toContain(derivationId);
    }
    const failedSketch = {
      definition: live.definition,
      solvedSnapshot: live.solvedSnapshot,
    };
    for (const copy of translated.copies)
      expect(
        nonAcceptedOffsetFeatureInputMessage(
          failedSketch,
          copy,
          "a sweep path",
        ),
        `failed: ${copy} is refused as a feature input, naming the offset`,
      ).toBe(
        `Sketch entity ${copy} is an output of offset relationship ${derivationId}, which is not certified, so it cannot be used as a sweep path.`,
      );
    const points = nonAcceptedOffsetOutputPoints(
      live.definition,
      live.solvedSnapshot,
    );
    for (const pointId of translated.copyPoints)
      expect(points.get(pointId), `failed: ${pointId} is non-accepted`).toEqual(
        { derivationId },
      );

    // A mirror of the far rectangle across one of the offset's line outputs.
    const axis = outputs.find(
      (entityId) =>
        committed.definition.entities.find(
          (entity) => entity.entityId === entityId,
        )?.kind === "lineSegment",
    )!;
    const farLines = committed.definition.entities.flatMap((entity) =>
      entity.kind === "lineSegment" &&
      !seeds.includes(entity.entityId) &&
      !outputs.includes(entity.entityId)
        ? [entity.entityId]
        : [],
    );
    expect(farLines, "premise: the far rectangle").toHaveLength(4);
    const mirrored = derive(committed.definition, "mirror", [
      ...farLines,
      axis,
    ]);
    const mirrorSession = rebuildSessionForDefinition(committed, {
      definition: mirrored.definition,
    });
    const mirrorSketch = {
      definition: mirrorSession.liveSolve!.definition,
      solvedSnapshot: mirrorSession.liveSolve!.solvedSnapshot,
    };
    for (const copy of mirrored.copies)
      expect(
        isAcceptedOffsetOutput(
          mirrorSketch.definition,
          mirrorSketch.solvedSnapshot,
          copy,
        ),
        `${copy}: mirrored across a non-accepted axis`,
      ).toBe(false);
    for (const line of farLines)
      expect(
        isAcceptedOffsetOutput(
          mirrorSketch.definition,
          mirrorSketch.solvedSnapshot,
          line,
        ),
        `${line}: the mirror's seed itself is ordinary`,
      ).toBe(true);
    const { session: mirrorCertified } = await liveRound(mirrorSession);
    for (const copy of mirrored.copies)
      expect(
        isAcceptedOffsetOutput(
          mirrorCertified.liveSolve!.definition,
          mirrorCertified.liveSolve!.solvedSnapshot,
          copy,
        ),
        `${copy}: accepted once the axis's offset certifies`,
      ).toBe(true);
  }, 600_000);

  // T08b-g7b final review F1 ([TECH] G16⁗, barrier-shell): the
  // point-on-shell record holds its requirement blocked for the whole solve
  // while its offset is in the blocked set, also where the offset builds
  // again, so the solve re-solves once from there instead of being trapped
  // at a barrier. P must start far from the shell (near it the jump is too
  // small to trap the solve).
  test("final review F1 ([TECH] G16⁗): a spline offset failing at the start (middle fit point at the lean cusp) is pulled back out by a fixPoint; P 3 units off the shell, on it, is solved (core solve and live session)", () => {
    // The drag row's native arch closed by a line, inward d = 0.1.
    const loop = drawLine(
      drawSpline(newSession(), [
        [0, 0],
        [1, 0.4],
        [2, 0],
      ]),
      [2, 0],
      [0, 0],
    );
    const seeds = loop.definition.entities
      .filter((entity) => entity.kind !== "point")
      .map((entity) => entity.entityId);
    const withP = drawLine(loop, [1, 3], [1.5, 6]);
    const free = withP.definition.entities.at(-1)!;
    if (free.kind !== "lineSegment") throw new Error("free line");
    const offset = withOffsetRelationship(withP.definition, seeds, -0.1);
    const [derivationId] = offsetIdsOf(offset);
    const spline = offset.entities.find((entity) => entity.kind === "spline");
    if (spline?.kind !== "spline") throw new Error("spline");
    const shell = offset.entities.find(
      (entity) => entity.kind === "derivedPiecewiseCubic",
    )!;
    const middleId = spline.pointOccurrences[1]!.pointId;
    const constraints = [
      ...[0, 2].map((index) => {
        const pointId = spline.pointOccurrences[index]!.pointId;
        return {
          constraintId: `constraint_g7b_fix_${index}`,
          kind: "fixPoint",
          label: `Fix ${index}`,
          pointId,
          position: offset.points.find((point) => point.pointId === pointId)!
            .position,
        };
      }),
      {
        constraintId: "constraint_g7b_fix_middle",
        kind: "fixPoint",
        label: "Fix middle",
        pointId: middleId,
        position: [1, 0.4],
      },
      {
        constraintId: "constraint_g7b_on_shell",
        kind: "pointOnCurve",
        label: "On shell",
        point: { kind: "localPoint", pointId: free.startPointId },
        curve: { kind: "localEntity", entityId: shell.entityId },
      },
    ] as unknown as SketchDefinition["constraints"];
    const definition: SketchDefinition = {
      ...offset,
      points: offset.points.map((point) =>
        point.pointId === middleId
          ? { ...point, position: [-0.4, 0.9] }
          : point,
      ),
      constraintIds: [
        ...offset.constraintIds,
        ...constraints.map((constraint) => constraint.constraintId),
      ],
      constraints: [...offset.constraints, ...constraints],
    };
    expect(
      evaluateSketchDerivations({
        definition,
        modelingTolerance: 1e-3,
      }).offsetFailures.map((failure) => [
        failure.derivationId,
        failure.diagnostic.code,
      ]),
      "premise: the spline offset fails at the start",
    ).toEqual([[derivationId, "derived-offset-spline-fit-failure"]]);
    const core = solve(definition).solvedSnapshot;
    const live = rebuildSessionForDefinition(withP, { definition }).liveSolve!
      .solvedSnapshot;
    for (const [label, snapshot] of [
      ["core", core],
      ["live", live],
    ] as const) {
      expect(snapshot.status, label).toEqual({
        solveState: "solved",
        constraintState: "wellConstrained",
      });
      expect(
        snapshot.offsetFramePlans?.map((plan) => plan.derivationId),
        `${label}: the offset is rebuilt`,
      ).toEqual([derivationId]);
      const status = (constraintId: string) =>
        snapshot.constraintStatuses.find(
          (candidate) => candidate.constraintId === constraintId,
        )?.status;
      expect(status("constraint_g7b_fix_middle"), label).toBe("satisfied");
      expect(status("constraint_g7b_on_shell"), label).toBe("satisfied");
      expect(
        snapshot.diagnostics.map((diagnostic) => diagnostic.code),
        label,
      ).toEqual([]);
      const positions = positionsOf(snapshot);
      const middle = positions.get(middleId)!;
      expect(
        Math.hypot(middle[0] - 1, middle[1] - 0.4),
        `${label}: the middle fit point is pulled back out`,
      ).toBeLessThan(1e-6);
      expect(
        positions.get(free.startPointId)![1],
        `${label}: P left (1, 3) for the shell`,
      ).toBeLessThan(0.5);
    }
  });
});

// ---------------------------------------------------------------------------
// T10i (C3, T10 review A8): every edit tool gates its whole input set on the
// G19 predicate (with the G16‴ closure) of the session's live solve: a
// non-accepted offset output (failed, pending or unpublished) is refused with
// `edit-input-offset-not-certified`; a certified one is ordinary input.
// C4: a declared coincident join that is blocked fails the chain closed.
// ---------------------------------------------------------------------------

/**
 * The two rectangles plus a short vertical line crossing the inward offset's
 * bottom output (a Split/Trim cutter), the inward 0.5 offset committed, and
 * its certified, failed and pending live states.
 */
let editInputStates: ReturnType<typeof buildEditInputStates> | null = null;
function buildEditInputStates() {
  return (async () => {
    const { session, seeds } = rectanglesSession();
    const before = new Set(session.definition.entityIds);
    const withCutters = drawLine(
      drawLine(session, [2, 0.2], [2, 0.8]),
      [3, 0.2],
      [3, 0.8],
    );
    const cutter = withCutters.definition.entityIds.find(
      (id) => !before.has(id),
    )!;
    // Review R-2: a free horizontal line between the rectangles (an Extend
    // target towards the offset's right output, a Mirror source).
    const beforeFree = new Set(withCutters.definition.entityIds);
    const withCutter = drawLine(withCutters, [5, 1], [6, 1]);
    const free = withCutter.definition.entityIds.find(
      (id) => !beforeFree.has(id),
    )!;
    const far = session.definition.entities
      .filter(
        (entity) =>
          entity.kind === "lineSegment" && !seeds.includes(entity.entityId),
      )
      .map((entity) => entity.entityId);
    const pending = committedOffsetOnSide(withCutter, seeds, 0.5, "left");
    const { derivationId, outputs } = offsetOutputIds(pending);
    const certified = (await liveRound(pending)).session;
    expect(
      certified.liveSolve!.solvedSnapshot.certifiedOffsetDerivationIds,
      "premise: the offset certifies",
    ).toEqual([derivationId]);
    return {
      pending,
      certified,
      failed: failedRound(pending),
      derivationId,
      outputs,
      cutter,
      free,
      far,
    };
  })();
}
const editInputs = () => (editInputStates ??= buildEditInputStates());

const targetOf = (session: SketchSessionState, entityId: SketchEntityId) =>
  session.definition.entities.find((entity) => entity.entityId === entityId)!
    .target;

/** Begins `toolId`, selects `entityIds` in order, sets `value` and commits. */
function runEditTool(
  session: SketchSessionState,
  toolId: Parameters<typeof beginSketchTool>[1],
  entityIds: readonly SketchEntityId[],
  value: number | null,
) {
  let next = beginSketchTool(session, toolId);
  for (const entityId of entityIds)
    next = selectSketchEditToolTarget(next, targetOf(next, entityId));
  if (toolId === "trim" || next.definition !== session.definition) return next;
  if (toolId === "offset") {
    next = patchSketchEditToolValue(next, { value });
    return patchSketchEditToolValue(next, { intent: "commitOffset" });
  }
  if (value !== null) next = patchSketchEditToolValue(next, { value });
  return patchSketchEditToolValue(next, {
    intent: "commitSketchEditOperator",
  });
}

const gateMessage = (entityId: SketchEntityId, derivationId: string) =>
  expect.stringMatching(
    new RegExp(
      `^${NON_ACCEPTED_OFFSET_EDIT_INPUT_CODE}: Sketch entity ${entityId} is an output of offset relationship ${derivationId}, which is not certified, so it cannot be used as `,
    ),
  );

/** Review R-1: while the round is pending the input is "still being checked" (not refused as uncertified). */
const checkingMessage = (entityId: SketchEntityId, derivationId: string) =>
  expect.stringMatching(
    new RegExp(
      `^Sketch entity ${entityId} is an output of offset relationship ${derivationId}, which is still being checked; it can be used as .+ once the check finishes\\.$`,
    ),
  );

describe("T10i edit inputs on non-accepted offset outputs ([TECH] C3, review A8)", () => {
  test.each([
    ["sketchFillet", (o: SketchEntityId[]) => [o[0]!, o[1]!], 0.1],
    ["sketchChamfer", (o: SketchEntityId[]) => [o[0]!, o[1]!], 0.1],
    [
      "sketchExtend",
      (o: SketchEntityId[], far: SketchEntityId[]) => [o[0]!, far[3]!],
      null,
    ],
    [
      "sketchSplit",
      (o: SketchEntityId[], _far: SketchEntityId[], cutter: SketchEntityId) => [
        o[0]!,
        cutter,
      ],
      null,
    ],
    ["sketchSlot", (o: SketchEntityId[]) => [o[0]!], 0.2],
    [
      "sketchMirror",
      (o: SketchEntityId[], far: SketchEntityId[]) => [o[0]!, far[3]!],
      null,
    ],
    ["sketchLinearPattern", (o: SketchEntityId[]) => [o[0]!], 1],
    ["sketchCircularPattern", (o: SketchEntityId[]) => [o[0]!], 0.5],
    ["sketchTransform", (o: SketchEntityId[]) => [o[0]!], 1],
    ["offset", (o: SketchEntityId[]) => [o[0]!], 0.1],
    ["trim", (o: SketchEntityId[]) => [o[0]!], null],
  ] as const)(
    "%s: refused on a failed offset output, still being checked on a pending one (targeted, nothing authored); a certified output is ordinary input",
    async (toolId, inputs, value) => {
      const states = await editInputs();
      const selection = inputs(
        states.outputs,
        states.far,
        states.cutter,
      ) as SketchEntityId[];
      for (const [label, state] of [
        ["failed", states.failed],
        ["pending", states.pending],
      ] as const) {
        const result = runEditTool(state, toolId, selection, value);
        expect(
          result.validationMessage,
          `${toolId} on a ${label} output is ${label === "failed" ? "refused" : "still being checked"}`,
        ).toEqual(
          (label === "failed" ? gateMessage : checkingMessage)(
            states.outputs[0]!,
            states.derivationId,
          ),
        );
        expect(
          result.definition,
          `${toolId} on a ${label} output authors nothing`,
        ).toBe(state.definition);
        expect(result.toolStagedEntities, label).toEqual([]);
        expect(result.activeEditTool?.offsetPublication, label).toBeUndefined();
      }
      // T10g-1/T10g-2: a Trim click (an Extend/Split selection) applies
      // when its exact query result arrives.
      const clicked = runEditTool(states.certified, toolId, selection, value);
      const result =
        toolId === "trim" ||
        toolId === "sketchExtend" ||
        toolId === "sketchSplit"
          ? await completeSketchEditQueriesForTest(clicked)
          : clicked;
      expect(
        result.validationMessage ?? "",
        `${toolId} on a certified output is not refused`,
      ).not.toContain(NON_ACCEPTED_OFFSET_EDIT_INPUT_CODE);
      if (toolId === "offset")
        expect(
          result.activeEditTool?.offsetPublication?.status,
          "offset of a certified output stages its check",
        ).toBe("pending");
      else
        expect(
          result.definition,
          `${toolId} on a certified output edits the sketch`,
        ).not.toBe(states.certified.definition);
    },
    600_000,
  );

  test("G16‴ closure: a mirror copy of the offset's output follows it (refused while the offset failed, ordinary once certified); an unrelated input is never refused", async () => {
    const states = await editInputs();
    const mirrored = runEditTool(
      states.certified,
      "sketchMirror",
      [states.outputs[0]!, states.far[3]!],
      null,
    );
    const relationship = mirrored.definition.derivedRelationships!.find(
      (candidate) => candidate.kind === "mirror",
    );
    if (relationship?.kind !== "mirror") throw new Error("no mirror");
    const copy = relationship.outputs[0]!.outputEntityId;
    const failed = failedRound(mirrored);
    for (const [toolId, value] of [
      ["offset", 0.1],
      ["sketchSlot", 0.2],
    ] as const) {
      expect(
        runEditTool(failed, toolId, [copy], value).validationMessage,
        `${toolId} of the copy of a failed output is refused`,
      ).toEqual(gateMessage(copy, states.derivationId));
      const certified = (await liveRound(mirrored)).session;
      expect(
        runEditTool(certified, toolId, [copy], value).validationMessage ?? "",
        `${toolId} of the copy of a certified output is ordinary`,
      ).not.toContain(NON_ACCEPTED_OFFSET_EDIT_INPUT_CODE);
    }
    const unrelated = runEditTool(
      states.failed,
      "sketchSlot",
      [states.far[0]!],
      0.2,
    );
    expect(unrelated.validationMessage).toBeNull();
    expect(unrelated.definition).not.toBe(states.failed.definition);
  }, 600_000);

  test("async apply: an offset whose seed was certified at staging is re-checked when its publication arrives; a seed failed meanwhile commits nothing and fails the preview with the targeted message", async () => {
    const states = await editInputs();
    const staged = runEditTool(
      states.certified,
      "offset",
      [states.outputs[0]!],
      0.1,
    );
    const publication = staged.activeEditTool!.offsetPublication!;
    expect(publication).toMatchObject({
      status: "pending",
      commitRequested: true,
    });
    const seedFailed = publishSketchLiveRegions(
      staged,
      [],
      [],
      [{ derivationId: states.derivationId, status: "failed" }],
    );
    const applied = completeSketchOffsetPreviewPublication(
      seedFailed,
      publication.derivationId,
      [{ derivationId: publication.derivationId, status: "certified" }],
    );
    expect(applied.definition, "nothing is committed").toBe(
      seedFailed.definition,
    );
    expect(applied.activeEditTool!.offsetPublication).toMatchObject({
      status: "failed",
      commitRequested: false,
      message: gateMessage(states.outputs[0]!, states.derivationId),
    });
    expect(applied.validationMessage).toEqual(
      gateMessage(states.outputs[0]!, states.derivationId),
    );
    const control = completeSketchOffsetPreviewPublication(
      staged,
      publication.derivationId,
      [{ derivationId: publication.derivationId, status: "certified" }],
    );
    expect(
      control.definition.derivedRelationships,
      "control: with the seed still certified the offset commits",
    ).toHaveLength(2);
  }, 600_000);

  test("C4 (g7b A1): a declared coincident join naming an output of a failed offset is blocked, so an offset over it fails closed as a disconnected chain; with the first offset building the same chain certifies", async () => {
    const states = await editInputs();
    // A line from the certified output's end, joined to that driven point
    // by a declared coincident constraint (its own start point, as the
    // spline tool and the importer author a snapped join; the line tool
    // would share the point), then an offset of output + line.
    const output = states.certified.definition.entities.find(
      (entity) => entity.entityId === states.outputs[0],
    );
    if (output?.kind !== "lineSegment") throw new Error("line output");
    const positions = positionsOf(states.certified.liveSolve!.solvedSnapshot);
    const end = positions.get(output.endPointId)!;
    const shared = drawLine(
      states.certified,
      [end[0], end[1]],
      [end[0] + 0.3, end[1] - 0.2],
    ).definition;
    const line = shared.entityIds.find(
      (id) => !states.certified.definition.entityIds.includes(id),
    )!;
    const start = "sketch_point_t10i_join_start" as SketchPointId;
    const join = {
      constraintId: "constraint_t10i_join" as never,
      kind: "coincident" as const,
      label: "T10i declared join",
      pointIds: [start, output.endPointId] as [SketchPointId, SketchPointId],
    };
    const drawn = {
      definition: {
        ...shared,
        pointIds: [...shared.pointIds, start],
        points: [
          ...shared.points,
          {
            ...shared.points[0]!,
            pointId: start,
            target: { ...shared.points[0]!.target, pointId: start },
            label: "T10i join start",
            position: [end[0], end[1]] as [number, number],
          },
        ],
        entities: shared.entities.map((entity) =>
          entity.entityId === line && entity.kind === "lineSegment"
            ? { ...entity, startPointId: start }
            : entity,
        ),
        constraintIds: [...shared.constraintIds, join.constraintId],
        constraints: [...shared.constraints, join],
      } as SketchDefinition,
    };
    const definition = withOffsetRelationship(
      drawn.definition,
      [states.outputs[0]!, line],
      0.05,
      701,
    );
    const second = offsetIdsOf(definition).find(
      (id) => id !== states.derivationId,
    )!;
    const publishOnce = () => {
      const solved = solve(definition);
      return {
        solved,
        publications: publishSketchOffsets({
          definition,
          solvedSnapshot: solved.solvedSnapshot,
          modelingTolerance: 1e-3,
          capabilities: capabilities(),
        }),
      };
    };
    const control = publishOnce();
    expect(
      control.publications.find((item) => item.derivationId === second)?.status,
      "control: the chain over a satisfied join certifies",
    ).toBe("certified");
    fabricated.planFailure = states.derivationId;
    try {
      const { solved, publications } = publishOnce();
      expect(
        solved.solvedSnapshot.constraintStatuses.find(
          (entry) => entry.constraintId === join!.constraintId,
        )?.status,
        "premise: the join is blocked by the failed first offset (G16″)",
      ).toBe("blocked");
      const failed = publications.find((item) => item.derivationId === second);
      expect(failed?.status).toBe("failed");
      expect(failed?.diagnostic).toMatchObject({
        code: OFFSET_DIAGNOSTIC_CODES.disconnectedChain,
        message: expect.stringContaining(
          `The declared coincident join ${join!.constraintId} is blocked in this solve frame, so it does not join the chain.`,
        ),
      });
    } finally {
      fabricated.planFailure = null;
    }
  }, 600_000);
});

// ---------------------------------------------------------------------------
// T10i review fixes: R-2 (every input of the set is gated, not only the
// first), R-1 (pending is "still being checked"; the round re-evaluates the
// tool without applying it), A-1 (an offset over a non-accepted seed).
// ---------------------------------------------------------------------------

/** The offset output line whose solved points both satisfy `on` (the inner rectangle's sides). */
function outputLineWhere(
  session: SketchSessionState,
  outputs: readonly SketchEntityId[],
  on: (point: readonly number[]) => boolean,
) {
  const positions = positionsOf(session.liveSolve!.solvedSnapshot);
  const id = outputs.find((entityId) => {
    const entity = session.definition.entities.find(
      (candidate) => candidate.entityId === entityId,
    );
    return (
      entity?.kind === "lineSegment" &&
      on(positions.get(entity.startPointId)!) &&
      on(positions.get(entity.endPointId)!)
    );
  });
  if (!id) throw new Error("no such output line");
  return id;
}

/** Selects `entityIds` in `toolId` and sets `value`, without committing. */
function selectEditTool(
  session: SketchSessionState,
  toolId: Parameters<typeof beginSketchTool>[1],
  entityIds: readonly SketchEntityId[],
  value: number | null,
) {
  let next = beginSketchTool(session, toolId);
  for (const entityId of entityIds)
    next = selectSketchEditToolTarget(next, targetOf(next, entityId));
  return value === null ? next : patchSketchEditToolValue(next, { value });
}

describe("T10i review fixes (R-2, R-1, A-1)", () => {
  const near = (value: number, target: number) =>
    Math.abs(value - target) < 1e-9;
  test.each([
    ["sketchExtend", "the Extend boundary"],
    ["sketchSplit", "the Split boundary"],
    ["sketchMirror", "the Mirror axis"],
    ["sketchFillet", "a Fillet second source"],
  ] as const)(
    "R-2 %s: %s is an offset output (not the first input): refused while failed, still being checked while pending, ordinary once certified",
    async (toolId) => {
      const states = await editInputs();
      const bottom = outputLineWhere(states.certified, states.outputs, (p) =>
        near(p[1]!, 0.5),
      );
      const right = outputLineWhere(states.certified, states.outputs, (p) =>
        near(p[0]!, 3.5),
      );
      // Fillet: a line drawn from the bottom output's corner shares its
      // driven point (the line tool snaps onto it once certified), so
      // [line, output] is a corner whose second source is the output.
      const corner =
        toolId === "sketchFillet"
          ? (() => {
              const line = states.certified.definition.entities.find(
                (entity) => entity.entityId === bottom,
              );
              if (line?.kind !== "lineSegment") throw new Error("line");
              const positions = positionsOf(
                states.certified.liveSolve!.solvedSnapshot,
              );
              const end = positions.get(line.endPointId)!;
              const drawn = drawLine(
                states.certified,
                [end[0], end[1]],
                [end[0] + (end[0] > 2 ? 0.3 : -0.3), end[1] - 0.3],
              );
              return {
                drawn,
                line: drawn.definition.entityIds.find(
                  (id) => !states.certified.definition.entityIds.includes(id),
                )!,
              };
            })()
          : null;
      const fixtures = corner
        ? {
            pending: corner.drawn,
            failed: failedRound(corner.drawn),
            certified: (await liveRound(corner.drawn)).session,
          }
        : states;
      const [selection, output] =
        toolId === "sketchExtend"
          ? [[states.free, right], right]
          : toolId === "sketchMirror"
            ? [[states.free, bottom], bottom]
            : toolId === "sketchSplit"
              ? [[states.cutter, bottom], bottom]
              : [[corner!.line, bottom], bottom];
      const value = toolId === "sketchFillet" ? 0.05 : null;
      for (const [label, state, message] of [
        ["failed", fixtures.failed, gateMessage],
        ["pending", fixtures.pending, checkingMessage],
      ] as const) {
        const result = runEditTool(state, toolId, selection, value);
        expect(
          result.validationMessage,
          `${toolId}, ${label}: the gate names the non-first input`,
        ).toEqual(message(output, states.derivationId));
        expect(result.definition, `${label}: nothing authored`).toBe(
          state.definition,
        );
      }
      // T10g-2: an Extend/Split selection applies when its query result arrives.
      const result = await completeSketchEditQueriesForTest(
        runEditTool(fixtures.certified, toolId, selection, value),
      );
      expect(
        result.validationMessage ?? "",
        `${toolId} with a certified ${output} is not refused`,
      ).not.toContain(NON_ACCEPTED_OFFSET_EDIT_INPUT_CODE);
      expect(
        result.definition,
        `${toolId} with a certified output edits the sketch (${result.validationMessage})`,
      ).not.toBe(fixtures.certified.definition);
    },
    600_000,
  );

  test("R-1: a selection made while the round is pending says the output is being checked; when the round certifies, the tool is re-evaluated (message cleared, preview shown) and nothing is applied; Commit then applies", async () => {
    const states = await editInputs();
    for (const [toolId, selection, value] of [
      ["sketchFillet", [states.outputs[0]!, states.outputs[1]!], 0.1],
    ] as const) {
      const selected = selectEditTool(states.pending, toolId, selection, value);
      expect(selected.validationMessage, `${toolId}: pending`).toEqual(
        expect.stringContaining("which is still being checked"),
      );
      expect(selected.toolStagedEntities).toEqual([]);
      expect(selected.definition).toBe(states.pending.definition);
      const settled = refreshSketchEditToolAfterOffsetRound(
        (await liveRound(selected)).session,
      );
      expect(
        settled.liveSolve!.solvedSnapshot.certifiedOffsetDerivationIds,
        "premise: the round certified the offset",
      ).toEqual([states.derivationId]);
      expect(settled.validationMessage, `${toolId}: cleared`).toBeNull();
      expect(
        settled.toolStagedEntities.length,
        `${toolId}: the preview is shown`,
      ).toBeGreaterThan(0);
      expect(
        settled.toolPresentation?.validation ?? [],
        `${toolId}: the panel shows no error`,
      ).toEqual([]);
      expect(
        settled.definition,
        `${toolId}: the re-evaluation applies nothing (no auto-apply)`,
      ).toBe(selected.definition);
      expect(settled.activeEditTool?.selectedTargets).toHaveLength(2);
      const committed = patchSketchEditToolValue(settled, {
        intent: "commitSketchEditOperator",
      });
      expect(committed.definition, `${toolId}: Commit then applies`).not.toBe(
        settled.definition,
      );
    }
  }, 600_000);

  // T10g-2: a complete Extend selection is one queued click, as a Trim
  // click (T10g-1, review R-1): deferred while the round is pending, queried
  // once the round certifies (the re-evaluation itself applies nothing), and
  // applied as one edit when its exact result arrives.
  // T10g-2 review A-3: a deferred Extend/Split click whose round then fails
  // becomes the decided refusal (dropped from the queue, nothing queried).
  test.each(["sketchExtend", "sketchSplit"] as const)(
    "R-1 (T10g-2) %s: a complete selection deferred while pending is refused when the round fails; the queue empties and nothing is queried or authored",
    async (toolId) => {
      const states = await editInputs();
      const output = outputLineWhere(states.certified, states.outputs, (p) =>
        toolId === "sketchExtend" ? near(p[0]!, 3.5) : near(p[1]!, 0.5),
      );
      const selection =
        toolId === "sketchExtend"
          ? [states.free, output]
          : [states.cutter, output];
      const selected = selectEditTool(states.pending, toolId, selection, null);
      expect(selected.validationMessage).toEqual(
        checkingMessage(output, states.derivationId),
      );
      expect(selected.activeEditTool?.editQuery?.queue).toHaveLength(1);
      const refused = refreshSketchEditToolAfterOffsetRound(
        failedRound(selected),
      );
      expect(refused.validationMessage).toEqual(
        gateMessage(output, states.derivationId),
      );
      expect(refused.activeEditTool?.editQuery).toEqual({
        queue: [],
        inFlight: null,
      });
      expect(refused.definition).toBe(selected.definition);
    },
    600_000,
  );

  test("R-1 (T10g-2): a complete Extend selection made while the round is pending is deferred; when the round certifies its query is issued (nothing applied, message cleared) and its result applies, tied to the output", async () => {
    const states = await editInputs();
    const right = outputLineWhere(states.certified, states.outputs, (p) =>
      near(p[0]!, 3.5),
    );
    const selected = selectEditTool(
      states.pending,
      "sketchExtend",
      [states.free, right],
      null,
    );
    expect(selected.validationMessage, "sketchExtend: pending").toEqual(
      expect.stringContaining("which is still being checked"),
    );
    expect(selected.toolStagedEntities).toEqual([]);
    expect(selected.definition).toBe(states.pending.definition);
    expect(selected.activeEditTool?.editQuery).toMatchObject({
      queue: [{ targetEntityId: states.free, boundary: { entityId: right } }],
      inFlight: null,
    });
    const settled = refreshSketchEditToolAfterOffsetRound(
      (await liveRound(selected)).session,
    );
    expect(
      settled.liveSolve!.solvedSnapshot.certifiedOffsetDerivationIds,
      "premise: the round certified the offset",
    ).toEqual([states.derivationId]);
    expect(settled.validationMessage, "sketchExtend: cleared").toBeNull();
    expect(
      settled.definition,
      "sketchExtend: the re-evaluation applies nothing (it issues the query)",
    ).toBe(selected.definition);
    expect(
      settled.activeEditTool?.editQuery?.inFlight?.input.operation,
    ).toEqual({
      kind: "extend",
      targetEntityId: states.free,
      boundaryEntityId: right,
    });
    const applied = await completeSketchEditQueriesForTest(settled);
    expect(applied.definition, "sketchExtend: its result applies").not.toBe(
      settled.definition,
    );
    expect(
      applied.toolPresentation?.validation ?? [],
      "sketchExtend: the panel shows no error",
    ).toEqual([]);
    const known = new Set(settled.definition.constraintIds);
    expect(
      applied.definition.constraints
        .filter((constraint) => !known.has(constraint.constraintId))
        .map((constraint) =>
          constraint.kind === "pointOnCurve"
            ? [constraint.kind, constraint.curve.entityId]
            : [constraint.kind],
        ),
      "Q1b: the new end is tied onto the certified output",
    ).toEqual([["pointOnCurve", right]]);
    const free = applied.definition.entities.find(
      (entity) => entity.entityId === states.free,
    );
    if (free?.kind !== "lineSegment") throw new Error("line");
    const start = applied.definition.points.find(
      (point) => point.pointId === free.startPointId,
    )!.position;
    expect(near(start[0], 3.5) && near(start[1], 1)).toBe(true);
  }, 600_000);

  test("R-1: when the round fails, the pending selection becomes the decided refusal; an Offset seed selected while pending stages its check once the round certifies", async () => {
    const states = await editInputs();
    const selected = selectEditTool(
      states.pending,
      "sketchSlot",
      [states.outputs[0]!],
      0.2,
    );
    expect(selected.validationMessage).toEqual(
      checkingMessage(states.outputs[0]!, states.derivationId),
    );
    const refused = refreshSketchEditToolAfterOffsetRound(
      failedRound(selected),
    );
    expect(refused.validationMessage).toEqual(
      gateMessage(states.outputs[0]!, states.derivationId),
    );
    expect(refused.toolPresentation?.validation?.[0]?.message).toEqual(
      gateMessage(states.outputs[0]!, states.derivationId),
    );
    expect(refused.definition).toBe(selected.definition);

    const offset = selectEditTool(
      states.pending,
      "offset",
      [states.outputs[0]!],
      null,
    );
    const valued = patchSketchEditToolValue(offset, { value: 0.1 });
    expect(valued.validationMessage).toEqual(
      checkingMessage(states.outputs[0]!, states.derivationId),
    );
    expect(valued.activeEditTool?.offsetPublication).toBeUndefined();
    const staged = refreshSketchEditToolAfterOffsetRound(
      (await liveRound(valued)).session,
    );
    expect(staged.validationMessage).toBeNull();
    expect(
      staged.activeEditTool?.offsetPublication,
      "the offset's check is staged (the editor loop emits it); nothing is committed",
    ).toMatchObject({ status: "pending", commitRequested: false });
    expect(staged.definition).toBe(valued.definition);
  }, 600_000);

  test("R-1 async apply: a staged offset whose seed's round is pending again when its check certifies commits nothing, drops the check and says the seed is being checked; the round's re-evaluation re-stages it", async () => {
    const states = await editInputs();
    const staged = runEditTool(
      states.certified,
      "offset",
      [states.outputs[0]!],
      0.1,
    );
    const publication = staged.activeEditTool!.offsetPublication!;
    expect(publication).toMatchObject({
      status: "pending",
      commitRequested: true,
    });
    const rePending = withLiveSolveBasis(staged, staged.definition);
    expect(rePending.liveRegions.status, "premise: a new round").toBe(
      "pending",
    );
    const applied = completeSketchOffsetPreviewPublication(
      rePending,
      publication.derivationId,
      [{ derivationId: publication.derivationId, status: "certified" }],
    );
    expect(applied.definition, "nothing is committed").toBe(
      rePending.definition,
    );
    expect(applied.activeEditTool?.offsetPublication).toBeUndefined();
    expect(applied.validationMessage).toEqual(
      checkingMessage(states.outputs[0]!, states.derivationId),
    );
    const restaged = refreshSketchEditToolAfterOffsetRound(
      (await liveRound(applied)).session,
    );
    expect(restaged.activeEditTool?.offsetPublication).toMatchObject({
      status: "pending",
      commitRequested: false,
    });
    expect(restaged.validationMessage).toBeNull();
  }, 600_000);

  test("A-1: an offset B of A's output alone: with A failed, B fails its publication (derived-offset-seed-not-certified on the seed) and, by the G19 closure, B's outputs are non-accepted and excluded from regions naming A; with A certified, B certifies and is ordinary", async () => {
    const states = await editInputs();
    const definition = withOffsetRelationship(
      states.certified.definition,
      [states.outputs[0]!],
      0.05,
      702,
    );
    const second = offsetIdsOf(definition).find(
      (id) => id !== states.derivationId,
    )!;
    const secondOutputs = outputEntityIds(definition, second);
    const solved = solve(definition).solvedSnapshot;
    const publishOnce = (snapshot: SolvedSketchSnapshot) =>
      publishSketchOffsets({
        definition,
        solvedSnapshot: snapshot,
        modelingTolerance: 1e-3,
        capabilities: capabilities(),
      });
    const control = publishOnce(solved);
    expect(
      control.map((item) => item.status),
      "control: A and B certify",
    ).toEqual(["certified", "certified"]);
    const controlSnapshot = applyOffsetPublications(
      definition,
      solved,
      control,
    );
    for (const entityId of secondOutputs)
      expect(
        isAcceptedOffsetOutput(definition, controlSnapshot, entityId),
        `control: ${entityId} is accepted`,
      ).toBe(true);

    fabricated.planFailure = states.derivationId;
    try {
      const failedSolve = solve(definition).solvedSnapshot;
      const publications = publishOnce(failedSolve);
      expect(publications[0]!.status, "premise: A fails").toBe("failed");
      expect(publications[1]).toMatchObject({
        derivationId: second,
        status: "failed",
        diagnostic: {
          code: OFFSET_DIAGNOSTIC_CODES.seedNotCertified,
          severity: "error",
          target: { kind: "entity", entityId: states.outputs[0]! },
          message: `Offset relationship ${second}: its seed ${states.outputs[0]!} is an output of offset relationship ${states.derivationId}, which is not certified, so this offset is not certified either.`,
        },
      });
    } finally {
      fabricated.planFailure = null;
    }

    // The closure alone (a snapshot recording B but not A as certified).
    const forged = applyOffsetPublications(definition, solved, [
      { derivationId: states.derivationId, status: "failed" },
      { derivationId: second, status: "certified" },
    ] as SketchOffsetPublicationRecord[]);
    expect(forged.certifiedOffsetDerivationIds).toEqual([second]);
    for (const entityId of secondOutputs)
      expect(
        isAcceptedOffsetOutput(definition, forged, entityId),
        `${entityId} of B over a failed A is non-accepted`,
      ).toBe(false);
    const excluded = offsetArrangementInput(definition, forged, [
      { derivationId: states.derivationId, status: "failed" },
      { derivationId: second, status: "certified" },
    ] as SketchOffsetPublicationRecord[]).unpublishedOffsetOutputs!;
    for (const entityId of secondOutputs)
      expect(
        excluded.find((item) => item.entityId === entityId),
        `${entityId} is excluded from region input, naming A`,
      ).toMatchObject({
        derivationId: states.derivationId,
        reason: `offset relationship ${states.derivationId} failed its publication`,
      });
  }, 600_000);
});

// ---------------------------------------------------------------------------
// T10i (C5, [TECH] T-11): a line output shorter than τ fails its offset's
// solve frame (`derived-offset-output-degenerate`, relationship-scoped,
// [TECH] G16′); `validateDefinition` no longer flags offset line outputs
// sketch-wide; authored lines keep `degenerate-line-segment`.
// ---------------------------------------------------------------------------

/** Native rectangle (0,0)–(2,0.2) + the unrelated one; inward offset 0.05 → 0.0996 (short sides 0.0008 < τ). */
function degenerateOutputRectangle() {
  const drawn = acceptSketchDraw(
    startSketchDraw(beginSketchTool(newSession(), "rectangle"), [0, 0]),
    [2, 0.2],
  );
  const seeds = drawn.definition.entities
    .filter((entity) => entity.kind === "lineSegment")
    .map((entity) => entity.entityId);
  const built = withUnrelatedRectangle(drawn);
  const authored = withOffsetRelationship(
    built.session.definition,
    seeds,
    0.05,
  );
  const [derivationId] = offsetIdsOf(authored);
  const relationship = authored.derivedRelationships!.find(
    (candidate) => candidate.derivationId === derivationId,
  );
  if (relationship?.kind !== "offset") throw new Error("offset");
  // The short sides' outputs (the vertical source sides).
  const shortOutputs = relationship.outputs
    .filter((output) => {
      const seed = authored.entities.find(
        (entity) => entity.entityId === output.seedEntityId,
      );
      if (seed?.kind !== "lineSegment") return false;
      const at = (pointId: SketchPointId) =>
        authored.points.find((point) => point.pointId === pointId)!.position;
      return Math.abs(at(seed.startPointId)[0] - at(seed.endPointId)[0]) < 1e-9;
    })
    .map((output) => output.outputEntityId);
  return {
    built,
    seeds,
    authored,
    derivationId: derivationId!,
    shortOutputs,
    edited: withOffsetDistance(authored, derivationId!, 0.0996),
  };
}

/** `definition` with each of `lineIds`' end point moved to 0.0008 from its start (persisted sub-τ positions). */
function withShortLines(
  definition: SketchDefinition,
  lineIds: readonly SketchEntityId[],
): SketchDefinition {
  const moved = new Map<SketchPointId, [number, number]>();
  for (const lineId of lineIds) {
    const line = definition.entities.find(
      (entity) => entity.entityId === lineId,
    );
    if (line?.kind !== "lineSegment") throw new Error("line");
    const start = definition.points.find(
      (point) => point.pointId === line.startPointId,
    )!.position;
    moved.set(line.endPointId, [start[0], start[1] + 0.0008]);
  }
  return {
    ...definition,
    points: definition.points.map((point) =>
      moved.has(point.pointId)
        ? { ...point, position: moved.get(point.pointId)! }
        : point,
    ),
  };
}

const mockSolve = (definition: SketchDefinition) =>
  new MockSketchSolverAdapter({
    neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
  }).solveSketch({
    contractVersion: CONTRACT_VERSION,
    solverSchemaVersion: SOLVER_SCHEMA_VERSION,
    requestId: "request_t10i_c5" as never,
    documentId: "doc_workspace" as never,
    revisionId: "rev_0001" as never,
    sketchId: "sketch_t10i" as never,
    plane: DEFAULT_MOCK_SKETCH_PLANE_FRAME,
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-3,
    },
    modelingTolerance: 1e-3,
    partialSolvePolicy: "bestEffort",
    definition,
    projectedReferences: [],
  });

describe("T10i degenerate offset line outputs are relationship-scoped ([TECH] C5, T-11)", () => {
  test("the native trigger (rectangle 2×0.2, inward 0.05 → 0.0996): the sketch stays solved, the offset fails derived-offset-output-degenerate in its publication (reproduced from the frame), its outputs are held and non-accepted, a requirement on a short output is blocked, the unrelated region is derived", async () => {
    const trigger = degenerateOutputRectangle();
    const base = rebuildSessionForDefinition(trigger.built.session, {
      definition: trigger.authored,
    });
    const baseRound = await liveRound(base);
    expect(
      baseRound.response.offsetPublications.map((item) => item.status),
      "premise: the authored 0.05 offset certifies",
    ).toEqual(["certified"]);
    // A requirement on a short output (authored, satisfied at 0.05).
    const vertical = {
      constraintId: "constraint_t10i_short_vertical" as never,
      kind: "vertical" as const,
      label: "T10i vertical on a short output",
      entityId: trigger.shortOutputs[0]!,
    };
    const definition = {
      ...trigger.edited,
      constraintIds: [...trigger.edited.constraintIds, vertical.constraintId],
      constraints: [...trigger.edited.constraints, vertical],
    } as SketchDefinition;
    expect(
      solve(definition, 1e-3).solvedSnapshot.diagnostics.map((d) => d.code),
      "premise (core, 1e-6 segment policy): no sketch-scoped degenerate-line-segment",
    ).not.toContain("degenerate-line-segment");
    const edited = rebuildSessionForDefinition(baseRound.session, {
      definition,
    });
    const before = positionsOf(baseRound.session.liveSolve!.solvedSnapshot);
    const after = positionsOf(edited.liveSolve!.solvedSnapshot);
    for (const pointId of outputPointIds(definition, trigger.derivationId))
      expect(after.get(pointId), `${pointId} is held`).toEqual(
        before.get(pointId),
      );
    expect(
      edited.liveSolve!.solvedSnapshot.constraintStatuses.find(
        (entry) => entry.constraintId === vertical.constraintId,
      )?.status,
      "the requirement on the short output is blocked (G16″)",
    ).toBe("blocked");
    const { response } = await expectScopedFailure({
      session: edited,
      failing: trigger.derivationId,
      code: OFFSET_DIAGNOSTIC_CODES.outputDegenerate,
      seed: expect.any(String) as never,
      unrelated: trigger.built.lines,
    });
    const failure = response.offsetPublications[0]!.diagnostic!;
    const target =
      failure.target?.kind === "entity" ? failure.target.entityId : null;
    expect(
      trigger.seeds.includes(target as SketchEntityId),
      "the diagnostic targets a source side",
    ).toBe(true);
    expect(failure.message).toMatch(
      /: An offset line would be 0\.000800 mm long, shorter than the modeling tolerance 0\.001 mm\.$/,
    );
  }, 300_000);

  test("persisted sub-τ positions of offset line outputs are never a sketch-scoped error (core and mock); an authored sub-τ line still is", async () => {
    const trigger = degenerateOutputRectangle();
    const persisted = withShortLines(trigger.edited, trigger.shortOutputs);
    const core = solveSketchDefinitionCore({
      definition: persisted,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-3,
      },
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    expect(core.solvedSnapshot.status.solveState, "core: solved").toBe(
      "solved",
    );
    expect(
      core.solvedSnapshot.diagnostics.map((d) => d.code),
      "core: no degenerate-line-segment for an offset output",
    ).not.toContain("degenerate-line-segment");
    const mock = await mockSolve(persisted);
    expect(mock.solvedSnapshot.status.solveState, "mock: solved").toBe(
      "solved",
    );
    expect(
      mock.solvedSnapshot.diagnostics.map((d) => d.code),
      "mock: no degenerate-line-segment for an offset output",
    ).not.toContain("degenerate-line-segment");

    // An authored line (the unrelated rectangle's side) at the same length.
    const authoredShort = withShortLines(trigger.edited, [
      trigger.built.lines[1]!,
    ]);
    const expected = {
      code: "degenerate-line-segment",
      severity: "error",
      target: { kind: "entity", entityId: trigger.built.lines[1]! },
    };
    const coreAuthored = solveSketchDefinitionCore({
      definition: authoredShort,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-3,
      },
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    expect(coreAuthored.solvedSnapshot.status.solveState).toBe(
      "partiallySolved",
    );
    expect(coreAuthored.solvedSnapshot.diagnostics).toContainEqual(
      expect.objectContaining(expected),
    );
    const mockAuthored = await mockSolve(authoredShort);
    expect(mockAuthored.solvedSnapshot.status.solveState).toBe(
      "partiallySolved",
    );
    expect(mockAuthored.solvedSnapshot.diagnostics).toContainEqual(
      expect.objectContaining(expected),
    );
  }, 300_000);
});

// ---------------------------------------------------------------------------
// T10g-1 (design review R-1, [TECH] T-g5): Trim on the exact edit service in
// a sketch with an offset relationship. Its queries wait while the
// publication round is pending; a non-accepted offset output is never a
// cutter, and refuses the Trim only when its outward box meets the target's.
// ---------------------------------------------------------------------------

describe("T10g-1 Trim with offset relationships (review R-1, T-g5)", () => {
  /** The rectangles, two lines crossing the far rectangle's bottom, the x = 2 cutter, the inward 0.5 offset. */
  async function trimStates() {
    const initial = rectanglesSession();
    const seeds = initial.seeds;
    let session = initial.session;
    const farBottom = session.definition.entities.find(
      (entity) =>
        entity.kind === "lineSegment" &&
        !seeds.includes(entity.entityId) &&
        session.definition.points.find(
          (point) => point.pointId === entity.startPointId,
        )!.position[1] === 0 &&
        session.definition.points.find(
          (point) => point.pointId === entity.endPointId,
        )!.position[1] === 0,
    )!.entityId;
    session = drawLine(session, [10.5, -0.5], [10.5, 0.5]);
    session = drawLine(session, [11.5, -0.5], [11.5, 0.5]);
    const before = new Set(session.definition.entityIds);
    session = drawLine(session, [2, 0.2], [2, 0.8]);
    const cutter = session.definition.entityIds.find((id) => !before.has(id))!;
    const pending = committedOffsetOnSide(session, seeds, 0.5, "left");
    const { derivationId, outputs } = offsetOutputIds(pending);
    return {
      pending,
      failed: failedRound(pending),
      certified: (await liveRound(pending)).session,
      farBottom,
      cutter,
      derivationId,
      outputs,
    };
  }

  const click = (session: SketchSessionState, entityId: SketchEntityId) =>
    selectSketchEditToolTarget(
      beginSketchTool(session, "trim"),
      targetOf(session, entityId),
    );

  test("R-1: while the publication round is pending the click is queued, not queried; when the round settles it is queried on the certified basis and applies", async () => {
    const states = await trimStates();
    const queued = click(states.pending, states.farBottom);
    expect(queued.definition, "nothing authored").toBe(
      states.pending.definition,
    );
    expect(queued.activeEditTool?.editQuery).toMatchObject({
      inFlight: null,
      queue: [{ targetEntityId: states.farBottom }],
    });
    expect(
      queued.toolPresentation?.validation?.map((entry) => entry.message),
    ).toEqual(["Checking intersections…"]);
    const settled = refreshSketchEditToolAfterOffsetRound(
      (await liveRound(queued)).session,
    );
    const inFlight = settled.activeEditTool!.editQuery!.inFlight!;
    expect(
      inFlight.input.solvedSnapshot.certifiedOffsetDerivationIds,
      "the query runs on the publication-current basis",
    ).toEqual([states.derivationId]);
    const applied = await completeSketchEditQueriesForTest(settled);
    expect(applied.validationMessage).toBeNull();
    expect(applied.definition.entityIds.length).toBe(
      states.pending.definition.entityIds.length + 1,
    );
  }, 600_000);

  test("T-g5: a failed offset's outputs are not cutters; they refuse a Trim only when their box meets the target's (named), never an unrelated one", async () => {
    const states = await trimStates();
    const refused = await completeSketchEditQueriesForTest(
      click(states.failed, states.cutter),
    );
    expect(refused.definition).toBe(states.failed.definition);
    expect(refused.validationMessage).toEqual(
      expect.stringMatching(
        new RegExp(
          `^${NON_ACCEPTED_OFFSET_EDIT_INPUT_CODE}: Sketch entity (${states.outputs.join("|")}) is an output of offset relationship ${states.derivationId}, which is not certified, so it cannot be used as a Trim input\\.$`,
        ),
      ),
    );
    const unrelated = await completeSketchEditQueriesForTest(
      click(states.failed, states.farBottom),
    );
    expect(unrelated.validationMessage).toBeNull();
    expect(unrelated.definition).not.toBe(states.failed.definition);
    // Certified, the output is an ordinary cutter (one crossing: too few).
    const certified = await completeSketchEditQueriesForTest(
      click(states.certified, states.cutter),
    );
    expect(certified.validationMessage).toBe(TRIM_TOO_FEW_CUTS_MESSAGE);
  }, 600_000);
});

const t11aRuntime = {
  deriveSketchRegions: deriveSketchRegionsForTest,
} as EditorEffectRuntime;

/**
 * T11a: the certified edit-input sketch saved as Finish saves it (authored
 * definition and its solve; optionally with a construction-plane reference
 * to project) and reopened through the editor's normal entry
 * (`effect.sketchSessionOpened` → `enterSketchEditing`).
 */
async function reopenCertified(withReference: boolean) {
  const states = await editInputs();
  const live = states.certified.liveSolve!;
  const reference = {
    referenceId: "ref_t11a",
    kind: "constructionPlane",
    label: "YZ plane",
    source: { kind: "construction", constructionId: "construction_plane-yz" },
    projectionMode: "coplanar",
  } as const;
  const definition = withReference
    ? {
        ...live.sourceDefinition,
        referenceIds: [
          ...live.sourceDefinition.referenceIds,
          reference.referenceId,
        ],
        references: [...live.sourceDefinition.references, reference],
      }
    : live.sourceDefinition;
  const raw = createSketchSessionFromSnapshot(
    {
      sketchId: states.certified.actionContextId,
      label: "Sketch T11a",
      plane: states.certified.plane,
      ownerFeatureId: null,
      sketch: {
        definition,
        solvedSnapshot: live.solvedSnapshot,
        regions: states.certified.liveRegions.regions,
        projectedReferences: [],
        derivedValidity: getSketchSessionDerivedValidity(states.certified),
      },
    } as never,
    OCC_KERNEL_SETTINGS,
  );
  expect(raw.liveSolve, "premise: a raw reopened session").toBe(null);
  const command: SelectionCommandEditorState = {
    ...initialEditorState,
    kind: "selectionCommand",
    mode: "part",
    document: { documentId: "doc_workspace", revisionId: "rev_0001" },
    command: {
      commandSessionId: "command_t11a",
      toolId: "sketch",
      phase: "collecting",
    },
    pendingRequestId: "request_t11a_open",
  };
  const opened = transitionEditorState(command, {
    type: "effect.sketchSessionOpened",
    requestId: "request_t11a_open",
    documentId: "doc_workspace",
    revisionId: "rev_0001",
    commandSessionId: "command_t11a",
    session: raw,
  });
  expect(opened.state.kind).toBe("editingSketch");
  return { ...states, raw, opened };
}

/** Runs the requested live derivations through the real effect executor and reducer until none is requested. */
async function settleDerivations(
  state: EditorState,
  effects: readonly EditorEffect[],
) {
  const derivations = (list: readonly EditorEffect[]) =>
    list.filter((effect) => effect.type === "sketch.deriveRegions");
  const queue = derivations(effects);
  while (queue.length > 0) {
    const next = transitionEditorState(
      state,
      await runEditorEffect(queue.shift()!, t11aRuntime),
    );
    state = next.state;
    queue.push(...derivations(next.effects));
  }
  if (state.kind !== "editingSketch") throw new Error("Expected sketch state.");
  return state;
}

const certifiedIdsOf = (session: SketchSessionState) =>
  getSketchSessionDisplaySolvedSnapshot(session).certifiedOffsetDerivationIds ??
  [];

/** Whether a Line tool's pointer 30% along line `entityId` snaps to it. */
function snapsTo(session: SketchSessionState, entityId: SketchEntityId) {
  const entity = session.definition.entities.find(
    (candidate) => candidate.entityId === entityId,
  );
  if (entity?.kind !== "lineSegment") throw new Error("Expected a line.");
  const at = (pointId: SketchPointId) =>
    session.definition.points.find((point) => point.pointId === pointId)!
      .position;
  const [start, end] = [at(entity.startPointId), at(entity.endPointId)];
  const { candidate } = resolveSessionSnap(beginSketchTool(session, "line"), [
    start[0] + 0.3 * (end[0] - start[0]),
    start[1] + 0.3 * (end[1] - start[1]),
  ]);
  return (
    candidate?.sources.some(
      (source) => source.kind === "localEntity" && source.entityId === entityId,
    ) ?? false
  );
}

type T11aOffset = {
  readonly outputs: readonly SketchEntityId[];
  readonly derivationId: string;
};

/** While the round is pending: "still being checked", never "not certified"; no snap. */
function expectBeingChecked(
  state: SketchEditorState,
  { outputs, derivationId }: T11aOffset,
  label: string,
) {
  const { session } = state;
  expect(session.liveRegions.status, label).toBe("pending");
  expect(certifiedIdsOf(session), label).toEqual([]);
  expect(
    offsetEditInputGate(session, [outputs[0]!], "a Trim target"),
    `${label}: still being checked, not refused as uncertified`,
  ).toEqual({
    pending: true,
    message: checkingMessage(outputs[0]!, derivationId),
  });
  expect(snapsTo(session, outputs[0]!), `${label}: no snap yet`).toBe(false);
}

/** After the round: certified, an ordinary C3 input, snaps. */
function expectCertified(
  state: SketchEditorState,
  { outputs, derivationId }: T11aOffset,
  label: string,
) {
  const { session } = state;
  expect(session.liveRegions.status, label).toBe("current");
  expect(certifiedIdsOf(session), `${label}: certified`).toEqual([
    derivationId,
  ]);
  for (const output of outputs)
    expect(
      offsetEditInputGate(session, [output], "a Trim target"),
      `${label}: ${output} passes the C3 gate`,
    ).toBe(null);
  expect(snapsTo(session, outputs[0]!), `${label}: the output snaps`).toBe(
    true,
  );
}

describe("T11a reopened sketch certification (routed A3, review R-5)", () => {
  test("normal reopen of a certified offset: certified after the opening round with no edit; the output snaps, passes the C3 gate and is a Trim target", async () => {
    const reopened = await reopenCertified(false);
    const opened = reopened.opened.state as SketchEditorState;
    expect(opened.pendingProjectionRequestId, "no references").toBe(null);
    expect(
      opened.session.liveSolve!.sourceDefinition,
      "the basis is of the reopened definition",
    ).toBe(reopened.raw.definition);
    expectBeingChecked(opened, reopened, "reopened, round pending");

    const settled = await settleDerivations(opened, reopened.opened.effects);
    expect(settled.session.definition, "the round authors nothing").toBe(
      reopened.raw.definition,
    );
    expectCertified(settled, reopened, "after the opening round");

    // Trim on the freshly reopened sketch, without any prior edit.
    const trimmed = await completeSketchEditQueriesForTest(
      selectSketchEditToolTarget(
        beginSketchTool(settled.session, "trim"),
        targetOf(settled.session, reopened.cutter),
      ),
    );
    expect(trimmed.validationMessage).toBe(TRIM_TOO_FEW_CUTS_MESSAGE);
    const trimmedOutput = await completeSketchEditQueriesForTest(
      selectSketchEditToolTarget(
        beginSketchTool(settled.session, "trim"),
        targetOf(settled.session, reopened.outputs[0]!),
      ),
    );
    expect(
      trimmedOutput.validationMessage ?? "",
      "a certified output is an ordinary Trim target",
    ).not.toContain(NON_ACCEPTED_OFFSET_EDIT_INPUT_CODE);
    expect(trimmedOutput.definition).not.toBe(settled.session.definition);
  }, 600_000);

  test("references pending: based on the record's projections at once (still being checked, then certified); the projection result re-bases and certifies again", async () => {
    const reopened = await reopenCertified(true);
    const opened = reopened.opened.state as SketchEditorState;
    expect(
      reopened.opened.effects.map((effect) => effect.type),
      "the projection request and the entry round",
    ).toEqual(["sketch.projectReferences", "sketch.deriveRegions"]);
    expect(opened.pendingProjectionRequestId).not.toBe(null);
    expectBeingChecked(opened, reopened, "references pending, round pending");
    const entryRound = await settleDerivations(opened, reopened.opened.effects);
    expect(entryRound.pendingProjectionRequestId).not.toBe(null);
    expectCertified(
      entryRound,
      reopened,
      "references pending, after the entry round",
    );

    const projected = transitionEditorState(entryRound, {
      type: "effect.sketchReferencesProjected",
      requestId: entryRound.pendingProjectionRequestId!,
      documentId: "doc_workspace",
      commandSessionId: "command_t11a",
      baseRevisionId: "rev_0001",
      projectedReferences: [],
      diagnostics: [],
    });
    const rebased = projected.state as SketchEditorState;
    expect(rebased.pendingProjectionRequestId).toBe(null);
    expectBeingChecked(rebased, reopened, "projection result, round pending");
    expectCertified(
      await settleDerivations(rebased, projected.effects),
      reopened,
      "after the projected round",
    );
  }, 600_000);

  test("projection failed: the entry basis (record projections) is kept, no new round; its round certifies, and a certification already published survives the failure", async () => {
    const reopened = await reopenCertified(true);
    const opened = reopened.opened.state as SketchEditorState;
    const fail = (state: SketchEditorState) =>
      transitionEditorState(state, {
        type: "effect.sketchReferenceProjectionFailed",
        requestId: opened.pendingProjectionRequestId!,
        documentId: "doc_workspace",
        commandSessionId: "command_t11a",
        baseRevisionId: "rev_0001",
        message: "Reference projection failed.",
      });

    // Failure before the entry round returns: the basis is kept.
    const early = fail(opened);
    const earlyState = early.state as SketchEditorState;
    expect(earlyState.session.validationMessage).toBe(
      "Reference projection failed.",
    );
    expect(earlyState.session.liveSolve, "the entry basis is kept").toBe(
      opened.session.liveSolve,
    );
    expect(earlyState.session.liveRegions.generation).toBe(
      opened.session.liveRegions.generation,
    );
    expect(early.effects, "no new derivation round").toEqual([]);
    expectBeingChecked(
      earlyState,
      reopened,
      "projection failed, entry round pending",
    );
    expectCertified(
      await settleDerivations(earlyState, reopened.opened.effects),
      reopened,
      "projection failed, after the entry round",
    );

    // Failure after the entry round certified: the certification survives.
    const certified = await settleDerivations(opened, reopened.opened.effects);
    expect(certified.pendingProjectionRequestId).not.toBe(null);
    const late = fail(certified);
    const lateState = late.state as SketchEditorState;
    expect(lateState.session.liveSolve).toBe(certified.session.liveSolve);
    expect(late.effects, "no new derivation round").toEqual([]);
    expectCertified(lateState, reopened, "certified, then projection failed");
  }, 600_000);
});
