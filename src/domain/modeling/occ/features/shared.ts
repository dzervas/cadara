import type { GeometryAssetResolver } from "@/contracts/modeling/adapter";
import type {
  ConstructionSnapshotRecord,
  FeatureDefinition,
  ModelingDiagnostic,
  SketchSnapshotRecord,
  SnapshotEntityRecord,
} from "@/contracts/modeling/schema";
import type { RenderableEntityRecord } from "@/contracts/render/schema";
import type { RegionRecord } from "@/contracts/sketch/schema";
import type {
  BodyId,
  ConstructionId,
  EdgeId,
  FaceId,
  FeatureId,
  GeometryAssetId,
  VertexId,
} from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import type {
  GeometryAssetFormat,
  GeometryAssetHash,
  GeometryAssetRecord,
} from "@/contracts/modeling/geometry-assets";
import { OCC_CONTRACT_GAP_CODES } from "@/domain/modeling/occ/implementation-policy";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import type { OccFeatureTopologyStage } from "@/domain/modeling/occ/topology-stage";
import {
  extractSolidShapes,
  getOccDurableRefKey,
  trackNewSolidBody,
  type OccTrackedBody,
  type OccReferenceInvalidationRecord,
  type OccReferenceState,
} from "@/domain/modeling/occ/topology";

export interface OccResolvedGeometryAsset {
  bytes: Uint8Array;
  format: GeometryAssetFormat;
}

export interface OccMaterializedBakedShape {
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
  meshTriangles: NonNullable<OccTrackedBody["meshExportFallback"]>;
}

export interface OccFeatureExecutionContext {
  oc: OpenCascadeInstance;
  documentId: `doc_${string}`;
  revisionId: `rev_${string}`;
  modelingTolerance: number;
  sketches: readonly SketchSnapshotRecord[];
  constructions: readonly ConstructionSnapshotRecord[];
  /** Authored variables used when replay resolves a source operation definition. */
  variables?: readonly import("@/contracts/modeling/schema").DocumentVariableRecord[];
  constructionPlanes: ReadonlyMap<ConstructionId, SketchPlaneDefinition>;
  bodies: readonly OccTrackedBody[];
  assets: { records: readonly GeometryAssetRecord[] };
  assetBlobs: ReadonlyMap<GeometryAssetHash, Uint8Array>;
  assetResolver?: GeometryAssetResolver;
  resolvedGeometryAssets: Map<GeometryAssetId, OccResolvedGeometryAsset>;
  bakedShapeCache: Map<GeometryAssetId, OccMaterializedBakedShape[]>;
  referenceState?: OccReferenceState;
  previousTopologyStage: OccFeatureTopologyStage | null;
  /** Earlier authored feature definitions available to exact operation replay. */
  authoredFeatures?: readonly {
    featureId: FeatureId;
    definition: FeatureDefinition;
  }[];
}

export interface OccFeatureExecutionResult {
  bodies: OccTrackedBody[];
  constructions: ConstructionSnapshotRecord[];
  constructionPlanes: Map<ConstructionId, SketchPlaneDefinition>;
  featureDefinition?: FeatureDefinition;
  assetRecords?: GeometryAssetRecord[];
  producedTargets: DurableRef[];
  entities: SnapshotEntityRecord[];
  renderRecords: RenderableEntityRecord[];
  historyInvalidations: Map<string, OccReferenceInvalidationRecord>;
  topologyStage?: OccFeatureTopologyStage;
  diagnostics?: ModelingDiagnostic[];
}

export interface OccFeaturePresentationArtifacts {
  entities: SnapshotEntityRecord[];
  renderRecords: RenderableEntityRecord[];
}

export function requireSketchSnapshot(
  context: OccFeatureExecutionContext,
  sketchId: SketchSnapshotRecord["sketchId"],
) {
  const sketch = context.sketches.find((entry) => entry.sketchId === sketchId);

  if (!sketch) {
    throw new Error(
      `Sketch ${sketchId} does not resolve in the current OCC authoring state.`,
    );
  }

  return sketch;
}

export function getOccEnumNumericValue(value: unknown) {
  if (typeof value === "number") {
    return value;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    typeof (value as { value?: unknown }).value === "number"
  ) {
    return (value as { value: number }).value;
  }
  return null;
}

export function isOccEnumValue(actual: unknown, expected: unknown) {
  const actualValue = getOccEnumNumericValue(actual);
  const expectedValue = getOccEnumNumericValue(expected);
  return (
    actualValue !== null &&
    expectedValue !== null &&
    actualValue === expectedValue
  );
}

export function describeOccEnumValue(
  enumObject: Record<string, unknown>,
  value: unknown,
) {
  const numericValue = getOccEnumNumericValue(value);
  if (numericValue === null) {
    return String(value);
  }
  for (const [key, candidate] of Object.entries(enumObject)) {
    if (getOccEnumNumericValue(candidate) === numericValue) {
      return `${key} (${numericValue})`;
    }
  }
  return String(numericValue);
}

export function resolveCompatibleRegion(
  regions: readonly RegionRecord[],
  regionId: RegionRecord["regionId"],
) {
  const exact = regions.find((entry) => entry.regionId === regionId);
  if (exact) {
    return exact;
  }

  // Region labels before canonical boundary naming used the traversal-start
  // segment. The stable boundary hash suffix did not change, so accept a unique
  // hash match when replaying persisted features authored with the old label.
  const separatorIndex = regionId.lastIndexOf("-");
  const stableHash = separatorIndex >= 0 ? regionId.slice(separatorIndex + 1) : "";
  const compatible = stableHash
    ? regions.filter((entry) => entry.regionId.endsWith(`-${stableHash}`))
    : [];
  return compatible.length === 1 ? compatible[0]! : null;
}

export function requireRegion(
  sketch: SketchSnapshotRecord,
  regionId: RegionRecord["regionId"],
) {
  const region = resolveCompatibleRegion(sketch.sketch.regions, regionId);
  if (region) {
    return region;
  }

  throw new Error(
    `Sketch region ${regionId} does not resolve on sketch ${sketch.sketchId}.`,
  );
}

export function requireBody(
  context: OccFeatureExecutionContext,
  bodyId: BodyId,
) {
  const body = context.bodies.find((entry) => entry.bodyId === bodyId);

  if (!body) {
    throw new Error(
      `Body ${bodyId} does not resolve in the current OCC authoring state.`,
    );
  }

  return body;
}

function assertTopologyReferenceLive(
  context: OccFeatureExecutionContext,
  target: Extract<DurableRef, { kind: "face" | "edge" | "vertex" }>,
) {
  const invalidated = context.referenceState?.invalidatedReferencesByKey.get(
    getOccDurableRefKey(target),
  );
  if (invalidated?.invalidation) {
    throw new Error(
      `occ-invalid-reference: ${target.kind} reference was invalidated with reason ${invalidated.invalidation.reason}.`,
    );
  }
}

type NativeMarshalableTarget = Extract<
  DurableRef,
  { kind: "face" | "edge" | "vertex" }
>;

export function resolveNativeTopologyTargetId(
  body: OccTrackedBody,
  target: NativeMarshalableTarget,
): FaceId | EdgeId | VertexId {
  const resolve = <Id extends FaceId | EdgeId | VertexId>(
    aliases: ReadonlyMap<Id, Id> | undefined,
    publicId: Id,
  ) => {
    if (!aliases) {
      return publicId;
    }

    const nativeIds = [...aliases]
      .filter(([, aliasPublicId]) => aliasPublicId === publicId)
      .map(([nativeId]) => nativeId);
    if (nativeIds.length > 1) {
      throw new Error(
        `occ-native-target-ambiguous: ${target.kind} ${publicId} resolves to multiple native ids.`,
      );
    }
    return nativeIds[0] ?? publicId;
  };

  if (target.bodyId !== body.bodyId) {
    throw new Error(
      `occ-native-target-body-mismatch: ${target.kind} target belongs to ${target.bodyId}, not ${body.bodyId}.`,
    );
  }

  if (target.kind === "face") {
    return resolve(body.nativeTopologyIdAliases?.faceIdsByNativeId, target.faceId);
  }
  if (target.kind === "edge") {
    return resolve(body.nativeTopologyIdAliases?.edgeIdsByNativeId, target.edgeId);
  }
  return resolve(body.nativeTopologyIdAliases?.vertexIdsByNativeId, target.vertexId);
}

export function requireFace(
  context: OccFeatureExecutionContext,
  body: OccTrackedBody,
  faceId: `face_${string}`,
) {
  assertTopologyReferenceLive(context, { kind: "face", bodyId: body.bodyId, faceId });
  const nativeFaceId = resolveNativeTopologyTargetId(body, {
    kind: "face",
    bodyId: body.bodyId,
    faceId,
  }) as `face_${string}`;
  const face = body.facesById.get(nativeFaceId) ?? body.facesById.get(faceId);

  if (!face) {
    throw new Error(`Face ${faceId} does not resolve on body ${body.bodyId}.`);
  }

  return face;
}

export function requireEdge(
  context: OccFeatureExecutionContext,
  body: OccTrackedBody,
  edgeId: `edge_${string}`,
) {
  assertTopologyReferenceLive(context, { kind: "edge", bodyId: body.bodyId, edgeId });
  const nativeEdgeId = resolveNativeTopologyTargetId(body, {
    kind: "edge",
    bodyId: body.bodyId,
    edgeId,
  }) as `edge_${string}`;
  const edge = body.edgesById.get(nativeEdgeId) ?? body.edgesById.get(edgeId);

  if (!edge) {
    throw new Error(`Edge ${edgeId} does not resolve on body ${body.bodyId}.`);
  }

  return edge;
}

export function requireVertex(
  context: OccFeatureExecutionContext,
  body: OccTrackedBody,
  vertexId: `vertex_${string}`,
) {
  assertTopologyReferenceLive(context, {
    kind: "vertex",
    bodyId: body.bodyId,
    vertexId,
  });
  const nativeVertexId = resolveNativeTopologyTargetId(body, {
    kind: "vertex",
    bodyId: body.bodyId,
    vertexId,
  }) as `vertex_${string}`;
  const vertex = body.verticesById.get(nativeVertexId) ?? body.verticesById.get(vertexId);

  if (!vertex) {
    throw new Error(
      `Vertex ${vertexId} does not resolve on body ${body.bodyId}.`,
    );
  }

  return vertex;
}

export function requireConstructionPlaneDefinition(
  context: OccFeatureExecutionContext,
  constructionId: ConstructionId,
) {
  const plane = context.constructionPlanes.get(constructionId);

  if (!plane) {
    throw new Error(
      `${OCC_CONTRACT_GAP_CODES.constructionPlaneGeometryUnavailable}: Construction plane ${constructionId} does not expose internal plane geometry.`,
    );
  }

  return plane;
}

export function allocateBodyId(featureId: FeatureId) {
  return `body_${featureId}` as BodyId;
}

export function trackSingleResultBody(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  label: string,
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
) {
  const solids = extractSolidShapes(context.oc, shape);

  if (solids.length !== 1) {
    throw new Error(
      `Feature ${ownerFeatureId} produced ${solids.length} solids; Phase 4 only accepts single-solid body results.`,
    );
  }

  const bodyId = allocateBodyId(ownerFeatureId);
  return trackNewSolidBody(context.oc, {
    bodyId,
    label,
    ownerFeatureId,
    shape: solids[0]!,
  });
}

export function trackNewBodyResults(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  label: string,
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
) {
  const solids = extractSolidShapes(context.oc, shape);

  if (solids.length === 1) {
    return [trackSingleResultBody(context, ownerFeatureId, label, shape)];
  }

  if (solids.length === 0) {
    throw new Error(
      `Feature ${ownerFeatureId} produced 0 solids; Phase 4 only accepts solid body results.`,
    );
  }

  return solids.map((solid, index) =>
    trackNewSolidBody(context.oc, {
      bodyId: `body_${ownerFeatureId}_${index + 1}` as BodyId,
      label: `${label}_${index + 1}`,
      ownerFeatureId,
      shape: solid,
    }),
  );
}

/**
 * Rebuild-failure attribution slots. A thrown error tagged with a slot lets the
 * kernel adapter attribute the failure to the authored field that owns it
 * (profile selection, extent end condition, or boolean scope) instead of
 * blaming the profile by default.
 */
export const REBUILD_SLOTS = ["profile", "extent", "scope"] as const;

export type RebuildSlot = (typeof REBUILD_SLOTS)[number];

/**
 * Tag an error with the rebuild slot that owns the failure. The first (inner)
 * tag wins so the most specific attribution is preserved as the error unwinds.
 * The error is annotated and rethrown by the caller; it is never swallowed.
 */
export function tagRebuildSlot(error: unknown, slot: RebuildSlot): unknown {
  if (error instanceof Error && !("rebuildSlot" in error)) {
    Object.defineProperty(error, "rebuildSlot", {
      value: slot,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  return error;
}

export function getRebuildSlot(error: unknown): RebuildSlot | null {
  if (
    error instanceof Error &&
    "rebuildSlot" in error &&
    typeof (error as { rebuildSlot?: unknown }).rebuildSlot === "string"
  ) {
    const slot = (error as { rebuildSlot: string }).rebuildSlot;
    return (REBUILD_SLOTS as readonly string[]).includes(slot)
      ? (slot as RebuildSlot)
      : null;
  }
  return null;
}

/**
 * Run a rebuild sub-phase, tagging any thrown error with `slot` before
 * rethrowing so upstream diagnostics can attribute the failure honestly.
 */
export function runInRebuildSlot<T>(slot: RebuildSlot, run: () => T): T {
  try {
    return run();
  } catch (error) {
    throw tagRebuildSlot(error, slot);
  }
}
