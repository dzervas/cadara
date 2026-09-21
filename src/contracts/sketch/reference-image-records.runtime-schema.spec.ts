import { expect, test } from "vitest";
import { validateSketchDefinition } from "./runtime-schema";
import type { SketchDefinition } from "./schema";

const definition: SketchDefinition = {
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
  referenceImages: [
    {
      operationId: "sketch_operation_image",
      label: "Reference",
      kind: "referenceImage",
      ownedPointIds: [],
      ownedEntityIds: [],
      ownedState: {
        kind: "referenceImage",
        image: {
          mediaType: "image/png",
          pixelWidth: 640,
          pixelHeight: 480,
          base64Data: "cG5n",
        },
        placement: {
          center: [10, 20],
          width: 200,
          height: 150,
          rotationRadians: 0.25,
        },
      },
    },
  ],
};

test("explicit current image records preserve authored identity/data through serialization", () => {
  const parsed = validateSketchDefinition(
    JSON.parse(JSON.stringify(definition)),
  );
  expect(parsed.success).toBe(true);
  expect(parsed.data).toEqual(definition);
});

test("replaced action/reconstruction metadata rejects explicitly rather than acting as an image fallback", () => {
  expect(
    validateSketchDefinition({ ...definition, authoringOperations: [] })
      .success,
  ).toBe(false);
  expect(
    validateSketchDefinition({
      ...definition,
      referenceImages: [
        { ...definition.referenceImages![0], createdGraph: { points: [] } },
      ],
    }).success,
  ).toBe(false);
  expect(
    validateSketchDefinition({
      ...definition,
      referenceImages: [{ ...definition.referenceImages![0], kind: "edit" }],
    }).success,
  ).toBe(false);
});

test("invalid authored image structure is rejected by the current contract", () => {
  const record = definition.referenceImages![0]!;
  const missingOwnership = {
    operationId: record.operationId,
    label: record.label,
    kind: record.kind,
    ownedEntityIds: record.ownedEntityIds,
    ownedState: record.ownedState,
  };
  expect(
    validateSketchDefinition({
      ...definition,
      referenceImages: [missingOwnership],
    }).success,
  ).toBe(false);
  expect(
    validateSketchDefinition({
      ...definition,
      referenceImages: [{ ...record, ownedPointIds: ["sketch_point_missing"] }],
    }).success,
  ).toBe(false);
  expect(
    validateSketchDefinition({
      ...definition,
      referenceImages: [
        {
          ...record,
          ownedState: {
            ...record.ownedState,
            image: { ...record.ownedState.image, pixelWidth: -1 },
          },
        },
      ],
    }).success,
  ).toBe(false);
});
