// Logic lane: shipped OCC -> adapter's durable payload -> face render geometry.
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { RenderPoint3D } from "@/contracts/render/schema";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import {
  parseNativeShimPayloadJson,
  type OccNativeShimPayload,
  type OpenCascadeNativeTopologyKernelHost,
} from "@/domain/modeling/occ/native-topology-payload";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";

async function loadFixture() {
  const module = (await import("../../../public/cadara-occ.js")) as unknown as {
    default: new (
      options: Record<string, unknown>,
    ) => Promise<OpenCascadeInstance & OpenCascadeNativeTopologyKernelHost>;
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
function triangleCoordinates(
  positions: readonly RenderPoint3D[],
  triangles: readonly (readonly [number, number, number])[],
) {
  return triangles
    .map((triangle) => JSON.stringify(triangle.map((i) => positions[i]!)))
    .sort();
}

test("history-preserved landing wheel retains every face-bound triangle at startup, normal and fine", async () => {
  const { oc, adapter, request } = await loadFixture();
  const builder = oc.CadaraBuildNativeTopologyPayload!;
  const original = builder.BuildJson!;
  const rawByBody = new Map<string, OccNativeShimPayload>();
  builder.BuildJson = (...args) => {
    const json = original(...args);
    rawByBody.set(args[1], parseNativeShimPayloadJson(json));
    return json;
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
          const expectedTriangles = mesh.triangleIndices!.filter(
            (_, i) => mesh.triangleFaceBindings![i] === nativeFace.id,
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
            .toEqual(triangleCoordinates(mesh.positions!, expectedTriangles));
        }
      }
      expect(
        differingIds,
        `${tier}: fixture must exercise preserved IDs`,
      ).toBeGreaterThan(0);
    }
  } finally {
    builder.BuildJson = original;
    adapter.dispose();
  }
}, 30_000);

test("adapter snapshot rejects an unmatched face binding instead of dropping its triangle", async () => {
  const { oc, adapter, request } = await loadFixture();
  const builder = oc.CadaraBuildNativeTopologyPayload!;
  const original = builder.BuildJson!;
  builder.BuildJson = (...args) => {
    const raw = parseNativeShimPayloadJson(original(...args));
    return JSON.stringify({
      ...raw,
      mesh: {
        ...raw.mesh,
        triangleFaceBindings: raw.mesh!.triangleFaceBindings!.map((id, i) =>
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
    adapter.dispose();
  }
}, 30_000);
