import type { AuthoredActionContext } from "@/contracts/modeling/authored-actions";
import type { DurableHistoryAvailability } from "@/contracts/modeling/durable-history";
import type { ModelingDiagnostic } from "@/contracts/modeling/schema";
import type {
  CommandSessionId,
  DocumentId,
  RequestId,
  RevisionId,
} from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import type { SketchPoint } from "@/contracts/modeling/schema";
import type {
  SketchPointId,
  SketchEntityId,
  SketchId,
  RegionId,
} from "@/contracts/shared/ids";
import type {
  SketchDerivedValidity,
  SolvedSketchStatus,
} from "@/contracts/sketch/schema";

export type SemanticSketchPrimitive =
  | { kind: "ellipse" | "conic"; points: readonly [SketchPoint, SketchPoint, SketchPoint] }
  | { kind: "ellipticalArc"; points: readonly [SketchPoint, SketchPoint, SketchPoint, SketchPoint, SketchPoint] }
  | { kind: "bezierCurve" | "controlPointSpline"; controlPoints: readonly [SketchPoint, SketchPoint, SketchPoint, SketchPoint] }
  | { kind: "profileText"; anchor: SketchPoint; heightPoint: SketchPoint; text: string; horizontalAlign: "left" | "center" | "right"; verticalAlign: "baseline" | "middle" | "top" | "bottom" }
  | { kind: "spline"; fitPoints: readonly SketchPoint[] }
  | { kind: "point"; position: SketchPoint }
  | { kind: "line"; start: SketchPoint; end: SketchPoint }
  | {
      kind: "rectangle" | "centerPointRectangle";
      start: SketchPoint;
      end: SketchPoint;
    }
  | {
      kind: "alignedRectangle";
      start: SketchPoint;
      end: SketchPoint;
      heightPoint: SketchPoint;
    }
  | { kind: "circle" | "inscribedPolygon" | "circumscribedPolygon"; center: SketchPoint; radius: number }
  | { kind: "threePointCircle" | "threePointArc"; points: readonly [SketchPoint, SketchPoint, SketchPoint] }
  | { kind: "centerPointArc"; center: SketchPoint; start: SketchPoint; end: SketchPoint }
  | { kind: "tangentArc"; start: SketchPoint; direction: SketchPoint; end: SketchPoint; source: Extract<DurableRef, { kind: "sketchEntity" }> | null };

export type SemanticRequirementTarget = SemanticSketchGeometryTarget
  | import("@/contracts/shared/references").SketchDatumReferenceRef
  | import("@/contracts/shared/references").ProjectedReferenceGeometryRef;
export interface SemanticRequirementInput {
  tool: "dimensionDistance" | "dimensionHorizontal" | "dimensionVertical" | "dimensionRadius" | "constraintCoincident" | "constraintCollinear"
    | "constraintParallel" | "constraintPerpendicular" | "constraintTangent"
    | "constraintEqual" | "constraintHorizontal" | "constraintVertical"
    | "constraintConcentric" | "constraintMidpoint" | "constraintNormal"
    | "constraintPierce" | "constraintSymmetric" | "constraintFix";
  targets: readonly SemanticRequirementTarget[];
  mode: "driving" | "reference";
  value: number | null;
}

export type SemanticDimensionInput = {
  axis: "horizontal" | "vertical";
  points: readonly [SketchPointId, SketchPointId];
} & ({ mode: "driving"; value: number } | { mode: "reference" });

export type SemanticSketchGeometryTarget = Extract<DurableRef, { kind: "sketchPoint" | "sketchEntity" }>;
export type SemanticSketchLabelTarget = Extract<DurableRef, { kind: "sketchPoint" | "sketchEntity" | "dimension" | "constraint" | "sketch" }>;
/** Explicit geometry intents reuse the existing constrained edit solver, not pointer choreography. */
export type SemanticSketchGeometryEdit =
  | { kind: "trim"; target: Extract<DurableRef, { kind: "sketchEntity" }> }
  | { kind: "extend"; target: Extract<DurableRef, { kind: "sketchEntity" }>; boundary: Extract<DurableRef, { kind: "sketchEntity" }> }
  | { kind: "split"; target: Extract<DurableRef, { kind: "sketchEntity" }>; boundary: Extract<DurableRef, { kind: "sketchEntity" }>; pick: SketchPoint }
  | { kind: "mergePoints"; target: Extract<DurableRef, { kind: "sketchPoint" }>; destination: Extract<DurableRef, { kind: "sketchPoint" }> }
  | { kind: "point"; target: Extract<DurableRef, { kind: "sketchPoint" }>; position: SketchPoint }
  | { kind: "translate"; target: Extract<DurableRef, { kind: "sketchEntity" }>; delta: SketchPoint }
  | { kind: "radius"; target: Extract<DurableRef, { kind: "sketchEntity" }>; radius: number }
  | { kind: "tangent"; target: import("@/contracts/shared/references").SketchTangentHandleRef; vector: SketchPoint };

export type SemanticSketchConstruction = {
  targets: readonly Extract<DurableRef, { kind: "sketchEntity" }>[];
} & ({ kind: "fillet"; radius: number } | { kind: "chamfer"; distance: number } | { kind: "slot"; width: number });

export type SemanticSketchStylePatch = {
  [K in keyof Required<import("@/contracts/sketch/schema").SketchStyleDefinition>]: {
    field: K;
    value: Required<import("@/contracts/sketch/schema").SketchStyleDefinition>[K];
  }
}[keyof import("@/contracts/sketch/schema").SketchStyleDefinition];

export type SemanticReferenceImageEdit =
  | { kind: "placement"; placement: import("@/contracts/reference-image/schema").ReferenceImagePlacement }
  | { kind: "settings"; scaleMode: import("@/contracts/reference-image/schema").ReferenceImageCalibrationScaleMode; showExportedAnchorsInSketch: boolean };

export interface SemanticDraftBasis {
  commandSessionId: CommandSessionId;
  generation: number;
}
export type SemanticSketchCommand = CommandIdentity & {
  basis: SemanticBasis;
} & (
    | ({ operation: "sketch.begin" } & ({ plane: "xy" | "yz" | "xz" } | { support: import("@/contracts/shared/sketch-plane").SketchPlaneSupportRef }))
    | { operation: "sketch.open"; sketchId: SketchId }
    | { operation: "sketch.support.reassign"; sketchId: SketchId; support: import("@/contracts/shared/sketch-plane").SketchPlaneSupportRef }
    | { operation: "sketch.image.update"; draft: SemanticDraftBasis; target: Extract<DurableRef, { kind: "sketchOperation" }>; edit: SemanticReferenceImageEdit; intent: "fulfill" | "author-invalid" }
    | { operation: "sketch.image.replace"; draft: SemanticDraftBasis; target: Extract<DurableRef, { kind: "sketchOperation" }>; path: string; intent: "fulfill" | "author-invalid" }
    | { operation: "sketch.image.remove"; draft: SemanticDraftBasis; target: Extract<DurableRef, { kind: "sketchOperation" }>; intent: "fulfill" | "author-invalid" }
    | { operation: "sketch.image.add"; draft: SemanticDraftBasis; path: string; intent: "fulfill" | "author-invalid" }
    | { operation: "sketch.style.patch"; draft: SemanticDraftBasis; targets: readonly Extract<DurableRef, { kind: "region" | "sketchEntity" }>[]; patch: SemanticSketchStylePatch; intent: "fulfill" | "author-invalid" }
    | { operation: "sketch.reference.add"; draft: SemanticDraftBasis; target: Extract<DurableRef, { kind: "construction" | "face" | "edge" | "vertex" | "sketch" | "sketchEntity" | "sketchPoint" }>; intent: "fulfill" | "author-invalid" }
    | {
        operation: "sketch.author";
        draft: SemanticDraftBasis;
        primitive: SemanticSketchPrimitive;
        construction: boolean;
        intent: "fulfill" | "author-invalid";
      }
    | { operation: "sketch.requirement.remove"; draft: SemanticDraftBasis; targets: readonly Extract<DurableRef, { kind: "dimension" | "constraint" }>[]; intent: "fulfill" | "author-invalid" }
    | ({ operation: "sketch.requirement.add"; draft: SemanticDraftBasis; intent: "fulfill" | "author-invalid" } & SemanticRequirementInput)
    | ({ operation: "sketch.dimension.add"; draft: SemanticDraftBasis; intent: "fulfill" | "author-invalid" } & SemanticDimensionInput)
    | { operation: "sketch.dimension.reference"; draft: SemanticDraftBasis; dimensionId: import("@/contracts/shared/ids").DimensionId; intent: "fulfill" | "author-invalid" }
    | { operation: "sketch.dimension.update"; draft: SemanticDraftBasis; dimensionId: import("@/contracts/shared/ids").DimensionId; value: number | string; intent: "fulfill" | "author-invalid" }
    | { operation: "sketch.construction.set"; draft: SemanticDraftBasis; target: Extract<DurableRef, { kind: "sketchPoint" | "sketchEntity" }>; construction: boolean; intent: "fulfill" | "author-invalid" }
    | { operation: "sketch.geometry.update"; draft: SemanticDraftBasis; edit: SemanticSketchGeometryEdit; intent: "fulfill" | "author-invalid" }
    | ({ operation: "sketch.geometry.build"; draft: SemanticDraftBasis; intent: "fulfill" | "author-invalid" } & SemanticSketchConstruction)
    | { operation: "sketch.derivation.create"; draft: SemanticDraftBasis; kind: "linearPattern" | "circularPattern" | "transform"; targets: readonly Extract<DurableRef, { kind: "sketchEntity" }>[]; value: number; intent: "fulfill" | "author-invalid" }
    | { operation: "sketch.mirror.remove"; draft: SemanticDraftBasis; derivationId: string; intent: "fulfill" | "author-invalid" }
    | { operation: "sketch.mirror.repair"; draft: SemanticDraftBasis; derivationId: string; repair: { kind: "axis"; target: Extract<DurableRef, { kind: "sketchEntity" }> | import("@/contracts/shared/references").SketchDatumReferenceRef } | { kind: "original"; output: Extract<DurableRef, { kind: "sketchEntity" }>; target: Extract<DurableRef, { kind: "sketchEntity" }> }; intent: "fulfill" | "author-invalid" }
    | { operation: "sketch.mirror.create"; draft: SemanticDraftBasis; targets: readonly Extract<DurableRef, { kind: "sketchEntity" }>[]; axis: Extract<DurableRef, { kind: "sketchEntity" }> | import("@/contracts/shared/references").SketchDatumReferenceRef; intent: "fulfill" | "author-invalid" }
    | { operation: "sketch.offset.create"; draft: SemanticDraftBasis; targets: readonly Extract<DurableRef, { kind: "sketchEntity" }>[]; distance: number; side: "left" | "right"; intent: "fulfill" | "author-invalid" }
    | { operation: "sketch.offset.remove"; draft: SemanticDraftBasis; derivationId: string; intent: "fulfill" | "author-invalid" }
    | { operation: "sketch.geometry.delete"; draft: SemanticDraftBasis; targets: readonly SemanticSketchGeometryTarget[]; intent: "fulfill" | "author-invalid" }
    | { operation: "sketch.label.set"; draft: SemanticDraftBasis; target: SemanticSketchLabelTarget; label: string; intent: "fulfill" | "author-invalid" }
    | { operation: "sketch.inspect"; draft: SemanticDraftBasis }
    | {
        operation: "sketch.publish";
        draft: SemanticDraftBasis;
        requireProfiles: boolean;
      }
    | { operation: "sketch.discard"; draft: SemanticDraftBasis }
  );

/**
 * Shared semantic boundary v1, not a terminal protocol or editor-event tunnel.
 * Scope: all production-supported semantic operations, sequential recipes,
 * active-process authored history, current native files and existing exports.
 * Onshape importer changes (ticket 37) are explicitly deferred; capture remains
 * independent. No daemon, rendering, cross-session undo, new translator or CAD
 * capability is implied. Families gain concrete inputs in their implementation
 * tickets: an operation is not supported merely because its family exists here.
 *
 * CLI owns JSON recipe encoding, aliases, stdout/stderr and shell codes 0/1/2.
 * These are JSON-compatible values (no Error, Map, binary buffer or editor state).
 * Resolve aliases before validation. Transport versioning does not change native
 * document format. Unknown fields/events are rejected, not passed through.
 */
export interface SemanticBasis {
  documentId: DocumentId;
  revisionId: RevisionId;
  /** Compare as a set; an in-memory repository receipt is not a disk save. */
  repositoryHeads: readonly string[];
}

interface CommandIdentity {
  version: 1;
  /** Unique in this session; never reused while a result can still arrive. */
  commandId: string;
}

export type SemanticFeatureLifecycleCommand = CommandIdentity & {
  basis: SemanticBasis;
  intent: "fulfill" | "author-invalid";
} & (
  | { operation: "feature.suppression.set"; featureId: import("@/contracts/shared/ids").FeatureId; suppressed: boolean }
  | { operation: "feature.reorder"; featureId: import("@/contracts/shared/ids").FeatureId; beforeFeatureId: import("@/contracts/shared/ids").FeatureId | null }
  | { operation: "feature.delete"; featureId: import("@/contracts/shared/ids").FeatureId }
  | { operation: "timeline.reorder"; item: import("@/contracts/modeling/schema").DocumentHistoryOrderEntry; beforeItem: import("@/contracts/modeling/schema").DocumentHistoryOrderEntry | null }
  | { operation: "timeline.cursor.set"; cursor: import("@/contracts/modeling/schema").DocumentFeatureCursor }
  | { operation: "target.delete"; target: DurableRef }
  | { operation: "body.rename"; bodyId: import("@/contracts/shared/ids").BodyId; label: string }
);

export type SemanticVariableCommand = CommandIdentity & {
  basis: SemanticBasis;
  name: string;
  valueText: string;
  intent: "fulfill" | "author-invalid";
} & ({ operation: "variable.add" } | { operation: "variable.update"; variableId: import("@/contracts/shared/ids").DocumentVariableId });

export type SemanticExtrudeCommand = CommandIdentity & {
  basis: SemanticBasis;
  depth: number | string;
  intent: "fulfill" | "author-invalid";
} & (
  | { operation: "extrude.create"; profile: Extract<DurableRef, { kind: "region" }> }
  | { operation: "extrude.update"; featureId: import("@/contracts/shared/ids").FeatureId }
);

/** History uses the active editing owner; null draft explicitly selects document context. */
export type SemanticHistoryCommand = CommandIdentity & {
  basis: SemanticBasis;
  draft: SemanticDraftBasis | null;
} & (
  | { operation: "history.inspect" }
  | { operation: "history.undo" | "history.redo"; actionSequence?: number }
);

export type SemanticExportCommand = CommandIdentity & {
  operation: "export.step";
  basis: SemanticBasis;
  target: DurableRef;
  options: import("@/contracts/export/capabilities").StepWriterOptions;
  path: string;
};

/** Implemented slices. Later tickets extend this closed union. */
export type SemanticCommand =
  | SemanticSketchCommand
  | SemanticExtrudeCommand
  | SemanticVariableCommand
  | SemanticFeatureLifecycleCommand
  | SemanticHistoryCommand
  | SemanticExportCommand
  | (CommandIdentity &
      (
        | { operation: "document.create"; label: string; basis: null }
        | { operation: "document.inspect"; basis: SemanticBasis }
        | { operation: "document.open"; path: string; basis: null }
        | { operation: "document.rename"; label: string; basis: SemanticBasis }
        | { operation: "document.save"; path: string; basis: SemanticBasis }
      ));

export type SemanticFamily =
  | "document"
  | "sketch-open"
  | "sketch-author"
  | "sketch-publish"
  | "sketch-discard"
  | "model-mutate"
  | "history"
  | "file-save"
  | "file-open"
  | "export";

/** author-invalid must come from an explicit command, never a fallback policy. */
export type SemanticIntent = "fulfill" | "inspect" | "author-invalid";

export interface SemanticCorrelation {
  commandId: string;
  family: SemanticFamily;
  intent: SemanticIntent;
  basis: SemanticBasis | null;
}

/** Exact current live basis, also attached to receipts and reference discovery. */
export interface SemanticState extends SemanticBasis {
  /** New owner on fresh-file open. History is private-sketch-first, not cursor undo. */
  editingContext: AuthoredActionContext;
  /** Null outside a private draft; generation is the final current solve basis. */
  draft: { commandSessionId: CommandSessionId; generation: number } | null;
}

/**
 * Only final-generation certificates belong in terminal results. A first solve,
 * a stale/last-good profile display or an empty effect queue is not completion.
 * requestId + generation identify the final derivation, including offset replan.
 */
export type SemanticGeometryReceipt =
  | { kind: "not-required" }
  | {
      kind: "current" | "invalid-editable" | "failed";
      state: SemanticState;
      /** Retained even when publication has exited the private draft. */
      sketchBasis: SemanticState["draft"];
      solve:
        | { requestId: RequestId; generation: number }
        | { kind: "synchronous"; generation: number }
        | null;
      /** Exact edit query accepted before the final solve/derivation, when required. */
      editQuery?: { requestId: RequestId; generation: number };
      derivation: { requestId: RequestId; generation: number } | null;
      /** No arrangement request exists for an empty or solver-invalid definition. */
      derivationUnavailableReason?: "empty-sketch" | "solve-invalid";
      rebuildRevisionId: RevisionId | null;
    };

/**
 * Transaction-specific evidence is mandatory. ModelingService.waitForPersistence
 * can fulfill after failure; historyRestoreState also misses some blocking write
 * failures. Neither is a receipt. Adapters must preserve appliedLive from the
 * exact repository transaction, including failed document replacement/history.
 */
export type SemanticPersistenceReceipt =
  | { kind: "not-required" }
  | {
      kind: "committed" | "failed";
      commandId: string;
      transactionId: string;
      state: SemanticState;
    };

export type SemanticFileReceipt =
  | { kind: "not-required" }
  | {
      kind: "written" | "failed";
      commandId: string;
      /** Validated payload basis, not whatever revision is current after writing. */
      state: SemanticState;
      path: string;
      /** Fully written bytes on success; observed partial bytes on failure. */
      bytesWritten: number;
    };

export interface SemanticCompletion {
  /** Applied state truth is independent of geometry, handoff and durability. */
  live:
    | { kind: "unchanged"; state: SemanticState | null }
    | { kind: "applied"; state: SemanticState };
  handoff:
    | { kind: "not-required" }
    | { kind: "current"; state: SemanticState }
    | { kind: "failed" };
  geometry: SemanticGeometryReceipt;
  persistence: SemanticPersistenceReceipt;
  file: SemanticFileReceipt;
}

/**
 * Discovery is evaluated at one exact state, with canonical identities only.
 * Labels may aid presentation but cannot select the first of multiple matches.
 * Refuse ambiguity/stale basis explicitly; never use list order, proximity or
 * display meshes as identity. References are not promised stable after edits.
 */
export interface SemanticDiscovery {
  state: SemanticState;
  /** Inspection metadata from this same snapshot, not another document owner. */
  document?: { label: string };
  variables?: readonly import("@/contracts/modeling/schema").DocumentVariableRecord[];
  settings?: import("@/contracts/modeling/schema").ModelingDocumentSettings;
  references: readonly { label: string; target: DurableRef }[];
  history: DurableHistoryAvailability | null;
  model?: {
    cursor?: import("@/contracts/modeling/schema").DocumentFeatureCursor;
    timeline?: readonly { label: string; target: Extract<DurableRef, { kind: "sketch" | "feature" }> }[];
    features: readonly { featureId: import("@/contracts/shared/ids").FeatureId; label: string; kind: string; suppressed: boolean; producedTargets: readonly DurableRef[] }[];
    /** Native exact B-rep inspection only; null when unavailable or invalid. */
    bodies: readonly { bodyId: import("@/contracts/shared/ids").BodyId; kind: import("@/contracts/modeling/schema").BodyKind; bounds: { min: readonly number[]; max: readonly number[] } | null }[];
  };
  sketch?: {
    sketchId: SketchId | null;
    plane: "xy" | "yz" | "xz" | null;
    /** Resolved production support and world frame, in document units. */
    support?: import("@/contracts/shared/sketch-plane").SketchPlaneDefinition;
    styles?: readonly import("@/contracts/sketch/schema").SketchStyleRecord[];
    referenceImages?: readonly import("@/contracts/sketch/schema").SketchReferenceImageRecord[];
    /** Authored sources and actual solver-owned projections; never editable local copies. */
    references?: readonly { definition: import("@/contracts/sketch/schema").SketchReferenceDefinition; revisionId: RevisionId | null; projection: import("@/contracts/solver/schema").ProjectedSketchReferenceRecord | null }[];
    solveStatus: SolvedSketchStatus;
    validity: SketchDerivedValidity;
    points: readonly {
      pointId: SketchPointId;
      position: SketchPoint;
      construction: boolean;
    }[];
    entities: readonly {
      entityId: SketchEntityId;
      kind: import("@/contracts/sketch/schema").SketchEntityDefinition["kind"];
      pointIds: readonly SketchPointId[];
      construction: boolean;
      style?: import("@/contracts/sketch/schema").SketchStyleDefinition;
      radius?: number;
      /** Authored advanced parameters, not a promise of region/export support. */
      minorRadius?: number;
      sweepDirection?: "clockwise" | "counterClockwise";
      rho?: number;
      degree?: 2 | 3;
      closure?: "open" | "positional" | "smooth";
      text?: { content: string; height: number; rotationRadians: number; horizontalAlign: "left" | "center" | "right"; verticalAlign: "baseline" | "middle" | "top" | "bottom" };
      tangents?: readonly { occurrenceId: string; pointId: SketchPointId; vector: SketchPoint | null }[];
    }[];
    derivations: readonly { definition: Extract<import("@/contracts/sketch/schema").SketchDerivationDefinition, { kind: "linearPattern" | "circularPattern" | "transform" }>; profileGateFailed: boolean; currentGeometry: NonNullable<SemanticDiscovery["sketch"]>["offsets"][number]["currentGeometry"] }[];
    mirrors: readonly { derivationId: string; label: string; seedEntityIds: readonly SketchEntityId[]; outputEntityIds: readonly SketchEntityId[]; axis: Extract<import("@/contracts/sketch/schema").SketchDerivationDefinition, { kind: "mirror" }>["mirrorReference"]; brokenReason: string | null; copyCount: number; requirementCount: number; sizingRequirementCount: number; brokenDownstreamLabels: readonly string[]; currentGeometry: NonNullable<SemanticDiscovery["sketch"]>["offsets"][number]["currentGeometry"] }[];
    offsets: readonly { derivationId: string; label: string; seedEntityIds: readonly SketchEntityId[]; outputEntityIds: readonly SketchEntityId[]; distance: import("@/contracts/modeling/authored-values").MaybeAuthoredValue<number>; currentGeometry: readonly { entityId: SketchEntityId; kind: import("@/contracts/sketch/schema").SketchEntityDefinition["kind"]; points: readonly { pointId: SketchPointId; position: SketchPoint }[]; radius?: number; cubicSpans?: readonly import("@/contracts/sketch/schema").SolvedSketchDerivedCubicSpan[] }[] | null; health: { kind: "healthy" } | { kind: "checking" } | { kind: "broken"; reason: string } }[];
    /** Read-only datum/projected operands from this exact private sketch basis. */
    operands: readonly { label: string; target: Exclude<SemanticRequirementTarget, SemanticSketchGeometryTarget> }[];
    constraints: readonly {
      constraintId: import("@/contracts/shared/ids").ConstraintId;
      kind: import("@/contracts/sketch/schema").ConstraintDefinition["kind"];
      label: string;
      status: import("@/contracts/sketch/schema").ConstraintStatusRecord["status"] | null;
    }[];
    requirements: readonly {
      dimensionId: import("@/contracts/shared/ids").DimensionId;
      mode: "driving";
      kind: import("@/contracts/sketch/schema").DimensionDefinition["kind"];
      label: string;
      value: number | null;
      measuredValue: number | null;
    }[];
    measurements: readonly {
      dimensionId: import("@/contracts/shared/ids").DimensionId;
      mode: "reference";
      kind: import("@/contracts/sketch/schema").DimensionDefinition["kind"];
      label: string;
      measuredValue: number | null;
    }[];
    /** Only current, boundary-resolved, consumable profiles are discoverable. */
    profiles: readonly { regionId: RegionId; isClosed: boolean }[];
  };
}

export type SemanticOutcome =
  | { kind: "completed"; change: "changed" | "unchanged" }
  | { kind: "accepted-invalid" }
  | { kind: "rejected"; reasonCode: string }
  | { kind: "conflicted"; actualBasis: SemanticBasis }
  | { kind: "canceled"; phase: "not-started" | "before-apply" }
  | { kind: "unavailable"; capability: string }
  | {
      kind: "failed";
      /** Several barriers can fail; preserve all, rather than hiding save failure. */
      failures: readonly (
        | "initialization"
        | "geometry"
        | "handoff"
        | "persistence"
        | "file"
        | "execution"
      )[];
    };

export interface SemanticResult {
  version: 1;
  /** Exact production mutation attribution; absent for non-mutating families. */
  changedTargets?: readonly DurableRef[];
  correlation: SemanticCorrelation;
  outcome: SemanticOutcome;
  completion: SemanticCompletion;
  diagnostics: readonly ModelingDiagnostic[];
  /** null after handoff failure: do not vend stale references as current. */
  discovery: SemanticDiscovery | null;
}

/**
 * FAMILY BARRIERS (required before introducing that family's concrete commands):
 *
 * document/create/open/inspect: explicit initialization receipt, authoritative
 * snapshot handoff. Inspect may complete with invalid diagnostics; create/open
 * may not silently continue after failed restore. Fresh file resets history.
 * sketch-open: exact support/projection, owned action context, current solve and
 * final regions (empty/open sketches legitimately have no usable profiles).
 * sketch-author: one owned authored intent, exact solve and final-generation
 * regions. Requirements/edits can retain invalid state ONLY for author-invalid.
 * Reference dimensions remain measurements. Requested profiles fail closed.
 * sketch-publish: production publication preparation/correlation, rebuild,
 * transaction receipt, refreshed snapshot and any timeline cursor restoration.
 * Empty/unchanged finish is explicit unchanged, never a fictitious publication.
 * sketch-discard: whole draft exit (not just special mode cancellation), restore
 * transient cursor and settle/invalidate all related work before handoff.
 * model-mutate: production acceptance AND requested rebuild, transaction receipt,
 * authoritative handoff. Variables also rebuild dependents. Cursor is not undo.
 * history: private-first, never fall through an empty sketch history; restored
 * sketch solve/final regions OR document compensation/heads synchronization,
 * transaction receipt, handoff and refreshed availability. Blocked is rejected
 * with the existing action reason/diagnostics, no-action is unavailable.
 * file-save/export: resolve live/repository truth, validate current-basis payload,
 * await actual file write. Repository committed does NOT mean a file was saved.
 * Generation failure and filesystem failure are separate from live application.
 * file-open: existing native parser/retained assets, initialized replacement,
 * rebuild/transaction/handoff; never pretend failed replacement rolled back.
 *
 * All families: rejected/conflicted/canceled/unavailable mean NO application by
 * this command. Once applied, cancellation cannot erase that truth: finish with
 * completed, accepted-invalid (explicit intent), or failed + applied evidence.
 * Geometry/save failure is not fulfillment even if the mutation was accepted.
 * No pending barrier is permitted in a terminal result. Prior completed recipe
 * changes remain on first failure; stop sequential recipes before the next
 * operation/alias consumes output. No recipe-wide atomic rollback guarantee.
 */
