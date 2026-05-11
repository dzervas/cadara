import type {
  BodyId,
  ConstructionId,
  DocumentHistoryItemId,
  DocumentId,
  DocumentVariableId,
  EdgeId,
  FaceId,
  FeatureId,
  FeatureTreeNodeId,
  ObjectTreeNodeId,
  PreviewId,
  ReferenceId,
  RegionId,
  RequestId,
  RevisionId,
  SketchId,
  SnapshotEntityId,
  VertexId,
} from "@/contracts/shared/ids";
import type { OwnershipRecord } from "@/contracts/shared/diagnostics";
import type { DurableRef } from "@/contracts/shared/references";
import type {
  SketchPlaneDefinition,
  SketchPlaneKey,
  SketchPlaneSupportRef,
} from "@/contracts/shared/sketch-plane";
import type { SketchPoint2D, SketchRecord } from "@/contracts/sketch/schema";
import type { RenderExport } from "@/contracts/render/schema";
import type {
  ContractVersion,
  ExtrudeFeatureSchemaVersion,
  FilletFeatureSchemaVersion,
  PlaneFeatureSchemaVersion,
  RevolveFeatureSchemaVersion,
  ShellFeatureSchemaVersion,
  SnapshotSchemaVersion,
} from "@/contracts/shared/versioning";
import type {
  AdvancedFeatureValidationDiagnostic,
  AdvancedSolidFeatureDefinition,
  AdvancedSolidFeatureKind,
} from "@/contracts/modeling/advanced-solid";
import type { MaybeAuthoredValue } from "@/contracts/modeling/authored-values";
import type { GeometryAssetDiagnosticDetail } from "@/contracts/modeling/geometry-assets";

export interface DocumentSnapshotProvenance {
  repositoryHeads: readonly string[];
  repositorySource:
    | "local"
    | "peer"
    | "restore"
    | "seed"
    | "reset"
    | "undo"
    | "redo"
    | null;
}

export interface SnapshotMutationBasis {
  baseRevisionId: RevisionId;
  baseRepositoryHeads?: readonly string[];
}

export type {
  AdvancedFeatureValidationDiagnostic,
  AdvancedFeatureOptionDescriptor,
  AdvancedFeatureOptionGroupDescriptor,
  AdvancedFeatureOptionPatchTarget,
  AdvancedFeatureScalarOptionDescriptor,
  AdvancedFeatureScalarOptionValueKind,
  AdvancedFeatureDiscriminatedOptionGroupDescriptor,
  AdvancedFeatureDiscriminatedOptionVariant,
  AdvancedOperationIntentDescriptor,
  AdvancedParticipantCardinality,
  AdvancedParticipantDescriptor,
  AdvancedParticipantRole,
  AdvancedParticipantTargetKind,
  AdvancedParticipantValue,
  AdvancedSolidFeatureAuthoringDescriptor,
  AdvancedSolidFeatureDefinition,
  AdvancedSolidFeatureKind,
  AdvancedSolidFeatureParameters,
  AdvancedSolidOperationIntent,
  SweepAdvancedOptions,
  SweepProfileControl,
  SweepTwistOption,
  LoftAdvancedOptions,
  LoftGuideContinuity,
  LoftMatchConnection,
  LoftPathOptions,
  LoftProfileConditionKind,
  LoftProfileConditionOptions,
} from "@/contracts/modeling/advanced-solid";

/** Re-exported preview identifier used by modeling preview requests. */
export type { PreviewId };
/** Re-exported durable reference-record identifier used by named references. */
export type { ReferenceId };
/** Canonical durable reference union accepted throughout the modeling boundary. */
export type PrimitiveRef = DurableRef;
/** Re-exported sketch-plane support and placement types used by modeling APIs. */
export type { SketchPlaneDefinition, SketchPlaneKey, SketchPlaneSupportRef };
/** Boolean policy applied to feature results during rebuild. */
export type FeatureBooleanOperation = "newBody" | "join" | "cut" | "intersect";
/** Sketch-space 2D point alias used by historical modeling helpers. */
export type SketchPoint = SketchPoint2D;

/**
 * Canonical feature families currently exposed by the kernel contract.
 * This union is closed so callers cannot invent feature types ad hoc.
 */
export type FeatureKind = "extrude" | "fillet" | "plane" | "revolve" | "shell";
export type AuthoredFeatureKind =
  | FeatureKind
  | "sweep"
  | "loft"
  | "chamfer"
  | "thicken"
  | "combine"
  | "split"
  | "deleteSolid"
  | "mirror"
  | "transform";
export type ModelingFeatureKind = FeatureKind | AdvancedSolidFeatureKind;

/** Ordered collection that must contain at least one entry. */
export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

/**
 * Explicit kernel capability matrix for the current contract revision.
 * Implementers must advertise support here instead of relying on rejection
 * diagnostics alone to communicate what is actually runnable.
 */
export interface ModelingKernelCapabilities {
  /** Feature kinds the kernel can commit durably at this contract version. */
  supportedFeatureKinds: ModelingFeatureKind[];
  /** Feature kinds the kernel can evaluate as transient previews. */
  previewableFeatureKinds: ModelingFeatureKind[];
  /** Sketch profile seed kinds accepted by profile-based solid features. */
  supportedProfileKinds: ExtrudeProfileRef["kind"][];
  /** True when sketch commits may target planar body faces directly. */
  supportsFaceBackedSketchPlanes: boolean;
  /** True when the kernel can preserve and resolve durable topology identities. */
  supportsDurableTopologyNaming: boolean;
}

/**
 * Explicit document-level modeling policy needed by kernels and callers.
 */
export interface ModelingDocumentSettings {
  /** Linear unit used for all feature distances and world-space geometry. */
  linearUnit: "millimeter";
  /** Absolute modeling tolerance used for 3D geometric decisions. */
  modelingTolerance: number;
  /** Angular modeling tolerance in radians. */
  angularToleranceRadians: number;
}

/**
 * Durable document variable authored by the user.
 * Values are validated expression text persisted raw so editing and replay keep
 * the original input.
 */
export interface DocumentVariableRecord {
  /** Stable durable variable identity. */
  variableId: DocumentVariableId;
  /** User-authored variable name text. */
  name: string;
  /** User-authored raw value text. */
  valueText: string;
}

/**
 * Durable reference accepted as an extrude profile seed.
 * `region` means one explicit solver- or kernel-derived closed profile.
 * `face` means one explicit planar face owned by the current document revision.
 * Whole-sketch references are intentionally excluded so profile ownership is
 * never inferred from hidden loop-selection conventions.
 */
export type ExtrudeProfileRef =
  | { kind: "region"; sketchId: SketchId; regionId: RegionId }
  | { kind: "face"; bodyId: BodyId; faceId: FaceId };

/**
 * Explicit participant scope for boolean feature evaluation.
 * Kernels must not infer boolean participants from hidden selection state.
 */
export type FeatureBooleanScope =
  | {
      /** Create a standalone result body without consuming existing bodies. */
      kind: "standalone";
    }
  | {
      /** Apply the boolean to one explicit durable body. */
      kind: "targetBody";
      bodyId: BodyId;
    }
  | {
      /** Apply the boolean to the explicit ordered set of durable bodies. */
      kind: "targetBodies";
      bodyIds: readonly BodyId[];
    };

export type LinearExtentDirection = "positive" | "negative";
export type AngularExtentDirection = "clockwise" | "counterClockwise";
export type UpToOffsetDirection = "shorten" | "extend";

export interface LinearUpToOffset {
  distance: MaybeAuthoredValue<number>;
  direction: UpToOffsetDirection;
}

export interface AngularUpToOffset {
  angle: MaybeAuthoredValue<number>;
  direction: UpToOffsetDirection;
}

export type ExtrudeEndCondition =
  | {
      kind: "blind";
      direction: LinearExtentDirection;
      distance: MaybeAuthoredValue<number>;
      draftAngle?: MaybeAuthoredValue<number>;
    }
  | {
      kind: "upToNext";
      direction: LinearExtentDirection;
      offset?: LinearUpToOffset;
      draftAngle?: MaybeAuthoredValue<number>;
    }
  | {
      kind: "upToFace";
      direction: LinearExtentDirection;
      target: { kind: "face"; bodyId: BodyId; faceId: FaceId };
      offset?: LinearUpToOffset;
      draftAngle?: MaybeAuthoredValue<number>;
    }
  | {
      kind: "upToPart";
      direction: LinearExtentDirection;
      target: { kind: "body"; bodyId: BodyId };
      offset?: LinearUpToOffset;
      draftAngle?: MaybeAuthoredValue<number>;
    }
  | {
      kind: "upToVertex";
      direction: LinearExtentDirection;
      target: { kind: "vertex"; bodyId: BodyId; vertexId: VertexId };
      offset?: LinearUpToOffset;
      draftAngle?: MaybeAuthoredValue<number>;
    }
  | {
      kind: "throughAll";
      direction: LinearExtentDirection;
      draftAngle?: MaybeAuthoredValue<number>;
    };

export type ExtrudeFeatureExtent =
  | {
      mode: "oneSide";
      end: ExtrudeEndCondition;
    }
  | {
      mode: "symmetric";
      end: Extract<ExtrudeEndCondition, { kind: "blind" | "throughAll" }>;
    }
  | {
      mode: "twoSide";
      firstEnd: ExtrudeEndCondition;
      secondEnd: ExtrudeEndCondition;
    };

export type RevolveEndCondition =
  | {
      kind: "full";
    }
  | {
      kind: "blind";
      direction: AngularExtentDirection;
      angle: MaybeAuthoredValue<number>;
    }
  | {
      kind: "upToNext";
      direction: AngularExtentDirection;
      offset?: AngularUpToOffset;
    }
  | {
      kind: "upToFace";
      direction: AngularExtentDirection;
      target: { kind: "face"; bodyId: BodyId; faceId: FaceId };
      offset?: AngularUpToOffset;
    }
  | {
      kind: "upToPart";
      direction: AngularExtentDirection;
      target: { kind: "body"; bodyId: BodyId };
      offset?: AngularUpToOffset;
    }
  | {
      kind: "upToVertex";
      direction: AngularExtentDirection;
      target: { kind: "vertex"; bodyId: BodyId; vertexId: VertexId };
      offset?: AngularUpToOffset;
    };

export type RevolveFeatureExtent =
  | {
      mode: "oneSide";
      end: RevolveEndCondition;
    }
  | {
      mode: "symmetric";
      end: Extract<RevolveEndCondition, { kind: "blind" }>;
    }
  | {
      mode: "twoSide";
      firstEnd: Exclude<RevolveEndCondition, { kind: "full" }>;
      secondEnd: Exclude<RevolveEndCondition, { kind: "full" }>;
    };

/**
 * Fully typed extrude parameters.
 * `profiles` is the single authoritative ordered profile seed collection;
 * callers must not repeat the same meaning in side-band generic arrays.
 * Blind extrude distances are expressed in document modeling units and must be strictly positive.
 */
export interface ExtrudeFeatureParameters {
  /** Non-empty ordered profile seeds for the extrude operation. */
  profiles: NonEmptyReadonlyArray<ExtrudeProfileRef>;
  /** Explicit start condition for the extrusion path. */
  startExtent: { kind: "profilePlane" };
  /** Explicit end controls for all active extrude sides. */
  extent: ExtrudeFeatureExtent;
  /** Boolean behavior applied to the extrude result. */
  operation: FeatureBooleanOperation;
  /** Explicit participant scope for non-standalone boolean operations. */
  booleanScope: FeatureBooleanScope;
}

/**
 * Fillet edge reference accepted by the kernel contract.
 */
export interface FilletEdgeRef {
  /** Durable edge reference; this variant is fixed for fillet target lists. */
  kind: "edge";
  /** Owning body of the edge to round. */
  bodyId: BodyId;
  /** Exact durable edge identity to round. */
  edgeId: EdgeId;
}

/**
 * Fully typed fillet parameters.
 * `edgeTargets` lists the exact durable edges to round.
 * `radius` is expressed in document modeling units and must be strictly positive.
 */
export interface FilletFeatureParameters {
  /** Exact durable edges to round; order has no semantic meaning. */
  edgeTargets: readonly FilletEdgeRef[];
  /** Positive fillet radius in document modeling units. */
  radius: number;
}

/**
 * Construction-plane reference accepted by plane features.
 */
export interface PlaneReferenceTarget {
  /** Single coplanar seed reference used to create the construction plane. */
  target:
    | { kind: "construction"; constructionId: ConstructionId }
    | { kind: "face"; bodyId: BodyId; faceId: FaceId };
}

/**
 * Fully typed plane parameters.
 * This placeholder contract intentionally supports only a single coplanar seed so
 * later extensions can add offset/angle variants without weakening current typing.
 */
export interface PlaneFeatureParameters {
  /** Plane creation mode for this schema version. */
  mode: "coplanar";
  /** Single coplanar reference used to define the resulting plane. */
  reference: PlaneReferenceTarget;
}

/**
 * Placeholder revolve profile reference.
 * This exists because the toolbar already exposes revolve and the plan allows a
 * placeholder if the feature is planned soon.
 */
export type RevolveProfileRef = ExtrudeProfileRef;

/**
 * Placeholder revolve axis reference.
 * Axis ownership must remain durable and explicit.
 */
export type RevolveAxisRef =
  | { kind: "edge"; bodyId: BodyId; edgeId: EdgeId }
  | { kind: "construction"; constructionId: ConstructionId };

/**
 * Placeholder revolve parameters.
 * The kernel may reject these requests as unsupported, but the request shape is
 * already specific enough for an implementer to build against without guessing.
 */
export interface RevolveFeatureParameters {
  /** Non-empty ordered closed profile seeds to revolve. */
  profiles: NonEmptyReadonlyArray<RevolveProfileRef>;
  /** Explicit axis reference used by the revolve. */
  axis: RevolveAxisRef;
  /** Explicit start angle in radians from the profile's zero-angle pose. */
  startAngle: number;
  /** Explicit angular end controls for all active revolve sides. */
  extent: RevolveFeatureExtent;
  /** Boolean behavior applied to the revolve result. */
  operation: FeatureBooleanOperation;
  /** Explicit participant scope for non-standalone boolean operations. */
  booleanScope: FeatureBooleanScope;
}

/**
 * Durable face reference accepted by the shell contract.
 */
export interface ShellFaceRef {
  /** Durable removable face reference. */
  kind: "face";
  /** Owning body of the face. */
  bodyId: BodyId;
  /** Exact durable face identity. */
  faceId: FaceId;
}

/**
 * Fully typed shell parameters.
 * `bodyTarget` names the source solid to hollow.
 * `faceTargets` lists the exact removable faces.
 */
export interface ShellFeatureParameters {
  /** Explicit durable source body that will be shelled. */
  bodyTarget: { kind: "body"; bodyId: BodyId };
  /** Explicit removable faces for the shell opening. */
  faceTargets: readonly ShellFaceRef[];
  /** Positive shell thickness in document modeling units. */
  thickness: number;
  /** Offset side relative to the source body. Omitted legacy values mean inside. */
  direction?: "inside" | "outside";
  /** Boolean behavior applied to the shell result. */
  operation: FeatureBooleanOperation;
  /** Explicit participant scope for non-standalone boolean operations. */
  booleanScope: FeatureBooleanScope;
}

/**
 * Canonical typed feature definitions used across requests and snapshots.
 * Each variant owns its required references and parameters directly.
 */
export type FeatureDefinition =
  | {
      /** Stable discriminant for extrude features. */
      kind: "extrude";
      /** Per-variant schema version owned by the extrude contract family. */
      featureTypeVersion: ExtrudeFeatureSchemaVersion;
      /** Exact rebuild inputs owned by this extrude feature instance. */
      parameters: ExtrudeFeatureParameters;
    }
  | {
      /** Stable discriminant for fillet features. */
      kind: "fillet";
      /** Per-variant schema version owned by the fillet contract family. */
      featureTypeVersion: FilletFeatureSchemaVersion;
      /** Exact rebuild inputs owned by this fillet feature instance. */
      parameters: FilletFeatureParameters;
    }
  | {
      /** Stable discriminant for plane features. */
      kind: "plane";
      /** Per-variant schema version owned by the plane contract family. */
      featureTypeVersion: PlaneFeatureSchemaVersion;
      /** Exact rebuild inputs owned by this plane feature instance. */
      parameters: PlaneFeatureParameters;
    }
  | {
      /** Stable discriminant for revolve features. */
      kind: "revolve";
      /** Per-variant schema version owned by the revolve contract family. */
      featureTypeVersion: RevolveFeatureSchemaVersion;
      /** Exact rebuild inputs owned by this revolve feature instance. */
      parameters: RevolveFeatureParameters;
    }
  | {
      /** Stable discriminant for shell features. */
      kind: "shell";
      /** Per-variant schema version owned by the shell contract family. */
      featureTypeVersion: ShellFeatureSchemaVersion;
      /** Exact rebuild inputs owned by this shell feature instance. */
      parameters: ShellFeatureParameters;
    }
  | AdvancedSolidFeatureDefinition;

/**
 * Machine-readable invalidation payload for destroyed or replaced references.
 * Implementers must not silently remap invalid references.
 * `reason` must be backend-defined and machine-readable.
 * `target` and `sourceTarget` must identify the exact failed reference context.
 * Allowed invalidation reasons are backend-defined stable codes such as missing
 * topology, deleted sketch seed, or revision mismatch; callers must not parse
 * human-readable messages for control flow.
 */
export interface InvalidReferenceDetailPayload {
  /** Stable backend-defined reason code for the invalidation. */
  reason: string;
  /** Exact durable target that is no longer valid. */
  target: PrimitiveRef;
  /** Owning feature of the dead target when known. */
  ownerFeatureId: FeatureId | null;
  /** Owning sketch of the dead target when known. */
  ownerSketchId: SketchId | null;
  /** Upstream source target that caused the invalidation, if one exists. */
  sourceTarget: PrimitiveRef | null;
}

/**
 * Structured modeling diagnostic detail payload.
 * Each variant is machine-readable and must preserve enough context for the
 * caller to explain the failure without guessing.
 */
export type ModelingDiagnosticDetail =
  | {
      /** Stable discriminant for invalid durable-reference failures. */
      kind: "invalidReference";
      /** Structured invalidation payload for the failed durable target. */
      reference: InvalidReferenceDetailPayload;
    }
  | {
      /** Stable discriminant for base-revision mismatch failures. */
      kind: "revisionConflict";
      /** Revision the caller expected to target. */
      expectedRevisionId: RevisionId;
      /** Revision that was current when the operation was evaluated. */
      actualRevisionId: RevisionId;
    }
  | {
      /** Stable discriminant for stale preview responses. */
      kind: "stalePreview";
      /** Preview correlation ID that went stale. */
      previewId: PreviewId;
      /** Base revision that the caller asked to preview. */
      requestedRevisionId: RevisionId;
      /** Newer committed revision that made the preview stale. */
      currentRevisionId: RevisionId;
    }
  | {
      /** Stable discriminant for rebuild failures after acceptance. */
      kind: "rebuildFailure";
      /** Durable features whose rebuild contributed to the failure. */
      affectedFeatureIds: FeatureId[];
      /** Durable targets invalidated or implicated by the rebuild failure. */
      affectedTargets: PrimitiveRef[];
    }
  | {
      /** Stable discriminant for advanced-feature contract and adapter gaps. */
      kind: "advancedFeatureValidation";
      /** Role-specific validation or unsupported-case diagnostic. */
      diagnostic: AdvancedFeatureValidationDiagnostic;
    }
  | GeometryAssetDiagnosticDetail;

/**
 * Top-level diagnostic record returned by the modeling boundary.
 */
export interface ModelingDiagnostic {
  /** Stable diagnostic code for programmatic handling. */
  code: string;
  /** Severity emitted by the modeling producer. */
  severity: "info" | "warning" | "error";
  /** Human-readable summary for logs and UI presentation. */
  message: string;
  /** Owning authored feature for repairable feature-scoped failures. */
  featureId?: FeatureId | null;
  /** Stable authored field id the user can repair, when available. */
  fieldId?: string | null;
  /** Authored definition path the user can repair, when a field id is not enough. */
  fieldPath?: readonly (string | number)[];
  /** User-facing repair guidance for recoverable feature failures. */
  repairGuidance?: string | null;
  /** Exact durable target implicated by this diagnostic, when known. */
  target: PrimitiveRef | null;
  /** Machine-readable detail payload for structured handling, when available. */
  detail: ModelingDiagnosticDetail | null;
}

/**
 * Revision acceptance state for a document mutation.
 * `accepted` means the mutation was committed against `baseRevisionId`.
 * `conflict` means the base revision was stale before validation completed.
 * `rejected` means the request was evaluated against the requested revision but
 * failed contract validation or capability checks and therefore did not commit.
 */
export type MutationRevisionState =
  | {
      /** Accepted mutation evaluated against the requested base revision. */
      kind: "accepted";
      /** Exact base revision that the kernel accepted for this mutation. */
      baseRevisionId: RevisionId;
    }
  | {
      /** Mutation could not commit because the requested base revision was stale. */
      kind: "conflict";
      /** Base revision that the caller expected to target. */
      expectedRevisionId: RevisionId;
      /** Committed revision that was current when the conflict was detected. */
      actualRevisionId: RevisionId;
    }
  | {
      /** Mutation was evaluated but rejected without committing document state. */
      kind: "rejected";
      /** Base revision against which the rejected request was checked. */
      baseRevisionId: RevisionId;
      /** Stable machine-readable rejection code. */
      reasonCode: string;
    };

/**
 * Per-request rebuild status returned by the kernel after a mutation attempt.
 * `rebuilt` means regeneration finished against the returned revision.
 * `skipped` means no rebuild ran because the mutation never committed.
 * `failed` means the mutation was accepted but regeneration produced explicit
 * machine-readable diagnostics and invalidations.
 */
export type RebuildResult =
  | {
      /** Rebuild completed successfully for the returned revision. */
      kind: "rebuilt";
      /** Revision produced by the successful rebuild. */
      revisionId: RevisionId;
      /** Durable targets invalidated while producing the rebuilt revision. */
      invalidatedTargets: PrimitiveRef[];
      /** Diagnostics emitted during the successful rebuild. */
      diagnostics: ModelingDiagnostic[];
    }
  | {
      /** No rebuild ran because the mutation never produced a rebuildable change. */
      kind: "skipped";
      /** Stable machine-readable reason the rebuild was skipped. */
      reasonCode: "revisionConflict" | "validationRejected" | "noOp";
      /** Durable targets invalidated before the rebuild was skipped, if any. */
      invalidatedTargets: PrimitiveRef[];
      /** Diagnostics emitted while deciding to skip rebuild. */
      diagnostics: ModelingDiagnostic[];
    }
  | {
      /** Mutation was accepted but rebuild failed explicitly. */
      kind: "failed";
      /** Revision against which the failed rebuild was attempted. */
      revisionId: RevisionId;
      /** Stable machine-readable reason for the rebuild failure. */
      reasonCode: string;
      /** Durable targets invalidated by the failed rebuild attempt. */
      invalidatedTargets: PrimitiveRef[];
      /** Diagnostics emitted by the failed rebuild. */
      diagnostics: ModelingDiagnostic[];
    };

/**
 * Freshness state for preview evaluation results.
 * Preview responses may be stale when the base revision no longer matches the
 * current document revision.
 */
export type PreviewFreshness =
  | {
      /** Preview still matches the requested base revision. */
      kind: "fresh";
      /** Base revision that both caller and kernel agree the preview used. */
      baseRevisionId: RevisionId;
    }
  | {
      /** Preview was computed or received after the caller's base revision went stale. */
      kind: "stale";
      /** Base revision that the caller originally asked to preview. */
      requestedRevisionId: RevisionId;
      /** Newer committed revision that superseded the preview basis. */
      currentRevisionId: RevisionId;
    };

/**
 * Ownership metadata for durable snapshot records.
 * All durable records must resolve back to an owning document/revision, and to
 * their owning feature/sketch/body when applicable.
 */
export type SnapshotOwnershipRecord = OwnershipRecord;

/**
 * Presentational feature-tree node derived from durable snapshot state.
 * `id` is a UI/view-model key only; durable identity is carried by `target`.
 */
export interface FeatureTreeNodeRecord {
  /** Presentational tree-node key scoped to one snapshot payload. */
  id: FeatureTreeNodeId;
  /** Human-readable row label shown in the feature tree. */
  label: string;
  /** Human-readable secondary description owned by the snapshot producer. */
  description: string;
  /** Tree row family used for iconography and grouping. */
  kind: "plane" | "sketch" | "feature";
  /** Durable target represented by this tree row. */
  target: PrimitiveRef;
  /** Owning durable feature for this row, if any. */
  ownerFeatureId: FeatureId | null;
  /** Owning durable sketch for this row, if any. */
  ownerSketchId: SketchId | null;
  /** Source feature from which this row was derived, if distinct from `ownerFeatureId`. */
  sourceFeatureId: FeatureId | null;
}

/**
 * Presentational object-tree node derived from durable snapshot state.
 * `id` is a UI/view-model key only; durable identity is carried by `target`.
 */
export interface ObjectTreeNodeRecord {
  /** Presentational tree-node key scoped to one snapshot payload. */
  id: ObjectTreeNodeId;
  /** Human-readable row label shown in the object tree. */
  label: string;
  /** Human-readable secondary description owned by the snapshot producer. */
  description: string;
  /** Tree row family used for iconography and grouping. */
  kind: "body" | "construction" | "sketch";
  /** Durable target represented by this tree row. */
  target: PrimitiveRef;
  /** Owning body when this row represents body topology; otherwise null. */
  ownerBodyId: BodyId | null;
  /** Owning feature when this row is feature-authored; otherwise null. */
  ownerFeatureId: FeatureId | null;
  /** Owning sketch when this row represents committed sketch-authored state; otherwise null. */
  ownerSketchId: SketchId | null;
}

/**
 * Presentational document-history item derived from durable authored state.
 * `id` is a UI/view-model key only; durable identity is carried by `target`.
 */
export type DocumentHistoryItemRecord =
  | {
      /** Presentational timeline key scoped to one snapshot payload. */
      id: DocumentHistoryItemId;
      /** Human-readable item label shown in the document history. */
      label: string;
      /** Human-readable secondary description owned by the snapshot producer. */
      description: string;
      /** Authored document row family used for iconography and edit routing. */
      kind: "sketch";
      /** Durable target represented by this history item. */
      target: { kind: "sketch"; sketchId: SketchId };
      /** Durable sketch identity represented by this item. */
      sketchId: SketchId;
      /** Feature identity is absent for committed sketch items. */
      featureId: null;
    }
  | {
      /** Presentational timeline key scoped to one snapshot payload. */
      id: DocumentHistoryItemId;
      /** Human-readable item label shown in the document history. */
      label: string;
      /** Human-readable secondary description owned by the snapshot producer. */
      description: string;
      /** Authored document row family used for iconography and edit routing. */
      kind: "feature";
      /** Durable target represented by this history item. */
      target: { kind: "feature"; featureId: FeatureId };
      /** Sketch identity is absent for committed feature items. */
      sketchId: null;
      /** Durable feature identity represented by this item. */
      featureId: FeatureId;
      /** Whether this committed feature is bypassed during authored replay. */
      suppressed: boolean;
    };

/**
 * Durable named reference record.
 * Ownership fields must resolve the reference back to document/revision and any
 * owning feature/sketch context.
 * `target` must always be a canonical durable reference.
 * Invalid references must never silently remap; they must instead populate
 * `invalidation` with a machine-readable failure reason.
 */
export interface ReferenceRecord {
  /** Durable named-reference identity scoped to the document. */
  id: ReferenceId;
  /** Human-readable label owned by the modeling producer. */
  label: string;
  /** Exact durable target named by this record. */
  target: PrimitiveRef;
  /** Durable document that owns the reference record. */
  ownerDocumentId: DocumentId;
  /** Revision in which this reference record was evaluated. */
  ownerRevisionId: RevisionId;
  /** Owning feature when the target belongs to feature-authored state. */
  ownerFeatureId: FeatureId | null;
  /** Owning sketch when the target belongs to sketch-authored state. */
  ownerSketchId: SketchId | null;
  /** Owning body when the target belongs to body topology. */
  ownerBodyId: BodyId | null;
  /** Explicit invalidation payload when the named reference no longer resolves. */
  invalidation: InvalidReferenceDetailPayload | null;
}

/**
 * Durable sketch snapshot entry embedded in one document snapshot.
 * This record ties a sketch payload to its plane context and revision basis.
 */
export interface SketchSnapshotRecord extends SnapshotOwnershipRecord {
  /** Durable sketch identity owned by the snapshot producer. */
  sketchId: SketchId;
  /** Human-readable sketch label. */
  label: string;
  /** Explicit plane support and frame used to interpret the sketch definition. */
  plane: SketchPlaneDefinition;
  /** Full authored, solved, and derived sketch payload for this snapshot row. */
  sketch: SketchRecord;
}

/**
 * Durable feature snapshot.
 * The embedded `definition` is authoritative and must contain every required
 * reference and parameter needed to rebuild the feature.
 */
export interface FeatureSnapshotRecordBase extends SnapshotOwnershipRecord {
  /** Durable feature identity. */
  featureId: FeatureId;
  /** Human-readable feature label owned by the modeling system. */
  label: string;
  /** Whether authored replay bypasses this feature for rebuild execution. */
  suppressed: boolean;
  /**
   * Durable targets created or materially re-owned by the rebuilt feature.
   * Unaffected targets must remain absent rather than inferred by callers.
   * Destroyed or replaced durable targets must be surfaced through invalidation
   * diagnostics rather than by silently removing them from this list.
   */
  producedTargets: PrimitiveRef[];
}

/**
 * Durable feature snapshot entry embedded in one document snapshot.
 * The embedded definition is the authoritative rebuild input for the feature.
 */
export type FeatureSnapshotRecord = FeatureSnapshotRecordBase & {
  /** Authoritative typed feature definition used to rebuild this feature. */
  definition: FeatureDefinition;
};

/**
 * Durable document feature cursor.
 * Empty documents use an explicit empty position. Non-empty documents reference
 * the last feature that is currently applied.
 */
export type DocumentFeatureCursor =
  | {
      /** No authored features exist in the document. */
      kind: "empty";
    }
  | {
      /** Last applied committed sketch in durable authored document order. */
      kind: "sketch";
      /** Durable sketch identity referenced by the cursor. */
      sketchId: SketchId;
    }
  | {
      /** Last applied feature in durable document feature order. */
      kind: "feature";
      /** Durable feature identity referenced by the cursor. */
      featureId: FeatureId;
    };

/**
 * Durable topology membership for a body snapshot.
 */
export interface BodyTopologySnapshotRecord {
  /** Durable face identities owned by the body at this revision. */
  faceIds: FaceId[];
  /** Durable edge identities owned by the body at this revision. */
  edgeIds: EdgeId[];
  /** Durable vertex identities owned by the body at this revision. */
  vertexIds: VertexId[];
}

/**
 * Durable body snapshot record.
 */
export interface BodySnapshotRecord extends SnapshotOwnershipRecord {
  /** Durable body identity. */
  bodyId: BodyId;
  /** Human-readable body label. */
  label: string;
  /** Explicit topology membership owned by the body snapshot. */
  topology: BodyTopologySnapshotRecord;
}

/**
 * Durable construction snapshot record.
 */
export interface ConstructionSnapshotRecord extends SnapshotOwnershipRecord {
  /** Durable construction identity. */
  constructionId: ConstructionId;
  /** Human-readable construction label. */
  label: string;
  /** Construction subtype for this schema version. */
  constructionType: "plane";
  /** Explicit plane definition exported for construction-plane selection and sketch session entry. */
  plane: SketchPlaneDefinition;
  /** Durable target represented by this construction snapshot. */
  target: PrimitiveRef;
}

/**
 * Presentational entity graph record derived from durable snapshot state.
 * `id` is a view-model key only; durable identity is carried by `target`.
 */
export interface SnapshotEntityRecord extends SnapshotOwnershipRecord {
  /** Presentational entity key scoped to one snapshot payload. */
  id: SnapshotEntityId;
  /** Human-readable label for selection/detail surfaces. */
  label: string;
  /** Primary durable target represented by this entity row. */
  target: PrimitiveRef;
  /** Other durable targets that should be surfaced alongside `target`. */
  relatedTargets: PrimitiveRef[];
  /** Committed authored-history feature ids that contributed to this target's geometry. */
  contributingFeatureIds: FeatureId[];
  /** Durable features that consume or depend on this entity. */
  consumedByFeatureIds: FeatureId[];
  /**
   * Explicit durable selection semantics owned by the snapshot, not by render
   * export availability. This allows the editor to decide planar eligibility
   * without inspecting tessellation payloads.
   */
  selectionSemantics: readonly (
    | "body"
    | "face"
    | "edge"
    | "vertex"
    | "constructionPlane"
    | "existingSketch"
    | "sketchEntity"
    | "sketchPoint"
    | "constraintAnnotation"
    | "dimensionAnnotation"
    | "planarFace"
    | "planarReference"
  )[];
}

/**
 * Canonical durable kernel snapshot payload.
 * This is the pure backend handoff shape: durable state, diagnostics, and
 * renderer-neutral exports only. It intentionally excludes UI tree rows and
 * other presentation-only view models.
 */
export interface KernelDocumentSnapshot {
  /** Shared top-level contract version for this snapshot payload. */
  contractVersion: ContractVersion;
  /** Snapshot schema version used to encode this payload. */
  schemaVersion: SnapshotSchemaVersion;
  /** Durable document identity represented by this snapshot. */
  documentId: DocumentId;
  /** Durable authored document name represented by this snapshot. */
  name: string;
  /** Committed revision represented by every durable record in this payload. */
  revisionId: RevisionId;
  /** Explicit document-level units and tolerance policy for this revision. */
  settings: ModelingDocumentSettings;
  /** Explicit runtime capability declaration for this kernel implementation. */
  capabilities: ModelingKernelCapabilities;
  /** Presentational feature-tree rows derived from durable state. */
  featureTree: FeatureTreeNodeRecord[];
  /** Presentational object-tree rows derived from durable state. */
  objects: ObjectTreeNodeRecord[];
  /** Durable feature records owned by this revision. */
  features: FeatureSnapshotRecord[];
  /** Last applied feature position for rollback-aware rebuilds. */
  cursor: DocumentFeatureCursor;
  /** Durable sketch records owned by this revision. */
  sketches: SketchSnapshotRecord[];
  /** Durable body records owned by this revision. */
  bodies: BodySnapshotRecord[];
  /** Durable construction/reference-geometry records owned by this revision. */
  constructions: ConstructionSnapshotRecord[];
  /** Ordered document-level variables owned by this revision. */
  variables: DocumentVariableRecord[];
  /** Presentational entity rows for selection and inspection surfaces. */
  entities: SnapshotEntityRecord[];
  /** Named durable references available at this revision. */
  references: ReferenceRecord[];
  /** Machine-readable diagnostics active at this revision. */
  diagnostics: ModelingDiagnostic[];
  /** Renderer-neutral geometry export for this revision. */
  render: RenderExport;
}

/**
 * Presentation-only snapshot payload derived from one kernel snapshot.
 * These records are workspace/editor view models rather than kernel-owned
 * document state.
 */
export interface DocumentPresentationSnapshot {
  /** Presentational feature-tree rows derived from durable state. */
  featureTree: FeatureTreeNodeRecord[];
  /** Presentational object-tree rows derived from durable state. */
  objects: ObjectTreeNodeRecord[];
  /** Presentational authored document-history rows derived from durable state. */
  documentHistory: DocumentHistoryItemRecord[];
  /** Presentational entity rows for selection and inspection surfaces. */
  entities: SnapshotEntityRecord[];
}

/**
 * Workspace snapshot consumed by the current app runtime.
 * This wraps one pure kernel snapshot plus UI-derived presentation state.
 */
export interface WorkspaceSnapshot {
  /** Pure durable kernel snapshot. */
  document: KernelDocumentSnapshot;
  /** UI/view-model payload derived from `document`. */
  presentation: DocumentPresentationSnapshot;
  /** Repository metadata used to build this snapshot, when backed by a repository. */
  provenance: DocumentSnapshotProvenance | null;
}

/**
 * Base request envelope for all modeling operations.
 */
export interface BaseModelingRequest {
  /** Shared top-level contract version expected by the caller. */
  contractVersion: ContractVersion;
}

/**
 * Base request envelope scoped to a document.
 */
export interface BaseDocumentRequest extends BaseModelingRequest {
  /** Durable document identity against which the request is evaluated. */
  documentId: DocumentId;
}

/**
 * Mutation request envelope scoped to a base revision.
 */
export interface DocumentMutationRequest extends BaseDocumentRequest {
  /** Base committed revision against which the mutation or preview is evaluated. */
  baseRevisionId: RevisionId;
}

/**
 * Common mutation result envelope.
 */
export interface ModelingOperationResult {
  /** Shared top-level contract version used to encode this result. */
  contractVersion: ContractVersion;
  /** Durable document identity against which the result was evaluated. */
  documentId: DocumentId;
  /** Revision reached or observed while producing this result. */
  revisionId: RevisionId;
  /** Explicit acceptance/conflict/rejection outcome for the base revision. */
  revisionState: MutationRevisionState;
  /** Explicit rebuild outcome for the attempted operation. */
  rebuildResult: RebuildResult;
  /** Durable targets added, updated, or otherwise materially changed by the operation. */
  changedTargets: PrimitiveRef[];
  /** Machine-readable diagnostics emitted during evaluation or rebuild. */
  diagnostics: ModelingDiagnostic[];
}

/**
 * Request envelope for fetching one authoritative document snapshot.
 */
export type GetDocumentSnapshotRequest = BaseDocumentRequest;

/**
 * Response envelope for a full document snapshot fetch.
 */
export interface GetDocumentSnapshotResponse {
  /** Shared top-level contract version used to encode this result. */
  contractVersion: ContractVersion;
  /** Full workspace snapshot payload for the requested document. */
  snapshot: WorkspaceSnapshot;
}

/**
 * Base typed feature mutation request.
 * `definition` is the only authoritative feature payload.
 * Invalid or unsupported definitions must return `revisionState.kind === "rejected"`
 * with machine-readable diagnostics and no committed mutation.
 */
export interface FeatureMutationRequest extends DocumentMutationRequest {
  /** Optional human-readable feature label override for create or update flows. */
  featureLabel?: string;
  /**
   * Exact feature definition owned by the request.
   * The kernel must reject invalid references or unsupported parameter
   * combinations explicitly rather than inferring omitted intent.
   */
  definition: FeatureDefinition;
}

/**
 * Feature creation response.
 * `revisionState.kind === "accepted"` means the feature was committed.
 * `revisionState.kind === "rejected"` means the request was evaluated but the
 * definition could not be committed.
 */
export interface CreateFeatureResponse extends ModelingOperationResult {
  /** Durable feature identity allocated or retained for the request. */
  featureId: FeatureId;
}

/**
 * Feature creation request.
 */
export type CreateFeatureRequest = FeatureMutationRequest;

/**
 * Feature update request.
 */
export interface UpdateFeatureRequest extends FeatureMutationRequest {
  /** Durable feature identity to replace in-place. */
  featureId: FeatureId;
}

/**
 * Feature update response.
 * Rejected updates must preserve durable identity and report why the update did
 * not commit.
 */
export interface UpdateFeatureResponse extends ModelingOperationResult {
  /** Durable feature identity that was targeted by the update. */
  featureId: FeatureId;
}

/**
 * Feature suppression request.
 * This mutates authored replay metadata only; feature definitions remain pure
 * operation inputs and do not carry suppression state.
 */
export interface SetFeatureSuppressionRequest extends DocumentMutationRequest {
  /** Durable feature identity whose replay state should be changed. */
  featureId: FeatureId;
  /** Requested suppression state. */
  suppressed: boolean;
}

/**
 * Feature suppression response.
 */
export interface SetFeatureSuppressionResponse extends ModelingOperationResult {
  /** Durable feature identity that was targeted by the mutation. */
  featureId: FeatureId;
  /** Suppression state observed or accepted by the mutation. */
  suppressed: boolean;
}

/**
 * Feature reorder request.
 * `beforeFeatureId` inserts the moved feature before another durable feature.
 * Null appends the feature to the end of the feature list.
 */
export interface ReorderFeatureRequest extends DocumentMutationRequest {
  /** Durable feature identity being moved in the feature list. */
  featureId: FeatureId;
  /** Null appends to the tail; otherwise insert immediately before this feature. */
  beforeFeatureId: FeatureId | null;
}

/**
 * Feature reorder response.
 */
export interface ReorderFeatureResponse extends ModelingOperationResult {
  /** Durable feature identity that was reordered. */
  featureId: FeatureId;
  /** Final insertion anchor accepted by the kernel for this reorder request. */
  beforeFeatureId: FeatureId | null;
}

export type DocumentHistoryOrderEntry =
  | { kind: "sketch"; sketchId: SketchId }
  | { kind: "feature"; featureId: FeatureId };

/**
 * Document history reorder request.
 * `beforeItem` inserts the moved sketch or feature before another durable
 * document-history item. Null appends the item to the end of authored history.
 */
export interface ReorderDocumentHistoryRequest extends DocumentMutationRequest {
  /** Durable sketch or feature identity being moved in authored document history. */
  item: DocumentHistoryOrderEntry;
  /** Null appends to the tail; otherwise insert immediately before this item. */
  beforeItem: DocumentHistoryOrderEntry | null;
}

/**
 * Document history reorder response.
 */
export interface ReorderDocumentHistoryResponse extends ModelingOperationResult {
  /** Durable sketch or feature identity that was reordered. */
  item: DocumentHistoryOrderEntry;
  /** Final insertion anchor accepted by the kernel for this reorder request. */
  beforeItem: DocumentHistoryOrderEntry | null;
}

/**
 * Feature cursor request.
 * Moves the document rollback cursor without deleting feature records.
 */
export interface SetFeatureCursorRequest extends DocumentMutationRequest {
  /** Cursor position to make active for subsequent rebuilds and feature inserts. */
  cursor: DocumentFeatureCursor;
}

/**
 * Feature cursor response.
 */
export interface SetFeatureCursorResponse extends ModelingOperationResult {
  /** Cursor position accepted by the kernel. */
  cursor: DocumentFeatureCursor;
}

/**
 * Request to create or update a durable sketch against one base revision.
 * The caller owns the authored definition and any explicit solver correlation.
 */
export interface CommitSketchRequest extends DocumentMutationRequest {
  /** Editor- or orchestrator-owned correlation IDs for explicit solver sub-requests. */
  solverCorrelation: {
    /** Parent request ID for the sketch commit workflow. */
    requestId: RequestId;
    /** Correlation ID for explicit external-reference projection. */
    projectionRequestId: RequestId;
    /** Correlation ID for explicit sketch validation. */
    validationRequestId: RequestId;
    /** Correlation ID for explicit sketch solve. */
    solveRequestId: RequestId;
    /** Correlation ID for explicit region derivation. */
    regionRequestId: RequestId;
  } | null;
  /** Existing durable sketch to update in place, or null to create a new sketch. */
  sketchId: SketchId | null;
  /** Human-readable sketch label owned by the caller. */
  sketchLabel: string;
  /** Explicit plane support and embedding for the committed sketch definition. */
  plane: SketchPlaneDefinition;
  /** Full authored sketch graph submitted for solve and commit. */
  definition: SketchRecord["definition"];
}

/**
 * Sketch commit response.
 */
export interface CommitSketchResponse extends ModelingOperationResult {
  /** Durable sketch identity allocated or retained for the commit. */
  sketchId: SketchId;
}

/**
 * Feature deletion request.
 */
export interface DeleteFeatureRequest extends DocumentMutationRequest {
  /** Durable feature identity to remove from the document. */
  featureId: FeatureId;
}

/**
 * Feature deletion response.
 */
export interface DeleteFeatureResponse extends ModelingOperationResult {
  /** Durable feature identity that was deleted. */
  deletedFeatureId: FeatureId;
}

/**
 * Generic durable deletion request for supported document-history and object targets.
 */
export interface DeleteDocumentTargetRequest extends DocumentMutationRequest {
  /** Durable target to remove from the authored document. */
  target: PrimitiveRef;
}

/**
 * Generic durable deletion response.
 */
export interface DeleteDocumentTargetResponse extends ModelingOperationResult {
  /** Durable target accepted by the deletion planner. */
  deletedTarget: PrimitiveRef;
}

/**
 * Body rename request.
 */
export interface RenameBodyRequest extends DocumentMutationRequest {
  /** Durable body identity to rename in-place. */
  bodyId: BodyId;
  /** Human-readable body label to store on the document body record. */
  bodyLabel: string;
}

/**
 * Body rename response.
 */
export interface RenameBodyResponse extends ModelingOperationResult {
  /** Durable body identity that was targeted by the rename. */
  bodyId: BodyId;
}

/**
 * Variable creation request.
 */
export interface AddDocumentVariableRequest extends DocumentMutationRequest {
  /** Optional durable variable identity. Kernels allocate one when omitted. */
  variableId?: DocumentVariableId;
  /** User-authored variable name text. */
  name: string;
  /** User-authored raw value text. */
  valueText: string;
}

/**
 * Variable creation response.
 */
export interface AddDocumentVariableResponse extends ModelingOperationResult {
  /** Durable variable identity allocated or retained for the request. */
  variableId: DocumentVariableId;
}

/**
 * Variable update request.
 */
export interface UpdateDocumentVariableRequest extends DocumentMutationRequest {
  /** Durable variable identity to update in place. */
  variableId: DocumentVariableId;
  /** User-authored variable name text. */
  name: string;
  /** User-authored raw value text. */
  valueText: string;
}

/**
 * Variable update response.
 */
export interface UpdateDocumentVariableResponse extends ModelingOperationResult {
  /** Durable variable identity that was targeted by the update. */
  variableId: DocumentVariableId;
}

/**
 * Typed feature preview request.
 * The previewed feature definition is explicit and must not depend on out-of-band
 * generic target arrays.
 */
export interface EvaluatePreviewRequest extends DocumentMutationRequest {
  /** Editor-owned preview identity used to correlate stale responses. */
  previewId: PreviewId;
  /** Exact typed feature definition to preview against `baseRevisionId`. */
  definition: FeatureDefinition;
}

/**
 * Preview evaluation response.
 */
export interface EvaluatePreviewResponse {
  /** Shared top-level contract version used to encode this result. */
  contractVersion: ContractVersion;
  /** Durable document identity against which the preview was evaluated. */
  documentId: DocumentId;
  /** Revision observed while evaluating the preview. */
  revisionId: RevisionId;
  /** Preview identity copied from the originating request. */
  previewId: PreviewId;
  /** Fresh/stale state for safe caller-side response handling. */
  freshness: PreviewFreshness;
  /** Renderer-neutral transient geometry export for the preview result. */
  render: RenderExport;
  /** Machine-readable diagnostics emitted during preview evaluation. */
  diagnostics: ModelingDiagnostic[];
}

/**
 * Reference resolution request.
 */
export interface ResolveReferenceRequest extends BaseDocumentRequest {
  /** Durable target whose ownership and validity should be resolved. */
  target: PrimitiveRef;
}

/**
 * Resolved durable reference record.
 * Ownership fields must resolve the reference back to document/revision and any
 * owning feature/sketch/body context.
 * `target` must always be a canonical durable reference.
 * Implementers must not silently remap invalid references; unresolved or
 * invalidated references must report the failure in `invalidation`.
 */
export interface ResolvedReferenceRecord {
  /** Human-readable label owned by the modeling producer. */
  label: string;
  /** Exact durable target that was requested or found dead. */
  target: PrimitiveRef;
  /** Durable document that owns the resolved target context. */
  ownerDocumentId: DocumentId;
  /** Revision in which the target was resolved. */
  ownerRevisionId: RevisionId;
  /** Owning feature when the target belongs to feature-authored state. */
  ownerFeatureId: FeatureId | null;
  /** Owning sketch when the target belongs to sketch-authored state. */
  ownerSketchId: SketchId | null;
  /** Owning body when the target belongs to body topology. */
  ownerBodyId: BodyId | null;
  /** Explicit invalidation payload when the requested target no longer resolves. */
  invalidation: InvalidReferenceDetailPayload | null;
}

/**
 * Reference resolution response.
 */
export interface ResolveReferenceResponse {
  /** Shared top-level contract version used to encode this result. */
  contractVersion: ContractVersion;
  /** Exact resolution record for the requested durable target. */
  resolution: ResolvedReferenceRecord;
  /** Machine-readable diagnostics emitted while resolving the target. */
  diagnostics: ModelingDiagnostic[];
}
