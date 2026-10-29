/**
 * UI lane (docs/testing.md: `src/components`, render-local behaviour). Seam:
 * the viewport's document pick layer, `DocumentPickLayer`, mounted in a real
 * R3F root (stub renderer, no frames). A new snapshot whose face keeps its mesh geometry (the render-mesh
 * identity cache) keeps that face's mounted mesh, buffer geometry and picking
 * BVH; only the changed face gets a new geometry, indexed after the commit
 * (idle time), not in the delivering frame. Before, the layer remounted on
 * every geometry change and rebuilt every face's geometry, outline and BVH.
 */
import { act } from "@react-three/fiber";
import { createRef } from "react";
import * as THREE from "three";
import { expect, onTestFinished, test } from "vitest";

import { createRenderMeshGeometry } from "@/contracts/render/render-mesh-geometry";
import type { RenderableEntityRecord } from "@/contracts/render/schema";
import type { SketchRenderingPalette } from "@/components/cad/sketch-rendering-palette";
import {
  createStubR3fRoot,
  installManualIdleCallbacks,
} from "@/components/cad/r3f-stub-root.fixtures";
import { DocumentPickLayer } from "@/components/cad/three-cad-viewport-document-nodes";
import type { ViewportRenderableRecord } from "@/core/workspace/viewport-renderables";

const palette: SketchRenderingPalette = {
  constrained: 0xdddddd,
  underconstrained: 0x2255aa,
  overconstrained: 0xdd3333,
  regionFill: 0x334455,
};

function triangle(z: number): RenderableEntityRecord["geometry"] {
  return createRenderMeshGeometry({
    vertexPositions: [
      [0, 0, z],
      [1, 0, z],
      [0, 1, z],
    ],
    vertexNormals: null,
    triangleIndices: [[0, 1, 2]],
  });
}

function faceEntry(
  faceId: string,
  geometry: RenderableEntityRecord["geometry"],
): ViewportRenderableRecord {
  return {
    origin: "document",
    bodyColor: 0x336699,
    renderable: {
      id: `renderable_${faceId}` as never,
      label: faceId,
      ownerBodyId: "body_1" as never,
      ownerFeatureId: null,
      binding: {
        pickId: `pick_${faceId}` as never,
        pickPriority: 20,
        target: {
          kind: "face",
          bodyId: "body_1" as never,
          faceId: faceId as never,
        },
        topology: "face",
        semanticClass: "bodyFace",
      },
      geometry,
    },
  };
}

type TreeGeometry = THREE.BufferGeometry & { boundsTree?: unknown };

test("a snapshot keeps the unchanged face's mesh, geometry and BVH; the changed face is indexed after the commit", async () => {
  const idle = installManualIdleCallbacks();
  onTestFinished(() => idle.restore());
  const root = await createStubR3fRoot();
  const groupRef = createRef<THREE.Group>();
  const faceMesh = (faceId: string) => {
    let found: THREE.Mesh | null = null;
    groupRef.current?.traverse((object) => {
      if (
        object instanceof THREE.Mesh &&
        (object.userData.target as { faceId?: string } | undefined)?.faceId ===
          faceId
      ) {
        found = object;
      }
    });
    if (!found) throw new Error(`Expected the ${faceId} mesh.`);
    return found as THREE.Mesh;
  };
  const render = (entries: ViewportRenderableRecord[]) =>
    act(async () =>
      root.render(
        <group ref={groupRef}>
          <DocumentPickLayer
            renderables={entries}
            palette={palette}
            clippingPlane={null}
          />
        </group>,
      ),
    );
  const idlePeriodsPass = () => act(async () => idle.runIdlePeriods());

  const keptGeometry = triangle(0);
  await render([
    faceEntry("face_1", keptGeometry),
    faceEntry("face_2", triangle(1)),
  ]);
  const kept = faceMesh("face_1");
  expect(
    (kept.geometry as TreeGeometry).boundsTree,
    "no BVH is built in the committing frame",
  ).toBeUndefined();
  await idlePeriodsPass();
  const keptTree = (kept.geometry as TreeGeometry).boundsTree;
  expect(keptTree).toBeTruthy();
  const keptBufferGeometry = kept.geometry;

  // The next snapshot: face 1's mesh is the identity-cached object, face 2
  // was re-triangulated by the feature.
  await render([
    faceEntry("face_1", keptGeometry),
    faceEntry("face_2", triangle(2)),
  ]);
  expect(faceMesh("face_1"), "the unchanged face keeps its mesh").toBe(kept);
  expect(kept.geometry).toBe(keptBufferGeometry);
  expect((kept.geometry as TreeGeometry).boundsTree).toBe(keptTree);
  const changed = faceMesh("face_2").geometry as TreeGeometry;
  expect(changed.boundsTree).toBeUndefined();
  await idlePeriodsPass();
  expect(
    changed.boundsTree,
    "the changed face is indexed in idle time",
  ).toBeTruthy();

  await act(async () => root.unmount());
});
