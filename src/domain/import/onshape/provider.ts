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
  ImportCreateFeatureRequest,
  ImportDeferredExtrudeProfileRef,
  ImportDeferredFeatureBooleanScope,
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
} from "@/contracts/shared/versioning";
import {
  validateOnshapeCaptureBundle,
  type OnshapeCaptureBundle,
} from "@/contracts/import/onshape-capture-bundle";
import type {
  AddDocumentVariableRequest,
  CommitSketchRequest,
} from "@/contracts/modeling/schema";
import type {
  HistoryProbeResult,
  HistoryProbeTopologySignature,
  ImportCapabilities,
} from "@/contracts/import/capabilities";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
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
  planStudioFidelity,
  type FeaturePlan,
  type FidelityTier,
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
  type SolvedSketchEntityGeometry,
} from "@/domain/import/onshape/sketch-translator";
import { translateOnshapeExpression } from "@/domain/import/onshape/expression-translator";
import { matchSignature } from "@/domain/import/onshape/signature-matcher";
import { extractSketchPlaneDeterministicId } from "@/domain/import/onshape/fidelity-planner";
import type { OnshapeGeometricSignature } from "@/contracts/import/onshape-capture-bundle";

const ACCEPTED_EXTENSION = ".onshape-capture.json";

export interface OnshapeStudioReview {
  elementId: string;
  name: string;
  hasBodies: boolean;
  featurePlans: FeaturePlan[];
  tierCounts: Record<FidelityTier, number>;
  requiresStudioBake: boolean;
  verification: GroundTruthVerification;
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

function scaleCapturedSignatureToDocumentUnits(
  signature: OnshapeGeometricSignature,
): OnshapeGeometricSignature {
  const scalePoint = (point: [number, number, number]): [number, number, number] => [
    point[0] * 1000,
    point[1] * 1000,
    point[2] * 1000,
  ];
  return {
    ...signature,
    centroid: signature.centroid ? scalePoint(signature.centroid) : undefined,
    boundingBox: signature.boundingBox
      ? {
          low: scalePoint(signature.boundingBox.low),
          high: scalePoint(signature.boundingBox.high),
        }
      : undefined,
  };
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

function planeFromCapturedSignature(input: {
  deterministicId: string;
  signature: OnshapeGeometricSignature;
}): SketchPlaneDefinition | null {
  if (input.signature.entityClass !== "face" || input.signature.geometryType !== "plane") {
    return null;
  }
  const originMeters = readPoint3(input.signature.definingData?.origin);
  const normal = normalizeVector(readPoint3(input.signature.definingData?.normal) ?? [0, 0, 0]);
  if (!originMeters || !normal) {
    return null;
  }
  const xAxis =
    normalizeVector(readPoint3(input.signature.definingData?.xDirection) ?? [0, 0, 0]) ??
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
    support: {
      kind: "construction",
      constructionId: `construction_import_captured_${input.deterministicId}` as ConstructionId,
    },
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

function encodeCapturedTessellationAsBakedMeshBytes(
  tessellatedFaces: unknown,
): Uint8Array | null {
  if (typeof tessellatedFaces !== "object" || tessellatedFaces === null) {
    return null;
  }
  const bodies = (tessellatedFaces as { bodies?: unknown }).bodies;
  if (!Array.isArray(bodies) || bodies.length === 0) {
    return null;
  }

  const vertices: [number, number, number][] = [];
  const indices: [number, number, number][] = [];
  const components: {
    sourceComponentKey: string;
    indexStart: number;
    indexCount: number;
  }[] = [];
  for (const [bodyIndex, body] of bodies.entries()) {
    const faces = (body as { faces?: unknown }).faces;
    if (!Array.isArray(faces)) {
      return null;
    }
    const indexStart = indices.length;
    for (const face of faces) {
      const facets = (face as { facets?: unknown }).facets;
      if (!Array.isArray(facets)) {
        return null;
      }
      for (const facet of facets) {
        const facetVertices = (facet as { vertices?: unknown }).vertices;
        if (!Array.isArray(facetVertices) || facetVertices.length !== 3) {
          return null;
        }
        const trianglePoints = facetVertices.map(readCapturedPoint);
        if (trianglePoints.some((point) => point === null)) {
          return null;
        }
        const start = vertices.length;
        vertices.push(...(trianglePoints as [number, number, number][]));
        indices.push([start, start + 1, start + 2]);
      }
    }
    const indexCount = indices.length - indexStart;
    if (indexCount === 0) {
      return null;
    }
    // `bodies[]` is the source authority; geometry never changes membership.
    components.push({
      sourceComponentKey: `onshape-tessellation-body-${bodyIndex}`,
      indexStart,
      indexCount,
    });
  }

  return new TextEncoder().encode(
    JSON.stringify({
      kind: "bakedMeshGeometry",
      schemaVersion: "baked-mesh-geometry/v1alpha1",
      vertices,
      indices,
      components,
    }),
  );
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
): OnshapeStudioPlan {
  const tierCounts = { parametric: 0, baked: 0, geometryOnly: 0 };
  for (const plan of featurePlans) {
    tierCounts[plan.tier] += 1;
  }
  return {
    ...basePlan,
    featurePlans,
    tierCounts,
    requiresStudioBake:
      featurePlans.some((plan) => plan.tier === "baked") && hasBodies,
  };
}

function activateCapturedFramePlanning(input: {
  read: ReturnType<typeof readPartStudio>;
  plan: OnshapeStudioPlan;
}): OnshapeStudioPlan {
  const references = new Map(
    input.read.studio.resolvedReferences.map((reference) => [
      reference.deterministicId,
      reference,
    ]),
  );
  const nextPlans = input.plan.featurePlans.map((featurePlan) => {
    if (
      featurePlan.featureType !== "newSketch" ||
      featurePlan.tier !== "baked" ||
      !featurePlan.reasonCodes.includes("needs-history-probe")
    ) {
      return featurePlan;
    }
    const feature = input.read.features.find(
      (entry) => entry.featureId === featurePlan.onshapeFeatureId,
    );
    const deterministicId = feature ? extractSketchPlaneDeterministicId(feature) : null;
    const reference = deterministicId ? references.get(deterministicId) : undefined;
    if (!reference || !("signature" in reference)) {
      return featurePlan;
    }
    const plane = planeFromCapturedSignature({
      deterministicId: reference.deterministicId,
      signature: reference.signature,
    });
    if (!plane) {
      return featurePlan;
    }
    return {
      ...featurePlan,
      tier: "parametric" as const,
      target: { kind: "sketch" as const, planeKey: "xy" as const, plane },
      reasonCodes: ["sketch-on-captured-frame" as const],
      suppressed: false,
    };
  });
  return recomputePlanWithFeaturePlans(
    input.plan,
    nextPlans,
    input.read.studio.groundTruth.hasBodies,
  );
}

function isCapturedFramePromotion(plan: FeaturePlan): boolean {
  return (
    plan.featureType === "newSketch" &&
    plan.tier === "parametric" &&
    plan.reasonCodes.includes("sketch-on-captured-frame")
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

  // A captured-frame promotion fabricates a construction support that no
  // prepared action ever creates, so a real kernel probe aborts at that
  // sketch's commit step. Use the probe as the oracle: when a captured-frame
  // sketch fails its probe step, demote it back to baked and re-probe so the
  // downstream steps still get evaluated. Bounded by the number of captured
  // frame promotions to avoid re-probing indefinitely.
  let workingPlan: OnshapeStudioPlan = input.plan;
  let probeResult: HistoryProbeResult;
  const maxDemotions = input.plan.featurePlans.filter(
    isCapturedFramePromotion,
  ).length;
  for (let attempt = 0; ; attempt += 1) {
    const orderedPositionToFeatureId = new Map<number, string>();
    const candidatePrefix = await buildPreparedActions({
      read: input.read,
      plan: workingPlan,
      capabilities: input.capabilities,
      materializeBake: false,
      orderedPositionToFeatureId,
    });
    probeResult = await input.capabilities.history.evaluateHistoryProbe({
      actions: candidatePrefix,
      includeFinalTessellation: true,
    });

    const failedOrdinal = probeResult.steps.findIndex(
      (step) => step.status === "failed",
    );
    if (failedOrdinal < 0 || attempt > maxDemotions) {
      break;
    }
    const failedFeatureId = orderedPositionToFeatureId.get(failedOrdinal);
    const demotable = failedFeatureId
      ? workingPlan.featurePlans.find(
          (plan) =>
            plan.onshapeFeatureId === failedFeatureId &&
            isCapturedFramePromotion(plan),
        )
      : undefined;
    if (!demotable) {
      // The failure is not attributable to a demotable captured-frame
      // promotion; leave the plan so the honest degradation path applies.
      break;
    }
    // Every captured-frame promotion carries the same fabricated construction
    // support that no prepared action creates, so if one fails its probe step
    // they all would. Demote them together to bound re-probing to a single
    // confirming pass instead of one full OCC replay per captured frame.
    workingPlan = recomputePlanWithFeaturePlans(
      workingPlan,
      workingPlan.featurePlans.map((plan) =>
        isCapturedFramePromotion(plan) ? demoteCapturedFrameToBaked(plan) : plan,
      ),
      input.read.studio.groundTruth.hasBodies,
    );
  }

  const finalRebuiltStep = [...probeResult.steps]
    .reverse()
    .find((step) => step.status === "rebuilt");
  const probeSignatures = finalRebuiltStep?.status === "rebuilt" ? finalRebuiltStep.signatures : [];
  if (probeSignatures.length === 0) {
    return { plan: workingPlan, probeResult };
  }

  const references = new Map(
    input.read.studio.resolvedReferences.map((reference) => [
      reference.deterministicId,
      reference,
    ]),
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

    const feature = input.read.features.find(
      (entry) => entry.featureId === featurePlan.onshapeFeatureId,
    );
    const deterministicId = feature ? extractSketchPlaneDeterministicId(feature) : null;
    const reference = deterministicId ? references.get(deterministicId) : undefined;
    const capturedSignature =
      reference && "signature" in reference
        ? scaleCapturedSignatureToDocumentUnits(reference.signature)
        : feature
          ? inferredSweptFaceSignature({
              feature,
              read: input.read,
              plan: workingPlan,
            })
          : null;
    if (!capturedSignature) {
      return featurePlan;
    }

    const match = matchSignature(capturedSignature, probeSignatures);
    if (match.kind !== "unique") {
      return featurePlan;
    }

    const probeSignature = probeSignatures.find(
      (signature) => referenceKey(signature.reference) === referenceKey(match.reference),
    );
    const plane = probeSignature ? planeFromProbeSignature(probeSignature) : null;
    if (!plane) {
      return featurePlan;
    }

    return {
      ...featurePlan,
      tier: "parametric" as const,
      target: { kind: "sketch" as const, planeKey: "xy" as const, plane },
      reasonCodes: ["sketch-on-probed-face" as const],
      suppressed: false,
    };
  });

  const tierCounts = { parametric: 0, baked: 0, geometryOnly: 0 };
  for (const plan of nextPlans) {
    tierCounts[plan.tier] += 1;
  }
  return {
    plan: {
      ...workingPlan,
      featurePlans: nextPlans,
      tierCounts,
      requiresStudioBake:
        nextPlans.some((plan) => plan.tier === "baked") &&
        input.read.studio.groundTruth.hasBodies,
    },
    probeResult,
  };
}

async function reviewStudio(
  bundle: OnshapeCaptureBundle,
  elementId: string,
  capabilities: ImportCapabilities,
): Promise<OnshapeStudioReview> {
  const read = readPartStudio(bundle, elementId);
  const basePlan = planStudioFidelity(read);
  // Captured-frame promotion fabricates a construction support that only a
  // history probe can validate against the real kernel. Without a probe we
  // cannot verify it resolves (the real OCC kernel rejects the synthetic
  // support), so keep those sketches baked rather than shipping an
  // unresolvable plan the apply step would fail on.
  const capturedFramePlan = capabilities.history
    ? activateCapturedFramePlanning({ read, plan: basePlan })
    : basePlan;
  const activation = await activateProbeBackedPlanning({
    read,
    plan: capturedFramePlan,
    capabilities,
  });
  const { plan, probeResult } = activation;
  const bakedCount = plan.featurePlans.filter((entry) => entry.tier === "baked").length;
  return {
    elementId: read.studio.elementId,
    name: read.studio.name,
    hasBodies: read.studio.groundTruth.hasBodies,
    featurePlans: plan.featurePlans,
    tierCounts: plan.tierCounts,
    requiresStudioBake: plan.requiresStudioBake,
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

function sanitizeCorrelationPart(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]/g, "_");
}

type OnshapeStudioPlan = Pick<
  ReturnType<typeof planStudioFidelity>,
  "featurePlans" | "tierCounts" | "requiresStudioBake"
>;

async function buildPreparedActions(input: {
  source?: ResolvedImportSource;
  read: ReturnType<typeof readPartStudio>;
  plan: OnshapeStudioPlan;
  capabilities: ImportCapabilities;
  demotedFeatureIds?: Iterable<string>;
  includeBinding?: boolean;
  materializeBake?: boolean;
  /**
   * Optional sink recording, per ordered-action position, the Onshape feature id
   * that produced it. The probe-backed planner uses it to correlate a failed
   * probe step back to the feature plan that must be demoted.
   */
  orderedPositionToFeatureId?: Map<number, string>;
}): Promise<ImportPreparedActions> {
  const demoted = new Set(input.demotedFeatureIds ?? []);
  const featuresById = new Map(input.read.features.map((f) => [f.featureId, f]));
  const context = input.capabilities.context;
  const addDocumentVariables: AddDocumentVariableRequest[] = [];
  const commitSketches: CommitSketchRequest[] = [];
  const createFeatures: ImportCreateFeatureRequest[] = [];
  const orderedActions: ImportPreparedActionRef[] = [];
  const diagnostics: ImportDiagnostic[] = [];
  // Onshape feature id -> its position in `orderedActions`, so deferred
  // references can address producing actions by ordered-sequence position
  // (the index the orchestrator records outputs under).
  const orderedIndexByFeatureId = new Map<string, number>();

  for (const featurePlan of input.plan.featurePlans) {
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

    if (featurePlan.target.kind === "sketch") {
      const planeKey = featurePlan.target.planeKey;
      const plane = featurePlan.target.plane;
      const solved = input.read.solvedSketchesByFeatureId.get(
        featurePlan.onshapeFeatureId,
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
          // Onshape radii are in meters; sketch units are millimeters.
          radius: curve.radius === undefined ? undefined : curve.radius * 1000,
        }),
      );
      const translation = translateSketch({
        featureId: featurePlan.onshapeFeatureId,
        label: featurePlan.label,
        planeKey,
        plane,
        entities,
      });
      for (const sketchDiagnostic of translation.diagnostics) {
        diagnostics.push({
          severity: "info",
          message: sketchDiagnostic.message,
          code: sketchDiagnostic.code,
        });
      }
      // The provider owns solver correlation ids per the commit contract
      // ("Editor- or orchestrator-owned correlation IDs"); a null correlation
      // skips projection/solve/region derivation, which the mock and real
      // kernel lanes require for a committed import sketch.
      const correlationRoot = `request_import_${sanitizeCorrelationPart(featurePlan.onshapeFeatureId)}`;
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
        plane: translation.plane,
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
      } else {
        const bodyOrderedIndex = orderedIndexByFeatureId.get(
          extrude.boolean.sourceFeatureId,
        );
        if (bodyOrderedIndex === undefined) {
          diagnostics.push({
            severity: "warning",
            message: `Extrude "${featurePlan.label}" referenced an upstream body from ${extrude.boolean.sourceFeatureId}, which was not emitted; the extrude was skipped.`,
            code: "onshape-extrude-missing-body",
          });
          continue;
        }
        booleanScope = {
          kind: "targetBody",
          bodyId: { kind: "bodyOf", actionIndex: bodyOrderedIndex },
        };
      }

      createFeatures.push({
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
            extent: extrude.extent,
            operation: extrude.operation,
            booleanScope,
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
    }
  }

  if (input.plan.requiresStudioBake) {
    const bakedMeshBytes =
      input.materializeBake && input.read.studio.groundTruth.hasBodies
        ? encodeCapturedTessellationAsBakedMeshBytes(
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

  diagnostics.push({
    severity: "info",
    message: `Fidelity: ${input.plan.tierCounts.parametric} parametric, ${input.plan.tierCounts.baked} baked, ${input.plan.tierCounts.geometryOnly} geometry-only.`,
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
      ? selected.featurePlans.map((plan) =>
          summaryField(
            `feature-${plan.onshapeFeatureId}`,
            plan.label,
            `${plan.tier}${plan.suppressed ? " (suppressed)" : ""} — ${plan.reasonCodes.join(", ")}`,
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
          id: "fidelity-report",
          title: "Per-feature fidelity",
          fields: reportFields,
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
