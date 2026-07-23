import typia from "typia";

import {
  ContractValidationError,
  validateContract,
  type ContractValidationResult,
} from "@/contracts/shared/validation";

/**
 * Current Onshape capture bundle envelope format version.
 *
 * The bundle is the load-bearing interface between the `cadara onshape capture`
 * subcommand and the future offline import provider. Raw Onshape API responses
 * are archived verbatim as opaque payloads; only the envelope is validated
 * structurally so captures never decay as the translator improves.
 */
export const ONSHAPE_CAPTURE_BUNDLE_FORMAT_VERSION = 2;

/** Current exact-profile evidence contract carried by each freshly captured studio. */
export const ONSHAPE_PROFILE_EVIDENCE_SCHEMA_VERSION = 3;

/** Current completion contract for deterministic and query history evidence. */
export const ONSHAPE_IMMUTABLE_HISTORY_EVIDENCE_SCHEMA_VERSION = 1;

/**
 * Workspace / version / microversion selector segment of an Onshape document URL.
 */
export type OnshapeWvm = "w" | "v" | "m";

/**
 * Capture provenance: pins exactly what was captured and from where so a later
 * offline import can bind, refresh, or diagnose the bundle.
 */
export interface OnshapeCaptureProvenance {
  /** ISO-8601 timestamp of when the capture completed. */
  capturedAt: string;
  /** Version of the `cadara` CLI that produced the bundle. */
  cliVersion: string;
  /** Onshape REST API version used (e.g. `v10`). */
  apiVersion: string;
  /** API base URL used (e.g. `https://cad.onshape.com/api/v10`). */
  baseUrl: string;
  /** Onshape document id (24 hex chars). */
  documentId: string;
  /** Whether the capture targeted a workspace, version, or microversion. */
  wvm: OnshapeWvm;
  /** The workspace/version/microversion id matching `wvm`. */
  wvmId: string;
  /** Exact microversion captured, enabling reproducible re-resolution. */
  microversion: string;
}

/**
 * An optional capture section that may legitimately be absent. Absence is
 * always recorded explicitly with a structured reason rather than silently
 * dropped.
 */
export type OnshapeOptionalSection =
  | { present: true; response: unknown }
  | { present: false; reason: string };

/** Bundle-level capture diagnostic for degraded optional capture behavior. */
export interface OnshapeCaptureDiagnostic {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
}

/**
 * Geometric signature for a resolved deterministic ID, produced by server-side
 * FeatureScript evaluation against the captured microversion. Defining data is
 * best-effort: only fields cheap to compute for the entity class are populated.
 */
export interface OnshapeGeometricSignature {
  entityClass: "face" | "edge" | "vertex" | "body";
  /** Geometry type such as `plane`, `cylinder`, `line`, `circle`, `sphere`. */
  geometryType: string;
  /** Defining data where cheap (plane origin+normal, cylinder axis+radius, ...). */
  definingData?: Record<string, unknown>;
  /** Axis-aligned bounding box, `[low, high]` corner points in meters. */
  boundingBox?: {
    low: [number, number, number];
    high: [number, number, number];
  };
  /** Centroid in meters. */
  centroid?: [number, number, number];
  /** Small tessellation sample (flattened xyz triples) for ambiguous cases. */
  tessellationSample?: number[];
  /** Owning feature id when derivable from `CREATION` history. */
  owningFeatureId?: string;
  /** True when the entity is identifiable as an Onshape default plane. */
  isDefaultPlane?: boolean;
}

/**
 * Resolution record for a deterministic ID. History-point records retain the
 * consuming feature so the provider can prefer the authored-state signature.
 */
export type OnshapeResolvedReference =
  | { deterministicId: string; evaluatedAt: "finalState"; signature: OnshapeGeometricSignature }
  | { deterministicId: string; evaluatedAt: "finalState"; unresolved: { reason: string } }
  | {
      deterministicId: string;
      evaluatedAt: "historyPoint";
      consumingFeatureId: string;
      signature: OnshapeGeometricSignature;
    }
  | {
      deterministicId: string;
      evaluatedAt: "historyPoint";
      consumingFeatureId: string;
      unresolved: { reason: string };
    };

/** History-point evidence obtained by evaluating an ID-less captured query. */
export type OnshapeResolvedQueryReference =
  | {
      consumingFeatureId: string;
      parameterId: string;
      queryIndex: number;
      entityIndex: number;
      evaluatedAt: "historyPoint";
      signature: OnshapeGeometricSignature;
    }
  | {
      consumingFeatureId: string;
      parameterId: string;
      queryIndex: number;
      evaluatedAt: "historyPoint";
      unresolved: { reason: string };
    };

/**
 * Exact pre-consumer evidence for a solid extrude's `entities` query. Opaque
 * query results retain transient server identities; readable qSketchRegion
 * assignments retain their exact local region-set semantics instead.
 */
export interface OnshapeProfileEvidenceManifestEntry {
  /** Exact query source owned by this consuming feature/query slot. */
  consumingFeatureId: string;
  parameterId: "entities";
  queryIndex: number;
  sourceQueryString: string | null;
  /** The exact profile-evidence shape emitted for this query. */
  kind: "sketchRegionSet" | "faceResults" | "unresolved";
  emittedRecordCount: number;
  completed: true;
}

/** One deterministic-ID consumer covered by immutable history evidence. */
export interface OnshapeDeterministicHistoryEvidenceManifestEntry {
  deterministicId: string;
  consumingFeatureId: string;
  completed: true;
}

/** One ID-less query consumer covered by immutable history evidence. */
export interface OnshapeQueryHistoryEvidenceManifestEntry {
  consumingFeatureId: string;
  parameterId: string;
  queryIndex: number;
  sourceQueryString: string;
  emittedRecordCount: number;
  completed: true;
}

/** Completion contract for all non-profile immutable history evidence. */
export interface OnshapeImmutableHistoryEvidenceManifest {
  deterministicIdConsumers: OnshapeDeterministicHistoryEvidenceManifestEntry[];
  queryStringConsumers: OnshapeQueryHistoryEvidenceManifestEntry[];
}

export type OnshapeProfileEvidence =
  | {
      /** Exact readable qSketchRegion set; no server face witness is needed. */
      consumingFeatureId: string;
      parameterId: "entities";
      queryIndex: number;
      evaluatedAt: "historyPoint";
      kind: "sketchRegionSet";
      sourceSketchFeatureId: string;
      filterInnerLoops: boolean;
    }
  | {
      consumingFeatureId: string;
      parameterId: "entities";
      queryIndex: number;
      resultIndex: number;
      deterministicId: string;
      evaluatedAt: "historyPoint";
      kind: "sketchRegion";
      /** Exact prior qSketchRegion source, never inferred from geometry. */
      sourceSketchFeatureId: string;
      /** Server-certified point contained by this exact selected face. */
      interiorPoint3d: [number, number, number];
    }
  | {
      consumingFeatureId: string;
      parameterId: "entities";
      queryIndex: number;
      resultIndex: number;
      deterministicId: string;
      evaluatedAt: "historyPoint";
      kind: "sketchRegion";
      sourceSketchFeatureId: string;
      /** Classification was exact, but no certified face witness was available. */
      unresolved: { reason: string };
    }
  | {
      consumingFeatureId: string;
      parameterId: "entities";
      queryIndex: number;
      resultIndex: number;
      deterministicId: string;
      evaluatedAt: "historyPoint";
      kind: "planarFace";
      signature: OnshapeGeometricSignature;
    }
  | {
      consumingFeatureId: string;
      parameterId: "entities";
      queryIndex: number;
      resultIndex?: number;
      deterministicId?: string;
      evaluatedAt: "historyPoint";
      kind: "unresolved";
      unresolved: { reason: string };
    };

/**
 * Final-state ground-truth geometry for a Part Studio. Empty Part Studios
 * record the absence of bodies explicitly rather than embedding empty payloads.
 */
export type OnshapeGroundTruth =
  | {
      hasBodies: true;
      /** Chord tolerance used for tessellation, in meters. */
      tessellationTolerance: number;
      /** Raw tessellated-faces response, archived verbatim. */
      tessellatedFaces: unknown;
      /** STEP export as text, embedded so import needs no network. */
      step: string;
    }
  | {
      hasBodies: true;
      /** Final geometry was intentionally not captured because no final bake needs it. */
      omittedReason: "no-final-bake-boundary";
    }
  | { hasBodies: false };

export function hasOnshapeGroundTruthGeometry(
  groundTruth: OnshapeGroundTruth,
): groundTruth is Extract<OnshapeGroundTruth, { tessellatedFaces: unknown }> {
  return groundTruth.hasBodies && "tessellatedFaces" in groundTruth;
}


/** Geometry captured after a solid feature at its rollback position. */
export interface OnshapeRollbackSnapshot {
  featureId: string;
  /** Chord tolerance used for tessellation, in meters. */
  tessellationTolerance: number;
  /** Raw tessellated-faces response, archived verbatim. */
  tessellatedFaces: unknown;
  /** STEP export when the Onshape export endpoint made one available. */
  step?: string;
}

/** Per-feature rollback snapshots are a v2 opt-in section. */
export type OnshapeRollbackSnapshots = OnshapeRollbackSnapshot[] | null;

/**
 * Per-Part-Studio capture section. Raw Onshape responses are stored verbatim as
 * opaque payloads; the provider interprets them with its own narrow validators.
 */
export interface OnshapePartStudioCapture {
  elementId: string;
  name: string;
  /** Raw `getFeatures` response — ordered history with sketches inline. */
  features: unknown;
  /** Raw solved-sketch response — the constraint-solver oracle. */
  sketches: unknown;
  /** Raw parts response. */
  parts: unknown;
  /** Optional raw `featurespecs` response. */
  featureSpecs: OnshapeOptionalSection;
  /** Resolution table for every referenced deterministic ID. */
  resolvedReferences: OnshapeResolvedReference[];
  /** Optional history-point evidence for captured queries whose ID arrays were empty. */
  resolvedQueryReferences?: OnshapeResolvedQueryReference[];
  /** Optional on older bundles; current value proves deterministic/query history completeness. */
  immutableHistoryEvidenceSchemaVersion?: number;
  /** Completion contract binding deterministic/query history to exact consumers. */
  immutableHistoryEvidenceManifest?: OnshapeImmutableHistoryEvidenceManifest;
  /** Exact consumer-indexed selected-face evidence for solid extrude profiles. */
  profileEvidence?: OnshapeProfileEvidence[];
  /** Optional on v2 bundles produced before profile evidence was versioned. */
  profileEvidenceSchemaVersion?: number;
  /** Completion contract binding profile evidence to its exact consumers. */
  profileEvidenceManifest?: OnshapeProfileEvidenceManifestEntry[];
  /** Final-state ground-truth geometry. */
  groundTruth: OnshapeGroundTruth;
  /** Proven bake-boundary snapshots; `null` only when required capture was unavailable. */
  rollbackSnapshots: OnshapeRollbackSnapshots;
}

/** Fields shared by v1 and v2 capture envelopes. */
/**
 * Accept evidence only when a current manifest proves that this exact source
 * query emitted a complete, non-duplicated record sequence. Older envelopes
 * deliberately remain structurally valid but are cache/import misses.
 */
export function hasCurrentOnshapeProfileEvidence(input: {
  schemaVersion: number | undefined;
  manifest: readonly OnshapeProfileEvidenceManifestEntry[] | undefined;
  evidence: readonly OnshapeProfileEvidence[] | undefined;
  consumingFeatureId: string;
  queryIndex: number;
  sourceQueryString: string | null;
}): boolean {
  if (input.schemaVersion !== ONSHAPE_PROFILE_EVIDENCE_SCHEMA_VERSION || !input.manifest || !input.evidence) {
    return false;
  }
  const entries = input.manifest.filter((entry) =>
    entry.consumingFeatureId === input.consumingFeatureId &&
    entry.parameterId === "entities" &&
    entry.queryIndex === input.queryIndex,
  );
  if (entries.length !== 1 || entries[0]?.sourceQueryString !== input.sourceQueryString) return false;
  const entry = entries[0]!;
  const records = input.evidence.filter((record) =>
    record.consumingFeatureId === input.consumingFeatureId &&
    record.parameterId === "entities" &&
    record.queryIndex === input.queryIndex &&
    record.evaluatedAt === "historyPoint",
  );
  if (!entry.completed || records.length !== entry.emittedRecordCount || records.length === 0) return false;
  if (entry.kind === "sketchRegionSet") {
    return records.length === 1 && records[0]?.kind === "sketchRegionSet";
  }
  if (entry.kind === "unresolved") {
    return records.length === 1 &&
      records[0]?.kind === "unresolved" &&
      !("resultIndex" in records[0]) &&
      records[0].unresolved.reason !== "profile evidence FeatureScript result was malformed";
  }
  return records.every((record, resultIndex) =>
    record.kind !== "sketchRegionSet" && "resultIndex" in record && record.resultIndex === resultIndex,
  );
}

/**
 * Accept deterministic and query history evidence only when a current manifest
 * binds complete, non-duplicated records to every raw feature consumer. Older
 * envelopes stay structurally valid but deliberately remain cache misses.
 */
export function hasCurrentOnshapeImmutableHistoryEvidence(input: {
  schemaVersion: number | undefined;
  manifest: OnshapeImmutableHistoryEvidenceManifest | undefined;
  resolvedReferences: readonly OnshapeResolvedReference[];
  resolvedQueryReferences: readonly OnshapeResolvedQueryReference[] | undefined;
  deterministicIdConsumers: readonly {
    deterministicId: string;
    consumingFeatureId: string;
  }[];
  queryStringConsumers: readonly {
    consumingFeatureId: string;
    parameterId: string;
    queryIndex: number;
    queryString: string;
  }[];
}): boolean {
  if (
    input.schemaVersion !== ONSHAPE_IMMUTABLE_HISTORY_EVIDENCE_SCHEMA_VERSION ||
    !input.manifest ||
    !input.resolvedQueryReferences
  ) return false;

  const deterministicKeys = new Set(input.deterministicIdConsumers.map(
    (consumer) => `${consumer.deterministicId}\u0000${consumer.consumingFeatureId}`,
  ));
  const manifestDeterministicKeys = input.manifest.deterministicIdConsumers.map(
    (consumer) => `${consumer.deterministicId}\u0000${consumer.consumingFeatureId}`,
  );
  if (
    manifestDeterministicKeys.length !== deterministicKeys.size ||
    new Set(manifestDeterministicKeys).size !== manifestDeterministicKeys.length ||
    manifestDeterministicKeys.some((key) => !deterministicKeys.has(key)) ||
    input.manifest.deterministicIdConsumers.some((consumer) => !consumer.completed)
  ) return false;

  for (const consumer of input.deterministicIdConsumers) {
    const history = input.resolvedReferences.filter((record) =>
      record.evaluatedAt === "historyPoint" &&
      record.deterministicId === consumer.deterministicId &&
      record.consumingFeatureId === consumer.consumingFeatureId,
    );
    if (history.length !== 1) return false;
  }
  const historyRecords = input.resolvedReferences.filter((record) => record.evaluatedAt === "historyPoint");
  if (historyRecords.length !== deterministicKeys.size) return false;
  const finalIds = new Set(input.deterministicIdConsumers.map((consumer) => consumer.deterministicId));
  for (const deterministicId of finalIds) {
    if (input.resolvedReferences.filter((record) =>
      record.evaluatedAt === "finalState" && record.deterministicId === deterministicId,
    ).length !== 1) return false;
  }
  if (input.resolvedReferences.filter((record) => record.evaluatedAt === "finalState").length !== finalIds.size) {
    return false;
  }

  const queryKeys = new Set(input.queryStringConsumers.map(
    (consumer) => `${consumer.consumingFeatureId}\u0000${consumer.parameterId}\u0000${consumer.queryIndex}`,
  ));
  const manifestQueries = input.manifest.queryStringConsumers;
  if (
    manifestQueries.length !== queryKeys.size ||
    new Set(manifestQueries.map((consumer) =>
      `${consumer.consumingFeatureId}\u0000${consumer.parameterId}\u0000${consumer.queryIndex}`,
    )).size !== manifestQueries.length
  ) return false;
  let expectedQueryRecordCount = 0;
  for (const consumer of input.queryStringConsumers) {
    const entry = manifestQueries.find((candidate) =>
      candidate.consumingFeatureId === consumer.consumingFeatureId &&
      candidate.parameterId === consumer.parameterId &&
      candidate.queryIndex === consumer.queryIndex &&
      candidate.sourceQueryString === consumer.queryString,
    );
    const records = input.resolvedQueryReferences.filter((record) =>
      record.consumingFeatureId === consumer.consumingFeatureId &&
      record.parameterId === consumer.parameterId &&
      record.queryIndex === consumer.queryIndex &&
      record.evaluatedAt === "historyPoint",
    );
    if (!entry || !entry.completed || records.length === 0 || records.length !== entry.emittedRecordCount) return false;
    if (records.length > 1 && !records.every((record, index) => "entityIndex" in record && record.entityIndex === index)) {
      return false;
    }
    expectedQueryRecordCount += entry.emittedRecordCount;
  }
  return input.resolvedQueryReferences.length === expectedQueryRecordCount;
}

export interface OnshapeCaptureBundleBase {
  provenance: OnshapeCaptureProvenance;
  /** Raw `/documents/{did}` response. */
  document: unknown;
  /** Raw element-list response. */
  elements: unknown;
  /** Bundle-level diagnostics for degraded optional capture behavior. */
  diagnostics?: OnshapeCaptureDiagnostic[];
  partStudios: OnshapePartStudioCapture[];
}

/** Original final-state-only capture envelope. */
export interface OnshapeCaptureBundleV1 extends OnshapeCaptureBundleBase {
  formatVersion: 1;
}

/** Capture v2 adds history-point resolutions and optional rollback snapshots. */
export interface OnshapeCaptureBundleV2 extends OnshapeCaptureBundleBase {
  formatVersion: 2;
}

/** Versioned, self-contained Onshape capture bundle. */
export type OnshapeCaptureBundle = OnshapeCaptureBundleV1 | OnshapeCaptureBundleV2;

const onshapeCaptureBundleValidator =
  typia.createValidateEquals<OnshapeCaptureBundle>();

/**
 * Validate an unknown value against the Onshape capture bundle envelope.
 * Raw Onshape payloads embedded as `unknown` are intentionally not traversed.
 */
export function validateOnshapeCaptureBundle(
  value: unknown,
): ContractValidationResult<OnshapeCaptureBundle> {
  return validateContract(onshapeCaptureBundleValidator, value);
}

/**
 * Validate and return an Onshape capture bundle, throwing a
 * {@link ContractValidationError} with structured issues on failure.
 */
export function requireOnshapeCaptureBundle(
  value: unknown,
): OnshapeCaptureBundle {
  const result = validateOnshapeCaptureBundle(value);
  if (result.success) {
    return result.data;
  }

  const firstIssue = result.issues[0];
  throw new ContractValidationError(
    firstIssue?.message ?? "Onshape capture bundle validation failed.",
    value,
    result.issues,
  );
}
