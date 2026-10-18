import type {
  DocumentVariableRecord,
  SketchPoint,
} from "@/contracts/modeling/schema";
import {
  isAcceptedConstraintStatus,
  isReferenceDimension,
  resolvedReferenceDimension,
} from "@/contracts/sketch/schema";
import {
  createExpressionAuthoredValue,
  createLiteralAuthoredValue,
  getAuthoredLiteralValue,
  isExpressionAuthoredValue,
  type MaybeAuthoredValue,
} from "@/contracts/modeling/authored-values";
import type { ReferenceImageOperationState } from "@/contracts/reference-image/schema";
import type {
  ConstraintId,
  DimensionId,
  SketchAuthoringOperationId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type {
  SketchConstraintRef,
  SketchDimensionRef,
  SketchEntityRef,
  SketchOperationRef,
  SketchPointRef,
} from "@/contracts/shared/references";
import { evaluateSketchDerivations } from "@/contracts/sketch/derived-geometry";
import {
  applyOffsetPublications,
  isOffsetPublicationSolveAccepted,
  offsetPublicationDiagnostics,
  carriedOffsetPlans,
  closeOffsetReplanRound,
  isOffsetReplanRound,
  offsetReplanHints,
  publishedOffsetPlans,
} from "@/contracts/sketch/offset-publication";
import type { SketchOffsetPublicationRecord } from "@/contracts/solver/schema";
import {
  type ConstraintDefinition,
  type DerivableSketchDefinition,
  type DimensionDefinition,
  type NumericDimensionDefinition,
  type NumericSketchDefinition,
  type RegionRecord,
  type SketchDefinition,
  type SketchDerivedValidity,
  type SketchSolveDiagnostic,
  type SketchEntityDefinition,
  type SketchPointDefinition,
  type SolvedSketchSnapshot,
  SKETCH_SCHEMA_VERSION,
  SOLVED_SKETCH_SCHEMA_VERSION,
} from "@/contracts/sketch/schema";
import {
  reconstructSplineAggregate,
  tessellateCubicSpans,
} from "@/contracts/sketch/spline-geometry";
import {
  describeDegenerateSplineSpan,
  solveSketchDefinitionCore,
} from "@/contracts/sketch/solver-core";
import {
  correspondingMirrorDimensions,
  type MirrorDimensionCorrespondence,
} from "@/contracts/sketch/mirror-requirements";
import {
  deriveSketchValidity,
  isUnevaluatedMetadataOnlySketch,
  mergeSketchSolveDiagnostics,
  sketchProfileGateFailures,
  withRelationshipScopedDiagnostics,
} from "@/contracts/sketch/derived-validity";
import {
  evaluateAuthoredSketchDerivations,
  resolveSketchDerivationDistances,
  resolveSketchDimensionValues,
  type AuthoredSketchDerivationSettings,
} from "@/domain/modeling/sketch-dimension-expressions";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";
import {
  createRegionBoundaryBasis,
  resolveRegionBoundaryCurve,
} from "@/contracts/sketch/region-boundary-curves";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  buildReferenceImageAnchorProjectedReferences,
  mergeReferenceImageAnchorReferences,
} from "@/domain/reference-image-calibration/export/references";
import {
  type ReferenceImageOperationStateOverride,
  collectActiveReferenceImageOperations,
} from "@/domain/reference-image/operations";
import {
  REFERENCE_IMAGE_CALIBRATION_MODE_ID,
  type ReferenceImageCalibrationModeState,
} from "@/domain/reference-image-calibration/mode/shared";
import { isRegisteredSketchConstraintToolId } from "@/core/sketch-constraints/registry";
import { isRegisteredSketchEditToolId } from "@/core/sketch-edit-tools/registry";
import type {
  SketchDraftEntity,
  SketchToolCommitContribution,
  SketchToolId,
} from "@/core/sketch-tools/definition";
import { sampleArcPoints } from "@/core/sketch-tools/geometry";
import { getSketchToolDefinition } from "@/core/sketch-tools/registry";
import type {
  SketchToolOverlayDescriptor,
  SketchToolPresentationSchema,
} from "@/core/sketch-tools/editor-schema";
import {
  inferPlacement,
  inferPlacementFromCandidate,
  type PlacementInference,
} from "@/domain/sketch-inference/placement-inference";
import type {
  SketchAuthoringToolId,
  SketchLiveRegionBasis,
  SketchLiveRegions,
  SketchSessionState,
  SketchToolChain,
} from "./types";
import { buildCommitRequest } from "./history";
import {
  describeSketchSessionWithheldRegions,
  isSketchWithheldRegionText,
  keptSketchWithheldRegionText,
} from "./region-feedback";
import type { SketchExactIntersection } from "@/domain/sketch-snapping/snap-candidates";

export const CONSTRAINED_DRAG_BLOCKED_MESSAGE =
  "Geometry is constrained and cannot move to that position.";
// D6 constrained-drag feedback gate (minimum-motion-sketch-drag). A drag frame
// is only a candidate for constrained-movement feedback when a meaningful move
// was requested (> CONSTRAINED_DRAG_REQUEST_EPSILON world units) yet the target
// barely followed (< CONSTRAINED_DRAG_MOVE_FRACTION of the request). Whether
// that barely-moved frame is truly constrained (feedback) or just lagged along a
// free DOF (no feedback) is then decided by a solver mobility probe.
export const CONSTRAINED_DRAG_REQUEST_EPSILON = 1e-3;
export const CONSTRAINED_DRAG_MOVE_FRACTION = 0.01;
export const REFERENCE_IMAGE_ANCHOR_MARKER_RADIUS = 0.28;
export const REFERENCE_IMAGE_ANCHOR_OVERLAY_RADIUS = 0.4;
export const REFERENCE_IMAGE_ANCHOR_MARKER_COLOR = 0xf6c453;
export function createPointId(sequence: number, suffix: string): SketchPointId {
  return `sketch_point_${sequence}_${suffix}_${crypto.randomUUID()}` as SketchPointId;
}

export function createEntityId(
  sequence: number,
  suffix: string,
): SketchEntityId {
  return `sketch_entity_${sequence}_${suffix}_${crypto.randomUUID()}` as SketchEntityId;
}

export function createConstraintId(
  sequence: number,
  suffix: string,
): ConstraintId {
  return `constraint_${sequence}_${suffix}_${crypto.randomUUID()}` as ConstraintId;
}

export function createDimensionId(
  sequence: number,
  suffix: string,
): DimensionId {
  return `dimension_${sequence}_${suffix}_${crypto.randomUUID()}` as DimensionId;
}

export function createAuthoringOperationId(
  sequence: number,
  suffix: string,
): SketchAuthoringOperationId {
  return `sketch_operation_${sequence}_${suffix}_${crypto.randomUUID()}` as SketchAuthoringOperationId;
}

export function createSketchEntityRef(
  sketchId: SketchId,
  entityId: SketchEntityId,
): SketchEntityRef {
  return {
    kind: "sketchEntity",
    sketchId,
    entityId,
  };
}

export function createSketchPointRef(
  sketchId: SketchId,
  pointId: SketchPointId,
): SketchPointRef {
  return {
    kind: "sketchPoint",
    sketchId,
    pointId,
  };
}

export function createSketchOperationRef(
  sketchId: SketchId,
  operationId: SketchAuthoringOperationId,
): SketchOperationRef {
  return {
    kind: "sketchOperation",
    sketchId,
    operationId,
  };
}

export function createSketchConstraintRef(
  sketchId: SketchId,
  constraintId: ConstraintId,
): SketchConstraintRef {
  return {
    kind: "constraint",
    sketchId,
    constraintId,
  };
}

export function createSketchDimensionRef(
  sketchId: SketchId,
  dimensionId: DimensionId,
): SketchDimensionRef {
  return {
    kind: "dimension",
    sketchId,
    dimensionId,
  };
}

export function createEmptyDefinition(): SketchDefinition {
  return {
    schemaVersion: SKETCH_SCHEMA_VERSION,
    referenceIds: [],
    references: [],
    pointIds: [],
    points: [],
    entityIds: [],
    entities: [],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
    svgRenderingEnabled: false,
    derivedRelationships: [],
  };
}

export function getReferenceImageOperationOverrides(
  session: SketchSessionState,
) {
  const activeMode = session.activeSpecialMode;
  if (
    !activeMode ||
    activeMode.modeId !== REFERENCE_IMAGE_CALIBRATION_MODE_ID
  ) {
    return undefined;
  }

  const modeState = activeMode.state as ReferenceImageCalibrationModeState;
  if (modeState.draftState.kind !== "referenceImage") {
    return undefined;
  }

  return new Map([
    [
      modeState.operationId,
      {
        state: modeState.draftState as ReferenceImageOperationState,
        label: modeState.draftState.image.fileName,
      },
    ],
  ]);
}

export function collectVisibleReferenceImageAnchorPointIds(
  definition: Pick<SketchDefinition, "referenceImages">,
  overrides?: ReadonlyMap<
    SketchAuthoringOperationId,
    ReferenceImageOperationStateOverride
  >,
) {
  const pointIds = new Set<SketchPointId>();

  for (const { state } of collectActiveReferenceImageOperations(
    definition,
    overrides,
  )) {
    if (!state.calibration?.showExportedAnchorsInSketch) {
      continue;
    }

    for (const anchor of state.calibration.anchors) {
      pointIds.add(anchor.pointId as SketchPointId);
    }
  }

  return pointIds;
}

export function collectVisibleReferenceImageAnchorLabels(
  definition: Pick<SketchDefinition, "referenceImages">,
  overrides?: ReadonlyMap<
    SketchAuthoringOperationId,
    ReferenceImageOperationStateOverride
  >,
) {
  const labels = new Map<SketchPointId, string>();

  for (const { state } of collectActiveReferenceImageOperations(
    definition,
    overrides,
  )) {
    if (!state.calibration?.showExportedAnchorsInSketch) {
      continue;
    }

    for (const anchor of state.calibration.anchors) {
      labels.set(anchor.pointId as SketchPointId, anchor.label);
    }
  }

  return labels;
}

export function cloneDefinition(
  definition: SketchDefinition,
): SketchDefinition {
  return {
    ...definition,
    schemaVersion: definition.schemaVersion,
    referenceIds: [...definition.referenceIds],
    references: [...definition.references],
    pointIds: [...definition.pointIds],
    points: [...definition.points],
    entityIds: [...definition.entityIds],
    entities: [...definition.entities],
    constraintIds: [...definition.constraintIds],
    constraints: [...definition.constraints],
    dimensionIds: [...definition.dimensionIds],
    dimensions: [...definition.dimensions],
    styleIds: definition.styleIds ? [...definition.styleIds] : undefined,
    styles: definition.styles ? [...definition.styles] : undefined,
    svgRenderingEnabled: definition.svgRenderingEnabled ?? false,
    derivedRelationships: definition.derivedRelationships
      ? [...definition.derivedRelationships]
      : undefined,
  };
}

export function mergeDerivedProjectedReferences(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  overrides?: ReturnType<typeof getReferenceImageOperationOverrides>,
): ProjectedSketchReferenceRecord[] {
  const derivedReferences = buildReferenceImageAnchorProjectedReferences(
    definition,
    overrides,
  );
  const derivedReferenceIds = new Set(
    derivedReferences.map((reference) => reference.referenceId),
  );
  return [
    ...projectedReferences.filter(
      (reference) => !derivedReferenceIds.has(reference.referenceId),
    ),
    ...derivedReferences,
  ];
}

/**
 * τ, the session's offset plan hints ([TECH] G3/G12/G17) and (T17p3) the
 * document variables offset distances resolve against, for every session
 * evaluation.
 */
export function getSketchSessionDerivationSettings(
  session: Pick<
    SketchSessionState,
    "modelingTolerance" | "offsetPlans" | "documentVariables"
  >,
): AuthoredSketchDerivationSettings {
  return {
    modelingTolerance: session.modelingTolerance,
    ...(session.offsetPlans ? { offsetPlans: session.offsetPlans } : {}),
    documentVariables: session.documentVariables,
  };
}

export function getSketchSessionDisplayDefinition(session: SketchSessionState) {
  const sketchId = session.sketchId ?? ("sketch_draft" as SketchId);
  const evaluatedDefinition = evaluateAuthoredSketchDerivations({
    definition: session.definition,
    ...getSketchSessionDerivationSettings(session),
  }).definition;
  return mergeReferenceImageAnchorReferences(
    evaluatedDefinition,
    sketchId,
    getReferenceImageOperationOverrides(session),
  );
}

export function getSketchSessionDisplayProjectedReferences(
  session: SketchSessionState,
  definition: SketchDefinition,
) {
  return mergeDerivedProjectedReferences(
    definition,
    session.projectedReferences,
    getReferenceImageOperationOverrides(session),
  );
}

let cachedSolveDefinition: NumericSketchDefinition | null = null;
let cachedSolveProjectedRefs: ProjectedSketchReferenceRecord[] | null = null;
let cachedSolveTolerances: SketchSessionState["solverTolerances"] | null = null;
let cachedSolveModelingTolerance: number | null = null;
let cachedSolveResult: SolvedSketchSnapshot | null = null;

/**
 * Resolves expression-authored sketch dimensions against the session's document
 * variables so the numeric solver only ever receives concrete numbers (the
 * editor's resolve boundary). When resolution fails, preview solving stays
 * best-effort instead of throwing: T17p2 (F-2) every driving dimension value
 * is then `NaN`, so the solve fails on its NaN residuals (as it did when the
 * authored wrappers themselves reached the solver); the resolution
 * diagnostics are reported where the edit is committed.
 */
export function resolveSketchDefinitionForSolve(
  definition: SketchDefinition,
  documentVariables: readonly DocumentVariableRecord[] = [],
): NumericSketchDefinition {
  const resolved = resolveSketchDimensionValues({
    definition,
    variables: documentVariables,
  });
  return resolved.ok
    ? resolved.definition
    : {
        ...resolveSketchDerivationDistances({
          definition,
          variables: documentVariables,
        }),
        dimensions: definition.dimensions.map(unresolvedDrivingDimension),
      };
}

function unresolvedDrivingDimension(
  dimension: DimensionDefinition,
): NumericDimensionDefinition {
  if (isReferenceDimension(dimension)) {
    return resolvedReferenceDimension(dimension);
  }
  if (
    dimension.kind === "arcStartPointCoincident" ||
    dimension.kind === "arcEndPointCoincident"
  ) {
    return dimension;
  }
  return dimension.kind === "lineAngle"
    ? { ...dimension, valueRadians: Number.NaN }
    : { ...dimension, value: Number.NaN };
}

const LIVE_REGIONS_UNAVAILABLE_DIAGNOSTIC: SketchSolveDiagnostic = {
  code: "regions-unavailable",
  severity: "warning",
  message:
    "Sketch profiles are unavailable until every sketch constraint is solved.",
  target: null,
};

const LIVE_REGIONS_DERIVATION_FAILED_CODE = "regions-derivation-failed";

/**
 * T17o (E10, review A-6): the status line of a failed live-region
 * derivation (e.g. "OCC worker transport failed."): the reason, what is
 * blocked and the recovery (an edit starts a new derivation round).
 */
function liveRegionsFailedText(message: string) {
  return `${message} The sketch's regions could not be computed, so its profiles are blocked. Edit the sketch to try again, or Undo.`;
}

/** Whether `message` is the status line `failSketchLiveRegions` composed from `diagnostics`. */
function isLiveRegionsFailedText(
  diagnostics: readonly SketchSolveDiagnostic[],
  message: string | null,
) {
  return (
    message !== null &&
    diagnostics.some(
      (diagnostic) =>
        diagnostic.code === LIVE_REGIONS_DERIVATION_FAILED_CODE &&
        liveRegionsFailedText(diagnostic.message) === message,
    )
  );
}

/**
 * An accepted solve: solved, with every constraint status accepted. Live
 * regions derive only from one; pick and snap read a snapshot's spline spans
 * only from one (otherwise the authored reconstruction the display draws).
 */
export function isAcceptedSketchSolve(solvedSnapshot: SolvedSketchSnapshot) {
  return (
    solvedSnapshot.status.solveState === "solved" &&
    solvedSnapshot.constraintStatuses.every((entry) =>
      isAcceptedConstraintStatus(entry.status),
    )
  );
}

/**
 * T10g-1 (design review R-6): the live solve is accepted and was
 * established for the current authored definition (every definition change
 * goes through `withLiveSolveBasis`, which records it).
 */
export function hasAcceptedLiveSolveOfDefinition(session: SketchSessionState) {
  return (
    session.liveSolve !== null &&
    session.liveSolve.accepted &&
    session.liveSolve.sourceDefinition === session.definition
  );
}

/**
 * T13i (D24): the exact spline intersections the snap offers now: those of
 * the answered stages of the cache of the accepted live solve of the
 * current definition (review A-3); none for a stale basis.
 */
export function getSketchSessionSnapIntersections(
  session: SketchSessionState,
): readonly SketchExactIntersection[] {
  const cache = session.snapIntersections;
  return cache &&
    hasAcceptedLiveSolveOfDefinition(session) &&
    cache.solvedSnapshot === session.liveSolve!.solvedSnapshot
    ? cache.intersections
    : [];
}

/**
 * Empty/image-only sketches intentionally persist as notEvaluated. They owe
 * no region derivation, but must replace a previous sketch's/undo's fills
 * with a current empty set rather than an unsolved-constraint warning.
 * Do not extend this exemption to unresolved geometry or requirements.
 */
function isUnevaluatedEmptySketch(
  definition: DerivableSketchDefinition,
  snapshot: SolvedSketchSnapshot,
) {
  return (
    isUnevaluatedMetadataOnlySketch(definition, snapshot) &&
    sketchProfileGateFailures(snapshot).length === 0 &&
    !snapshot.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  );
}

/**
 * Establishes a new live solve basis: solves synchronously and kernel-free
 * (reusing the cached solve), bumps the live region generation and marks the
 * regions pending (accepted solve) or unavailable. Regions are derived
 * asynchronously by the editor's `sketch.deriveRegions` effect; the last
 * published regions stay as stale display until then.
 */
export function withLiveSolveBasis(
  session: SketchSessionState,
  definition: SketchDefinition,
  solvedSnapshot?: SolvedSketchSnapshot,
): SketchSessionState {
  const settings = getSketchSessionDerivationSettings(session);
  const evaluatedDefinition = evaluateSketchDerivations({
    definition: resolveSketchDefinitionForSolve(
      definition,
      session.documentVariables,
    ),
    ...settings,
  }).definition;
  let usableSolvedSnapshot = solvedSnapshot;
  if (!usableSolvedSnapshot) {
    // The evaluation is memoized on (definition, τ, plan hints), so an equal
    // evaluated definition identity implies the same hints.
    if (
      cachedSolveDefinition === evaluatedDefinition &&
      cachedSolveProjectedRefs === session.projectedReferences &&
      cachedSolveTolerances === session.solverTolerances &&
      cachedSolveModelingTolerance === session.modelingTolerance &&
      cachedSolveResult
    ) {
      usableSolvedSnapshot = cachedSolveResult;
    } else {
      usableSolvedSnapshot = solveSketchDefinitionCore({
        definition: evaluatedDefinition,
        projectedReferences: session.projectedReferences,
        tolerances: session.solverTolerances,
        ...settings,
        partialSolvePolicy: "bestEffort",
      }).solvedSnapshot;
      cachedSolveDefinition = evaluatedDefinition;
      cachedSolveProjectedRefs = session.projectedReferences;
      cachedSolveTolerances = session.solverTolerances;
      cachedSolveModelingTolerance = session.modelingTolerance;
      cachedSolveResult = usableSolvedSnapshot;
    }
  }

  const accepted = isAcceptedSketchSolve(usableSolvedSnapshot);
  // T15b (review O-1): a failed mirror keeps the solve accepted (drags,
  // snaps and edits elsewhere stay available) but blocks every profile of
  // the sketch at once, so the invalid sketch is explained like any other
  // (T16b: the sketch-wide profile gate).
  // T17c3 (issue 08): a spline with a degenerate span (two consecutive fit
  // points solved to the same place) blocks them the same way, as its
  // authored validation error does when the definition is re-solved.
  const regionsAvailable =
    accepted &&
    sketchProfileGateFailures(usableSolvedSnapshot).length === 0 &&
    getSketchDegenerateSplineSpans(evaluatedDefinition, usableSolvedSnapshot)
      .length === 0;
  const generation = session.liveRegions.generation + 1;
  return {
    ...session,
    // T17o (A-6): a new round replaces a failed one's status line.
    ...(isLiveRegionsFailedText(
      session.liveRegions.diagnostics,
      session.validationMessage,
    )
      ? { validationMessage: null }
      : {}),
    liveSolve: {
      sourceDefinition: definition,
      definition: evaluatedDefinition,
      projectedReferences: session.projectedReferences,
      solvedSnapshot: usableSolvedSnapshot,
      accepted,
    },
    liveRegions: isUnevaluatedEmptySketch(
      evaluatedDefinition,
      usableSolvedSnapshot,
    )
      ? {
          generation,
          status: "current",
          regions: [],
          boundaryBasis: null,
          diagnostics: [],
        }
      : regionsAvailable
        ? {
            ...session.liveRegions,
            generation,
            status: "pending",
            // Synthetic unavailable/failed diagnostics describe the prior status only.
            diagnostics: session.liveRegions.diagnostics.filter(
              (diagnostic) =>
                diagnostic.code !== LIVE_REGIONS_UNAVAILABLE_DIAGNOSTIC.code &&
                diagnostic.code !== LIVE_REGIONS_DERIVATION_FAILED_CODE,
            ),
          }
        : {
            generation,
            status: "unavailable",
            regions: session.liveRegions.regions,
            boundaryBasis: session.liveRegions.boundaryBasis,
            diagnostics: [LIVE_REGIONS_UNAVAILABLE_DIAGNOSTIC],
          },
  };
}

/**
 * T17c3 (issue 08 :107): the splines of `definition` whose solved
 * reconstruction has a zero-length span (two consecutive fit points at the
 * same solved place), each with its first such span. The span stays
 * authored; it is reported and blocks the sketch's profiles.
 */
export function getSketchDegenerateSplineSpans(
  definition: DerivableSketchDefinition,
  solvedSnapshot: SolvedSketchSnapshot,
): readonly {
  spline: Extract<SketchEntityDefinition, { kind: "spline" }>;
  message: string;
}[] {
  const labels = new Map(
    definition.points.map((point) => [point.pointId as string, point.label]),
  );
  return solvedSnapshot.solvedEntities.flatMap((solved) => {
    const spanIndex =
      solved.kind === "spline"
        ? solved.reconstruction.diagnostics.find(
            (diagnostic) => diagnostic.code === "coincident-points",
          )?.spanIndex
        : undefined;
    const spline =
      spanIndex === undefined
        ? undefined
        : definition.entities.find(
            (entity) => entity.entityId === solved.entityId,
          );
    return spanIndex === undefined || spline?.kind !== "spline"
      ? []
      : [
          {
            spline,
            message: describeDegenerateSplineSpan(spline, spanIndex, (id) =>
              labels.get(id),
            ),
          },
        ];
  });
}

/**
 * U-G3 / [TECH] G11: the accepted pair of a staged preview definition (the
 * same synchronous, kernel-free solve as a live basis), for its background
 * offset publication. Null when the preview's solve is not accepted: offsets
 * certify only from an accepted solve (U-G1).
 */
export function getSketchSessionPreviewBasis(
  session: SketchSessionState,
  definition: SketchDefinition,
): SketchLiveRegionBasis | null {
  const settings = getSketchSessionDerivationSettings(session);
  const evaluatedDefinition = evaluateSketchDerivations({
    definition: resolveSketchDefinitionForSolve(
      definition,
      session.documentVariables,
    ),
    ...settings,
  }).definition;
  const solvedSnapshot = solveSketchDefinitionCore({
    definition: evaluatedDefinition,
    projectedReferences: session.projectedReferences,
    tolerances: session.solverTolerances,
    ...settings,
    partialSolvePolicy: "bestEffort",
  }).solvedSnapshot;
  return isOffsetPublicationSolveAccepted(solvedSnapshot)
    ? {
        sketchId: session.sketchId ?? ("sketch_draft" as SketchId),
        definition: evaluatedDefinition,
        projectedReferences: session.projectedReferences,
        solvedSnapshot,
        modelingTolerance: session.modelingTolerance,
      }
    : null;
}

/** Basis for the async live region derivation, or null before the first live solve. */
export function getSketchSessionLiveRegionBasis(
  session: SketchSessionState,
): SketchLiveRegionBasis | null {
  if (!session.liveSolve) {
    return null;
  }

  return {
    sketchId: session.sketchId ?? ("sketch_draft" as SketchId),
    definition: session.liveSolve.definition,
    projectedReferences: session.liveSolve.projectedReferences,
    solvedSnapshot: session.liveSolve.solvedSnapshot,
    modelingTolerance: session.modelingTolerance,
  };
}

const samePlans = (
  first: SketchSessionState["offsetPlans"],
  second: SketchSessionState["offsetPlans"],
) => JSON.stringify(first ?? []) === JSON.stringify(second ?? []);

/**
 * Publishes regions and offset publications derived for the session's
 * current generation ([TECH] G1/G3/G7/G17). A `planChanged` round re-solves
 * the live basis ONCE with the certified hints (passed unchanged; a second
 * disagreement fails closed in publish, and a `planChanged` of the re-solve
 * round fails closed here) and stays pending for the new generation; later
 * solves carry those hints as `published` (review A1). Otherwise the certified relationships' shells are marked
 * `certified` in the live solve, their published plans seed the next solves,
 * and failures stay relationship-scoped display diagnostics ([TECH] G16).
 */
export function publishSketchLiveRegions(
  session: SketchSessionState,
  regions: RegionRecord[],
  diagnostics: SketchSolveDiagnostic[],
  roundPublications: readonly SketchOffsetPublicationRecord[] = [],
): SketchSessionState {
  // [TECH] G3: a re-solve round never asks for another re-solve.
  const offsetPublications =
    session.liveSolve && isOffsetReplanRound(session.liveSolve.solvedSnapshot)
      ? closeOffsetReplanRound(session.liveSolve.definition, roundPublications)
      : roundPublications;
  const hints = offsetReplanHints(offsetPublications);
  if (hints && session.liveSolve)
    return {
      ...withLiveSolveBasis(
        { ...session, offsetPlans: hints },
        session.definition,
      ),
      // Review A1: the certifier's hints serve this one re-solve only.
      offsetPlans: carriedOffsetPlans(hints),
    };
  const published = publishedOffsetPlans(offsetPublications);
  const liveSolve = session.liveSolve && {
    ...session.liveSolve,
    solvedSnapshot: applyOffsetPublications(
      session.liveSolve.definition,
      session.liveSolve.solvedSnapshot,
      offsetPublications,
    ),
  };
  const next: SketchSessionState = {
    ...session,
    ...(liveSolve ? { liveSolve } : {}),
    offsetPlans: samePlans(published, session.offsetPlans)
      ? session.offsetPlans
      : published,
    offsetPublicationDiagnostics:
      offsetPublicationDiagnostics(offsetPublications),
    liveRegions: {
      generation: session.liveRegions.generation,
      status: "current",
      regions,
      // R2: the regions were derived from this accepted pair (publications
      // applied, as the solver adapter's arrangement read it).
      boundaryBasis: liveRegionBasis(liveSolve, regions),
      diagnostics,
    },
  };
  // T17c6 (D-2): a withheld region the user had, or a closed outline left
  // without one, is explained on the status line (not only the preview
  // label). Review A-4: once nothing qualifies, the explanation this owner
  // set is cleared; other owners' messages are kept.
  const withheld = describeSketchSessionWithheldRegions(
    next,
    session.liveRegions.regions,
  );
  return {
    ...next,
    validationMessage:
      withheld ??
      (isSketchWithheldRegionText(
        session.liveRegions.diagnostics,
        session.validationMessage,
      )
        ? null
        : session.validationMessage),
  };
}

/**
 * Review A-1: published regions always carry their pair; a region set with
 * no live solve to bind it to cannot be published (a derivation request
 * needs a live solve), so it is an invariant breach, not a null basis.
 */
function liveRegionBasis(
  liveSolve: SketchSessionState["liveSolve"],
  regions: readonly RegionRecord[],
) {
  if (regions.length === 0) return null;
  if (!liveSolve)
    throw new Error("Live regions were published without a live solve.");
  return createRegionBoundaryBasis(liveSolve, regions);
}

/** Records a failed live derivation; the last regions stay as invalid display. */
export function failSketchLiveRegions(
  session: SketchSessionState,
  message: string,
): SketchSessionState {
  return {
    ...session,
    // T17o (E10, review A-6): a failed derivation (e.g. the derivation
    // worker's transport failing) is shown on the status line, not only on
    // the debug preview label; the next published round clears it.
    validationMessage: liveRegionsFailedText(message),
    liveRegions: {
      ...session.liveRegions,
      status: "failed",
      diagnostics: [
        {
          code: LIVE_REGIONS_DERIVATION_FAILED_CODE,
          severity: "error",
          message,
          target: null,
        },
      ],
    },
  };
}

const liveRegionBoundaryDiagnostics = new WeakMap<
  SketchLiveRegions,
  readonly SketchSolveDiagnostic[]
>();

/**
 * Review R-3: a displayed live region whose boundary does not resolve
 * against its own basis (or has none) gets a region-scoped
 * `profile-boundary-unresolved` error, as measurement and export report the
 * same failure, instead of silently losing its fill. Pairing makes this an
 * invariant breach; the diagnostic keeps it visible. Cached per
 * `liveRegions` object (immutable).
 */
export function getLiveRegionBoundaryDiagnostics(
  liveRegions: SketchLiveRegions,
): readonly SketchSolveDiagnostic[] {
  const cached = liveRegionBoundaryDiagnostics.get(liveRegions);
  if (cached) return cached;
  const { boundaryBasis: basis } = liveRegions;
  const diagnostics = liveRegions.regions.flatMap(
    (region): SketchSolveDiagnostic[] => {
      const failure = basis
        ? region.loops
            .flatMap((loop) => loop.segments)
            .map((segment) => resolveRegionBoundaryCurve(basis, segment))
            .find((result) => result.kind === "failed")
        : undefined;
      if (basis && !failure) return [];
      return [
        {
          code: "profile-boundary-unresolved",
          severity: "error",
          message: failure
            ? `${region.label} cannot be drawn: ${failure.message}`
            : `profile-boundary-unresolved: ${region.label} has no boundary basis, so it cannot be drawn.`,
          target: { kind: "region", regionId: region.regionId },
        },
      ];
    },
  );
  liveRegionBoundaryDiagnostics.set(liveRegions, diagnostics);
  return diagnostics;
}

export function getSketchSessionRegionDiagnostics(session: SketchSessionState) {
  return getSketchSessionDerivedValidity(session).diagnostics;
}

export function getSketchSessionSolvedSnapshot(
  session: SketchSessionState,
): SolvedSketchSnapshot | null {
  return session.liveSolve?.solvedSnapshot ?? null;
}

/**
 * T17g3 (G1, review G-1): the solve of a session that is not solved yet (the
 * opened session, before the entry establishes its live solve): not
 * evaluated, with no solved geometry and no statuses, so it certifies no
 * offset and fails no relationship. Readers draw the authored geometry and
 * claim nothing current from it.
 */
export const SKETCH_NOT_SOLVED_YET: SolvedSketchSnapshot = Object.freeze({
  schemaVersion: SOLVED_SKETCH_SCHEMA_VERSION,
  status: Object.freeze({
    solveState: "notEvaluated" as const,
    constraintState: "unknown" as const,
  }),
  // T17o (T17g3 ADV-2): shared by every unsolved session, so frozen (an
  // in-place mutation throws instead of corrupting them all).
  solvedEntities: frozenEmpty<SolvedSketchSnapshot["solvedEntities"]>(),
  solvedPoints: frozenEmpty<SolvedSketchSnapshot["solvedPoints"]>(),
  constraintStatuses: frozenEmpty<SolvedSketchSnapshot["constraintStatuses"]>(),
  dimensionStatuses: frozenEmpty<SolvedSketchSnapshot["dimensionStatuses"]>(),
  diagnostics: frozenEmpty<SolvedSketchSnapshot["diagnostics"]>(),
});

function frozenEmpty<T extends unknown[]>(): T {
  return Object.freeze([]) as unknown as T;
}

/**
 * Display validity of the session's live regions: pending is stale; not
 * accepted, unavailable or failed is invalid. Never a consumption gate.
 * T17g3 (G1): without a live solve (an opened session, review G-1) nothing
 * is judged yet, so it is stale, never current.
 */
export function getSketchSessionDerivedValidity(
  session: SketchSessionState,
): SketchDerivedValidity {
  const { liveRegions, liveSolve } = session;
  const regionDiagnostics = mergeSketchSolveDiagnostics(
    liveRegions.diagnostics,
    getLiveRegionBoundaryDiagnostics(liveRegions),
  );
  if (!liveSolve) return { state: "stale", diagnostics: regionDiagnostics };
  if (liveRegions.status === "current") {
    if (
      isUnevaluatedEmptySketch(liveSolve.definition, liveSolve.solvedSnapshot) &&
      !regionDiagnostics.some((diagnostic) => diagnostic.severity === "error")
    ) {
      return {
        state: "current",
        diagnostics: mergeSketchSolveDiagnostics(
          liveSolve.solvedSnapshot.diagnostics,
          regionDiagnostics,
        ),
      };
    }
    return withRelationshipScopedDiagnostics(
      deriveSketchValidity({
        solvedSnapshot: liveSolve.solvedSnapshot,
        diagnostics: regionDiagnostics,
      }),
      session.offsetPublicationDiagnostics ?? [],
    );
  }

  const diagnostics = mergeSketchSolveDiagnostics(
    liveSolve.solvedSnapshot.diagnostics,
    regionDiagnostics,
  );
  return liveRegions.status === "pending"
    ? { state: "stale", diagnostics }
    : { state: "invalid", diagnostics };
}

export function getHistorySequence(id: string) {
  const match = id.match(/_(\d+)_/);
  const parsed = match ? Number.parseInt(match[1], 10) : Number.NaN;
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

export function getDefinitionSketchId(definition: SketchDefinition) {
  return (
    definition.entities[0]?.target.sketchId ??
    definition.points[0]?.target.sketchId ??
    ("sketch_draft" as SketchId)
  );
}

export function getNextDefinitionSequence(definition: SketchDefinition) {
  const ids = [
    ...definition.referenceIds,
    ...definition.pointIds,
    ...definition.entityIds,
    ...definition.constraintIds,
    ...definition.dimensionIds,
  ];

  let highestSequence = 0;

  for (const id of ids) {
    const match = id.match(/_(\d+)_/);
    const parsed = match ? Number.parseInt(match[1], 10) : Number.NaN;

    if (!Number.isNaN(parsed)) {
      highestSequence = Math.max(highestSequence, parsed);
    }
  }

  return highestSequence;
}

export const ADVANCED_DISPLAY_SAMPLE_COUNT = 64;
export const PROFILE_TEXT_WIDTH_FACTOR = 0.6;

export function sampleEllipseSketchPoints(
  center: SketchPoint,
  majorAxisEndpoint: SketchPoint,
  minorRadius: number,
  sampleCount: number,
): SketchPoint[] {
  const majorVector = [
    majorAxisEndpoint[0] - center[0],
    majorAxisEndpoint[1] - center[1],
  ] as const;
  const majorRadius = Math.hypot(majorVector[0], majorVector[1]);
  if (majorRadius <= Number.EPSILON || minorRadius <= 0) {
    return [];
  }

  const majorUnit = [
    majorVector[0] / majorRadius,
    majorVector[1] / majorRadius,
  ] as const;
  const minorUnit = [-majorUnit[1], majorUnit[0]] as const;

  return Array.from({ length: sampleCount }, (_, index) => {
    const angle = (Math.PI * 2 * index) / sampleCount;
    return [
      center[0] +
        Math.cos(angle) * majorRadius * majorUnit[0] +
        Math.sin(angle) * minorRadius * minorUnit[0],
      center[1] +
        Math.cos(angle) * majorRadius * majorUnit[1] +
        Math.sin(angle) * minorRadius * minorUnit[1],
    ] as const;
  });
}

export function normalizeSketchAngle(angle: number) {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

export function computeSketchArcSweep(
  startAngle: number,
  endAngle: number,
  sweepDirection: "clockwise" | "counterClockwise",
) {
  const start = normalizeSketchAngle(startAngle);
  const end = normalizeSketchAngle(endAngle);
  if (sweepDirection === "counterClockwise") {
    return end >= start ? end - start : end + Math.PI * 2 - start;
  }
  return end <= start ? start - end : start + Math.PI * 2 - end;
}

export function sampleEllipticalArcSketchPoints(
  center: SketchPoint,
  majorAxisEndpoint: SketchPoint,
  start: SketchPoint,
  end: SketchPoint,
  minorRadius: number,
  sweepDirection: "clockwise" | "counterClockwise",
  sampleCount: number,
): SketchPoint[] {
  const majorVector = [
    majorAxisEndpoint[0] - center[0],
    majorAxisEndpoint[1] - center[1],
  ] as const;
  const majorRadius = Math.hypot(majorVector[0], majorVector[1]);
  if (majorRadius <= Number.EPSILON || minorRadius <= 0) {
    return [];
  }

  const majorUnit = [
    majorVector[0] / majorRadius,
    majorVector[1] / majorRadius,
  ] as const;
  const minorUnit = [-majorUnit[1], majorUnit[0]] as const;
  const ellipseAngle = (point: SketchPoint) => {
    const delta = [point[0] - center[0], point[1] - center[1]] as const;
    return Math.atan2(
      (delta[0] * minorUnit[0] + delta[1] * minorUnit[1]) / minorRadius,
      (delta[0] * majorUnit[0] + delta[1] * majorUnit[1]) / majorRadius,
    );
  };
  const startAngle = ellipseAngle(start);
  const sweep = computeSketchArcSweep(
    startAngle,
    ellipseAngle(end),
    sweepDirection,
  );

  return Array.from({ length: sampleCount }, (_, index) => {
    const alpha = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    const angle =
      sweepDirection === "counterClockwise"
        ? startAngle + sweep * alpha
        : startAngle - sweep * alpha;
    return [
      center[0] +
        Math.cos(angle) * majorRadius * majorUnit[0] +
        Math.sin(angle) * minorRadius * minorUnit[0],
      center[1] +
        Math.cos(angle) * majorRadius * majorUnit[1] +
        Math.sin(angle) * minorRadius * minorUnit[1],
    ] as const;
  });
}

export function sampleConicSketchPoints(
  start: SketchPoint,
  control: SketchPoint,
  end: SketchPoint,
  rho: number,
  sampleCount: number,
): SketchPoint[] {
  return Array.from({ length: sampleCount }, (_, index) => {
    const t = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    const oneMinusT = 1 - t;
    const startWeight = oneMinusT * oneMinusT;
    const controlWeight = 2 * rho * oneMinusT * t;
    const endWeight = t * t;
    const weight = startWeight + controlWeight + endWeight;
    return [
      (startWeight * start[0] +
        controlWeight * control[0] +
        endWeight * end[0]) /
        weight,
      (startWeight * start[1] +
        controlWeight * control[1] +
        endWeight * end[1]) /
        weight,
    ] as const;
  });
}

export function sampleBezierSketchPoints(
  controlPoints: readonly SketchPoint[],
  sampleCount: number,
): SketchPoint[] {
  return Array.from({ length: sampleCount }, (_, index) => {
    const t = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    const oneMinusT = 1 - t;
    if (controlPoints.length === 3) {
      const [p0, p1, p2] = controlPoints;
      return [
        oneMinusT * oneMinusT * p0![0] +
          2 * oneMinusT * t * p1![0] +
          t * t * p2![0],
        oneMinusT * oneMinusT * p0![1] +
          2 * oneMinusT * t * p1![1] +
          t * t * p2![1],
      ] as const;
    }

    const [p0, p1, p2, p3] = controlPoints;
    return [
      oneMinusT ** 3 * p0![0] +
        3 * oneMinusT * oneMinusT * t * p1![0] +
        3 * oneMinusT * t * t * p2![0] +
        t ** 3 * p3![0],
      oneMinusT ** 3 * p0![1] +
        3 * oneMinusT * oneMinusT * t * p1![1] +
        3 * oneMinusT * t * t * p2![1] +
        t ** 3 * p3![1],
    ] as const;
  });
}

export function sampleProfileTextSketchOutline(
  entity: Extract<SketchEntityDefinition, { kind: "profileText" }>,
  anchor: SketchPoint,
): SketchPoint[] {
  const width = Math.max(
    entity.height * PROFILE_TEXT_WIDTH_FACTOR,
    entity.text.trim().length * entity.height * PROFILE_TEXT_WIDTH_FACTOR,
  );
  const x =
    entity.horizontalAlign === "center"
      ? -width / 2
      : entity.horizontalAlign === "right"
        ? -width
        : 0;
  const y =
    entity.verticalAlign === "middle"
      ? -entity.height / 2
      : entity.verticalAlign === "top"
        ? -entity.height
        : entity.verticalAlign === "baseline"
          ? -entity.height * 0.2
          : 0;
  const cos = Math.cos(entity.rotationRadians);
  const sin = Math.sin(entity.rotationRadians);

  return [
    [x, y],
    [x + width, y],
    [x + width, y + entity.height],
    [x, y + entity.height],
  ].map(
    (point) =>
      [
        anchor[0] + point[0]! * cos - point[1]! * sin,
        anchor[1] + point[0]! * sin + point[1]! * cos,
      ] as const,
  );
}

export function mapDefinitionEntityToDraftEntity(
  sketchId: SketchId,
  points: SketchPointDefinition[],
  entity: SketchEntityDefinition,
): SketchDraftEntity[] {
  const pointById = new Map(
    points.map((point) => [point.pointId, point.position] as const),
  );

  if (entity.kind === "lineSegment") {
    const start = pointById.get(entity.startPointId);
    const end = pointById.get(entity.endPointId);

    if (!start || !end) {
      return [];
    }

    return [
      {
        id: entity.entityId,
        kind: "line",
        start,
        end,
        entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
        status: "accepted",
        label: entity.label,
        isConstruction: entity.isConstruction,
      },
    ];
  }

  if (entity.kind === "point") {
    const point = pointById.get(entity.pointId);

    if (!point) {
      return [];
    }

    return [
      {
        id: entity.entityId,
        kind: "circle",
        center: point,
        radius: 0.1,
        entityId: entity.entityId,
        status: "accepted",
        label: entity.label,
        isConstruction: entity.isConstruction,
      },
    ];
  }

  if (entity.kind === "circle") {
    const center = pointById.get(entity.centerPointId);

    if (!center) {
      return [];
    }

    return [
      {
        id: entity.entityId,
        kind: "circle",
        center,
        radius: entity.radius,
        entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
        status: "accepted",
        label: entity.label,
        isConstruction: entity.isConstruction,
      },
    ];
  }

  if (entity.kind === "arc") {
    const center = pointById.get(entity.centerPointId);
    const start = pointById.get(entity.startPointId);
    const end = pointById.get(entity.endPointId);

    if (!center || !start || !end) {
      return [];
    }

    return [
      {
        id: entity.entityId,
        kind: "polyline",
        points: sampleArcPoints(center, start, end, entity.sweepDirection),
        isClosed: false,
        entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
        status: "accepted",
        label: entity.label,
        isConstruction: entity.isConstruction,
      },
    ];
  }

  if (entity.kind === "spline") {
    const positions = Object.fromEntries(pointById) as Record<
      SketchPointId,
      SketchPoint
    >;
    const splinePoints = tessellateCubicSpans(
      reconstructSplineAggregate(entity, positions).spans,
    );

    if (splinePoints.length < 2) {
      return [];
    }

    return [
      {
        id: entity.entityId,
        kind: "spline",
        points: splinePoints,
        entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
        status: "accepted",
        label: entity.label,
        isConstruction: entity.isConstruction,
      },
    ];
  }

  if (entity.kind === "ellipse") {
    const center = pointById.get(entity.centerPointId);
    const major = pointById.get(entity.majorAxisPointId);
    const sampled =
      center && major
        ? sampleEllipseSketchPoints(
            center,
            major,
            entity.minorRadius,
            ADVANCED_DISPLAY_SAMPLE_COUNT,
          )
        : [];
    return sampled.length > 0
      ? [
          {
            id: entity.entityId,
            kind: "polyline",
            points: sampled,
            isClosed: true,
            entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
            status: "accepted",
            label: entity.label,
            isConstruction: entity.isConstruction,
          },
        ]
      : [];
  }

  if (entity.kind === "ellipticalArc") {
    const center = pointById.get(entity.centerPointId);
    const major = pointById.get(entity.majorAxisPointId);
    const start = pointById.get(entity.startPointId);
    const end = pointById.get(entity.endPointId);
    const sampled =
      center && major && start && end
        ? sampleEllipticalArcSketchPoints(
            center,
            major,
            start,
            end,
            entity.minorRadius,
            entity.sweepDirection,
            ADVANCED_DISPLAY_SAMPLE_COUNT,
          )
        : [];
    return sampled.length > 0
      ? [
          {
            id: entity.entityId,
            kind: "polyline",
            points: sampled,
            isClosed: false,
            entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
            status: "accepted",
            label: entity.label,
            isConstruction: entity.isConstruction,
          },
        ]
      : [];
  }

  if (entity.kind === "conic") {
    const start = pointById.get(entity.startPointId);
    const control = pointById.get(entity.controlPointId);
    const end = pointById.get(entity.endPointId);
    const sampled =
      start && control && end
        ? sampleConicSketchPoints(
            start,
            control,
            end,
            entity.rho,
            ADVANCED_DISPLAY_SAMPLE_COUNT,
          )
        : [];
    return sampled.length > 0
      ? [
          {
            id: entity.entityId,
            kind: "polyline",
            points: sampled,
            isClosed: false,
            entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
            status: "accepted",
            label: entity.label,
            isConstruction: entity.isConstruction,
          },
        ]
      : [];
  }

  if (entity.kind === "bezierCurve") {
    const controlPoints = entity.controlPointIds.flatMap((pointId) => {
      const point = pointById.get(pointId);
      return point ? [point] : [];
    });
    const sampled =
      controlPoints.length === entity.controlPointIds.length
        ? sampleBezierSketchPoints(controlPoints, ADVANCED_DISPLAY_SAMPLE_COUNT)
        : [];
    return sampled.length > 0
      ? [
          {
            id: entity.entityId,
            kind: "polyline",
            points: sampled,
            isClosed: false,
            entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
            status: "accepted",
            label: entity.label,
            isConstruction: entity.isConstruction,
          },
        ]
      : [];
  }

  if (entity.kind === "profileText") {
    const anchor = pointById.get(entity.anchorPointId);
    return anchor
      ? [
          {
            id: entity.entityId,
            kind: "polyline",
            points: sampleProfileTextSketchOutline(entity, anchor),
            isClosed: true,
            entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
            status: "accepted",
            label: entity.label,
            isConstruction: entity.isConstruction,
          },
        ]
      : [];
  }

  return [];
}

export function createPointDefinition(
  sketchId: SketchId,
  pointId: SketchPointId,
  label: string,
  position: SketchPoint,
  isConstruction = false,
): SketchPointDefinition {
  return {
    pointId,
    label,
    target: createSketchPointRef(sketchId, pointId),
    position,
    isConstruction,
  };
}

export function createLineEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  startPointId: SketchPointId,
  endPointId: SketchPointId,
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: "lineSegment",
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    startPointId,
    endPointId,
  };
}

export function createPointEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  pointId: SketchPointId,
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: "point",
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    pointId,
  };
}

export function createCircleEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  centerPointId: SketchPointId,
  radius: number,
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: "circle",
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    centerPointId,
    radius,
  };
}

export function createArcEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  centerPointId: SketchPointId,
  startPointId: SketchPointId,
  endPointId: SketchPointId,
  sweepDirection: "clockwise" | "counterClockwise",
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: "arc",
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    centerPointId,
    startPointId,
    endPointId,
    sweepDirection,
  };
}

export function createSplineEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  pointIds: readonly SketchPointId[],
  isConstruction = false,
): SketchEntityDefinition {
  const pointOccurrences = pointIds.map((pointId) => ({
    occurrenceId: `spline_occurrence_${crypto.randomUUID()}`,
    pointId,
    tangent: { kind: "automatic" } as const,
  }));
  return {
    kind: "spline",
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    pointOccurrenceIds: pointOccurrences.map(
      (occurrence) => occurrence.occurrenceId,
    ),
    pointOccurrences,
    closure: "open",
    interpolationPolicy: "centripetal-mean-arm-v1",
  };
}

export function createEllipseEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  centerPointId: SketchPointId,
  majorAxisPointId: SketchPointId,
  minorRadius: number,
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: "ellipse",
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    centerPointId,
    majorAxisPointId,
    minorRadius,
  };
}

export function createEllipticalArcEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  centerPointId: SketchPointId,
  majorAxisPointId: SketchPointId,
  startPointId: SketchPointId,
  endPointId: SketchPointId,
  minorRadius: number,
  sweepDirection: "clockwise" | "counterClockwise",
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: "ellipticalArc",
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    centerPointId,
    majorAxisPointId,
    startPointId,
    endPointId,
    minorRadius,
    sweepDirection,
  };
}

export function createConicEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  startPointId: SketchPointId,
  controlPointId: SketchPointId,
  endPointId: SketchPointId,
  rho: number,
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: "conic",
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    startPointId,
    controlPointId,
    endPointId,
    rho,
  };
}

export function createBezierCurveEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  controlPointIds: readonly SketchPointId[],
  degree: 2 | 3,
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: "bezierCurve",
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    controlPointIds,
    degree,
  };
}

export function createProfileTextEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  anchorPointId: SketchPointId,
  text: string,
  height: number,
  rotationRadians: number,
  horizontalAlign: "left" | "center" | "right",
  verticalAlign: "baseline" | "middle" | "top" | "bottom",
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: "profileText",
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    anchorPointId,
    text,
    height,
    rotationRadians,
    horizontalAlign,
    verticalAlign,
  };
}

export function appendDefinition(
  definition: SketchDefinition,
  patch: SketchToolCommitContribution,
): SketchDefinition {
  return {
    ...definition,
    schemaVersion: definition.schemaVersion,
    referenceIds: [...definition.referenceIds],
    references: [...definition.references],
    pointIds: [
      ...definition.pointIds,
      ...patch.points.map((point) => point.pointId),
    ],
    points: [...definition.points, ...patch.points],
    entityIds: [
      ...definition.entityIds,
      ...patch.entities.map((entity) => entity.entityId),
    ],
    entities: [...definition.entities, ...patch.entities],
    constraintIds: [
      ...definition.constraintIds,
      ...(patch.constraints ?? []).map((constraint) => constraint.constraintId),
    ],
    constraints: [...definition.constraints, ...(patch.constraints ?? [])],
    dimensionIds: [
      ...definition.dimensionIds,
      ...(patch.dimensions ?? []).map((dimension) => dimension.dimensionId),
    ],
    dimensions: [...definition.dimensions, ...(patch.dimensions ?? [])],
    styleIds: definition.styleIds ? [...definition.styleIds] : undefined,
    styles: definition.styles ? [...definition.styles] : undefined,
    svgRenderingEnabled: definition.svgRenderingEnabled ?? false,
    derivedRelationships: [
      ...(definition.derivedRelationships ?? []),
      ...(patch.derivedRelationships ?? []),
    ],
  };
}

export function applySketchContribution(
  session: SketchSessionState,
  patch: SketchToolCommitContribution,
) {
  return { definition: appendDefinition(session.definition, patch) };
}

export function rebuildSessionForDefinition(
  session: SketchSessionState,
  input: { definition: SketchDefinition },
): SketchSessionState {
  const definition = cloneDefinition(input.definition);
  const rebuilt = reconcileSketchToolDraft(
    withLiveSolveBasis(
      {
        ...session,
        definition,
        projectedReferences: mergeDerivedProjectedReferences(
          definition,
          session.projectedReferences,
        ),
        toolStagedEntities: [],
        activeAnnotationEdit: null,
        activeEditTarget: null,
        activeDrag: null,
        commitRequest: rebuildSessionCommitRequest(session, definition),
      },
      definition,
    ),
  );
  return {
    ...rebuilt,
    validationMessage:
      rebuilt.liveRegions.status === "unavailable"
        ? (getSketchSessionInvalidFeedback(rebuilt) ??
          "Sketch profiles are unavailable until the sketch is corrected.")
        : null,
  };
}

/**
 * T16f ([TECH] T16-11, review R-7e): the relationships the session's live
 * solve failed (T16b's gate). Null without a live solve: mirror health is
 * unknown, so no dimension routes and no geometry links.
 */
export function getSketchSessionMirrorHealth(
  session: Pick<SketchSessionState, "liveSolve">,
): ReadonlySet<string> | null {
  const snapshot = session.liveSolve?.solvedSnapshot;
  return snapshot ? new Set(snapshot.failedDerivationIds ?? []) : null;
}

/**
 * T16f ([TECH] T16-11/T16-12): the driving dimensions that size the same
 * mirrored quantity as `dimension` through healthy mirrors, the tie-break
 * (definition order) first; none without a live solve.
 */
export function getSketchSessionSharedMirrorDimensions(
  session: Pick<SketchSessionState, "definition" | "liveSolve">,
  dimension: DimensionDefinition,
): readonly MirrorDimensionCorrespondence[] {
  const health = getSketchSessionMirrorHealth(session);
  return health
    ? correspondingMirrorDimensions(session.definition, dimension, health)
    : [];
}

/**
 * T16f ([TECH] T16-12, review A-9): every domain commit that would author a
 * second driving record of one mirrored quantity is refused with this text.
 */
export function sharedMirrorDriverRefusal(
  driver: MirrorDimensionCorrespondence,
): string {
  return `Already driven by ${driver.dimension.label} (${describeSharedMirrorPath(driver.mirrors)}); edit that dimension instead.`;
}

/** T16f: "mirror ‘a’", or "mirrors ‘a’ and ‘b’" along a chain (each named once). */
export function describeSharedMirrorPath(
  mirrors: MirrorDimensionCorrespondence["mirrors"],
): string {
  // A shortest path may pass a mirror twice (T16f review R-1): named once.
  const names = [...new Set(mirrors.map((mirror) => `‘${mirror.label}’`))];
  return names.length === 1
    ? `mirror ${names[0]}`
    : `mirrors ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * T13c (D7, review R-2): the one invalid-sketch feedback text: the conflict
 * explanation when requirements are unsatisfied, else the first non-info
 * diagnostic of the session's derived validity; T17c3: a degenerate spline
 * span is named before a first diagnostic that is only a warning (the solve
 * reports it as an error only when the authored definition is re-solved).
 * Used after commits, Undo/Redo, reopen (projection re-basing) and by the
 * preview label, so every path shows the same text for the same invalid
 * state.
 */
export function getSketchSessionInvalidFeedback(
  session: SketchSessionState,
  subjectIds: readonly string[] = [],
  commitCausedInvalidity = false,
): string | null {
  // T17e (O-1): a requirement naming geometry that no longer exists (a peer
  // merge keeps it, never retargeted) is explained as that, by label, not
  // as an unsatisfiable value. Review R-1: it is not a value conflict, so
  // it never joins the conflict list, and a conflict the user's own change
  // (`subjectIds`) caused is still explained first.
  const missing = (session.liveSolve?.solvedSnapshot.diagnostics ?? []).flatMap(
    (diagnostic) => {
      if (
        diagnostic.severity !== "error" ||
        !diagnostic.code.startsWith("missing-")
      )
        return [];
      const target = diagnostic.target;
      const id =
        target?.kind === "constraint"
          ? target.constraintId
          : target?.kind === "dimension"
            ? target.dimensionId
            : null;
      const label = id
        ? [...session.definition.constraints, ...session.definition.dimensions]
            .map((requirement) =>
              "dimensionId" in requirement
                ? ([requirement.dimensionId, requirement.label] as const)
                : ([requirement.constraintId, requirement.label] as const),
            )
            .find(([candidate]) => candidate === id)?.[1]
        : undefined;
      return id && label !== undefined
        ? [{ id: id as string, label, message: diagnostic.message }]
        : [];
    },
  );
  const conflict = describeSketchSessionUnsatisfiedRequirements(
    session,
    subjectIds,
    commitCausedInvalidity,
    new Set(missing.map((entry) => entry.id)),
  );
  // A value conflict left by the user's own change (any subject that is
  // not itself a missing reference) is explained first.
  const subjectConflict = subjectIds.some(
    (id) => !missing.some((entry) => entry.id === id),
  );
  if (conflict && (subjectConflict || missing.length === 0)) return conflict;
  if (missing.length > 0) {
    // Review R-2: the recovery names the requirement(s), never "it".
    const labels = [...new Set(missing.map((entry) => `‘${entry.label}’`))];
    const named =
      labels.length === 1
        ? labels[0]
        : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
    return `${missing[0]!.message} The sketch is invalid; profiles from it are blocked. Delete ${named}, or Undo.`;
  }
  const first = getSketchSessionDerivedValidity(session).diagnostics.find(
    (diagnostic) => diagnostic.severity !== "info",
  );
  const live = session.liveSolve;
  return (
    (first?.severity === "error" ? first.message : undefined) ??
    (live
      ? getSketchDegenerateSplineSpans(live.definition, live.solvedSnapshot)[0]
          ?.message
      : undefined) ??
    first?.message ??
    null
  );
}

/**
 * T13c (D7): the conflict explanation of the session's live solve, naming
 * every requirement whose status is `unsatisfied` (never `constraintState`,
 * review A-1). `subjectIds` are the requirements the user just authored or
 * edited; an unsatisfied subject is named first, as the one that
 * conflicts. When `commitCausedInvalidity` (the sketch was accepted before
 * the commit), every subject is named first even if it reads satisfied
 * (T13e2: a conflict can leave the just-committed requirement satisfied and
 * its residual on the others, e.g. a corner angle against Horizontal and
 * Vertical); a commit into an already-invalid sketch never blames a
 * satisfied subject (review R-1). Null when no requirement is unsatisfied.
 */
export function describeSketchSessionUnsatisfiedRequirements(
  session: Pick<SketchSessionState, "definition" | "liveSolve">,
  subjectIds: readonly string[] = [],
  commitCausedInvalidity = false,
  /** T17e (review R-1): requirements naming removed geometry (no value conflict). */
  excludedIds: ReadonlySet<string> = new Set(),
): string | null {
  const snapshot = session.liveSolve?.solvedSnapshot;
  if (!snapshot) {
    return null;
  }
  const unsatisfiedIds = new Set<string>(
    [
      ...snapshot.constraintStatuses.flatMap((entry) =>
        entry.status === "unsatisfied" ? [entry.constraintId] : [],
      ),
      ...snapshot.dimensionStatuses.flatMap((entry) =>
        entry.status === "unsatisfied" ? [entry.dimensionId] : [],
      ),
    ].filter((id) => !excludedIds.has(id)),
  );
  if (unsatisfiedIds.size === 0) {
    return null;
  }
  const named = [
    ...session.definition.constraints.map((constraint) => ({
      id: constraint.constraintId as string,
      text: formatSketchRequirement(constraint),
    })),
    ...session.definition.dimensions.map((dimension) => ({
      id: dimension.dimensionId as string,
      text: formatSketchRequirement(dimension),
    })),
  ];
  const subjects = named.filter(
    (requirement) =>
      subjectIds.includes(requirement.id) &&
      (commitCausedInvalidity || unsatisfiedIds.has(requirement.id)),
  );
  const others = named.filter(
    (requirement) =>
      unsatisfiedIds.has(requirement.id) &&
      !subjectIds.includes(requirement.id),
  );
  const requirements = [...subjects, ...others];
  if (requirements.length === 0) {
    return null;
  }
  // T16f ([TECH] T16-13): two driving dimensions that size one mirrored
  // shape (a persisted duplicate) are explained as such.
  if (requirements.length === 2) {
    const [first, second] = requirements as [
      (typeof requirements)[number],
      (typeof requirements)[number],
    ];
    const dimension = session.definition.dimensions.find(
      (entry) => entry.dimensionId === first.id,
    );
    const shared = dimension
      ? getSketchSessionSharedMirrorDimensions(session, dimension).find(
          (entry) => entry.dimension.dimensionId === second.id,
        )
      : undefined;
    if (shared) {
      return `${first.text} and ${second.text} size the same mirrored shape (${describeSharedMirrorPath(shared.mirrors)}), so they conflict. The sketch is invalid; profiles from it are blocked. Change or delete one, make one a reference, or Undo.`;
    }
  }
  const list = (entries: typeof requirements) =>
    entries.map((entry) => entry.text).join(", ");
  const statement =
    requirements.length === 1
      ? `${requirements[0]!.text} cannot be satisfied.`
      : subjects.length > 0 && others.length > 0
        ? `${list(subjects)} ${subjects.length === 1 ? "conflicts" : "conflict"} with ${list(others)}.`
        : `${list(requirements)} conflict.`;
  return `${statement} The sketch is invalid; profiles from it are blocked. Change or delete ${requirements.length === 1 ? "it" : "one of them"}, or Undo.`;
}

function formatSketchRequirement(
  requirement: ConstraintDefinition | DimensionDefinition,
): string {
  const value =
    "dimensionId" in requirement
      ? requirement.kind === "arcStartPointCoincident" ||
        requirement.kind === "arcEndPointCoincident" ||
        isReferenceDimension(requirement)
        ? null
        : requirement.kind === "lineAngle"
          ? formatRequirementValue(requirement.valueRadians, "deg")
          : formatRequirementValue(requirement.value, "mm")
      : requirement.kind === "angle"
        ? formatRequirementValue(requirement.valueRadians, "deg")
        : null;
  return value === null ? requirement.label : `${requirement.label} (${value})`;
}

function formatRequirementValue(
  value: MaybeAuthoredValue<number> | undefined,
  unit: "mm" | "deg",
): string {
  if (value === undefined) {
    return "?";
  }
  if (isExpressionAuthoredValue(value)) {
    return value.valueText;
  }
  const literal = getAuthoredLiteralValue(value);
  if (literal === null) {
    return "?";
  }
  const display = unit === "deg" ? (literal * 180) / Math.PI : literal;
  const rounded = Number(display.toFixed(3));
  return unit === "deg" ? `${rounded}°` : `${rounded} mm`;
}

/**
 * Reconciles the armed drawing tool's draft with a restored definition
 * (T11-D12: Undo, Redo and every other restore). T13-D21: each placed
 * click's inference is recomputed through the owner at its raw position,
 * with its stored scale, against the restored geometry, so a point an Undo
 * moved or removed no longer pulls the commit; the click's position and
 * badge follow the recomputed inference. An active Line chain keeps its
 * records and is restaged from its committed prefix
 * (`restageSketchToolChain`).
 */
export function reconcileSketchToolDraft(
  session: SketchSessionState,
): SketchSessionState {
  const placements = session.toolPlacements ?? [];
  const reconciled: SketchSessionState = {
    ...session,
    activeInference: null,
    ...(placements.length > 0 && isDrawingSketchTool(session.activeTool)
      ? reinferSketchToolPlacements(session, session.activeTool, placements)
      : {}),
  };

  return session.toolChain && isSketchToolChainActive(session)
    ? restageSketchToolChain(reconciled, session.toolChain)
    : reconciled;
}

function reinferSketchToolPlacements(
  session: SketchSessionState,
  toolId: SketchToolId,
  placements: readonly PlacementInference[],
): Partial<SketchSessionState> {
  const toolDefinition = getSketchToolDefinition(toolId);
  const solvedSnapshot = getSketchSessionSolvedSnapshot(session);
  const recomputed = placements.map((placement, index) =>
    inferPlacement({
      toolId,
      role: placement.role,
      // R-7: a Tangent arc's first click re-picks its source structurally.
      ...(toolDefinition.structuralTangentSource && index === 0
        ? {
            tangentSource: {
              previousEntityId: session.toolTangentSourceEntityId ?? null,
            },
          }
        : {}),
      definition: session.definition,
      projectedReferences: session.projectedReferences,
      pointer: placement.rawPosition,
      solvedSnapshot,
      exactIntersections: getSketchSessionSnapIntersections(session),
      sketchUnitsPerPixel: placement.sketchUnitsPerPixel,
      // Only a Line end aligns to its start, and a Line end commits at once.
      anchor: null,
      activeCandidateKey: placement.candidate?.key ?? null,
      // T13-D22: a click placed free stays free.
      suppressed: placement.suppressed,
    }),
  );
  const positions = recomputed.map((placement) => placement.position);
  const pointerDownPoint = positions[0] ?? session.pointerDownPoint;
  const toolPlacedPoints =
    session.toolPlacedPoints.length > 0 ? positions : session.toolPlacedPoints;

  return {
    toolPlacements: recomputed,
    pointerDownPoint,
    toolPlacedPoints,
    // The badges show the recomputed inferences at once, without a pointer
    // move (T13g review RQ-1).
    toolPresentation: withPlacementPresentation(
      toolDefinition.getPresentation({
        status: session.status === "drawing" ? "drawing" : "idle",
        pointerDownPoint,
        livePoint: session.livePoint,
        placedPoints: toolPlacedPoints,
        settings: session.toolSettings,
        validationMessage: session.validationMessage,
      }),
      recomputed,
      null,
    ),
    ...(toolDefinition.structuralTangentSource
      ? {
          toolTangentSourceEntityId:
            recomputed[0]?.tangentSourceEntityId ?? null,
        }
      : {}),
  };
}

/**
 * The draft's placement badges (T13-D15): every placed click keeps its
 * snap glyph and inference text, so every requirement the commit will
 * author is visible before the final click; `active` is the live one.
 */
export function withPlacementPresentation(
  presentation: SketchToolPresentationSchema,
  placements: readonly PlacementInference[],
  active: PlacementInference | null,
): SketchToolPresentationSchema {
  const overlays = [
    ...(active?.suppressed && active.text
      ? [getSuppressedPlacementOverlay(active)]
      : active
        ? getPlacementOverlays("active-snap", active)
        : []),
    ...placements.flatMap((placement, index) =>
      getPlacementOverlays(`placement-${index + 1}-snap`, placement),
    ),
  ];

  return overlays.length === 0
    ? presentation
    : {
        ...presentation,
        overlays: [...(presentation.overlays ?? []), ...overlays],
      };
}

/**
 * T13-D22: the live placement under suppression says it is free where a
 * snap was available, at the raw pointer (it has no snap glyph).
 */
function getSuppressedPlacementOverlay(
  inference: PlacementInference,
): SketchToolOverlayDescriptor {
  return {
    id: "active-snap-suppressed",
    kind: "referenceLabel",
    label: inference.text,
    anchor: {
      kind: "sketchPoint",
      point: inference.rawPosition,
      offset: { x: 18, y: -18 },
    },
  };
}

/** T13-D22: Shift held or the "Snap & infer" toggle off. */
export function isSketchInferenceSuppressed(
  session: Pick<
    SketchSessionState,
    "inferenceSuppressionHeld" | "inferenceSuppressionToggled"
  >,
) {
  return Boolean(
    session.inferenceSuppressionHeld || session.inferenceSuppressionToggled,
  );
}

function getPlacementOverlays(
  id: string,
  inference: PlacementInference,
): SketchToolOverlayDescriptor[] {
  const { candidate } = inference;
  if (!candidate) {
    return [];
  }

  return [
    ...(inference.requirements.length > 0 || inference.tangentSourceEntityId
      ? [
          {
            id: `${id}-inferred-constraint`,
            kind: "constraintPreview" as const,
            label: "Inferred constraint",
            detail: inference.text,
            anchor: {
              kind: "sketchPoint" as const,
              point: candidate.point,
              offset: { x: 18, y: 18 },
            },
          },
        ]
      : []),
    {
      id,
      kind: "snapIndicator",
      label: inference.text,
      point: candidate.point,
      candidateKind: candidate.kind,
      glyphKind: candidate.preview.glyph,
    },
  ];
}

/**
 * Whether a chain is active: the armed tool chains its segments
 * (`lifecycle: "chain"`), is drawing, and has chain records (review R-1).
 */
export function isSketchToolChainActive(
  session: Pick<SketchSessionState, "activeTool" | "status" | "toolChain">,
) {
  return (
    Boolean(session.toolChain) &&
    session.status === "drawing" &&
    isDrawingSketchTool(session.activeTool) &&
    getSketchToolDefinition(session.activeTool).lifecycle === "chain"
  );
}

/**
 * The committed prefix of a chain: the longest prefix of its segments whose
 * entities all exist in the definition (T11-D12).
 */
export function getCommittedSketchToolChainSegments(
  chain: SketchToolChain,
  definition: SketchDefinition,
): SketchToolChain["segments"] {
  const missing = chain.segments.findIndex(
    (segment) =>
      !definition.entities.some(
        (entity) => entity.entityId === segment.entityId,
      ),
  );

  return missing === -1 ? chain.segments : chain.segments.slice(0, missing);
}

/**
 * Stages the next segment of a chain (T11-D11/D12): the draft starts at the
 * anchor, the end point of the last committed segment (or the chain start
 * when no segment is committed), at its current definition position. The
 * anchor is the draft's structural start (T13-D20: not a snap, never
 * suppressed), so the next segment reuses its id. A chain start whose point no longer exists keeps
 * only its position. The rubber band is restaged from `livePoint`.
 */
export function restageSketchToolChain(
  session: SketchSessionState,
  chain: SketchToolChain,
): SketchSessionState {
  if (!isDrawingSketchTool(session.activeTool)) {
    return session;
  }

  // The last committed segment's current end point (review A-1), else the
  // chain start.
  const lastSegment = getCommittedSketchToolChainSegments(
    chain,
    session.definition,
  ).at(-1);
  const lastEntity = session.definition.entities.find(
    (entity) => entity.entityId === lastSegment?.entityId,
  );
  const anchorPointId =
    lastEntity?.kind === "lineSegment"
      ? lastEntity.endPointId
      : chain.start.pointId;
  const anchorPoint = session.definition.points.find(
    (point) => point.pointId === anchorPointId,
  );
  const anchor = anchorPoint?.position ?? chain.start.position;
  const result = getSketchToolDefinition(session.activeTool).pointerMove({
    state: {
      status: "drawing",
      pointerDownPoint: anchor,
      livePoint: null,
      placedPoints: [],
      settings: session.toolSettings,
      validationMessage: null,
    },
    point: session.livePoint ?? anchor,
  });

  return {
    ...session,
    toolChain: chain,
    status: "drawing",
    pointerDownPoint: anchor,
    livePoint: result.state.livePoint,
    toolPlacedPoints: result.state.placedPoints ?? [],
    toolStagedEntities: withConstructionFlag(
      result.stagedEntities,
      session.constructionModifierActive,
    ),
    validationMessage:
      result.state.validationMessage ?? keptSketchWithheldRegionText(session),
    toolPresentation: result.presentation,
    activeInference: null,
    // D20: the next segment starts structurally at the anchor's id; a
    // vanished chain start is a placement at its position that authors
    // nothing.
    toolPlacements: anchorPoint
      ? []
      : [
          inferPlacementFromCandidate(
            {
              toolId: session.activeTool,
              role: "point",
              definition: session.definition,
            },
            {
              candidate: null,
              rawPosition: anchor,
              sketchUnitsPerPixel: session.sketchUnitsPerPixel ?? null,
            },
          ),
        ],
    toolStartPointId: anchorPoint?.pointId ?? null,
  };
}

export function rebuildSessionCommitRequest(
  session: SketchSessionState,
  definition: SketchDefinition,
) {
  // Committed geometry is current; the authored relationship records are
  // persisted, so expression distances survive the round-trip.
  const evaluatedDefinition = evaluateAuthoredSketchDerivations({
    definition,
    ...getSketchSessionDerivationSettings(session),
  }).definition;
  return buildCommitRequest({
    sketchId: session.sketchId,
    sketchLabel: session.sketchLabel,
    plane: session.plane,
    definition: evaluatedDefinition,
  });
}

export function normalizeConstraintValue(value: unknown) {
  if (typeof value === "number") {
    return Number.isNaN(value) ? null : createLiteralAuthoredValue(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const numericValue = Number(trimmed);
  return Number.isFinite(numericValue)
    ? createLiteralAuthoredValue(numericValue)
    : createExpressionAuthoredValue(trimmed);
}

/**
 * T13b (D3, D29): an edit operation parameter (Offset distance, Fillet
 * radius, Chamfer distance, Slot width, pattern and transform values) from a
 * tool patch value. A number is kept (NaN clears it); a string is trimmed and
 * read with a finite `Number(...)`. Empty clears the value. Operation
 * parameters are plain numbers (no expressions), so any other string clears
 * it with a message naming `field`.
 */
export function parseOperationParameter(
  value: unknown,
  field: string,
): { readonly value: number | null; readonly message: string | null } {
  if (typeof value === "number")
    return { value: Number.isNaN(value) ? null : value, message: null };
  if (typeof value !== "string") return { value: null, message: null };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { value: null, message: null };
  const numericValue = Number(trimmed);
  return Number.isFinite(numericValue)
    ? { value: numericValue, message: null }
    : { value: null, message: `Enter a number for the ${field}.` };
}

export function getTargetKey(target: PrimitiveRef) {
  switch (target.kind) {
    case "sketchPoint":
      return target.pointId;
    case "sketchEntity":
      return target.entityId;
    case "constraint":
      return target.constraintId;
    case "dimension":
      return target.dimensionId;
    case "sketch":
      return target.sketchId;
    case "sketchOperation":
      return target.operationId;
    case "body":
      return target.bodyId;
    case "face":
      return `${target.bodyId}:${target.faceId}`;
    case "edge":
      return `${target.bodyId}:${target.edgeId}`;
    case "vertex":
      return `${target.bodyId}:${target.vertexId}`;
    case "loop":
      return `${target.bodyId}:${target.loopId}`;
    case "feature":
      return target.featureId;
    case "construction":
      return target.constructionId;
    case "region":
      return `${target.sketchId}:${target.regionId}`;
    case "projectedReferenceGeometry":
      return `${target.referenceId}:${target.geometryId}`;
    case "sketchDatumReference":
      return `${target.sketchId}:${target.datumId}`;
    case "sketchExternalReference":
      return target.referenceId;
    case "sketchTangentHandle":
      return `${target.entityId}:${target.occurrenceId}`;
  }
}

export function withConstructionFlag(
  entities: readonly SketchDraftEntity[],
  isConstruction: boolean,
): readonly SketchDraftEntity[] {
  return isConstruction
    ? entities.map((entity) => ({ ...entity, isConstruction: true }))
    : entities;
}

export function isDrawingSketchTool(
  toolId: SketchAuthoringToolId | null,
): toolId is SketchToolId {
  return (
    toolId !== null &&
    !isRegisteredSketchConstraintToolId(toolId) &&
    !isRegisteredSketchEditToolId(toolId) &&
    toolId !== "construction" &&
    toolId !== "projectReference"
  );
}

export function createSessionCommitFactories(
  sequence: number,
  sketchId: SketchId,
  construction = false,
) {
  return {
    createPointId: (suffix: string) => createPointId(sequence, suffix),
    createEntityId: (suffix: string) => createEntityId(sequence, suffix),
    createConstraintId: (suffix: string) =>
      createConstraintId(sequence, suffix),
    createDimensionId: (suffix: string) => createDimensionId(sequence, suffix),
    createPoint: (
      label: string,
      pointId: SketchPointId,
      position: SketchPoint,
    ) => createPointDefinition(sketchId, pointId, label, position, construction),
    createLineEntity: (
      label: string,
      entityId: SketchEntityId,
      startPointId: SketchPointId,
      endPointId: SketchPointId,
    ) =>
      createLineEntityDefinition(
        sketchId,
        entityId,
        label,
        startPointId,
        endPointId,
        construction,
      ),
    createPointEntity: (
      label: string,
      entityId: SketchEntityId,
      pointId: SketchPointId,
    ) => createPointEntityDefinition(sketchId, entityId, label, pointId, construction),
    createCircleEntity: (
      label: string,
      entityId: SketchEntityId,
      centerPointId: SketchPointId,
      radius: number,
    ) =>
      createCircleEntityDefinition(
        sketchId,
        entityId,
        label,
        centerPointId,
        radius,
        construction,
      ),
    createArcEntity: (
      label: string,
      entityId: SketchEntityId,
      centerPointId: SketchPointId,
      startPointId: SketchPointId,
      endPointId: SketchPointId,
      sweepDirection: "clockwise" | "counterClockwise",
    ) =>
      createArcEntityDefinition(
        sketchId,
        entityId,
        label,
        centerPointId,
        startPointId,
        endPointId,
        sweepDirection,
        construction,
      ),
    createSplineEntity: (
      label: string,
      entityId: SketchEntityId,
      pointIds: readonly SketchPointId[],
    ) =>
      createSplineEntityDefinition(sketchId, entityId, label, pointIds, construction),
    createEllipseEntity: (
      label: string,
      entityId: SketchEntityId,
      centerPointId: SketchPointId,
      majorAxisPointId: SketchPointId,
      minorRadius: number,
    ) =>
      createEllipseEntityDefinition(
        sketchId,
        entityId,
        label,
        centerPointId,
        majorAxisPointId,
        minorRadius,
        construction,
      ),
    createEllipticalArcEntity: (
      label: string,
      entityId: SketchEntityId,
      centerPointId: SketchPointId,
      majorAxisPointId: SketchPointId,
      startPointId: SketchPointId,
      endPointId: SketchPointId,
      minorRadius: number,
      sweepDirection: "clockwise" | "counterClockwise",
    ) =>
      createEllipticalArcEntityDefinition(
        sketchId,
        entityId,
        label,
        centerPointId,
        majorAxisPointId,
        startPointId,
        endPointId,
        minorRadius,
        sweepDirection,
        construction,
      ),
    createConicEntity: (
      label: string,
      entityId: SketchEntityId,
      startPointId: SketchPointId,
      controlPointId: SketchPointId,
      endPointId: SketchPointId,
      rho: number,
    ) =>
      createConicEntityDefinition(
        sketchId,
        entityId,
        label,
        startPointId,
        controlPointId,
        endPointId,
        rho,
        construction,
      ),
    createBezierCurveEntity: (
      label: string,
      entityId: SketchEntityId,
      controlPointIds: readonly SketchPointId[],
      degree: 2 | 3,
    ) =>
      createBezierCurveEntityDefinition(
        sketchId,
        entityId,
        label,
        controlPointIds,
        degree,
        construction,
      ),
    createProfileTextEntity: (
      label: string,
      entityId: SketchEntityId,
      anchorPointId: SketchPointId,
      text: string,
      height: number,
      rotationRadians: number,
      horizontalAlign: "left" | "center" | "right",
      verticalAlign: "baseline" | "middle" | "top" | "bottom",
    ) =>
      createProfileTextEntityDefinition(
        sketchId,
        entityId,
        label,
        anchorPointId,
        text,
        height,
        rotationRadians,
        horizontalAlign,
        verticalAlign,
        construction,
      ),
  };
}

export function getSessionSketchId(session: SketchSessionState): SketchId {
  return session.sketchId ?? ("sketch_draft" as SketchId);
}
