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

/**
 * Seam: the scene objects under the layer and R3F's frame request
 * (`invalidate`). A body rename delivers a snapshot whose every record is a
 * new object with the same geometry, material and picking: no scene object
 * may be replaced (R3F swaps a replaced `<primitive>` and requests a frame),
 * and each kept object must carry the new snapshot's record for picking and
 * hover. An edge whose points stay but whose binding changes keeps its line
 * with the new pick id and target; a moved edge is rebuilt.
 */
test("a rename snapshot replaces no scene object and requests no frame; kept objects carry the new records", async () => {
  const root = await createStubR3fRoot();
  const groupRef = createRef<THREE.Group>();
  const meshGeometry = triangle(0);
  const snapshot = (bodyLabel: string, edgeEndX = 1, edgeId = "edge_1") => {
    const edge: ViewportRenderableRecord = {
      origin: "document",
      bodyColor: 0x336699,
      renderable: {
        id: "renderable_edge_1" as never,
        label: `${bodyLabel} edge`,
        ownerBodyId: "body_1" as never,
        ownerFeatureId: null,
        binding: {
          pickId: `pick_${edgeId}` as never,
          pickPriority: 10,
          target: {
            kind: "edge",
            bodyId: "body_1" as never,
            edgeId: edgeId as never,
          },
          topology: "edge",
          semanticClass: "featureEdge",
        },
        geometry: {
          kind: "polyline",
          points: [
            [0, 0, 0],
            [edgeEndX, 0, 0],
          ],
          isClosed: false,
        },
      },
    };
    const vertex: ViewportRenderableRecord = {
      origin: "document",
      bodyColor: 0x336699,
      renderable: {
        id: "renderable_vertex_1" as never,
        label: `${bodyLabel} vertex`,
        ownerBodyId: "body_1" as never,
        ownerFeatureId: null,
        binding: {
          pickId: "pick_vertex_1" as never,
          pickPriority: 5,
          target: {
            kind: "vertex",
            bodyId: "body_1" as never,
            vertexId: "vertex_1" as never,
          },
          topology: "vertex",
          semanticClass: "featureVertex",
        },
        geometry: { kind: "marker", position: [0, 0, 0], displayRadius: 0.2 },
      },
    };
    const face = faceEntry("face_1", meshGeometry);
    return [
      { ...face, renderable: { ...face.renderable, label: bodyLabel } },
      edge,
      vertex,
    ];
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
  const sceneObjects = () => {
    const objects = new Set<THREE.Object3D>();
    groupRef.current?.traverse((object) => objects.add(object));
    return objects;
  };
  const boundRecordLabels = () =>
    [...sceneObjects()]
      .map(
        (object) =>
          (object.userData.renderableRecord as { label?: string } | undefined)
            ?.label,
      )
      .filter((label) => label !== undefined)
      .sort();

  const store = await render(snapshot("Hub"));
  const before = sceneObjects();
  let frameRequests = 0;
  const invalidate = store.getState().invalidate;
  store.setState({
    invalidate: (...args: Parameters<typeof invalidate>) => {
      frameRequests += 1;
      return invalidate(...args);
    },
  });

  await render(snapshot("Mount"));
  const afterRename = sceneObjects();
  expect(
    [...afterRename].filter((object) => !before.has(object)).length,
    "no scene object is reconstructed by a rename",
  ).toBe(0);
  expect(afterRename.size).toBe(before.size);
  expect(frameRequests, "a rename requests no viewport frame").toBe(0);
  expect(
    boundRecordLabels(),
    "every kept object is bound to the renamed snapshot's record",
  ).toEqual(["Mount", "Mount edge", "Mount vertex"]);

  const keptLine = [...before].find(
    (object) => object.userData.pickId === "pick_edge_1",
  );
  expect(keptLine).toBeInstanceOf(THREE.Line);
  await render(snapshot("Mount", 1, "edge_9"));
  expect(
    sceneObjects().has(keptLine!),
    "an edge with unchanged points keeps its line",
  ).toBe(true);
  expect(keptLine!.userData.pickId, "the kept line picks the new id").toBe(
    "pick_edge_9",
  );
  expect(keptLine!.userData.target).toEqual({
    kind: "edge",
    bodyId: "body_1",
    edgeId: "edge_9",
  });
  expect(frameRequests, "a rebinding requests no viewport frame").toBe(0);

  await render(snapshot("Mount", 2, "edge_9"));
  const edgeLine = [...sceneObjects()].find(
    (object) => object.userData.pickId === "pick_edge_9",
  );
  expect(edgeLine).toBeInstanceOf(THREE.Line);
  expect(before.has(edgeLine!), "a moved edge gets a new line").toBe(false);
  expect(frameRequests).toBeGreaterThan(0);

  await act(async () => root.unmount());
});
