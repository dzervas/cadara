import type { OccTessellationTierId } from "@/contracts/modeling/tessellation";
import {
  parseNativeShimPayload,
  type OccNativeShimPayload,
} from "@/infrastructure/occ/native-topology-payload";

/**
 * One body's display payload (the adapter's per-tier native topology payload
 * cache entry) stored beside a model checkpoint, so the first snapshot after
 * a checkpoint hit reads it instead of meshing the body again. It is bound to
 * the body it was built for by body id and topology token: a hydrated body
 * with another token never takes it.
 *
 * The mesh positions and triangle indices are typed arrays: as nested JS
 * arrays they would dominate the stored entry's structured clone. Positions
 * are float64, so both payload builders' values (float32 buffers, BuildJson
 * decimals) come back unchanged.
 */
export interface NativeTopologyPayloadCheckpointRecord {
  bodyId: string;
  topologyToken: string;
  lodTierId: OccTessellationTierId;
  /** The payload as JSON, with empty mesh positions and triangle indices. */
  payload: string;
  positions: Float64Array;
  triangleIndices: Uint32Array;
}

/** Null for a payload without a mesh, which is never stored. */
export function encodeNativeTopologyPayloadCheckpointRecord(entry: {
  bodyId: string;
  topologyToken: string;
  lodTierId: OccTessellationTierId;
  nativePayload: OccNativeShimPayload;
}): NativeTopologyPayloadCheckpointRecord | null {
  const mesh = entry.nativePayload.mesh;
  if (!mesh?.positions || !mesh.triangleIndices) return null;
  return {
    bodyId: entry.bodyId,
    topologyToken: entry.topologyToken,
    lodTierId: entry.lodTierId,
    // Emptied in place, so the decoded payload keeps the built key order.
    payload: JSON.stringify({
      ...entry.nativePayload,
      mesh: { ...mesh, positions: [], triangleIndices: [] },
    }),
    positions: Float64Array.from(mesh.positions.flat()),
    triangleIndices: Uint32Array.from(mesh.triangleIndices.flat()),
  };
}

function triples<T extends number>(values: ArrayLike<T>) {
  const result = new Array<readonly [T, T, T]>(values.length / 3);
  for (let index = 0; index < result.length; index += 1) {
    const offset = index * 3;
    result[index] = [values[offset]!, values[offset + 1]!, values[offset + 2]!];
  }
  return result;
}

/**
 * The payload a record holds, validated like a native builder's output.
 * Throws when the record is not a complete payload of its body and token.
 */
export function decodeNativeTopologyPayloadCheckpointRecord(
  record: NativeTopologyPayloadCheckpointRecord,
): OccNativeShimPayload {
  const raw = JSON.parse(record.payload) as {
    bodyId?: unknown;
    topologyToken?: unknown;
    mesh?: { nodeCount?: unknown; triangleCount?: unknown } & Record<
      string,
      unknown
    >;
  };
  const mesh = raw.mesh;
  if (
    raw.bodyId !== record.bodyId ||
    raw.topologyToken !== record.topologyToken ||
    !mesh ||
    record.positions.length !== Number(mesh.nodeCount) * 3 ||
    record.triangleIndices.length !== Number(mesh.triangleCount) * 3
  ) {
    throw new Error(
      `The stored display payload of body ${record.bodyId} does not match its record.`,
    );
  }
  mesh.positions = triples(record.positions);
  mesh.triangleIndices = triples(record.triangleIndices);
  return parseNativeShimPayload(raw);
}
