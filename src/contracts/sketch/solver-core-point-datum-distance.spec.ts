import { expect, test } from "vitest";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import type { NumericSketchDefinition } from "@/contracts/sketch/schema";

// The unsigned datum dimensions keep a rectangle's corner on its authored side
// while another dimension grows it. Both axis orientations must stay smooth
// even when an optimizer trial crosses the datum.
test.each([
  { axis: "horizontal", side: 1 },
  { axis: "horizontal", side: -1 },
  { axis: "vertical", side: 1 },
  { axis: "vertical", side: -1 },
] as const)(
  "point-datum $axis distance retains side $side during a rectangle resize",
  ({ axis, side }) => {
    const points = (
      [
        [2, 2],
        [58, 2],
        [58, 38],
        [2, 38],
      ] as const
    ).map(([x, y], index) => ({
      pointId: `sketch_point_${index}` as const,
      label: `Corner ${index}`,
      target: {
        kind: "sketchPoint",
        sketchId: "sketch_rectangle",
        pointId: `sketch_point_${index}`,
      } as const,
      position: (axis === "horizontal" ? [side * x, y] : [y, side * x]) as [
        number,
        number,
      ],
      isConstruction: false,
    }));
    const entities = points.map((point, index) => ({
      kind: "lineSegment" as const,
      entityId: `sketch_entity_${index}` as const,
      label: `Side ${index}`,
      target: {
        kind: "sketchEntity",
        sketchId: "sketch_rectangle",
        entityId: `sketch_entity_${index}`,
      } as const,
      startPointId: point.pointId,
      endPointId: points[(index + 1) % 4]!.pointId,
      isConstruction: false,
    }));
    const constraints = entities.map((entity, index) => ({
      kind: ((index % 2 === 0) === (axis === "horizontal")
        ? "horizontal"
        : "vertical") as "horizontal" | "vertical",
      constraintId: `constraint_${index}` as const,
      label: `Axis ${index}`,
      entityId: entity.entityId,
    }));
    const dimensions: NumericSketchDefinition["dimensions"] = [
      {
        kind: "lineLength",
        dimensionId: "dimension_width",
        label: "Width",
        entityId: entities[0]!.entityId,
        value: 76,
      },
      ...(["horizontal", "vertical"] as const).map((dimensionAxis) => ({
        kind: "pointDatumDistance" as const,
        dimensionId: `dimension_${dimensionAxis}` as const,
        label: dimensionAxis,
        axis: dimensionAxis,
        point: { kind: "localPoint", pointId: points[0]!.pointId } as const,
        datum: { kind: "sketchDatum", datum: "origin" } as const,
        value: 2,
      })),
    ];
    const definition: NumericSketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      points,
      pointIds: points.map((p) => p.pointId),
      entities,
      entityIds: entities.map((e) => e.entityId),
      constraints,
      constraintIds: constraints.map((c) => c.constraintId),
      dimensions,
      dimensionIds: dimensions.map((d) => d.dimensionId),
      references: [],
      referenceIds: [],
      derivedRelationships: [],
    };
    const result = solveSketchDefinitionCore({
      definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    expect(result.status.solveState).toBe("solved");
    const corner = result.solvedSnapshot.solvedPoints.find(
      (p) => p.pointId === points[0]!.pointId,
    )!;
    expect(corner.solvedPosition[axis === "horizontal" ? 0 : 1]).toBeCloseTo(
      side * 2,
      5,
    );
    expect(corner.solvedPosition[axis === "horizontal" ? 1 : 0]).toBeCloseTo(
      2,
      5,
    );
  },
);
