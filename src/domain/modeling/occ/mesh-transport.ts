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

export function packRenderableMeshes(
  records: readonly RenderableEntityRecord[],
) {
  return records.map((record): PackedRenderableEntityRecord => {
    if (record.geometry.kind !== "mesh") {
      return structuredClone(record) as PackedRenderableEntityRecord;
    }

    return {
      ...structuredClone(record),
      geometry: packMeshGeometry(record.geometry),
    };
  });
}

export function unpackRenderableMeshes(
  records: readonly PackedRenderableEntityRecord[],
) {
  return records.map((record): RenderableEntityRecord => {
    if (record.geometry.kind !== "packedMesh") {
      return structuredClone(record) as RenderableEntityRecord;
    }

    return {
      ...structuredClone(record),
      geometry: unpackMeshGeometry(record.geometry),
    };
  });
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
    ...structuredClone(snapshot),
    document: {
      ...structuredClone(snapshot.document),
      render: {
        ...structuredClone(snapshot.document.render),
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
): WorkspaceSnapshot {
  const records = unpackRenderableMeshes(
    snapshot.document.render.records as PackedRenderableEntityRecord[],
  );

  return {
    ...structuredClone(snapshot),
    document: {
      ...structuredClone(snapshot.document),
      render: {
        ...structuredClone(snapshot.document.render),
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
