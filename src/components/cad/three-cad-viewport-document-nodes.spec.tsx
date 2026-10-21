/**
 * cadara-lyi. UI lane (docs/testing.md: `src/components`, render-local
 * behaviour). Seam: `DocumentRenderableNode` mounted in a real R3F root (its
 * own reconciler, a stub renderer, no frames). A new snapshot's record for an
 * unchanged mesh (a rename or another body's colour change) keeps the mounted
 * geometry and material: disposing a material releases its shader program,
 * so rebuilding them recompiled every program and re-uploaded every buffer.
 * A colour change replaces only the material.
 */
import { act, createRoot, extend } from "@react-three/fiber";
import { createRef } from "react";
import * as THREE from "three";
import { expect, test } from "vitest";

import type { RenderableEntityRecord } from "@/contracts/render/schema";
import type { SketchRenderingPalette } from "@/components/cad/sketch-rendering-palette";
import { DocumentRenderableNode } from "@/components/cad/three-cad-viewport-document-nodes";
import type { ViewportRenderableRecord } from "@/core/workspace/viewport-renderables";

extend(THREE as never);

const palette: SketchRenderingPalette = {
  constrained: 0xdddddd,
  underconstrained: 0x2255aa,
  overconstrained: 0xdd3333,
  regionFill: 0x334455,
};

function stubRoot() {
  const canvas = {
    style: {},
    width: 100,
    height: 100,
    addEventListener() {},
    removeEventListener() {},
    getContext: () => null,
  } as unknown as HTMLCanvasElement;
  const gl = {
    domElement: canvas,
    render() {},
    setSize() {},
    setPixelRatio() {},
    getPixelRatio: () => 1,
    setAnimationLoop() {},
    dispose() {},
    shadowMap: {},
    info: { render: {} },
    xr: {
      enabled: false,
      isPresenting: false,
      addEventListener() {},
      removeEventListener() {},
      setAnimationLoop() {},
    },
  };
  return { root: createRoot(canvas), gl };
}

const geometry: RenderableEntityRecord["geometry"] = {
  kind: "mesh",
  vertexPositions: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  vertexNormals: null,
  triangleIndices: [[0, 1, 2]],
};

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
  const { root, gl } = stubRoot();
  await root.configure({
    gl: gl as never,
    frameloop: "never",
    size: { width: 100, height: 100, top: 0, left: 0 },
  });
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
