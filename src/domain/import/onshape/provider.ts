/**
 * Onshape capture-bundle import provider (probe-less v1).
 *
 * Composes the pure translation modules into an `ImportProvider`: a
 * non-mutating review that validates the bundle and plans per-feature fidelity,
 * a schema-driven review form with studio selection and demotion controls, and
 * a prepare step that emits history-ordered actions for the parametric-tier
 * features (document variables and datum-plane sketches) plus an honest
 * fidelity report. Solid features degrade to `baked` with capability reason
 * codes while the history probe is absent.
 */
import type {
  ImportCommitSketchRequest,
  ImportCreateFeatureRequest,
  ImportDeferredExtrudeProfileRef,
  ImportDeferredFeatureBooleanScope,
  ImportDeferredFeatureDefinition,
  ImportDeferredTopologyRef,
  ImportDeferredProfileRef,
  ImportPreparedActions,
  ImportPreparedActionRef,
} from "@/contracts/import/actions";
import type { ImportDiagnostic } from "@/contracts/import/diagnostics";
import { describeUnknownError } from "@/contracts/errors";
import type { ImportProvider } from "@/contracts/import/provider";
import type { ImportReviewEnvelope } from "@/contracts/import/review";
import type { ResolvedImportSource } from "@/contracts/import/source";
import {
  BAKED_BODY_FEATURE_SCHEMA_VERSION,
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  IMPORT_CONTRACT_SCHEMA_VERSION,
  PLANE_FEATURE_SCHEMA_VERSION,
  REVOLVE_FEATURE_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import {
  validateOnshapeCaptureBundle,
  type OnshapeCaptureBundle,
} from "@/contracts/import/onshape-capture-bundle";
import type {
  AddDocumentVariableRequest,
} from "@/contracts/modeling/schema";
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from "@/contracts/modeling/advanced-solid";
import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import type {
  HistoryProbeResult,
  HistoryProbeTopologySignature,
  ImportCapabilities,
} from "@/contracts/import/capabilities";
import type {
  SketchPlaneDefinition,
  SketchPlaneFrame,
} from "@/contracts/shared/sketch-plane";
import type { ConstructionId, RequestId } from "@/contracts/shared/ids";
import type {
  FeatureEditorFormSchema,
  FeatureEditorFormField,
} from "@/core/feature-authoring/form-schema";

import {
  listPartStudios,
  readPartStudio,
} from "@/domain/import/onshape/bundle-reader";
import {
  extractSketchPlaneDeterministicId,
  onshapeFeatureTranslatorRegistry,
  planStudioFidelity,
  replanStudioBakeStrategy,
  type FeaturePlan,
  type FidelityTier,
  type PlanReasonCode,
  type StudioPlan,
} from "@/domain/import/onshape/fidelity-planner";
import {
  compareTessellation,
  verificationPartial,
  verificationUnavailable,
  type GroundTruthVerification,
} from "@/domain/import/onshape/ground-truth";
import {
  projectPointToPlane,
  projectPointToSketchPlane,
  translateSketch,
  verifySketchTranslationSolveConsistency,
  type SolvedSketchEntityGeometry,
} from "@/domain/import/onshape/sketch-translator";
import { translateOnshapeExpression } from "@/domain/import/onshape/expression-translator";
import { matchSignature } from "@/domain/import/onshape/signature-matcher";
import { normalizeOnshapeTopologySignature } from "@/domain/import/onshape/topology-signature-normalizer";
import type {
  OnshapeGeometricSignature,
  OnshapeResolvedReference,
} from "@/contracts/import/onshape-capture-bundle";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import { encodeOnshapeTessellationAsBakedMeshBytes } from "@/domain/import/onshape/rollback-bake";
import { probeTopologyConsumerPrefixes } from "@/domain/import/onshape/topology-resolution-planner";
import { OCC_KERNEL_CAPABILITIES } from "@/domain/modeling/opencascade-kernel-seed";
import { readTopologyQueryRefs } from "@/domain/import/onshape/topology-query-reader";
import { resolveTopologyReferences } from "@/domain/import/onshape/topology-reference-resolver";
import { computeCaptureFrameToWorld } from "@/domain/import/onshape/capture-frame";
import { createRollbackTopologyTimeline } from "@/domain/import/onshape/rollback-topology-reader";
import { DEFAULT_MATCH_TOLERANCE } from "@/domain/import/onshape/signature-matcher";
import { buildResolvedBodyConsumerDefinition } from "@/domain/import/onshape/wave-b-body-feature-translators";
import { prepareRollbackCheckpointBake } from "@/domain/import/onshape/rollback-bake";
import {
  resolvePlannedExtrudeTopology,
  resolvedExtrudeExtent,
} from "@/domain/import/onshape/extrude-planner";

const ACCEPTED_EXTENSION = ".onshape-capture.json";

export interface OnshapeStudioReview {
  elementId: string;
  name: string;
  hasBodies: boolean;
  featurePlans: FeaturePlan[];
  tierCounts: Record<FidelityTier, number>;
  bakeStrategy: StudioPlan["bakeStrategy"];
  bakeDiagnostics: StudioPlan["bakeDiagnostics"];
  requiresStudioBake: boolean;
  verification: GroundTruthVerification;
  sketchRelationshipSummaries: OnshapeSketchRelationshipReview[];
}

export interface OnshapeSketchRelationshipReview {
  featureId: string;
  label: string;
  summary: import("@/domain/import/onshape/sketch-translator").SketchRelationshipSummary;
}

export interface OnshapeImportReview {
  valid: boolean;
  studios: OnshapeStudioReview[];
  defaultStudioId: string | null;
}

export interface OnshapeImportSelections {
  studioElementId: string | null;
  /** Feature ids the user demoted from parametric to baked. */
  demotedFeatureIds: string[];
}

function decodeBundle(source: ResolvedImportSource): OnshapeCaptureBundle | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(source.bytes));
  } catch {
    return null;
  }
  const result = validateOnshapeCaptureBundle(parsed);
  return result.success ? result.data : null;
}

function referenceKey(reference: HistoryProbeTopologySignature["reference"]): string {
  switch (reference.kind) {
    case "body":
      return `body:${reference.bodyId}`;
    case "face":
      return `face:${reference.bodyId}:${reference.faceId}`;
    case "edge":
      return `edge:${reference.bodyId}:${reference.edgeId}`;
    case "vertex":
      return `vertex:${reference.bodyId}:${reference.vertexId}`;
    default:
      return JSON.stringify(reference);
  }
}

function readPoint3(value: unknown): [number, number, number] | null {
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every((component) => typeof component === "number")
    ? [value[0] as number, value[1] as number, value[2] as number]
    : null;
}

function cross(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): [number, number, number] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function planeFromProbeSignature(
  signature: HistoryProbeTopologySignature,
): SketchPlaneDefinition | null {
  if (signature.reference.kind !== "face" || signature.geometryType !== "plane") {
    return null;
  }
  const origin = readPoint3(signature.definingData?.origin);
  const normal = readPoint3(signature.definingData?.normal);
  const xAxis = readPoint3(signature.definingData?.xDirection);
  if (!origin || !normal || !xAxis) {
    return null;
  }
  return {
    support: signature.reference,
    frame: {
      origin,
      xAxis,
      yAxis: cross(normal, xAxis),
      normal,
      linearUnit: "documentLength",
      handedness: "rightHanded",
    },
    key: null,
  };
}

function arbitraryXAxisForNormal(
  normal: readonly [number, number, number],
): [number, number, number] | null {
  const seed: [number, number, number] = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const seedDotNormal = seed[0] * normal[0] + seed[1] * normal[1] + seed[2] * normal[2];
  const projected: [number, number, number] = [
    seed[0] - normal[0] * seedDotNormal,
    seed[1] - normal[1] * seedDotNormal,
    seed[2] - normal[2] * seedDotNormal,
  ];
  return normalizeVector(projected);
}

function frameFromCapturedSignature(
  signature: OnshapeGeometricSignature,
): SketchPlaneFrame | null {
  if (signature.entityClass !== "face" || signature.geometryType !== "plane") {
    return null;
  }
  const originMeters = readPoint3(signature.definingData?.origin);
  const normal = normalizeVector(readPoint3(signature.definingData?.normal) ?? [0, 0, 0]);
  if (!originMeters || !normal) {
    return null;
  }
  const xAxis =
    normalizeVector(readPoint3(signature.definingData?.xDirection) ?? [0, 0, 0]) ??
    arbitraryXAxisForNormal(normal);
  if (!xAxis) {
    return null;
  }
  const origin: [number, number, number] = [
    originMeters[0] * 1000,
    originMeters[1] * 1000,
    originMeters[2] * 1000,
  ];
  return {
    origin,
    xAxis,
    yAxis: cross(normal, xAxis),
    normal,
    linearUnit: "documentLength",
    handedness: "rightHanded",
  };
}

/**
 * Extract the producing feature id from a `newSketch`'s sketchPlane query string.
 * Onshape encodes the plane's operation id as `<featureId>planeOp`, so a sketch
 * drawn on a construction plane names the `cPlane` feature that created it.
 */
function extractSketchPlaneProducingFeatureId(
  feature: ReturnType<typeof readPartStudio>["features"][number],
): string | null {
  for (const queryString of queryStringsForFeature(feature)) {
    const match = queryString.match(
      /\$([A-Za-z0-9_]+)planeOp|id\s*\+\s*"([A-Za-z0-9_]+)"\s*\+\s*"planeOp"/,
    );
    const featureId = match?.[1] ?? match?.[2];
    if (featureId) {
      return featureId;
    }
  }
  return null;
}

function extractPlaneConsumerReference(
  feature: ReturnType<typeof readPartStudio>["features"][number],
  parameterId: "mirrorPlane" | "transformDirection",
): { featureId: string; deterministicId: string } | null {
  const parameter = (feature.parameters ?? []).find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { parameterId?: unknown }).parameterId === parameterId,
  ) as { queries?: unknown } | undefined;
  const queries = parameter?.queries;
  if (!Array.isArray(queries) || queries.length !== 1) return null;
  const query = queries[0];
  if (typeof query !== "object" || query === null) return null;
  const queryString = (query as { queryString?: unknown }).queryString;
  const deterministicIds = (query as { deterministicIds?: unknown }).deterministicIds;
  if (typeof queryString !== "string" || !Array.isArray(deterministicIds)) return null;
  const deterministicId = deterministicIds.find(
    (candidate): candidate is string => typeof candidate === "string",
  );
  const match = queryString.match(
    /\$([A-Za-z0-9_]+)planeOp|id\s*\+\s*"([A-Za-z0-9_]+)"\s*\+\s*"planeOp"/,
  );
  const featureId = match?.[1] ?? match?.[2];
  return featureId && deterministicId ? { featureId, deterministicId } : null;
}

function queryStringsForFeature(feature: ReturnType<typeof readPartStudio>["features"][number]) {
  const values: string[] = [];
  for (const parameter of feature.parameters ?? []) {
    if (typeof parameter !== "object" || parameter === null) {
      continue;
    }
    const queries = (parameter as { queries?: unknown }).queries;
    if (!Array.isArray(queries)) {
      continue;
    }
    for (const query of queries) {
      if (typeof query !== "object" || query === null) {
        continue;
      }
      const queryString = (query as { queryString?: unknown }).queryString;
      if (typeof queryString === "string") {
        values.push(queryString);
      }
    }
  }
  return values;
}

function readEvaluatedDepthMm(
  feature: ReturnType<typeof readPartStudio>["features"][number] | undefined,
): number | null {
  for (const parameter of feature?.parameters ?? []) {
    if (typeof parameter !== "object" || parameter === null) {
      continue;
    }
    const record = parameter as { parameterId?: unknown; value?: unknown };
    if (record.parameterId === "depth" && typeof record.value === "number") {
      return record.value * 1000;
    }
  }
  return null;
}

function extractSweptFaceQuery(input: string) {
  const sketchEntityId = input.match(/sketchEntityIdS[a-z]\$([^$]+)/)?.[1] ?? null;
  const extrudeFeatureId = input.match(/S\d+\.\d+\$([^$]+)opExtrude/)?.[1] ?? null;
  return sketchEntityId && extrudeFeatureId
    ? { sketchEntityId, extrudeFeatureId }
    : null;
}

function normalizeVector(
  vector: readonly [number, number, number],
): [number, number, number] | null {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length === 0) {
    return null;
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function inferredSweptFaceSignature(input: {
  feature: ReturnType<typeof readPartStudio>["features"][number];
  read: ReturnType<typeof readPartStudio>;
  plan: OnshapeStudioPlan;
}): OnshapeGeometricSignature | null {
  const query = queryStringsForFeature(input.feature)
    .map(extractSweptFaceQuery)
    .find((candidate): candidate is NonNullable<typeof candidate> => candidate != null);
  if (!query) {
    return null;
  }
  const extrudeFeature = input.read.features.find(
    (entry) => entry.featureId === query.extrudeFeatureId,
  );

  const extrudePlan = input.plan.featurePlans.find(
    (plan) => plan.onshapeFeatureId === query.extrudeFeatureId,
  );
  const extrude = extrudePlan?.plannedExtrude;
  if (!extrude || extrude.extent.mode !== "oneSide" || extrude.extent.end.kind !== "blind") {
    return null;
  }

  const solved = input.read.solvedSketchesByFeatureId.get(extrude.sketchFeatureId);
  const queryEntityBaseId = query.sketchEntityId.match(/^(.+?)R\d+C\d+S\d+$/)?.[1] ?? query.sketchEntityId;
  const curve = solved?.entities.find(
    (entity) =>
      entity.entityId === query.sketchEntityId ||
      entity.entityId === queryEntityBaseId,
  );
  if (!curve?.start3d || !curve.end3d) {
    return null;
  }

  const start: [number, number, number] = curve.start3d.map((component) => component * 1000) as [number, number, number];
  const end: [number, number, number] = curve.end3d.map((component) => component * 1000) as [number, number, number];
  const distanceValue = extrude.extent.end.distance;
  const distance =
    distanceValue.source === "literal"
      ? distanceValue.value
      : readEvaluatedDepthMm(extrudeFeature);
  if (distance == null) {
    return null;
  }
  const direction = extrude.extent.end.direction === "negative" ? -distance : distance;
  const extrudeVector: [number, number, number] = [0, 0, direction];
  const extrudedStart: [number, number, number] = [
    start[0] + extrudeVector[0],
    start[1] + extrudeVector[1],
    start[2] + extrudeVector[2],
  ];
  const extrudedEnd: [number, number, number] = [
    end[0] + extrudeVector[0],
    end[1] + extrudeVector[1],
    end[2] + extrudeVector[2],
  ];
  const edgeVector: [number, number, number] = [
    end[0] - start[0],
    end[1] - start[1],
    end[2] - start[2],
  ];
  const normal = normalizeVector(cross(edgeVector, extrudeVector));
  const xDirection = normalizeVector(edgeVector);
  if (!normal || !xDirection) {
    return null;
  }
  const points = [start, end, extrudedStart, extrudedEnd];
  const low: [number, number, number] = [
    Math.min(...points.map((point) => point[0])),
    Math.min(...points.map((point) => point[1])),
    Math.min(...points.map((point) => point[2])),
  ];
  const high: [number, number, number] = [
    Math.max(...points.map((point) => point[0])),
    Math.max(...points.map((point) => point[1])),
    Math.max(...points.map((point) => point[2])),
  ];
  return {
    entityClass: "face",
    geometryType: "plane",
    definingData: { origin: start, normal, xDirection },
    boundingBox: { low, high },
    centroid: [(low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) / 2],
  };
}

function readCapturedPoint(value: unknown): [number, number, number] | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as { x?: unknown; y?: unknown; z?: unknown };
  return typeof record.x === "number" &&
    typeof record.y === "number" &&
    typeof record.z === "number"
    ? [record.x * 1000, record.y * 1000, record.z * 1000]
    : null;
}

function extractCapturedTessellationPoints(tessellatedFaces: unknown): number[] {
  if (typeof tessellatedFaces !== "object" || tessellatedFaces === null) {
    return [];
  }
  const bodies = (tessellatedFaces as { bodies?: unknown }).bodies;
  if (!Array.isArray(bodies)) {
    return [];
  }
  const points: number[] = [];
  for (const body of bodies) {
    const faces = (body as { faces?: unknown }).faces;
    if (!Array.isArray(faces)) {
      continue;
    }
    for (const face of faces) {
      const facets = (face as { facets?: unknown }).facets;
      if (!Array.isArray(facets)) {
        continue;
      }
      for (const facet of facets) {
        const vertices = (facet as { vertices?: unknown }).vertices;
        if (!Array.isArray(vertices)) {
          continue;
        }
        for (const vertex of vertices) {
          const point = readCapturedPoint(vertex);
          if (point) {
            points.push(...point);
          }
        }
      }
    }
  }
  return points;
}


function verifyGroundTruth(input: {
  hasHistoryCapability: boolean;
  groundTruth: ReturnType<typeof readPartStudio>["studio"]["groundTruth"];
  bakedCount: number;
  probeResult: HistoryProbeResult | null;
}): GroundTruthVerification {
  if (!input.groundTruth.hasBodies) {
    return { status: "noGroundTruth" };
  }
  if (input.bakedCount > 0) {
    return verificationPartial(input.bakedCount);
  }
  if (!input.hasHistoryCapability) {
    return verificationUnavailable(true);
  }
  return compareTessellation(
    { points: input.probeResult?.finalTessellation?.points ?? [] },
    { points: extractCapturedTessellationPoints(input.groundTruth.tessellatedFaces) },
    input.groundTruth.tessellationTolerance * 1000,
  );
}

function recomputePlanWithFeaturePlans(
  basePlan: OnshapeStudioPlan,
  featurePlans: FeaturePlan[],
  hasBodies: boolean,
  read?: ReturnType<typeof readPartStudio>,
): OnshapeStudioPlan {
  const tierCounts = { parametric: 0, baked: 0, geometryOnly: 0 };
  for (const plan of featurePlans) {
    tierCounts[plan.tier] += 1;
  }
  const segmentResult = read && basePlan.bakeStrategy.kind === "segments"
    ? replanStudioBakeStrategy(read, featurePlans)
    : null;
  const bakeStrategy = segmentResult?.strategy ?? basePlan.bakeStrategy;
  return {
    ...basePlan,
    featurePlans,
    tierCounts,
    bakeStrategy,
    bakeDiagnostics: segmentResult?.diagnostics ?? basePlan.bakeDiagnostics,
    requiresStudioBake:
      hasBodies && bakeStrategy.kind === "wholeStudioLegacy",
  };
}

function activateCapturedFrameTranslation(input: {
  read: ReturnType<typeof readPartStudio>;
  plan: OnshapeStudioPlan;
}): OnshapeStudioPlan {
  const references = new Map(
    input.read.studio.resolvedReferences.map((reference) => [
      reference.deterministicId,
      reference,
    ]),
  );
  const featuresById = new Map(
    input.read.features.map((feature) => [feature.featureId, feature]),
  );

  // Recover, per cPlane feature, the captured world-space frame of the
  // construction it produced, discovered through dependent sketches that name
  // `<cPlaneFeatureId>planeOp` in their sketchPlane query. Also record which
  // sketches must rewire their support onto the translated plane.
  const framesByCPlaneFeatureId = new Map<string, SketchPlaneFrame>();
  const cPlaneBySketchFeatureId = new Map<string, string>();
  for (const featurePlan of input.plan.featurePlans) {
    if (
      featurePlan.featureType !== "newSketch" ||
      featurePlan.tier !== "baked" ||
      !featurePlan.reasonCodes.includes("needs-history-probe")
    ) {
      continue;
    }
    const feature = featuresById.get(featurePlan.onshapeFeatureId);
    if (!feature) {
      continue;
    }
    const producingFeatureId = extractSketchPlaneProducingFeatureId(feature);
    const producer = producingFeatureId
      ? featuresById.get(producingFeatureId)
      : undefined;
    if (!producingFeatureId || producer?.featureType !== "cPlane") {
      continue;
    }
    const deterministicId = extractSketchPlaneDeterministicId(feature);
    const reference = deterministicId ? references.get(deterministicId) : undefined;
    if (!reference || !("signature" in reference)) {
      continue;
    }
    const frame = frameFromCapturedSignature(reference.signature);
    if (!frame) {
      continue;
    }
    framesByCPlaneFeatureId.set(producingFeatureId, frame);
    cPlaneBySketchFeatureId.set(featurePlan.onshapeFeatureId, producingFeatureId);
  }

  // Mirror and distance-transform consumers can be the only features that expose
  // a translated cPlane's captured frame, so discover those references too.
  for (const feature of input.read.features) {
    for (const parameterId of ["mirrorPlane", "transformDirection"] as const) {
      const consumed = extractPlaneConsumerReference(feature, parameterId);
      if (!consumed) continue;
      const producer = consumed ? featuresById.get(consumed.featureId) : undefined;
      const reference = consumed ? references.get(consumed.deterministicId) : undefined;
      if (
        producer?.featureType !== "cPlane" ||
        !reference ||
        !("signature" in reference)
      ) {
        continue;
      }
      const frame = frameFromCapturedSignature(reference.signature);
      if (frame) framesByCPlaneFeatureId.set(consumed.featureId, frame);
    }
  }

  const nextPlans = input.plan.featurePlans.map((featurePlan) => {
    // Translate a recoverable cPlane into a parametric plane feature.
    if (
      featurePlan.featureType === "cPlane" &&
      framesByCPlaneFeatureId.has(featurePlan.onshapeFeatureId)
    ) {
      const frame = framesByCPlaneFeatureId.get(featurePlan.onshapeFeatureId)!;
      return {
        ...featurePlan,
        tier: "parametric" as const,
        target: { kind: "plane" as const, frame },
        reasonCodes: ["plane-from-captured-frame" as const],
        suppressed: false,
      };
    }
    // Rewire a sketch onto the translated plane through a deferred construction.
    const cPlaneFeatureId = cPlaneBySketchFeatureId.get(
      featurePlan.onshapeFeatureId,
    );
    if (cPlaneFeatureId) {
      const frame = framesByCPlaneFeatureId.get(cPlaneFeatureId)!;
      const plane: SketchPlaneDefinition = {
        // Placeholder support: the provider substitutes a `constructionOf`
        // reference to the translated plane feature at prepare time. This id is
        // never emitted in a prepared action.
        support: {
          kind: "construction",
          constructionId: `construction_pending_${cPlaneFeatureId}` as ConstructionId,
        },
        frame,
        key: null,
      };
      return {
        ...featurePlan,
        tier: "parametric" as const,
        target: {
          kind: "sketch" as const,
          planeKey: "xy" as const,
          plane,
          constructionFromFeatureId: cPlaneFeatureId,
        },
        reasonCodes: ["sketch-on-translated-plane" as const],
        suppressed: false,
      };
    }
    return featurePlan;
  });

  const sketchPlansByFeatureId = new Map(
    nextPlans.flatMap((plan) =>
      plan.target.kind === "sketch"
        ? [[plan.onshapeFeatureId, {
            tier: plan.tier,
            planeKey: plan.target.planeKey,
            planeFrame: plan.target.plane?.frame ?? plan.target.capturedFrame,
          }] as const]
        : [],
    ),
  );
  const replanned = nextPlans.map((plan, index) => {
    if (plan.featureType !== "loft") return plan;
    const feature = input.read.features[index];
    if (!feature) return plan;
    return onshapeFeatureTranslatorRegistry.forFeatureType("loft").plan({
      feature,
      label: plan.label,
      onshapeSuppressed: feature.suppressed === true,
      read: input.read,
      references: new Map(),
      state: {
        sketchPlansByFeatureId,
        bodyProducingFeatureIds: [],
      },
    });
  });
  return recomputePlanWithFeaturePlans(
    input.plan,
    replanned,
    input.read.studio.groundTruth.hasBodies,
    input.read,
  );
}

function isCapturedFrameTranslation(plan: FeaturePlan): boolean {
  return (
    plan.tier === "parametric" &&
    (plan.reasonCodes.includes("plane-from-captured-frame") ||
      plan.reasonCodes.includes("sketch-on-translated-plane") ||
      plan.reasonCodes.includes("sketch-on-captured-frame"))
  );
}

function demoteCapturedFrameToBaked(plan: FeaturePlan): FeaturePlan {
  return {
    ...plan,
    tier: "baked",
    target: { kind: "suppressed" },
    reasonCodes: ["captured-frame-unresolvable"],
    suppressed: true,
  };
}

async function activateProbeBackedPlanning(input: {
  read: ReturnType<typeof readPartStudio>;
  plan: ReturnType<typeof planStudioFidelity>;
  capabilities: ImportCapabilities;
}) {
  if (!input.capabilities.history) {
    return { plan: input.plan, probeResult: null };
  }

  let workingPlan: OnshapeStudioPlan = input.plan;
  let probeResult: HistoryProbeResult;
  const maxDemotions = input.plan.featurePlans.filter(isCapturedFrameTranslation).length;
  for (let attempt = 0; ; attempt += 1) {
    const orderedPositionToFeatureId = new Map<number, string>();
    const candidate = await buildPreparedActions({
      read: input.read,
      plan: workingPlan,
      capabilities: input.capabilities,
      materializeBake: false,
      orderedPositionToFeatureId,
    });
    // This full-plan probe is retained only for verification and attribution of a
    // failed provisional action. Topology consumers are resolved below from exact
    // pre-consumer prefixes.
    probeResult = await input.capabilities.history.evaluateHistoryProbe({
      actions: candidate,
      includeFinalTessellation: true,
    });
    const failedOrdinal = probeResult.steps.findIndex((step) => step.status === "failed");
    if (failedOrdinal < 0 || attempt > maxDemotions) break;
    const failedFeatureId = orderedPositionToFeatureId.get(failedOrdinal);
    const demotable = failedFeatureId
      ? workingPlan.featurePlans.find(
          (plan) =>
            plan.onshapeFeatureId === failedFeatureId &&
            isCapturedFrameTranslation(plan),
        )
      : undefined;
    if (!demotable) break;
    workingPlan = recomputePlanWithFeaturePlans(
      workingPlan,
      workingPlan.featurePlans.map((plan) =>
        isCapturedFrameTranslation(plan) ? demoteCapturedFrameToBaked(plan) : plan,
      ),
      input.read.studio.groundTruth.hasBodies,
      input.read,
    );
  }

  const topologyTimeline = createRollbackTopologyTimeline({
    featureIds: input.read.features.map((feature) => feature.featureId),
    snapshots: input.read.studio.rollbackSnapshots,
  });
  const featuresById = new Map(
    input.read.features.map((feature) => [feature.featureId, feature]),
  );
  const references = new Map<string, OnshapeResolvedReference[]>();
  for (const reference of input.read.studio.resolvedReferences) {
    const existing = references.get(reference.deterministicId) ?? [];
    existing.push(reference);
    references.set(reference.deterministicId, existing);
  }

  const planFingerprint = (plan: OnshapeStudioPlan): string =>
    JSON.stringify({
      featurePlans: plan.featurePlans,
      bakeStrategy: plan.bakeStrategy,
      requiresStudioBake: plan.requiresStudioBake,
    });

  const maxPromotionIterations = Math.max(1, workingPlan.featurePlans.length);
  for (let iteration = 0; iteration < maxPromotionIterations; iteration += 1) {
    const beforeIteration = planFingerprint(workingPlan);

    // Resolve translator-declared topology consumers in source order. Each successful
    // consumer is inserted before probing the next one, preserving the exact prefix.
    for (const candidate of [...workingPlan.featurePlans]) {
      const slots =
        candidate.plannedBodyTopologyConsumer?.slots ??
        candidate.plannedExtrude?.topologySlots ??
        [];
      // A parametric extrude planned from initial fidelity still enters the loop
      // with an unresolved boolean scope (extrude-planner seeds
      // `topologyTargets` with empty `targets`); its target body must be matched
      // against the parametric prefix here or the applied extrude has no body to
      // cut. Only skip parametric candidates whose topology is already resolved,
      // which also keeps the fixed-point from re-resolving a settled consumer.
      const hasUnresolvedExtrudeTopology =
        candidate.plannedExtrude?.boolean.kind === "topologyTargets" &&
        candidate.plannedExtrude.boolean.targets.length === 0;
      if (
        slots.length === 0 ||
        (candidate.tier === "parametric" && !hasUnresolvedExtrudeTopology)
      ) {
        continue;
      }
      const feature = featuresById.get(candidate.onshapeFeatureId);
      if (!feature) continue;
      const queryRead = readTopologyQueryRefs(feature, slots);
      // Onshape's rollback timeline names every feature that produced or reshaped
      // each queried body before the consumer. When any of them is not parametric,
      // the body as consumed cannot exist in the parametric prefix: the consumer
      // is baked by design, not by a matching failure.
      const plansById = new Map(
        workingPlan.featurePlans.map((plan) => [plan.onshapeFeatureId, plan]),
      );
      const consumesBakedUpstreamBody = queryRead.refs.some((query) =>
        topologyTimeline
          .featuresModifyingBody(query.deterministicId, candidate.onshapeFeatureId)
          .some((featureId) => plansById.get(featureId)?.tier !== "parametric"),
      );
      // A topology candidate must be allowed to close the baked run immediately
      // before itself. Recompute only the checkpoint strategy provisionally; the
      // candidate remains baked in the prepared prefix until exact matching proves
      // its live refs. This breaks the old chicken-and-egg where a candidate was
      // rejected because the checkpoint that would make it reachable was planned
      // only after the still-baked candidate.
      const provisionalPlan = workingPlan.bakeStrategy.kind === "segments"
        ? recomputePlanWithFeaturePlans(
            workingPlan,
            workingPlan.featurePlans.map((plan) =>
              plan.onshapeFeatureId === candidate.onshapeFeatureId
                ? {
                    ...plan,
                    tier: "parametric" as const,
                    target: { kind: "feature" as const },
                    reasonCodes: [],
                    suppressed: false,
                  }
                : plan,
            ),
            input.read.studio.groundTruth.hasBodies,
            input.read,
          )
        : workingPlan;
      const prefixPlan: OnshapeStudioPlan = {
        ...workingPlan,
        bakeStrategy: provisionalPlan.bakeStrategy,
        requiresStudioBake: provisionalPlan.requiresStudioBake,
        bakeDiagnostics: provisionalPlan.bakeDiagnostics,
      };
      const degradeConsumer = (reason: PlanReasonCode) => {
        workingPlan = recomputePlanWithFeaturePlans(
          workingPlan,
          workingPlan.featurePlans.map((plan) =>
            plan.onshapeFeatureId === candidate.onshapeFeatureId
              ? { ...plan, reasonCodes: [reason], suppressed: true }
              : plan,
          ),
          input.read.studio.groundTruth.hasBodies,
          input.read,
        );
      };
      // Bake checkpoints (bodyOnlyMesh) expose only body identity, so they can
      // only serve whole-body consumers. A face/edge consumer needs sub-topology
      // (a specific face or edge) of its owning body; a tessellation-backed
      // checkpoint body cannot expose that, and apply rebuilds the consumer on
      // exactly that checkpoint body (not on the pre-checkpoint parametric
      // bodies). So the probe prefix emits checkpoints only for whole-body
      // consumers, and those are the only consumers over a baked body that can
      // be recovered.
      const consumesOnlyBodies =
        queryRead.refs.length > 0 &&
        queryRead.refs.every(
          (query) =>
            query.expectedKinds.length === 1 && query.expectedKinds[0] === "body",
        );
      if (
        consumesBakedUpstreamBody &&
        prefixPlan.bakeStrategy.kind !== "segments"
      ) {
        degradeConsumer("topology-upstream-baked");
        continue;
      }
      const featureIdToOrderedPrefixPosition = new Map<string, number>();
      const prefixActions = await buildPreparedActions({
        read: input.read,
        plan: prefixPlan,
        capabilities: input.capabilities,
        materializeBake: false,
        emitBakeCheckpoints: consumesOnlyBodies,
        featureIdToOrderedPrefixPosition,
      });
      const [prefix] = await probeTopologyConsumerPrefixes({
        actions: prefixActions,
        featureIdToOrderedPrefixPosition,
        consumerFeatureIds: [candidate.onshapeFeatureId],
        history: input.capabilities.history,
      });
      if (!prefix || prefix.status === "failed") {
        // The parametric prefix itself did not rebuild in the probe session, so no
        // safe pre-consumer evidence exists in the Cadara prefix. Report that
        // instead of silently falling through to the translator-unavailable rewrite.
        degradeConsumer("topology-history-evidence-missing");
        continue;
      }
      const captureFrameToWorld = computeCaptureFrameToWorld({
        features: input.read.features,
        consumerFeatureId: candidate.onshapeFeatureId,
        isParametric: (featureId) => plansById.get(featureId)?.tier === "parametric",
        resolvedReferences: input.read.studio.resolvedReferences,
      });
      if (captureFrameToWorld && !consumesOnlyBodies) {
        // A non-identity capture→world transform means a baked (checkpoint)
        // feature sits between this face/edge consumer and its captured
        // evidence. The probe prefix (checkpoints suppressed for face/edge
        // consumers) matches the still-parametric pre-checkpoint body, but apply
        // rebuilds the consumer on the tessellation-backed checkpoint body,
        // which exposes only body identity — never the specific face/edge. So
        // reframing lets review match a body that apply never presents,
        // over-promoting the consumer. Stay honestly baked: recovering it needs
        // the owning feature to be parametric (e.g. Mounts Chamfer 1 is gated on
        // W.3 Transform rotation), not a reframe against the wrong prefix.
        degradeConsumer("topology-upstream-baked");
        continue;
      }
      const resolution = resolveTopologyReferences({
        consumerFeatureId: candidate.onshapeFeatureId,
        queries: queryRead.refs,
        queryDiagnostics: queryRead.diagnostics,
        capturedReferences: input.read.studio.resolvedReferences,
        rollback: topologyTimeline,
        cadaraSignatures: prefix.signatures,
        tolerance: { ...DEFAULT_MATCH_TOLERANCE, linear: Math.max(DEFAULT_MATCH_TOLERANCE.linear, 0.01) },
        durableNamingAvailable: OCC_KERNEL_CAPABILITIES.supportsDurableTopologyNaming,
        captureFrameToWorld: captureFrameToWorld ?? undefined,
      });
      workingPlan = recomputePlanWithFeaturePlans(
        workingPlan,
        workingPlan.featurePlans.map((plan) => {
          if (plan.onshapeFeatureId !== candidate.onshapeFeatureId) return plan;
          if (resolution.kind === "degraded") {
            return { ...plan, reasonCodes: [resolution.reason], suppressed: true };
          }
          if (candidate.plannedBodyTopologyConsumer?.unavailableReason) {
            return {
              ...plan,
              reasonCodes: [candidate.plannedBodyTopologyConsumer.unavailableReason],
              suppressed: true,
            };
          }
          if (candidate.plannedExtrude) {
            const plannedExtrude = resolvePlannedExtrudeTopology(
              candidate.plannedExtrude,
              resolution.bindings,
            );
            return plannedExtrude
              ? {
                  ...plan,
                  tier: "parametric" as const,
                  target: { kind: "feature" as const },
                  reasonCodes: [],
                  suppressed: false,
                  plannedExtrude,
                }
              : { ...plan, reasonCodes: ["topology-query-unreadable"], suppressed: true };
          }
          return {
            ...plan,
            tier: "parametric" as const,
            target: { kind: "feature" as const },
            reasonCodes: [],
            suppressed: false,
            plannedAdvancedSolid: buildResolvedBodyConsumerDefinition(
              candidate.plannedBodyTopologyConsumer!,
              resolution.bindings,
            ),
          };
        }),
        input.read.studio.groundTruth.hasBodies,
        input.read,
      );
    }

    const consumerIds = workingPlan.featurePlans
      .filter(
        (featurePlan) =>
          featurePlan.featureType === "newSketch" &&
          featurePlan.tier === "baked" &&
          featurePlan.reasonCodes.includes("needs-history-probe"),
      )
      .map((featurePlan) => featurePlan.onshapeFeatureId);
    const sketchConsumerIds = new Set(consumerIds);
    const provisionalSketchPlan = workingPlan.bakeStrategy.kind === "segments"
      ? recomputePlanWithFeaturePlans(
          workingPlan,
          workingPlan.featurePlans.map((featurePlan) =>
            sketchConsumerIds.has(featurePlan.onshapeFeatureId)
              ? {
                  ...featurePlan,
                  tier: "parametric" as const,
                  target: { kind: "sketch" as const, planeKey: "xy" as const },
                  reasonCodes: [],
                  suppressed: false,
                }
              : featurePlan,
          ),
          input.read.studio.groundTruth.hasBodies,
          input.read,
        )
      : workingPlan;
    const sketchPrefixPlan: OnshapeStudioPlan = {
      ...workingPlan,
      bakeStrategy: provisionalSketchPlan.bakeStrategy,
      requiresStudioBake: provisionalSketchPlan.requiresStudioBake,
      bakeDiagnostics: provisionalSketchPlan.bakeDiagnostics,
    };
    const featureIdToOrderedPrefixPosition = new Map<string, number>();
    const prefixActions = await buildPreparedActions({
      read: input.read,
      plan: sketchPrefixPlan,
      capabilities: input.capabilities,
      materializeBake: false,
      featureIdToOrderedPrefixPosition,
    });
    const prefixResults = await probeTopologyConsumerPrefixes({
      actions: prefixActions,
      featureIdToOrderedPrefixPosition,
      consumerFeatureIds: consumerIds,
      history: input.capabilities.history,
    });
    const prefixSignatures = new Map(
      prefixResults.map((result) => [result.consumerFeatureId, result.signatures]),
    );
    const nextPlans: FeaturePlan[] = workingPlan.featurePlans.map((featurePlan) => {
      if (
        featurePlan.featureType !== "newSketch" ||
        featurePlan.tier !== "baked" ||
        !featurePlan.reasonCodes.includes("needs-history-probe")
      ) {
        if (
          featurePlan.reasonCodes.includes("needs-history-probe") &&
          featurePlan.featureType !== "newSketch"
        ) {
          return {
            ...featurePlan,
            reasonCodes: featurePlan.reasonCodes.map((reason) =>
              reason === "needs-history-probe" ? "translator-unavailable" : reason,
            ),
          };
        }
        return featurePlan;
      }

      if (!OCC_KERNEL_CAPABILITIES.supportsDurableTopologyNaming) {
        return {
          ...featurePlan,
          reasonCodes: ["topology-durable-naming-unavailable"],
        };
      }

      const probeSignatures = prefixSignatures.get(featurePlan.onshapeFeatureId) ?? [];
      const feature = featuresById.get(featurePlan.onshapeFeatureId);
      const deterministicId = feature ? extractSketchPlaneDeterministicId(feature) : null;
      const records = deterministicId ? references.get(deterministicId) ?? [] : [];
      const historyReference = feature
        ? records.find(
            (record) =>
              record.evaluatedAt === "historyPoint" &&
              record.consumingFeatureId === feature.featureId &&
              "signature" in record,
          ) ??
          records.find(
            (record) => record.evaluatedAt === "historyPoint" && "signature" in record,
          )
        : undefined;
      const finalStateReference = records.find(
        (record) => record.evaluatedAt === "finalState" && "signature" in record,
      );
      if (!historyReference && finalStateReference) {
        return {
          ...featurePlan,
          reasonCodes: ["sketch-face-on-checkpoint-body"],
        };
      }
      const reference = historyReference ?? finalStateReference;
      const capturedSignature =
        reference && "signature" in reference
          ? normalizeOnshapeTopologySignature(reference.signature)
          : feature
            ? inferredSweptFaceSignature({
                feature,
                read: input.read,
                plan: workingPlan,
              })
            : null;
      if (!capturedSignature) return featurePlan;
      const match = matchSignature(capturedSignature, probeSignatures);
      const matchedReference = match.kind === "unique"
        ? match.reference
        : match.kind === "ambiguous" && historyReference
          ? match.candidates[0]?.reference
          : undefined;
      if (!matchedReference) return featurePlan;
      const probeSignature = probeSignatures.find(
        (signature) => referenceKey(signature.reference) === referenceKey(matchedReference),
      );
      const plane = probeSignature ? planeFromProbeSignature(probeSignature) : null;
      if (!plane) return featurePlan;
      const probedFaceSelector: ImportDeferredTopologyRef = {
        kind: "topologyOf",
        expectedKind: "face",
        capturedSignature,
        tolerance: {
          ...DEFAULT_MATCH_TOLERANCE,
          linear: Math.max(DEFAULT_MATCH_TOLERANCE.linear, 0.01),
        },
        source: {
          consumerFeatureId: featurePlan.onshapeFeatureId,
          parameterId: "sketchPlane",
          deterministicId: deterministicId ?? referenceKey(matchedReference),
        },
      };
      return {
        ...featurePlan,
        tier: "parametric" as const,
        target: {
          kind: "sketch" as const,
          planeKey: "xy" as const,
          plane,
          probedFaceSelector,
        },
        reasonCodes: ["sketch-on-probed-face" as const],
        suppressed: false,
      };
    });

    workingPlan = recomputePlanWithFeaturePlans(
      workingPlan,
      nextPlans,
      input.read.studio.groundTruth.hasBodies,
      input.read,
    );

    if (planFingerprint(workingPlan) === beforeIteration) break;
  }

  return { plan: workingPlan, probeResult };
}

async function reviewStudio(
  bundle: OnshapeCaptureBundle,
  elementId: string,
  capabilities: ImportCapabilities,
): Promise<OnshapeStudioReview> {
  const read = readPartStudio(bundle, elementId);
  const planned = planStudioFidelity(read, {
    captureFormatVersion: bundle.formatVersion,
    historyProbeAvailable: capabilities.history != null,
  });
  const basePlan =
    bundle.formatVersion === 1 || read.studio.rollbackSnapshots === null
      ? recomputePlanWithFeaturePlans(
          planned,
          planned.featurePlans.map((featurePlan) =>
            featurePlan.reasonCodes.includes("needs-history-probe")
              ? {
                  ...featurePlan,
                  reasonCodes: [
                    ...featurePlan.reasonCodes,
                    "topology-history-evidence-missing" as const,
                    "topology-bake-snapshot-missing" as const,
                  ],
                }
              : featurePlan,
          ),
          read.studio.groundTruth.hasBodies,
        )
      : planned;
  // Captured-frame translation emits a real plane feature and rewires dependent
  // sketches onto it through a deferred construction reference. A history probe
  // validates the plane→sketch chain against the real kernel and demotes it back
  // to baked if it does not resolve, so we only translate when a probe exists.
  const capturedFramePlan = capabilities.history
    ? activateCapturedFrameTranslation({ read, plan: basePlan })
    : basePlan;
  const activation = await activateProbeBackedPlanning({
    read,
    plan: capturedFramePlan,
    capabilities,
  });
  const { plan, probeResult } = activation;
  const sketchRelationshipSummaries = plan.featurePlans
    .map((featurePlan) => {
      const translation = projectSketchForPlan({ read, featurePlan });
      return translation
        ? {
            featureId: featurePlan.onshapeFeatureId,
            label: featurePlan.label,
            summary: translation.relationshipSummary,
          }
        : null;
    })
    .filter(
      (summary): summary is OnshapeSketchRelationshipReview => summary !== null,
    );
  const bakedCount = plan.featurePlans.filter((entry) => entry.tier === "baked").length;
  return {
    elementId: read.studio.elementId,
    name: read.studio.name,
    hasBodies: read.studio.groundTruth.hasBodies,
    featurePlans: plan.featurePlans,
    tierCounts: plan.tierCounts,
    bakeStrategy: plan.bakeStrategy,
    bakeDiagnostics: plan.bakeDiagnostics,
    requiresStudioBake: plan.requiresStudioBake,
    sketchRelationshipSummaries,
    verification: verifyGroundTruth({
      hasHistoryCapability: capabilities.history != null,
      groundTruth: read.studio.groundTruth,
      bakedCount,
      probeResult,
    }),
  };
}

function extractVariable(
  parameters: readonly unknown[] | undefined,
): { name: string; expression: string | null } | null {
  let name: string | null = null;
  let expression: string | null = null;
  for (const parameter of parameters ?? []) {
    if (typeof parameter !== "object" || parameter === null) {
      continue;
    }
    const parameterId = (parameter as { parameterId?: unknown }).parameterId;
    const raw = parameter as { value?: unknown; expression?: unknown };
    if (parameterId === "name" && typeof raw.value === "string") {
      name = raw.value;
    }
    // Only the authored expression text is trusted; the captured evaluated
    // value is intentionally ignored (it can be absent/zero in the bundle).
    if (parameterId === "value" && typeof raw.expression === "string") {
      expression = raw.expression;
    }
  }
  return name ? { name, expression } : null;
}

function summaryField(id: string, label: string, value: string): FeatureEditorFormField {
  return { kind: "summary", id, label, value };
}

const REVIEW_REASON_COPY: Record<PlanReasonCode, string> = {
  "sketch-on-canonical-plane": "sketch is supported on a canonical plane",
  "document-variable": "document variable was translated",
  "needs-region-resolution": "sketch region could not be resolved",
  "needs-history-probe": "requires captured history topology evidence",
  "extrude-default-scope-ambiguous": "default extrude scope affects more than one possible body",
  "sketch-on-probed-face": "sketch is supported on a resolved face",
  "sketch-face-on-checkpoint-body": "sketch plane face exists only on checkpoint-baked body geometry",
  "sketch-on-captured-frame": "sketch is supported from its captured frame",
  "plane-from-captured-frame": "plane was translated from its captured frame",
  "sketch-on-translated-plane": "sketch is supported on a translated plane",
  "captured-frame-unresolvable": "captured frame could not be resolved",
  "translator-unavailable": "no translator is available for this feature",
  "custom-feature": "custom feature is not supported",
  "unsupported-feature": "feature type is not supported",
  "downstream-of-baked": "depends on previously baked geometry",
  "unreadable-feature": "feature parameters could not be read",
  "revolve-operation-unsupported": "revolve operation or boolean body scope could not be represented",
  "revolve-body-type-unsupported": "revolve body type is not supported",
  "revolve-profile-unresolved": "revolve profile could not be resolved as parametric sketch regions",
  "revolve-axis-unresolved": "revolve axis could not be resolved as a supported sketch line",
  "revolve-extent-unsupported": "revolve extent could not be represented",
  "thicken-requires-topology": "thicken requires face topology that cannot be materialized",
  "sweep-path-unresolved": "sweep path must resolve to exactly one solved line, arc, or circle in another parametric sketch",
  "loft-profile-unresolved": "each ordered loft profile must resolve to exactly one region on a parametric sketch",
  "loft-guides-unsupported": "loft guide curves are not supported by the simple-form translator",
  "loft-conditions-unsupported": "loft start and end conditions must use their defaults",
  "loft-periodicity-unsupported": "periodic lofts are not supported by the simple-form translator",
  "boolean-offset-unsupported": "boolean offset is not supported",
  "boolean-operation-unsupported": "boolean operation is not supported",
  "mirror-operation-unsupported": "mirror operation is not supported",
  "mirror-plane-unresolved": "mirror plane could not be resolved",
  "transform-copy-unsupported": "transform copy mode is not supported",
  "transform-rotation-unsupported": "transform rotation is not supported",
  "transform-translation-unreadable": "transform translation could not be read",
  "transform-reference-unresolved": "transform reference could not be resolved",
  "transform-type-unsupported": "transform type is not supported",
  "split-face-tool-unsupported": "split with a face tool is not supported",
  "split-one-side-unsupported": "one-sided split results are not supported",
  "topology-query-unreadable": "topology selection query could not be read",
  "topology-history-evidence-missing": "captured history topology evidence is missing",
  "topology-source-query-unresolved": "topology source query could not be resolved",
  "topology-source-kind-mismatch": "topology selection has the wrong kind",
  "topology-reference-no-match": "topology reference did not match",
  "topology-reference-ambiguous": "topology reference matched more than one target",
  "topology-durable-naming-unavailable": "feature is understood, but durable topology naming is not qualified",
  "topology-upstream-baked": "topology source depends on baked geometry",
  "topology-apply-rematch-failed": "topology reference could not be rematched while applying",
  "topology-bake-snapshot-missing": "rollback bake snapshot is missing",
  "bake-segment-boundary-snapshot-missing": "bake segment boundary snapshot is missing",
  "bake-segment-boundary-tessellation-unreadable": "bake segment boundary tessellation is unreadable",
  "bake-segment-body-unreachable": "bake segment body is not reachable from the current checkpoint ledger",
  "bake-segment-body-attribution-ambiguous": "bake segment body attribution is ambiguous",
  "bake-segment-replacement-scope-unresolved": "bake segment replacement scope could not be proved",
  "bake-segment-empty-output-unsupported": "deletion-only bake segment cannot be represented",
  "fillet-radius-unreadable": "fillet radius could not be read",
  "chamfer-method-unsupported": "chamfer method is not supported",
  "chamfer-style-unsupported": "chamfer style is not supported",
  "chamfer-direction-overrides-unsupported": "chamfer direction overrides are not supported",
  "chamfer-width-unreadable": "chamfer width could not be read",
  "shell-non-hollow-unsupported": "non-hollow shell is not supported",
  "shell-hollow-without-openings": "hollow shell without removed faces is not supported",
  "shell-thickness-unreadable": "shell thickness could not be read",
  "hole-style-unsupported": "hole style is not supported",
  "hole-diameter-unreadable": "hole diameter could not be read",
  "hole-executor-unavailable": "hole is understood, but OCC has no hole executor",
  "sheet-metal-unsupported": "sheet metal is not supported parametrically",
  "surface-modeling-unsupported": "surface modeling is not supported parametrically",
  "curve-modeling-unsupported": "curve modeling is not supported parametrically",
  "primitive-unsupported": "this primitive is outside the importer scope",
  "annotation-meta-unsupported": "annotation or metadata is not modeled",
  "part-operation-unsupported": "this part operation is outside the importer scope",
  "pattern-unsupported": "this pattern family is outside the importer scope",
  "tolerance-unsupported": "tolerance metadata is not modeled",
};

function reviewReasonCopy(reason: PlanReasonCode): string {
  return REVIEW_REASON_COPY[reason];
}

function featureLabelById(studio: OnshapeStudioReview, featureId: string): string {
  return studio.featurePlans.find((plan) => plan.onshapeFeatureId === featureId)?.label ?? featureId;
}

function bakeStrategyReviewValue(studio: OnshapeStudioReview): string {
  switch (studio.bakeStrategy.kind) {
    case "none":
      return "None — no baked-body checkpoints are required.";
    case "segments":
      return `Segmented — ${studio.bakeStrategy.segments.length} baked-body checkpoint${studio.bakeStrategy.segments.length === 1 ? "" : "s"}.`;
    case "wholeStudioLegacy": {
      const reason = {
        "capture-v1": "capture format v1 has no rollback checkpoints",
        "rollback-snapshots-absent": "rollback snapshots are absent",
        "history-probe-unavailable": "exact-prefix history probing is unavailable",
        "segment-preflight-failed": "segment preflight could not prove a safe checkpoint",
      }[studio.bakeStrategy.reason];
      return `Legacy whole-studio bake — ${reason}.`;
    }
  }
}

function bodySetReviewValue(bodyIds: readonly string[]): string {
  return bodyIds.length > 0 ? bodyIds.join(", ") : "none";
}

function downstreamParametricLabels(
  studio: OnshapeStudioReview,
  segment: Extract<StudioPlan["bakeStrategy"], { kind: "segments" }>["segments"][number],
): string[] {
  const satisfiedProducerIds = new Set([
    ...segment.featureIds,
    ...segment.replacementProducerFeatureIds,
  ]);
  return studio.featurePlans
    .filter((plan) =>
      plan.tier === "parametric" &&
      plan.inputDependencies.some(
        (dependency) =>
          dependency.kind === "body" && satisfiedProducerIds.has(dependency.featureId),
      )
    )
    .map((plan) => plan.label);
}

function bakeSegmentFields(studio: OnshapeStudioReview): FeatureEditorFormField[] {
  const fields: FeatureEditorFormField[] = [
    summaryField("bake-strategy", "Strategy", bakeStrategyReviewValue(studio)),
    summaryField(
      "bake-checkpoint-count",
      "Checkpoint summary",
      `${studio.bakeStrategy.kind === "segments" ? studio.bakeStrategy.segments.length : 0} checkpoint${studio.bakeStrategy.kind === "segments" && studio.bakeStrategy.segments.length === 1 ? "" : "s"}; ${studio.tierCounts.parametric} parametric, ${studio.tierCounts.baked} baked, ${studio.tierCounts.geometryOnly} geometry-only features.`,
    ),
  ];

  if (studio.bakeStrategy.kind === "segments") {
    studio.bakeStrategy.segments.forEach((segment, index) => {
      const downstream = downstreamParametricLabels(studio, segment);
      fields.push(summaryField(
        `bake-segment-${index + 1}`,
        `Checkpoint ${index + 1} — ${featureLabelById(studio, segment.boundaryFeatureId)}`,
        `Feature span: ${featureLabelById(studio, segment.fromFeatureId)} → ${featureLabelById(studio, segment.toFeatureId)}; output bodies: ${bodySetReviewValue(segment.checkpointBodyDeterministicIds)}; consumed: ${bodySetReviewValue(segment.consumedBodyDeterministicIds)}; carried: ${bodySetReviewValue(segment.carriedBodyDeterministicIds)}; replaces ${segment.replacementProducerFeatureIds.length} prior producer action${segment.replacementProducerFeatureIds.length === 1 ? "" : "s"}; downstream parametric continuation: ${downstream.length > 0 ? downstream.join(", ") : "none declared"}; tessellation-backed checkpoint; preflight limitations: none.`,
      ));
    });
  }

  for (const diagnostic of studio.bakeDiagnostics) {
    fields.push(summaryField(
      `bake-diagnostic-${diagnostic.segmentId}-${diagnostic.featureId}`,
      `Checkpoint limitation — ${featureLabelById(studio, diagnostic.featureId)}`,
      `${reviewReasonCopy(diagnostic.code)}. ${diagnostic.message}`,
    ));
  }
  return fields;
}

function reviewFeatureDiagnostic(plan: FeaturePlan, studio: OnshapeStudioReview): string {
  const status = plan.suppressed ? " (suppressed)" : "";
  const reasons = plan.reasonCodes.length > 0
    ? plan.reasonCodes.map(reviewReasonCopy).join("; ")
    : "translated parametrically";
  const segment = studio.bakeStrategy.kind === "segments"
    ? studio.bakeStrategy.segments.find((candidate) =>
        candidate.featureIds.includes(plan.onshapeFeatureId)
      )
    : undefined;
  const segmentIndex = segment && studio.bakeStrategy.kind === "segments"
    ? studio.bakeStrategy.segments.indexOf(segment) + 1
    : 0;
  const segmentStatus = segment
    ? plan.tier === "baked"
      ? ` — represented by bake segment ${segmentIndex}; intrinsic reason retained above`
      : plan.suppressed
        ? ` — source-suppressed in bake segment ${segmentIndex}; no checkpoint geometry created for this row`
        : plan.target.kind === "variable" || plan.target.kind === "sketch" || plan.target.kind === "plane"
          ? ` — pass-through in bake segment ${segmentIndex}; no checkpoint geometry created for this row`
          : ""
    : "";
  const dependencySegment = studio.bakeStrategy.kind === "segments"
    ? studio.bakeStrategy.segments.find((candidate) => {
        const producerIds = new Set([
          ...candidate.featureIds,
          ...candidate.replacementProducerFeatureIds,
        ]);
        return plan.tier === "parametric" && plan.inputDependencies.some(
          (dependency) =>
            dependency.kind === "body" && producerIds.has(dependency.featureId),
        );
      })
    : undefined;
  const dependencyStatus = dependencySegment && studio.bakeStrategy.kind === "segments"
    ? ` — body dependency satisfied by checkpoint ${studio.bakeStrategy.segments.indexOf(dependencySegment) + 1} (${dependencySegment.segmentId})`
    : "";
  return `${plan.tier}${status} — ${reasons}${segmentStatus}${dependencyStatus}`;
}

function sanitizeCorrelationPart(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]/g, "_");
}

function projectSketchForPlan(input: {
  read: ReturnType<typeof readPartStudio>;
  featurePlan: FeaturePlan;
}): ReturnType<typeof translateSketch> | null {
  if (input.featurePlan.target.kind !== "sketch") {
    return null;
  }
  const feature = input.read.features.find(
    (candidate) => candidate.featureId === input.featurePlan.onshapeFeatureId,
  );
  const planeKey = input.featurePlan.target.planeKey;
  const plane = input.featurePlan.target.plane ??
    (input.featurePlan.target.capturedFrame
      ? {
          support: {
            kind: "construction" as const,
            constructionId: `construction_pending_${input.featurePlan.onshapeFeatureId}` as ConstructionId,
          },
          frame: input.featurePlan.target.capturedFrame,
          key: null,
        }
      : undefined);
  const solved = input.read.solvedSketchesByFeatureId.get(
    input.featurePlan.onshapeFeatureId,
  );
  const entities: SolvedSketchEntityGeometry[] = (solved?.entities ?? []).map(
    (curve) => ({
      entityId: curve.entityId,
      entityType: curve.entityType,
      isConstruction: curve.isConstruction,
      start: curve.start3d
        ? plane
          ? projectPointToSketchPlane(curve.start3d, plane)
          : projectPointToPlane(curve.start3d, planeKey)
        : undefined,
      end: curve.end3d
        ? plane
          ? projectPointToSketchPlane(curve.end3d, plane)
          : projectPointToPlane(curve.end3d, planeKey)
        : undefined,
      center: curve.center3d
        ? plane
          ? projectPointToSketchPlane(curve.center3d, plane)
          : projectPointToPlane(curve.center3d, planeKey)
        : undefined,
      radius: curve.radius === undefined ? undefined : curve.radius * 1000,
    }),
  );
  return translateSketch({
    featureId: input.featurePlan.onshapeFeatureId,
    label: input.featurePlan.label,
    planeKey,
    plane,
    entities,
    constraints: feature?.constraints,
    sourceSolveStatus: solved?.sketchSolveStatus,
  });
}

type OnshapeStudioPlan = Pick<
  ReturnType<typeof planStudioFidelity>,
  | "featurePlans"
  | "tierCounts"
  | "bakeStrategy"
  | "bakeDiagnostics"
  | "requiresStudioBake"
>;

function resolvePlannedConstructionParticipants(
  definition: ImportDeferredFeatureDefinition,
  orderedIndexByFeatureId: ReadonlyMap<string, number>,
): { definition: ImportDeferredFeatureDefinition; missingFeatureId: null } | {
  definition: null;
  missingFeatureId: string;
} {
  const parameters = definition.parameters as {
    participants?: readonly { role: string; targets: readonly unknown[] }[];
  };
  if (!parameters.participants) return { definition, missingFeatureId: null };

  let missingFeatureId: string | null = null;
  const participants = parameters.participants.map((participant) => ({
    ...participant,
    targets: participant.targets.map((target) => {
      if (
        !target ||
        typeof target !== "object" ||
        (target as { kind?: unknown }).kind !== "constructionFromFeature"
      ) {
        return target;
      }
      const featureId = (target as { featureId?: unknown }).featureId;
      const actionIndex =
        typeof featureId === "string"
          ? orderedIndexByFeatureId.get(featureId)
          : undefined;
      if (typeof featureId !== "string" || actionIndex === undefined) {
        missingFeatureId = typeof featureId === "string" ? featureId : "unknown";
        return target;
      }
      return { kind: "constructionOf" as const, actionIndex };
    }),
  }));
  if (missingFeatureId) return { definition: null, missingFeatureId };
  return {
    definition: {
      ...definition,
      parameters: { ...definition.parameters, participants },
    } as ImportDeferredFeatureDefinition,
    missingFeatureId: null,
  };
}

async function buildPreparedActions(input: {
  source?: ResolvedImportSource;
  read: ReturnType<typeof readPartStudio>;
  plan: OnshapeStudioPlan;
  capabilities: ImportCapabilities;
  demotedFeatureIds?: Iterable<string>;
  includeBinding?: boolean;
  materializeBake?: boolean;
  /**
   * Emit planner-selected bake checkpoints (segment checkpoint bodies) into the
   * prepared prefix without materializing the monolithic whole-studio bake.
   * Probe prefixes set this so whole-body consumers (Split/Boolean/Delete/
   * body-scope extrude) can match on the checkpoint's body-identity signature,
   * while `materializeBake` stays false (no full-studio baked mesh).
   */
  emitBakeCheckpoints?: boolean;
  /**
   * Optional sink recording, per ordered-action position, the Onshape feature id
   * that produced it. The probe-backed planner uses it to correlate a failed
   * probe step back to the feature plan that must be demoted.
   */
  orderedPositionToFeatureId?: Map<number, string>;
  /** Ordered prefix length immediately before each source feature. */
  featureIdToOrderedPrefixPosition?: Map<string, number>;
}): Promise<ImportPreparedActions> {
  const demoted = new Set(input.demotedFeatureIds ?? []);
  const featuresById = new Map(input.read.features.map((f) => [f.featureId, f]));
  const context = input.capabilities.context;
  const solveConsistencySolver = new SketchConstraintSolverAdapter({
    documentId: context.documentId,
    revisionId: context.baseRevisionId,
  });
  const addDocumentVariables: AddDocumentVariableRequest[] = [];
  const commitSketches: ImportCommitSketchRequest[] = [];
  const createFeatures: ImportCreateFeatureRequest[] = [];
  const orderedActions: ImportPreparedActionRef[] = [];
  const diagnostics: ImportDiagnostic[] = [];
  // Onshape feature id -> its position in `orderedActions`, so deferred
  // references can address producing actions by ordered-sequence position
  // (the index the orchestrator records outputs under).
  const orderedIndexByFeatureId = new Map<string, number>();
  const segmentByBoundaryFeatureId = new Map(
    input.plan.bakeStrategy.kind === "segments"
      ? input.plan.bakeStrategy.segments.map((segment) => [
          segment.boundaryFeatureId,
          segment,
        ] as const)
      : [],
  );
  const rollbackTimeline = input.read.studio.rollbackSnapshots
    ? createRollbackTopologyTimeline({
        featureIds: input.read.features.map((feature) => feature.featureId),
        snapshots: input.read.studio.rollbackSnapshots,
      })
    : null;
  type PreparedBodyProducer = {
    actionIndex: number;
    bodyDeterministicIds: readonly string[];
    bindings: ReadonlyMap<string, ImportDeferredTopologyRef>;
  };
  const bodyProducerByDeterministicId = new Map<string, PreparedBodyProducer>();
  const firstRollbackFeatureId = input.read.studio.rollbackSnapshots?.[0]?.featureId;

  const recordBodyTransition = (
    featureId: string,
    actionIndex: number,
    bindings: ReadonlyMap<string, ImportDeferredTopologyRef> = new Map(),
  ) => {
    const delta = rollbackTimeline?.bodyDeltaBetweenFeatures(featureId, featureId);
    const firstSnapshot = featureId === firstRollbackFeatureId
      ? rollbackTimeline?.snapshotAfterFeature(featureId)
      : null;
    if (!delta && !firstSnapshot) return;
    const introducedBodyDeterministicIds = delta
      ? delta.introducedBodyDeterministicIds
      : firstSnapshot!.bodies.map((body) => body.id);
    const changedBodyDeterministicIds = delta?.changedBodyDeterministicIds ?? [];
    const removedBodyDeterministicIds = delta?.removedBodyDeterministicIds ?? [];
    for (const bodyId of [
      ...changedBodyDeterministicIds,
      ...removedBodyDeterministicIds,
    ]) {
      bodyProducerByDeterministicId.delete(bodyId);
    }
    const bodyDeterministicIds = [
      ...introducedBodyDeterministicIds,
      ...changedBodyDeterministicIds,
    ];
    const producer = { actionIndex, bodyDeterministicIds, bindings };
    for (const bodyId of bodyDeterministicIds) {
      bodyProducerByDeterministicId.set(bodyId, producer);
    }
  };

  const deferredBodyForSourceFeature = (
    sourceFeatureId: string,
    consumerFeatureId: string,
    parameterId: string,
  ): Extract<ImportDeferredFeatureBooleanScope, { kind: "targetBody" }>["bodyId"] | null => {
    const delta = rollbackTimeline?.bodyDeltaBetweenFeatures(
      sourceFeatureId,
      sourceFeatureId,
    );
    const bodyIds = delta
      ? [...delta.introducedBodyDeterministicIds, ...delta.changedBodyDeterministicIds]
      : sourceFeatureId === firstRollbackFeatureId
        ? rollbackTimeline?.snapshotAfterFeature(sourceFeatureId)?.bodies.map(
            (body) => body.id,
          ) ?? []
        : [];
    if (bodyIds.length !== 1) {
      const actionIndex = orderedIndexByFeatureId.get(sourceFeatureId);
      return actionIndex === undefined ? null : { kind: "bodyOf", actionIndex };
    }
    const deterministicId = bodyIds[0]!;
    const producer = bodyProducerByDeterministicId.get(deterministicId);
    if (!producer) return null;
    if (producer.bodyDeterministicIds.length === 1) {
      return { kind: "bodyOf", actionIndex: producer.actionIndex };
    }
    const selector = producer.bindings.get(deterministicId);
    return selector
      ? {
          ...selector,
          source: { consumerFeatureId, parameterId, deterministicId },
        }
      : null;
  };

  const deferredBodyTopologyIds = (value: unknown): string[] => {
    if (!value || typeof value !== "object") return [];
    if (
      (value as { kind?: unknown }).kind === "topologyOf" &&
      (value as { expectedKind?: unknown }).expectedKind === "body"
    ) {
      return [(value as ImportDeferredTopologyRef).source.deterministicId];
    }
    return Array.isArray(value)
      ? value.flatMap(deferredBodyTopologyIds)
      : Object.values(value).flatMap(deferredBodyTopologyIds);
  };

  const prepareTopologyFallback = async (
    featurePlan: FeaturePlan,
    request: ImportCreateFeatureRequest,
  ) => {
    if (
      !input.materializeBake ||
      !rollbackTimeline
    ) return;
    const selectedBodyIds = deferredBodyTopologyIds(request.definition);
    if (selectedBodyIds.length === 0) return;
    const delta = rollbackTimeline.bodyDeltaBetweenFeatures(
      featurePlan.onshapeFeatureId,
      featurePlan.onshapeFeatureId,
    );
    const after = rollbackTimeline.snapshotAfterFeature(featurePlan.onshapeFeatureId);
    if (!delta || !after) return;
    const consumedIds = [
      ...new Set([
        ...selectedBodyIds,
        ...delta.changedBodyDeterministicIds,
        ...delta.removedBodyDeterministicIds,
      ]),
    ];
    const replacementActionIndexes = [
      ...new Set(
        consumedIds.flatMap((bodyId) => {
          const producer = bodyProducerByDeterministicId.get(bodyId);
          return producer ? [producer.actionIndex] : [];
        }),
      ),
    ];
    if (replacementActionIndexes.length === 0) return;
    const replacementSet = new Set(replacementActionIndexes);
    const afterBodyIds = new Set(after.bodies.map((body) => body.id));
    const checkpointBodyDeterministicIds = [
      ...new Set([
        ...delta.introducedBodyDeterministicIds,
        ...delta.changedBodyDeterministicIds,
        ...[...bodyProducerByDeterministicId.entries()].flatMap(([bodyId, producer]) =>
          replacementSet.has(producer.actionIndex) && afterBodyIds.has(bodyId)
            ? [bodyId]
            : [],
        ),
      ]),
    ];
    if (checkpointBodyDeterministicIds.length === 0) return;
    const checkpoint = await prepareRollbackCheckpointBake({
      snapshot: after.source,
      capabilities: input.capabilities,
      featureLabel: `${featurePlan.label} topology fallback`,
      studioElementId: input.read.studio.elementId,
      studioName: input.read.studio.name,
      checkpointBodyDeterministicIds,
      provenanceFeatureSpan: {
        fromFeatureId: featurePlan.onshapeFeatureId,
        toFeatureId: featurePlan.onshapeFeatureId,
      },
      replacementActionIndexes,
    });
    if (checkpoint.kind === "ready") request.topologyFallback = checkpoint.request;
  };

  const emitSegmentCheckpoint = async (boundaryFeatureId: string): Promise<void> => {
    const segment = segmentByBoundaryFeatureId.get(boundaryFeatureId);
    if (
      !segment ||
      !(input.materializeBake || input.emitBakeCheckpoints) ||
      !rollbackTimeline
    )
      return;
    const replacementActionIndexes: number[] = [];
    for (const producerFeatureId of segment.replacementProducerFeatureIds) {
      const actionIndex = orderedIndexByFeatureId.get(producerFeatureId);
      if (
        actionIndex === undefined ||
        orderedActions[actionIndex]?.kind !== "createFeature"
      ) {
        diagnostics.push({
          severity: "warning",
          message: `Bake checkpoint ${segment.segmentId} could not resolve replacement producer ${producerFeatureId}; the checkpoint was skipped.`,
          code: "onshape-bake-segment-replacement-unresolved",
        });
        return;
      }
      replacementActionIndexes.push(actionIndex);
    }

    const boundaryPlan = input.plan.featurePlans.find(
      (featurePlan) => featurePlan.onshapeFeatureId === boundaryFeatureId,
    );
    try {
      const checkpoint = await prepareRollbackCheckpointBake({
        snapshot: rollbackTimeline.snapshotAfterFeature(boundaryFeatureId)?.source ?? null,
        capabilities: input.capabilities,
        featureLabel: `${boundaryPlan?.label ?? boundaryFeatureId} checkpoint`,
        studioElementId: input.read.studio.elementId,
        studioName: input.read.studio.name,
        checkpointBodyDeterministicIds: segment.checkpointBodyDeterministicIds,
        provenanceFeatureSpan: {
          fromFeatureId: segment.fromFeatureId,
          toFeatureId: segment.toFeatureId,
        },
        replacementActionIndexes,
      });
      if (checkpoint.kind !== "ready") {
        diagnostics.push({
          severity: "warning",
          message: `Bake checkpoint ${segment.segmentId} could not be materialized from its rollback boundary.`,
          code: "onshape-bake-unavailable",
        });
        return;
      }
      createFeatures.push(checkpoint.request);
      orderedActions.push({
        kind: "createFeature",
        index: createFeatures.length - 1,
      });
      const checkpointOrderedIndex = orderedActions.length - 1;
      orderedIndexByFeatureId.set(boundaryFeatureId, checkpointOrderedIndex);
      const checkpointBindings = new Map(
        segment.bodyBindings.map((binding) => [
          binding.deterministicId,
          {
            kind: "topologyOf" as const,
            expectedKind: "body" as const,
            capturedSignature: normalizeOnshapeTopologySignature(
              binding.capturedSignature,
            ),
            tolerance: {
              ...DEFAULT_MATCH_TOLERANCE,
              linear: Math.max(DEFAULT_MATCH_TOLERANCE.linear, 0.01),
            },
            source: {
              consumerFeatureId: boundaryFeatureId,
              parameterId: "checkpointBody",
              deterministicId: binding.deterministicId,
            },
          },
        ]),
      );
      const checkpointProducer = {
        actionIndex: checkpointOrderedIndex,
        bodyDeterministicIds: segment.checkpointBodyDeterministicIds,
        bindings: checkpointBindings,
      };
      for (const consumedBodyId of segment.consumedBodyDeterministicIds) {
        bodyProducerByDeterministicId.delete(consumedBodyId);
      }
      for (const bodyId of segment.checkpointBodyDeterministicIds) {
        bodyProducerByDeterministicId.set(bodyId, checkpointProducer);
      }
      input.orderedPositionToFeatureId?.set(
        checkpointOrderedIndex,
        boundaryFeatureId,
      );
    } catch (error) {
      diagnostics.push({
        severity: "warning",
        message: `Bake checkpoint ${segment.segmentId} could not be persisted: ${describeUnknownError(error, "unknown error")}`,
        code: "onshape-bake-failed",
      });
    }
  };

  for (const featurePlan of input.plan.featurePlans) {
    input.featureIdToOrderedPrefixPosition?.set(
      featurePlan.onshapeFeatureId,
      orderedActions.length,
    );
    const demotedByUser = demoted.has(featurePlan.onshapeFeatureId);
    if (featurePlan.tier !== "parametric" || demotedByUser) {
      if (demotedByUser) {
        diagnostics.push({
          severity: "info",
          message: `"${featurePlan.label}" was demoted to baked by the reviewer.`,
          code: "onshape-feature-demoted",
        });
      } else {
        diagnostics.push({
          severity: "warning",
          message: `"${featurePlan.label}" (${featurePlan.featureType}) imported as ${featurePlan.tier}: ${featurePlan.reasonCodes.join(", ")}.`,
          code: "onshape-feature-degraded",
        });
      }
      await emitSegmentCheckpoint(featurePlan.onshapeFeatureId);
      continue;
    }

    // Feature-specific translators own whether a parametric plan can be applied;
    // the provider retains the shared action-buffer mechanics.
    if (!onshapeFeatureTranslatorRegistry.forFeatureType(featurePlan.featureType).apply) {
      continue;
    }

    if (featurePlan.target.kind === "variable") {
      const feature = featuresById.get(featurePlan.onshapeFeatureId);
      const variable = extractVariable(feature?.parameters);
      if (!variable) {
        diagnostics.push({
          severity: "warning",
          message: `Variable feature "${featurePlan.label}" had no readable name/value and was skipped.`,
          code: "onshape-variable-unreadable",
        });
        continue;
      }
      const translated = translateOnshapeExpression({
        expression: variable.expression,
      });
      if (translated.diagnostic) {
        diagnostics.push({
          severity: "warning",
          message: translated.diagnostic.message,
          code: translated.diagnostic.code,
        });
      }
      addDocumentVariables.push({
        contractVersion: context.contractVersion,
        documentId: context.documentId,
        baseRevisionId: context.baseRevisionId,
        name: variable.name,
        valueText: translated.valueText,
      });
      orderedActions.push({
        kind: "addDocumentVariable",
        index: addDocumentVariables.length - 1,
      });
      input.orderedPositionToFeatureId?.set(
        orderedActions.length - 1,
        featurePlan.onshapeFeatureId,
      );
      continue;
    }

    if (featurePlan.target.kind === "plane") {
      createFeatures.push({
        contractVersion: context.contractVersion,
        documentId: context.documentId,
        baseRevisionId: context.baseRevisionId,
        featureLabel: featurePlan.label,
        definition: {
          kind: "plane",
          featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
          parameters: {
            mode: "explicitFrame",
            frame: featurePlan.target.frame,
          },
        },
      });
      orderedActions.push({
        kind: "createFeature",
        index: createFeatures.length - 1,
      });
      orderedIndexByFeatureId.set(
        featurePlan.onshapeFeatureId,
        orderedActions.length - 1,
      );
      input.orderedPositionToFeatureId?.set(
        orderedActions.length - 1,
        featurePlan.onshapeFeatureId,
      );
      continue;
    }

    if (featurePlan.target.kind === "sketch") {
      let translation = projectSketchForPlan({ read: input.read, featurePlan });
      if (!translation) {
        diagnostics.push({
          severity: "warning",
          message: `Sketch "${featurePlan.label}" had no readable solved sketch payload and was skipped.`,
          code: "onshape-sketch-unreadable",
        });
        continue;
      }
      const verificationSketchId = translation.definition.points[0]?.target.sketchId;
      if (verificationSketchId) {
        const verified = await verifySketchTranslationSolveConsistency({
          solver: solveConsistencySolver,
          contractVersion: context.contractVersion,
          documentId: context.documentId,
          revisionId: context.baseRevisionId,
          sketchId: verificationSketchId,
          plane: translation.plane,
          definition: translation.definition,
          relationshipSummary: translation.relationshipSummary,
          sourceSolveStatus: translation.sourceSolveStatus,
        });
        translation = {
          ...translation,
          definition: verified.definition,
          diagnostics: [...translation.diagnostics, ...verified.diagnostics],
          relationshipSummary: verified.relationshipSummary,
        };
      }
      for (const sketchDiagnostic of translation.diagnostics) {
        diagnostics.push({
          severity: "info",
          message: sketchDiagnostic.message,
          code: sketchDiagnostic.code,
        });
      }
      if (
        translation.relationshipSummary.constraints.carried > 0 ||
        translation.relationshipSummary.dimensions.carried > 0 ||
        translation.relationshipSummary.derivations.carried > 0 ||
        translation.relationshipSummary.constraints.dropped > 0 ||
        translation.relationshipSummary.dimensions.dropped > 0 ||
        translation.relationshipSummary.derivations.dropped > 0
      ) {
        diagnostics.push({
          severity: "info",
          code: "onshape-sketch-relationship-summary",
          message: `Sketch "${featurePlan.label}" relationships carried/dropped — constraints ${translation.relationshipSummary.constraints.carried}/${translation.relationshipSummary.constraints.dropped}, dimensions ${translation.relationshipSummary.dimensions.carried}/${translation.relationshipSummary.dimensions.dropped}, derivations ${translation.relationshipSummary.derivations.carried}/${translation.relationshipSummary.derivations.dropped}.`,
        });
      }
      // The provider owns solver correlation ids per the commit contract
      // ("Editor- or orchestrator-owned correlation IDs"); a null correlation
      // skips projection/solve/region derivation, which the mock and real
      // kernel lanes require for a committed import sketch.
      const correlationRoot = `request_import_${sanitizeCorrelationPart(featurePlan.onshapeFeatureId)}`;
      let planeSupport: ImportCommitSketchRequest["plane"]["support"] =
        translation.plane.support;
      if (featurePlan.target.capturedFrame) {
        createFeatures.push({
          contractVersion: context.contractVersion,
          documentId: context.documentId,
          baseRevisionId: context.baseRevisionId,
          featureLabel: `${featurePlan.label} captured support`,
          definition: {
            kind: "plane",
            featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
            parameters: {
              mode: "explicitFrame",
              frame: featurePlan.target.capturedFrame,
            },
          },
        });
        orderedActions.push({
          kind: "createFeature",
          index: createFeatures.length - 1,
        });
        const planeOrderedIndex = orderedActions.length - 1;
        input.orderedPositionToFeatureId?.set(
          planeOrderedIndex,
          featurePlan.onshapeFeatureId,
        );
        planeSupport = {
          kind: "constructionOf",
          actionIndex: planeOrderedIndex,
        };
      } else if (featurePlan.target.constructionFromFeatureId) {
        const planeOrderedIndex = orderedIndexByFeatureId.get(
          featurePlan.target.constructionFromFeatureId,
        );
        if (planeOrderedIndex === undefined) {
          diagnostics.push({
            severity: "warning",
            message: `Sketch "${featurePlan.label}" referenced translated plane ${featurePlan.target.constructionFromFeatureId}, which was not emitted; the sketch was skipped.`,
            code: "onshape-sketch-missing-plane",
          });
          continue;
        }
        planeSupport = {
          kind: "constructionOf",
          actionIndex: planeOrderedIndex,
        };
      } else if (featurePlan.target.probedFaceSelector) {
        // Promoted sketch-on-face: emit the probed face as a deferred
        // topologyOf support so the orchestrator rematches it against live
        // topology at apply time (orchestrator.ts materializeCommitSketchRequest).
        planeSupport = featurePlan.target.probedFaceSelector;
      }
      commitSketches.push({
        contractVersion: context.contractVersion,
        documentId: context.documentId,
        baseRevisionId: context.baseRevisionId,
        solverCorrelation: {
          requestId: correlationRoot as RequestId,
          projectionRequestId: `${correlationRoot}_project` as RequestId,
          validationRequestId: `${correlationRoot}_validate` as RequestId,
          solveRequestId: `${correlationRoot}_solve` as RequestId,
          regionRequestId: `${correlationRoot}_regions` as RequestId,
        },
        sketchId: null,
        sketchLabel: featurePlan.label,
        plane: { ...translation.plane, support: planeSupport },
        definition: translation.definition,
      });
      orderedActions.push({
        kind: "commitSketch",
        index: commitSketches.length - 1,
      });
      orderedIndexByFeatureId.set(
        featurePlan.onshapeFeatureId,
        orderedActions.length - 1,
      );
      input.orderedPositionToFeatureId?.set(
        orderedActions.length - 1,
        featurePlan.onshapeFeatureId,
      );
      continue;
    }

    if (featurePlan.target.kind === "feature" && featurePlan.plannedExtrude) {
      const extrude = featurePlan.plannedExtrude;
      const sketchOrderedIndex = orderedIndexByFeatureId.get(
        extrude.sketchFeatureId,
      );
      if (sketchOrderedIndex === undefined) {
        diagnostics.push({
          severity: "warning",
          message: `Extrude "${featurePlan.label}" referenced sketch ${extrude.sketchFeatureId}, which was not committed; the extrude was skipped.`,
          code: "onshape-extrude-missing-sketch",
        });
        continue;
      }

      const profiles = extrude.profiles.map(
        (profile): ImportDeferredExtrudeProfileRef => ({
          kind: "regionOf",
          actionIndex: sketchOrderedIndex,
          selector: { kind: "interiorPoint", point: profile.interiorPoint },
        }),
      );
      if (profiles.length === 0) {
        continue;
      }

      let booleanScope: ImportDeferredFeatureBooleanScope;
      if (extrude.boolean.kind === "standalone") {
        booleanScope = { kind: "standalone" };
      } else if (extrude.boolean.kind === "topologyTargets") {
        booleanScope = {
          kind: extrude.boolean.targets.length === 1 ? "targetBody" : "targetBodies",
          ...(extrude.boolean.targets.length === 1
            ? { bodyId: extrude.boolean.targets[0] }
            : { bodyIds: extrude.boolean.targets }),
        } as unknown as ImportDeferredFeatureBooleanScope;
      } else {
        const deferredBody = deferredBodyForSourceFeature(
          extrude.boolean.sourceFeatureId,
          featurePlan.onshapeFeatureId,
          "booleanScope",
        );
        if (!deferredBody) {
          diagnostics.push({
            severity: "warning",
            message: `Extrude "${featurePlan.label}" referenced an upstream body from ${extrude.boolean.sourceFeatureId}, which was not emitted or was not uniquely attributable; the extrude was skipped.`,
            code: "onshape-extrude-missing-body",
          });
          continue;
        }
        booleanScope = { kind: "targetBody", bodyId: deferredBody };
      }

      const request: ImportCreateFeatureRequest = {
        contractVersion: context.contractVersion,
        documentId: context.documentId,
        baseRevisionId: context.baseRevisionId,
        featureLabel: featurePlan.label,
        definition: {
          kind: "extrude",
          featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
          parameters: {
            profiles: profiles as [
              ImportDeferredExtrudeProfileRef,
              ...ImportDeferredExtrudeProfileRef[],
            ],
            startExtent: { kind: "profilePlane" },
            extent: resolvedExtrudeExtent(extrude),
            operation: extrude.operation,
            booleanScope,
          },
        },
      };
      await prepareTopologyFallback(featurePlan, request);
      createFeatures.push(request);
      orderedActions.push({
        kind: "createFeature",
        index: createFeatures.length - 1,
      });
      orderedIndexByFeatureId.set(
        featurePlan.onshapeFeatureId,
        orderedActions.length - 1,
      );
      input.orderedPositionToFeatureId?.set(
        orderedActions.length - 1,
        featurePlan.onshapeFeatureId,
      );
      recordBodyTransition(featurePlan.onshapeFeatureId, orderedActions.length - 1);
    }

    if (featurePlan.target.kind === "feature" && featurePlan.plannedRevolve) {
      const revolve = featurePlan.plannedRevolve;
      const profileSketchOrderedIndex = orderedIndexByFeatureId.get(
        revolve.sketchFeatureId,
      );
      const axisSketchOrderedIndex = orderedIndexByFeatureId.get(
        revolve.axis.sketchFeatureId,
      );
      if (profileSketchOrderedIndex === undefined || axisSketchOrderedIndex === undefined) {
        diagnostics.push({
          severity: "warning",
          message: `Revolve "${featurePlan.label}" referenced a profile or axis sketch that was not committed; the revolve was skipped.`,
          code: "onshape-revolve-missing-sketch",
        });
        continue;
      }

      const profiles = revolve.profiles.map(
        (profile): ImportDeferredProfileRef => ({
          kind: "regionOf",
          actionIndex: profileSketchOrderedIndex,
          selector: { kind: "interiorPoint", point: profile.interiorPoint },
        }),
      );
      if (profiles.length === 0) continue;

      let booleanScope: ImportDeferredFeatureBooleanScope;
      if (revolve.boolean.kind === "standalone") {
        booleanScope = { kind: "standalone" };
      } else {
        const deferredBody = deferredBodyForSourceFeature(
          revolve.boolean.sourceFeatureId,
          featurePlan.onshapeFeatureId,
          "booleanScope",
        );
        if (!deferredBody) {
          diagnostics.push({
            severity: "warning",
            message: `Revolve "${featurePlan.label}" referenced an upstream body from ${revolve.boolean.sourceFeatureId}, which was not emitted or was not uniquely attributable; the revolve was skipped.`,
            code: "onshape-revolve-missing-body",
          });
          continue;
        }
        booleanScope = { kind: "targetBody", bodyId: deferredBody };
      }

      const request = {
        contractVersion: context.contractVersion,
        documentId: context.documentId,
        baseRevisionId: context.baseRevisionId,
        featureLabel: featurePlan.label,
        definition: {
          kind: "revolve",
          featureTypeVersion: REVOLVE_FEATURE_SCHEMA_VERSION,
          parameters: {
            profiles: profiles as [
              ImportDeferredProfileRef,
              ...ImportDeferredProfileRef[],
            ],
            axis: {
              kind: "sketchEntity",
              sketchId: { kind: "sketchIdOf", actionIndex: axisSketchOrderedIndex },
              entityId: revolve.axis.entityId,
            },
            startAngle: revolve.startAngle,
            extent: revolve.extent,
            operation: revolve.operation,
            booleanScope,
          },
        },
      } as ImportCreateFeatureRequest;
      await prepareTopologyFallback(featurePlan, request);
      createFeatures.push(request);
      orderedActions.push({
        kind: "createFeature",
        index: createFeatures.length - 1,
      });
      orderedIndexByFeatureId.set(
        featurePlan.onshapeFeatureId,
        orderedActions.length - 1,
      );
      input.orderedPositionToFeatureId?.set(
        orderedActions.length - 1,
        featurePlan.onshapeFeatureId,
      );
      recordBodyTransition(featurePlan.onshapeFeatureId, orderedActions.length - 1);
    }

    if (featurePlan.target.kind === "feature" && featurePlan.plannedSweep) {
      const sweep = featurePlan.plannedSweep;
      const profileSketchOrderedIndex = orderedIndexByFeatureId.get(
        sweep.sketchFeatureId,
      );
      const pathSketchOrderedIndex = orderedIndexByFeatureId.get(
        sweep.path.sketchFeatureId,
      );
      if (
        profileSketchOrderedIndex === undefined ||
        pathSketchOrderedIndex === undefined
      ) {
        diagnostics.push({
          severity: "warning",
          message: `Sweep "${featurePlan.label}" referenced a profile or path sketch that was not committed; the sweep was skipped.`,
          code: "onshape-sweep-missing-sketch",
        });
        continue;
      }

      const profileTargets = sweep.profiles.map(
        (profile): ImportDeferredProfileRef => ({
          kind: "regionOf",
          actionIndex: profileSketchOrderedIndex,
          selector: { kind: "interiorPoint", point: profile.interiorPoint },
        }),
      );
      if (profileTargets.length === 0) continue;

      createFeatures.push({
        contractVersion: context.contractVersion,
        documentId: context.documentId,
        baseRevisionId: context.baseRevisionId,
        featureLabel: featurePlan.label,
        definition: {
          kind: "sweep",
          featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
          parameters: {
            operationIntent: createLiteralAuthoredValue("create"),
            participants: [
              { role: "profile", targets: profileTargets },
              {
                role: "path",
                targets: [
                  {
                    kind: "sketchEntity",
                    sketchId: {
                      kind: "sketchIdOf",
                      actionIndex: pathSketchOrderedIndex,
                    },
                    entityId: sweep.path.entityId,
                  },
                ],
              },
            ],
            options: {
              profileControl: createLiteralAuthoredValue("none"),
              twist: { type: "none" },
              endScale: createLiteralAuthoredValue(1),
            },
          },
        },
      } as ImportCreateFeatureRequest);
      orderedActions.push({
        kind: "createFeature",
        index: createFeatures.length - 1,
      });
      orderedIndexByFeatureId.set(
        featurePlan.onshapeFeatureId,
        orderedActions.length - 1,
      );
      input.orderedPositionToFeatureId?.set(
        orderedActions.length - 1,
        featurePlan.onshapeFeatureId,
      );
      recordBodyTransition(featurePlan.onshapeFeatureId, orderedActions.length - 1);
    }

    if (featurePlan.target.kind === "feature" && featurePlan.plannedLoft) {
      const profileTargets: ImportDeferredProfileRef[] = [];
      let missingSketchFeatureId: string | null = null;
      for (const profile of featurePlan.plannedLoft.profiles) {
        const sketchOrderedIndex = orderedIndexByFeatureId.get(profile.sketchFeatureId);
        if (sketchOrderedIndex === undefined) {
          missingSketchFeatureId = profile.sketchFeatureId;
          break;
        }
        profileTargets.push({
          kind: "regionOf",
          actionIndex: sketchOrderedIndex,
          selector: { kind: "interiorPoint", point: profile.profile.interiorPoint },
        });
      }
      if (missingSketchFeatureId) {
        diagnostics.push({
          severity: "warning",
          message: `Loft "${featurePlan.label}" referenced sketch ${missingSketchFeatureId}, which was not committed; the loft was skipped.`,
          code: "onshape-loft-missing-sketch",
        });
        continue;
      }

      createFeatures.push({
        contractVersion: context.contractVersion,
        documentId: context.documentId,
        baseRevisionId: context.baseRevisionId,
        featureLabel: featurePlan.label,
        definition: {
          kind: "loft",
          featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
          parameters: {
            operationIntent: createLiteralAuthoredValue("create"),
            participants: [{ role: "profile", targets: profileTargets }],
          },
        },
      } as ImportCreateFeatureRequest);
      orderedActions.push({
        kind: "createFeature",
        index: createFeatures.length - 1,
      });
      orderedIndexByFeatureId.set(
        featurePlan.onshapeFeatureId,
        orderedActions.length - 1,
      );
      input.orderedPositionToFeatureId?.set(
        orderedActions.length - 1,
        featurePlan.onshapeFeatureId,
      );
      recordBodyTransition(featurePlan.onshapeFeatureId, orderedActions.length - 1);
    }

    if (featurePlan.target.kind === "feature" && featurePlan.plannedAdvancedSolid) {
      const resolvedDefinition = resolvePlannedConstructionParticipants(
        featurePlan.plannedAdvancedSolid,
        orderedIndexByFeatureId,
      );
      if (!resolvedDefinition.definition) {
        diagnostics.push({
          severity: "warning",
          message: `Feature "${featurePlan.label}" referenced translated plane ${resolvedDefinition.missingFeatureId}, which was not emitted; the feature was skipped.`,
          code: "onshape-feature-missing-plane",
        });
        continue;
      }
      const request: ImportCreateFeatureRequest = {
        contractVersion: context.contractVersion,
        documentId: context.documentId,
        baseRevisionId: context.baseRevisionId,
        featureLabel: featurePlan.label,
        definition: resolvedDefinition.definition,
      };
      await prepareTopologyFallback(featurePlan, request);
      createFeatures.push(request);
      orderedActions.push({ kind: "createFeature", index: createFeatures.length - 1 });
      orderedIndexByFeatureId.set(featurePlan.onshapeFeatureId, orderedActions.length - 1);
      input.orderedPositionToFeatureId?.set(orderedActions.length - 1, featurePlan.onshapeFeatureId);
      recordBodyTransition(featurePlan.onshapeFeatureId, orderedActions.length - 1);
    }
  }

  if (input.plan.requiresStudioBake) {
    const bakedMeshBytes =
      input.materializeBake && input.read.studio.groundTruth.hasBodies
        ? encodeOnshapeTessellationAsBakedMeshBytes(
            input.read.studio.groundTruth.tessellatedFaces,
          )
        : null;
    let bakedAsset: Awaited<
      ReturnType<ImportCapabilities["modeling"]["bakeGeometry"]>
    > | null = null;
    if (bakedMeshBytes) {
      try {
        bakedAsset = await input.capabilities.modeling.bakeGeometry({
          bytes: bakedMeshBytes,
          format: "baked-mesh",
        });
      } catch (error) {
        diagnostics.push({
          severity: "warning",
          message: `Onshape baked geometry could not be persisted: ${describeUnknownError(
            error,
            "unknown error",
          )}`,
          code: "onshape-bake-failed",
        });
        bakedAsset = null;
      }
    }

    if (bakedAsset) {
      const bakedFeatureIds = input.plan.featurePlans
        .filter((featurePlan) => featurePlan.tier === "baked")
        .map((featurePlan) => featurePlan.onshapeFeatureId);
      const fromFeatureId = bakedFeatureIds[0] ?? "unknown";
      const toFeatureId = bakedFeatureIds.at(-1) ?? fromFeatureId;
      createFeatures.push({
        contractVersion: context.contractVersion,
        documentId: context.documentId,
        baseRevisionId: context.baseRevisionId,
        featureLabel: `${input.read.studio.name} baked body`,
        definition: {
          kind: "bakedBody",
          featureTypeVersion: BAKED_BODY_FEATURE_SCHEMA_VERSION,
          parameters: {
            assetId: bakedAsset.assetId,
            format: bakedAsset.format,
            hash: bakedAsset.hash,
            byteLength: bakedAsset.byteLength,
            label: `${input.read.studio.name} baked body`,
            provenance: {
              source: "onshape",
              sourceId: input.read.studio.elementId,
              sourceName: input.read.studio.name,
              featureSpan: { fromFeatureId, toFeatureId },
              reason: "onshape-studio-bake-required",
            },
            replacement: {
              kind: "replaceBodyOutputs",
              actionIndexes: orderedActions.flatMap((action, actionIndex) =>
                action.kind === "createFeature" ? [actionIndex] : [],
              ),
            },
          },
        },
      });
      orderedActions.push({
        kind: "createFeature",
        index: createFeatures.length - 1,
      });
    } else {
      diagnostics.push({
        severity: "warning",
        message:
          "Non-parametric solid geometry could not be materialized: baking requires the geometry-import capability, which is not available. The final-state body was not imported.",
        code: "onshape-bake-unavailable",
      });
    }
  }

  if (input.plan.bakeStrategy.kind === "segments") {
    for (const segment of input.plan.bakeStrategy.segments) {
      diagnostics.push({
        severity: "info",
        message: `Bake checkpoint ${segment.segmentId} represents ${segment.fromFeatureId} through ${segment.toFeatureId}, outputs bodies ${bodySetReviewValue(segment.checkpointBodyDeterministicIds)}, and replaces ${segment.replacementProducerFeatureIds.length} prior producer action${segment.replacementProducerFeatureIds.length === 1 ? "" : "s"}.`,
        code: "onshape-bake-segment-planned",
      });
      diagnostics.push({
        severity: "info",
        message: `Bake checkpoint ${segment.segmentId} is tessellation-backed; captured STEP evidence is not used for checkpoint ingestion.`,
        code: "onshape-bake-segment-tessellation-backed",
      });
    }
  } else if (input.plan.bakeStrategy.kind === "wholeStudioLegacy") {
    const limitation = input.plan.bakeDiagnostics[0];
    diagnostics.push({
      severity: "warning",
      message: limitation
        ? `Segmented baking was unavailable (${limitation.code}): ${limitation.message} The importer retained the legacy whole-studio bake.`
        : `Segmented baking was unavailable (${input.plan.bakeStrategy.reason}); the importer retained the legacy whole-studio bake.`,
      code: "onshape-bake-segment-legacy-fallback",
    });
  }

  const strategySummary = input.plan.bakeStrategy.kind === "segments"
    ? `segmented, ${input.plan.bakeStrategy.segments.length} checkpoint${input.plan.bakeStrategy.segments.length === 1 ? "" : "s"}`
    : input.plan.bakeStrategy.kind === "wholeStudioLegacy"
      ? `legacy whole-studio (${input.plan.bakeStrategy.reason}), 0 checkpoints`
      : "none, 0 checkpoints";
  diagnostics.push({
    severity: "info",
    message: `Fidelity: ${input.plan.tierCounts.parametric} parametric, ${input.plan.tierCounts.baked} baked, ${input.plan.tierCounts.geometryOnly} geometry-only; bake strategy: ${strategySummary}.`,
    code: "onshape-fidelity-summary",
  });

  const actions: ImportPreparedActions = {
    addDocumentVariables,
    commitSketches,
    createFeatures,
    orderedActions,
    diagnostics,
  };

  if (input.includeBinding && input.source) {
    actions.binding = {
      schemaVersion: IMPORT_CONTRACT_SCHEMA_VERSION,
      kind: "localFile",
      fileName: input.source.name,
      fingerprint: input.source.fingerprint,
      refreshPolicy: "manual",
    };
  }

  return actions;
}

export const onshapeImportProvider: ImportProvider<
  OnshapeImportReview,
  OnshapeImportSelections,
  FeatureEditorFormSchema
> = {
  id: "onshape-capture-bundle",
  label: "Onshape Capture Bundle",
  acceptedFileTypes: [
    { extension: ACCEPTED_EXTENSION, mediaType: "application/json" },
  ],

  accepts(source) {
    return source.name.toLowerCase().endsWith(ACCEPTED_EXTENSION);
  },

  async review({ source, capabilities }) {
    const bundle = decodeBundle(source);
    if (!bundle) {
      const envelope: ImportReviewEnvelope<OnshapeImportReview> = {
        providerReview: { valid: false, studios: [], defaultStudioId: null },
        proposedActionKinds: [],
        diagnostics: [
          {
            severity: "error",
            message:
              "The selected file is not a valid Onshape capture bundle (envelope validation failed or unsupported format version).",
            code: "onshape-bundle-invalid",
          },
        ],
      };
      return envelope;
    }

    const studioList = listPartStudios(bundle);
    const studios = await Promise.all(
      studioList.map((entry) => reviewStudio(bundle, entry.elementId, capabilities)),
    );
    const defaultStudio =
      studios.find((studio) => studio.hasBodies) ?? studios[0] ?? null;

    const diagnostics: ImportDiagnostic[] = studios.flatMap((studio) => {
      if (studio.verification.status === "unavailable") {
        return [
          {
            severity: "warning" as const,
            message: `Ground-truth verification is unavailable for "${studio.name}"; imported geometry was not checked against the captured model.`,
            code: "onshape-verification-unavailable",
          },
        ];
      }
      if (studio.verification.status === "partial") {
        return [
          {
            severity: "warning" as const,
            message: studio.verification.reason,
            code: "onshape-verification-partial",
          },
        ];
      }
      return [];
    });

    return {
      providerReview: {
        valid: true,
        studios,
        defaultStudioId: defaultStudio?.elementId ?? null,
      },
      proposedActionKinds: ["addDocumentVariable", "commitSketch", "createFeature"],
      diagnostics,
    };
  },

  createDefaultSelections(review) {
    return {
      studioElementId: review.providerReview.defaultStudioId,
      demotedFeatureIds: [],
    };
  },

  getReviewFormSchema(review, selections) {
    const { studios } = review.providerReview;
    const selected =
      studios.find((studio) => studio.elementId === selections.studioElementId) ??
      studios[0] ??
      null;

    const studioField: FeatureEditorFormField = {
      kind: "enum",
      id: "studio",
      label: "Part Studio",
      value: selected?.elementId ?? "",
      options: studios.map((studio) => ({
        value: studio.elementId,
        label: `${studio.name} (${studio.featurePlans.length} features)`,
      })),
      patch: { patchKey: "studioElementId" },
    };

    const reportFields: FeatureEditorFormField[] = selected
      ? selected.featurePlans.map((plan) => {
          const relationshipSummary = selected.sketchRelationshipSummaries.find(
            (entry) => entry.featureId === plan.onshapeFeatureId,
          );
          const relationships = relationshipSummary
            ? ` — carried/dropped: constraints ${relationshipSummary.summary.constraints.carried}/${relationshipSummary.summary.constraints.dropped}, dimensions ${relationshipSummary.summary.dimensions.carried}/${relationshipSummary.summary.dimensions.dropped}, derivations ${relationshipSummary.summary.derivations.carried}/${relationshipSummary.summary.derivations.dropped}`
            : "";
          return summaryField(
            `feature-${plan.onshapeFeatureId}`,
            plan.label,
            `${reviewFeatureDiagnostic(plan, selected)}${relationships}`,
          );
        })
      : [];

    const relationshipFields: FeatureEditorFormField[] = selected
      ? selected.sketchRelationshipSummaries.map((entry) =>
          summaryField(
            `sketch-relationships-${entry.featureId}`,
            entry.label,
            `constraints ${entry.summary.constraints.carried}/${entry.summary.constraints.dropped}, dimensions ${entry.summary.dimensions.carried}/${entry.summary.dimensions.dropped}, derivations ${entry.summary.derivations.carried}/${entry.summary.derivations.dropped}`,
          ),
        )
      : [];

    const verificationValue = selected
      ? selected.verification.status === "unavailable"
        ? "Unavailable — geometry was not verified against the captured model."
        : selected.verification.status === "noGroundTruth"
          ? "No captured geometry to verify."
          : selected.verification.status
      : "No studio selected.";

    const schema: FeatureEditorFormSchema = {
      sections: [
        { id: "studio-selection", title: "Studio", fields: [studioField] },
        {
          id: "bake-segments",
          title: "Bake segments",
          fields: selected ? bakeSegmentFields(selected) : [],
        },
        {
          id: "fidelity-report",
          title: "Per-feature fidelity",
          fields: reportFields,
        },
        {
          id: "sketch-relationships",
          title: "Sketch relationships carried/dropped",
          fields: relationshipFields,
        },
        {
          id: "verification",
          title: "Ground-truth verification",
          fields: [
            summaryField("verification-status", "Status", verificationValue),
          ],
        },
      ],
    };
    return schema;
  },

  applySelectionPatch(_review, selections, patch) {
    const next: OnshapeImportSelections = { ...selections };
    if (typeof patch.studioElementId === "string") {
      next.studioElementId = patch.studioElementId;
    }
    if (Array.isArray(patch.demotedFeatureIds)) {
      next.demotedFeatureIds = patch.demotedFeatureIds.filter(
        (id): id is string => typeof id === "string",
      );
    }
    return next;
  },

  async prepare({ source, review, selections, capabilities }) {
    const bundle = decodeBundle(source);
    if (!bundle) {
      return {
        diagnostics: [
          {
            severity: "error",
            message: "The Onshape bundle could not be read during prepare.",
            code: "onshape-bundle-invalid",
          },
        ],
      };
    }

    const elementId =
      selections.studioElementId ?? bundle.partStudios[0]?.elementId ?? "";
    const read = readPartStudio(bundle, elementId);
    const reviewedStudio = review.providerReview.studios.find(
      (studio) => studio.elementId === elementId,
    );
    const plan = reviewedStudio
      ? {
          featurePlans: reviewedStudio.featurePlans,
          tierCounts: reviewedStudio.tierCounts,
          bakeStrategy: reviewedStudio.bakeStrategy,
          bakeDiagnostics: reviewedStudio.bakeDiagnostics,
          requiresStudioBake: reviewedStudio.requiresStudioBake,
        }
      : planStudioFidelity(read);
    return await buildPreparedActions({
      source,
      read,
      plan,
      capabilities,
      demotedFeatureIds: selections.demotedFeatureIds,
      includeBinding: true,
      materializeBake: true,
    });
  },
};
