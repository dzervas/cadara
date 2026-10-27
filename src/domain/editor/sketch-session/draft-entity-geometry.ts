import type { SketchPoint } from "@/contracts/modeling/schema";
import type {
  SketchEntityDefinition,
  SketchPointDefinition,
} from "@/contracts/sketch/schema";
import type { SketchId, SketchPointId } from "@/contracts/shared/ids";
import type { SketchDraftEntity } from "@/core/sketch-tools/definition";
import { createSketchEntityRef } from "./session-definition";
import { sampleArcPoints } from "@/core/sketch-tools/geometry";
import {
  tessellateCubicSpans,
  reconstructSplineAggregate,
} from "@/contracts/sketch/spline-geometry";

const ADVANCED_DISPLAY_SAMPLE_COUNT = 64;

const PROFILE_TEXT_WIDTH_FACTOR = 0.6;

function sampleEllipseSketchPoints(
  center: SketchPoint,
  majorAxisEndpoint: SketchPoint,
  minorRadius: number,
  sampleCount: number,
): SketchPoint[] {
  const majorVector = [
    majorAxisEndpoint[0] - center[0],
    majorAxisEndpoint[1] - center[1],
  ] as const;
  const majorRadius = Math.hypot(majorVector[0], majorVector[1]);
  if (majorRadius <= Number.EPSILON || minorRadius <= 0) {
    return [];
  }

  const majorUnit = [
    majorVector[0] / majorRadius,
    majorVector[1] / majorRadius,
  ] as const;
  const minorUnit = [-majorUnit[1], majorUnit[0]] as const;

  return Array.from({ length: sampleCount }, (_, index) => {
    const angle = (Math.PI * 2 * index) / sampleCount;
    return [
      center[0] +
        Math.cos(angle) * majorRadius * majorUnit[0] +
        Math.sin(angle) * minorRadius * minorUnit[0],
      center[1] +
        Math.cos(angle) * majorRadius * majorUnit[1] +
        Math.sin(angle) * minorRadius * minorUnit[1],
    ] as const;
  });
}

function normalizeSketchAngle(angle: number) {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

function computeSketchArcSweep(
  startAngle: number,
  endAngle: number,
  sweepDirection: "clockwise" | "counterClockwise",
) {
  const start = normalizeSketchAngle(startAngle);
  const end = normalizeSketchAngle(endAngle);
  if (sweepDirection === "counterClockwise") {
    return end >= start ? end - start : end + Math.PI * 2 - start;
  }
  return end <= start ? start - end : start + Math.PI * 2 - end;
}

function sampleEllipticalArcSketchPoints(
  center: SketchPoint,
  majorAxisEndpoint: SketchPoint,
  start: SketchPoint,
  end: SketchPoint,
  minorRadius: number,
  sweepDirection: "clockwise" | "counterClockwise",
  sampleCount: number,
): SketchPoint[] {
  const majorVector = [
    majorAxisEndpoint[0] - center[0],
    majorAxisEndpoint[1] - center[1],
  ] as const;
  const majorRadius = Math.hypot(majorVector[0], majorVector[1]);
  if (majorRadius <= Number.EPSILON || minorRadius <= 0) {
    return [];
  }

  const majorUnit = [
    majorVector[0] / majorRadius,
    majorVector[1] / majorRadius,
  ] as const;
  const minorUnit = [-majorUnit[1], majorUnit[0]] as const;
  const ellipseAngle = (point: SketchPoint) => {
    const delta = [point[0] - center[0], point[1] - center[1]] as const;
    return Math.atan2(
      (delta[0] * minorUnit[0] + delta[1] * minorUnit[1]) / minorRadius,
      (delta[0] * majorUnit[0] + delta[1] * majorUnit[1]) / majorRadius,
    );
  };
  const startAngle = ellipseAngle(start);
  const sweep = computeSketchArcSweep(
    startAngle,
    ellipseAngle(end),
    sweepDirection,
  );

  return Array.from({ length: sampleCount }, (_, index) => {
    const alpha = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    const angle =
      sweepDirection === "counterClockwise"
        ? startAngle + sweep * alpha
        : startAngle - sweep * alpha;
    return [
      center[0] +
        Math.cos(angle) * majorRadius * majorUnit[0] +
        Math.sin(angle) * minorRadius * minorUnit[0],
      center[1] +
        Math.cos(angle) * majorRadius * majorUnit[1] +
        Math.sin(angle) * minorRadius * minorUnit[1],
    ] as const;
  });
}

function sampleConicSketchPoints(
  start: SketchPoint,
  control: SketchPoint,
  end: SketchPoint,
  rho: number,
  sampleCount: number,
): SketchPoint[] {
  return Array.from({ length: sampleCount }, (_, index) => {
    const t = sampleCount === 1 ? 0 : index / (sampleCount - 1);
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
    ] as const;
  });
}

function sampleBezierSketchPoints(
  controlPoints: readonly SketchPoint[],
  sampleCount: number,
): SketchPoint[] {
  return Array.from({ length: sampleCount }, (_, index) => {
    const t = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    const oneMinusT = 1 - t;
    if (controlPoints.length === 3) {
      const [p0, p1, p2] = controlPoints;
      return [
        oneMinusT * oneMinusT * p0![0] +
          2 * oneMinusT * t * p1![0] +
          t * t * p2![0],
        oneMinusT * oneMinusT * p0![1] +
          2 * oneMinusT * t * p1![1] +
          t * t * p2![1],
      ] as const;
    }

    const [p0, p1, p2, p3] = controlPoints;
    return [
      oneMinusT ** 3 * p0![0] +
        3 * oneMinusT * oneMinusT * t * p1![0] +
        3 * oneMinusT * t * t * p2![0] +
        t ** 3 * p3![0],
      oneMinusT ** 3 * p0![1] +
        3 * oneMinusT * oneMinusT * t * p1![1] +
        3 * oneMinusT * t * t * p2![1] +
        t ** 3 * p3![1],
    ] as const;
  });
}

function sampleProfileTextSketchOutline(
  entity: Extract<SketchEntityDefinition, { kind: "profileText" }>,
  anchor: SketchPoint,
): SketchPoint[] {
  const width = Math.max(
    entity.height * PROFILE_TEXT_WIDTH_FACTOR,
    entity.text.trim().length * entity.height * PROFILE_TEXT_WIDTH_FACTOR,
  );
  const x =
    entity.horizontalAlign === "center"
      ? -width / 2
      : entity.horizontalAlign === "right"
        ? -width
        : 0;
  const y =
    entity.verticalAlign === "middle"
      ? -entity.height / 2
      : entity.verticalAlign === "top"
        ? -entity.height
        : entity.verticalAlign === "baseline"
          ? -entity.height * 0.2
          : 0;
  const cos = Math.cos(entity.rotationRadians);
  const sin = Math.sin(entity.rotationRadians);

  return [
    [x, y],
    [x + width, y],
    [x + width, y + entity.height],
    [x, y + entity.height],
  ].map(
    (point) =>
      [
        anchor[0] + point[0]! * cos - point[1]! * sin,
        anchor[1] + point[0]! * sin + point[1]! * cos,
      ] as const,
  );
}

export function mapDefinitionEntityToDraftEntity(
  sketchId: SketchId,
  points: SketchPointDefinition[],
  entity: SketchEntityDefinition,
): SketchDraftEntity[] {
  const pointById = new Map(
    points.map((point) => [point.pointId, point.position] as const),
  );

  if (entity.kind === "lineSegment") {
    const start = pointById.get(entity.startPointId);
    const end = pointById.get(entity.endPointId);

    if (!start || !end) {
      return [];
    }

    return [
      {
        id: entity.entityId,
        kind: "line",
        start,
        end,
        entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
        status: "accepted",
        label: entity.label,
        isConstruction: entity.isConstruction,
      },
    ];
  }

  if (entity.kind === "point") {
    const point = pointById.get(entity.pointId);

    if (!point) {
      return [];
    }

    return [
      {
        id: entity.entityId,
        kind: "circle",
        center: point,
        radius: 0.1,
        entityId: entity.entityId,
        status: "accepted",
        label: entity.label,
        isConstruction: entity.isConstruction,
      },
    ];
  }

  if (entity.kind === "circle") {
    const center = pointById.get(entity.centerPointId);

    if (!center) {
      return [];
    }

    return [
      {
        id: entity.entityId,
        kind: "circle",
        center,
        radius: entity.radius,
        entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
        status: "accepted",
        label: entity.label,
        isConstruction: entity.isConstruction,
      },
    ];
  }

  if (entity.kind === "arc") {
    const center = pointById.get(entity.centerPointId);
    const start = pointById.get(entity.startPointId);
    const end = pointById.get(entity.endPointId);

    if (!center || !start || !end) {
      return [];
    }

    return [
      {
        id: entity.entityId,
        kind: "polyline",
        points: sampleArcPoints(center, start, end, entity.sweepDirection),
        isClosed: false,
        entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
        status: "accepted",
        label: entity.label,
        isConstruction: entity.isConstruction,
      },
    ];
  }

  if (entity.kind === "spline") {
    const positions = Object.fromEntries(pointById) as Record<
      SketchPointId,
      SketchPoint
    >;
    const splinePoints = tessellateCubicSpans(
      reconstructSplineAggregate(entity, positions).spans,
    );

    if (splinePoints.length < 2) {
      return [];
    }

    return [
      {
        id: entity.entityId,
        kind: "spline",
        points: splinePoints,
        entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
        status: "accepted",
        label: entity.label,
        isConstruction: entity.isConstruction,
      },
    ];
  }

  if (entity.kind === "ellipse") {
    const center = pointById.get(entity.centerPointId);
    const major = pointById.get(entity.majorAxisPointId);
    const sampled =
      center && major
        ? sampleEllipseSketchPoints(
            center,
            major,
            entity.minorRadius,
            ADVANCED_DISPLAY_SAMPLE_COUNT,
          )
        : [];
    return sampled.length > 0
      ? [
          {
            id: entity.entityId,
            kind: "polyline",
            points: sampled,
            isClosed: true,
            entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
            status: "accepted",
            label: entity.label,
            isConstruction: entity.isConstruction,
          },
        ]
      : [];
  }

  if (entity.kind === "ellipticalArc") {
    const center = pointById.get(entity.centerPointId);
    const major = pointById.get(entity.majorAxisPointId);
    const start = pointById.get(entity.startPointId);
    const end = pointById.get(entity.endPointId);
    const sampled =
      center && major && start && end
        ? sampleEllipticalArcSketchPoints(
            center,
            major,
            start,
            end,
            entity.minorRadius,
            entity.sweepDirection,
            ADVANCED_DISPLAY_SAMPLE_COUNT,
          )
        : [];
    return sampled.length > 0
      ? [
          {
            id: entity.entityId,
            kind: "polyline",
            points: sampled,
            isClosed: false,
            entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
            status: "accepted",
            label: entity.label,
            isConstruction: entity.isConstruction,
          },
        ]
      : [];
  }

  if (entity.kind === "conic") {
    const start = pointById.get(entity.startPointId);
    const control = pointById.get(entity.controlPointId);
    const end = pointById.get(entity.endPointId);
    const sampled =
      start && control && end
        ? sampleConicSketchPoints(
            start,
            control,
            end,
            entity.rho,
            ADVANCED_DISPLAY_SAMPLE_COUNT,
          )
        : [];
    return sampled.length > 0
      ? [
          {
            id: entity.entityId,
            kind: "polyline",
            points: sampled,
            isClosed: false,
            entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
            status: "accepted",
            label: entity.label,
            isConstruction: entity.isConstruction,
          },
        ]
      : [];
  }

  if (entity.kind === "bezierCurve") {
    const controlPoints = entity.controlPointIds.flatMap((pointId) => {
      const point = pointById.get(pointId);
      return point ? [point] : [];
    });
    const sampled =
      controlPoints.length === entity.controlPointIds.length
        ? sampleBezierSketchPoints(controlPoints, ADVANCED_DISPLAY_SAMPLE_COUNT)
        : [];
    return sampled.length > 0
      ? [
          {
            id: entity.entityId,
            kind: "polyline",
            points: sampled,
            isClosed: false,
            entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
            status: "accepted",
            label: entity.label,
            isConstruction: entity.isConstruction,
          },
        ]
      : [];
  }

  if (entity.kind === "profileText") {
    const anchor = pointById.get(entity.anchorPointId);
    return anchor
      ? [
          {
            id: entity.entityId,
            kind: "polyline",
            points: sampleProfileTextSketchOutline(entity, anchor),
            isClosed: true,
            entityId: createSketchEntityRef(sketchId, entity.entityId).entityId,
            status: "accepted",
            label: entity.label,
            isConstruction: entity.isConstruction,
          },
        ]
      : [];
  }

  return [];
}
