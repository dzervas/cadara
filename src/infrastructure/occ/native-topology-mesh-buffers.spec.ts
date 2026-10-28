// Logic lane (docs/testing.md), adapter conformance: the display payload
// builder the OCC adapter picks for a loaded kernel. A fake Emscripten host
// stands in for the native CadaraNativeTopologyMeshBuffers result, so the
// buffer reading (face record indices to ids, memory growth replacing the
// HEAP views, ownership of the native result) is proven without the kernel;
// the production builders are compared in
// native-topology-mesh-buffers.heavy.spec.ts.
import { expect, test, vi } from "vitest";

import { getNativeTopologyDisplayPayloadBuilder } from "@/infrastructure/occ/native-topology-mesh-buffers";

const topologyJson = JSON.stringify({
  schemaVersion: "occ-native-topology-payload/v1alpha1",
  source: "occt7-shim",
  bodyId: "body_a",
  topologyToken: "t0001",
  counts: { faces: 2, edges: 0, vertices: 0 },
  topology: [
    {
      id: "face_body_a_g1",
      kernelUid: "occt7-shim:face:1",
      kind: "face",
      bodyId: "body_a",
      index: 1,
    },
    {
      id: "face_body_a_g2",
      kernelUid: "occt7-shim:face:2",
      kind: "face",
      bodyId: "body_a",
      index: 2,
    },
  ],
  edgeVertices: [],
  vertexPoints: [],
  faceEdges: [],
  diagnostics: [],
});

/**
 * A host whose mesh-buffer result holds four nodes and two triangles, one on
 * each face. The buffers exist only in the memory that TopologyJson() grows
 * into, as when the string return makes Emscripten grow and replace HEAP*.
 */
function fakeMeshBuffersHost(triangleFaceIndices = [2, 1]) {
  const memory = new ArrayBuffer(256);
  new Float32Array(memory, 0, 12).set([0, 0, 0, 1, 0, 0, 1, 1, 0, 0.1, 1, 0]);
  new Uint32Array(memory, 64, 6).set([0, 1, 2, 0, 2, 3]);
  new Uint32Array(memory, 96, 2).set(triangleFaceIndices);
  const result = {
    TopologyJson: () => {
      host.HEAPF32 = new Float32Array(memory);
      host.HEAPU32 = new Uint32Array(memory);
      return topologyJson;
    },
    NodeCount: () => 4,
    TriangleCount: () => 2,
    PositionsAddress: () => 0,
    TriangleIndicesAddress: () => 64,
    TriangleFaceIndicesAddress: () => 96,
    delete: vi.fn(),
  };
  const host = {
    CadaraNativeTopologyMeshBuffers: { Build: vi.fn(() => result) },
    CadaraBuildNativeTopologyPayload: { BuildJson: vi.fn(() => "{}") },
    HEAPF32: new Float32Array(256 / 4),
    HEAPU32: new Uint32Array(256 / 4),
  };
  return { host, result };
}

test("the mesh-buffer builder reads the mesh after the native calls and frees the native result", () => {
  const { host, result } = fakeMeshBuffersHost();
  const build = getNativeTopologyDisplayPayloadBuilder(host)!;

  const payload = build({ shape: 1 }, "body_a", "t0001", 0.1, 0.5);

  expect(host.CadaraNativeTopologyMeshBuffers.Build).toHaveBeenCalledWith(
    { shape: 1 },
    "body_a",
    "t0001",
    0.1,
    0.5,
  );
  expect(
    host.CadaraBuildNativeTopologyPayload.BuildJson,
    "the JSON builder is only the fallback",
  ).not.toHaveBeenCalled();
  expect(payload.topology.map((record) => record.id)).toEqual([
    "face_body_a_g1",
    "face_body_a_g2",
  ]);
  expect(payload.mesh).toEqual({
    nodeCount: 4,
    triangleCount: 2,
    linearDeflection: 0.1,
    angularDeflection: 0.5,
    positions: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [Math.fround(0.1), 1, 0],
    ],
    triangleIndices: [
      [0, 1, 2],
      [0, 2, 3],
    ],
    triangleFaceBindings: ["face_body_a_g2", "face_body_a_g1"],
  });
  expect(result.delete).toHaveBeenCalledTimes(1);
});

test("a triangle bound to a face record the topology lacks fails and still frees the native result", () => {
  const { host, result } = fakeMeshBuffersHost([2, 7]);
  const build = getNativeTopologyDisplayPayloadBuilder(host)!;

  expect(() => build({}, "body_a", "t0001", 0.1, 0.5)).toThrow(
    "Native mesh triangle 1 on body body_a references face record index 7, which the topology does not contain.",
  );
  expect(result.delete).toHaveBeenCalledTimes(1);
});

test("a kernel without the mesh-buffer builder falls back to parsing BuildJson", () => {
  const json = JSON.stringify({
    ...JSON.parse(topologyJson),
    mesh: {
      nodeCount: 3,
      triangleCount: 1,
      linearDeflection: 0.1,
      angularDeflection: 0.5,
      positions: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
      ],
      triangleIndices: [[0, 1, 2]],
      triangleFaceBindings: ["face_body_a_g1"],
    },
  });
  const BuildJson = vi.fn(() => json);
  const build = getNativeTopologyDisplayPayloadBuilder({
    CadaraBuildNativeTopologyPayload: { BuildJson },
    HEAPF32: new Float32Array(0),
    HEAPU32: new Uint32Array(0),
  })!;

  const payload = build({}, "body_a", "t0001", 0.1, 0.5);

  expect(BuildJson).toHaveBeenCalledWith({}, "body_a", "t0001", 0.1, 0.5);
  expect(payload.mesh?.triangleFaceBindings).toEqual(["face_body_a_g1"]);
  expect(
    getNativeTopologyDisplayPayloadBuilder({
      HEAPF32: new Float32Array(0),
      HEAPU32: new Uint32Array(0),
    }),
    "no builder at all",
  ).toBeUndefined();
});
