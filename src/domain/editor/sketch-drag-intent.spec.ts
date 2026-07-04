import { test, expect } from "vitest";

import type { SketchDefinition } from "@/contracts/sketch/schema";
import { resolveSketchDragIntent } from "@/domain/editor/sketch-session";

// Lane: logic (docs/testing.md). Seam: the deterministic per-handle drag intent
// contract in src/domain/editor/sketch-session/drag-intent.ts. These tests prove
// the sketch-drag-semantics guarantee that the drag intent is decided by the
// grabbed handle (point vs entity body vs rim vs center), not by solver luck.
test("src/domain/editor/sketch-drag-intent.spec.ts", () => {
  function point(pointId: string, x: number, y: number) {
    return {
      pointId: pointId as `sketch_point_${string}`,
      label: pointId,
      target: {
        kind: "sketchPoint",
        sketchId: "sketch_primary",
        pointId: pointId as `sketch_point_${string}`,
      } as const,
      position: [x, y] as const,
      isConstruction: false,
    };
  }

  const definition: SketchDefinition = {
    schemaVersion: "sketch-definition/v1alpha1",
    referenceIds: [],
    references: [],
    pointIds: ["p_start", "p_end", "p_center", "p_arc_center"],
    points: [
      point("p_start", 0, 0),
      point("p_end", 4, 0),
      point("p_center", 2, 2),
      point("p_arc_center", 2, 0),
    ],
    entityIds: ["e_line", "e_circle", "e_arc"],
    entities: [
      {
        kind: "lineSegment",
        entityId: "e_line" as `sketch_entity_${string}`,
        label: "Line",
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_primary",
          entityId: "e_line" as `sketch_entity_${string}`,
        } as const,
        isConstruction: false,
        startPointId: "p_start" as `sketch_point_${string}`,
        endPointId: "p_end" as `sketch_point_${string}`,
      },
      {
        kind: "circle",
        entityId: "e_circle" as `sketch_entity_${string}`,
        label: "Circle",
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_primary",
          entityId: "e_circle" as `sketch_entity_${string}`,
        } as const,
        isConstruction: false,
        centerPointId: "p_center" as `sketch_point_${string}`,
        radius: 3,
      },
      {
        kind: "arc",
        entityId: "e_arc" as `sketch_entity_${string}`,
        label: "Arc",
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_primary",
          entityId: "e_arc" as `sketch_entity_${string}`,
        } as const,
        isConstruction: false,
        centerPointId: "p_arc_center" as `sketch_point_${string}`,
        startPointId: "p_start" as `sketch_point_${string}`,
        endPointId: "p_end" as `sketch_point_${string}`,
        sweepDirection: "counterClockwise",
      },
    ],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
  };

  function testPointHandleTargetsOnlyThatPoint() {
    const intent = resolveSketchDragIntent(definition, {
      kind: "point",
      pointId: "p_end" as `sketch_point_${string}`,
    });
    expect(intent, "Point handle should resolve an intent.").toEqual({
      kind: "point",
      pointId: "p_end",
    });
  }

  function testEntityBodyHandleTranslatesAllDefiningPoints() {
    const intent = resolveSketchDragIntent(definition, {
      kind: "entityBody",
      entityId: "e_line" as `sketch_entity_${string}`,
    });
    expect(
      intent?.kind,
      "Entity-body handle should request a translation intent.",
    ).toBe("translate");
    expect(
      intent?.kind === "translate" ? [...intent.pointIds] : [],
      "Entity-body drag should translate every defining point of the line.",
    ).toEqual(["p_start", "p_end"]);
  }

  function testCircleRimHandleTargetsRadiusNotCenter() {
    const intent = resolveSketchDragIntent(definition, {
      kind: "rim",
      entityId: "e_circle" as `sketch_entity_${string}`,
    });
    expect(intent, "Circle rim handle should resolve a radius intent.").toEqual({
      kind: "radius",
      entityId: "e_circle",
    });
  }

  function testCircleCenterHandleTranslatesCenter() {
    const intent = resolveSketchDragIntent(definition, {
      kind: "center",
      entityId: "e_circle" as `sketch_entity_${string}`,
    });
    expect(
      intent?.kind === "translate" ? [...intent.pointIds] : null,
      "Circle center handle should translate the center point.",
    ).toEqual(["p_center"]);
  }

  function testArcCenterHandleTranslatesWholeArc() {
    const intent = resolveSketchDragIntent(definition, {
      kind: "center",
      entityId: "e_arc" as `sketch_entity_${string}`,
    });
    expect(
      intent?.kind === "translate" ? [...intent.pointIds] : null,
      "Arc center handle must translate every defining point of the arc (center alone would deform it).",
    ).toEqual(["p_arc_center", "p_start", "p_end"]);
  }

  function testRimHandleOnNonRadialEntityIsRejected() {
    const intent = resolveSketchDragIntent(definition, {
      kind: "rim",
      entityId: "e_line" as `sketch_entity_${string}`,
    });
    expect(
      intent,
      "A rim handle is only meaningful for circles and arcs.",
    ).toBe(null);
  }

  testPointHandleTargetsOnlyThatPoint();
  testEntityBodyHandleTranslatesAllDefiningPoints();
  testCircleRimHandleTargetsRadiusNotCenter();
  testCircleCenterHandleTranslatesCenter();
  testArcCenterHandleTranslatesWholeArc();
  testRimHandleOnNonRadialEntityIsRejected();
});
