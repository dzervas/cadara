import type {
  RenderMeshGeometry,
  RenderPoint3D,
  RenderableEntityRecord,
} from "@/contracts/render/schema";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";

export interface PackedTypedArrayView {
  buffer: ArrayBuffer;
  byteOffset: number;
  byteLength: number;
  elementCount: number;
}

export interface PackedMeshGeometry {
  kind: "packedMesh";
  vertexPositions: PackedTypedArrayView;
  vertexNormals: PackedTypedArrayView | null;
  triangleIndices: PackedTypedArrayView;
}

export type PackedRenderableEntityRecord = Omit<
  RenderableEntityRecord,
  "geometry"
> & {
  geometry:
    | Exclude<RenderableEntityRecord["geometry"], RenderMeshGeometry>
    | PackedMeshGeometry;
};

export type PackedWorkspaceSnapshot = Omit<WorkspaceSnapshot, "document"> & {
  document: Omit<WorkspaceSnapshot["document"], "render"> & {
    render: Omit<WorkspaceSnapshot["document"]["render"], "records"> & {
      records: PackedRenderableEntityRecord[];
    };
  };
};

export function packMeshGeometry(
  geometry: RenderMeshGeometry,
): PackedMeshGeometry {
  const positions = new Float32Array(geometry.vertexPositions.length * 3);
  const normals = geometry.vertexNormals
    ? new Float32Array(geometry.vertexNormals.length * 3)
    : null;
  const indices = new Uint32Array(geometry.triangleIndices.length * 3);

  writePointTriplets(positions, geometry.vertexPositions);
  if (normals && geometry.vertexNormals) {
    writePointTriplets(normals, geometry.vertexNormals);
  }

  geometry.triangleIndices.forEach((triangle, index) => {
    const offset = index * 3;
    indices[offset] = triangle[0];
    indices[offset + 1] = triangle[1];
    indices[offset + 2] = triangle[2];
  });

  return {
    kind: "packedMesh",
    vertexPositions: createPackedView(positions),
    vertexNormals: normals ? createPackedView(normals) : null,
    triangleIndices: createPackedView(indices),
  };
}

export function unpackMeshGeometry(
  geometry: PackedMeshGeometry,
): RenderMeshGeometry {
  const positions = new Float32Array(
    geometry.vertexPositions.buffer,
    geometry.vertexPositions.byteOffset,
    geometry.vertexPositions.elementCount,
  );
  const normals = geometry.vertexNormals
    ? new Float32Array(
        geometry.vertexNormals.buffer,
        geometry.vertexNormals.byteOffset,
        geometry.vertexNormals.elementCount,
      )
    : null;
  const indices = new Uint32Array(
    geometry.triangleIndices.buffer,
    geometry.triangleIndices.byteOffset,
    geometry.triangleIndices.elementCount,
  );

  return {
    kind: "mesh",
    vertexPositions: readPointTriplets(positions),
    vertexNormals: normals ? readPointTriplets(normals) : null,
    triangleIndices: Array.from({ length: indices.length / 3 }, (_, index) => {
      const offset = index * 3;
      return [
        indices[offset]!,
        indices[offset + 1]!,
        indices[offset + 2]!,
      ] as const;
    }),
  };
}

// postMessage clones the packed snapshot, so packing and unpacking only
// replace mesh geometry and never deep-copy the rest of the snapshot.
export function packRenderableMeshes(
  records: readonly RenderableEntityRecord[],
) {
  return records.map((record): PackedRenderableEntityRecord => {
    if (record.geometry.kind !== "mesh") {
      return record as PackedRenderableEntityRecord;
    }

    return {
      ...record,
      geometry: packMeshGeometry(record.geometry),
    };
  });
}

/**
 * The meshes of the last unpacked snapshot by renderable id. A mesh whose
 * packed arrays are unchanged in the next snapshot reuses the same geometry
 * object, so label/appearance-only changes keep the viewport's GPU geometry.
 */
export type RenderMeshUnpackCache = Map<
  string,
  { packed: PackedMeshGeometry; geometry: RenderMeshGeometry }
>;

export function createRenderMeshUnpackCache(): RenderMeshUnpackCache {
  return new Map();
}

export function unpackRenderableMeshes(
  records: readonly PackedRenderableEntityRecord[],
  cache?: RenderMeshUnpackCache,
) {
  const unpacked = records.map((record): RenderableEntityRecord => {
    if (record.geometry.kind !== "packedMesh") {
      return record as RenderableEntityRecord;
    }

    const previous = cache?.get(record.id);
    return {
      ...record,
      geometry:
        previous && packedMeshesEqual(previous.packed, record.geometry)
          ? previous.geometry
          : unpackMeshGeometry(record.geometry),
    };
  });

  if (cache) {
    cache.clear();
    records.forEach((record, index) => {
      const geometry = unpacked[index]!.geometry;
      if (record.geometry.kind === "packedMesh" && geometry.kind === "mesh") {
        cache.set(record.id, { packed: record.geometry, geometry });
      }
    });
  }

  return unpacked;
}

function packedMeshesEqual(
  left: PackedMeshGeometry,
  right: PackedMeshGeometry,
) {
  return (
    packedViewsEqual(
      left.vertexPositions,
      right.vertexPositions,
      Float32Array,
    ) &&
    packedViewsEqual(
      left.triangleIndices,
      right.triangleIndices,
      Uint32Array,
    ) &&
    (left.vertexNormals === null || right.vertexNormals === null
      ? left.vertexNormals === right.vertexNormals
      : packedViewsEqual(left.vertexNormals, right.vertexNormals, Float32Array))
  );
}

function packedViewsEqual(
  left: PackedTypedArrayView,
  right: PackedTypedArrayView,
  ArrayType: typeof Float32Array | typeof Uint32Array,
) {
  if (left.elementCount !== right.elementCount) return false;
  const a = new ArrayType(left.buffer, left.byteOffset, left.elementCount);
  const b = new ArrayType(right.buffer, right.byteOffset, right.elementCount);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

export function collectPackedMeshTransferList(
  records: readonly PackedRenderableEntityRecord[],
) {
  const buffers = new Set<ArrayBuffer>();

  for (const record of records) {
    if (record.geometry.kind !== "packedMesh") {
      continue;
    }

    buffers.add(record.geometry.vertexPositions.buffer);
    buffers.add(record.geometry.triangleIndices.buffer);
    if (record.geometry.vertexNormals) {
      buffers.add(record.geometry.vertexNormals.buffer);
    }
  }

  return [...buffers];
}

export function packWorkspaceSnapshotRenderMeshes(snapshot: WorkspaceSnapshot) {
  const records = packRenderableMeshes(snapshot.document.render.records);
  const packedSnapshot: PackedWorkspaceSnapshot = {
    ...snapshot,
    document: {
      ...snapshot.document,
      render: {
        ...snapshot.document.render,
        records,
      },
    },
  };

  return {
    snapshot: packedSnapshot,
    transferList: collectPackedMeshTransferList(records),
  };
}

export function unpackWorkspaceSnapshotRenderMeshes(
  snapshot: WorkspaceSnapshot | PackedWorkspaceSnapshot,
  cache?: RenderMeshUnpackCache,
): WorkspaceSnapshot {
  const records = unpackRenderableMeshes(
    snapshot.document.render.records as PackedRenderableEntityRecord[],
    cache,
  );

  return {
    ...snapshot,
    document: {
      ...snapshot.document,
      render: {
        ...snapshot.document.render,
        records,
      },
    },
  } as WorkspaceSnapshot;
}

function createPackedView(
  view: Float32Array | Uint32Array,
): PackedTypedArrayView {
  return {
    buffer: view.buffer as ArrayBuffer,
    byteOffset: view.byteOffset,
    byteLength: view.byteLength,
    elementCount: view.length,
  };
}

function writePointTriplets(
  target: Float32Array,
  points: readonly RenderPoint3D[],
) {
  points.forEach((point, index) => {
    const offset = index * 3;
    target[offset] = point[0];
    target[offset + 1] = point[1];
    target[offset + 2] = point[2];
  });
}

function readPointTriplets(source: Float32Array) {
  return Array.from({ length: source.length / 3 }, (_, index) => {
    const offset = index * 3;
    return [source[offset]!, source[offset + 1]!, source[offset + 2]!] as const;
  });
}
