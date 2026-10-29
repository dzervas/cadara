import type {
  RenderMeshGeometry,
  RenderPoint3D,
} from "@/contracts/render/schema";

/**
 * A mesh from point and triangle lists, for small producer-side meshes
 * (construction planes, sketch regions, fixtures). Kernel body meshes are
 * written into the typed arrays directly.
 */
export function createRenderMeshGeometry(input: {
  vertexPositions: readonly RenderPoint3D[];
  vertexNormals?: readonly RenderPoint3D[] | null;
  triangleIndices: readonly (readonly [number, number, number])[];
}): RenderMeshGeometry {
  return {
    kind: "mesh",
    vertexPositions: new Float32Array(input.vertexPositions.flat()),
    vertexNormals: input.vertexNormals
      ? new Float32Array(input.vertexNormals.flat())
      : null,
    triangleIndices: new Uint32Array(input.triangleIndices.flat()),
  };
}

export function getRenderMeshVertexCount(geometry: RenderMeshGeometry) {
  return geometry.vertexPositions.length / 3;
}

export function getRenderMeshTriangleCount(geometry: RenderMeshGeometry) {
  return geometry.triangleIndices.length / 3;
}

/**
 * Vertex `index` of a flat x, y, z array (`vertexPositions` or
 * `vertexNormals`); undefined past the end.
 */
export function readRenderMeshPoint(
  values: Float32Array,
  index: number,
): RenderPoint3D | undefined {
  const offset = index * 3;
  return offset + 2 < values.length
    ? [values[offset]!, values[offset + 1]!, values[offset + 2]!]
    : undefined;
}

/** Every vertex of `values` (a flat x, y, z array) as a point. */
export function readRenderMeshPoints(values: Float32Array): RenderPoint3D[] {
  const points = new Array<RenderPoint3D>(values.length / 3);
  for (let index = 0; index < points.length; index += 1) {
    const offset = index * 3;
    points[index] = [values[offset]!, values[offset + 1]!, values[offset + 2]!];
  }
  return points;
}

/** Triangle `index` of `triangleIndices` as its three vertex indices. */
export function readRenderMeshTriangle(
  triangleIndices: Uint32Array,
  index: number,
): readonly [number, number, number] {
  const offset = index * 3;
  return [
    triangleIndices[offset]!,
    triangleIndices[offset + 1]!,
    triangleIndices[offset + 2]!,
  ];
}
