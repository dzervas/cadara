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
    };

export type SemanticDimensionInput = {
  axis: "horizontal" | "vertical";
  points: readonly [SketchPointId, SketchPointId];
} & ({ mode: "driving"; value: number } | { mode: "reference" });

export interface SemanticDraftBasis {
  commandSessionId: CommandSessionId;
  generation: number;
}
export type SemanticSketchCommand = CommandIdentity & {
  basis: SemanticBasis;
} & (
    | { operation: "sketch.begin"; plane: "xy" | "yz" | "xz" }
    | { operation: "sketch.open"; sketchId: SketchId }
    | {
        operation: "sketch.author";
        draft: SemanticDraftBasis;
        primitive: SemanticSketchPrimitive;
        construction: boolean;
        intent: "fulfill" | "author-invalid";
      }
    | ({ operation: "sketch.dimension.add"; draft: SemanticDraftBasis; intent: "fulfill" | "author-invalid" } & SemanticDimensionInput)
    | { operation: "sketch.dimension.update"; draft: SemanticDraftBasis; dimensionId: import("@/contracts/shared/ids").DimensionId; value: number; intent: "fulfill" | "author-invalid" }
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

export type SemanticExtrudeCommand = CommandIdentity & {
  basis: SemanticBasis;
  depth: number;
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

/** Implemented slices. Later tickets extend this closed union. */
export type SemanticCommand =
  | SemanticSketchCommand
  | SemanticExtrudeCommand
  | SemanticHistoryCommand
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
  settings?: import("@/contracts/modeling/schema").ModelingDocumentSettings;
  references: readonly { label: string; target: DurableRef }[];
  history: DurableHistoryAvailability | null;
  model?: {
    features: readonly { featureId: import("@/contracts/shared/ids").FeatureId; label: string; kind: string; producedTargets: readonly DurableRef[] }[];
    /** Native exact B-rep inspection only; null when unavailable or invalid. */
    bodies: readonly { bodyId: import("@/contracts/shared/ids").BodyId; kind: import("@/contracts/modeling/schema").BodyKind; bounds: { min: readonly number[]; max: readonly number[] } | null }[];
  };
  sketch?: {
    sketchId: SketchId | null;
    plane: "xy" | "yz" | "xz";
    solveStatus: SolvedSketchStatus;
    validity: SketchDerivedValidity;
    points: readonly {
      pointId: SketchPointId;
      position: SketchPoint;
      construction: boolean;
    }[];
    entities: readonly {
      entityId: SketchEntityId;
      kind: "point" | "lineSegment";
      pointIds: readonly SketchPointId[];
      construction: boolean;
    }[];
    requirements: readonly {
      dimensionId: import("@/contracts/shared/ids").DimensionId;
      mode: "driving";
      label: string;
      value: number | null;
      measuredValue: number | null;
    }[];
    measurements: readonly {
      dimensionId: import("@/contracts/shared/ids").DimensionId;
      mode: "reference";
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
