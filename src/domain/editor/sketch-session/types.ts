import type {
  ConstraintId,
  DimensionId,
  RenderableId,
  SketchAuthoringOperationId,
  SketchEntityId,
  SketchId,
} from "@/contracts/shared/ids";
import type { MaybeAuthoredValue } from "@/contracts/modeling/authored-values";
import type {
  SketchReferenceImageRecord,
  SketchDefinition,
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
  target: SketchPointRef;
  startPoint: SketchPoint;
  currentPoint: SketchPoint;
  status: "dragging" | "blocked";
  message: string | null;
  interactiveSolveSession:
    | import("@/contracts/sketch/solver-core").SketchCompiledSolveSession
    | null;
}

/** Synchronous, kernel-free live solve that is the basis of live regions. */
export interface SketchLiveSolve {
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
