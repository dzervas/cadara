import { expect, test } from "vitest";

import type { RegionRecord, SketchDefinition } from "@/contracts/sketch/schema";
import type { SketchEntityId, SketchId, SketchPointId } from "@/contracts/shared/ids";
import { selectInnermostContainingRegion } from "@/domain/import/region-containment";

// Lane: logic (per docs/testing.md — this exercises the exported domain selection seam).
// Seam: curved inner-loop containment must use the same segment geometry as outer-loop containment.
test("curved inner loops exclude their material void without boundary point ids", () => {
  const sketchId = "sketch_containment" as SketchId;
  const point = (name: string) => `sketch_point_${name}` as SketchPointId;
  const entity = (name: string) => `sketch_entity_${name}` as SketchEntityId;
  const definition: SketchDefinition = {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: [point("bl"), point("br"), point("tr"), point("tl"), point("center")],
    points: [
      ["bl", -3, -3], ["br", 3, -3], ["tr", 3, 3], ["tl", -3, 3], ["center", 0, 0],
    ].map(([name, x, y]) => ({
      pointId: point(name as string), label: name as string,
      target: { kind: "sketchPoint" as const, sketchId, pointId: point(name as string) },
      position: [x, y] as [number, number], isConstruction: false,
    })),
    entityIds: [entity("bottom"), entity("right"), entity("top"), entity("left"), entity("circle")],
    entities: [
      ["bottom", "bl", "br"], ["right", "br", "tr"], ["top", "tr", "tl"], ["left", "tl", "bl"],
    ].map(([name, start, end]) => ({
      kind: "lineSegment" as const, entityId: entity(name), label: name,
      target: { kind: "sketchEntity" as const, sketchId, entityId: entity(name) }, isConstruction: false,
      startPointId: point(start), endPointId: point(end),
    })).concat({
      kind: "circle" as const, entityId: entity("circle"), label: "circle",
      target: { kind: "sketchEntity" as const, sketchId, entityId: entity("circle") },
      isConstruction: false, centerPointId: point("center"), radius: 1,
    }),
    constraintIds: [], constraints: [], dimensionIds: [], dimensions: [],
  };
  // Boundary vertices as the arrangement owner publishes them; containment reads only their positions.
  const vertex = (position: [number, number]) => ({
    kind: "declaredJoin" as const, key: `j[${position}]`, pointIds: [], portPointId: null, position, ballRadius: 0,
  });
  const outer = [
    ["bottom", [-3, -3], [3, -3]], ["right", [3, -3], [3, 3]],
    ["top", [3, 3], [-3, 3]], ["left", [-3, 3], [-3, -3]],
  ].map(([name, startPosition, endPosition]) => ({
    branch: { source: { kind: "entity" as const, entityId: entity(name as string) }, spanId: "whole" },
    sourceParameterInterval: [0, 1] as const, traversalDirection: "forward" as const, sourceSegmentOrdinal: 0,
    start: vertex(startPosition as [number, number]), end: vertex(endPosition as [number, number]),
  }));
  const region: RegionRecord = {
    ownerDocumentId: "doc_workspace", ownerRevisionId: "rev_0001", ownerFeatureId: null,
    ownerSketchId: sketchId, ownerBodyId: null, regionId: "region_containment" as RegionRecord["regionId"], signature: "hand-built annulus",
    label: "Annulus", target: { kind: "region", sketchId, regionId: "region_containment" as RegionRecord["regionId"] },
    sourceSketch: { kind: "sketch", sketchId }, isClosed: true,
    loops: [{ loopId: "region_loop_containment_outer" as RegionRecord["loops"][number]["loopId"], role: "outer", orientation: "counterClockwise", segments: outer, boundaryPointIds: [], isClosed: true }, {
      loopId: "region_loop_containment_inner" as RegionRecord["loops"][number]["loopId"], role: "inner", orientation: "clockwise",
      segments: [
        { branch: { source: { kind: "entity", entityId: entity("circle") }, spanId: "whole" }, sourceParameterInterval: [0, Math.PI], traversalDirection: "forward", sourceSegmentOrdinal: 0, start: vertex([1, 0]), end: vertex([-1, 0]) },
        { branch: { source: { kind: "entity", entityId: entity("circle") }, spanId: "whole" }, sourceParameterInterval: [Math.PI, 2 * Math.PI], traversalDirection: "forward", sourceSegmentOrdinal: 1, start: vertex([-1, 0]), end: vertex([1, 0]) },
      ],
      boundaryPointIds: [], isClosed: true,
    }],
  };
  const sketch = { regions: [region], solvedPoints: new Map([[point("center"), [0, 0] as [number, number]]]), definition };

  expect(selectInnermostContainingRegion(sketch, [0, 0])).toBeNull();
  expect(selectInnermostContainingRegion(sketch, [2, 0])?.regionId).toBe(region.regionId);

  // Only an unsplit closed branch has no boundary vertices; a segment with
  // exactly one null end is not a full turn and is rejected (review A3).
  const [inner] = region.loops.slice(1);
  const halfOpen: RegionRecord = {
    ...region,
    loops: [
      region.loops[0]!,
      {
        ...inner!,
        segments: [
          {
            ...inner!.segments[0]!,
            sourceParameterInterval: [0, 2 * Math.PI],
            start: null,
            end: vertex([1, 0]),
          },
        ],
      },
    ],
  };
  expect(
    () =>
      selectInnermostContainingRegion(
        { ...sketch, regions: [halfOpen] },
        [2, 0],
      ),
    "A boundary segment with exactly one null end is rejected, not read as a full circle.",
  ).toThrow(/has a boundary segment with exactly one null end/);
});
