import type { CommitSketchRequest } from "@/contracts/modeling/schema";
import type {
  BakedGeometryAssetReference,
  GeometryAssetFormat,
  GeometryAssetProvenance,
} from "@/contracts/modeling/geometry-assets";
import type { GeometryAssetId } from "@/contracts/shared/ids";
import type { ContractVersion } from "@/contracts/shared/versioning";
import type { DocumentId, RevisionId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import type { ImportPreparedActions } from "@/contracts/import/actions";

/**
 * TODO: replace `unknown` with a shared neutral vector primitive union once
 * provider-side vector parsing contracts are introduced.
 */
export type VectorPrimitive = unknown;

/**
 * 2D affine transform encoded as [a, b, c, d, tx, ty].
 */
export type AffineTransform2d = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface ImportModelingCapabilities {
  /**
   * Bakes external geometry into a Cadara-owned geometry asset for downstream
   * feature creation without providers importing kernel internals directly.
   * Returns a self-describing asset reference (id, format, content hash, byte
   * length) sufficient to reconstruct the store record without session state.
   */
  bakeGeometry(input: {
    bytes: Uint8Array;
    format: GeometryAssetFormat;
    options?: Record<string, unknown>;
  }): Promise<BakedGeometryAssetReference>;

  /**
   * Reconstructs mesh-backed geometry into a native B-rep asset when a
   * provider wants editable solids instead of faceted-only output.
   */
  reconstructMeshToBrep(input: {
    assetId: GeometryAssetId;
    options?: Record<string, unknown>;
  }): Promise<GeometryAssetId>;
}

export interface ImportSketchCapabilities {
  /**
   * Converts provider-parsed vector primitives into committed sketch entity
   * data suitable for `CommitSketchRequest` payloads.
   */
  convertVectorToSketch(input: {
    primitives: readonly VectorPrimitive[];
    transform?: AffineTransform2d;
  }): Promise<CommitSketchRequest["definition"]>;
}

export interface ImportAssetCapabilities {
  /**
   * Registers immutable geometry bytes for use in provider-prepared feature definitions.
   */
  registerGeometryAsset(input: {
    bytes: Uint8Array;
    format: GeometryAssetFormat;
    mediaType: string;
    provenance: GeometryAssetProvenance;
  }): Promise<GeometryAssetId>;

  /**
   * Stores embedded binary content outside authored feature payloads and
   * returns a durable asset handle for later lookup.
   */
  storeEmbeddedBinary(input: {
    bytes: Uint8Array;
    mediaType: string;
    fileName?: string;
  }): Promise<string>;
}

export interface ImportMutationContextCapabilities {
  contractVersion: ContractVersion;
  documentId: DocumentId;
  baseRevisionId: RevisionId;
}

/**
 * Per-entity topology signature returned by the history probe. Mirrors the
 * geometric-signature shape providers capture so a matcher can rank captured
 * signatures against staged-rebuild topology.
 */
export interface HistoryProbeTopologySignature {
  entityClass: "face" | "edge" | "vertex" | "body";
  /** Geometry type such as `plane`, `cylinder`, `line`, `circle`. */
  geometryType: string;
  /** Defining data where cheap to compute for the entity class. */
  definingData?: Record<string, unknown>;
  /** Centroid in document units. */
  centroid?: [number, number, number];
  /** Axis-aligned bounding box, `[low, high]` corner points. */
  boundingBox?: {
    low: [number, number, number];
    high: [number, number, number];
  };
  /** Durable reference resolving to this entity for downstream feature use. */
  reference: DurableRef;
}

export interface HistoryProbeStepDiagnostic {
  severity: "info" | "warning" | "error";
  message: string;
  code?: string;
}

/**
 * Result for a single probed step. A failed step carries structured
 * diagnostics rather than throwing them away.
 */
export type HistoryProbeStepResult =
  | {
      status: "rebuilt";
      signatures: HistoryProbeTopologySignature[];
    }
  | {
      status: "failed";
      diagnostics: HistoryProbeStepDiagnostic[];
    };

export interface HistoryProbeTessellationSample {
  /** Flattened xyz triples from the final staged rebuild, in document units. */
  points: readonly number[];
}

export interface HistoryProbeResult {
  /** One entry per applied step, in the order of the candidate sequence. */
  steps: HistoryProbeStepResult[];
  /** Optional final-state tessellation, requested only by verification callers. */
  finalTessellation?: HistoryProbeTessellationSample;
}

export interface HistoryProbeInput {
  /**
   * Candidate prepared actions to rebuild in a sandboxed kernel session. When
   * `orderedActions` is present the probe follows that order; otherwise the
   * grouped order is used, mirroring the orchestrator.
   */
  actions: ImportPreparedActions;
  /**
   * Source feature whose pre-action prefix is being probed. This is diagnostic
   * correlation only; kernel history evaluation still depends solely on actions.
   */
  consumerFeatureId?: string;
  /** Request final-state tessellation for ground-truth verification. */
  includeFinalTessellation?: boolean;
  /**
   * Zero-based successful action ordinals whose live topology signatures are
   * needed. Omit to preserve legacy sampling at every successful step.
   */
  requestedSignatureStepOrdinals?: readonly number[];
  /**
   * Report apply-time topology rematch failures as their failed probe step
   * instead of throwing them to the caller.
   */
  containTopologyRematchFailures?: boolean;
}

/**
 * Sandboxed history evaluation probe. Executing a candidate ordered sequence in
 * an isolated kernel session returns per-step topology signatures without
 * mutating any document, history, or persistent state.
 */
export interface ImportHistoryProbeCapabilities {
  evaluateHistoryProbe(input: HistoryProbeInput): Promise<HistoryProbeResult>;
}

export interface ImportCapabilities {
  context: ImportMutationContextCapabilities;
  modeling: ImportModelingCapabilities;
  sketch: ImportSketchCapabilities;
  assets: ImportAssetCapabilities;
  /**
   * Optional history evaluation probe. Absence is explicit: when the platform
   * cannot probe intermediate topology this field is `undefined` rather than a
   * stub that fabricates signatures, so providers can degrade planning.
   */
  history?: ImportHistoryProbeCapabilities;
}
