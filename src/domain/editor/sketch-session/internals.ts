import type {
  DocumentVariableRecord,
  SketchPoint,
} from "@/contracts/modeling/schema";
import { isAcceptedConstraintStatus } from "@/contracts/sketch/schema";
import {
  createExpressionAuthoredValue,
  createLiteralAuthoredValue,
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
import {
  evaluateSketchDerivations,
  type SketchDerivationSettings,
} from "@/contracts/sketch/derived-geometry";
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
  type RegionRecord,
  type SketchDefinition,
  type SketchDerivedValidity,
  type SketchSolveDiagnostic,
  type SketchEntityDefinition,
  type SketchPointDefinition,
  type SolvedSketchSnapshot,
  SKETCH_SCHEMA_VERSION,
} from "@/contracts/sketch/schema";
import {
  orderedSplinePointIds,
  reconstructSplineAggregate,
  tessellateCubicSpans,
} from "@/contracts/sketch/spline-geometry";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import {
  deriveSketchValidity,
  mergeSketchSolveDiagnostics,
  withRelationshipScopedDiagnostics,
} from "@/contracts/sketch/derived-validity";
import {
  resolveSketchDerivationDistances,
  resolveSketchDimensionValues,
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
import type { SketchSnapCandidate } from "@/domain/sketch-snapping/snap-candidates";
import type {
  SketchAuthoringToolId,
  SketchLiveRegionBasis,
  SketchLiveRegions,
  SketchSessionState,
  SketchToolChain,
} from "./types";
import { buildCommitRequest } from "./history";

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
export const ANNOTATION_EDIT_SOLVE_BLOCKED_MESSAGE =
  "Could not solve the edited constraint value.";
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

/** τ and the session's offset plan hints ([TECH] G3/G12/G17) for every session evaluation. */
export function getSketchSessionDerivationSettings(
  session: Pick<SketchSessionState, "modelingTolerance" | "offsetPlans">,
): SketchDerivationSettings {
  return {
    modelingTolerance: session.modelingTolerance,
    ...(session.offsetPlans ? { offsetPlans: session.offsetPlans } : {}),
  };
}

export function getSketchSessionDisplayDefinition(session: SketchSessionState) {
  const sketchId = session.sketchId ?? ("sketch_draft" as SketchId);
  const evaluatedDefinition = evaluateSketchDerivations({
    definition: resolveSketchDerivationDistances({
      definition: session.definition,
      variables: session.documentVariables,
    }),
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

let cachedSolveDefinition: SketchDefinition | null = null;
let cachedSolveProjectedRefs: ProjectedSketchReferenceRecord[] | null = null;
let cachedSolveTolerances: SketchSessionState["solverTolerances"] | null = null;
let cachedSolveModelingTolerance: number | null = null;
let cachedSolveResult: SolvedSketchSnapshot | null = null;

/**
 * Resolves expression-authored sketch dimensions against the session's document
 * variables so the numeric solver only ever receives concrete numbers. Falls
 * back to the authored definition when resolution fails so preview solving stays
 * best-effort instead of throwing.
 */
export function resolveSketchDefinitionForSolve(
  definition: SketchDefinition,
  documentVariables: readonly DocumentVariableRecord[] = [],
): SketchDefinition {
  const withDerivationDistances = resolveSketchDerivationDistances({
    definition,
    variables: documentVariables,
  });
  const resolved = resolveSketchDimensionValues({
    definition: withDerivationDistances,
    variables: documentVariables,
  });
  return resolved.ok ? resolved.definition : withDerivationDistances;
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
  const generation = session.liveRegions.generation + 1;
  return {
    ...session,
    liveSolve: {
      sourceDefinition: definition,
      definition: evaluatedDefinition,
      projectedReferences: session.projectedReferences,
      solvedSnapshot: usableSolvedSnapshot,
      accepted,
    },
    liveRegions: accepted
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
  return {
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
 * Display validity of the session's live regions: pending is stale; not
 * accepted, unavailable or failed is invalid. Never a consumption gate.
 */
export function getSketchSessionDerivedValidity(
  session: SketchSessionState,
): SketchDerivedValidity {
  const { liveRegions, liveSolve } = session;
  const regionDiagnostics = mergeSketchSolveDiagnostics(
    liveRegions.diagnostics,
    getLiveRegionBoundaryDiagnostics(liveRegions),
  );
  if (liveRegions.status === "current") {
    return withRelationshipScopedDiagnostics(
      liveSolve
        ? deriveSketchValidity({
            solvedSnapshot: liveSolve.solvedSnapshot,
            diagnostics: regionDiagnostics,
          })
        : {
            state: regionDiagnostics.some(
              (diagnostic) => diagnostic.severity === "error",
            )
              ? "invalid"
              : "current",
            diagnostics: regionDiagnostics,
          },
      session.offsetPublicationDiagnostics ?? [],
    );
  }

  const diagnostics = mergeSketchSolveDiagnostics(
    liveSolve?.solvedSnapshot.diagnostics ?? [],
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

export function getEntityPointIds(entity: SketchEntityDefinition) {
  switch (entity.kind) {
    case "lineSegment":
      return [entity.startPointId, entity.endPointId];
    case "arc":
      return [entity.startPointId, entity.endPointId, entity.centerPointId];
    case "circle":
      return [entity.centerPointId];
    case "point":
      return [entity.pointId];
    case "spline":
      return orderedSplinePointIds(entity);
    case "ellipse":
      return [entity.centerPointId, entity.majorAxisPointId];
    case "ellipticalArc":
      return [
        entity.startPointId,
        entity.endPointId,
        entity.centerPointId,
        entity.majorAxisPointId,
      ];
    case "conic":
      return [entity.startPointId, entity.controlPointId, entity.endPointId];
    case "bezierCurve":
      return entity.controlPointIds;
    case "profileText":
      return [entity.anchorPointId];
    case "derivedPiecewiseCubic":
      // A derived shell owns no points (its driven terminals belong to its
      // offset relationship's outputs).
      return [];
  }
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
        selectedAnnotation: null,
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
        ? (getSketchSessionDerivedValidity(rebuilt).diagnostics.find(
            (diagnostic) => diagnostic.severity !== "info",
          )?.message ??
          "Sketch profiles are unavailable until the sketch is corrected.")
        : null,
  };
}

/**
 * Reconciles the armed drawing tool's draft with a restored definition
 * (T11-D12: Undo, Redo and every other restore). A snap that references a
 * point or entity the definition no longer has is dropped and its raw
 * position kept, so a commit never reuses a deleted id. An active Line
 * chain keeps its records and is restaged from its committed prefix
 * (`restageSketchToolChain`).
 */
export function reconcileSketchToolDraft(
  session: SketchSessionState,
): SketchSessionState {
  const { definition } = session;
  const reconciled: SketchSessionState = {
    ...session,
    activeSnap: sketchSnapReferencesExist(definition, session.activeSnap)
      ? session.activeSnap
      : null,
    drawStartSnap: sketchSnapReferencesExist(definition, session.drawStartSnap)
      ? session.drawStartSnap
      : null,
    ...(sketchSnapReferencesExist(definition, session.fitPointEndSnap ?? null)
      ? {}
      : { fitPointEndSnap: null }),
  };

  return session.toolChain && isSketchToolChainActive(session)
    ? restageSketchToolChain(reconciled, session.toolChain)
    : reconciled;
}

function sketchSnapReferencesExist(
  definition: SketchDefinition,
  snap: SketchSnapCandidate | null,
) {
  return (snap?.sources ?? []).every((source) =>
    source.kind === "localPoint"
      ? definition.points.some((point) => point.pointId === source.pointId)
      : source.kind === "localEntity"
        ? definition.entities.some(
            (entity) => entity.entityId === source.entityId,
          )
        : true,
  );
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
 * anchor is the draft's start snap at that point (review A-4), so the next
 * segment reuses its id. A chain start whose point no longer exists keeps
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
    validationMessage: result.state.validationMessage,
    toolPresentation: result.presentation,
    activeSnap: null,
    drawStartSnap: anchorPoint
      ? createSketchPointAnchorSnap(anchorPoint.pointId, anchor)
      : null,
  };
}

/**
 * A snap at an existing local point, for a draft that starts there: the
 * commit reuses that point id and infers no constraint for it
 * (`normalizeLinePatchEndpointReuse`, review A-4).
 */
function createSketchPointAnchorSnap(
  pointId: SketchPointId,
  position: SketchPoint,
): SketchSnapCandidate {
  return {
    key: `endpoint:anchor:local-point:${pointId}`,
    kind: "endpoint",
    point: position,
    rawPointer: position,
    distance: 0,
    priority: 0,
    sources: [{ kind: "localPoint", pointId }],
    preview: { label: "Endpoint", glyph: "endpoint" },
  };
}

export function rebuildSessionCommitRequest(
  session: SketchSessionState,
  definition: SketchDefinition,
) {
  // Evaluate with resolved derivation distances so committed geometry is
  // current, but persist the authored relationship records so expression
  // distances survive the round-trip.
  const evaluatedDefinition = {
    ...evaluateSketchDerivations({
      definition: resolveSketchDerivationDistances({
        definition,
        variables: session.documentVariables,
      }),
      ...getSketchSessionDerivationSettings(session),
    }).definition,
    derivedRelationships: definition.derivedRelationships,
  };
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
    ) => createPointDefinition(sketchId, pointId, label, position, false),
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
        false,
      ),
    createPointEntity: (
      label: string,
      entityId: SketchEntityId,
      pointId: SketchPointId,
    ) => createPointEntityDefinition(sketchId, entityId, label, pointId, false),
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
        false,
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
        false,
      ),
    createSplineEntity: (
      label: string,
      entityId: SketchEntityId,
      pointIds: readonly SketchPointId[],
    ) =>
      createSplineEntityDefinition(sketchId, entityId, label, pointIds, false),
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
        false,
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
        false,
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
        false,
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
        false,
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
        false,
      ),
  };
}

export function getSessionSketchId(session: SketchSessionState): SketchId {
  return session.sketchId ?? ("sketch_draft" as SketchId);
}
