/**
 * UI lane (docs/testing.md: `src/components`, render-local behaviour and
 * wiring). Seam: `SketchDisplayBvhLayer` under the viewport's
 * `ViewportPickRoot`, mounted in a real R3F root (stub renderer, no frames),
 * with the bindings `collectBindings` gathers at each pick-root commit. When
 * a drag starts the region fills go stale (no pick target); the layer keeps
 * the mounted objects and their BVH instead of remounting the sketch half,
 * and the stale fill is no longer pickable nor highlightable. It is pickable
 * again once current.
 */
import { act } from "@react-three/fiber";
import { createRef } from "react";
import * as THREE from "three";
import { expect, test } from "vitest";
import { createRenderMeshGeometry } from "@/contracts/render/render-mesh-geometry";

import type { SketchMarkerDisplayContext } from "@/components/cad/sketch-display-style";
import type { SketchRenderingPalette } from "@/components/cad/sketch-rendering-palette";
import { createStubR3fRoot } from "@/components/cad/r3f-stub-root.fixtures";
import { ViewportPickRoot } from "@/components/cad/three-cad-viewport-inner-components";
import { SketchDisplayBvhLayer } from "@/components/cad/three-cad-viewport-sketch-nodes";
import type { SketchSessionDisplayRenderable } from "@/core/editor/sketch-session";
import { getPrimitiveRefKey } from "@/core/editor/schema";
import { collectBindings } from "@/infrastructure/viewport/render-picking";

const palette: SketchRenderingPalette = {
  constrained: 0xdddddd,
  underconstrained: 0x2255aa,
  overconstrained: 0xdd3333,
  regionFill: 0x334455,
};

const markerContext: SketchMarkerDisplayContext = {
  revealedPointIds: new Set(),
  revealedHandleEntityIds: new Set(),
  hoverTarget: null,
};

const regionTarget = {
  kind: "region",
  sketchId: "sketch_1",
  regionId: "region_1",
} as const;

const regionPoints: readonly [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
];
const regionGeometry = createRenderMeshGeometry({
  vertexPositions: regionPoints,
  vertexNormals: null,
  triangleIndices: [[0, 1, 2]],
});

function region(
  validity: "current" | "stale",
  geometry: unknown = regionGeometry,
) {
  return {
    id: "renderable_sketch_region_region_1_0",
    label: validity === "stale" ? "Region 1 (stale)" : "Region 1",
    target: validity === "current" ? regionTarget : null,
    geometry,
    linePattern: "solid",
    role: "local",
    semanticClass: "region",
    regionValidity: validity,
  } as unknown as SketchSessionDisplayRenderable;
}

test("a region fill going stale is unbound from picking without remounting the sketch BVH; current again, it is pickable", async () => {
  const root = await createStubR3fRoot();
  const rootRef = createRef<THREE.Group>();
  const commits: ReturnType<typeof collectBindings>[] = [];
  let token = 0;
  const render = (renderables: SketchSessionDisplayRenderable[]) =>
    act(async () =>
      root.render(
        <ViewportPickRoot
          rootRef={rootRef}
          commitToken={(token += 1)}
          onCommit={() => commits.push(collectBindings(rootRef.current))}
        >
          <SketchDisplayBvhLayer
            renderables={renderables}
            applyStyles
            palette={palette}
            markerContext={markerContext}
          />
        </ViewportPickRoot>,
      ),
    );
  const fillMesh = () => {
    let mesh: THREE.Mesh | null = null;
    rootRef.current?.traverse((object) => {
      if (object instanceof THREE.Mesh && !mesh) mesh = object;
    });
    if (!mesh) throw new Error("Expected the region fill mesh.");
    return mesh as THREE.Mesh;
  };
  const bvhGroup = () => rootRef.current?.children[0];
  const regionKey = getPrimitiveRefKey(regionTarget);

  await render([region("current")]);
  const mounted = fillMesh();
  const mountedBvh = bvhGroup();
  expect(commits.at(-1)?.pickables, "the current fill is pickable").toContain(
    mounted,
  );
  expect(commits.at(-1)?.targetToObjects.get(regionKey)).toEqual([mounted]);

  await render([region("stale")]);
  expect(fillMesh(), "the stale fill keeps its mounted mesh").toBe(mounted);
  expect(bvhGroup(), "the sketch BVH did not remount").toBe(mountedBvh);
  expect(
    commits.at(-1)?.pickables,
    "the stale fill is not pickable",
  ).not.toContain(mounted);
  expect(
    commits.at(-1)?.targetToObjects.size,
    "the stale fill is not highlightable",
  ).toBe(0);
  expect(mounted.userData, "no binding survives on the stale fill").toEqual({});

  await render([region("current")]);
  expect(fillMesh()).toBe(mounted);
  expect(
    commits.at(-1)?.pickables,
    "the fill is pickable again once current",
  ).toContain(mounted);
  expect(commits.at(-1)?.targetToObjects.get(regionKey)).toEqual([mounted]);

  await render([
    region(
      "current",
      createRenderMeshGeometry({
        vertexPositions: [...regionPoints, [0, 1, 0]],
        vertexNormals: null,
        triangleIndices: [
          [0, 1, 2],
          [0, 2, 3],
        ],
      }),
    ),
  ]);
  expect(bvhGroup(), "a re-triangulated fill remounts the sketch BVH").not.toBe(
    mountedBvh,
  );
  expect(commits.at(-1)?.pickables).toContain(fillMesh());
  await act(async () => root.unmount());
});

test("a marker that loses its target keeps its mounted group and drops every binding, the ray-pick exclusion included", async () => {
  const root = await createStubR3fRoot();
  const rootRef = createRef<THREE.Group>();
  const pointTarget = {
    kind: "sketchPoint",
    sketchId: "sketch_1",
    pointId: "point_1",
  } as const;
  const marker = (target: unknown) =>
    ({
      id: "renderable_sketch_point_point_1",
      label: "Point 1",
      target,
      geometry: { kind: "marker", position: [0, 0, 0], displayRadius: 1 },
      linePattern: "solid",
      role: "local",
    }) as unknown as SketchSessionDisplayRenderable;
  const render = (renderable: SketchSessionDisplayRenderable) =>
    act(async () =>
      root.render(
        <group ref={rootRef}>
          <SketchDisplayBvhLayer
            renderables={[renderable]}
            applyStyles
            palette={palette}
            markerContext={markerContext}
          />
        </group>,
      ),
    );
  const markerGroup = () => {
    const group = rootRef.current?.children[0]?.children[0];
    if (!group) throw new Error("Expected the marker group.");
    return group;
  };

  await render(marker(pointTarget));
  const mounted = markerGroup();
  expect(mounted.userData.target).toEqual(pointTarget);
  expect(
    mounted.userData.pickExcluded,
    "a sketch point is picked in screen space only",
  ).toBe(true);

  await render(marker(null));
  expect(markerGroup()).toBe(mounted);
  expect(
    collectBindings(rootRef.current)?.pickables,
    "an untargeted marker is not pickable",
  ).not.toContain(mounted);
  expect(mounted.userData).toEqual({});
  await act(async () => root.unmount());
});
