import { test, expect } from "vitest";

import type { SketchDefinition } from "@/contracts/sketch/schema";
import { validateSketchDefinition } from "@/contracts/sketch/runtime-schema";

test("src/contracts/sketch/reference-image-runtime-schema.spec.ts", () => {
  const baseDefinition: SketchDefinition = {
    schemaVersion: "sketch-definition/v1alpha1",
    referenceIds: [],
    references: [],
    pointIds: [],
    points: [],
    entityIds: [],
    entities: [],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
    styleIds: [],
    styles: [],
    svgRenderingEnabled: true,
    derivedRelationships: [],
    authoringOperations: [
      {
        operationId: "sketch_operation_1_reference-image",
        label: "Reference",
        kind: "referenceImage",
        targets: {
          created: [
            {
              kind: "operation",
              operationId: "sketch_operation_1_reference-image",
            },
          ],
        },
        ownedState: {
          kind: "referenceImage",
          image: {
            mediaType: "image/png",
            fileName: "reference.png",
            pixelWidth: 640,
            pixelHeight: 480,
            base64Data: "cG5n",
          },
          placement: {
            center: [0, 0],
            width: 200,
            height: 150,
            rotationRadians: 0,
          },
        },
      },
    ],
  };

  expect(
    validateSketchDefinition(baseDefinition).success,
    "Runtime schema should accept valid committed reference-image operations.",
  ).toBeTruthy();

  const missingPayload = validateSketchDefinition({
    ...baseDefinition,
    authoringOperations: [
      {
        ...baseDefinition.authoringOperations![0]!,
        ownedState: {
          ...baseDefinition.authoringOperations![0]!.ownedState!,
          image: {
            ...baseDefinition.authoringOperations![0]!.ownedState!.image,
            base64Data: "",
          },
        },
      },
    ],
  });
  expect(
    missingPayload.success,
    "Runtime schema should reject empty inline image payloads.",
  ).toBeFalsy();

  const zeroDimensions = validateSketchDefinition({
    ...baseDefinition,
    authoringOperations: [
      {
        ...baseDefinition.authoringOperations![0]!,
        ownedState: {
          ...baseDefinition.authoringOperations![0]!.ownedState!,
          image: {
            ...baseDefinition.authoringOperations![0]!.ownedState!.image,
            pixelWidth: 0,
          },
        },
      },
    ],
  });
  expect(
    zeroDimensions.success,
    "Runtime schema should reject non-positive reference-image pixel dimensions.",
  ).toBeFalsy();

  const missingPlacement = validateSketchDefinition({
    ...baseDefinition,
    authoringOperations: [
      {
        ...baseDefinition.authoringOperations![0]!,
        ownedState: {
          ...baseDefinition.authoringOperations![0]!.ownedState!,
          placement: {
            ...baseDefinition.authoringOperations![0]!.ownedState!.placement,
            width: 0,
          },
        },
      },
    ],
  });
  expect(
    missingPlacement.success,
    "Runtime schema should reject non-positive placement extents.",
  ).toBeFalsy();

  const legacyAnchor = validateSketchDefinition({
    ...baseDefinition,
    authoringOperations: [
      {
        ...baseDefinition.authoringOperations![0]!,
        ownedState: {
          ...baseDefinition.authoringOperations![0]!.ownedState!,
          calibration: {
            scaleMode: "lockedAspect",
            anchors: [
              {
                anchorId: "anchor_a",
                label: "Anchor A",
                uv: [0.25, 0.5],
                worldPosition: [10, 5],
              },
            ],
            showExportedAnchorsInSketch: true,
          },
        },
      },
    ],
  });
  expect(
    legacyAnchor.success,
    "Runtime schema should reject calibration anchors that omit a sketch point binding.",
  ).toBeFalsy();

  const legacyConstraints = validateSketchDefinition({
    ...baseDefinition,
    authoringOperations: [
      {
        ...baseDefinition.authoringOperations![0]!,
        ownedState: {
          ...baseDefinition.authoringOperations![0]!.ownedState!,
          calibration: {
            scaleMode: "lockedAspect",
            anchors: [
              {
                anchorId: "anchor_a",
                label: "Anchor A",
                uv: [0.25, 0.5],
                pointId: "sketch_point_anchor_a",
              },
            ],
            constraints: [
              {
                constraintId: "legacy_distance",
                kind: "distance",
                label: "Legacy distance",
                firstAnchorId: "anchor_a",
                secondAnchorId: "anchor_b",
                distance: 10,
              },
            ],
            showExportedAnchorsInSketch: true,
          },
        },
      },
    ],
  });
  expect(
    legacyConstraints.success,
    "Runtime schema should reject deprecated calibration-only constraint payloads.",
  ).toBeFalsy();
});
