// Logic lane: raw/normalized topology payload boundaries, without OCC setup.
import { expect, test } from "vitest";
import type { BodyId, FaceId } from "@/contracts/shared/ids";
import {
  createOccNativeTopologyPayloadFromShimPayloads,
  type OccNativeShimPayload,
} from "@/infrastructure/occ/native-topology-payload";
import { rewriteNativeTopologyPayloadIds } from "@/infrastructure/occ/topology";

const bodyId = "body_bindings" as BodyId;
function makePayload(): OccNativeShimPayload {
  return {
    schemaVersion: "occ-native-topology-payload/v1alpha1",
    source: "occt7-shim",
    topology: [{ id: "face_native", kind: "face", bodyId, index: 1 }],
    edgeVertices: [],
    vertexPoints: [],
    faceEdges: [],
    diagnostics: [],
    mesh: {
      nodeCount: 3,
      triangleCount: 1,
      linearDeflection: 0.1,
      angularDeflection: 0.5,
      positions: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      triangleIndices: new Uint32Array([0, 1, 2]),
      triangleFaceBindings: ["face_native"],
    },
  };
}
const aliases = {
  faceIdsByNativeId: new Map<FaceId, FaceId>([
    ["face_native" as FaceId, "face_preserved" as FaceId],
  ]),
};

for (const binding of ["face_unknown", "face_preserved"]) {
  test(`normalization rejects raw binding ${binding} absent from native face records, even if it is a durable alias destination`, () => {
    const payload = makePayload();
    payload.mesh = { ...payload.mesh!, triangleFaceBindings: [binding] };
    expect(() =>
      rewriteNativeTopologyPayloadIds(bodyId, payload, aliases),
    ).toThrow(binding);
  });
  test(`public native topology packing rejects unmatched binding ${binding} instead of inventing a face index`, () => {
    const payload = makePayload();
    payload.mesh = { ...payload.mesh!, triangleFaceBindings: [binding] };
    expect(() =>
      createOccNativeTopologyPayloadFromShimPayloads({
        revisionId: "rev_bindings",
        lodTierId: "normal",
        bodies: [{ bodyId, nativePayload: payload }],
      }),
    ).toThrow(binding);
  });
}

test("adapter normalization changes raw bindings exactly once and packs the durable face index", () => {
  const payload = rewriteNativeTopologyPayloadIds(
    bodyId,
    makePayload(),
    aliases,
  );
  expect(payload.mesh!.triangleFaceBindings).toEqual(["face_preserved"]);
  const packed = createOccNativeTopologyPayloadFromShimPayloads({
    revisionId: "rev_bindings",
    lodTierId: "normal",
    bodies: [{ bodyId, nativePayload: payload }],
  });
  expect(packed.bodies[0]!.renderMeshSummary!.triangleFaceBindings).toEqual([
    "face_preserved",
  ]);
  const ref = packed.bodies[0]!.renderMesh!.triangleFaceBindings;
  expect([
    ...new Uint32Array(
      packed.buffers.find((buffer) => buffer.bufferId === ref.bufferId)!.buffer,
    ),
  ]).toEqual([0]);
});
