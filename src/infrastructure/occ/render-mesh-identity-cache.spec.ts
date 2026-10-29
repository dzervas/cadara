// Logic lane (seam: `keepUnchangedSnapshotRenderMeshes`, the main thread's
// step between a delivered snapshot and the viewport). Each delivered
// snapshot carries fresh typed-array copies; equal meshes keep the previous
// geometry object so the viewport keeps their GPU geometry, and the arrays
// reach the viewport as delivered, never repacked.
import { expect, test } from "vitest";

import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import { createRenderMeshGeometry } from "@/contracts/render/render-mesh-geometry";
import type { RenderableEntityRecord } from "@/contracts/render/schema";
import {
  createRenderMeshIdentityCache,
  keepUnchangedSnapshotRenderMeshes,
} from "@/infrastructure/occ/render-mesh-identity-cache";

const faceMesh = (id: string, x: number): RenderableEntityRecord => ({
  id: id as never,
  label: id,
  ownerBodyId: "body_1" as never,
  ownerFeatureId: null,
  binding: {
    pickId: `pick_${id}` as never,
    pickPriority: 20,
    target: {
      kind: "face",
      bodyId: "body_1" as never,
      faceId: `face_${id}` as never,
    },
    topology: "face",
    semanticClass: "bodyFace",
  },
  geometry: createRenderMeshGeometry({
    vertexPositions: [
      [0, 0, 0],
      [x, 0, 0],
      [0, 1, 0],
    ],
    triangleIndices: [[0, 1, 2]],
  }),
});

const delivered = (records: RenderableEntityRecord[]) =>
  structuredClone({
    document: { render: { records } },
  }) as unknown as WorkspaceSnapshot;

const geometries = (snapshot: WorkspaceSnapshot) =>
  snapshot.document.render.records.map((record) => record.geometry);

test("equal delivered meshes keep the previous geometry object; changed ones take the delivered arrays", () => {
  const cache = createRenderMeshIdentityCache();
  const first = delivered([faceMesh("a", 1), faceMesh("b", 1)]);
  const [a1, b1] = geometries(keepUnchangedSnapshotRenderMeshes(first, cache));
  expect(a1, "the first delivery is passed through").toBe(
    first.document.render.records[0]!.geometry,
  );

  const second = delivered([
    { ...faceMesh("a", 1), label: "renamed" },
    faceMesh("b", 2),
  ]);
  const kept = keepUnchangedSnapshotRenderMeshes(second, cache);
  const [a2, b2] = geometries(kept);
  expect(a2, "an equal mesh reuses the previous geometry").toBe(a1);
  expect(kept.document.render.records[0]!.label).toBe("renamed");
  expect(b2, "a changed mesh is the delivered geometry itself").toBe(
    second.document.render.records[1]!.geometry,
  );
  expect(b2).not.toBe(b1);

  const [a3] = geometries(
    keepUnchangedSnapshotRenderMeshes(delivered([faceMesh("a", 1)]), cache),
  );
  expect(a3, "reuse holds across several deliveries").toBe(a1);
});

test("meshes differing only in normals, or with and without normals, are not equal", () => {
  const cache = createRenderMeshIdentityCache();
  const withNormals = (z: number): RenderableEntityRecord => ({
    ...faceMesh("a", 1),
    geometry: createRenderMeshGeometry({
      vertexPositions: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
      vertexNormals: [
        [0, 0, z],
        [0, 0, z],
        [0, 0, z],
      ],
      triangleIndices: [[0, 1, 2]],
    }),
  });
  const [first] = geometries(
    keepUnchangedSnapshotRenderMeshes(delivered([withNormals(1)]), cache),
  );
  const [flipped] = geometries(
    keepUnchangedSnapshotRenderMeshes(delivered([withNormals(-1)]), cache),
  );
  expect(flipped).not.toBe(first);
  const [none] = geometries(
    keepUnchangedSnapshotRenderMeshes(delivered([faceMesh("a", 1)]), cache),
  );
  expect(none).not.toBe(flipped);
});
