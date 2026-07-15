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
  onshapeFeatureTranslatorRegistry,
  planStudioFidelity,
  type FeaturePlan,
  type FidelityTier,
  type PlanReasonCode,
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
import { extractSketchPlaneDeterministicId } from "@/domain/import/onshape/fidelity-planner";
import type { OnshapeGeometricSignature } from "@/contracts/import/onshape-capture-bundle";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import { encodeOnshapeTessellationAsBakedMeshBytes } from "@/domain/import/onshape/rollback-bake";
import { probeTopologyConsumerPrefixes } from "@/domain/import/onshape/topology-resolution-planner";
import { OCC_KERNEL_CAPABILITIES } from "@/domain/modeling/opencascade-kernel-seed";
import { readTopologyQueryRefs } from "@/domain/import/onshape/topology-query-reader";
import { resolveTopologyReferences } from "@/domain/import/onshape/topology-reference-resolver";
import { createRollbackTopologyTimeline } from "@/domain/import/onshape/rollback-topology-reader";
import { DEFAULT_MATCH_TOLERANCE } from "@/domain/import/onshape/signature-matcher";
import { buildResolvedBodyConsumerDefinition } from "@/domain/import/onshape/wave-b-body-feature-translators";
import { prepareRollbackCheckpointBake } from "@/domain/import/onshape/rollback-bake";
import { resolveOnshapeSketchProfiles } from "@/domain/import/onshape/profile-resolver";

const ACCEPTED_EXTENSION = ".onshape-capture.json";

export interface OnshapeStudioReview {
  elementId: string;
  name: string;
  hasBodies: boolean;
  featurePlans: FeaturePlan[];
  tierCounts: Record<FidelityTier, number>;
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
    const match = queryString.match(/\$([A-Za-z0-9_]+)planeOp/);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
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

function featureParameter(
  feature: ReturnType<typeof readPartStudio>["features"][number],
  parameterId: string,
): Record<string, unknown> | null {
  const parameter = feature.parameters?.find(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as { parameterId?: unknown }).parameterId === parameterId,
  );
  return (parameter as Record<string, unknown> | undefined) ?? null;
}

function parameterQueryStrings(parameter: Record<string, unknown> | null): string[] {
  return Array.isArray(parameter?.queries)
    ? parameter.queries.flatMap((query) => {
        const value = (query as { queryString?: unknown }).queryString;
        return typeof value === "string" ? [value] : [];
      })
    : [];
}

function parameterDeterministicIds(parameter: Record<string, unknown> | null): string[] {
  return Array.isArray(parameter?.queries)
    ? parameter.queries.flatMap((query) => {
        const values = (query as { deterministicIds?: unknown }).deterministicIds;
        return Array.isArray(values)
          ? values.filter((value): value is string => typeof value === "string")
          : [];
      })
    : [];
}

function dot3(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function subtract3(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): [number, number, number] {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

/**
 * Re-plan the probe-gated Onshape NEW extrude that consumes a captured planar
 * sketch region and terminates at a vertex owned by another imported sketch.
 * The source query remains live through deferred sketch ids/point ids; no
 * coordinate snapshot is substituted for the authored up-to relationship.
 */
function promoteProbeBackedSketchVertexExtrudes(input: {
  read: ReturnType<typeof readPartStudio>;
  plan: OnshapeStudioPlan;
}): OnshapeStudioPlan {
  const referencesById = new Map(
    input.read.studio.resolvedReferences.map((reference) => [
      reference.deterministicId,
      reference,
    ]),
  );
  const plansById = new Map(
    input.plan.featurePlans.map((featurePlan) => [
      featurePlan.onshapeFeatureId,
      featurePlan,
    ]),
  );
  const promoted = input.plan.featurePlans.map((featurePlan) => {
    if (
      featurePlan.featureType !== "extrude" ||
      featurePlan.tier === "parametric"
    ) {
      return featurePlan;
    }
    const feature = input.read.features.find(
      (candidate) => candidate.featureId === featurePlan.onshapeFeatureId,
    );
    if (
      !feature ||
      featureParameter(feature, "operationType")?.value !== "NEW" ||
      featureParameter(feature, "endBound")?.value !== "UP_TO_VERTEX"
    ) {
      return featurePlan;
    }

    const profileReference = parameterDeterministicIds(
      featureParameter(feature, "entities"),
    )
      .map((id) => referencesById.get(id))
      .find(
        (reference) =>
          reference &&
          "signature" in reference &&
          reference.signature.entityClass === "face" &&
          reference.signature.geometryType === "plane",
      );
    if (!profileReference || !("signature" in profileReference)) {
      return featurePlan;
    }
    const signature = scaleCapturedSignatureToDocumentUnits(
      profileReference.signature,
    );
    const centroid = signature.centroid;
    const normal = (
      signature.definingData as { normal?: [number, number, number] } | undefined
    )?.normal;
    if (!centroid || !normal) return featurePlan;

    const profileCandidates = input.plan.featurePlans.flatMap((sketchPlan) => {
      if (
        sketchPlan.featureType !== "newSketch" ||
        sketchPlan.tier !== "parametric" ||
        sketchPlan.target.kind !== "sketch"
      ) {
        return [];
      }
      const solved = input.read.solvedSketchesByFeatureId.get(
        sketchPlan.onshapeFeatureId,
      );
      const translation = projectSketchForPlan({
        read: input.read,
        featurePlan: sketchPlan,
      });
      if (!solved || !translation) return [];
      const frame = translation.plane.frame;
      const planeDistance = Math.abs(dot3(subtract3(centroid, frame.origin), frame.normal));
      if (
        Math.abs(dot3(normal, frame.normal)) < 0.999 ||
        planeDistance > 0.1
      ) {
        return [];
      }
      const profiles = resolveOnshapeSketchProfiles({
        profileParameter: {
          queries: [
            {
              queryString: `query = qSketchRegion(id + "${sketchPlan.onshapeFeatureId}", true);`,
            },
          ],
        },
        featureLabel: featurePlan.label,
        featureKind: "extrude",
        solvedSketch: solved,
        referencedSketch: {
          tier: "parametric",
          planeKey: sketchPlan.target.planeKey,
        },
      });
      return profiles.tier === "resolved" && profiles.profiles.length === 1
        ? [{ sketchPlan, translation, profiles: profiles.profiles }]
        : [];
    });
    if (profileCandidates.length !== 1) return featurePlan;
    const profile = profileCandidates[0]!;

    const vertexQuery = parameterQueryStrings(
      featureParameter(feature, "endBoundEntityVertex"),
    )[0];
    const sourceFeatureId = vertexQuery?.match(
      /\$([A-Za-z0-9_]+)wireOp/,
    )?.[1];
    const endpointMatch = vertexQuery?.match(
      /sketchEntityIdS[^$]*\$([^\x22]+?)(start|end)(?=\x22,id\);)/,
    );
    const sourcePlan = sourceFeatureId ? plansById.get(sourceFeatureId) : null;
    const sourceSolved = sourceFeatureId
      ? input.read.solvedSketchesByFeatureId.get(sourceFeatureId)
      : null;
    if (
      !sourceFeatureId ||
      !endpointMatch ||
      !sourcePlan ||
      sourcePlan.tier !== "parametric" ||
      sourcePlan.target.kind !== "sketch" ||
      !sourceSolved
    ) {
      return featurePlan;
    }
    const normalizedEntityId = endpointMatch[1]!.replace(/[^A-Za-z0-9]/g, "");
    const sourceEntity = sourceSolved.entities.find(
      (entity) =>
        entity.entityId.replace(/[^A-Za-z0-9]/g, "") === normalizedEntityId,
    );
    const sourceTranslation = projectSketchForPlan({
      read: input.read,
      featurePlan: sourcePlan,
    });
    const translatedEntity = sourceTranslation?.definition.entities.find(
      (entity) =>
        entity.label.replace(/[^A-Za-z0-9]/g, "") === normalizedEntityId,
    );
    if (
      !sourceEntity ||
      !translatedEntity ||
      translatedEntity.kind !== "lineSegment"
    ) {
      return featurePlan;
    }
    const endpoint = endpointMatch[2] === "start" ? sourceEntity.start3d : sourceEntity.end3d;
    if (!endpoint) return featurePlan;
    const endpointMm = endpoint.map((component) => component * 1000) as [
      number,
      number,
      number,
    ];
    const signedDistance = dot3(
      subtract3(endpointMm, profile.translation.plane.frame.origin),
      profile.translation.plane.frame.normal,
    );
    if (Math.abs(signedDistance) <= 1e-6) return featurePlan;

    return {
      ...featurePlan,
      tier: "parametric" as const,
      target: { kind: "feature" as const },
      reasonCodes: [],
      suppressed: false,
      inputFeatureIds: [profile.sketchPlan.onshapeFeatureId, sourceFeatureId],
      plannedExtrude: {
        sketchFeatureId: profile.sketchPlan.onshapeFeatureId,
        profiles: profile.profiles,
        extent: {
          mode: "oneSide" as const,
          end: {
            kind: "blind" as const,
            direction: signedDistance < 0 ? "negative" as const : "positive" as const,
            distance: { source: "literal" as const, value: Math.abs(signedDistance) },
          },
        },
        operation: { source: "literal" as const, value: "newBody" as const },
        boolean: { kind: "standalone" as const },
      },
    };
  });
  return recomputePlanWithFeaturePlans(
    input.plan,
    promoted,
    input.read.studio.groundTruth.hasBodies,
  );
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
  return recomputePlanWithFeaturePlans(
    input.plan,
    nextPlans,
    input.read.studio.groundTruth.hasBodies,
  );
}

function isCapturedFrameTranslation(plan: FeaturePlan): boolean {
  return (
    plan.tier === "parametric" &&
    (plan.reasonCodes.includes("plane-from-captured-frame") ||
      plan.reasonCodes.includes("sketch-on-translated-plane"))
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
    );
  }

  const topologyTimeline = createRollbackTopologyTimeline({
    featureIds: input.read.features.map((feature) => feature.featureId),
    snapshots: input.read.studio.rollbackSnapshots,
  });

  // Resolve body consumers in source order. Each successful consumer is inserted
  // before probing the next one, so every probe observes the exact growing prefix.
  for (const candidate of [...workingPlan.featurePlans]) {
    if (!candidate.plannedBodyTopologyConsumer) continue;
    const featureIdToOrderedPrefixPosition = new Map<string, number>();
    const prefixActions = await buildPreparedActions({
      read: input.read,
      plan: workingPlan,
      capabilities: input.capabilities,
      materializeBake: false,
      featureIdToOrderedPrefixPosition,
    });
    const [prefix] = await probeTopologyConsumerPrefixes({
      actions: prefixActions,
      featureIdToOrderedPrefixPosition,
      consumerFeatureIds: [candidate.onshapeFeatureId],
      history: input.capabilities.history,
    });
    const feature = input.read.features.find((entry) => entry.featureId === candidate.onshapeFeatureId);
    if (!feature || !prefix || prefix.status === "failed") continue;
    const queryRead = readTopologyQueryRefs(feature, candidate.plannedBodyTopologyConsumer.slots);
    const resolution = resolveTopologyReferences({
      consumerFeatureId: candidate.onshapeFeatureId,
      queries: queryRead.refs,
      queryDiagnostics: queryRead.diagnostics,
      capturedReferences: input.read.studio.resolvedReferences,
      rollback: topologyTimeline,
      cadaraSignatures: prefix.signatures,
      tolerance: { ...DEFAULT_MATCH_TOLERANCE, linear: Math.max(DEFAULT_MATCH_TOLERANCE.linear, 0.01) },
      durableNamingAvailable: OCC_KERNEL_CAPABILITIES.supportsDurableTopologyNaming,
    });
    workingPlan = recomputePlanWithFeaturePlans(
      workingPlan,
      workingPlan.featurePlans.map((plan) => {
        if (plan.onshapeFeatureId !== candidate.onshapeFeatureId) return plan;
        if (resolution.kind === "degraded") {
          return { ...plan, reasonCodes: [resolution.reason], suppressed: true };
        }
        if (candidate.plannedBodyTopologyConsumer!.unavailableReason) {
          return {
            ...plan,
            reasonCodes: [candidate.plannedBodyTopologyConsumer!.unavailableReason!],
            suppressed: true,
          };
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
    );
  }

  const featureIdToOrderedPrefixPosition = new Map<string, number>();
  const prefixActions = await buildPreparedActions({
    read: input.read,
    plan: workingPlan,
    capabilities: input.capabilities,
    materializeBake: false,
    featureIdToOrderedPrefixPosition,
  });
  const consumerIds = workingPlan.featurePlans
    .filter(
      (featurePlan) =>
        featurePlan.featureType === "newSketch" &&
        featurePlan.tier === "baked" &&
        featurePlan.reasonCodes.includes("needs-history-probe"),
    )
    .map((featurePlan) => featurePlan.onshapeFeatureId);
  const prefixResults = await probeTopologyConsumerPrefixes({
    actions: prefixActions,
    featureIdToOrderedPrefixPosition,
    consumerFeatureIds: consumerIds,
    history: input.capabilities.history,
  });
  const prefixSignatures = new Map(
    prefixResults.map((result) => [result.consumerFeatureId, result.signatures]),
  );
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

    if (!OCC_KERNEL_CAPABILITIES.supportsDurableTopologyNaming) {
      return {
        ...featurePlan,
        reasonCodes: ["topology-durable-naming-unavailable"],
      };
    }

    const probeSignatures = prefixSignatures.get(featurePlan.onshapeFeatureId) ?? [];
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
    if (!capturedSignature) return featurePlan;
    const match = matchSignature(capturedSignature, probeSignatures);
    if (match.kind !== "unique") return featurePlan;
    const probeSignature = probeSignatures.find(
      (signature) => referenceKey(signature.reference) === referenceKey(match.reference),
    );
    const plane = probeSignature ? planeFromProbeSignature(probeSignature) : null;
    if (!plane) return featurePlan;
    return {
      ...featurePlan,
      tier: "parametric" as const,
      target: { kind: "sketch" as const, planeKey: "xy" as const, plane },
      reasonCodes: ["sketch-on-probed-face" as const],
      suppressed: false,
    };
  });

  const sketchPromotedPlan = recomputePlanWithFeaturePlans(
    workingPlan,
    nextPlans,
    input.read.studio.groundTruth.hasBodies,
  );
  const extrudeCandidatePlan = promoteProbeBackedSketchVertexExtrudes({
    read: input.read,
    plan: sketchPromotedPlan,
  });
  const promotedExtrudeIds = extrudeCandidatePlan.featurePlans
    .filter((candidate, index) =>
      candidate.tier === "parametric" &&
      candidate.featureType === "extrude" &&
      sketchPromotedPlan.featurePlans[index]?.tier !== "parametric",
    )
    .map((candidate) => candidate.onshapeFeatureId);
  let finalPlan = sketchPromotedPlan;
  if (promotedExtrudeIds.length > 0) {
    const orderedPositionToFeatureId = new Map<number, string>();
    const candidateActions = await buildPreparedActions({
      read: input.read,
      plan: extrudeCandidatePlan,
      capabilities: input.capabilities,
      materializeBake: false,
      orderedPositionToFeatureId,
    });
    const validatingProbe = await input.capabilities.history.evaluateHistoryProbe({
      actions: candidateActions,
      includeFinalTessellation: true,
    });
    const failedPromotedExtrude = validatingProbe.steps.some(
      (step, index) =>
        step.status === "failed" &&
        promotedExtrudeIds.includes(orderedPositionToFeatureId.get(index) ?? ""),
    );
    if (!failedPromotedExtrude) {
      finalPlan = extrudeCandidatePlan;
      probeResult = validatingProbe;
    }
  }

  return { plan: finalPlan, probeResult };
}

async function reviewStudio(
  bundle: OnshapeCaptureBundle,
  elementId: string,
  capabilities: ImportCapabilities,
): Promise<OnshapeStudioReview> {
  const read = readPartStudio(bundle, elementId);
  const planned = planStudioFidelity(read);
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
  "sketch-on-probed-face": "sketch is supported on a resolved face",
  "sketch-on-captured-frame": "sketch is supported from its captured frame",
  "plane-from-captured-frame": "plane was translated from its captured frame",
  "sketch-on-translated-plane": "sketch is supported on a translated plane",
  "captured-frame-unresolvable": "captured frame could not be resolved",
  "translator-unavailable": "no translator is available for this feature",
  "custom-feature": "custom feature is not supported",
  "unsupported-feature": "feature type is not supported",
  "downstream-of-baked": "depends on previously baked geometry",
  "unreadable-feature": "feature parameters could not be read",
  "revolve-axis-unresolved": "revolve axis could not be resolved",
  "thicken-requires-topology": "thicken requires face topology that cannot be materialized",
  "sweep-path-unresolved": "sweep path could not be resolved as one supported curve",
  "loft-profile-unresolved": "ordered loft profiles could not be resolved",
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

function reviewFeatureDiagnostic(plan: FeaturePlan): string {
  const status = plan.suppressed ? " (suppressed)" : "";
  const reasons = plan.reasonCodes.length > 0
    ? plan.reasonCodes.map(reviewReasonCopy).join("; ")
    : "translated parametrically";
  return `${plan.tier}${status} — ${reasons}`;
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
  const plane = input.featurePlan.target.plane;
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
      if (featurePlan.target.constructionFromFeatureId) {
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

    if (featurePlan.target.kind === "feature" && featurePlan.plannedRevolve) {
      const revolve = featurePlan.plannedRevolve;
      const sketchOrderedIndex = orderedIndexByFeatureId.get(
        revolve.sketchFeatureId,
      );
      if (sketchOrderedIndex === undefined) {
        diagnostics.push({
          severity: "warning",
          message: `Revolve "${featurePlan.label}" referenced sketch ${revolve.sketchFeatureId}, which was not committed; the revolve was skipped.`,
          code: "onshape-revolve-missing-sketch",
        });
        continue;
      }

      const profiles = revolve.profiles.map(
        (profile): ImportDeferredProfileRef => ({
          kind: "regionOf",
          actionIndex: sketchOrderedIndex,
          selector: { kind: "interiorPoint", point: profile.interiorPoint },
        }),
      );
      if (profiles.length === 0) continue;

      createFeatures.push({
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
              sketchId: { kind: "sketchIdOf", actionIndex: sketchOrderedIndex },
              entityId: revolve.axisEntityId,
            },
            startAngle: revolve.startAngle,
            extent: revolve.extent,
            operation: { source: "literal", value: "newBody" },
            booleanScope: { kind: "standalone" },
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

    if (featurePlan.target.kind === "feature" && featurePlan.plannedAdvancedSolid) {
      const request: ImportCreateFeatureRequest = {
        contractVersion: context.contractVersion,
        documentId: context.documentId,
        baseRevisionId: context.baseRevisionId,
        featureLabel: featurePlan.label,
        definition: featurePlan.plannedAdvancedSolid,
      };
      if (input.materializeBake) {
        const timeline = createRollbackTopologyTimeline({
          featureIds: input.read.features.map((feature) => feature.featureId),
          snapshots: input.read.studio.rollbackSnapshots,
        });
        const checkpoint = await prepareRollbackCheckpointBake({
          snapshot: timeline.snapshotAfterFeature(featurePlan.onshapeFeatureId)?.source ?? null,
          capabilities: input.capabilities,
          featureLabel: `${featurePlan.label} topology fallback`,
          studioElementId: input.read.studio.elementId,
          studioName: input.read.studio.name,
          replacementActionIndexes: orderedActions.map((_, index) => index),
        });
        if (checkpoint.kind === "ready") request.topologyFallback = checkpoint.request;
      }
      createFeatures.push(request);
      orderedActions.push({ kind: "createFeature", index: createFeatures.length - 1 });
      orderedIndexByFeatureId.set(featurePlan.onshapeFeatureId, orderedActions.length - 1);
      input.orderedPositionToFeatureId?.set(orderedActions.length - 1, featurePlan.onshapeFeatureId);
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
            `${reviewFeatureDiagnostic(plan)}${relationships}`,
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
