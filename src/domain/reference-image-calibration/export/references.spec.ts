import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import {
  buildReferenceImageAnchorProjectedReferences,
  mergeReferenceImageAnchorReferences,
} from "@/domain/reference-image-calibration/export/references";
import { createReferenceImageOperation } from "@/domain/reference-image/operations";

test("src/domain/reference-image-calibration/export/references.spec.ts does not synthesize exported anchor references into the sketch definition", () => {
  const operation = createReferenceImageOperation({
    sequence: 1,
    sketchId: "sketch_primary",
    payload: {
      mediaType: "image/png",
      fileName: "reference.png",
      pixelWidth: 400,
      pixelHeight: 200,
      base64Data: "cG5n",
    },
  });

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
    svgRenderingEnabled: true,
    derivedRelationships: [],
    authoringOperations: [operation],
  };

  const merged = mergeReferenceImageAnchorReferences(
    definition,
    "sketch_primary",
  );

  expectTrue(
    merged.references.length === 0 && merged.referenceIds.length === 0,
    "Reference-image calibration should no longer synthesize fixed exported anchor references.",
  );
});

test("src/domain/reference-image-calibration/export/references.spec.ts does not emit projected anchor geometry records", () => {
  const operation = createReferenceImageOperation({
    sequence: 1,
    sketchId: "sketch_primary",
    payload: {
      mediaType: "image/png",
      fileName: "reference.png",
      pixelWidth: 400,
      pixelHeight: 200,
      base64Data: "cG5n",
    },
  });

  const projectedReferences = buildReferenceImageAnchorProjectedReferences({
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
    svgRenderingEnabled: true,
    derivedRelationships: [],
    authoringOperations: [operation],
  } satisfies SketchDefinition);

  expectTrue(
    projectedReferences.length === 0,
    "Reference-image calibration should no longer export projected anchor geometry into the main sketch solve.",
  );
});
