import type { OnshapeRollbackSnapshot } from "@/contracts/import/onshape-capture-bundle";
import type {
  ImportCapabilities,
} from "@/contracts/import/capabilities";
import type {
  ImportTopologyFallbackCreateFeatureRequest,
} from "@/contracts/import/actions";
import { BAKED_BODY_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";

function readCapturedPoint(value: unknown): [number, number, number] | null {
  if (typeof value !== "object" || value === null) return null;
  const point = value as { x?: unknown; y?: unknown; z?: unknown };
  return typeof point.x === "number" &&
    typeof point.y === "number" &&
    typeof point.z === "number"
    ? [point.x * 1000, point.y * 1000, point.z * 1000]
    : null;
}

/** Encode Onshape bodies in capture order, retaining each deterministic source ID. */
export function encodeOnshapeTessellationAsBakedMeshBytes(
  tessellatedFaces: unknown,
  selectedBodyDeterministicIds?: readonly string[],
): Uint8Array | null {
  if (typeof tessellatedFaces !== "object" || tessellatedFaces === null) return null;
  const rawBodies = (tessellatedFaces as { bodies?: unknown }).bodies;
  if (!Array.isArray(rawBodies) || rawBodies.length === 0) return null;

  const selectedIds = selectedBodyDeterministicIds
    ? new Set(selectedBodyDeterministicIds)
    : null;
  if (selectedIds && selectedIds.size !== selectedBodyDeterministicIds?.length) return null;

  const bodies: { id: string; faces: unknown[] }[] = [];
  const capturedIds = new Set<string>();
  for (const rawBody of rawBodies) {
    if (typeof rawBody !== "object" || rawBody === null) return null;
    const body = rawBody as { id?: unknown; faces?: unknown };
    if (typeof body.id !== "string" || body.id.length === 0 || capturedIds.has(body.id)) {
      return null;
    }
    capturedIds.add(body.id);
    if (!Array.isArray(body.faces)) return null;
    if (!selectedIds || selectedIds.has(body.id)) {
      bodies.push({ id: body.id, faces: body.faces });
    }
  }
  if (selectedIds && [...selectedIds].some((id) => !capturedIds.has(id))) return null;
  if (bodies.length === 0) return null;

  const vertices: [number, number, number][] = [];
  const indices: [number, number, number][] = [];
  const components: {
    sourceComponentKey: string;
    indexStart: number;
    indexCount: number;
  }[] = [];

  for (const body of bodies) {
    const indexStart = indices.length;
    for (const face of body.faces) {
      if (typeof face !== "object" || face === null) return null;
      const facets = (face as { facets?: unknown }).facets;
      if (!Array.isArray(facets)) return null;
      for (const facet of facets) {
        if (typeof facet !== "object" || facet === null) return null;
        const rawVertices = (facet as { vertices?: unknown }).vertices;
        if (!Array.isArray(rawVertices) || rawVertices.length !== 3) return null;
        const points = rawVertices.map(readCapturedPoint);
        if (points.some((point) => point === null)) return null;
        const start = vertices.length;
        vertices.push(...(points as [number, number, number][]));
        indices.push([start, start + 1, start + 2]);
      }
    }
    const indexCount = indices.length - indexStart;
    if (indexCount === 0) return null;
    components.push({
      sourceComponentKey: `onshape-body:${body.id}`,
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

/** Encode the selected v2 post-feature checkpoint bodies. */
export function encodeRollbackSnapshotBake(
  snapshot: OnshapeRollbackSnapshot | null,
  checkpointBodyDeterministicIds?: readonly string[],
): Uint8Array | null {
  return snapshot
    ? encodeOnshapeTessellationAsBakedMeshBytes(
        snapshot.tessellatedFaces,
        checkpointBodyDeterministicIds,
      )
    : null;
}

export type RollbackCheckpointBakeResult =
  | {
      kind: "ready";
      request: ImportTopologyFallbackCreateFeatureRequest;
    }
  | {
      kind: "missing";
      reason: "topology-bake-snapshot-missing";
    };

/** Prepare the post-feature baked replacement paired with a topology consumer. */
export async function prepareRollbackCheckpointBake(input: {
  snapshot: OnshapeRollbackSnapshot | null;
  capabilities: ImportCapabilities;
  featureLabel: string;
  studioElementId: string;
  studioName: string;
  checkpointBodyDeterministicIds?: readonly string[];
  provenanceFeatureSpan?: {
    fromFeatureId: string;
    toFeatureId: string;
  };
  replacementActionIndexes: readonly number[];
}): Promise<RollbackCheckpointBakeResult> {
  const bytes = encodeRollbackSnapshotBake(
    input.snapshot,
    input.checkpointBodyDeterministicIds,
  );
  if (!bytes || !input.snapshot) {
    return { kind: "missing", reason: "topology-bake-snapshot-missing" };
  }
  const asset = await input.capabilities.modeling.bakeGeometry({
    bytes,
    format: "baked-mesh",
  });
  return {
    kind: "ready",
    request: {
      contractVersion: input.capabilities.context.contractVersion,
      documentId: input.capabilities.context.documentId,
      baseRevisionId: input.capabilities.context.baseRevisionId,
      featureLabel: input.featureLabel,
      definition: {
        kind: "bakedBody",
        featureTypeVersion: BAKED_BODY_FEATURE_SCHEMA_VERSION,
        parameters: {
          ...asset,
          label: input.featureLabel,
          provenance: {
            source: "onshape",
            sourceId: input.studioElementId,
            sourceName: input.studioName,
            featureSpan: input.provenanceFeatureSpan ?? {
              fromFeatureId: input.snapshot.featureId,
              toFeatureId: input.snapshot.featureId,
            },
            reason: "topology-checkpoint-fallback",
          },
          replacement: {
            kind: "replaceBodyOutputs",
            actionIndexes: input.replacementActionIndexes,
          },
        },
      },
    },
  };
}
