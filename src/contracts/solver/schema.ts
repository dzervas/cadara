import type {
  ConstraintId,
  DimensionId,
  DocumentId,
  ProjectedGeometryId,
  ReferenceId,
  RequestId,
  RevisionId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from '@/contracts/shared/ids'
import type {
  RegionRef,
  SketchEntityRef,
  SketchPointRef,
  SketchRef,
} from '@/contracts/shared/references'
import type { ContractVersion } from '@/contracts/shared/versioning'
import type { SketchPlaneFrame } from '@/contracts/shared/sketch-plane'
import type {
  RegionRecord,
  ProjectedSketchGeometryRef,
  SketchDefinition,
  SketchPoint2D,
  SketchReferenceDefinition,
  SketchSolveDiagnostic,
  SolvedSketchSnapshot,
  SolvedSketchStatus,
} from '@/contracts/sketch/schema'

/**
 * Versioned schema identifier for the dedicated sketch solver contract family.
 * Implementers must reject requests that declare an unsupported schema version.
 */
export type SolverSchemaVersion = 'sketch-solver/v1alpha1'

/**
 * Current sketch solver schema version literal.
 */
export const SOLVER_SCHEMA_VERSION: SolverSchemaVersion = 'sketch-solver/v1alpha1'
export type { SketchPlaneFrame }

/**
 * Declares how the solver should treat incomplete or conflicting edits.
 * `bestEffort` allows partial solved output when the solver can produce one.
 * `failOnConflict` requires the response to stop at diagnostics if a full solve
 * is not available.
 */
export type SolverPartialSolvePolicy = 'bestEffort' | 'failOnConflict'

/**
 * Explicit tolerance policy used when validating, projecting, and solving.
 * The caller owns these tolerances so the solver does not need hidden defaults.
 */
export interface SolverTolerancePolicy {
  /** Maximum point-to-point separation treated as coincident in sketch-plane units. */
  coincidence: number
  /** Maximum angular deviation treated as equal direction in radians. */
  angleRadians: number
  /** Minimum non-zero segment length considered valid in sketch-plane units. */
  minimumSegmentLength: number
}

/**
 * Explicit incremental edit hint for solvers that support warm starting.
 * This is advisory only; solvers may ignore it while preserving the same result.
 */
export type SketchIncrementalEdit =
  | {
      /** Indicates that authored points were added, removed, or edited. */
      kind: 'pointGraphChanged'
      /** Point identities whose authored records changed since the prior solve. */
      pointIds: SketchPointId[]
    }
  | {
      /** Indicates that authored entities were added, removed, or edited. */
      kind: 'entityGraphChanged'
      /** Entity identities whose authored records changed since the prior solve. */
      entityIds: SketchEntityId[]
    }
  | {
      /** Indicates that authored constraints or dimensions changed. */
      kind: 'constraintGraphChanged'
      /** Constraint identities whose authored records changed. */
      constraintIds: ConstraintId[]
      /** Dimension identities whose authored records changed. */
      dimensionIds: DimensionId[]
    }

/**
 * Temporary interactive drag target supplied by an editor preview.
 * This is solver input only and must not be persisted as an authored constraint.
 */
export interface SolverDraggedSketchPointTarget {
  /** Temporary target discriminant. */
  kind: 'sketchPoint'
  /** Authored point the user is dragging. */
  pointId: SketchPointId
  /** Requested sketch-plane point position for this solve. */
  position: SketchPoint2D
}

/**
 * Projection-ready record for an authored external sketch reference.
 * The solver consumes these definitions and returns explicit 2D geometry.
 */
export interface SolverExternalReferenceInput {
  /** Authored reference identity from `SketchDefinition.referenceIds`. */
  referenceId: ReferenceId
  /** Original authored reference definition submitted for projection. */
  reference: SketchReferenceDefinition
}

/**
 * Projected 2D point owned by the solver for an external reference.
 * Coordinates are expressed in the sketch plane frame of the containing request.
 */
export interface ProjectedSketchPointGeometry {
  /** Stable projected-geometry identity scoped to one authored reference. */
  geometryId: ProjectedGeometryId
  /** Geometry discriminant for a projected point result. */
  kind: 'point'
  /** Projected point coordinates in sketch-plane units. */
  position: SketchPoint2D
}

/**
 * Projected 2D line segment owned by the solver for an external reference.
 * Coordinates are expressed in the sketch plane frame of the containing request.
 */
export interface ProjectedSketchLineSegmentGeometry {
  /** Stable projected-geometry identity scoped to one authored reference. */
  geometryId: ProjectedGeometryId
  /** Geometry discriminant for a projected line result. */
  kind: 'lineSegment'
  /** Projected line start in sketch-plane units. */
  startPosition: SketchPoint2D
  /** Projected line end in sketch-plane units. */
  endPosition: SketchPoint2D
}

/**
 * Projected 2D circle owned by the solver for an external reference.
 * Coordinates are expressed in the sketch plane frame of the containing request.
 */
export interface ProjectedSketchCircleGeometry {
  /** Stable projected-geometry identity scoped to one authored reference. */
  geometryId: ProjectedGeometryId
  /** Geometry discriminant for a projected circle result. */
  kind: 'circle'
  /** Projected circle center in sketch-plane units. */
  centerPosition: SketchPoint2D
  /** Projected circle radius in sketch-plane units. */
  radius: number
}

/**
 * Projected 2D arc owned by the solver for an external reference.
 * Coordinates are expressed in the sketch plane frame of the containing request.
 */
export interface ProjectedSketchArcGeometry {
  /** Stable projected-geometry identity scoped to one authored reference. */
  geometryId: ProjectedGeometryId
  /** Geometry discriminant for a projected arc result. */
  kind: 'arc'
  /** Projected arc center in sketch-plane units. */
  centerPosition: SketchPoint2D
  /** Projected arc start in sketch-plane units. */
  startPosition: SketchPoint2D
  /** Projected arc end in sketch-plane units. */
  endPosition: SketchPoint2D
  /** Sweep direction from start to end about `centerPosition`. */
  sweepDirection: 'clockwise' | 'counterClockwise'
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

/**
 * Machine-readable projection status for an authored external reference.
 * Callers must rely on this code rather than parsing diagnostic messages.
 */
export type ProjectedSketchReferenceStatus =
  | 'projected'
  | 'unsupportedSource'
  | 'missingSource'
  | 'outOfPlane'
  | 'ambiguous'

/**
 * Explicit solver-owned external-reference projection record.
 * This is the only source of truth for how external geometry enters sketch
 * space; the editor must not infer projected geometry on its own.
 */
export interface ProjectedSketchReferenceRecord {
  /** Authored reference identity from `SketchDefinition.referenceIds`. */
  referenceId: ReferenceId
  /** Projection result status for the authored reference. */
  status: ProjectedSketchReferenceStatus
  /** Projected sketch-space geometry when the projection succeeded. */
  geometry: ProjectedSketchReferenceGeometry[]
  /** Diagnostics specific to this external reference projection. */
  diagnostics: SketchSolveDiagnostic[]
}

/**
 * Explicit solver-owned projected geometry resolution record.
 */
export interface ResolvedProjectedSketchGeometryRecord {
  /** Stable projected geometry requested by the caller. */
  reference: ProjectedSketchGeometryRef
  /** Human-readable label owned by the solver/kernel producer. */
  label: string
  /** Requested projected geometry is still valid at `revisionId`. */
  isValid: boolean
  /** Machine-readable invalidation reason when `isValid` is false. */
  invalidationReason: SolverReferenceInvalidationReason | null
}

/**
 * Base request envelope shared by all sketch solver operations.
 * The caller owns correlation, document identity, revision basis, and protocol
 * versioning; the solver must echo them back exactly in the response.
 */
export interface SketchSolverRequestBase {
  /** Shared top-level contract version across the modeling/solver boundary. */
  contractVersion: ContractVersion
  /** Version of the sketch solver contract family expected by the caller. */
  solverSchemaVersion: SolverSchemaVersion
  /** Correlation identifier for the async request/response pair. */
  requestId: RequestId
  /** Durable document identity against which the request is evaluated. */
  documentId: DocumentId
  /**
   * Base committed revision against which the request is evaluated.
   * Solvers must not silently apply the request against a different revision.
   */
  revisionId: RevisionId
  /** Durable sketch identity being solved, validated, or inspected. */
  sketchId: SketchId
}

/**
 * Common response envelope shared by all sketch solver operations.
 * The solver must echo the originating request context exactly so stale results
 * can be discarded safely by the caller.
 */
export interface SketchSolverResponseBase {
  /** Shared top-level contract version across the modeling/solver boundary. */
  contractVersion: ContractVersion
  /** Version of the sketch solver contract family used to produce this response. */
  solverSchemaVersion: SolverSchemaVersion
  /** Correlation identifier copied from the originating request. */
  requestId: RequestId
  /** Durable document identity copied from the originating request. */
  documentId: DocumentId
  /** Revision against which the solver evaluated this response. */
  revisionId: RevisionId
  /** Durable sketch identity copied from the originating request. */
  sketchId: SketchId
}

/**
 * Request to project external model references into sketch-space coordinates.
 * The caller owns the authored references and plane frame; the solver owns the
 * resulting 2D geometry and projection diagnostics.
 */
export interface ProjectSketchExternalReferencesRequest extends SketchSolverRequestBase {
  /** Sketch-plane frame into which external references must be projected. */
  plane: SketchPlaneFrame
  /** Explicit tolerance policy for projection and coplanarity checks. */
  tolerances: SolverTolerancePolicy
  /** Authored external references from the current sketch definition. */
  references: SolverExternalReferenceInput[]
}

/**
 * Response for explicit external-reference projection.
 */
export interface ProjectSketchExternalReferencesResponse extends SketchSolverResponseBase {
  /** Projection result per authored external reference. */
  projectedReferences: ProjectedSketchReferenceRecord[]
  /** Aggregate diagnostics not owned by any single projected reference. */
  diagnostics: SketchSolveDiagnostic[]
}

/**
 * Request to validate a sketch definition prior to a full solve.
 * This detects malformed authored payloads and missing projections without
 * requiring the solver to return solved geometry.
 */
export interface ValidateSketchRequest extends SketchSolverRequestBase {
  /** Sketch-plane frame used to interpret authored and projected coordinates. */
  plane: SketchPlaneFrame
  /** Explicit tolerance policy for validation checks. */
  tolerances: SolverTolerancePolicy
  /** Durable authored sketch definition submitted for validation. */
  definition: SketchDefinition
  /** Explicit projected external references already resolved into sketch space. */
  projectedReferences: ProjectedSketchReferenceRecord[]
}

/**
 * Validation response for an authored sketch definition.
 */
export interface ValidateSketchResponse extends SketchSolverResponseBase {
  /** True only when the authored sketch payload is valid for solving. */
  isValid: boolean
  /** Machine-readable validation diagnostics. */
  diagnostics: SketchSolveDiagnostic[]
}

/**
 * Request to solve a sketch definition into authoritative solved geometry.
 * The caller provides authored input, projected external references, and solve
 * policy; the solver owns the returned solved snapshot and status.
 */
export interface SolveSketchRequest extends SketchSolverRequestBase {
  /** Sketch-plane frame used to interpret authored and solved coordinates. */
  plane: SketchPlaneFrame
  /** Explicit tolerance policy for solve and consistency checks. */
  tolerances: SolverTolerancePolicy
  /** Declares whether the solver may return partial results when conflicts exist. */
  partialSolvePolicy: SolverPartialSolvePolicy
  /** Durable authored sketch definition to solve. */
  definition: SketchDefinition
  /** Explicit projected external references available to the solver. */
  projectedReferences: ProjectedSketchReferenceRecord[]
  /** Optional incremental edit hint from the caller for warm-start capable solvers. */
  incrementalEdit: SketchIncrementalEdit | null
  /** Optional temporary drag target used for interactive preview solves. */
  dragTarget?: SolverDraggedSketchPointTarget | null
}

/**
 * Solve response for a sketch definition.
 * Solved status, geometry, and diagnostics are authoritative solver outputs.
 */
export interface SolveSketchResponse extends SketchSolverResponseBase {
  /** Solver-owned solved status summary for the authored sketch definition. */
  status: SolvedSketchStatus
  /** Authoritative solved geometry and per-constraint/dimension results. */
  solvedSnapshot: SolvedSketchSnapshot
  /** Regions derived from `solvedSnapshot` for the same request basis. */
  derivedRegions: RegionRecord[]
  /** Diagnostics emitted during validation or solving. */
  diagnostics: SketchSolveDiagnostic[]
}

/**
 * Request to derive closed regions from a solved sketch state.
 * Regions must be derived here or by the kernel, never authored by the editor.
 */
export interface DeriveSketchRegionsRequest extends SketchSolverRequestBase {
  /** Solved sketch snapshot that region derivation must consume. */
  solvedSnapshot: SolvedSketchSnapshot
  /** Authored sketch definition corresponding to `solvedSnapshot`. */
  definition: SketchDefinition
  /** Explicit projected external references available to region derivation. */
  projectedReferences: ProjectedSketchReferenceRecord[]
}

/**
 * Region-derivation response for a solved sketch.
 */
export interface DeriveSketchRegionsResponse extends SketchSolverResponseBase {
  /** Solver- or kernel-derived closed regions for downstream feature authoring. */
  regions: RegionRecord[]
  /** Diagnostics emitted while deriving sketch regions. */
  diagnostics: SketchSolveDiagnostic[]
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
  | ProjectedSketchGeometryRef

/**
 * Machine-readable invalidation reason for sketch-local reference resolution.
 * Callers must rely on this code rather than inferring from human-readable text.
 */
export type SolverReferenceInvalidationReason =
  | 'missingSketch'
  | 'missingEntity'
  | 'missingPoint'
  | 'missingRegion'
  | 'missingProjectedGeometry'
  | 'revisionMismatch'

/**
 * Explicit sketch-local reference resolution record returned by the solver.
 * This allows the caller to confirm ownership and invalidation without guessing.
 */
export interface ResolvedSketchReferenceRecord {
  /** Resolved sketch-local target or the dead target that was requested. */
  target: SolverResolvableSketchRef
  /** Human-readable label owned by the solver/kernel producer. */
  label: string
  /** Requested sketch-local target is still valid at `revisionId`. */
  isValid: boolean
  /** Machine-readable invalidation reason when `isValid` is false. */
  invalidationReason: SolverReferenceInvalidationReason | null
}

/**
 * Request to resolve a sketch-local target and report whether it is still valid.
 */
export interface ResolveSketchReferenceRequest extends SketchSolverRequestBase {
  /** Sketch-local target whose validity and label should be resolved. */
  target: SolverResolvableSketchRef
  /** Current solved sketch snapshot used when resolving derived regions. */
  solvedSnapshot: SolvedSketchSnapshot
  /** Current derived regions used when resolving `RegionRef` targets. */
  regions: RegionRecord[]
  /** Current authored sketch definition used when resolving authored targets. */
  definition: SketchDefinition
}

/**
 * Response for explicit sketch-local reference resolution.
 */
export interface ResolveSketchReferenceResponse extends SketchSolverResponseBase {
  /** Explicit resolution record for the requested target. */
  resolution: ResolvedSketchReferenceRecord
  /** Diagnostics emitted while resolving the requested target. */
  diagnostics: SketchSolveDiagnostic[]
}
