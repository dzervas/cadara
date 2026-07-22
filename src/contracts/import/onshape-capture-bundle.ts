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
  | { hasBodies: false };


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
  /** Final-state ground-truth geometry. */
  groundTruth: OnshapeGroundTruth;
  /** `null` unless v2 snapshot capture was explicitly requested. */
  rollbackSnapshots: OnshapeRollbackSnapshots;
}

/** Fields shared by v1 and v2 capture envelopes. */
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
