import type { SplineSpan } from "@/contracts/sketch/spline-geometry";
import type {
  SketchEditIntersectionInput,
  SketchEditIntersectionResult,
} from "@/contracts/sketch/edit-intersections";
import type {
  DocumentId,
  ProjectedGeometryId,
  ReferenceId,
  RequestId,
  RevisionId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type {
  RegionRef,
  SketchEntityRef,
  SketchPointRef,
  SketchRef,
} from "@/contracts/shared/references";
import type { ContractVersion } from "@/contracts/shared/versioning";
import type { ModelingDocumentSettings } from "@/contracts/modeling/schema";
import type { SketchPlaneFrame } from "@/contracts/shared/sketch-plane";
import type {
  RegionRecord,
  ProjectedSketchGeometryRef,
  SketchDefinition,
  SketchPoint2D,
  SketchReferenceDefinition,
  SketchSolveDiagnostic,
  SolvedOffsetFramePlan,
  SolvedOffsetFramePlanRecord,
  SolvedSketchSnapshot,
  SolvedSketchStatus,
} from "@/contracts/sketch/schema";

/**
 * Versioned schema identifier for the dedicated sketch solver contract family.
 * Implementers must reject requests that declare an unsupported schema version.
 */
export type SolverSchemaVersion = "sketch-solver/v1alpha1";

/**
 * Current sketch solver schema version literal.
 */
/**
 * Request-id scope of an offset preview publication (U-G3). Its scheduling
 * lane is carried explicitly (`DeriveSketchRegionsRequest.derivationLane`).
 */
export const SKETCH_OFFSET_PREVIEW_REQUEST_SCOPE =
  "sketch-offset-preview-publication";

export const SOLVER_SCHEMA_VERSION: SolverSchemaVersion =
  "sketch-solver/v1alpha1";
export type { SketchPlaneFrame };

/**
 * Declares how the solver should treat incomplete or conflicting edits.
 * `bestEffort` allows partial solved output when the solver can produce one.
 * `failOnConflict` requires the response to stop at diagnostics if a full solve
 * is not available.
 */
export type SolverPartialSolvePolicy = "bestEffort" | "failOnConflict";

/**
 * Explicit tolerance policy used when validating, projecting, and solving.
 * The caller owns these tolerances so the solver does not need hidden defaults.
 */
export interface SolverTolerancePolicy {
  /** Maximum point-to-point separation treated as coincident in sketch-plane units. */
  coincidence: number;
  /** Maximum angular deviation treated as equal direction in radians. */
  angleRadians: number;
  /** Minimum non-zero segment length considered valid in sketch-plane units. */
  minimumSegmentLength: number;
}

/**
 * Derives the solver tolerance policy from the document's authored modeling
 * settings so every solve, projection, and status judgment shares one limit.
 */
export function createDocumentSolverTolerances(
  settings: Pick<
    ModelingDocumentSettings,
    "modelingTolerance" | "angularToleranceRadians"
  >,
): SolverTolerancePolicy {
  return {
    coincidence: settings.modelingTolerance,
    angleRadians: settings.angularToleranceRadians,
    minimumSegmentLength: settings.modelingTolerance,
  };
}

/**
 * Opaque identity for a compiled sketch solve basis. The value is stable only
 * for a compatible authored sketch graph, projection basis, tolerances, and
 * strategy.
 */
export type CompiledSketchSolveProgramId = `compiled_sketch_solve_${string}`;

/**
 * Opaque identity for an active interactive solve session.
 */
export type InteractiveSketchSolveSessionId =
  `interactive_sketch_solve_${string}`;

/**
 * Machine-readable reason a compiled basis or interactive session cannot be
 * reused for a requested solve.
 */
export type SketchSolveInvalidationReason =
  | "authoredGraphChanged"
  | "projectedReferencesChanged"
  | "tolerancePolicyChanged"
  | "solveStrategyChanged"
  | "disposedSession"
  | "unknownSession"
  | "staleRevision";

/**
 * Temporary interactive drag target supplied by an editor preview.
 * This is solver input only and must not be persisted as an authored constraint.
 */
export interface SolverDraggedSketchPointTarget {
  /** Temporary target discriminant. */
  kind: "sketchPoint";
  /** Authored point the user is dragging. */
  pointId: SketchPointId;
  /** Requested sketch-plane point position for this solve. */
  position: SketchPoint2D;
}

/**
 * Projection-ready record for an authored external sketch reference.
 * The solver consumes these definitions and returns explicit 2D geometry.
 */
export interface SolverExternalReferenceInput {
  /** Authored reference identity from `SketchDefinition.referenceIds`. */
  referenceId: ReferenceId;
  /** Original authored reference definition submitted for projection. */
  reference: SketchReferenceDefinition;
}

/**
 * Projected 2D point owned by the solver for an external reference.
 * Coordinates are expressed in the sketch plane frame of the containing request.
 */
export interface ProjectedSketchPointGeometry {
  /** Stable projected-geometry identity scoped to one authored reference. */
  geometryId: ProjectedGeometryId;
  /** Geometry discriminant for a projected point result. */
  kind: "point";
  /** Projected point coordinates in sketch-plane units. */
  position: SketchPoint2D;
}

/**
 * Projected 2D line segment owned by the solver for an external reference.
 * Coordinates are expressed in the sketch plane frame of the containing request.
 */
export interface ProjectedSketchLineSegmentGeometry {
  /** Stable projected-geometry identity scoped to one authored reference. */
  geometryId: ProjectedGeometryId;
  /** Geometry discriminant for a projected line result. */
  kind: "lineSegment";
  /** Projected line start in sketch-plane units. */
  startPosition: SketchPoint2D;
  /** Projected line end in sketch-plane units. */
  endPosition: SketchPoint2D;
}

/**
 * Projected 2D circle owned by the solver for an external reference.
 * Coordinates are expressed in the sketch plane frame of the containing request.
 */
export interface ProjectedSketchCircleGeometry {
  /** Stable projected-geometry identity scoped to one authored reference. */
  geometryId: ProjectedGeometryId;
  /** Geometry discriminant for a projected circle result. */
  kind: "circle";
  /** Projected circle center in sketch-plane units. */
  centerPosition: SketchPoint2D;
  /** Projected circle radius in sketch-plane units. */
  radius: number;
}

/**
 * Projected 2D arc owned by the solver for an external reference.
 * Coordinates are expressed in the sketch plane frame of the containing request.
 */
export interface ProjectedSketchArcGeometry {
  /** Stable projected-geometry identity scoped to one authored reference. */
  geometryId: ProjectedGeometryId;
  /** Geometry discriminant for a projected arc result. */
  kind: "arc";
  /** Projected arc center in sketch-plane units. */
  centerPosition: SketchPoint2D;
  /** Projected arc start in sketch-plane units. */
  startPosition: SketchPoint2D;
  /** Projected arc end in sketch-plane units. */
  endPosition: SketchPoint2D;
  /** Sweep direction from start to end about `centerPosition`. */
  sweepDirection: "clockwise" | "counterClockwise";
}

/**
 * Projected 2D spline/freeform curve owned by the solver for an external
 * reference. This representation covers source splines, Bezier curves, and
 * other freeform model edges when the kernel exposes them as ordered samples.
 */
export interface ProjectedSketchSplineGeometry {
  /** Stable projected-geometry identity scoped to one authored reference. */
  geometryId: ProjectedGeometryId;
  /** Geometry discriminant for a projected spline/freeform result. */
  kind: "spline";
  /** Faithful source form: external source data stays distinct from ordinary-spline reconstruction. */
  representation:
    | {
        kind: "sourceSamples";
        points: readonly SketchPoint2D[];
        isClosed: boolean;
      }
    | {
        kind: "neutralCubicSpans";
        spans: readonly SplineSpan[];
      };
}

export function projectedSplineIsClosed(
  geometry: ProjectedSketchSplineGeometry,
): boolean {
  if (geometry.representation.kind === "sourceSamples")
    return geometry.representation.isClosed;
  const spans = geometry.representation.spans;
  if (spans.length === 0) return false;
  const first = spans[0]!.poles[0];
  const last = spans.at(-1)!.poles[3];
  return first[0] === last[0] && first[1] === last[1];
}

/**
 * Union of all explicit 2D geometry that the solver may return for a projected
 * external sketch reference.
 */
export type ProjectedSketchReferenceGeometry =
  | ProjectedSketchPointGeometry
  | ProjectedSketchLineSegmentGeometry
  | ProjectedSketchCircleGeometry
  | ProjectedSketchArcGeometry
  | ProjectedSketchSplineGeometry;

/**
 * Machine-readable projection status for an authored external reference.
 * Callers must rely on this code rather than parsing diagnostic messages.
 */
export type ProjectedSketchReferenceStatus =
  | "projected"
  | "unsupportedSource"
  | "missingSource"
  | "outOfPlane"
  | "ambiguous";

/**
 * Explicit solver-owned external-reference projection record.
 * This is the only source of truth for how external geometry enters sketch
 * space; the editor must not infer projected geometry on its own.
 */
export interface ProjectedSketchReferenceRecord {
  /** Authored reference identity from `SketchDefinition.referenceIds`. */
  referenceId: ReferenceId;
  /** Projection result status for the authored reference. */
  status: ProjectedSketchReferenceStatus;
  /** Projected sketch-space geometry when the projection succeeded. */
  geometry: ProjectedSketchReferenceGeometry[];
  /** Diagnostics specific to this external reference projection. */
  diagnostics: SketchSolveDiagnostic[];
}

/**
 * Explicit solver-owned projected geometry resolution record.
 */
export interface ResolvedProjectedSketchGeometryRecord {
  /** Stable projected geometry requested by the caller. */
  reference: ProjectedSketchGeometryRef;
  /** Human-readable label owned by the solver/kernel producer. */
  label: string;
  /** Requested projected geometry is still valid at `revisionId`. */
  isValid: boolean;
  /** Machine-readable invalidation reason when `isValid` is false. */
  invalidationReason: SolverReferenceInvalidationReason | null;
}

/**
 * Base request envelope shared by all sketch solver operations.
 * The caller owns correlation, document identity, revision basis, and protocol
 * versioning; the solver must echo them back exactly in the response.
 */
export interface SketchSolverRequestBase {
  /** Shared top-level contract version across the modeling/solver boundary. */
  contractVersion: ContractVersion;
  /** Version of the sketch solver contract family expected by the caller. */
  solverSchemaVersion: SolverSchemaVersion;
  /** Correlation identifier for the async request/response pair. */
  requestId: RequestId;
  /** Durable document identity against which the request is evaluated. */
  documentId: DocumentId;
  /**
   * Base committed revision against which the request is evaluated.
   * Solvers must not silently apply the request against a different revision.
   */
  revisionId: RevisionId;
  /** Durable sketch identity being solved, validated, or inspected. */
  sketchId: SketchId;
}

/**
 * Common response envelope shared by all sketch solver operations.
 * The solver must echo the originating request context exactly so stale results
 * can be discarded safely by the caller.
 */
export interface SketchSolverResponseBase {
  /** Shared top-level contract version across the modeling/solver boundary. */
  contractVersion: ContractVersion;
  /** Version of the sketch solver contract family used to produce this response. */
  solverSchemaVersion: SolverSchemaVersion;
  /** Correlation identifier copied from the originating request. */
  requestId: RequestId;
  /** Durable document identity copied from the originating request. */
  documentId: DocumentId;
  /** Revision against which the solver evaluated this response. */
  revisionId: RevisionId;
  /** Durable sketch identity copied from the originating request. */
  sketchId: SketchId;
}

/**
 * Request to project external model references into sketch-space coordinates.
 * The caller owns the authored references and plane frame; the solver owns the
 * resulting 2D geometry and projection diagnostics.
 */
export interface ProjectSketchExternalReferencesRequest extends SketchSolverRequestBase {
  /** Sketch-plane frame into which external references must be projected. */
  plane: SketchPlaneFrame;
  /** Explicit tolerance policy for projection and coplanarity checks. */
  tolerances: SolverTolerancePolicy;
  /** Authored external references from the current sketch definition. */
  references: SolverExternalReferenceInput[];
}

/**
 * Response for explicit external-reference projection.
 */
export interface ProjectSketchExternalReferencesResponse extends SketchSolverResponseBase {
  /** Projection result per authored external reference. */
  projectedReferences: ProjectedSketchReferenceRecord[];
  /** Aggregate diagnostics not owned by any single projected reference. */
  diagnostics: SketchSolveDiagnostic[];
}

/**
 * Request to validate a sketch definition prior to a full solve.
 * This detects malformed authored payloads and missing projections without
 * requiring the solver to return solved geometry.
 */
export interface ValidateSketchRequest extends SketchSolverRequestBase {
  /** Sketch-plane frame used to interpret authored and projected coordinates. */
  plane: SketchPlaneFrame;
  /** Explicit tolerance policy for validation checks. */
  tolerances: SolverTolerancePolicy;
  /** The document's settings.modelingTolerance (finite, > 0; [TECH] G12); never a default. */
  modelingTolerance: number;
  /** Durable authored sketch definition submitted for validation. */
  definition: SketchDefinition;
  /** Explicit projected external references already resolved into sketch space. */
  projectedReferences: ProjectedSketchReferenceRecord[];
}

/**
 * Validation response for an authored sketch definition.
 */
export interface ValidateSketchResponse extends SketchSolverResponseBase {
  /** True only when the authored sketch payload is valid for solving. */
  isValid: boolean;
  /** Machine-readable validation diagnostics. */
  diagnostics: SketchSolveDiagnostic[];
}

/**
 * Request to solve a sketch definition into authoritative solved geometry.
 * The caller provides authored input, projected external references, and solve
 * policy; the solver owns the returned solved snapshot and status.
 */
export interface SolveSketchRequest extends SketchSolverRequestBase {
  /** Sketch-plane frame used to interpret authored and solved coordinates. */
  plane: SketchPlaneFrame;
  /** Explicit tolerance policy for solve and consistency checks. */
  tolerances: SolverTolerancePolicy;
  /** The document's settings.modelingTolerance (finite, > 0; [TECH] G12); never a default. */
  modelingTolerance: number;
  /** Declares whether the solver may return partial results when conflicts exist. */
  partialSolvePolicy: SolverPartialSolvePolicy;
  /** Durable authored sketch definition to solve. */
  definition: SketchDefinition;
  /** Explicit projected external references available to the solver. */
  projectedReferences: ProjectedSketchReferenceRecord[];
  /**
   * [TECH] G3/G17 offset plan hints for this solve (a publication round's
   * `planChanged` re-solve, or the last published plans); passed to the
   * solve frames unchanged. Absent: the SEL first choice.
   */
  offsetPlans?: SolvedOffsetFramePlanRecord[];
}

/**
 * Solve response for a sketch definition.
 * Solved status, geometry, and diagnostics are authoritative solver outputs.
 */
export interface SolveSketchResponse extends SketchSolverResponseBase {
  /** Solver-owned solved status summary for the authored sketch definition. */
  status: SolvedSketchStatus;
  /** Authoritative solved geometry and per-constraint/dimension results. */
  solvedSnapshot: SolvedSketchSnapshot;
  /** Diagnostics emitted during validation or solving. */
  diagnostics: SketchSolveDiagnostic[];
}

/**
 * Request to start a warm-startable interactive solve session.
 */
export interface StartInteractiveSketchSolveSessionRequest extends SketchSolverRequestBase {
  /** Sketch-plane frame used to interpret authored and solved coordinates. */
  plane: SketchPlaneFrame;
  /** Explicit tolerance policy for solve and consistency checks. */
  tolerances: SolverTolerancePolicy;
  /** The document's settings.modelingTolerance (finite, > 0; [TECH] G12); never a default. */
  modelingTolerance: number;
  /** Declares whether the solver may return partial results when conflicts exist. */
  partialSolvePolicy: SolverPartialSolvePolicy;
  /** Durable authored sketch definition to solve. */
  definition: SketchDefinition;
  /** Explicit projected external references available to the solver. */
  projectedReferences: ProjectedSketchReferenceRecord[];
  /** Optional compatible snapshot used to seed mutable solve state. */
  priorSolvedSnapshot?: SolvedSketchSnapshot | null;
  /** Optional solver strategy selected by the caller/runtime. */
  strategy?: "bfgs" | "gradientDescent" | "gaussNewton" | "levenbergMarquardt";
}

/**
 * Response returned when an interactive solve session starts.
 */
export interface StartInteractiveSketchSolveSessionResponse extends SketchSolverResponseBase {
  /** Active interactive session identity. */
  sessionId: InteractiveSketchSolveSessionId;
  /** Compiled solve basis used by the session. */
  programId: CompiledSketchSolveProgramId;
  /** True when the session seeded mutable state from a compatible solved snapshot. */
  warmStarted: boolean;
  /** Complete solved state for the starting basis. */
  solvedSnapshot: SolvedSketchSnapshot;
  /** Solver-owned solved status summary. */
  status: SolvedSketchStatus;
  /** Diagnostics emitted while compiling or seeding the session. */
  diagnostics: SketchSolveDiagnostic[];
}

/**
 * Request to update an active interactive solve session with a drag target.
 */
export interface UpdateInteractiveSketchSolveSessionRequest extends SketchSolverRequestBase {
  /** Active interactive session identity returned by session start. */
  sessionId: InteractiveSketchSolveSessionId;
  /** Temporary drag target for this interactive frame. */
  dragTarget: SolverDraggedSketchPointTarget;
}

/**
 * Interactive solve update accepted result.
 */
export interface InteractiveSketchSolveAcceptedUpdate {
  kind: "accepted";
  status: SolvedSketchStatus;
  solvedSnapshot: SolvedSketchSnapshot;
  diagnostics: SketchSolveDiagnostic[];
}

/**
 * Interactive solve update blocked result.
 */
export interface InteractiveSketchSolveBlockedUpdate {
  kind: "blocked";
  reason:
    | "missingPoint"
    | "unsatisfied"
    | "nonConvergent"
    | "staleSession"
    | "staleRevision";
  solvedSnapshot: SolvedSketchSnapshot | null;
  diagnostics: SketchSolveDiagnostic[];
}

/**
 * Response returned for an interactive drag-frame solve.
 */
export interface UpdateInteractiveSketchSolveSessionResponse extends SketchSolverResponseBase {
  /** Active interactive session identity. */
  sessionId: InteractiveSketchSolveSessionId;
  /** Frame result. Accepted frames update session state; blocked frames do not. */
  result:
    | InteractiveSketchSolveAcceptedUpdate
    | InteractiveSketchSolveBlockedUpdate;
}

/**
 * Request to finalize the latest accepted interactive solve state.
 */
export interface FinalizeInteractiveSketchSolveSessionRequest extends SketchSolverRequestBase {
  /** Active interactive session identity. */
  sessionId: InteractiveSketchSolveSessionId;
}

/**
 * Response returned when an interactive session is finalized.
 */
export interface FinalizeInteractiveSketchSolveSessionResponse extends SketchSolverResponseBase {
  /** Finalized interactive session identity. */
  sessionId: InteractiveSketchSolveSessionId;
  /** Final accepted solved state, if the session was still active. */
  solvedSnapshot: SolvedSketchSnapshot | null;
  /** Final status, if the session was still active. */
  status: SolvedSketchStatus | null;
  /** Diagnostics emitted while finalizing. */
  diagnostics: SketchSolveDiagnostic[];
}

/**
 * Request to dispose an interactive solve session without finalizing geometry.
 */
export interface DisposeInteractiveSketchSolveSessionRequest extends SketchSolverRequestBase {
  /** Active interactive session identity. */
  sessionId: InteractiveSketchSolveSessionId;
}

/**
 * Response returned when an interactive session is disposed.
 */
export interface DisposeInteractiveSketchSolveSessionResponse extends SketchSolverResponseBase {
  /** Disposed interactive session identity. */
  sessionId: InteractiveSketchSolveSessionId;
  /** True when an active session was found and disposed. */
  disposed: boolean;
  /** Diagnostics emitted while disposing. */
  diagnostics: SketchSolveDiagnostic[];
}

/**
 * Request to derive closed regions from a solved sketch state.
 * Regions must be derived here or by the kernel, never authored by the editor.
 */
export interface DeriveSketchRegionsRequest extends SketchSolverRequestBase {
  /** Solved sketch snapshot that region derivation must consume. */
  solvedSnapshot: SolvedSketchSnapshot;
  /** Authored sketch definition corresponding to `solvedSnapshot`. */
  definition: SketchDefinition;
  /** Explicit projected external references available to region derivation. */
  projectedReferences: ProjectedSketchReferenceRecord[];
  /** The document's settings.modelingTolerance (finite, > 0); never a default. */
  modelingTolerance: number;
  /**
   * T08b-g5b (g5a review A3): the scheduling lane of a terminable derivation
   * runtime. `offsetPreview` is an offset preview publication (U-G3), which
   * runs in its own lane so it and the live region derivation of one
   * document never supersede each other. Absent: the live lane.
   */
  derivationLane?: "offsetPreview";
}

/**
 * Region-derivation response for a solved sketch.
 */
export interface DeriveSketchRegionsResponse extends SketchSolverResponseBase {
  /** Solver- or kernel-derived closed regions for downstream feature authoring. */
  regions: RegionRecord[];
  /** Diagnostics emitted while deriving sketch regions. */
  diagnostics: SketchSolveDiagnostic[];
  /**
   * [TECH] G1/G5/G16/G17: the publication of every offset relationship of
   * the request's accepted pair, in relationship order (empty without
   * offsets or when the solve is not accepted, U-G1). Relationship-scoped:
   * a failure never enters `diagnostics` or the solved snapshot.
   */
  offsetPublications: SketchOffsetPublicationRecord[];
}

/**
 * T10g-1: the exact edit-intersection query of one accepted live pair
 * (`querySketchEditIntersections`, `contracts/sketch/edit-intersections.ts`).
 * A terminable runtime runs it in its own `editQuery` lane per document.
 */
export interface QuerySketchEditIntersectionsRequest
  extends SketchSolverRequestBase, SketchEditIntersectionInput {}

/** The verified cuts or the named failure; validated at the transport boundary. */
export interface QuerySketchEditIntersectionsResponse extends SketchSolverResponseBase {
  result: SketchEditIntersectionResult;
}

/**
 * One offset relationship's publication ([TECH] G17): `certified` when the
 * unchanged SEL certified exactly the solve frame the snapshot's
 * `offsetFramePlans` hint reproduces (its `plan`, origin `published`, seeds
 * the next solves); `planChanged` when the certified plan differs (the
 * caller re-solves ONCE with `plan`, origin `certified`, unchanged);
 * `failed` with its source-linked diagnostic.
 */
export interface SketchOffsetPublicationRecord {
  derivationId: string;
  status: "certified" | "planChanged" | "failed";
  plan?: SolvedOffsetFramePlan;
  diagnostic?: SketchSolveDiagnostic;
}

/**
 * Sketch-local reference target that the solver may resolve explicitly.
 * This covers authored sketch records and solver-derived regions.
 */
export type SolverResolvableSketchRef =
  | SketchRef
  | SketchEntityRef
  | SketchPointRef
  | RegionRef
  | ProjectedSketchGeometryRef;

/**
 * Machine-readable invalidation reason for sketch-local reference resolution.
 * Callers must rely on this code rather than inferring from human-readable text.
 */
export type SolverReferenceInvalidationReason =
  | "missingSketch"
  | "missingEntity"
  | "missingPoint"
  | "missingRegion"
  | "missingProjectedGeometry"
  | "revisionMismatch";

/**
 * Explicit sketch-local reference resolution record returned by the solver.
 * This allows the caller to confirm ownership and invalidation without guessing.
 */
export interface ResolvedSketchReferenceRecord {
  /** Resolved sketch-local target or the dead target that was requested. */
  target: SolverResolvableSketchRef;
  /** Human-readable label owned by the solver/kernel producer. */
  label: string;
  /** Requested sketch-local target is still valid at `revisionId`. */
  isValid: boolean;
  /** Machine-readable invalidation reason when `isValid` is false. */
  invalidationReason: SolverReferenceInvalidationReason | null;
}

/**
 * Request to resolve a sketch-local target and report whether it is still valid.
 */
export interface ResolveSketchReferenceRequest extends SketchSolverRequestBase {
  /** Sketch-local target whose validity and label should be resolved. */
  target: SolverResolvableSketchRef;
  /** Current solved sketch snapshot used when resolving derived regions. */
  solvedSnapshot: SolvedSketchSnapshot;
  /** Current derived regions used when resolving `RegionRef` targets. */
  regions: RegionRecord[];
  /** Current authored sketch definition used when resolving authored targets. */
  definition: SketchDefinition;
}

/**
 * Response for explicit sketch-local reference resolution.
 */
export interface ResolveSketchReferenceResponse extends SketchSolverResponseBase {
  /** Explicit resolution record for the requested target. */
  resolution: ResolvedSketchReferenceRecord;
  /** Diagnostics emitted while resolving the requested target. */
  diagnostics: SketchSolveDiagnostic[];
}
