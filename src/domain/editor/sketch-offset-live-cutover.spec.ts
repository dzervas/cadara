// T08b-g5a acceptance (logic lane). Seam: the live offset cutover driven from
// native session authoring (spline/line/rectangle tools → Offset tool →
// U-G3 commit wait → live solve → contracts publish), with the real
// kernel-free query and certifier; plus the persistence boundary
// (normalization, runtime schema), the solver's shell residual / U-G2 and
// the authored-action history.
import { describe, expect, test } from "vitest";

import type { AuthoredActionState } from "@/contracts/modeling/authored-actions";
import { getAuthoredLiteralValue } from "@/contracts/modeling/authored-values";
import type { ModelingDocumentSettings } from "@/contracts/modeling/schema";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import {
  evaluateSketchDerivationJvp,
  evaluateSketchDerivations,
  prepareSketchDerivationPullback,
} from "@/contracts/sketch/derived-geometry";
import {
  applyOffsetPublications,
  isOffsetReplanRound,
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
  SketchDefinition,
  SketchRecord,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import {
  DERIVED_SHELL_REQUIREMENT_UNSUPPORTED,
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
  beginSketchTool,
  completeSketchOffsetPreviewPublication,
  createNewSketchSessionFromSupport,
  deleteSelectedSketchGeometry,
  getSketchSessionDerivedValidity,
  patchSketchEditToolValue,
  publishSketchLiveRegions,
  selectSketchEditToolTarget,
  startSketchDraw,
  updateSketchPointer,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import {
  DERIVED_SHELL_DELETE_MESSAGE,
  DERIVED_SHELL_POINT_DELETE_MESSAGE,
} from "@/domain/editor/sketch-session/editing";
import { AuthoredActionHistory } from "@/domain/modeling/authored-action-history";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import {
  normalizeSketchDefinition,
  normalizeSolvedSketchSnapshot,
} from "@/domain/modeling/modeling-service/normalization";
import { createCertifiedCubicTubeChain } from "@/domain/modeling/neutral-curve-certification/cubic-tube-chain";
import { createCertifiedNeutralCurveRequestQuery } from "@/domain/modeling/neutral-curve-certification/query";
import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";
import {
  createSketchDerivedTransformContribution,
  offsetSideForSketchPoint,
} from "@/domain/sketch-editing/operations";
import {
  createSessionCommitFactories,
  rebuildSessionForDefinition,
  withLiveSolveBasis,
} from "@/domain/editor/sketch-session/internals";
import { MockSketchSolverAdapter } from "@/domain/solver/mock-sketch-solver-adapter";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import {
  createSketchArrangementDeriver,
  offsetArrangementInput,
} from "@/contracts/sketch/region-extraction";
import { evaluateSplineSpan } from "@/contracts/sketch/spline-geometry";
import { getStableSketchSessionDisplayRenderables } from "@/domain/editor/sketch-session";
import { getDerivedShellDisplayValidity } from "@/domain/editor/sketch-session/display";
import { getEntityAnchor } from "@/domain/editor/sketch-session/annotations";
import { collectSketchInteractionGeometry } from "@/domain/sketch-interaction/geometry";
import { collectSketchSnapGeometries } from "@/domain/sketch-snapping/snap-candidates";
import { deriveMeasurementViewModel } from "@/domain/measure/measurement";
import { buildSketchVectorExportModel } from "@/domain/export/sketch-vector-export-model";
import { buildOccRenderExport } from "@/domain/modeling/occ/snapshot";
import { getDefaultOpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { buildRegionProfileFace } from "@/domain/modeling/occ/sketch-profile";

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
  return next;
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
    expect(
      evaluation.diagnostics.find(
        (diagnostic) =>
          diagnostic.code === OFFSET_DIAGNOSTIC_CODES.topologyChanged,
      ),
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
    const errorCodes = first.solvedSnapshot.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error",
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
  solverAdapter?: MockSketchSolverAdapter,
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
  expect(
    diagnosed(getSketchSessionDerivedValidity(broken).diagnostics),
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

  test("g5b-1b (known limit, fails closed): an inward offset of the loop certifies, but its trimmed-off tails cross the source line, so the G14 guard blocks the component", async () => {
    const { session, seeds } = splineLoopSession();
    const committed = committedOffsetOnSide(session, seeds, 0.01, "right");
    const shellId = shellIdOf(committed);
    const { response } = await liveRound(committed);
    expect(response.offsetPublications.map((item) => item.status)).toEqual([
      "certified",
    ]);
    expect(
      response.regions,
      "Undrawn tail geometry never bounds a face: no region is published.",
    ).toEqual([]);
    expect(
      response.diagnostics.find(
        (diagnostic) => diagnostic.code === "region-derived-tail-crossing",
      )?.target,
      "The targeted tail-crossing diagnostic names the shell.",
    ).toEqual({ kind: "entity", entityId: shellId });
  }, 300_000);

  test("g5b-2: a provisional shell is never region input (G7); it is a targeted unpublished obstacle", async () => {
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
        `${label}: the shell is a targeted unpublished obstacle`,
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
    expect(
      pick?.kind === "sampledCurve" && pick.points,
      "Pick uses exactly the displayed spans.",
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
      snap?.kind === "spline" && snap.fitPoints,
      "Snap uses exactly the displayed spans.",
    ).toEqual(expected16);

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

  test("g5b-7 (review R1, U9): on native OCC the profile face of the shell-bounded annulus raises the explicit spline-profile error naming the shell and one of its output spans", async () => {
    const { session, seeds } = splineLoopSession();
    const committed = committedOffsetOnSide(session, seeds, 0.01, "left");
    const shellId = shellIdOf(committed);
    const { session: live, response } = await liveRound(committed);
    const solved = live.liveSolve!;
    const outputSpanIds = new Set(
      shellRecord(solved.solvedSnapshot).spans.map((span) => span.outputSpanId),
    );
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
    const usesShell = (region: (typeof response.regions)[number]) =>
      region.loops.some((loop) =>
        loop.segments.some(
          (segment) =>
            segment.branch.source.kind === "entity" &&
            segment.branch.source.entityId === shellId,
        ),
      );
    const annulus = response.regions.filter(usesShell);
    expect(annulus, "premise: one shell-bounded region (g5b-1)").toHaveLength(
      1,
    );
    const oc = await getDefaultOpenCascadeInstance();
    let message = "";
    try {
      buildRegionProfileFace(oc, { plane: live.plane, sketch }, annulus[0]!);
    } catch (error) {
      message = (error as Error).message;
    }
    const u9 =
      /^Spline profile boundary sketch entity (\S+) span (\S+) is not yet supported by the OCC profile builder\.$/.exec(
        message,
      );
    expect(
      u9?.[1],
      `The annulus fails with the U9 error naming the shell (${message}).`,
    ).toBe(shellId);
    expect(
      outputSpanIds.has(u9![2]!),
      "The U9 error names one of the shell's output spans.",
    ).toBe(true);
  }, 300_000);
});
