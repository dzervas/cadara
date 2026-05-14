import { test, expect } from "vitest";

import { validateSketchDefinition } from "@/contracts/sketch/runtime-schema";
import type { SketchDefinition } from "@/contracts/sketch/schema";

test("src/contracts/sketch/authoring-operations.runtime-schema.spec.ts", () => {
  const legacyDefinition: SketchDefinition = {
    schemaVersion: "sketch-definition/v1alpha1",
    referenceIds: [],
    references: [],
    pointIds: ["sketch_point_a", "sketch_point_b"],
    points: [
      {
        pointId: "sketch_point_a",
        label: "A",
        target: {
          kind: "sketchPoint",
          sketchId: "sketch_primary",
          pointId: "sketch_point_a",
        },
        position: [0, 0],
        isConstruction: false,
      },
      {
        pointId: "sketch_point_b",
        label: "B",
        target: {
          kind: "sketchPoint",
          sketchId: "sketch_primary",
          pointId: "sketch_point_b",
        },
        position: [1, 0],
        isConstruction: false,
      },
    ],
    entityIds: ["sketch_entity_line"],
    entities: [
      {
        kind: "lineSegment",
        entityId: "sketch_entity_line",
        label: "Line",
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_primary",
          entityId: "sketch_entity_line",
        },
        isConstruction: false,
        startPointId: "sketch_point_a",
        endPointId: "sketch_point_b",
      },
    ],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
  };

  const migrated = validateSketchDefinition(legacyDefinition);
  expect(
    migrated.success,
    "Runtime validation should accept definitions where optional authoring operation metadata is omitted.",
  ).toBeTruthy();

  const withOperation: SketchDefinition = {
    ...legacyDefinition,
    authoringOperations: [
      {
        operationId: "sketch_operation_1_line",
        label: "Line 1",
        kind: "line",
        targets: {
          created: [
            { kind: "point", pointId: "sketch_point_a" },
            { kind: "point", pointId: "sketch_point_b" },
            { kind: "entity", entityId: "sketch_entity_line" },
          ],
        },
        createdGraph: {
          points: legacyDefinition.points,
          entities: legacyDefinition.entities,
        },
      },
    ],
  };

  const parsed = validateSketchDefinition(withOperation);
  expect(
    parsed.success,
    "Runtime schema should accept durable authoring operations.",
  ).toBeTruthy();
  const serialized = JSON.parse(JSON.stringify(parsed.data)) as unknown;
  const roundTrip = validateSketchDefinition(serialized);
  expect(
    roundTrip.success,
    "Authoring operation metadata should survive serialize/parse round-trips.",
  ).toBeTruthy();
  const operation = roundTrip.data.authoringOperations?.[0];
  expect(
    operation?.operationId,
    "Round-tripped operation ID should be preserved.",
  ).toBe("sketch_operation_1_line");
  expect(
    operation.label,
    "Round-tripped operation label should be preserved.",
  ).toBe("Line 1");
  expect(
    operation.kind,
    "Round-tripped operation kind should be preserved.",
  ).toBe("line");
  expect(
    operation.targets.created?.[2]?.kind,
    "Round-tripped operation target refs should be typed.",
  ).toBe("entity");
  expect(
    operation.createdGraph?.entities?.[0]?.entityId,
    "Round-tripped operation graph records should be preserved.",
  ).toBe("sketch_entity_line");

  const withUndefinedOptionalGraphs = validateSketchDefinition({
    ...withOperation,
    authoringOperations: [
      {
        ...withOperation.authoringOperations![0],
        createdGraph: undefined,
        removedGraph: undefined,
      },
    ],
  });
  expect(
    withUndefinedOptionalGraphs.success,
    "Runtime schema should accept optional authoring operation graphs with undefined values.",
  ).toBeTruthy();
  const normalizedOperation = withUndefinedOptionalGraphs.data
    .authoringOperations?.[0] as Record<string, unknown> | undefined;
  expect(
    normalizedOperation && normalizedOperation["createdGraph"] === undefined,
    "Undefined createdGraph should remain an optional operation field.",
  ).toBeTruthy();
  expect(
    normalizedOperation && normalizedOperation["removedGraph"] === undefined,
    "Undefined removedGraph should remain an optional operation field.",
  ).toBeTruthy();

  const withReferenceImage = validateSketchDefinition({
    ...legacyDefinition,
    authoringOperations: [
      {
        operationId: "sketch_operation_2_reference-image",
        label: "Reference image 2",
        kind: "referenceImage",
        targets: {
          created: [
            {
              kind: "operation",
              operationId: "sketch_operation_2_reference-image",
            },
          ],
        },
        ownedState: {
          kind: "referenceImage",
          image: {
            mediaType: "image/png",
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
  });
  expect(
    withReferenceImage.success,
    "Runtime schema should accept operation-owned reference-image state.",
  ).toBeTruthy();
  expect(
    withReferenceImage.data.authoringOperations?.[0]?.targets.created?.[0]
      ?.kind,
    "Reference-image authoring operations should preserve operation member refs.",
  ).toBe("operation");

  const withReferenceImageEdit = validateSketchDefinition({
    ...legacyDefinition,
    authoringOperations: [
      withReferenceImage.data.authoringOperations![0]!,
      {
        operationId: "sketch_operation_3_edit-reference-image",
        label: "reference-updated.png",
        kind: "edit",
        targets: {
          edited: [
            {
              kind: "operation",
              operationId: "sketch_operation_2_reference-image",
            },
          ],
        },
        ownedState: {
          kind: "referenceImage",
          image: {
            mediaType: "image/png",
            fileName: "reference-updated.png",
            pixelWidth: 800,
            pixelHeight: 600,
            base64Data: "dXBkYXRlZA==",
          },
          placement: {
            center: [10, 20],
            width: 240,
            height: 180,
            rotationRadians: 0.25,
          },
        },
      },
    ],
  });
  expect(
    withReferenceImageEdit.success,
    "Edit operations targeting sketch operations should accept operation-owned reference-image state.",
  ).toBeTruthy();

  const invalidOwnedState = validateSketchDefinition({
    ...legacyDefinition,
    authoringOperations: [
      {
        operationId: "sketch_operation_3_rectangle",
        label: "Rectangle 3",
        kind: "rectangle",
        targets: {},
        ownedState: {
          kind: "referenceImage",
          image: {
            mediaType: "image/png",
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
  });
  expect(
    invalidOwnedState.success,
    "Non-reference operations should reject operation-owned reference-image state.",
  ).toBeFalsy();

  const invalidEditOwnedState = validateSketchDefinition({
    ...legacyDefinition,
    authoringOperations: [
      {
        operationId: "sketch_operation_4_edit",
        label: "Edit without operation target",
        kind: "edit",
        targets: {
          edited: [{ kind: "entity", entityId: "sketch_entity_line" }],
        },
        ownedState: {
          kind: "referenceImage",
          image: {
            mediaType: "image/png",
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
  });
  expect(
    invalidEditOwnedState.success,
    "Edit operations without operation targets should reject operation-owned reference-image state.",
  ).toBeFalsy();
});
