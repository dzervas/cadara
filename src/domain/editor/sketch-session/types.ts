import type {
  ConstraintId,
  DimensionId,
  RenderableId,
  SketchAuthoringOperationId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type { MaybeAuthoredValue } from "@/contracts/modeling/authored-values";
import type {
  SketchReferenceImageRecord,
  SketchDefinition,
  SketchEntityDefinition,
  SketchSolveDiagnostic,
  SolvedOffsetFramePlanRecord,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import type {
  SketchConstraintRef,
  SketchDimensionRef,
  SketchEntityRef,
  SketchPointRef,
} from "@/contracts/shared/references";
import type {
  SketchPlaneDefinition,
  SketchPlaneSupportRef,
} from "@/contracts/shared/sketch-plane";
import type { SketchPlaneFrame } from "@/contracts/shared/sketch-plane";
import type {
  CommitSketchRequest,
  DocumentVariableRecord,
  SketchPlaneKey,
  SketchPoint,
} from "@/contracts/modeling/schema";
import type { RenderableEntityRecord } from "@/contracts/render/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import type {
  ProjectedSketchReferenceRecord,
  SolverTolerancePolicy,
} from "@/contracts/solver/schema";
import type {
  SketchToolAnchorDescriptor,
  SketchToolControlValue,
  SketchToolPresentationSchema,
} from "@/core/sketch-tools/editor-schema";
import type { SketchSnapCandidate } from "@/domain/sketch-snapping/snap-candidates";
import type { SketchStyleFocus } from "@/domain/sketch-styles/definition";
import type { OffsetSide } from "@/domain/sketch-editing/operations";
import type { SketchEditToolId } from "@/core/sketch-edit-tools/definition";
import type { ActiveSketchSpecialModeSession } from "@/core/sketch-special-modes/schema";
import type {
  DimensionAnnotationPlacement,
  RegionRecord,
  SketchDerivedValidity,
} from "@/contracts/sketch/schema";
import type { RegionBoundaryBasis } from "@/contracts/sketch/region-boundary-curves";
import type { SketchEditIntersectionInput } from "@/contracts/sketch/edit-intersections";

export type {
  SketchDraftEntity,
  SketchToolId,
} from "@/core/sketch-tools/definition";
export type { SketchConstraintToolId } from "@/core/sketch-constraints/definition";

export type SketchConstructionToolId = "construction";
export type SketchReferenceToolId = "projectReference";
export type SketchAuthoringToolId =
  | import("@/core/sketch-tools/definition").SketchToolId
  | SketchEditToolId
  | import("@/core/sketch-constraints/definition").SketchConstraintToolId
  | SketchConstructionToolId
  | SketchReferenceToolId;
export type SketchSessionStatus =
  | "idle"
  | "drawing"
  | "collectingTargets"
  | "awaitingValue";

export interface SketchConstraintAuthoringState {
  toolId: import("@/core/sketch-constraints/definition").SketchConstraintToolId;
  selectedTargets: import("@/core/sketch-constraints/definition").SketchConstraintTargetRecord[];
  hoverTarget:
    | import("@/core/sketch-constraints/definition").SketchConstraintTargetRecord
    | null;
  pointer: SketchPoint | null;
  isPreviewPinned: boolean;
  pendingValue: MaybeAuthoredValue<number> | null;
  pendingAnnotationPlacement: DimensionAnnotationPlacement | null;
}

export interface SketchAnnotationEditState {
  target: SketchConstraintRef | SketchDimensionRef;
  pendingValue: MaybeAuthoredValue<number> | null;
}

export interface SketchAnnotationDescriptor {
  id: string;
  target: SketchConstraintRef | SketchDimensionRef;
  glyphKind: SketchAnnotationGlyphKind;
  anchor: SketchToolAnchorDescriptor;
  affectedGeometryRefs: readonly PrimitiveRef[];
  constraintDisplay?: SketchConstraintDisplayTargetState;
  label: string;
  detail: string;
  status: "constraint" | "dimension";
  visibleLabel?: string;
  dragHandle?: SketchDimensionAnnotationDragHandle;
}

export interface SketchDimensionAnnotationDragHandle {
  id: string;
  dimensionId: DimensionId;
}

export type SketchAnnotationGlyphKind =
  | "constraintCoincident"
  | "constraintCollinear"
  | "constraintParallel"
  | "constraintEqual"
  | "constraintHorizontal"
  | "constraintVertical"
  | "constraintFixed"
  | "constraintAngle"
  | "constraintPerpendicular"
  | "constraintTangent"
  | "constraintConcentric"
  | "constraintMidpoint"
  | "constraintNormal"
  | "constraintPierce"
  | "constraintSymmetric"
  | "dimensionDistance"
  | "dimensionHorizontal"
  | "dimensionVertical"
  | "dimensionRadius"
  | "dimensionAngle"
  | "dimensionCoincident";

export interface SketchGeometryDragState {
  /** The original PrimitiveRef that was grabbed. */
  target: import("@/core/editor/schema").PrimitiveRef;
  handle: import("@/domain/editor/sketch-session/drag-intent").SketchDragHandle;
  intent: import("@/domain/editor/sketch-session/drag-intent").SketchDragIntent;
  /** Pre-drag definition, for cancel restoration (incl. automatic tangent state). */
  preDragDefinition: import("@/contracts/sketch/schema").SketchDefinition;
  startPoint: SketchPoint;
  currentPoint: SketchPoint;
  /** Offset from pointer-down to the grabbed target, applied every frame. */
  grabOffset: SketchPoint;
  status: "dragging" | "blocked";
  message: string | null;
  /** Set once any frame of this gesture was accepted. */
  acceptedFrame?: true;
  interactiveSolveSession:
    | import("@/contracts/sketch/solver-core").SketchCompiledSolveSession
    | null;
}

/** Synchronous, kernel-free live solve that is the basis of live regions. */
export interface SketchLiveSolve {
  /**
   * T10g-1 (design review R-6): the authored `session.definition` this solve
   * was established for (`withLiveSolveBasis`). The live solve is the one of
   * the current definition exactly when this is `session.definition`.
   */
  sourceDefinition: SketchDefinition;
  /** Evaluated definition used for the solve. */
  definition: SketchDefinition;
  projectedReferences: ProjectedSketchReferenceRecord[];
  solvedSnapshot: SolvedSketchSnapshot;
  /** Solved, with every constraint satisfied. */
  accepted: boolean;
}

/**
 * Display-only live regions. Features consume committed regions, never these.
 * `regions` are the last published (accepted) regions; they are retained, as
 * stale display, while a derivation is pending or the solve is not accepted.
 */
export interface SketchLiveRegions {
  /** Incremented on every new live solve basis. */
  generation: number;
  status: "current" | "pending" | "unavailable" | "failed";
  regions: RegionRecord[];
  /**
   * T10 review R2: the accepted pair that produced `regions`, bound to them.
   * It travels with `regions` (retained together while stale), so fill and
   * measurement resolve stale regions against their own pair, never the
   * moving live definition. Null only when there are no regions (every
   * producer builds it with them; a region that does not resolve against it
   * is reported as a `profile-boundary-unresolved` region diagnostic).
   */
  boundaryBasis: RegionBoundaryBasis | null;
  diagnostics: SketchSolveDiagnostic[];
}

/** Input of one async live region derivation, captured from the live solve. */
export interface SketchLiveRegionBasis {
  sketchId: SketchId;
  definition: SketchDefinition;
  projectedReferences: ProjectedSketchReferenceRecord[];
  solvedSnapshot: SolvedSketchSnapshot;
  /** Document modeling tolerance; carried now, sent on the request from T09e. */
  modelingTolerance: number;
}

/**
 * U-G3 / [TECH] G11: the certification of the staged derived-offset preview.
 * Commit applies exactly `contribution` once it is `certified`; a commit
 * requested while `pending` waits; `failed` commits nothing and shows its
 * message on the preview.
 */
export interface SketchOffsetPreviewPublication {
  /** The previewed relationship (identity of this check). */
  derivationId: string;
  /** The exact authored contribution being checked and, if certified, committed. */
  contribution: import("@/core/sketch-tools/definition").SketchToolCommitContribution;
  /** The preview's accepted pair; null when it is not solver-accepted (U-G1). */
  basis: SketchLiveRegionBasis | null;
  status: "pending" | "certified" | "failed";
  message: string | null;
  commitRequested: boolean;
  /** True after the one `planChanged` re-authoring ([TECH] G3). */
  replanned: boolean;
}

/**
 * T10g-1: one Trim click waiting for its exact edit intersections; T10g-2:
 * or one completed Extend/Split selection (target, then boundary).
 */
export interface SketchEditQueryClick {
  targetEntityId: SketchEntityId;
  /** Review R-5: the target entity object at click time (its identity). */
  entity: SketchEntityDefinition;
  /** Extend/Split: the boundary and its entity object at click time. */
  boundary?: { entityId: SketchEntityId; entity: SketchEntityDefinition };
}

/**
 * T10g-1 (design §2.7 with review R-1/R-5, A-4): the edit-query clicks in FIFO
 * order. The head is in flight once its query is issued on a basis that is
 * the accepted live solve of the current definition (publication-current
 * when the sketch has offset relationships); its result applies only to
 * that definition and live solve.
 */
export interface SketchEditQueryState {
  queue: SketchEditQueryClick[];
  inFlight: {
    queryId: string;
    /** `session.definition` (identity) the query was issued for. */
    definition: SketchDefinition;
    /** The live generation the basis belongs to. */
    generation: number;
    input: SketchEditIntersectionInput;
  } | null;
}

export interface SketchEditToolState {
  toolId: SketchEditToolId;
  hoverTarget: PrimitiveRef | null;
  selectedTarget: PrimitiveRef | null;
  selectedTargets: PrimitiveRef[];
  offsetDistance: number | null;
  offsetSide: OffsetSide;
  toolValue: number | null;
  /** U-G3: the staged derived-offset preview's publication (offset tool only). */
  offsetPublication?: SketchOffsetPreviewPublication;
  /** T10g-1/T10g-2: queued and in-flight clicks (Trim, Extend, Split only). */
  editQuery?: SketchEditQueryState;
}

/**
 * An active Line chain (T11-D11/D12): where it started and the segments it
 * committed, in order. Kept across Undo/Redo; each restore reconciles it
 * with the restored definition (`reconcileSketchToolDraft`).
 */
export interface SketchToolChain {
  start: { pointId: SketchPointId | null; position: SketchPoint };
  segments: readonly {
    entityId: SketchEntityId;
    startPointId: SketchPointId;
    endPointId: SketchPointId;
  }[];
}

export interface SketchSessionState {
  actionContextId: SketchId;
  actionAvailability?: { canUndo: boolean; canRedo: boolean };
  actionHistory?: {
    undo: readonly {
      sequence: number;
      label: string;
      blockedReason?: string;
    }[];
    redo: readonly {
      sequence: number;
      label: string;
      blockedReason?: string;
    }[];
  };
  sketchId: SketchId | null;
  sketchLabel: string;
  plane: SketchPlaneDefinition;
  planeTarget: SketchPlaneSupportRef;
  planeKey: SketchPlaneKey | null;
  toolStagedEntities: readonly import("@/core/sketch-tools/definition").SketchDraftEntity[];
  definition: SketchDefinition;
  documentVariables: readonly DocumentVariableRecord[];
  /** Document tolerance policy judging every live solve and projection. */
  solverTolerances: SolverTolerancePolicy;
  /** The document's settings.modelingTolerance. */
  modelingTolerance: number;
  /**
   * [TECH] G3/G17 offset plan hints of the next solves: the last current
   * publication's plans, or one `planChanged` round's certified hints.
   */
  offsetPlans?: readonly SolvedOffsetFramePlanRecord[];
  /**
   * [TECH] G5/G16: the last current publication's relationship-scoped
   * diagnostics (display only; never solve diagnostics).
   */
  offsetPublicationDiagnostics?: readonly SketchSolveDiagnostic[];
  activeTool: SketchAuthoringToolId | null;
  status: SketchSessionStatus;
  constructionTargetPicking: boolean;
  referenceTargetPicking: boolean;
  constructionModifierActive: boolean;
  pointerDownPoint: SketchPoint | null;
  livePoint: SketchPoint | null;
  toolPlacedPoints: readonly SketchPoint[];
  toolSettings: Record<string, SketchToolControlValue>;
  toolPresentation: SketchToolPresentationSchema | null;
  constraintAuthoring: SketchConstraintAuthoringState | null;
  activeAnnotationEdit: SketchAnnotationEditState | null;
  selectedAnnotation: SketchConstraintRef | SketchDimensionRef | null;
  activeEditTool: SketchEditToolState | null;
  activeEditTarget: SketchPointRef | null;
  activeStyleFocus: SketchStyleFocus | null;
  activeSpecialMode: ActiveSketchSpecialModeSession | null;
  activeDrag: SketchGeometryDragState | null;
  activeSnap: SketchSnapCandidate | null;
  drawStartSnap: SketchSnapCandidate | null;
  /**
   * The snap accepted on a fit-point draft's last placed point: the end snap
   * of its finalize commit (T11i). Absent or null otherwise.
   */
  fitPointEndSnap?: SketchSnapCandidate | null;
  /** The active Line chain; absent or null when no chain is active. */
  toolChain?: SketchToolChain | null;
  sequence: number;
  /** Null until the session first solves; opened sessions show committed regions. */
  liveSolve: SketchLiveSolve | null;
  liveRegions: SketchLiveRegions;
  projectedReferences: ProjectedSketchReferenceRecord[];
  projectionDiagnostics: ProjectedSketchReferenceRecord["diagnostics"];
  commitRequest: Omit<
    CommitSketchRequest,
    "contractVersion" | "documentId" | "baseRevisionId"
  > | null;
  validationMessage: string | null;
}

export interface SketchSessionDisplayRenderable {
  id: RenderableId;
  label: string;
  geometry: RenderableEntityRecord["geometry"];
  target: PrimitiveRef | null;
  linePattern: "solid" | "dashed";
  role: "local" | "reference";
  semanticClass?:
    | RenderableEntityRecord["binding"]["semanticClass"]
    | "sketchReference"
    | "sketchImage";
  markerLayer?: "default" | "overlay";
  /**
   * A sketch point marker's display rule (T11-D8): `always` (no owning
   * curve), or `contextual` (shown only near or on its owning curves;
   * `getSketchPointMarkerVisibility`).
   */
  pointMarker?: {
    visibility: "always" | "contextual";
    ownerEntityIds: readonly SketchEntityId[];
  };
  /**
   * A tangent handle's display rule (T12d, D8): `contextual` (shown only
   * when its spline, a fit point or a handle is hovered/selected/dragged).
   */
  handleDisplay?: {
    visibility: "contextual";
    ownerEntityId: SketchEntityId;
    isAuthored: boolean;
  };
  paintStyle?: SketchDisplayPaintStyle;
  strokeStyle?: SketchDisplayStrokeStyle;
  constraintDisplay?: SketchConstraintDisplayTargetState;
  diagnosticStyle?: SketchDisplayDiagnosticStyle;
  /** Live region validity; non-current region fill renders with a red tint. */
  regionValidity?: SketchDerivedValidity["state"];
  sketchPlaneFrame?: SketchPlaneFrame;
  textureFill?: {
    kind: "inlineImage";
    sourceKey: string;
    mediaType: string;
    base64Data: string;
    uvCoordinates: readonly [
      readonly [number, number],
      readonly [number, number],
      readonly [number, number],
      readonly [number, number],
    ];
    opacity: number;
  };
}

export type SketchConstraintDisplayState =
  | "constrained"
  | "underconstrained"
  | "overconstrained";

export interface SketchConstraintDisplayTargetState {
  state: SketchConstraintDisplayState;
  isAffectedOverconstraint: boolean;
}

export interface SketchConstraintDisplaySummary {
  state: SketchConstraintDisplayState;
  affectedTargetKeys: ReadonlySet<string>;
  /**
   * [TECH] G16″: targets of requirements blocked by a failed offset
   * relationship; they get the problem styling even when the sketch solves.
   */
  blockedTargetKeys: ReadonlySet<string>;
}

export interface SketchDisplayDiagnosticStyle {
  kind: "overconstraint";
}

export type SketchDisplayPaintStyle =
  | {
      kind?: "solid";
      color: number;
      opacity: number;
    }
  | {
      kind: "linearGradient";
      color: number;
      opacity: number;
      startColor: number;
      startOpacity: number;
      endColor: number;
      endOpacity: number;
      angleRadians: number;
    };

export interface SketchDisplaySolidPaintStyle {
  color: number;
  opacity: number;
}

export interface SketchDisplayStrokeStyle {
  color: number;
  opacity: number;
  width?: number;
  lineCap?: "butt" | "round" | "square";
  lineJoin?: "miter" | "round" | "bevel";
  miterLimit?: number;
  dashSize?: number;
  gapSize?: number;
}

export type SketchHistoryItem =
  | {
      kind: "operation";
      id: SketchAuthoringOperationId;
      label: string;
      operation: SketchReferenceImageRecord;
      target: PrimitiveRef | null;
    }
  | {
      kind: "entity";
      id: SketchEntityId;
      label: string;
      target: SketchEntityRef;
    }
  | {
      kind: "constraint";
      id: ConstraintId;
      label: string;
      target: SketchConstraintRef;
    }
  | {
      kind: "dimension";
      id: DimensionId;
      label: string;
      target: SketchDimensionRef;
    };
