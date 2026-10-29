// Logic lane: shipped OCC -> adapter's durable payload -> face render geometry.
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import type {
  OccNativeShimPayload,
  OpenCascadeNativeTopologyKernelHost,
} from "@/infrastructure/occ/native-topology-payload";
import type { OpenCascadeInstance } from "@/infrastructure/occ/kernel-capabilities";
import {
  buildNativeShimPayloadFromMeshBuffers,
  type OpenCascadeNativeTopologyMeshBuffersHost,
} from "@/infrastructure/occ/native-topology-mesh-buffers";
import { OpenCascadeKernelAdapter } from "@/infrastructure/occ/opencascade-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/application/solver/sketch-constraint-solver-adapter";

async function loadFixture() {
  const module = (await import("../../../public/cadara-occ.js")) as unknown as {
    default: new (
      options: Record<string, unknown>,
    ) => Promise<
      OpenCascadeInstance &
        OpenCascadeNativeTopologyKernelHost &
        OpenCascadeNativeTopologyMeshBuffersHost
    >;
  };
  const oc = await new module.default({
    wasmBinary: new Uint8Array(
      await readFile(
        new URL("../../../public/cadara-occ.wasm", import.meta.url),
      ),
    ),
  });
  const document = JSON.parse(
    await readFile(
      new URL("../../../landing/examples/wheel/model.cadara", import.meta.url),
      "utf8",
    ),
  ) as AuthoredModelDocument;
  const request = {
    contractVersion: CONTRACT_VERSION,
    documentId: document.documentId,
  } as const;
  const adapter = new OpenCascadeKernelAdapter({
    documentId: document.documentId,
    getOpenCascadeInstance: async () => oc,
    createSolverAdapter: (revisionId) =>
      new SketchConstraintSolverAdapter({
        revisionId,
        documentId: document.documentId,
        neutralCurveQueries:
          createCertifiedNeutralCurveQueryCapabilityForTest(),
      }),
  });
  await adapter.restoreAuthoredModelDocument(document);
  return { oc, adapter, request };
}

// Coordinates (including winding and duplicate triangles), not local vertex
// indices or totals: a collision must not move triangles to another face.
/** `positions`: x, y, z per vertex; `triangleIndices`: a, b, c per triangle. */
function triangleCoordinates(
  positions: ArrayLike<number>,
  triangleIndices: ArrayLike<number>,
  keepTriangle: (triangle: number) => boolean = () => true,
) {
  const triangles: string[] = [];
  for (let triangle = 0; triangle < triangleIndices.length / 3; triangle += 1) {
    if (!keepTriangle(triangle)) continue;
    triangles.push(
      JSON.stringify(
        [0, 1, 2].map((corner) => {
          const vertex = triangleIndices[triangle * 3 + corner]!;
          return [0, 1, 2].map((axis) => positions[vertex * 3 + axis]!);
        }),
      ),
    );
  }
  return triangles.sort();
}

test("history-preserved landing wheel retains every face-bound triangle at startup, normal and fine", async () => {
  const { oc, adapter, request } = await loadFixture();
  // The display builder: read each native result as the raw payload before
  // the adapter reads (and frees) it.
  const builder = oc.CadaraNativeTopologyMeshBuffers!;
  const original = builder.Build!;
  const rawByBody = new Map<string, OccNativeShimPayload>();
  builder.Build = (...args) => {
    const result = original(...args);
    const unowned = {
      TopologyJson: () => result.TopologyJson(),
      NodeCount: () => result.NodeCount(),
      TriangleCount: () => result.TriangleCount(),
      PositionsAddress: () => result.PositionsAddress(),
      TriangleIndicesAddress: () => result.TriangleIndicesAddress(),
      TriangleFaceIndicesAddress: () => result.TriangleFaceIndicesAddress(),
      delete: () => {},
    };
    rawByBody.set(
      args[1],
      buildNativeShimPayloadFromMeshBuffers(
        {
          CadaraNativeTopologyMeshBuffers: { Build: () => unowned },
          get HEAPF32() {
            return oc.HEAPF32;
          },
          get HEAPU32() {
            return oc.HEAPU32;
          },
        },
        ...args,
      ),
    );
    return result;
  };
  try {
    for (const tier of ["startup", "normal", "fine"] as const) {
      adapter.setSnapshotLodTier(tier);
      const payload = await adapter.buildNativeTopologySnapshot(request, tier);
      if (payload.kind !== "nativeTopologyPayload")
        throw new Error(JSON.stringify(payload));
      const snapshot = (await adapter.getDocumentSnapshot(request)).snapshot
        .document;
      expect(payload.payload.bodies).toHaveLength(5);
      let differingIds = 0;
      for (const body of payload.payload.bodies) {
        const raw = rawByBody.get(body.bodyId)!;
        const mesh = raw.mesh!;
        // Adapter rewriting preserves kernel UIDs. Join native and public face
        // records by that identity, independently of the snapshot's alias map.
        const publicFaces = body.topology.filter(
          (record) => record.kind === "face",
        );
        const records = snapshot.render.records.filter(
          (record) =>
            record.ownerBodyId === body.bodyId &&
            record.binding.target.kind === "face",
        );
        expect
          .soft(records, `${tier} ${body.bodyId}: all faces visible`)
          .toHaveLength(publicFaces.length);
        for (const nativeFace of raw.topology.filter(
          (record) => record.kind === "face",
        )) {
          const publicFace = publicFaces.find(
            (record) => record.kernelUid === nativeFace.kernelUid,
          )!;
          expect(publicFace).toBeDefined();
          if (publicFace.id !== nativeFace.id) differingIds++;
          const expectedTriangles = triangleCoordinates(
            mesh.positions!,
            mesh.triangleIndices!,
            (triangle) =>
              mesh.triangleFaceBindings![triangle] === nativeFace.id,
          );
          expect(expectedTriangles.length).toBeGreaterThan(0);
          const record = records.find(
            (record) =>
              record.binding.target.kind === "face" &&
              record.binding.target.faceId === publicFace.id,
          );
          const geometry = record?.geometry;
          expect
            .soft(
              geometry?.kind === "mesh"
                ? triangleCoordinates(
                    geometry.vertexPositions,
                    geometry.triangleIndices,
                  )
                : [],
              `${tier} ${body.bodyId} native ${nativeFace.id} -> durable ${publicFace.id}`,
            )
            .toEqual(expectedTriangles);
        }
      }
      expect(
        differingIds,
        `${tier}: fixture must exercise preserved IDs`,
      ).toBeGreaterThan(0);
    }
  } finally {
    builder.Build = original;
    adapter.dispose();
  }
}, 30_000);

test("adapter snapshot rejects a mesh-buffer triangle bound to a face record the topology lacks", async () => {
  const { oc, adapter, request } = await loadFixture();
  const builder = oc.CadaraNativeTopologyMeshBuffers!;
  const original = builder.Build!;
  builder.Build = (...args) => {
    const result = original(...args);
    oc.HEAPU32[result.TriangleFaceIndicesAddress() / 4] = 65_535;
    return result;
  };
  try {
    adapter.setSnapshotLodTier("normal");
    await expect(adapter.getDocumentSnapshot(request)).rejects.toThrow(
      /references face record index 65535/,
    );
  } finally {
    builder.Build = original;
    adapter.dispose();
  }
}, 30_000);

test("adapter snapshot rejects an unmatched face binding instead of dropping its triangle", async () => {
  const { oc, adapter, request } = await loadFixture();
  // The JSON fallback carries face ids, so a binding can name an id the
  // topology lacks; hide the mesh-buffer builder to take that path.
  const meshBuffers = oc.CadaraNativeTopologyMeshBuffers!;
  const meshBuffersBuild = meshBuffers.Build;
  meshBuffers.Build = undefined;
  const builder = oc.CadaraBuildNativeTopologyPayload!;
  const original = builder.BuildJson!;
  builder.BuildJson = (...args) => {
    // Edited as printed: the parsed payload's mesh arrays are typed arrays.
    const raw = JSON.parse(original(...args)) as {
      mesh: { triangleFaceBindings: string[] };
    };
    return JSON.stringify({
      ...raw,
      mesh: {
        ...raw.mesh,
        triangleFaceBindings: raw.mesh.triangleFaceBindings.map((id, i) =>
          i === 0 ? "face_unmatched_regression" : id,
        ),
      },
    });
  };
  try {
    adapter.setSnapshotLodTier("normal");
    await expect(adapter.getDocumentSnapshot(request)).rejects.toThrow(
      /face_unmatched_regression/,
    );
    // Public native consumers do not pass through the renderer's validation.
    await expect(
      adapter.buildNativeTopologySnapshot(request, "normal"),
    ).rejects.toThrow(/face_unmatched_regression/);
  } finally {
    builder.BuildJson = original;
    meshBuffers.Build = meshBuffersBuild;
    adapter.dispose();
  }
}, 30_000);
