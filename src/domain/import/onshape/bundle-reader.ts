/**
 * Bundle reader: turns a validated {@link OnshapeCaptureBundle} into the narrow,
 * typed slices the translator actually consumes.
 *
 * The envelope is already validated structurally by the capture-bundle
 * contract; the raw Onshape payloads inside are archived as `unknown`. This
 * reader applies *narrow* Typia validation (surplus-property tolerant) to only
 * the shapes the translator reads, and records a structured diagnostic whenever
 * a consumed payload does not match — never throwing away the failure.
 */
import typia from "typia";

import type {
  OnshapeCaptureBundle,
  OnshapePartStudioCapture,
} from "@/contracts/import/onshape-capture-bundle";

export interface OnshapeFeatureNode {
  featureType: string;
  featureId: string;
  name?: string;
  suppressed?: boolean;
  /** Raw parameter records, interpreted defensively by translators. */
  parameters?: readonly unknown[];
  /** Raw sketch relationship records normalized by this reader. */
  constraints?: readonly OnshapeSketchConstraint[];
}

export interface OnshapeSketchParameter {
  parameterId: string;
  value?: string | number | boolean;
  expression?: string;
  hasExternalQuery: boolean;
}

export interface OnshapeSketchConstraint {
  constraintType: string;
  entityId: string;
  parameters: readonly OnshapeSketchParameter[];
}

interface RawOnshapeFeatureNode {
  featureType: string;
  featureId: string;
  name?: string;
  suppressed?: boolean;
  parameters?: readonly unknown[];
  constraints?: unknown;
}

interface OnshapeFeatureListPayload {
  features: RawOnshapeFeatureNode[];
}

/** Normalized solved-sketch curve/point with 3D positions in meters. */
export interface OnshapeSolvedCurve {
  entityId: string;
  entityType: "lineSegment" | "circle" | "arc" | "point" | "unsupported";
  onshapeEntityType: string;
  isConstruction: boolean;
  start3d?: [number, number, number];
  end3d?: [number, number, number];
  center3d?: [number, number, number];
  radius?: number;
}

export interface OnshapeSolvedSketch {
  featureId: string;
  sketchSolveStatus?: string;
  entities: OnshapeSolvedCurve[];
}

interface RawSolvedSketchPayload {
  sketches: { featureId: string; sketchSolveStatus?: string; entities?: readonly unknown[] }[];
}

export interface BundleReadDiagnostic {
  code:
    | "onshape-features-unreadable"
    | "onshape-sketches-unreadable"
    | "onshape-studio-not-found";
  message: string;
}

export interface StudioReadResult {
  studio: OnshapePartStudioCapture;
  features: OnshapeFeatureNode[];
  solvedSketchesByFeatureId: ReadonlyMap<string, OnshapeSolvedSketch>;
  diagnostics: BundleReadDiagnostic[];
}

const validateFeatureList = typia.createValidate<OnshapeFeatureListPayload>();
const validateSolvedSketches = typia.createValidate<RawSolvedSketchPayload>();

function normalizeSketchParameter(raw: unknown): OnshapeSketchParameter | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.parameterId !== "string") {
    return null;
  }
  const value = record.value;
  const normalized: OnshapeSketchParameter = {
    parameterId: record.parameterId,
    hasExternalQuery: Array.isArray(record.queries),
  };
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    normalized.value = value;
  }
  if (typeof record.expression === "string") {
    normalized.expression = record.expression;
  }
  return normalized;
}

function normalizeSketchConstraint(raw: unknown): OnshapeSketchConstraint | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.constraintType !== "string") {
    return null;
  }
  const parameters = Array.isArray(record.parameters)
    ? record.parameters
        .map(normalizeSketchParameter)
        .filter((parameter): parameter is OnshapeSketchParameter => parameter !== null)
    : [];
  return {
    constraintType: record.constraintType,
    entityId:
      typeof record.entityId === "string"
        ? record.entityId
        : `${record.constraintType}-${String(record.index ?? "unknown")}`,
    parameters,
  };
}
function readVector3(value: unknown): [number, number, number] | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as { x?: unknown; y?: unknown; z?: unknown };
  if (
    typeof record.x === "number" &&
    typeof record.y === "number" &&
    typeof record.z === "number"
  ) {
    return [record.x, record.y, record.z];
  }
  return undefined;
}

const ONSHAPE_ENTITY_KIND: Record<string, OnshapeSolvedCurve["entityType"]> = {
  skLineSegment: "lineSegment",
  skCircle: "circle",
  skArc: "arc",
  skPoint: "point",
};

/**
 * Defensively normalize one raw solved-sketch entity (BTSketchCurveSegmentInfo /
 * BTSketchPointInfo) into geometry with 3D positions. Endpoint skPoints are
 * skipped (their positions are carried on the owning curve). Unknown curve
 * kinds are surfaced as `unsupported` for the translator to diagnose.
 */
function normalizeSolvedEntity(raw: unknown): OnshapeSolvedCurve | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const entityId = record.sketchEntityId;
  const onshapeEntityType = record.sketchEntityType;
  if (typeof entityId !== "string" || typeof onshapeEntityType !== "string") {
    return null;
  }
  // Endpoint and center points are represented on their owning curves; skip only
  // those duplicate rows. Other sketch points (for example rectangle midpoints)
  // are real constraint operands and must be available to the translator.
  if (
    onshapeEntityType === "skPoint" &&
    /\.(start|end|center)$/.test(entityId)
  ) {
    return null;
  }

  const isConstruction = record.isConstruction === true;
  const geometry = (record.geometry ?? {}) as Record<string, unknown>;
  const entityType = ONSHAPE_ENTITY_KIND[onshapeEntityType] ?? "unsupported";

  return {
    entityId,
    entityType,
    onshapeEntityType,
    isConstruction,
    start3d: readVector3(record.startPosition3d),
    end3d: readVector3(record.endPosition3d),
    center3d:
      readVector3(geometry.center3d) ??
      readVector3(record.center3d) ??
      readVector3(record.position3d),
    radius:
      typeof geometry.radius === "number"
        ? geometry.radius
        : typeof record.radius === "number"
          ? record.radius
          : undefined,
  };
}

/** List the Part Studios available for import, in capture order. */
export function listPartStudios(
  bundle: OnshapeCaptureBundle,
): readonly { elementId: string; name: string; hasBodies: boolean }[] {
  return bundle.partStudios.map((studio) => ({
    elementId: studio.elementId,
    name: studio.name,
    hasBodies: studio.groundTruth.hasBodies,
  }));
}

/**
 * Read one Part Studio's consumed payload shapes. Unknown shapes degrade to an
 * empty slice plus a structured diagnostic rather than a throw, so the review
 * can report the failure and the rest of the studio can still translate.
 */
export function readPartStudio(
  bundle: OnshapeCaptureBundle,
  elementId: string,
): StudioReadResult {
  const studio = bundle.partStudios.find(
    (candidate) => candidate.elementId === elementId,
  );

  if (!studio) {
    // Fabricate an empty studio shell so callers get a stable shape; the
    // diagnostic makes the absence explicit.
    return {
      studio: {
        elementId,
        name: "",
        features: null,
        sketches: null,
        parts: null,
        featureSpecs: { present: false, reason: "studio not found" },
        resolvedReferences: [],
        groundTruth: { hasBodies: false },
        rollbackSnapshots: null,
      },
      features: [],
      solvedSketchesByFeatureId: new Map(),
      diagnostics: [
        {
          code: "onshape-studio-not-found",
          message: `Part Studio ${elementId} is not present in the bundle.`,
        },
      ],
    };
  }

  const diagnostics: BundleReadDiagnostic[] = [];

  const featureResult = validateFeatureList(studio.features);
  const features = featureResult.success
    ? featureResult.data.features.map((feature) => {
        const rawFeature = feature;
        const constraints = Array.isArray(rawFeature.constraints)
          ? rawFeature.constraints
              .map(normalizeSketchConstraint)
              .filter(
                (constraint): constraint is OnshapeSketchConstraint =>
                  constraint !== null,
              )
          : [];
        return { ...feature, constraints } satisfies OnshapeFeatureNode;
      })
    : [];
  if (!featureResult.success) {
    diagnostics.push({
      code: "onshape-features-unreadable",
      message: `The captured feature list for "${studio.name}" did not match the expected shape; no features were translated.`,
    });
  }

  const solvedSketchesByFeatureId = new Map<string, OnshapeSolvedSketch>();
  const sketchesResult = validateSolvedSketches(studio.sketches);
  if (sketchesResult.success) {
    for (const solved of sketchesResult.data.sketches) {
      const entities: OnshapeSolvedCurve[] = [];
      for (const rawEntity of solved.entities ?? []) {
        const normalized = normalizeSolvedEntity(rawEntity);
        if (normalized) {
          entities.push(normalized);
        }
      }
      solvedSketchesByFeatureId.set(solved.featureId, {
        featureId: solved.featureId,
        sketchSolveStatus: solved.sketchSolveStatus,
        entities,
      });
    }
  } else {
    diagnostics.push({
      code: "onshape-sketches-unreadable",
      message: `The captured solved-sketch payload for "${studio.name}" did not match the expected shape; solved-state seeding is unavailable.`,
    });
  }

  return { studio, features, solvedSketchesByFeatureId, diagnostics };
}
