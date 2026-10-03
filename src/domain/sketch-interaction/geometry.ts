import {
  projectedSplineIsClosed,
  type ProjectedSketchReferenceGeometry,
  type ProjectedSketchReferenceRecord,
} from "@/contracts/solver/schema";
import type {
  SketchDefinition,
  SketchEntityDefinition,
  SketchPoint2D,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import type { SketchId, SketchPointId } from "@/contracts/shared/ids";
import {
  closestPointOnSolvedCubicSpans,
  cubicSpansPoleBounds,
  orderedSplinePointIds,
  reconstructSplineAggregate,
  solvedCubicSpans,
  type SolvedCubicSpan,
  type SplinePoles,
} from "@/contracts/sketch/spline-geometry";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  getSketchSessionDisplayDefinition,
  getSketchSessionDisplayProjectedReferences,
  isAcceptedSketchSolve,
} from "@/domain/editor/sketch-session/internals";
import { getSketchDatumGuideExtent } from "@/domain/editor/sketch-session/definition-patches";
import { getSketchSessionDisplaySolvedSnapshot } from "@/domain/editor/sketch-session/display";
import type { SketchSessionState } from "@/domain/editor/sketch-session";

const TURN = Math.PI * 2;
const EPSILON = 1e-9;
const ADVANCED_SAMPLE_COUNT = 64;

export type SketchInteractionGeometrySource = "local" | "projected" | "datum";

export type SketchInteractionGeometry =
  | {
      kind: "point";
      source: SketchInteractionGeometrySource;
      id: string;
      label: string;
      target: PrimitiveRef;
      position: SketchPoint2D;
    }
  | {
      kind: "lineSegment";
      source: SketchInteractionGeometrySource;
      id: string;
      label: string;
      target: PrimitiveRef;
      start: SketchPoint2D;
      end: SketchPoint2D;
    }
  | {
      kind: "circle";
      source: SketchInteractionGeometrySource;
      id: string;
      label: string;
      target: PrimitiveRef;
      center: SketchPoint2D;
      radius: number;
    }
  | {
      kind: "arc";
      source: SketchInteractionGeometrySource;
      id: string;
      label: string;
      target: PrimitiveRef;
      center: SketchPoint2D;
      start: SketchPoint2D;
      end: SketchPoint2D;
      sweepDirection: "clockwise" | "counterClockwise";
    }
  | {
      /**
       * Exact cubic spans (T10f): a solved spline or derived shell (its
       * `solvedCubicSpans`, drawn domains kept), a projected neutral spline,
       * or an authored `bezierCurve` (quadratics degree-elevated exactly).
       */
      kind: "cubicSpans";
      source: SketchInteractionGeometrySource;
      id: string;
      label: string;
      target: PrimitiveRef;
      spans: readonly SolvedCubicSpan[];
    }
  | {
      /**
       * A polyline that is the curve as the sketch holds it: projected
       * source samples, and the sampled ellipse/conic/text curves.
       */
      kind: "sampledCurve";
      source: SketchInteractionGeometrySource;
      id: string;
      label: string;
      target: PrimitiveRef;
      points: readonly SketchPoint2D[];
      isClosed: boolean;
    };

export type SketchInteractionCurveGeometry = Exclude<
  SketchInteractionGeometry,
  { kind: "point" }
>;

export function collectSketchInteractionGeometry(
  session: SketchSessionState,
): SketchInteractionGeometry[] {
  const sketchId = session.sketchId ?? ("sketch_draft" as SketchId);
  const definition = getSketchSessionDisplayDefinition(session);
  const projectedReferences = getSketchSessionDisplayProjectedReferences(
    session,
    definition,
  );

  return [
    ...collectDatumInteractionGeometry(
      sketchId,
      definition,
      projectedReferences,
    ),
    ...collectLocalInteractionGeometry(
      definition,
      getSketchSessionDisplaySolvedSnapshot(
        session,
        definition,
        projectedReferences,
      ),
    ),
    ...collectProjectedInteractionGeometry(projectedReferences),
  ];
}

/**
 * The exact closest point of a sketch interaction curve to `point`, in the
 * sketch plane (T10f): closed form for lines, circles and arcs (an outside
 * angle clamps to the nearer authored end point), the owner's
 * `closestPointOnSolvedCubicSpans` for cubic spans, and the polyline itself
 * for a sampled curve. Null when the curve has no point (degenerate input).
 */
export function closestPointOnSketchInteractionCurve(
  geometry: SketchInteractionCurveGeometry,
  point: SketchPoint2D,
): SketchPoint2D | null {
  switch (geometry.kind) {
    case "lineSegment":
      return closestPointOnSegment(point, geometry.start, geometry.end);
    case "circle":
      return geometry.radius > EPSILON
        ? closestPointOnCircle(point, geometry.center, geometry.radius)
        : null;
    case "arc":
      return closestPointOnArc(point, geometry);
    case "cubicSpans":
      return (
        closestPointOnSolvedCubicSpans(point, geometry.spans)?.point ?? null
      );
    case "sampledCurve": {
      const points = closeSampledPoints(geometry.points, geometry.isClosed);
      let best: SketchPoint2D | null = points.length === 1 ? points[0]! : null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let index = 1; index < points.length; index += 1) {
        const candidate = closestPointOnSegment(
          point,
          points[index - 1]!,
          points[index]!,
        );
        const distance = distanceBetween(point, candidate);
        if (distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
        }
      }
      return best;
    }
  }
}

/**
 * A circle or arc as exact rational quadratic pieces of sweep ≤ π/2
 * (T10f review A-1): P0 and P2 on the circle, P1 = c + r/cos h · (cos m,
 * sin m), weight cos h, with h the half sweep and m the mid angle. An arc's
 * first and last poles are its authored end points. Empty for a degenerate
 * circle or arc (radius ≤ ε, zero sweep).
 */
export function getSketchInteractionCircularPieces(
  geometry: Extract<SketchInteractionCurveGeometry, { kind: "circle" | "arc" }>,
): {
  readonly poles: readonly [SketchPoint2D, SketchPoint2D, SketchPoint2D];
  readonly weight: number;
}[] {
  const { center } = geometry;
  const radius =
    geometry.kind === "circle"
      ? geometry.radius
      : distanceBetween(center, geometry.start);
  if (!(radius > EPSILON)) return [];
  const startAngle =
    geometry.kind === "circle"
      ? 0
      : Math.atan2(
          geometry.start[1] - center[1],
          geometry.start[0] - center[0],
        );
  const sweep =
    geometry.kind === "circle"
      ? TURN
      : getSweepRadians(
          startAngle,
          Math.atan2(geometry.end[1] - center[1], geometry.end[0] - center[0]),
          geometry.sweepDirection,
        ) * (geometry.sweepDirection === "counterClockwise" ? 1 : -1);
  if (sweep === 0) return [];
  const count = Math.ceil(Math.abs(sweep) / (Math.PI / 2));
  const at = (angle: number, distance = radius): SketchPoint2D => [
    center[0] + distance * Math.cos(angle),
    center[1] + distance * Math.sin(angle),
  ];
  const half = sweep / count / 2;
  return Array.from({ length: count }, (_, index) => {
    const from = startAngle + (sweep * index) / count;
    const to = startAngle + (sweep * (index + 1)) / count;
    return {
      poles: [
        index === 0 && geometry.kind === "arc" ? geometry.start : at(from),
        at(from + half, radius / Math.cos(half)),
        index === count - 1 && geometry.kind === "arc" ? geometry.end : at(to),
      ],
      weight: Math.cos(half),
    };
  });
}

/**
 * An exact, conservative sketch-plane box of the curve (T10f pick
 * prefilter): cubic spans by their pole box, circles and arcs by their full
 * circle, lines and polylines by their points.
 */
export function getSketchInteractionCurveBounds(
  geometry: SketchInteractionCurveGeometry,
): { readonly min: SketchPoint2D; readonly max: SketchPoint2D } | null {
  switch (geometry.kind) {
    case "lineSegment":
      return pointBounds([geometry.start, geometry.end]);
    case "circle":
      return circleBounds(geometry.center, geometry.radius);
    case "arc":
      return circleBounds(
        geometry.center,
        distanceBetween(geometry.center, geometry.start),
      );
    case "cubicSpans":
      return cubicSpansPoleBounds(geometry.spans);
    case "sampledCurve":
      return pointBounds(geometry.points);
  }
}

export function isSketchInteractionCurveGeometry(
  geometry: SketchInteractionGeometry,
): geometry is SketchInteractionCurveGeometry {
  return geometry.kind !== "point";
}

function collectDatumInteractionGeometry(
  sketchId: SketchId,
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
): SketchInteractionGeometry[] {
  const extent = getSketchDatumGuideExtent(definition, projectedReferences);

  return [
    {
      kind: "point",
      source: "datum",
      id: `sketch-datum:${sketchId}:origin`,
      label: "Sketch origin",
      target: {
        kind: "sketchDatumReference",
        sketchId,
        datumId: "origin",
        geometryKind: "point",
      },
      position: [0, 0],
    },
    {
      kind: "lineSegment",
      source: "datum",
      id: `sketch-datum:${sketchId}:xAxis`,
      label: "Sketch X axis",
      target: {
        kind: "sketchDatumReference",
        sketchId,
        datumId: "xAxis",
        geometryKind: "lineSegment",
      },
      start: [-extent, 0],
      end: [extent, 0],
    },
    {
      kind: "lineSegment",
      source: "datum",
      id: `sketch-datum:${sketchId}:yAxis`,
      label: "Sketch Y axis",
      target: {
        kind: "sketchDatumReference",
        sketchId,
        datumId: "yAxis",
        geometryKind: "lineSegment",
      },
      start: [0, -extent],
      end: [0, extent],
    },
  ];
}

function collectLocalInteractionGeometry(
  definition: SketchDefinition,
  solvedSnapshot: SolvedSketchSnapshot,
): SketchInteractionGeometry[] {
  const solvedEntities = new Map(
    solvedSnapshot.solvedEntities.map((record) => [record.entityId, record]),
  );
  const pointMap = new Map(
    definition.points.map((point) => [point.pointId, point] as const),
  );
  const entries: SketchInteractionGeometry[] = definition.points.map(
    (point) => ({
      kind: "point",
      source: "local",
      id: `sketch-point:${point.pointId}`,
      label: point.label,
      target: point.target,
      position: point.position,
    }),
  );

  let accepted: boolean | undefined;
  const isAccepted = () => (accepted ??= isAcceptedSketchSolve(solvedSnapshot));
  for (const entity of definition.entities) {
    const geometry =
      entity.kind === "spline" && !isAccepted()
        ? createAuthoredSplineInteractionGeometry(entity, pointMap)
        : entity.kind === "spline" || entity.kind === "derivedPiecewiseCubic"
          ? createSolvedSpansInteractionGeometry(
              entity,
              solvedEntities.get(entity.entityId),
            )
          : createLocalEntityInteractionGeometry(entity, pointMap);
    if (geometry) {
      entries.push(geometry);
    }
  }

  return entries;
}

function createLocalEntityInteractionGeometry(
  entity: SketchEntityDefinition,
  pointMap: ReadonlyMap<SketchPointId, { position: SketchPoint2D }>,
): SketchInteractionGeometry | null {
  const point = (pointId: SketchPointId) =>
    pointMap.get(pointId)?.position ?? null;

  switch (entity.kind) {
    case "point": {
      const position = point(entity.pointId);
      return position ? createLocalPointEntityGeometry(entity, position) : null;
    }
    case "lineSegment": {
      const start = point(entity.startPointId);
      const end = point(entity.endPointId);
      return start && end
        ? {
            kind: "lineSegment",
            source: "local",
            id: `sketch-entity:${entity.entityId}`,
            label: entity.label,
            target: entity.target,
            start,
            end,
          }
        : null;
    }
    case "circle": {
      const center = point(entity.centerPointId);
      return center && entity.radius > EPSILON
        ? {
            kind: "circle",
            source: "local",
            id: `sketch-entity:${entity.entityId}`,
            label: entity.label,
            target: entity.target,
            center,
            radius: entity.radius,
          }
        : null;
    }
    case "arc": {
      const center = point(entity.centerPointId);
      const start = point(entity.startPointId);
      const end = point(entity.endPointId);
      return center && start && end
        ? {
            kind: "arc",
            source: "local",
            id: `sketch-entity:${entity.entityId}`,
            label: entity.label,
            target: entity.target,
            center,
            start,
            end,
            sweepDirection: entity.sweepDirection,
          }
        : null;
    }
    case "ellipse": {
      const center = point(entity.centerPointId);
      const majorAxis = point(entity.majorAxisPointId);
      if (!center || !majorAxis) {
        return null;
      }
      return createSampledLocalCurve(
        entity,
        sampleEllipsePoints(center, majorAxis, entity.minorRadius),
        true,
      );
    }
    case "ellipticalArc": {
      const center = point(entity.centerPointId);
      const majorAxis = point(entity.majorAxisPointId);
      const start = point(entity.startPointId);
      const end = point(entity.endPointId);
      if (!center || !majorAxis || !start || !end) {
        return null;
      }
      return createSampledLocalCurve(
        entity,
        sampleEllipticalArcPoints(
          center,
          majorAxis,
          entity.minorRadius,
          start,
          end,
          entity.sweepDirection,
        ),
        false,
      );
    }
    case "conic": {
      const start = point(entity.startPointId);
      const control = point(entity.controlPointId);
      const end = point(entity.endPointId);
      return start && control && end
        ? createSampledLocalCurve(
            entity,
            sampleConicPoints(start, control, end, entity.rho),
            false,
          )
        : null;
    }
    case "bezierCurve": {
      const points = collectDefiningPoints(entity.controlPointIds, point);
      if (!points) return null;
      const poles = bezierCubicPoles(points, entity.degree);
      return poles
        ? {
            kind: "cubicSpans",
            source: "local",
            id: `sketch-entity:${entity.entityId}`,
            label: entity.label,
            target: entity.target,
            spans: [{ interval: [0, 1], poles }],
          }
        : createSampledLocalCurve(entity, points, false);
    }
    case "profileText": {
      const anchor = point(entity.anchorPointId);
      return anchor
        ? createSampledLocalCurve(
            entity,
            sampleProfileTextOutline(entity, anchor),
            true,
          )
        : null;
    }
    // Picked along their solved spans (`createSolvedSpansInteractionGeometry`).
    case "spline":
    case "derivedPiecewiseCubic":
      return null;
  }
}

/**
 * With a not-accepted solve a spline picks along the authored
 * reconstruction the session display draws (T10f review R-2): the solver's
 * best-effort positions may differ from the drawn curve.
 */
function createAuthoredSplineInteractionGeometry(
  entity: Extract<SketchEntityDefinition, { kind: "spline" }>,
  pointMap: ReadonlyMap<SketchPointId, { position: SketchPoint2D }>,
): SketchInteractionGeometry | null {
  const pointIds = orderedSplinePointIds(entity);
  if (pointIds.some((pointId) => !pointMap.has(pointId))) return null;
  const positions = Object.fromEntries(
    pointIds.map((pointId) => [pointId, pointMap.get(pointId)!.position]),
  ) as Record<SketchPointId, SketchPoint2D>;
  const spans = reconstructSplineAggregate(entity, positions).spans;
  return spans.length > 0
    ? {
        kind: "cubicSpans",
        source: "local",
        id: `sketch-entity:${entity.entityId}`,
        label: entity.label,
        target: entity.target,
        spans: spans.map((span) => ({
          interval: span.interval,
          poles: span.poles,
        })),
      }
    : null;
}

/**
 * A spline (accepted solve) or derived offset shell picks along its solved
 * spans in the session's display solved snapshot (T10f; a shell's drawn
 * `queryDomain`s kept, T08b-g5b): the spans display tessellates, snap and
 * measure read.
 */
function createSolvedSpansInteractionGeometry(
  entity: Extract<
    SketchEntityDefinition,
    { kind: "spline" | "derivedPiecewiseCubic" }
  >,
  record: SolvedSketchSnapshot["solvedEntities"][number] | undefined,
): SketchInteractionGeometry | null {
  if (record?.kind !== entity.kind) return null;
  const spans = solvedCubicSpans(record);
  return spans.length > 0
    ? {
        kind: "cubicSpans",
        source: "local",
        id: `sketch-entity:${entity.entityId}`,
        label: entity.label,
        target: entity.target,
        spans,
      }
    : null;
}

function createLocalPointEntityGeometry(
  entity: Extract<SketchEntityDefinition, { kind: "point" }>,
  position: SketchPoint2D,
): SketchInteractionGeometry {
  return {
    kind: "point",
    source: "local",
    id: `sketch-entity:${entity.entityId}`,
    label: entity.label,
    target: entity.target,
    position,
  };
}

function createSampledLocalCurve(
  entity: SketchEntityDefinition,
  points: readonly SketchPoint2D[],
  isClosed: boolean,
): SketchInteractionGeometry | null {
  if (points.length < 2) {
    return null;
  }

  return {
    kind: "sampledCurve",
    source: "local",
    id: `sketch-entity:${entity.entityId}`,
    label: entity.label,
    target: entity.target,
    points,
    isClosed,
  };
}

function collectProjectedInteractionGeometry(
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
): SketchInteractionGeometry[] {
  return projectedReferences.flatMap((reference) =>
    reference.geometry.flatMap((geometry) => {
      const entry = createProjectedGeometry(reference.referenceId, geometry);
      return entry ? [entry] : [];
    }),
  );
}

function createProjectedGeometry(
  referenceId: ProjectedSketchReferenceRecord["referenceId"],
  geometry: ProjectedSketchReferenceGeometry,
): SketchInteractionGeometry | null {
  const target = {
    kind: "projectedReferenceGeometry",
    referenceId,
    geometryId: geometry.geometryId,
    geometryKind: geometry.kind,
  } satisfies PrimitiveRef;
  const base = {
    source: "projected" as const,
    id: `projected:${referenceId}:${geometry.geometryId}`,
    label: `Projected ${geometry.geometryId}`,
    target,
  };

  switch (geometry.kind) {
    case "point":
      return { ...base, kind: "point", position: geometry.position };
    case "lineSegment":
      return {
        ...base,
        kind: "lineSegment",
        start: geometry.startPosition,
        end: geometry.endPosition,
      };
    case "circle":
      return geometry.radius > EPSILON
        ? {
            ...base,
            kind: "circle",
            center: geometry.centerPosition,
            radius: geometry.radius,
          }
        : null;
    case "arc":
      return {
        ...base,
        kind: "arc",
        center: geometry.centerPosition,
        start: geometry.startPosition,
        end: geometry.endPosition,
        sweepDirection: geometry.sweepDirection,
      };
    case "spline": {
      const { representation } = geometry;
      if (representation.kind === "neutralCubicSpans")
        return representation.spans.length > 0
          ? { ...base, kind: "cubicSpans", spans: representation.spans }
          : null;
      if (representation.points.length < 2) return null;
      return {
        ...base,
        kind: "sampledCurve",
        points: representation.points,
        isClosed: projectedSplineIsClosed(geometry),
      };
    }
  }
}

function sampleEllipsePoints(
  center: SketchPoint2D,
  majorAxisEndpoint: SketchPoint2D,
  minorRadius: number,
) {
  const frame = getEllipseFrame(center, majorAxisEndpoint, minorRadius);
  if (!frame) {
    return [];
  }

  return Array.from({ length: ADVANCED_SAMPLE_COUNT }, (_, index) => {
    const angle = (TURN * index) / ADVANCED_SAMPLE_COUNT;
    return evaluateEllipsePoint(frame, angle);
  });
}

function sampleEllipticalArcPoints(
  center: SketchPoint2D,
  majorAxisEndpoint: SketchPoint2D,
  minorRadius: number,
  start: SketchPoint2D,
  end: SketchPoint2D,
  sweepDirection: "clockwise" | "counterClockwise",
) {
  const frame = getEllipseFrame(center, majorAxisEndpoint, minorRadius);
  if (!frame) {
    return [];
  }

  const startAngle = getEllipseParameterAngle(frame, start);
  const sweep = getSweepRadians(
    startAngle,
    getEllipseParameterAngle(frame, end),
    sweepDirection,
  );

  return Array.from({ length: ADVANCED_SAMPLE_COUNT }, (_, index) => {
    const t = index / (ADVANCED_SAMPLE_COUNT - 1);
    const angle =
      sweepDirection === "counterClockwise"
        ? startAngle + sweep * t
        : startAngle - sweep * t;
    return evaluateEllipsePoint(frame, angle);
  });
}

function sampleConicPoints(
  start: SketchPoint2D,
  control: SketchPoint2D,
  end: SketchPoint2D,
  rho: number,
) {
  if (rho <= EPSILON) {
    return [];
  }

  return Array.from({ length: ADVANCED_SAMPLE_COUNT }, (_, index) => {
    const t = index / (ADVANCED_SAMPLE_COUNT - 1);
    const oneMinusT = 1 - t;
    const startWeight = oneMinusT * oneMinusT;
    const controlWeight = 2 * rho * oneMinusT * t;
    const endWeight = t * t;
    const weight = startWeight + controlWeight + endWeight;
    return [
      (startWeight * start[0] +
        controlWeight * control[0] +
        endWeight * end[0]) /
        weight,
      (startWeight * start[1] +
        controlWeight * control[1] +
        endWeight * end[1]) /
        weight,
    ] satisfies SketchPoint2D;
  });
}

function sampleProfileTextOutline(
  entity: Extract<SketchEntityDefinition, { kind: "profileText" }>,
  anchor: SketchPoint2D,
) {
  const text = entity.text.trim();
  const height = entity.height;
  if (text.length === 0 || height <= EPSILON) {
    return [];
  }

  const width = Math.max(height * 0.6, text.length * height * 0.6);
  const x =
    entity.horizontalAlign === "center"
      ? -width / 2
      : entity.horizontalAlign === "right"
        ? -width
        : 0;
  const y =
    entity.verticalAlign === "middle"
      ? -height / 2
      : entity.verticalAlign === "top"
        ? -height
        : entity.verticalAlign === "baseline"
          ? -height * 0.2
          : 0;
  const cos = Math.cos(entity.rotationRadians);
  const sin = Math.sin(entity.rotationRadians);

  return closeSampledPoints(
    [
      [x, y],
      [x + width, y],
      [x + width, y + height],
      [x, y + height],
    ].map(
      (point) =>
        [
          anchor[0] + point[0]! * cos - point[1]! * sin,
          anchor[1] + point[0]! * sin + point[1]! * cos,
        ] satisfies SketchPoint2D,
    ),
    true,
  );
}

function getEllipseFrame(
  center: SketchPoint2D,
  majorAxisEndpoint: SketchPoint2D,
  minorRadius: number,
) {
  const major = subtractPoints(majorAxisEndpoint, center);
  const majorRadius = Math.hypot(major[0], major[1]);
  if (majorRadius <= EPSILON || minorRadius <= EPSILON) {
    return null;
  }

  const majorUnit = [
    major[0] / majorRadius,
    major[1] / majorRadius,
  ] satisfies SketchPoint2D;
  const minorUnit = [-majorUnit[1], majorUnit[0]] satisfies SketchPoint2D;
  return {
    center,
    majorUnit,
    minorUnit,
    majorRadius,
    minorRadius,
  };
}

function getEllipseParameterAngle(
  frame: NonNullable<ReturnType<typeof getEllipseFrame>>,
  point: SketchPoint2D,
) {
  const delta = subtractPoints(point, frame.center);
  return Math.atan2(
    dotPoints(delta, frame.minorUnit) / frame.minorRadius,
    dotPoints(delta, frame.majorUnit) / frame.majorRadius,
  );
}

function evaluateEllipsePoint(
  frame: NonNullable<ReturnType<typeof getEllipseFrame>>,
  angle: number,
): SketchPoint2D {
  return addPoints(
    frame.center,
    addPoints(
      scalePoint(frame.majorUnit, Math.cos(angle) * frame.majorRadius),
      scalePoint(frame.minorUnit, Math.sin(angle) * frame.minorRadius),
    ),
  );
}

function getSweepRadians(
  startAngle: number,
  endAngle: number,
  direction: "clockwise" | "counterClockwise",
) {
  const start = normalizeAngle(startAngle);
  const end = normalizeAngle(endAngle);
  if (direction === "counterClockwise") {
    return end >= start ? end - start : end + TURN - start;
  }

  return end <= start ? start - end : start + TURN - end;
}

function normalizeAngle(angle: number) {
  return ((angle % TURN) + TURN) % TURN;
}

function closeSampledPoints(
  points: readonly SketchPoint2D[],
  isClosed: boolean,
): readonly SketchPoint2D[] {
  if (!isClosed || points.length < 2) {
    return points;
  }

  const first = points[0]!;
  const last = points[points.length - 1]!;
  return areSamePoint(first, last) ? points : [...points, first];
}

function collectDefiningPoints(
  pointIds: readonly SketchPointId[],
  resolvePoint: (pointId: SketchPointId) => SketchPoint2D | null,
) {
  const points = pointIds.map(resolvePoint);
  return points.every((point): point is SketchPoint2D => point !== null)
    ? points
    : null;
}

function areSamePoint(left: SketchPoint2D, right: SketchPoint2D) {
  return Math.hypot(left[0] - right[0], left[1] - right[1]) <= EPSILON;
}

function subtractPoints(
  left: SketchPoint2D,
  right: SketchPoint2D,
): SketchPoint2D {
  return [left[0] - right[0], left[1] - right[1]];
}

function addPoints(left: SketchPoint2D, right: SketchPoint2D): SketchPoint2D {
  return [left[0] + right[0], left[1] + right[1]];
}

function scalePoint(point: SketchPoint2D, scale: number): SketchPoint2D {
  return [point[0] * scale, point[1] * scale];
}

function dotPoints(left: SketchPoint2D, right: SketchPoint2D) {
  return left[0] * right[0] + left[1] * right[1];
}

/**
 * The cubic poles of an authored Bézier: a cubic as given, a quadratic
 * degree-elevated exactly (P0, P0 + ⅔(P1 − P0), P2 + ⅔(P1 − P2), P2;
 * T10 plan §2.3, B2). Null with too few control points.
 */
function bezierCubicPoles(
  points: readonly SketchPoint2D[],
  degree: 2 | 3,
): SplinePoles | null {
  if (points.length < degree + 1) return null;
  const [p0, p1, p2, p3] = points;
  if (degree === 3) return [p0!, p1!, p2!, p3!];
  const toward = (from: SketchPoint2D, to: SketchPoint2D): SketchPoint2D => [
    from[0] + (2 / 3) * (to[0] - from[0]),
    from[1] + (2 / 3) * (to[1] - from[1]),
  ];
  return [p0!, toward(p0!, p1!), toward(p2!, p1!), p2!];
}

function closestPointOnSegment(
  point: SketchPoint2D,
  start: SketchPoint2D,
  end: SketchPoint2D,
): SketchPoint2D {
  const delta = subtractPoints(end, start);
  const lengthSquared = dotPoints(delta, delta);
  if (lengthSquared === 0) return start;
  const t = dotPoints(subtractPoints(point, start), delta) / lengthSquared;
  if (t <= 0) return start;
  if (t >= 1) return end;
  return addPoints(start, scalePoint(delta, t));
}

function closestPointOnCircle(
  point: SketchPoint2D,
  center: SketchPoint2D,
  radius: number,
): SketchPoint2D {
  const delta = subtractPoints(point, center);
  const length = Math.hypot(delta[0], delta[1]);
  // Every point of the circle is closest to its center; take angle 0.
  return length === 0
    ? [center[0] + radius, center[1]]
    : addPoints(center, scalePoint(delta, radius / length));
}

function closestPointOnArc(
  point: SketchPoint2D,
  arc: Extract<SketchInteractionGeometry, { kind: "arc" }>,
): SketchPoint2D | null {
  const radius = distanceBetween(arc.center, arc.start);
  if (radius <= EPSILON) return null;
  const startAngle = Math.atan2(
    arc.start[1] - arc.center[1],
    arc.start[0] - arc.center[0],
  );
  const sweep = getSweepRadians(
    startAngle,
    Math.atan2(arc.end[1] - arc.center[1], arc.end[0] - arc.center[0]),
    arc.sweepDirection,
  );
  const pointAngle = Math.atan2(
    point[1] - arc.center[1],
    point[0] - arc.center[0],
  );
  const inside =
    distanceBetween(point, arc.center) > 0 &&
    getSweepRadians(startAngle, pointAngle, arc.sweepDirection) <= sweep;
  if (inside) return closestPointOnCircle(point, arc.center, radius);
  return distanceBetween(point, arc.start) <= distanceBetween(point, arc.end)
    ? arc.start
    : arc.end;
}

function pointBounds(points: readonly SketchPoint2D[]) {
  if (points.length === 0) return null;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return {
    min: [Math.min(...xs), Math.min(...ys)] satisfies SketchPoint2D,
    max: [Math.max(...xs), Math.max(...ys)] satisfies SketchPoint2D,
  };
}

function circleBounds(center: SketchPoint2D, radius: number) {
  return {
    min: [center[0] - radius, center[1] - radius] satisfies SketchPoint2D,
    max: [center[0] + radius, center[1] + radius] satisfies SketchPoint2D,
  };
}

function distanceBetween(left: SketchPoint2D, right: SketchPoint2D) {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}
