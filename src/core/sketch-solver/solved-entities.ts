import { splineTangentStateKey } from "./parameter-projection";
import {
  add,
  getArcParameters,
  getCircleRadius,
  getPoint,
} from "./solver-geometry";
import type {
  SolverEntityState,
  SolverPointRecord,
  SplineTangentState,
} from "./system-types";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type {
  NumericSketchDefinition as SketchDefinition,
  SketchPoint2D,
  SolvedSketchDerivedCubicSpan,
  SolvedSketchEntityGeometryRecord,
} from "@/contracts/sketch/schema";
import { reconstructSplineAggregate } from "@/contracts/sketch/spline-geometry";

export function buildSolvedEntities(
  definition: SketchDefinition,
  pointRecords: Map<SketchPointId, SolverPointRecord>,
  entityStates: Map<SketchEntityId, SolverEntityState>,
  splineTangentStates: Map<string, SplineTangentState>,
  values: Float64Array,
  shellSpans: ReadonlyMap<SketchEntityId, SolvedSketchDerivedCubicSpan[]>,
): SolvedSketchEntityGeometryRecord[] {
  const solved: SolvedSketchEntityGeometryRecord[] = [];
  const pointDefinedArcEntityIds = new Set(
    (definition.derivedRelationships ?? []).flatMap((relationship) =>
      relationship.kind === "offset"
        ? relationship.seedEntityIds.filter(
            (entityId) =>
              definition.entities.find((entity) => entity.entityId === entityId)
                ?.kind === "arc",
          )
        : [],
    ),
  );
  for (const entity of definition.entities) {
    if (entity.kind === "derivedPiecewiseCubic") {
      // [TECH] G7: the solve frame is uncertified; only publish certifies.
      // A failed relationship has no spans (its diagnostic is in the solve).
      solved.push({
        entityId: entity.entityId,
        kind: "derivedPiecewiseCubic",
        publication: "provisional",
        spans: shellSpans.get(entity.entityId) ?? [],
      });
      continue;
    }

    if (entity.kind === "point") {
      const point = pointRecords.get(entity.pointId);
      if (point) {
        solved.push({
          entityId: entity.entityId,
          kind: "point",
          solvedPosition: getPoint(values, point),
        });
      }
      continue;
    }

    if (entity.kind === "lineSegment") {
      const start = pointRecords.get(entity.startPointId);
      const end = pointRecords.get(entity.endPointId);
      if (start && end) {
        solved.push({
          entityId: entity.entityId,
          kind: "lineSegment",
          startPosition: getPoint(values, start),
          endPosition: getPoint(values, end),
        });
      }
      continue;
    }

    if (entity.kind === "circle") {
      const center = pointRecords.get(entity.centerPointId);
      const circleState = entityStates.get(entity.entityId);
      if (center) {
        solved.push({
          entityId: entity.entityId,
          kind: "circle",
          centerPosition: getPoint(values, center),
          solvedRadius:
            circleState?.kind === "circle"
              ? getCircleRadius(values, circleState)
              : entity.radius,
        });
      }
      continue;
    }

    if (entity.kind === "spline") {
      const positions = Object.fromEntries(
        [...pointRecords.entries()].map(([pointId, point]) => [
          pointId,
          getPoint(values, point),
        ]),
      ) as Record<SketchPointId, SketchPoint2D>;
      const currentEntity = {
        ...entity,
        pointOccurrences: entity.pointOccurrences.map((occurrence) => {
          if (occurrence.tangent.kind !== "authored") return occurrence;
          const state = splineTangentStates.get(
            splineTangentStateKey(entity.entityId, occurrence.occurrenceId),
          );
          return state
            ? {
                ...occurrence,
                tangent: {
                  kind: "authored" as const,
                  vector: [
                    values[state.baseIndex]!,
                    values[state.baseIndex + 1]!,
                  ] as const,
                },
              }
            : occurrence;
        }),
      };
      solved.push({
        entityId: entity.entityId,
        kind: "spline",
        reconstruction: reconstructSplineAggregate(currentEntity, positions),
      });
      continue;
    }

    if (entity.kind === "ellipse") {
      const center = pointRecords.get(entity.centerPointId);
      const major = pointRecords.get(entity.majorAxisPointId);
      if (center && major) {
        solved.push({
          entityId: entity.entityId,
          kind: "ellipse",
          centerPosition: getPoint(values, center),
          majorAxisEndpointPosition: getPoint(values, major),
          minorRadius: entity.minorRadius,
        });
      }
      continue;
    }

    if (entity.kind === "ellipticalArc") {
      const center = pointRecords.get(entity.centerPointId);
      const major = pointRecords.get(entity.majorAxisPointId);
      const start = pointRecords.get(entity.startPointId);
      const end = pointRecords.get(entity.endPointId);
      if (center && major && start && end) {
        solved.push({
          entityId: entity.entityId,
          kind: "ellipticalArc",
          centerPosition: getPoint(values, center),
          majorAxisEndpointPosition: getPoint(values, major),
          startPosition: getPoint(values, start),
          endPosition: getPoint(values, end),
          minorRadius: entity.minorRadius,
          sweepDirection: entity.sweepDirection,
        });
      }
      continue;
    }

    if (entity.kind === "conic") {
      const start = pointRecords.get(entity.startPointId);
      const control = pointRecords.get(entity.controlPointId);
      const end = pointRecords.get(entity.endPointId);
      if (start && control && end) {
        solved.push({
          entityId: entity.entityId,
          kind: "conic",
          startPosition: getPoint(values, start),
          controlPosition: getPoint(values, control),
          endPosition: getPoint(values, end),
          rho: entity.rho,
        });
      }
      continue;
    }

    if (entity.kind === "bezierCurve") {
      const controlPoints = entity.controlPointIds.flatMap((pointId) => {
        const point = pointRecords.get(pointId);
        return point ? [getPoint(values, point)] : [];
      });
      if (controlPoints.length === entity.controlPointIds.length) {
        solved.push({
          entityId: entity.entityId,
          kind: "bezierCurve",
          controlPoints,
          degree: entity.degree,
        });
      }
      continue;
    }

    if (entity.kind === "profileText") {
      const anchor = pointRecords.get(entity.anchorPointId);
      if (anchor) {
        solved.push({
          entityId: entity.entityId,
          kind: "profileText",
          anchorPosition: getPoint(values, anchor),
          text: entity.text,
          height: entity.height,
          rotationRadians: entity.rotationRadians,
          horizontalAlign: entity.horizontalAlign,
          verticalAlign: entity.verticalAlign,
        });
      }
      continue;
    }

    const center = pointRecords.get(entity.centerPointId);
    const start = pointRecords.get(entity.startPointId);
    const end = pointRecords.get(entity.endPointId);
    const arcState = entityStates.get(entity.entityId);
    if (!center || !start || !end || !arcState || arcState.kind !== "arc") {
      continue;
    }
    const centerPos = getPoint(values, center);
    const pointDefined = pointDefinedArcEntityIds.has(entity.entityId);
    const { radius, startAngle, endAngle } = getArcParameters(values, arcState);
    const startPosition = pointDefined
      ? getPoint(values, start)
      : add(centerPos, [
          radius * Math.cos(startAngle),
          radius * Math.sin(startAngle),
        ]);
    const endPosition = pointDefined
      ? getPoint(values, end)
      : add(centerPos, [
          radius * Math.cos(endAngle),
          radius * Math.sin(endAngle),
        ]);
    solved.push({
      entityId: entity.entityId,
      kind: "arc",
      centerPosition: centerPos,
      startPosition,
      endPosition,
      sweepDirection: entity.sweepDirection,
    });
  }
  return solved;
}
