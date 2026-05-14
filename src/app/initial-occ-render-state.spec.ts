import { test, expect } from "vitest";

import {
  hasNonEmptyCommittedGeometry,
  isInitialOccRenderPending,
} from "@/app/workbench/initial-occ-render-state";
import type { ViewportRenderableRecord } from "@/core/workspace/viewport-renderables";

test("src/app/initial-occ-render-state.spec.ts", () => {
  expect(
    isInitialOccRenderPending({ snapshot: null }),
    "The viewport should show initial OCC render progress before the first workspace snapshot.",
  ).toBeTruthy();
  expect(
    isInitialOccRenderPending({ snapshot: { revisionId: "rev_0001" } }),
    "The viewport loading state should clear after the first workspace snapshot is ready.",
  ).toBeFalsy();
  expect(
    hasNonEmptyCommittedGeometry([]),
    "Empty renderable sets should not report a first geometry frame.",
  ).toBeFalsy();
  expect(
    hasNonEmptyCommittedGeometry([makeRenderable("preview", [[0, 1, 2]])]),
    "Preview meshes should not satisfy committed startup geometry readiness.",
  ).toBeFalsy();
  expect(
    hasNonEmptyCommittedGeometry([makeRenderable("document", [])]),
    "Document meshes without triangles should not satisfy committed startup geometry readiness.",
  ).toBeFalsy();
  expect(
    hasNonEmptyCommittedGeometry([makeRenderable("document", [[0, 1, 2]])]),
    "A committed document mesh with triangles should satisfy first geometry frame readiness.",
  ).toBeTruthy();
});

function makeRenderable(
  origin: ViewportRenderableRecord["origin"],
  triangleIndices: readonly (readonly [number, number, number])[],
): ViewportRenderableRecord {
  return {
    origin,
    renderable: {
      id: "render_body-1",
      label: "Body",
      ownerBodyId: "body_1",
      ownerFeatureId: null,
      binding: {
        kind: "body",
        target: { kind: "body", bodyId: "body_1" },
        pickId: "pick_body-1",
      },
      geometry: {
        kind: "mesh",
        vertexPositions: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ],
        vertexNormals: null,
        triangleIndices,
      },
    },
  } as ViewportRenderableRecord;
}
