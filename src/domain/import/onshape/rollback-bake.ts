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

/** Encode an Onshape tessellated-faces payload as Cadara baked-mesh bytes. */
export function encodeOnshapeTessellationAsBakedMeshBytes(
  tessellatedFaces: unknown,
): Uint8Array | null {
  if (typeof tessellatedFaces !== "object" || tessellatedFaces === null) return null;
  const bodies = (tessellatedFaces as { bodies?: unknown }).bodies;
  if (!Array.isArray(bodies) || bodies.length === 0) return null;

  const vertices: [number, number, number][] = [];
  const indices: [number, number, number][] = [];
  const components: {
    sourceComponentKey: string;
    indexStart: number;
    indexCount: number;
  }[] = [];

  for (const [bodyIndex, body] of bodies.entries()) {
    const faces = (body as { faces?: unknown }).faces;
    if (!Array.isArray(faces)) return null;
    const indexStart = indices.length;
    for (const face of faces) {
      const facets = (face as { facets?: unknown }).facets;
      if (!Array.isArray(facets)) return null;
      for (const facet of facets) {
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

/** Encode the v2 post-feature checkpoint used to replace one failed consumer. */
export function encodeRollbackSnapshotBake(
  snapshot: OnshapeRollbackSnapshot | null,
): Uint8Array | null {
  return snapshot
    ? encodeOnshapeTessellationAsBakedMeshBytes(snapshot.tessellatedFaces)
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
  replacementActionIndexes: readonly number[];
}): Promise<RollbackCheckpointBakeResult> {
  const bytes = encodeRollbackSnapshotBake(input.snapshot);
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
            featureSpan: {
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
