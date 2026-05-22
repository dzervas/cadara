import { test, expect } from "vitest";

import { validateSketchDefinition } from "@/contracts/sketch/runtime-schema";
import type { SketchDefinition } from "@/contracts/sketch/schema";

test("src/contracts/sketch/style-runtime-schema.spec.ts", () => {
  const baseDefinition: SketchDefinition = {
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
        position: [10, 0],
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
        style: {
          strokeMiterLimit: 5,
          strokeDashSize: 0.4,
          strokeGapSize: 0.2,
        },
      },
    ],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
  };

  const migrated = validateSketchDefinition(baseDefinition);
  expect(
    migrated.success,
    "Runtime validation should accept definitions where optional style metadata is omitted.",
  ).toBeTruthy();

  const withStyles: SketchDefinition = {
    ...baseDefinition,
    svgRenderingEnabled: false,
    styleIds: ["sketch_style_line", "sketch_style_region"],
    styles: [
      {
        styleId: "sketch_style_line",
        label: "Primary edge style",
        target: { kind: "entity", entityId: "sketch_entity_line" },
        fill: { kind: "none" },
        stroke: {
          color: "#7dd3fc",
          opacity: 0.95,
          width: 2,
          lineCap: "round",
          lineJoin: "round",
          miterLimit: 4,
          dashSize: 0.6,
          gapSize: 0.25,
        },
      },
      {
        styleId: "sketch_style_region",
        label: "Candidate region style",
        target: { kind: "region", regionId: "region_preview_face" },
        fill: {
          kind: "gradient",
          gradient: {
            kind: "linear",
            angleRadians: 0.3,
            startColor: "#1f2937",
            startOpacity: 0.4,
            endColor: "#0ea5e9",
            endOpacity: 0.8,
          },
        },
        stroke: {
          color: "#0ea5e9",
          opacity: 1,
          width: 1,
          lineCap: "butt",
          lineJoin: "miter",
          miterLimit: 6,
        },
      },
    ],
  };

  const parsed = validateSketchDefinition(withStyles);
  expect(
    parsed.success,
    "Runtime schema should accept authored entity/region style records.",
  ).toBeTruthy();

  const serialized = JSON.parse(JSON.stringify(parsed.data)) as unknown;
  const roundTrip = validateSketchDefinition(serialized);
  expect(
    roundTrip.success,
    "Style payloads should survive serialize/parse round-trips.",
  ).toBeTruthy();
  expect(
    roundTrip.data.svgRenderingEnabled,
    "Round-tripped definitions should preserve SVG rendering state.",
  ).toBeFalsy();
  expect(
    roundTrip.data.styles?.length,
    "Round-tripped style records should be preserved.",
  ).toBe(2);
  expect(
    roundTrip.data.styles?.[1]?.fill.kind,
    "Round-tripped gradient fill should be preserved.",
  ).toBe("gradient");
  expect(
    roundTrip.data.styles?.[0]?.stroke.dashSize,
    "Round-tripped style records should preserve dash size.",
  ).toBe(0.6);
  expect(
    roundTrip.data.entities[0]?.style?.strokeMiterLimit,
    "Round-tripped local style records should preserve miter limits.",
  ).toBe(5);
});
