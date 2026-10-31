/**
 * cadara-lyi. UI lane (docs/testing.md: `src/components`, render-local
 * behaviour). Seam: `DocumentRenderableNode` mounted in a real R3F root (its
 * own reconciler, a stub renderer, no frames). A new snapshot's record for an
 * unchanged mesh (a rename or another body's colour change) keeps the mounted
 * geometry and material: disposing a material releases its shader program,
 * so rebuilding them recompiled every program and re-uploaded every buffer.
 * A colour change replaces only the material.
 */
import { createRenderMeshGeometry } from "@/contracts/render/render-mesh-geometry";
import { act } from "@react-three/fiber";
import { createRef } from "react";
import * as THREE from "three";
import { expect, test } from "vitest";

import type { RenderableEntityRecord } from "@/contracts/render/schema";
import type { SketchRenderingPalette } from "@/components/cad/sketch-rendering-palette";
import { createStubR3fRoot } from "@/components/cad/r3f-stub-root.fixtures";
import { DocumentRenderableNode } from "@/components/cad/three-cad-viewport-document-nodes";
import type { ViewportRenderableRecord } from "@/core/workspace/viewport-renderables";

const palette: SketchRenderingPalette = {
  constrained: 0xdddddd,
  underconstrained: 0x2255aa,
  overconstrained: 0xdd3333,
  regionFill: 0x334455,
};

const geometry: RenderableEntityRecord["geometry"] = createRenderMeshGeometry({
  vertexPositions: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  vertexNormals: null,
  triangleIndices: [[0, 1, 2]],
});

function faceEntry(label: string, bodyColor: number): ViewportRenderableRecord {
  return {
    origin: "document",
    bodyColor,
    renderable: {
      id: "renderable_face_1" as never,
      label,
      ownerBodyId: "body_1" as never,
      ownerFeatureId: null,
      binding: {
        pickId: "pick_face_1" as never,
        pickPriority: 20,
        target: {
          kind: "face",
          bodyId: "body_1" as never,
          faceId: "face_1" as never,
        },
        topology: "face",
        semanticClass: "bodyFace",
      },
      geometry,
    },
  };
}

test("a new snapshot's record for an unchanged mesh keeps its geometry and material; a colour change replaces only the material", async () => {
  const root = await createStubR3fRoot();
  const groupRef = createRef<THREE.Group>();
  const mounted = () => {
    let mesh: THREE.Mesh | null = null;
    groupRef.current?.traverse((object) => {
      if (object instanceof THREE.Mesh && !mesh) mesh = object;
    });
    if (!mesh) throw new Error("Expected a mounted mesh.");
    const { geometry: bufferGeometry, material } = mesh as THREE.Mesh;
    return { bufferGeometry, material };
  };
  const render = (entry: ViewportRenderableRecord) =>
    act(async () =>
      root.render(
        <group ref={groupRef}>
          <DocumentRenderableNode
            entry={entry}
            palette={palette}
            clippingPlane={null}
          />
        </group>,
      ),
    );

  await render(faceEntry("Hub", 0x336699));
  const first = mounted();
  await render(faceEntry("Renamed hub", 0x336699));
  const renamed = mounted();
  expect(renamed.bufferGeometry, "the GPU geometry is kept").toBe(
    first.bufferGeometry,
  );
  expect(renamed.material, "the material (and its program) is kept").toBe(
    first.material,
  );

  await render(faceEntry("Renamed hub", 0xcc5533));
  const recoloured = mounted();
  expect(recoloured.bufferGeometry).toBe(first.bufferGeometry);
  expect(recoloured.material).not.toBe(first.material);
  expect(
    (recoloured.material as THREE.MeshStandardMaterial).color.getHex(),
  ).toBe(0xcc5533);
  await act(async () => root.unmount());
});

test("a viewport re-render with the same record does not re-render the document node", async () => {
  // The viewport re-renders on every sketch drag move and hover; the
  // workbench keeps each document record's identity across them, so the
  // node (and every document mesh's ref binding) is skipped.
  const root = await createStubR3fRoot();
  const groupRef = createRef<THREE.Group>();
  const entry = faceEntry("Hub", 0x336699);
  const render = (hoverVersion: number) =>
    act(async () =>
      root.render(
        <group ref={groupRef} userData={{ hoverVersion }}>
          <DocumentRenderableNode
            entry={entry}
            palette={palette}
            clippingPlane={null}
          />
        </group>,
      ),
    );
  const mesh = () => {
    let found: THREE.Mesh | null = null;
    groupRef.current?.traverse((object) => {
      if (object instanceof THREE.Mesh && !found) found = object;
    });
    if (!found) throw new Error("Expected a mounted mesh.");
    return found as THREE.Mesh;
  };

  await render(1);
  // A marker the node's ref binding would overwrite if it re-rendered.
  mesh().userData.target = "marker";
  await render(2);
  expect(groupRef.current?.userData.hoverVersion).toBe(2);
  expect(
    mesh().userData.target,
    "the memoized node did not re-run its ref binding",
  ).toBe("marker");
  await act(async () => root.unmount());
});

/**
 * Seam: the drawn marker of a committed sketch point after one frame
 * (`advance` runs its `useFrame` placement). A sphere centred on the
 * point loses its half below a coplanar part face to the depth test at
 * oblique views; the marker must instead lie in its sketch plane, covering
 * a round screen disc. A marker without a sketch plane (a body vertex)
 * keeps its sphere.
 */
test("a committed sketch point on a sketch plane is drawn as a round disc lying in that plane at oblique views; a body vertex keeps its sphere", async () => {
  const anchor = [1, 2, 5] as const;
  const markerEntry = (
    sketchPlaneFrame?: ViewportRenderableRecord["sketchPlaneFrame"],
  ): ViewportRenderableRecord => ({
    origin: "document",
    ...(sketchPlaneFrame ? { sketchPlaneFrame } : {}),
    renderable: {
      id: "renderable_point_1" as never,
      label: "Sketch 1 point",
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: "pick_point_1" as never,
        pickPriority: 30,
        target: {
          kind: "sketchPoint",
          sketchId: "sketch_1" as never,
          pointId: "point_1" as never,
        },
        topology: null,
        semanticClass: "sketchPoint",
      },
      geometry: { kind: "marker", position: anchor, displayRadius: 0.25 },
    },
  });
  const frame = {
    origin: [0, 0, 5],
    xAxis: [1, 0, 0],
    yAxis: [0, 1, 0],
    normal: [0, 0, 1],
    linearUnit: "documentLength",
    handedness: "rightHanded",
  } as const;
  const root = await createStubR3fRoot();
  const groupRef = createRef<THREE.Group>();
  const drawnMarker = async (entry: ViewportRenderableRecord) => {
    const store = await act(async () =>
      root.render(
        <group ref={groupRef}>
          <DocumentRenderableNode
            entry={entry}
            palette={palette}
            clippingPlane={null}
          />
        </group>,
      ),
    );
    return { store, mesh: drawnMesh(groupRef.current) };
  };

  for (const camera of [
    new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000),
    new THREE.PerspectiveCamera(45, 1, 0.1, 1000),
  ]) {
    camera.position.set(14, -9, 13);
    camera.lookAt(...anchor);
    camera.updateMatrixWorld(true);
    const { store, mesh } = await drawnMarker(markerEntry(frame));
    store.setState({ camera });
    store.getState().advance(1);
    mesh.updateMatrixWorld(true);

    const toScreen = (point: THREE.Vector3) => {
      const ndc = point.clone().project(camera);
      return new THREE.Vector2(ndc.x, ndc.y);
    };
    const center = toScreen(new THREE.Vector3(...anchor));
    const positions = mesh.geometry.getAttribute("position");
    const rimRadii: number[] = [];
    for (let index = 0; index < positions.count; index += 1) {
      const world = new THREE.Vector3()
        .fromBufferAttribute(positions, index)
        .applyMatrix4(mesh.matrixWorld);
      expect(
        world.z,
        `${camera.type}: every marker vertex lies in the sketch plane`,
      ).toBeCloseTo(5, 9);
      const radius = toScreen(world).distanceTo(center);
      if (radius > 0) rimRadii.push(radius);
    }
    expect(
      Math.min(...rimRadii) / Math.max(...rimRadii),
      // Perspective lays the disc in along the anchor's view ray only.
      `${camera.type}: the marker covers a round screen disc`,
    ).toBeGreaterThan(0.95);
  }

  const { mesh: vertexMarker } = await drawnMarker(markerEntry());
  expect(vertexMarker.geometry).toBeInstanceOf(THREE.SphereGeometry);
  await act(async () => root.unmount());
});

/** The drawn (not pick-proxy) mesh of a document marker node. */
function drawnMesh(root: THREE.Object3D | null) {
  let found: THREE.Mesh | null = null;
  root?.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      object.userData.highlightExcluded !== true &&
      !found
    ) {
      found = object;
    }
  });
  if (!found) throw new Error("Expected a drawn marker mesh.");
  return found as THREE.Mesh;
}
