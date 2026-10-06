/**
 * T13d spec support: a multi-entity sketch (rectangle, a crossing diagonal,
 * a circle and an arc) with one reference dimension of every numeric
 * dimension kind, each with its driving twin and its measured quantity at
 * the authored positions. Shared by the contract, solver and adapter-parity
 * specs.
 */
import type { DimensionId } from "@/contracts/shared/ids";
import type {
  DimensionDefinition,
  DrivingDimensionDefinition,
  ReferenceDimensionDefinition,
  SketchDefinition,
} from "@/contracts/sketch/schema";
import { makeSketchFixture } from "@/contracts/sketch/region-extraction.fixtures";

export interface ReferenceDimensionCase {
  name: string;
  reference: ReferenceDimensionDefinition;
  /** The same dimension as driving, valued at its measured quantity. */
  driving: DrivingDimensionDefinition;
  /** Measured quantity in the solver's units and sign convention; null = undefined. */
  measured: number | null;
}

const point = (name: string) => `sketch_point_${name}` as const;
const entity = (name: string) => `sketch_entity_${name}` as const;
const line = (name: string) => ({
  kind: "localEntity" as const,
  entityId: entity(name),
});

/**
 * Rectangle a(0,0) b(4,0) c(4,3) d(0,3), a diagonal p(6,0)→q(9,3), a circle
 * at e(12,1) r 2 and an arc at f(12,8) from g(14,8) to h(12,10).
 */
export function makeReferenceDimensionSketch(): SketchDefinition {
  const sketch = makeSketchFixture();
  for (const [name, x, y] of [
    ["a", 0, 0],
    ["b", 4, 0],
    ["c", 4, 3],
    ["d", 0, 3],
    ["p", 6, 0],
    ["q", 9, 3],
    ["e", 12, 1],
    ["f", 12, 8],
    ["g", 14, 8],
    ["h", 12, 10],
  ] as const)
    sketch.point(name, x, y);
  sketch.line("bottom", "a", "b");
  sketch.line("right", "b", "c");
  sketch.line("top", "c", "d");
  sketch.line("left", "d", "a");
  sketch.line("diagonal", "p", "q");
  sketch.circle("circle", "e", 2);
  sketch.arc("arc", "f", "g", "h");
  return sketch.definition();
}

/** One reference dimension per numeric kind (and axis variant). */
export function makeReferenceDimensionCases(): ReferenceDimensionCase[] {
  const id = (name: string) => `dimension_ref_${name}` as DimensionId;
  const drivingCases: Array<{
    name: string;
    driving: DrivingDimensionDefinition;
    measured: number | null;
  }> = [
    {
      name: "distance aligned",
      measured: 5,
      driving: {
        dimensionId: id("distance_aligned"),
        kind: "distance",
        label: "Distance a–c",
        axis: "aligned",
        pointIds: [point("a"), point("c")],
        value: 5,
      },
    },
    {
      name: "distance horizontal",
      measured: 4,
      driving: {
        dimensionId: id("distance_horizontal"),
        kind: "distance",
        label: "Horizontal a–b",
        axis: "horizontal",
        pointIds: [point("a"), point("b")],
        value: 4,
      },
    },
    {
      name: "distance vertical",
      measured: 3,
      driving: {
        dimensionId: id("distance_vertical"),
        kind: "distance",
        label: "Vertical a–d",
        axis: "vertical",
        pointIds: [point("a"), point("d")],
        value: 3,
      },
    },
    {
      name: "pointDatumDistance",
      measured: 5,
      driving: {
        dimensionId: id("point_datum"),
        kind: "pointDatumDistance",
        label: "Origin to c",
        axis: "aligned",
        point: { kind: "localPoint", pointId: point("c") },
        datum: { kind: "sketchDatum", datum: "origin" },
        value: 5,
      },
    },
    {
      name: "circleRadius",
      measured: 2,
      driving: {
        dimensionId: id("circle_radius"),
        kind: "circleRadius",
        label: "Circle radius",
        entityId: entity("circle"),
        value: 2,
      },
    },
    {
      name: "diameter (circle)",
      measured: 4,
      driving: {
        dimensionId: id("diameter_circle"),
        kind: "diameter",
        label: "Circle diameter",
        entityId: entity("circle"),
        value: 4,
      },
    },
    {
      name: "diameter (arc)",
      measured: 4,
      driving: {
        dimensionId: id("diameter_arc"),
        kind: "diameter",
        label: "Arc diameter",
        entityId: entity("arc"),
        value: 4,
      },
    },
    {
      name: "lineLength",
      measured: 4,
      driving: {
        dimensionId: id("line_length"),
        kind: "lineLength",
        label: "Bottom length",
        entityId: entity("bottom"),
        value: 4,
      },
    },
    {
      name: "lineDistance",
      measured: 3,
      driving: {
        dimensionId: id("line_distance"),
        kind: "lineDistance",
        label: "Bottom to top",
        lines: [line("bottom"), line("top")],
        value: 3,
      },
    },
    {
      name: "lineDistance (non-parallel: undefined)",
      measured: null,
      driving: {
        dimensionId: id("line_distance_undefined"),
        kind: "lineDistance",
        label: "Bottom to diagonal",
        lines: [line("bottom"), line("diagonal")],
        value: 1,
      },
    },
    {
      name: "linePointDistance",
      measured: 3,
      driving: {
        dimensionId: id("line_point"),
        kind: "linePointDistance",
        label: "Bottom to c",
        line: line("bottom"),
        point: { kind: "localPoint", pointId: point("c") },
        value: 3,
      },
    },
    {
      name: "lineAngle",
      measured: (3 * Math.PI) / 4,
      driving: {
        dimensionId: id("line_angle"),
        kind: "lineAngle",
        label: "Bottom to diagonal angle",
        lines: [line("bottom"), line("diagonal")],
        valueRadians: (3 * Math.PI) / 4,
      },
    },
    {
      name: "horizontalDistance",
      measured: 4,
      driving: {
        dimensionId: id("horizontal"),
        kind: "horizontalDistance",
        label: "Horizontal d–c",
        pointIds: [point("d"), point("c")],
        value: 4,
      },
    },
    {
      name: "verticalDistance",
      measured: 3,
      driving: {
        dimensionId: id("vertical"),
        kind: "verticalDistance",
        label: "Vertical b–c",
        pointIds: [point("b"), point("c")],
        value: 3,
      },
    },
  ];
  return drivingCases.map(({ name, driving, measured }) => ({
    name,
    driving,
    measured,
    reference: toReference(driving),
  }));
}

function toReference(
  dimension: DrivingDimensionDefinition,
): ReferenceDimensionDefinition {
  const shape: Record<string, unknown> = { ...dimension, reference: true };
  delete shape.value;
  delete shape.valueRadians;
  return shape as ReferenceDimensionDefinition;
}

export function withDimensions(
  definition: SketchDefinition,
  dimensions: readonly DimensionDefinition[],
): SketchDefinition {
  return {
    ...definition,
    dimensionIds: dimensions.map((dimension) => dimension.dimensionId),
    dimensions: [...dimensions],
  };
}
