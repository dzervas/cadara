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
export const ONSHAPE_CAPTURE_BUNDLE_FORMAT_VERSION = 1;

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
 * Resolution record for a single deterministic ID referenced by the feature
 * list. Either a geometric signature or a structured unresolved reason — never
 * a fabricated signature.
 */
export type OnshapeResolvedReference =
  | {
      deterministicId: string;
      evaluatedAt: "finalState";
      signature: OnshapeGeometricSignature;
    }
  | {
      deterministicId: string;
      evaluatedAt: "finalState";
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
  /** Final-state ground-truth geometry. */
  groundTruth: OnshapeGroundTruth;
  /**
   * Reserved for per-feature rollback B-rep snapshots. v1 of the CLI never
   * populates this; it always writes `null`.
   */
  rollbackSnapshots: null;
}

/**
 * Versioned, self-contained Onshape capture bundle. Everything a later offline
 * import needs lives here: provenance, raw document/element responses, and one
 * capture section per Part Studio.
 */
export interface OnshapeCaptureBundle {
  formatVersion: 1;
  provenance: OnshapeCaptureProvenance;
  /** Raw `/documents/{did}` response. */
  document: unknown;
  /** Raw element-list response. */
  elements: unknown;
  partStudios: OnshapePartStudioCapture[];
}

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
