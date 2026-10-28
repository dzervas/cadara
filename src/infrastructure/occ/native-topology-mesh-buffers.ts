import {
  assertNativeShimMeshSummaryInvariants,
  parseNativeShimPayloadJson,
  type OccNativeShimMeshSummary,
  type OccNativeShimPayload,
  type OpenCascadeNativeTopologyKernelHost,
} from "@/infrastructure/occ/native-topology-payload";

/**
 * The native result of `CadaraNativeTopologyMeshBuffers.Build`
 * (occ-native-shims/cadara-native-topology-mesh-buffers.inc). The caller owns
 * it; its mesh buffers live in wasm memory until `delete()`.
 */
interface NativeTopologyMeshBuffers {
  /** The BuildJson payload without its `mesh` member. */
  TopologyJson(): string;
  NodeCount(): number;
  TriangleCount(): number;
  /** Byte address of float32 x, y, z per node. */
  PositionsAddress(): number;
  /** Byte address of uint32 a, b, c per triangle. */
  TriangleIndicesAddress(): number;
  /** Byte address of uint32 per triangle: the owning face record's `index`. */
  TriangleFaceIndicesAddress(): number;
  delete(): void;
}

export interface OpenCascadeNativeTopologyMeshBuffersHost {
  CadaraNativeTopologyMeshBuffers?: {
    Build?: (
      shape: unknown,
      bodyId: string,
      topologyToken: string,
      linearDeflection: number,
      angularDeflection: number,
    ) => NativeTopologyMeshBuffers;
  };
  // Emscripten replaces these views when wasm memory grows, so read them
  // only after the last native call that can allocate.
  HEAPF32: Float32Array;
  HEAPU32: Uint32Array;
}

/** A display-tier native topology payload of one body shape, mesh included. */
export type NativeTopologyDisplayPayloadBuilder = (
  shape: unknown,
  bodyId: string,
  topologyToken: string,
  linearDeflection: number,
  angularDeflection: number,
) => OccNativeShimPayload;

/**
 * The display payload builder the loaded kernel supports: the mesh-buffer
 * builder when the kernel has it, else BuildJson. Both mesh the shape the same
 * way and yield the same payload, except that buffer positions are float32
 * where BuildJson prints 6 significant digits.
 */
export function getNativeTopologyDisplayPayloadBuilder(
  host: OpenCascadeNativeTopologyKernelHost &
    OpenCascadeNativeTopologyMeshBuffersHost,
): NativeTopologyDisplayPayloadBuilder | undefined {
  if (typeof host.CadaraNativeTopologyMeshBuffers?.Build === "function") {
    return (
      shape,
      bodyId,
      topologyToken,
      linearDeflection,
      angularDeflection,
    ) =>
      buildNativeShimPayloadFromMeshBuffers(
        host,
        shape,
        bodyId,
        topologyToken,
        linearDeflection,
        angularDeflection,
      );
  }
  const buildJson = host.CadaraBuildNativeTopologyPayload?.BuildJson;
  return buildJson
    ? (shape, bodyId, topologyToken, linearDeflection, angularDeflection) =>
        parseNativeShimPayloadJson(
          buildJson(
            shape,
            bodyId,
            topologyToken,
            linearDeflection,
            angularDeflection,
          ),
        )
    : undefined;
}

export function buildNativeShimPayloadFromMeshBuffers(
  host: OpenCascadeNativeTopologyMeshBuffersHost,
  shape: unknown,
  bodyId: string,
  topologyToken: string,
  linearDeflection: number,
  angularDeflection: number,
): OccNativeShimPayload {
  const build = host.CadaraNativeTopologyMeshBuffers?.Build;
  if (!build) {
    throw new Error(
      "The loaded OpenCascade build has no CadaraNativeTopologyMeshBuffers.Build.",
    );
  }
  const buffers = build(
    shape,
    bodyId,
    topologyToken,
    linearDeflection,
    angularDeflection,
  );
  try {
    const payload = parseNativeShimPayloadJson(buffers.TopologyJson());
    const nodeCount = buffers.NodeCount();
    const triangleCount = buffers.TriangleCount();
    const positionStart = buffers.PositionsAddress() / 4;
    const triangleStart = buffers.TriangleIndicesAddress() / 4;
    const faceIndexStart = buffers.TriangleFaceIndicesAddress() / 4;
    const positionValues = host.HEAPF32.subarray(
      positionStart,
      positionStart + nodeCount * 3,
    );
    const triangleValues = host.HEAPU32.subarray(
      triangleStart,
      triangleStart + triangleCount * 3,
    );
    const faceIndices = host.HEAPU32.subarray(
      faceIndexStart,
      faceIndexStart + triangleCount,
    );

    const faceIdByIndex = new Map<number, string>();
    for (const record of payload.topology) {
      if (record.kind === "face") faceIdByIndex.set(record.index, record.id);
    }
    const positions = new Array<readonly [number, number, number]>(nodeCount);
    for (let node = 0; node < nodeCount; node += 1) {
      const offset = node * 3;
      positions[node] = [
        positionValues[offset]!,
        positionValues[offset + 1]!,
        positionValues[offset + 2]!,
      ];
    }
    const triangleIndices = new Array<readonly [number, number, number]>(
      triangleCount,
    );
    const triangleFaceBindings = new Array<string>(triangleCount);
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const offset = triangle * 3;
      triangleIndices[triangle] = [
        triangleValues[offset]!,
        triangleValues[offset + 1]!,
        triangleValues[offset + 2]!,
      ];
      const faceId = faceIdByIndex.get(faceIndices[triangle]!);
      if (faceId === undefined) {
        throw new Error(
          `Native mesh triangle ${triangle} on body ${bodyId} references face record index ${faceIndices[triangle]}, which the topology does not contain.`,
        );
      }
      triangleFaceBindings[triangle] = faceId;
    }

    const mesh: OccNativeShimMeshSummary = {
      nodeCount,
      triangleCount,
      linearDeflection,
      angularDeflection,
      positions,
      triangleIndices,
      triangleFaceBindings,
    };
    assertNativeShimMeshSummaryInvariants(mesh, "mesh");
    return { ...payload, mesh };
  } finally {
    buffers.delete();
  }
}
