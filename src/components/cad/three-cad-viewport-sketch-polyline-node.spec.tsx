/**
 * UI lane (docs/testing.md: `src/components`, render-local behaviour). Seam:
 * `SketchDisplayPolylineNode` mounted in a real R3F root (stub renderer, no
 * frames). Every sketch session update (each drag move) rebuilds the display
 * renderables, so every curve receives a new geometry object; a curve whose
 * stroke inputs are unchanged keeps its stroke buffer, and a moved curve
 * gets a new one.
 */
import { act } from "@react-three/fiber";
import { createRef } from "react";
import * as THREE from "three";
import { expect, test } from "vitest";

import type { SketchRenderingPalette } from "@/components/cad/sketch-rendering-palette";
import { createStubR3fRoot } from "@/components/cad/r3f-stub-root.fixtures";
import { SketchDisplayPolylineNode } from "@/components/cad/three-cad-viewport-sketch-nodes";
import type { SketchSessionDisplayRenderable } from "@/core/editor/sketch-session";

const palette: SketchRenderingPalette = {
  constrained: 0xdddddd,
  underconstrained: 0x2255aa,
  overconstrained: 0xdd3333,
  regionFill: 0x334455,
};

function line(points: [number, number, number][]) {
  return {
    id: "renderable_sketch_entity_line_1",
    label: "Line 1",
    target: null,
    geometry: { kind: "polyline", points, isClosed: false },
    linePattern: "solid",
    role: "local",
  } as unknown as SketchSessionDisplayRenderable;
}

test("an unchanged curve keeps its stroke buffer across session updates; a moved one is rebuilt", async () => {
  const root = await createStubR3fRoot();
  const groupRef = createRef<THREE.Group>();
  const render = (renderable: SketchSessionDisplayRenderable) =>
    act(async () =>
      root.render(
        <group ref={groupRef}>
          <SketchDisplayPolylineNode
            renderable={renderable}
            applyStyles
            palette={palette}
          />
        </group>,
      ),
    );
  const strokePositions = () => {
    let stroke: THREE.Mesh | null = null;
    groupRef.current?.traverse((object) => {
      if (object instanceof THREE.Mesh && !stroke) stroke = object;
    });
    if (!stroke) throw new Error("Expected a stroke mesh.");
    return (stroke as THREE.Mesh).geometry.getAttribute("position");
  };

  await render(
    line([
      [0, 0, 0],
      [1, 0, 0],
    ]),
  );
  const first = strokePositions();
  expect(first.count).toBeGreaterThan(0);

  await render(
    line([
      [0, 0, 0],
      [1, 0, 0],
    ]),
  );
  expect(
    strokePositions(),
    "a new renderable with the same points keeps the stroke buffer",
  ).toBe(first);

  await render(
    line([
      [0, 0, 0],
      [2, 0, 0],
    ]),
  );
  const moved = strokePositions();
  expect(moved, "a moved curve rebuilds its stroke").not.toBe(first);
  expect(moved.getX(moved.count - 1)).not.toBe(first.getX(first.count - 1));
  await act(async () => root.unmount());
});
