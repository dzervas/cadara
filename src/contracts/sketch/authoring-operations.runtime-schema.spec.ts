import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
import { sketchDefinitionSchema } from "@/contracts/sketch/runtime-schema";
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

  const migrated = sketchDefinitionSchema.safeParse(legacyDefinition);
  expectTrue(
    migrated.success,
    "Runtime schema should accept legacy sketches without authoring operation metadata.",
  );
  expectTrue(
    Array.isArray(migrated.data.authoringOperations),
    "Missing authoring operations should normalize to an array.",
  );
  expectTrue(
    migrated.data.authoringOperations?.length === 0,
    "Legacy authoring operations should default empty.",
  );

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

  const parsed = sketchDefinitionSchema.safeParse(withOperation);
  expectTrue(
    parsed.success,
    "Runtime schema should accept durable authoring operations.",
  );
  const serialized = JSON.parse(JSON.stringify(parsed.data)) as unknown;
  const roundTrip = sketchDefinitionSchema.safeParse(serialized);
  expectTrue(
    roundTrip.success,
    "Authoring operation metadata should survive serialize/parse round-trips.",
  );
  const operation = roundTrip.data.authoringOperations?.[0];
  expectTrue(
    operation?.operationId === "sketch_operation_1_line",
    "Round-tripped operation ID should be preserved.",
  );
  expectTrue(
    operation.label === "Line 1",
    "Round-tripped operation label should be preserved.",
  );
  expectTrue(
    operation.kind === "line",
    "Round-tripped operation kind should be preserved.",
  );
  expectTrue(
    operation.targets.created?.[2]?.kind === "entity",
    "Round-tripped operation target refs should be typed.",
  );
  expectTrue(
    operation.createdGraph?.entities?.[0]?.entityId === "sketch_entity_line",
    "Round-tripped operation graph records should be preserved.",
  );

  const withUndefinedOptionalGraphs = sketchDefinitionSchema.safeParse({
    ...withOperation,
    authoringOperations: [
      {
        ...withOperation.authoringOperations![0],
        createdGraph: undefined,
        removedGraph: undefined,
      },
    ],
  });
  expectTrue(
    withUndefinedOptionalGraphs.success,
    "Runtime schema should accept optional authoring operation graphs with undefined values.",
  );
  const normalizedOperation = withUndefinedOptionalGraphs.data
    .authoringOperations?.[0] as Record<string, unknown> | undefined;
  expectTrue(
    normalizedOperation && !("createdGraph" in normalizedOperation),
    "Undefined createdGraph should be omitted from normalized operations.",
  );
  expectTrue(
    normalizedOperation && !("removedGraph" in normalizedOperation),
    "Undefined removedGraph should be omitted from normalized operations.",
  );

  const withReferenceImage = sketchDefinitionSchema.safeParse({
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
  expectTrue(
    withReferenceImage.success,
    "Runtime schema should accept operation-owned reference-image state.",
  );
  expectTrue(
    withReferenceImage.data.authoringOperations?.[0]?.targets.created?.[0]
      ?.kind === "operation",
    "Reference-image authoring operations should preserve operation member refs.",
  );

  const withReferenceImageEdit = sketchDefinitionSchema.safeParse({
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
  expectTrue(
    withReferenceImageEdit.success,
    "Edit operations targeting sketch operations should accept operation-owned reference-image state.",
  );

  const invalidOwnedState = sketchDefinitionSchema.safeParse({
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
  expectTrue(
    !invalidOwnedState.success,
    "Non-reference operations should reject operation-owned reference-image state.",
  );

  const invalidEditOwnedState = sketchDefinitionSchema.safeParse({
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
  expectTrue(
    !invalidEditOwnedState.success,
    "Edit operations without operation targets should reject operation-owned reference-image state.",
  );
});
