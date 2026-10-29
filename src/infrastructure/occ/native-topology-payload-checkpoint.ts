import type { OccTessellationTierId } from "@/contracts/modeling/tessellation";
import {
  assertNativeShimMeshSummaryInvariants,
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
 * The mesh positions and triangle indices are stored as the payload's typed
 * arrays: inside the JSON they would dominate the stored entry. Positions
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
    positions: mesh.positions,
    triangleIndices: mesh.triangleIndices,
  };
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
  // The stored JSON holds empty arrays in their place; the payload is
  // validated without them and checked again with the stored arrays.
  delete mesh.positions;
  delete mesh.triangleIndices;
  const payload = parseNativeShimPayload(raw);
  const { triangleFaceBindings, ...counts } = payload.mesh!;
  const decoded: OccNativeShimPayload = {
    ...payload,
    mesh: {
      ...counts,
      positions: record.positions,
      triangleIndices: record.triangleIndices,
      ...(triangleFaceBindings ? { triangleFaceBindings } : {}),
    },
  };
  assertNativeShimMeshSummaryInvariants(decoded.mesh, "mesh");
  return decoded;
}
