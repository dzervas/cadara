import { createRenderMeshGeometry } from "@/contracts/render/render-mesh-geometry";
import { test, expect } from "vitest";

import {
  degreesToOccAngularDeflectionRadians,
  getOccTessellationTier,
  selectBodyLodTier,
  selectViewportLodTierForRenderables,
} from "@/infrastructure/occ/tessellation";
import type { RenderableEntityRecord } from "@/contracts/render/schema";

test("src/infrastructure/occ/tessellation.spec.ts", () => {
  const startup = getOccTessellationTier("startup");
  const fine = getOccTessellationTier("fine");

  expect(
    degreesToOccAngularDeflectionRadians(180),
    "OCC angular deflection unit audit should convert degree-equivalent settings to radians.",
  ).toBe(Math.PI);
  expect(
    startup.linearDeflectionModelUnits >= 0.5 &&
      startup.linearDeflectionModelUnits <= 1.0,
    "Startup tessellation should use coarse 0.5 to 1.0 model-unit linear deflection.",
  ).toBeTruthy();
  expect(
    startup.angularDeflectionRadians === 0.5 &&
      startup.angularDeflectionDegreeEquivalent > 2,
    "Startup tessellation should keep the existing angular value because it is already coarser than 1-2 degrees.",
  ).toBeTruthy();
  expect(
    fine.linearDeflectionModelUnits < startup.linearDeflectionModelUnits,
    "Fine tessellation should refine geometry without changing topology bindings.",
  ).toBeTruthy();
  expect(
    selectBodyLodTier({
      bodyRadiusModelUnits: 1,
      cameraDistanceModelUnits: 40,
    }),
    "Far bodies should select coarse startup LOD.",
  ).toBe("startup");
  expect(
    selectBodyLodTier({
      bodyRadiusModelUnits: 4,
      cameraDistanceModelUnits: 10,
    }),
    "Close bodies should select fine LOD refinement.",
  ).toBe("fine");

  const bodyRenderable = {
    ownerBodyId: "body_1",
    binding: {
      target: { kind: "face", bodyId: "body_1", faceId: "face_1" },
    },
    geometry: createRenderMeshGeometry({
      vertexPositions: [
        [-1, -1, 0],
        [1, -1, 0],
        [1, 1, 0],
        [-1, 1, 0],
      ],
      vertexNormals: null,
      triangleIndices: [
        [0, 1, 2],
        [0, 2, 3],
      ],
    }),
  } as RenderableEntityRecord;

  expect(
    selectViewportLodTierForRenderables({
      cameraPosition: [0, 0, 50],
      renderables: [bodyRenderable],
    }),
    "Camera-driven LOD should keep far body renderables on the coarse tier.",
  ).toBe("startup");
  expect(
    selectViewportLodTierForRenderables({
      cameraPosition: [0, 0, 4],
      renderables: [bodyRenderable],
    }),
    "Camera-driven LOD should request fine meshes when zoomed close to a body.",
  ).toBe("fine");
  expect(
    bodyRenderable.binding.target.kind === "face" &&
      bodyRenderable.binding.target.bodyId === "body_1" &&
      bodyRenderable.binding.target.faceId === "face_1",
    "LOD selection must not rewrite durable selection targets.",
  ).toBeTruthy();
});

// Match the screen fraction at the viewport's existing 45-degree perspective FOV.
const referenceHalfFovTangent = Math.tan(Math.PI / 8);

test.each([
  ["startup", 0.04],
  ["normal", 0.1],
  ["fine", 0.25],
] as const)(
  "equal screen fractions select %s in both projections",
  (tier, ratio) => {
    const bodyRadiusModelUnits = 1;
    const cameraDistanceModelUnits = 1 / ratio;
    const perspective = { bodyRadiusModelUnits, cameraDistanceModelUnits };
    const orthographic = {
      ...perspective,
      cameraDistanceModelUnits: tier === "startup" ? 1 : 1000,
      projection: {
        kind: "orthographic" as const,
        halfHeightModelUnits:
          cameraDistanceModelUnits * referenceHalfFovTangent,
        zoom: 1,
      },
    };
    expect(selectBodyLodTier(perspective)).toBe(tier);
    expect(selectBodyLodTier(orthographic)).toBe(tier);
    const widerPerspective = {
      ...perspective,
      cameraDistanceModelUnits:
        cameraDistanceModelUnits * referenceHalfFovTangent,
      projection: {
        kind: "perspective" as const,
        verticalFovDegrees: 90,
        zoom: 1,
      },
    };
    expect(selectBodyLodTier(widerPerspective)).toBe(tier);
  },
);

test("orthographic zoom refines and coarsens bodies independent of camera distance", () => {
  const input = {
    bodyRadiusModelUnits: 1,
    cameraDistanceModelUnits: 1000,
    projection: {
      kind: "orthographic" as const,
      halfHeightModelUnits: referenceHalfFovTangent * 25,
      zoom: 1,
    },
  };
  expect(
    [1, 2.5, 6.25, 2.5, 1].map((zoom) =>
      selectBodyLodTier({
        ...input,
        projection: { ...input.projection, zoom },
      }),
    ),
  ).toEqual(["startup", "normal", "fine", "normal", "startup"]);
});

test("viewport LOD follows orthographic zoom and frustum height, not body distance", () => {
  const renderable = {
    ownerBodyId: "body_1",
    geometry: {
      kind: "polyline",
      points: [
        [-1, 0, 0],
        [1, 0, 0],
      ],
    },
  } as RenderableEntityRecord;
  const input = {
    cameraPosition: [0, 0, 1000] as const,
    renderables: [renderable],
    projection: {
      kind: "orthographic" as const,
      halfHeightModelUnits: referenceHalfFovTangent * 25,
      zoom: 1,
    },
  };
  expect(
    [1, 2.5, 6.25, 2.5, 1].map((zoom) =>
      selectViewportLodTierForRenderables({
        ...input,
        projection: { ...input.projection, zoom },
      }),
    ),
  ).toEqual(["startup", "normal", "fine", "normal", "startup"]);
  expect(
    selectViewportLodTierForRenderables({
      ...input,
      projection: {
        ...input.projection,
        halfHeightModelUnits: referenceHalfFovTangent * 4,
      },
    }),
  ).toBe("fine");
});
