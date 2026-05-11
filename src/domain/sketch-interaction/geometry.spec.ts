import { test } from "bun:test";

import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";
import type {
  SketchDefinition,
  SketchPoint2D,
} from "@/contracts/sketch/schema";
import type {
  ProjectedGeometryId,
  ReferenceId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import { createStandardPlaneDefinition } from "@/domain/modeling/opencascade-kernel-seed";
import {
  createArcEntityDefinition,
  createBezierCurveEntityDefinition,
  createCircleEntityDefinition,
  createConicEntityDefinition,
  createEllipseEntityDefinition,
  createEllipticalArcEntityDefinition,
  createLineEntityDefinition,
  createPointDefinition,
  createProfileTextEntityDefinition,
  createSplineEntityDefinition,
} from "@/domain/editor/sketch-session/internals";
import { createNewSketchSession } from "@/domain/editor/sketch-session";
import {
  collectSketchInteractionGeometry,
  flattenSketchInteractionCurve,
  isSketchInteractionCurveGeometry,
} from "@/domain/sketch-interaction/geometry";
import { expectTrue } from "@/testing/expect.spec";

test("collectSketchInteractionGeometry preserves local, projected, datum, and advanced sketch targets", () => {
  const sketchId = "sketch_primary" as SketchId;
  const point = (suffix: string, position: SketchPoint2D) =>
    createPointDefinition(
      sketchId,
      `sketch_point_${suffix}` as SketchPointId,
      suffix,
      position,
    );
  const points = [
    point("line_a", [-3, 0]),
    point("line_b", [-1, 0]),
    point("center", [0, 0]),
    point("arc_start", [2, 0]),
    point("arc_end", [0, 2]),
    point("spline_a", [0, -2]),
    point("spline_b", [1, -1]),
    point("spline_c", [2, -2]),
    point("ellipse_center", [4, 0]),
    point("ellipse_major", [6, 0]),
    point("elliptical_arc_center", [7, 0]),
    point("elliptical_arc_major", [9, 0]),
    point("elliptical_arc_start", [9, 0]),
    point("elliptical_arc_end", [7, 1]),
    point("conic_start", [0, 3]),
    point("conic_control", [1, 4]),
    point("conic_end", [2, 3]),
    point("bezier_a", [3, 3]),
    point("bezier_b", [4, 4]),
    point("bezier_c", [5, 4]),
    point("bezier_d", [6, 3]),
    point("text_anchor", [0, 5]),
  ];
  const entities = [
    createLineEntityDefinition(
      sketchId,
      "sketch_entity_line" as SketchEntityId,
      "Line",
      points[0]!.pointId,
      points[1]!.pointId,
    ),
    createCircleEntityDefinition(
      sketchId,
      "sketch_entity_circle" as SketchEntityId,
      "Circle",
      points[2]!.pointId,
      1.5,
    ),
    createArcEntityDefinition(
      sketchId,
      "sketch_entity_arc" as SketchEntityId,
      "Arc",
      points[2]!.pointId,
      points[3]!.pointId,
      points[4]!.pointId,
      "counterClockwise",
    ),
    createSplineEntityDefinition(
      sketchId,
      "sketch_entity_spline" as SketchEntityId,
      "Spline",
      [points[5]!.pointId, points[6]!.pointId, points[7]!.pointId],
    ),
    createEllipseEntityDefinition(
      sketchId,
      "sketch_entity_ellipse" as SketchEntityId,
      "Ellipse",
      points[8]!.pointId,
      points[9]!.pointId,
      1,
    ),
    createEllipticalArcEntityDefinition(
      sketchId,
      "sketch_entity_elliptical_arc" as SketchEntityId,
      "Elliptical arc",
      points[10]!.pointId,
      points[11]!.pointId,
      points[12]!.pointId,
      points[13]!.pointId,
      1,
      "counterClockwise",
    ),
    createConicEntityDefinition(
      sketchId,
      "sketch_entity_conic" as SketchEntityId,
      "Conic",
      points[14]!.pointId,
      points[15]!.pointId,
      points[16]!.pointId,
      0.5,
    ),
    createBezierCurveEntityDefinition(
      sketchId,
      "sketch_entity_bezier" as SketchEntityId,
      "Bezier",
      [
        points[17]!.pointId,
        points[18]!.pointId,
        points[19]!.pointId,
        points[20]!.pointId,
      ],
      3,
    ),
    createProfileTextEntityDefinition(
      sketchId,
      "sketch_entity_text" as SketchEntityId,
      "Text",
      points[21]!.pointId,
      "CAD",
      1,
      0,
      "left",
      "baseline",
    ),
  ];
  const projectedReference = makeProjectedReference();
  const definition: SketchDefinition = {
    ...createNewSketchSession(createStandardPlaneDefinition("xy")).definition,
    pointIds: points.map((entry) => entry.pointId),
    points,
    entityIds: entities.map((entity) => entity.entityId),
    entities,
  };
  const session = {
    ...createNewSketchSession(createStandardPlaneDefinition("xy")),
    sketchId,
    definition,
    fullDefinition: definition,
    projectedReferences: [projectedReference],
  };

  const geometry = collectSketchInteractionGeometry(session);
  const byKind = new Set(geometry.map((entry) => entry.kind));

  expectTrue(
    byKind.has("point"),
    "Local point definitions and datum origin should be available as semantic interaction points.",
  );
  expectTrue(
    byKind.has("lineSegment"),
    "Local lines, projected lines, and datum axes should be available as semantic line segments.",
  );
  expectTrue(
    byKind.has("circle"),
    "Local and projected circles should be available as semantic circles.",
  );
  expectTrue(
    byKind.has("arc"),
    "Local and projected arcs should be available as semantic arcs.",
  );
  expectTrue(
    byKind.has("spline"),
    "Local and projected splines should be available as semantic splines.",
  );
  expectTrue(
    byKind.has("sampledCurve"),
    "Advanced local curves should be available as sampled semantic curves.",
  );
  expectTrue(
    geometry.some((entry) => entry.target === points[0]!.target),
    "Local point interaction geometry must preserve the authored point target object.",
  );
  expectTrue(
    geometry.some((entry) => entry.target === entities[0]!.target),
    "Local entity interaction geometry must preserve the authored entity target object.",
  );
  expectTrue(
    geometry.some(
      (entry) =>
        entry.target.kind === "projectedReferenceGeometry" &&
        entry.target.referenceId === projectedReference.referenceId &&
        entry.target.geometryId === projectedReference.geometry[0]!.geometryId,
    ),
    "Projected interaction geometry must use the projectedReferenceGeometry target.",
  );
  expectTrue(
    geometry.some(
      (entry) =>
        entry.target.kind === "sketchDatumReference" &&
        entry.target.sketchId === sketchId &&
        entry.target.datumId === "xAxis",
    ),
    "Datum axes should use durable sketchDatumReference targets for the active sketch.",
  );
});

test("flattenSketchInteractionCurve respects arc sweeps and closes closed curves", () => {
  const sketchId = "sketch_primary" as SketchId;
  const point = (suffix: string, position: SketchPoint2D) =>
    createPointDefinition(
      sketchId,
      `sketch_point_${suffix}` as SketchPointId,
      suffix,
      position,
    );
  const center = point("center", [0, 0]);
  const start = point("start", [2, 0]);
  const end = point("end", [0, 2]);
  const points = [center, start, end];
  const arc = createArcEntityDefinition(
    sketchId,
    "sketch_entity_arc" as SketchEntityId,
    "Arc",
    center.pointId,
    start.pointId,
    end.pointId,
    "counterClockwise",
  );
  const circle = createCircleEntityDefinition(
    sketchId,
    "sketch_entity_circle" as SketchEntityId,
    "Circle",
    center.pointId,
    2,
  );
  const missingLine = createLineEntityDefinition(
    sketchId,
    "sketch_entity_missing_line" as SketchEntityId,
    "Missing line",
    start.pointId,
    "sketch_point_missing" as SketchPointId,
  );
  const definition: SketchDefinition = {
    ...createNewSketchSession(createStandardPlaneDefinition("xy")).definition,
    pointIds: points.map((entry) => entry.pointId),
    points,
    entityIds: [arc.entityId, circle.entityId, missingLine.entityId],
    entities: [arc, circle, missingLine],
  };
  const session = {
    ...createNewSketchSession(createStandardPlaneDefinition("xy")),
    sketchId,
    definition,
    fullDefinition: definition,
  };
  const geometry = collectSketchInteractionGeometry(session);
  const arcGeometry = geometry.find((entry) => entry.target === arc.target);
  const circleGeometry = geometry.find(
    (entry) => entry.target === circle.target,
  );

  expectTrue(
    arcGeometry !== undefined && isSketchInteractionCurveGeometry(arcGeometry),
    "The authored arc should produce curve geometry.",
  );
  expectTrue(
    circleGeometry !== undefined &&
      isSketchInteractionCurveGeometry(circleGeometry),
    "The authored circle should produce curve geometry.",
  );

  const arcPoints = flattenSketchInteractionCurve(arcGeometry);
  expectTrue(
    nearestDistance(arcPoints, [Math.SQRT2, Math.SQRT2]) < 0.08,
    "Flattened arc points should include points inside the authored sweep.",
  );
  expectTrue(
    nearestDistance(arcPoints, [-2, 0]) > 2,
    "Flattened arc points should not include the opposite side outside the authored sweep.",
  );

  const circlePoints = flattenSketchInteractionCurve(circleGeometry);
  expectTrue(
    samePoint(circlePoints[0]!, circlePoints[circlePoints.length - 1]!),
    "Closed curves should include the closing segment endpoint.",
  );
  expectTrue(
    !geometry.some((entry) => entry.target === missingLine.target),
    "Entities with missing defining points should be excluded instead of receiving fallback targets.",
  );
});

function makeProjectedReference(): ProjectedSketchReferenceRecord {
  return {
    referenceId: "reference_projected" as ReferenceId,
    status: "projected",
    geometry: [
      {
        kind: "lineSegment",
        geometryId: "projected_geometry_line" as ProjectedGeometryId,
        startPosition: [-1, -1],
        endPosition: [1, -1],
      },
      {
        kind: "circle",
        geometryId: "projected_geometry_circle" as ProjectedGeometryId,
        centerPosition: [0, 0],
        radius: 1,
      },
      {
        kind: "arc",
        geometryId: "projected_geometry_arc" as ProjectedGeometryId,
        centerPosition: [0, 0],
        startPosition: [1, 0],
        endPosition: [0, 1],
        sweepDirection: "counterClockwise",
      },
      {
        kind: "spline",
        geometryId: "projected_geometry_spline" as ProjectedGeometryId,
        fitPoints: [
          [0, 0],
          [1, 1],
          [2, 0],
        ],
        degree: 2,
        isClosed: false,
      },
    ],
    diagnostics: [],
  };
}

function nearestDistance(
  points: readonly SketchPoint2D[],
  target: SketchPoint2D,
) {
  return points.reduce(
    (nearest, point) =>
      Math.min(nearest, Math.hypot(point[0] - target[0], point[1] - target[1])),
    Number.POSITIVE_INFINITY,
  );
}

function samePoint(left: SketchPoint2D, right: SketchPoint2D) {
  return Math.hypot(left[0] - right[0], left[1] - right[1]) < 1e-9;
}
