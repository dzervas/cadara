import {
  isReferenceDimension,
  resolvedReferenceDimension,
  isAcceptedConstraintStatus,
  SOLVED_SKETCH_SCHEMA_VERSION,
} from "@/contracts/sketch/schema";
import type {
  NumericSketchDefinition,
  SolvedSketchSnapshot,
  SketchDefinition,
  DimensionDefinition,
  NumericDimensionDefinition,
  SketchSolveDiagnostic,
  DerivableSketchDefinition,
  SketchEntityDefinition,
  RegionRecord,
  SketchDerivedValidity,
} from "@/contracts/sketch/schema";
import type {
  ProjectedSketchReferenceRecord,
  SketchOffsetPublicationRecord,
} from "@/contracts/solver/schema";
import type {
  SketchSessionState,
  SketchLiveRegionBasis,
  SketchLiveRegions,
} from "./types";
import type { DocumentVariableRecord } from "@/contracts/modeling/schema";
import {
  resolveSketchDimensionValues,
  resolveSketchDerivationDistances,
} from "@/domain/modeling/sketch-dimension-expressions";
import type { SketchExactIntersection } from "@/domain/sketch-snapping/snap-candidates";
import {
  isUnevaluatedMetadataOnlySketch,
  sketchProfileGateFailures,
  mergeSketchSolveDiagnostics,
  withRelationshipScopedDiagnostics,
  deriveSketchValidity,
} from "@/contracts/sketch/derived-validity";
import { getSketchSessionDerivationSettings } from "./session-definition";
import { evaluateSketchDerivations } from "@/contracts/sketch/derived-geometry";
import {
  solveSketchDefinitionCore,
  describeDegenerateSplineSpan,
} from "@/core/sketch-solver";
import {
  isOffsetPublicationSolveAccepted,
  isOffsetReplanRound,
  closeOffsetReplanRound,
  offsetReplanHints,
  carriedOffsetPlans,
  publishedOffsetPlans,
  applyOffsetPublications,
  offsetPublicationDiagnostics,
} from "@/contracts/sketch/offset-publication";
import type { SketchId } from "@/contracts/shared/ids";
import {
  describeSketchSessionWithheldRegions,
  isSketchWithheldRegionText,
} from "./region-feedback";
import {
  createRegionBoundaryBasis,
  resolveRegionBoundaryCurve,
} from "@/contracts/sketch/region-boundary-curves";

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
