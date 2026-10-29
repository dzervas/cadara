import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import type {
  RenderMeshGeometry,
  RenderableEntityRecord,
} from "@/contracts/render/schema";

/**
 * The meshes of the last delivered snapshot by renderable id. Every
 * delivered snapshot carries fresh copies of its typed arrays; a mesh whose
 * arrays equal the previous one's keeps the previous geometry object, so
 * label/appearance-only changes keep the viewport's GPU geometry.
 */
export type RenderMeshIdentityCache = Map<string, RenderMeshGeometry>;

export function createRenderMeshIdentityCache(): RenderMeshIdentityCache {
  return new Map();
}

export function keepUnchangedRenderMeshes(
  records: readonly RenderableEntityRecord[],
  cache: RenderMeshIdentityCache,
) {
  const kept = records.map((record): RenderableEntityRecord => {
    if (record.geometry.kind !== "mesh") {
      return record;
    }

    const previous = cache.get(record.id);
    return previous &&
      previous !== record.geometry &&
      renderMeshesEqual(previous, record.geometry)
      ? { ...record, geometry: previous }
      : record;
  });

  cache.clear();
  for (const record of kept) {
    if (record.geometry.kind === "mesh") {
      cache.set(record.id, record.geometry);
    }
  }

  return kept;
}

function renderMeshesEqual(
  left: RenderMeshGeometry,
  right: RenderMeshGeometry,
) {
  return (
    typedArraysEqual(left.vertexPositions, right.vertexPositions) &&
    typedArraysEqual(left.triangleIndices, right.triangleIndices) &&
    (left.vertexNormals === null || right.vertexNormals === null
      ? left.vertexNormals === right.vertexNormals
      : typedArraysEqual(left.vertexNormals, right.vertexNormals))
  );
}

function typedArraysEqual(
  left: Float32Array | Uint32Array,
  right: Float32Array | Uint32Array,
) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function keepUnchangedSnapshotRenderMeshes(
  snapshot: WorkspaceSnapshot,
  cache: RenderMeshIdentityCache,
): WorkspaceSnapshot {
  return {
    ...snapshot,
    document: {
      ...snapshot.document,
      render: {
        ...snapshot.document.render,
        records: keepUnchangedRenderMeshes(
          snapshot.document.render.records,
          cache,
        ),
      },
    },
  };
}
