import type {
  ConstructionSnapshotRecord,
  FeatureDefinition,
  ModelingDiagnostic,
  SketchSnapshotRecord,
} from "@/contracts/modeling/schema";
import type { RenderableEntityRecord } from "@/contracts/render/schema";
import type { RegionRecord } from "@/contracts/sketch/schema";
import type { BodyId, ConstructionId, FeatureId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import type {
  GeometryAssetHash,
  GeometryAssetRecord,
} from "@/contracts/modeling/geometry-assets";
import { OCC_CONTRACT_GAP_CODES } from "@/domain/modeling/occ/implementation-policy";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import {
  extractSolidShapes,
  trackNewSolidBody,
  type OccTrackedBody,
  type OccReferenceInvalidationRecord,
} from "@/domain/modeling/occ/topology";
import type { SnapshotEntityRecord } from "@/contracts/modeling/schema";

export interface OccFeatureExecutionContext {
  oc: OpenCascadeInstance;
  documentId: `doc_${string}`;
  revisionId: `rev_${string}`;
  modelingTolerance: number;
  sketches: readonly SketchSnapshotRecord[];
  constructions: readonly ConstructionSnapshotRecord[];
  constructionPlanes: ReadonlyMap<ConstructionId, SketchPlaneDefinition>;
  bodies: readonly OccTrackedBody[];
  assets: { records: readonly GeometryAssetRecord[] };
  assetBlobs: ReadonlyMap<GeometryAssetHash, Uint8Array>;
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

export function requireRegion(
  sketch: SketchSnapshotRecord,
  regionId: RegionRecord["regionId"],
) {
  const region = sketch.sketch.regions.find(
    (entry) => entry.regionId === regionId,
  );

  if (!region) {
    throw new Error(
      `Sketch region ${regionId} does not resolve on sketch ${sketch.sketchId}.`,
    );
  }

  return region;
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

export function requireFace(body: OccTrackedBody, faceId: `face_${string}`) {
  const face = body.facesById.get(faceId);

  if (!face) {
    throw new Error(`Face ${faceId} does not resolve on body ${body.bodyId}.`);
  }

  return face;
}

export function requireEdge(body: OccTrackedBody, edgeId: `edge_${string}`) {
  const edge = body.edgesById.get(edgeId);

  if (!edge) {
    throw new Error(`Edge ${edgeId} does not resolve on body ${body.bodyId}.`);
  }

  return edge;
}

export function requireVertex(
  body: OccTrackedBody,
  vertexId: `vertex_${string}`,
) {
  const vertex = body.verticesById.get(vertexId);

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
