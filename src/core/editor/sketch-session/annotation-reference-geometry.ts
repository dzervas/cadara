import type { SketchPoint } from "@/contracts/modeling/schema";
import type { SketchToolAnchorDescriptor } from "@/core/sketch-tools/editor-schema";
import type {
  ProjectedSketchGeometryRef,
  LocalCollinearTargetOperand,
  SketchDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import type {
  SketchId,
  SketchEntityId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type { SketchSessionState } from "./types";
import {
  createSketchPointRef,
  createSketchEntityRef,
} from "./session-definition";
import { getLineSegmentGeometry } from "./annotation-geometry";
import { getSketchDatumGuideExtent } from "./definition-patches";
import {
  orderedSplinePointIds,
  solvedCubicSpans,
  solvedCubicSpanPoint,
} from "@/contracts/sketch/spline-geometry";
import type { SolvedCubicSpan } from "@/contracts/sketch/spline-geometry";

export function createOffsetAnnotationAnchor(
  point: SketchPoint | null,
  offset = { x: 18, y: -18 },
): SketchToolAnchorDescriptor {
  return {
    kind: "sketchPoint",
    point: point ?? [0, 0],
    offset,
  };
}

export function createProjectedPrimitiveRef(
  reference: ProjectedSketchGeometryRef & {
    kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
  },
): PrimitiveRef {
  return {
    kind: "projectedReferenceGeometry",
    referenceId: reference.referenceId,
    geometryId: reference.geometryId,
    geometryKind:
      reference.kind === "projectedPoint"
        ? "point"
        : reference.kind === "projectedLineSegment"
          ? "lineSegment"
          : reference.kind === "projectedCircle"
            ? "circle"
            : reference.kind === "projectedArc"
              ? "arc"
              : "spline",
  };
}

export function createReferencePrimitiveRef(
  operand: {
    kind: string;
    reference?: ProjectedSketchGeometryRef & {
      kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
    };
    datum?: "origin" | "xAxis" | "yAxis";
  },
  sketchId: SketchId,
): PrimitiveRef | null {
  if (operand.kind === "projectedGeometry" && operand.reference) {
    return createProjectedPrimitiveRef(operand.reference);
  }

  if (operand.kind === "sketchDatum" && operand.datum) {
    return {
      kind: "sketchDatumReference",
      sketchId,
      datumId: operand.datum,
      geometryKind: operand.datum === "origin" ? "point" : "lineSegment",
    };
  }

  return null;
}

function getDatumAnchor(
  datum: "origin" | "xAxis" | "yAxis",
): SketchPoint {
  switch (datum) {
    case "origin":
      return [0, 0];
    case "xAxis":
    case "yAxis":
      return [0, 0];
  }
}

function getProjectedGeometryAnchor(
  session: SketchSessionState,
  reference: ProjectedSketchGeometryRef & {
    kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
  },
): SketchPoint | null {
  const projectedReference = session.projectedReferences.find(
    (entry) => entry.referenceId === reference.referenceId,
  );

  if (!projectedReference || projectedReference.status !== "projected") {
    return null;
  }

  const geometry = projectedReference.geometry.find(
    (entry) => entry.geometryId === reference.geometryId,
  );

  if (!geometry) {
    return null;
  }

  switch (geometry.kind) {
    case "point":
      return geometry.position;
    case "lineSegment":
      return [
        (geometry.startPosition[0] + geometry.endPosition[0]) / 2,
        (geometry.startPosition[1] + geometry.endPosition[1]) / 2,
      ];
    case "circle":
    case "arc":
      return geometry.centerPosition;
    case "spline":
      // Its start point: the first sample, or pole 0 of the first span.
      return geometry.representation.kind === "sourceSamples"
        ? (geometry.representation.points[0] ?? null)
        : (geometry.representation.spans[0]?.poles[0] ?? null);
  }
}

export function getReferenceGeometryAnchor(
  session: SketchSessionState,
  operand: {
    kind: string;
    reference?: ProjectedSketchGeometryRef & {
      kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
    };
    datum?: "origin" | "xAxis" | "yAxis";
  },
): SketchPoint | null {
  if (operand.kind === "projectedGeometry" && operand.reference) {
    return getProjectedGeometryAnchor(session, operand.reference);
  }

  if (operand.kind === "sketchDatum" && operand.datum) {
    return getDatumAnchor(operand.datum);
  }

  return null;
}

export function createCollinearTargetPrimitiveRef(
  sketchId: SketchId,
  target: LocalCollinearTargetOperand,
): PrimitiveRef {
  return target.kind === "localPoint"
    ? createSketchPointRef(sketchId, target.pointId)
    : createSketchEntityRef(sketchId, target.entityId);
}

export function getCollinearTargetAnchor(
  definition: SketchDefinition,
  target: LocalCollinearTargetOperand,
): SketchPoint | null {
  return target.kind === "localPoint"
    ? getPointPosition(definition, target.pointId)
    : getEntityAnchor(definition, target.entityId);
}

export function getReferenceLineGeometry(
  definition: SketchDefinition,
  session: SketchSessionState,
  operand: {
    kind: string;
    entityId?: SketchEntityId;
    reference?: ProjectedSketchGeometryRef & {
      kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
    };
    datum?: "origin" | "xAxis" | "yAxis";
  },
): { start: SketchPoint; end: SketchPoint } | null {
  if (operand.kind === "localEntity" && operand.entityId) {
    return getLineSegmentGeometry(definition, operand.entityId);
  }

  if (operand.kind === "projectedGeometry" && operand.reference) {
    const reference = operand.reference;
    const projectedReference = session.projectedReferences.find(
      (entry) => entry.referenceId === reference.referenceId,
    );
    const geometry = projectedReference?.geometry.find(
      (entry) => entry.geometryId === reference.geometryId,
    );
    return geometry?.kind === "lineSegment"
      ? { start: geometry.startPosition, end: geometry.endPosition }
      : null;
  }

  if (
    operand.kind === "sketchDatum" &&
    operand.datum &&
    operand.datum !== "origin"
  ) {
    const extent = getSketchDatumGuideExtent(
      definition,
      session.projectedReferences,
    );
    return operand.datum === "xAxis"
      ? { start: [-extent, 0], end: [extent, 0] }
      : { start: [0, -extent], end: [0, extent] };
  }

  return null;
}

export function getReferencePointGeometry(
  definition: SketchDefinition,
  session: SketchSessionState,
  operand: {
    kind: string;
    pointId?: SketchPointId;
    reference?: ProjectedSketchGeometryRef & {
      kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
    };
    datum?: "origin" | "xAxis" | "yAxis";
  },
): SketchPoint | null {
  if (operand.kind === "localPoint" && operand.pointId) {
    return getPointPosition(definition, operand.pointId);
  }

  return getReferenceGeometryAnchor(session, operand);
}

export function getPointPosition(
  definition: SketchDefinition,
  pointId: SketchPointId,
): SketchPoint | null {
  return (
    definition.points.find((point) => point.pointId === pointId)?.position ??
    null
  );
}

export function getAveragePointPosition(
  definition: SketchDefinition,
  pointIds: readonly SketchPointId[],
): SketchPoint | null {
  const points = pointIds.flatMap((pointId) => {
    const position = getPointPosition(definition, pointId);
    return position ? [position] : [];
  });

  return getAverageSketchPoint(points);
}

export function getAverageEntityAnchor(
  definition: SketchDefinition,
  entityIds: readonly SketchEntityId[],
): SketchPoint | null {
  const points = entityIds.flatMap((entityId) => {
    const position = getEntityAnchor(definition, entityId);
    return position ? [position] : [];
  });

  return getAverageSketchPoint(points);
}

export function getEntityAnchor(
  definition: SketchDefinition,
  entityId: SketchEntityId,
  /** T08b-g5b: places a derived offset shell's anchor on its solved curve. */
  solvedSnapshot: SolvedSketchSnapshot | null = null,
): SketchPoint | null {
  const entity = definition.entities.find(
    (entry) => entry.entityId === entityId,
  );

  if (!entity) {
    return null;
  }

  switch (entity.kind) {
    case "lineSegment":
      return getAveragePointPosition(definition, [
        entity.startPointId,
        entity.endPointId,
      ]);
    case "point":
      return getPointPosition(definition, entity.pointId);
    case "circle":
      return getPointPosition(definition, entity.centerPointId);
    case "arc":
      return getPointPosition(definition, entity.centerPointId);
    case "spline":
      return getAveragePointPosition(definition, orderedSplinePointIds(entity));
    case "ellipse":
      return getPointPosition(definition, entity.centerPointId);
    case "ellipticalArc":
      return getPointPosition(definition, entity.centerPointId);
    case "conic":
      return getAveragePointPosition(definition, [
        entity.startPointId,
        entity.controlPointId,
        entity.endPointId,
      ]);
    case "bezierCurve":
      return getAveragePointPosition(definition, entity.controlPointIds);
    case "profileText":
      return getPointPosition(definition, entity.anchorPointId);
    case "derivedPiecewiseCubic":
      return getDerivedShellAnchor(definition, entityId, solvedSnapshot);
  }
}

/**
 * A derived offset shell's anchor lies on the curve (T08b-g5b): the point at
 * the middle of the drawn (`queryDomain`) source-parameter range of its
 * solved spans, provisional or certified. Without its solved record, the
 * shell's start terminal driven point (the mean of the terminals can lie off
 * an open curve).
 */
function getDerivedShellAnchor(
  definition: SketchDefinition,
  entityId: SketchEntityId,
  solvedSnapshot: SolvedSketchSnapshot | null,
): SketchPoint | null {
  const record = solvedSnapshot?.solvedEntities.find(
    (entry) => entry.entityId === entityId,
  );
  const spans = record ? solvedCubicSpans(record) : [];
  const drawn = (span: SolvedCubicSpan) => span.queryDomain ?? span.interval;
  const first = spans[0];
  const last = spans.at(-1);
  if (first && last) {
    const middle = (drawn(first)[0] + drawn(last)[1]) / 2;
    const span =
      spans.find(
        (candidate) =>
          drawn(candidate)[0] <= middle && middle <= drawn(candidate)[1],
      ) ?? last;
    const [low, high] = span.interval;
    return solvedCubicSpanPoint(
      span,
      Math.min(1, Math.max(0, (middle - low) / (high - low))),
    );
  }
  const output = definition.derivedRelationships
    ?.flatMap((relationship) =>
      relationship.kind === "offset" ? relationship.piecewiseCubicOutputs : [],
    )
    .find((candidate) => candidate.outputEntityId === entityId);
  return output ? getPointPosition(definition, output.startPointId) : null;
}

export function getEntityAnchorPointId(
  definition: SketchDefinition,
  entityId: SketchEntityId,
): SketchPointId | null {
  const entity = definition.entities.find(
    (entry) => entry.entityId === entityId,
  );

  if (!entity) {
    return null;
  }

  switch (entity.kind) {
    case "lineSegment":
      return entity.startPointId;
    case "point":
      return entity.pointId;
    case "circle":
    case "arc":
      return entity.centerPointId;
    case "spline":
      return orderedSplinePointIds(entity)[0] ?? null;
    case "ellipse":
    case "ellipticalArc":
      return entity.centerPointId;
    case "conic":
      return entity.startPointId;
    case "bezierCurve":
      return entity.controlPointIds[0] ?? null;
    case "profileText":
      return entity.anchorPointId;
    case "derivedPiecewiseCubic":
      return null;
  }
}

export function getAverageSketchPoint(
  points: readonly SketchPoint[],
): SketchPoint | null {
  if (points.length === 0) {
    return null;
  }

  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ];
}
