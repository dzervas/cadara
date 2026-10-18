import { act, createRoot } from "@react-three/fiber";
import { createRef } from "react";
import * as THREE from "three";
import { expect, test } from "vitest";

import { ViewportInitialCameraFraming } from "@/components/cad/viewport-initial-camera-framing";
import type { RenderableEntityRecord } from "@/contracts/render/schema";
import type { DocumentId } from "@/contracts/shared/ids";
import type { ViewportRenderableRecord } from "@/core/workspace/viewport-renderables";
import type { ViewportCameraControls } from "@/infrastructure/viewport/viewport-camera-controls";
import {
  captureViewportCameraFrame,
  createViewportCamera,
  updateViewportCameraAspect,
  type ViewportProjectionMode,
} from "@/infrastructure/viewport/viewport-projection";

type Point = readonly [number, number, number];

function body(points: Point[]): ViewportRenderableRecord {
  const renderable: RenderableEntityRecord = {
    id: "renderable_face",
    label: "Part face",
    ownerBodyId: "body_part",
    ownerFeatureId: "feature_part",
    binding: {
      pickId: "pick_face",
      pickPriority: 20,
      target: { kind: "face", bodyId: "body_part", faceId: "face_part" },
      topology: "face",
      semanticClass: "bodyFace",
    },
    geometry: {
      kind: "mesh",
      vertexPositions: points,
      vertexNormals: null,
      triangleIndices: [[0, 1, 2]],
    },
  };
  return { origin: "document", renderable };
}

const largePart: Point[] = [
  [1000, 2000, -20],
  [2000, 2000, -20],
  [1000, 3000, -20],
  [2000, 3000, -20],
  [1000, 2000, 980],
  [2000, 2000, 980],
  [1000, 3000, 980],
  [2000, 3000, 980],
];

async function cameraSeam(mode: ViewportProjectionMode, aspect: number) {
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
  const root = createRoot(canvas);
  const camera = createViewportCamera(mode, aspect);
  const cameraRef = { current: camera };
  const controlsRef = createRef<ViewportCameraControls>();
  let updates = 0;
  const controls: ViewportCameraControls = {
    target: new THREE.Vector3(0, 0, 4),
    update() {
      updates += 1;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  await root.configure({
    gl: gl as never,
    camera,
    frameloop: "never",
    size: { width: 100 * aspect, height: 100, top: 0, left: 0 },
  });

  return {
    camera,
    controls,
    controlsRef,
    updates: () => updates,
    render: (
      documentId: DocumentId | null,
      renderables: ViewportRenderableRecord[],
      controlsReadyVersion = 0,
    ) =>
      act(async () => {
        root.render(
          <ViewportInitialCameraFraming
            documentId={documentId}
            renderables={renderables}
            cameraRef={cameraRef}
            controlsRef={controlsRef}
            controlsReadyVersion={controlsReadyVersion}
          />,
        );
      }),
    dispose: () => act(async () => root.unmount()),
  };
}

function expectVisibleWithMargin(camera: THREE.Camera, points: Point[]) {
  camera.updateMatrixWorld();
  for (const point of points) {
    const projected = new THREE.Vector3(...point).project(camera);
    expect(Math.abs(projected.x)).toBeLessThanOrEqual(1 / 1.18 + 1e-6);
    expect(Math.abs(projected.y)).toBeLessThanOrEqual(1 / 1.18 + 1e-6);
    expect(Math.abs(projected.z)).toBeLessThanOrEqual(1);
  }
}

test("initial camera framing waits for committed body bounds and controls, then fits once per opened document", async () => {
  const seam = await cameraSeam("orthographic", 16 / 9);
  try {
    await seam.render(null, []);
    await seam.render("doc_opened", []);
    const part = body(largePart);
    await seam.render("doc_opened", [part]);
    expect(seam.updates()).toBe(0);

    seam.controlsRef.current = seam.controls;
    const scaffold = body(largePart);
    scaffold.renderable.ownerBodyId = null;
    await seam.render("doc_opened", [scaffold, { ...part, origin: "preview" }], 1);
    expect(seam.updates()).toBe(0);

    await seam.render("doc_opened", [part], 1);
    expect(seam.updates()).toBe(1);
    expectVisibleWithMargin(seam.camera, largePart);
    expect(seam.controls.target.toArray()).toEqual([1500, 2500, 480]);

    // Keep the user's navigation through edits, re-tessellation, empty
    // snapshots and resize; none of those may re-arm the initial fit.
    seam.camera.zoom *= 2;
    seam.camera.position.add(new THREE.Vector3(12, 34, 56));
    seam.controls.target.add(new THREE.Vector3(12, 34, 56));
    const navigated = captureViewportCameraFrame(seam.camera, seam.controls);
    await seam.render(
      "doc_opened",
      [body(largePart.map(([x, y, z]) => [x * 2, y, z]))],
      1,
    );
    await seam.render("doc_opened", [], 1);
    updateViewportCameraAspect(seam.camera, 9 / 16);
    await seam.render("doc_opened", [body(largePart)], 2);
    expect(seam.updates()).toBe(1);
    expect(captureViewportCameraFrame(seam.camera, seam.controls)).toEqual(
      navigated,
    );

    await seam.render("doc_another_open", [], 2);
    expect(seam.updates()).toBe(1);
    await seam.render("doc_another_open", [body(largePart)], 2);
    expect(seam.updates()).toBe(2);
    await seam.render("doc_opened", [part], 2);
    expect(seam.updates()).toBe(2);
  } finally {
    await seam.dispose();
  }
});

for (const mode of ["orthographic", "perspective"] as const) {
  for (const aspect of [16 / 9, 9 / 16]) {
    test(`initial ${mode} framing contains large and ordinary oblique parts with margin at aspect ${aspect}`, async () => {
      const seam = await cameraSeam(mode, aspect);
      seam.controlsRef.current = seam.controls;
      try {
        for (const [index, points] of [
          largePart,
          largePart.map(([x, y, z]): Point => [x / 100, y / 100, z / 100]),
          // A flat XY part exposes the difference between world up and screen up.
          [
            [-50, -35, 0],
            [50, -35, 0],
            [50, 35, 0],
            [-50, 35, 0],
          ] as Point[],
          // Bounds center need not coincide with the projected extents' midpoint.
          [
            [0, 0, 0],
            [100, 0, 0],
            [0, 80, 60],
          ] as Point[],
        ].entries()) {
          await seam.render(`doc_part-${index}`, [body(points)]);
          expectVisibleWithMargin(seam.camera, points);
        }
        expect(seam.updates()).toBe(4);
      } finally {
        await seam.dispose();
      }
    });
  }
}

test("initial framing accepts a large tessellation without spreading vertices into function arguments", async () => {
  const seam = await cameraSeam("orthographic", 16 / 9);
  seam.controlsRef.current = seam.controls;
  try {
    const points = Array.from(
      { length: 150_000 },
      (_, index) => largePart[index % largePart.length]!,
    );
    await seam.render("doc_large_tessellation", [body(points)]);
    expect(seam.updates()).toBe(1);
    expectVisibleWithMargin(seam.camera, largePart);
  } finally {
    await seam.dispose();
  }
});
