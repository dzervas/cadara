import type {
  ProjectedSketchReferenceGeometry,
  ProjectedSketchReferenceRecord,
} from "@/contracts/solver/schema";
import type {
  RegionLoopRecord,
  RegionBoundarySegmentRecord,
  RegionRecord,
  SketchDefinition,
  SketchPoint2D,
  SketchSolveDiagnostic,
  SolvedSketchEntityGeometryRecord,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import type { OwnershipRecord } from "@/contracts/shared/diagnostics";
import type {
  DocumentId,
  RegionId,
  RegionLoopId,
  RevisionId,
  ReferenceId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import {
  getClosedCurveSampleCount,
  MIN_REGION_AREA,
  REGION_POINT_TOLERANCE,
} from "@/contracts/sketch/region-geometry";

export interface SketchRegionExtractionInput {
  documentId: DocumentId;
  revisionId: RevisionId;
  sketchId: SketchId;
  solvedSnapshot: SolvedSketchSnapshot;
  definition: SketchDefinition;
  projectedReferences?: readonly ProjectedSketchReferenceRecord[];
}

export interface SketchRegionExtractionResult {
  regions: RegionRecord[];
  diagnostics: SketchSolveDiagnostic[];
}

export interface SketchRingCandidate {
  kind: "segments";
  boundarySegments: RingBoundarySegment[];
  boundaryEntityIds: SketchEntityId[];
  boundaryPointIds: SketchPointId[];
  points: SketchPoint2D[];
  signedArea: number;
}

type SegmentRecord = {
  source: RegionBoundarySegmentRecord["source"];
  sourceKey: string;
  startPointId: SketchPointId | null;
  endPointId: SketchPointId | null;
  start: SketchPoint2D;
  end: SketchPoint2D;
  startAngle: number;
  endAngle: number;
  traversalDirection: "forward" | "reverse";
  curve:
    | { kind: "lineSegment" }
    | {
        kind: "arc";
        center: SketchPoint2D;
        radius: number;
        startAngle: number;
        endAngle: number;
        sweepDirection: "clockwise" | "counterClockwise";
      };
};

type RingBoundarySegment = {
  source: RegionBoundarySegmentRecord["source"];
  startPointId: SketchPointId | null;
  endPointId: SketchPointId | null;
  traversalDirection: "forward" | "reverse";
};

type SegmentGraphNode = {
  id: number;
  point: SketchPoint2D;
};

type DirectedSegmentRecord = SegmentRecord & {
  directedId: number;
  reverseDirectedId: number;
  startNodeId: number;
  endNodeId: number;
};

const PROFILE_TEXT_WIDTH_FACTOR = 0.6;

function projectedKindForGeometry(
  geometry: ProjectedSketchReferenceGeometry,
): NonNullable<
  RegionBoundarySegmentRecord["source"] extends infer Source
    ? Source extends { kind: "projectedGeometry"; reference: infer Reference }
      ? Reference extends { kind?: infer Kind }
        ? Kind
        : never
      : never
    : never
> {
  switch (geometry.kind) {
    case "point":
      return "projectedPoint";
    case "lineSegment":
      return "projectedLineSegment";
    case "circle":
      return "projectedCircle";
    case "arc":
      return "projectedArc";
    case "spline":
      return "projectedSpline";
  }
}

function getProjectedGeometrySource(
  reference: ProjectedSketchReferenceRecord,
  geometry: ProjectedSketchReferenceGeometry,
): Extract<
  RegionBoundarySegmentRecord["source"],
  { kind: "projectedGeometry" }
> {
  return {
    kind: "projectedGeometry",
    reference: {
      kind: projectedKindForGeometry(geometry),
      referenceId: reference.referenceId,
      geometryId: geometry.geometryId,
    },
  };
}

function getSegmentSourceKey(source: RegionBoundarySegmentRecord["source"]) {
  if (source.kind === "entity") {
    return `entity:${source.entityId}`;
  }

  return `projected:${source.reference.referenceId}:${source.reference.geometryId}`;
}

function makeDiagnostic(
  code: string,
  severity: SketchSolveDiagnostic["severity"],
  message: string,
  target: SketchSolveDiagnostic["target"],
): SketchSolveDiagnostic {
  return { code, severity, message, target };
}

function getAuthoredReferenceIds(
  definition: SketchDefinition,
): Set<ReferenceId> {
  const recordedReferenceIds = new Set(
    definition.references.map((reference) => reference.referenceId),
  );

  return new Set(
    definition.referenceIds.filter((referenceId) =>
      recordedReferenceIds.has(referenceId),
    ),
  );
}

function isAuthoredReference(
  definition: SketchDefinition,
  referenceId: ReferenceId,
) {
  return getAuthoredReferenceIds(definition).has(referenceId);
}

function filterAuthoredProjectedReferences(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
) {
  const authoredReferenceIds = getAuthoredReferenceIds(definition);
  return projectedReferences.filter((reference) =>
    authoredReferenceIds.has(reference.referenceId),
  );
}

function distanceBetweenPoints(left: SketchPoint2D, right: SketchPoint2D) {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function equalsPoint(left: SketchPoint2D, right: SketchPoint2D) {
  return distanceBetweenPoints(left, right) <= REGION_POINT_TOLERANCE;
}

function normalizeAngle(angle: number) {
  const tau = Math.PI * 2;
  const normalized = angle % tau;
  return normalized < 0 ? normalized + tau : normalized;
}

function reverseSweepDirection(direction: "clockwise" | "counterClockwise") {
  return direction === "clockwise" ? "counterClockwise" : "clockwise";
}

function getArcSweep(
  startAngle: number,
  endAngle: number,
  direction: "clockwise" | "counterClockwise",
) {
  return direction === "counterClockwise"
    ? normalizeAngle(endAngle - startAngle)
    : normalizeAngle(startAngle - endAngle);
}

function signedArea(points: SketchPoint2D[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]!;
    const end = points[(index + 1) % points.length]!;
    area += start[0] * end[1] - end[0] * start[1];
  }
  return area / 2;
}

function rotatePoint(point: SketchPoint2D, angle: number): SketchPoint2D {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [point[0] * cos - point[1] * sin, point[0] * sin + point[1] * cos];
}

function addPoint(left: SketchPoint2D, right: SketchPoint2D): SketchPoint2D {
  return [left[0] + right[0], left[1] + right[1]];
}

function subtractPoint(
  left: SketchPoint2D,
  right: SketchPoint2D,
): SketchPoint2D {
  return [left[0] - right[0], left[1] - right[1]];
}

function sampleEllipsePoints(
  center: SketchPoint2D,
  majorAxisEndpoint: SketchPoint2D,
  minorRadius: number,
  count: number,
): SketchPoint2D[] {
  const major = subtractPoint(majorAxisEndpoint, center);
  const majorRadius = Math.hypot(major[0], major[1]);
  if (majorRadius <= Number.EPSILON || minorRadius <= 0) {
    return [];
  }

  const majorUnit: SketchPoint2D = [
    major[0] / majorRadius,
    major[1] / majorRadius,
  ];
  const minorUnit: SketchPoint2D = [-majorUnit[1], majorUnit[0]];

  return Array.from({ length: count }, (_, index) => {
    const angle = (Math.PI * 2 * index) / count;
    return [
      center[0] +
        Math.cos(angle) * majorRadius * majorUnit[0] +
        Math.sin(angle) * minorRadius * minorUnit[0],
      center[1] +
        Math.cos(angle) * majorRadius * majorUnit[1] +
        Math.sin(angle) * minorRadius * minorUnit[1],
    ];
  });
}

function getProfileTextOutlinePoints(
  entity: Extract<SolvedSketchEntityGeometryRecord, { kind: "profileText" }>,
): SketchPoint2D[] {
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
  const local: SketchPoint2D[] = [
    [x, y],
    [x + width, y],
    [x + width, y + entity.height],
    [x, y + entity.height],
  ];

  return local.map((point) =>
    addPoint(entity.anchorPosition, rotatePoint(point, entity.rotationRadians)),
  );
}

function pointInPolygon(point: SketchPoint2D, polygon: SketchPoint2D[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i]![0];
    const yi = polygon[i]![1];
    const xj = polygon[j]![0];
    const yj = polygon[j]![1];
    const intersects =
      yi > point[1] !== yj > point[1] &&
      point[0] <
        ((xj - xi) * (point[1] - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function ringContainsRing(
  parent: SketchRingCandidate,
  child: SketchRingCandidate,
) {
  return child.points.every((point) => pointInPolygon(point, parent.points));
}

function centroid(points: SketchPoint2D[]): SketchPoint2D {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point[0];
    y += point[1];
  }
  return [x / points.length, y / points.length];
}

function reverseSegment(segment: SegmentRecord): SegmentRecord {
  return {
    source: segment.source,
    sourceKey: segment.sourceKey,
    startPointId: segment.endPointId,
    endPointId: segment.startPointId,
    start: segment.end,
    end: segment.start,
    startAngle: (segment.endAngle + Math.PI) % (Math.PI * 2),
    endAngle: (segment.startAngle + Math.PI) % (Math.PI * 2),
    traversalDirection:
      segment.traversalDirection === "forward" ? "reverse" : "forward",
    curve:
      segment.curve.kind === "arc"
        ? {
            ...segment.curve,
            startAngle: segment.curve.endAngle,
            endAngle: segment.curve.startAngle,
            sweepDirection: reverseSweepDirection(segment.curve.sweepDirection),
          }
        : segment.curve,
  };
}

function sampleSegmentPoints(segment: SegmentRecord): SketchPoint2D[] {
  if (segment.curve.kind === "lineSegment") {
    return [segment.start, segment.end];
  }

  const arc = segment.curve;
  const sweep = getArcSweep(arc.startAngle, arc.endAngle, arc.sweepDirection);
  const sampleCount = Math.max(
    3,
    Math.ceil(getClosedCurveSampleCount(arc.radius) * (sweep / (Math.PI * 2))),
  );

  return Array.from({ length: sampleCount }, (_, index) => {
    const t = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    const angle =
      arc.sweepDirection === "counterClockwise"
        ? arc.startAngle + sweep * t
        : arc.startAngle - sweep * t;

    return [
      arc.center[0] + Math.cos(angle) * arc.radius,
      arc.center[1] + Math.sin(angle) * arc.radius,
    ];
  });
}

function buildRingPoints(segments: readonly SegmentRecord[]) {
  const points = segments.flatMap((segment, index) => {
    const sampled = sampleSegmentPoints(segment);
    return index === 0 ? sampled : sampled.slice(1);
  });

  if (
    points.length > 1 &&
    equalsPoint(points[0]!, points[points.length - 1]!)
  ) {
    points.pop();
  }

  return points;
}

function cross(a: SketchPoint2D, b: SketchPoint2D, c: SketchPoint2D) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function isDegenerateSegment(segment: SegmentRecord) {
  return (
    distanceBetweenPoints(segment.start, segment.end) <= REGION_POINT_TOLERANCE
  );
}

function pointOnSegment(
  point: SketchPoint2D,
  start: SketchPoint2D,
  end: SketchPoint2D,
) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared <= REGION_POINT_TOLERANCE * REGION_POINT_TOLERANCE) {
    return distanceBetweenPoints(point, start) <= REGION_POINT_TOLERANCE;
  }

  const t =
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared;
  const clamped = Math.max(0, Math.min(1, t));
  const closest: SketchPoint2D = [
    start[0] + clamped * dx,
    start[1] + clamped * dy,
  ];
  return distanceBetweenPoints(point, closest) <= REGION_POINT_TOLERANCE;
}

function orientationSign(value: number, segmentLength: number) {
  const tolerance = REGION_POINT_TOLERANCE * Math.max(segmentLength, 1);
  if (value > tolerance) {
    return 1;
  }
  if (value < -tolerance) {
    return -1;
  }
  return 0;
}

function segmentsIntersect(
  leftStart: SketchPoint2D,
  leftEnd: SketchPoint2D,
  rightStart: SketchPoint2D,
  rightEnd: SketchPoint2D,
) {
  const leftToRightStart = cross(leftStart, leftEnd, rightStart);
  const leftToRightEnd = cross(leftStart, leftEnd, rightEnd);
  const rightToLeftStart = cross(rightStart, rightEnd, leftStart);
  const rightToLeftEnd = cross(rightStart, rightEnd, leftEnd);
  const leftLength = distanceBetweenPoints(leftStart, leftEnd);
  const rightLength = distanceBetweenPoints(rightStart, rightEnd);
  const leftStartSign = orientationSign(leftToRightStart, leftLength);
  const leftEndSign = orientationSign(leftToRightEnd, leftLength);
  const rightStartSign = orientationSign(rightToLeftStart, rightLength);
  const rightEndSign = orientationSign(rightToLeftEnd, rightLength);

  if (
    leftStartSign !== 0 &&
    leftEndSign !== 0 &&
    leftStartSign !== leftEndSign &&
    rightStartSign !== 0 &&
    rightEndSign !== 0 &&
    rightStartSign !== rightEndSign
  ) {
    return true;
  }

  return (
    pointOnSegment(rightStart, leftStart, leftEnd) ||
    pointOnSegment(rightEnd, leftStart, leftEnd) ||
    pointOnSegment(leftStart, rightStart, rightEnd) ||
    pointOnSegment(leftEnd, rightStart, rightEnd)
  );
}

function areAdjacentRingEdges(
  leftIndex: number,
  rightIndex: number,
  edgeCount: number,
) {
  return (
    Math.abs(leftIndex - rightIndex) === 1 ||
    Math.abs(leftIndex - rightIndex) === edgeCount - 1
  );
}

function ringSelfIntersects(points: SketchPoint2D[]) {
  for (let leftIndex = 0; leftIndex < points.length; leftIndex += 1) {
    const leftStart = points[leftIndex]!;
    const leftEnd = points[(leftIndex + 1) % points.length]!;

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < points.length;
      rightIndex += 1
    ) {
      if (areAdjacentRingEdges(leftIndex, rightIndex, points.length)) {
        continue;
      }

      const rightStart = points[rightIndex]!;
      const rightEnd = points[(rightIndex + 1) % points.length]!;
      if (segmentsIntersect(leftStart, leftEnd, rightStart, rightEnd)) {
        return true;
      }
    }
  }

  return false;
}

function isValidRing(
  points: SketchPoint2D[],
  area: number,
  options: { checkSelfIntersection?: boolean } = {},
) {
  return (
    points.length >= 3 &&
    Math.abs(area) > MIN_REGION_AREA &&
    (options.checkSelfIntersection === false || !ringSelfIntersects(points))
  );
}

function buildSegments(
  definition: SketchDefinition,
  solvedSnapshot: SolvedSketchSnapshot,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
) {
  const solvedLineMap = new Map(
    solvedSnapshot.solvedEntities
      .filter(
        (
          entity,
        ): entity is Extract<
          SolvedSketchEntityGeometryRecord,
          { kind: "lineSegment" }
        > => entity.kind === "lineSegment",
      )
      .map((entity) => [entity.entityId, entity]),
  );
  const solvedArcMap = new Map(
    solvedSnapshot.solvedEntities
      .filter(
        (
          entity,
        ): entity is Extract<
          SolvedSketchEntityGeometryRecord,
          { kind: "arc" }
        > => entity.kind === "arc",
      )
      .map((entity) => [entity.entityId, entity]),
  );

  const authoredSegments = definition.entities.flatMap(
    (entity): SegmentRecord[] => {
      if (entity.isConstruction) {
        return [];
      }

      if (entity.kind === "lineSegment") {
        const solved = solvedLineMap.get(entity.entityId);
        if (!solved) {
          return [];
        }
        return [
          {
            source: { kind: "entity", entityId: entity.entityId },
            sourceKey: getSegmentSourceKey({
              kind: "entity",
              entityId: entity.entityId,
            }),
            startPointId: entity.startPointId,
            endPointId: entity.endPointId,
            start: solved.startPosition,
            end: solved.endPosition,
            startAngle: Math.atan2(
              solved.endPosition[1] - solved.startPosition[1],
              solved.endPosition[0] - solved.startPosition[0],
            ),
            endAngle: Math.atan2(
              solved.endPosition[1] - solved.startPosition[1],
              solved.endPosition[0] - solved.startPosition[0],
            ),
            traversalDirection: "forward" as const,
            curve: { kind: "lineSegment" as const },
          } satisfies SegmentRecord,
        ];
      }

      if (entity.kind === "arc") {
        const solved = solvedArcMap.get(entity.entityId);
        if (!solved) {
          return [];
        }

        return [
          {
            source: { kind: "entity", entityId: entity.entityId },
            sourceKey: getSegmentSourceKey({
              kind: "entity",
              entityId: entity.entityId,
            }),
            startPointId: entity.startPointId,
            endPointId: entity.endPointId,
            start: solved.startPosition,
            end: solved.endPosition,
            startAngle: Math.atan2(
              solved.startPosition[1] - solved.centerPosition[1],
              solved.startPosition[0] - solved.centerPosition[0],
            ),
            endAngle: Math.atan2(
              solved.endPosition[1] - solved.centerPosition[1],
              solved.endPosition[0] - solved.centerPosition[0],
            ),
            traversalDirection: "forward" as const,
            curve: {
              kind: "arc" as const,
              center: solved.centerPosition,
              radius: distanceBetweenPoints(
                solved.startPosition,
                solved.centerPosition,
              ),
              startAngle: Math.atan2(
                solved.startPosition[1] - solved.centerPosition[1],
                solved.startPosition[0] - solved.centerPosition[0],
              ),
              endAngle: Math.atan2(
                solved.endPosition[1] - solved.centerPosition[1],
                solved.endPosition[0] - solved.centerPosition[0],
              ),
              sweepDirection: solved.sweepDirection,
            },
          } satisfies SegmentRecord,
        ];
      }

      return [];
    },
  );

  return authoredSegments.concat(buildProjectedSegments(projectedReferences));
}

function buildProjectedSegments(
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
): SegmentRecord[] {
  return projectedReferences.flatMap((reference) => {
    if (reference.status !== "projected") {
      return [];
    }

    return reference.geometry.flatMap((geometry): SegmentRecord[] => {
      const source = getProjectedGeometrySource(reference, geometry);
      const sourceKey = getSegmentSourceKey(source);

      if (geometry.kind === "lineSegment") {
        return [
          {
            source,
            sourceKey,
            startPointId: null,
            endPointId: null,
            start: geometry.startPosition,
            end: geometry.endPosition,
            startAngle: Math.atan2(
              geometry.endPosition[1] - geometry.startPosition[1],
              geometry.endPosition[0] - geometry.startPosition[0],
            ),
            endAngle: Math.atan2(
              geometry.endPosition[1] - geometry.startPosition[1],
              geometry.endPosition[0] - geometry.startPosition[0],
            ),
            traversalDirection: "forward",
            curve: { kind: "lineSegment" },
          },
        ];
      }

      if (geometry.kind === "arc") {
        return [
          {
            source,
            sourceKey,
            startPointId: null,
            endPointId: null,
            start: geometry.startPosition,
            end: geometry.endPosition,
            startAngle: Math.atan2(
              geometry.startPosition[1] - geometry.centerPosition[1],
              geometry.startPosition[0] - geometry.centerPosition[0],
            ),
            endAngle: Math.atan2(
              geometry.endPosition[1] - geometry.centerPosition[1],
              geometry.endPosition[0] - geometry.centerPosition[0],
            ),
            traversalDirection: "forward",
            curve: {
              kind: "arc",
              center: geometry.centerPosition,
              radius: distanceBetweenPoints(
                geometry.startPosition,
                geometry.centerPosition,
              ),
              startAngle: Math.atan2(
                geometry.startPosition[1] - geometry.centerPosition[1],
                geometry.startPosition[0] - geometry.centerPosition[0],
              ),
              endAngle: Math.atan2(
                geometry.endPosition[1] - geometry.centerPosition[1],
                geometry.endPosition[0] - geometry.centerPosition[0],
              ),
              sweepDirection: geometry.sweepDirection,
            },
          },
        ];
      }

      return [];
    });
  });
}

function buildCircleRings(
  definition: SketchDefinition,
  solvedSnapshot: SolvedSketchSnapshot,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
) {
  const solvedCircleMap = new Map(
    solvedSnapshot.solvedEntities
      .filter(
        (
          entity,
        ): entity is Extract<
          SolvedSketchEntityGeometryRecord,
          { kind: "circle" }
        > => entity.kind === "circle",
      )
      .map((entity) => [entity.entityId, entity]),
  );
  const localCircleRings = definition.entities.flatMap((entity) => {
    if (entity.kind !== "circle" || entity.isConstruction) {
      return [];
    }

    const solved = solvedCircleMap.get(entity.entityId);
    if (!solved) {
      return [];
    }

    const sampleCount = getClosedCurveSampleCount(solved.solvedRadius);
    const points = Array.from({ length: sampleCount }, (_, index) => {
      const angle = (Math.PI * 2 * index) / sampleCount;
      return [
        solved.centerPosition[0] + Math.cos(angle) * solved.solvedRadius,
        solved.centerPosition[1] + Math.sin(angle) * solved.solvedRadius,
      ] satisfies SketchPoint2D;
    });

    return [
      {
        kind: "segments" as const,
        boundarySegments: [
          {
            source: { kind: "entity", entityId: entity.entityId },
            startPointId: null,
            endPointId: null,
            traversalDirection: "forward",
          },
        ],
        boundaryEntityIds: [entity.entityId],
        boundaryPointIds: [],
        points,
        signedArea: signedArea(points),
      } satisfies SketchRingCandidate,
    ];
  });

  const projectedCircleRings = projectedReferences.flatMap((reference) => {
    if (reference.status !== "projected") {
      return [];
    }

    return reference.geometry.flatMap((geometry) => {
      if (geometry.kind !== "circle") {
        return [];
      }

      const sampleCount = getClosedCurveSampleCount(geometry.radius);
      const points = Array.from({ length: sampleCount }, (_, index) => {
        const angle = (Math.PI * 2 * index) / sampleCount;
        return [
          geometry.centerPosition[0] + Math.cos(angle) * geometry.radius,
          geometry.centerPosition[1] + Math.sin(angle) * geometry.radius,
        ] satisfies SketchPoint2D;
      });

      return [
        {
          kind: "segments" as const,
          boundarySegments: [
            {
              source: getProjectedGeometrySource(reference, geometry),
              startPointId: null,
              endPointId: null,
              traversalDirection: "forward",
            },
          ],
          boundaryEntityIds: [],
          boundaryPointIds: [],
          points,
          signedArea: signedArea(points),
        } satisfies SketchRingCandidate,
      ];
    });
  });

  return [...localCircleRings, ...projectedCircleRings].filter((ring) =>
    isValidRing(ring.points, ring.signedArea, { checkSelfIntersection: false }),
  );
}

function buildAdvancedClosedRings(
  definition: SketchDefinition,
  solvedSnapshot: SolvedSketchSnapshot,
) {
  const authoredById = new Map(
    definition.entities.map((entity) => [entity.entityId, entity]),
  );

  return solvedSnapshot.solvedEntities.flatMap((entity) => {
    const authored = authoredById.get(entity.entityId);
    if (!authored || authored.isConstruction) {
      return [];
    }

    let points: SketchPoint2D[];
    if (entity.kind === "ellipse") {
      points = sampleEllipsePoints(
        entity.centerPosition,
        entity.majorAxisEndpointPosition,
        entity.minorRadius,
        getClosedCurveSampleCount(
          Math.max(
            Math.hypot(
              entity.majorAxisEndpointPosition[0] - entity.centerPosition[0],
              entity.majorAxisEndpointPosition[1] - entity.centerPosition[1],
            ),
            entity.minorRadius,
          ),
        ),
      );
    } else if (entity.kind === "profileText") {
      points = getProfileTextOutlinePoints(entity);
    } else {
      return [];
    }

    if (points.length < 3) {
      return [];
    }

    const ring = {
      kind: "segments" as const,
      boundarySegments: [
        {
          source: { kind: "entity" as const, entityId: entity.entityId },
          startPointId: null,
          endPointId: null,
          traversalDirection: "forward" as const,
        },
      ],
      boundaryEntityIds: [entity.entityId],
      boundaryPointIds: [],
      points,
      signedArea: signedArea(points),
    } satisfies SketchRingCandidate;

    return isValidRing(ring.points, ring.signedArea, {
      checkSelfIntersection: false,
    })
      ? [ring]
      : [];
  });
}

export function findSketchRings(
  definition: SketchDefinition,
  solvedSnapshot: SolvedSketchSnapshot,
  projectedReferences: readonly ProjectedSketchReferenceRecord[] = [],
): {
  rings: SketchRingCandidate[];
  unusedSegments: SegmentRecord[];
  degenerateSegments: SegmentRecord[];
  rejectedRings: SketchRingCandidate[];
} {
  const authoredProjectedReferences = filterAuthoredProjectedReferences(
    definition,
    projectedReferences,
  );
  const builtSegments = buildSegments(
    definition,
    solvedSnapshot,
    authoredProjectedReferences,
  );
  const degenerateSegments = builtSegments.filter(isDegenerateSegment);
  const initialSegments = builtSegments.filter(
    (segment) => !isDegenerateSegment(segment),
  );
  const rings: SketchRingCandidate[] = [
    ...buildCircleRings(
      definition,
      solvedSnapshot,
      authoredProjectedReferences,
    ),
    ...buildAdvancedClosedRings(definition, solvedSnapshot),
  ];
  const segmentFaceExtraction = extractSegmentGraphRings(initialSegments);
  rings.push(...segmentFaceExtraction.rings);

  rings.sort(compareRingsByAreaThenKey);
  const unusedSegments = initialSegments.filter(
    (segment) => !segmentFaceExtraction.usedSourceKeys.has(segment.sourceKey),
  );
  return {
    rings,
    unusedSegments,
    degenerateSegments,
    rejectedRings: segmentFaceExtraction.rejectedRings,
  };
}

function extractSegmentGraphRings(segments: readonly SegmentRecord[]) {
  const graph = buildSegmentGraph(segments);
  const visited = new Set<number>();
  const usedSourceKeys = new Set<string>();
  const rings: SketchRingCandidate[] = [];
  const rejectedRings: SketchRingCandidate[] = [];

  for (const edge of graph.directedSegments) {
    if (visited.has(edge.directedId)) {
      continue;
    }

    const faceEdges = walkSegmentGraphFace(
      edge,
      graph.outgoingByNodeId,
      visited,
      graph.directedSegments.length,
    );
    if (!faceEdges) {
      continue;
    }

    const ring = createRingFromGraphFace(faceEdges);
    const selfIntersects =
      ring.points.length >= 3 && ringSelfIntersects(ring.points);
    if (
      ring.signedArea > 0 &&
      isValidRing(ring.points, ring.signedArea, {
        checkSelfIntersection: false,
      }) &&
      !selfIntersects
    ) {
      rings.push(ring);
      for (const segment of ring.boundarySegments) {
        usedSourceKeys.add(getSegmentSourceKey(segment.source));
      }
    } else if (
      ring.signedArea > MIN_REGION_AREA ||
      (Math.abs(ring.signedArea) <= MIN_REGION_AREA && selfIntersects)
    ) {
      rejectedRings.push(ring);
    }
  }

  return { rings, rejectedRings, usedSourceKeys };
}

function buildSegmentGraph(segments: readonly SegmentRecord[]) {
  const nodes: SegmentGraphNode[] = [];
  const bucketedNodes = new Map<string, SegmentGraphNode[]>();
  const directedSegments: DirectedSegmentRecord[] = [];

  for (const segment of segments) {
    const startNode = getOrCreateGraphNode(segment.start, nodes, bucketedNodes);
    const endNode = getOrCreateGraphNode(segment.end, nodes, bucketedNodes);
    const forwardId = directedSegments.length;
    const reverseId = forwardId + 1;
    const forward = {
      ...segment,
      directedId: forwardId,
      reverseDirectedId: reverseId,
      startNodeId: startNode.id,
      endNodeId: endNode.id,
    } satisfies DirectedSegmentRecord;
    const reversedSegment = reverseSegment(segment);
    const reverse = {
      ...reversedSegment,
      directedId: reverseId,
      reverseDirectedId: forwardId,
      startNodeId: endNode.id,
      endNodeId: startNode.id,
    } satisfies DirectedSegmentRecord;
    directedSegments.push(forward, reverse);
  }

  const outgoingByNodeId = new Map<number, DirectedSegmentRecord[]>();
  for (const segment of directedSegments) {
    const outgoing = outgoingByNodeId.get(segment.startNodeId) ?? [];
    outgoing.push(segment);
    outgoingByNodeId.set(segment.startNodeId, outgoing);
  }

  for (const outgoing of outgoingByNodeId.values()) {
    outgoing.sort(
      (left, right) =>
        normalizeAngle(left.startAngle) - normalizeAngle(right.startAngle) ||
        left.sourceKey.localeCompare(right.sourceKey),
    );
  }

  return { directedSegments, outgoingByNodeId };
}

function getOrCreateGraphNode(
  point: SketchPoint2D,
  nodes: SegmentGraphNode[],
  bucketedNodes: Map<string, SegmentGraphNode[]>,
) {
  for (const key of getNeighborPointBucketKeys(point)) {
    for (const node of bucketedNodes.get(key) ?? []) {
      if (equalsPoint(node.point, point)) {
        return node;
      }
    }
  }

  const node = { id: nodes.length, point } satisfies SegmentGraphNode;
  nodes.push(node);
  const bucketKey = getPointBucketKey(point);
  const bucket = bucketedNodes.get(bucketKey) ?? [];
  bucket.push(node);
  bucketedNodes.set(bucketKey, bucket);
  return node;
}

function getPointBucketKey(point: SketchPoint2D) {
  return `${Math.round(point[0] / REGION_POINT_TOLERANCE)},${Math.round(point[1] / REGION_POINT_TOLERANCE)}`;
}

function getNeighborPointBucketKeys(point: SketchPoint2D) {
  const x = Math.round(point[0] / REGION_POINT_TOLERANCE);
  const y = Math.round(point[1] / REGION_POINT_TOLERANCE);
  const keys: string[] = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      keys.push(`${x + dx},${y + dy}`);
    }
  }
  return keys;
}

function walkSegmentGraphFace(
  startEdge: DirectedSegmentRecord,
  outgoingByNodeId: ReadonlyMap<number, readonly DirectedSegmentRecord[]>,
  visited: Set<number>,
  maxSteps: number,
) {
  const faceEdges: DirectedSegmentRecord[] = [];
  let edge = startEdge;

  for (let count = 0; count <= maxSteps; count += 1) {
    if (visited.has(edge.directedId)) {
      return edge.directedId === startEdge.directedId ? faceEdges : null;
    }

    visited.add(edge.directedId);
    faceEdges.push(edge);

    const outgoing = outgoingByNodeId.get(edge.endNodeId);
    if (!outgoing || outgoing.length === 0) {
      return null;
    }

    const reverseIndex = outgoing.findIndex(
      (candidate) => candidate.directedId === edge.reverseDirectedId,
    );
    if (reverseIndex < 0) {
      return null;
    }

    edge = outgoing[(reverseIndex - 1 + outgoing.length) % outgoing.length]!;
  }

  return null;
}

function createRingFromGraphFace(
  faceEdges: readonly DirectedSegmentRecord[],
): SketchRingCandidate {
  const points = buildRingPoints(faceEdges);
  return {
    kind: "segments",
    boundarySegments: faceEdges.map((entry) => ({
      source: entry.source,
      startPointId: entry.startPointId,
      endPointId: entry.endPointId,
      traversalDirection: entry.traversalDirection,
    })),
    boundaryEntityIds: faceEdges.flatMap((entry) =>
      entry.source.kind === "entity" ? [entry.source.entityId] : [],
    ),
    boundaryPointIds: faceEdges.flatMap((entry) =>
      entry.startPointId ? [entry.startPointId] : [],
    ),
    points,
    signedArea: signedArea(points),
  };
}

function compareRingsByAreaThenKey(
  left: SketchRingCandidate,
  right: SketchRingCandidate,
) {
  const areaDelta = Math.abs(right.signedArea) - Math.abs(left.signedArea);

  if (areaDelta !== 0) {
    return areaDelta;
  }

  return getRingStableKey(left).localeCompare(getRingStableKey(right));
}

function getRingStableKey(ring: SketchRingCandidate) {
  return ring.boundarySegments
    .map((segment) => getSegmentSourceKey(segment.source))
    .join("|");
}

function getRegionStableKey(ring: SketchRingCandidate) {
  return ring.boundarySegments
    .map((segment) => getSegmentSourceKey(segment.source))
    .sort()
    .join("|");
}

function sanitizeRegionIdPart(value: string) {
  return (
    value
      .replaceAll(/[^a-zA-Z0-9_-]/g, "-")
      .replaceAll(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64) || "profile"
  );
}

function hashStableString(value: string) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(36);
}

function createRegionId(
  sketchId: SketchId,
  ring: SketchRingCandidate,
): RegionId {
  const suffix = sketchId.startsWith("sketch_")
    ? sketchId.slice("sketch_".length)
    : sketchId;
  const sourceLabel = ring.boundarySegments[0]
    ? (getSegmentSourceKey(ring.boundarySegments[0].source).split(":").at(-1) ??
      "profile")
    : "profile";
  return `region_${sanitizeRegionIdPart(suffix)}-${sanitizeRegionIdPart(sourceLabel)}-${hashStableString(getRegionStableKey(ring))}` as RegionId;
}

function createRegionLoopId(regionId: RegionId, ordinal: number): RegionLoopId {
  return `region_loop_${regionId}_${ordinal}` as RegionLoopId;
}

function createOwnershipRecord(
  input: Pick<
    SketchRegionExtractionInput,
    "documentId" | "revisionId" | "sketchId"
  >,
): OwnershipRecord {
  return {
    ownerDocumentId: input.documentId,
    ownerRevisionId: input.revisionId,
    ownerFeatureId: null,
    ownerSketchId: input.sketchId,
    ownerBodyId: null,
  };
}

export function deriveSketchRegionsCore(
  input: SketchRegionExtractionInput,
): SketchRegionExtractionResult {
  if (
    input.solvedSnapshot.status.solveState === "failed" ||
    input.solvedSnapshot.status.solveState === "notEvaluated"
  ) {
    return {
      regions: [],
      diagnostics: [
        makeDiagnostic(
          "regions-unavailable",
          "warning",
          "Closed regions are unavailable until the sketch reaches a usable solved state.",
          null,
        ),
      ],
    };
  }

  const projectedReferences = input.projectedReferences ?? [];
  const authoredProjectedReferences = filterAuthoredProjectedReferences(
    input.definition,
    projectedReferences,
  );
  const { rings, unusedSegments, degenerateSegments, rejectedRings } =
    findSketchRings(
      input.definition,
      input.solvedSnapshot,
      authoredProjectedReferences,
    );
  const sorted = [...rings].sort(compareRingsByAreaThenKey);
  const childrenByParent = new Map<number, number[]>();
  const parentByRing = new Map<number, number | null>();

  for (let childIndex = 0; childIndex < sorted.length; childIndex += 1) {
    const child = sorted[childIndex]!;
    const marker = centroid(child.points);
    let parent: number | null = null;
    let parentArea = Number.POSITIVE_INFINITY;

    for (let parentIndex = 0; parentIndex < sorted.length; parentIndex += 1) {
      if (parentIndex === childIndex) {
        continue;
      }
      const candidate = sorted[parentIndex]!;
      const candidateArea = Math.abs(candidate.signedArea);
      if (
        candidateArea <= Math.abs(child.signedArea) ||
        candidateArea >= parentArea
      ) {
        continue;
      }
      if (
        pointInPolygon(marker, candidate.points) &&
        ringContainsRing(candidate, child)
      ) {
        parent = parentIndex;
        parentArea = candidateArea;
      }
    }

    parentByRing.set(childIndex, parent);
    if (parent !== null) {
      const children = childrenByParent.get(parent) ?? [];
      children.push(childIndex);
      childrenByParent.set(parent, children);
    }
  }

  const depthByRing = new Map<number, number>();
  const getRingDepth = (index: number): number => {
    const cached = depthByRing.get(index);
    if (cached !== undefined) {
      return cached;
    }

    const parent = parentByRing.get(index);
    const depth =
      parent === null || parent === undefined ? 0 : getRingDepth(parent) + 1;
    depthByRing.set(index, depth);
    return depth;
  };

  const solidRings = sorted
    .map((ring, index) => ({ ring, index, depth: getRingDepth(index) }))
    .filter((entry) => entry.depth % 2 === 0);

  const regions = solidRings.map(({ ring, index }, regionIndex) => {
    const regionId = createRegionId(input.sketchId, ring);
    const outerLoop = createLoopRecord(regionId, 0, "outer", ring, false);

    const innerLoops = (childrenByParent.get(index) ?? [])
      .filter((childIndex) => getRingDepth(childIndex) % 2 === 1)
      .map((childIndex, loopOrdinal) => {
        const child = sorted[childIndex]!;
        return createLoopRecord(
          regionId,
          loopOrdinal + 1,
          "inner",
          child,
          true,
        );
      });

    return {
      ...createOwnershipRecord(input),
      regionId,
      label:
        regionIndex === 0 ? "Outer region" : `Loop region ${regionIndex + 1}`,
      target: { kind: "region", sketchId: input.sketchId, regionId },
      sourceSketch: { kind: "sketch", sketchId: input.sketchId },
      loops: [outerLoop, ...innerLoops],
      isClosed: true,
    } satisfies RegionRecord;
  });

  return {
    regions,
    diagnostics: [
      ...createProjectedReferenceRegionDiagnostics(
        input.definition,
        projectedReferences,
      ),
      ...createUnsupportedAdvancedProfileDiagnostics(input.definition),
      ...createUnusedSegmentRegionDiagnostics(unusedSegments),
      ...createDegenerateSegmentRegionDiagnostics(degenerateSegments),
      ...createRejectedRingRegionDiagnostics(rejectedRings),
    ],
  };
}

function createSegmentDiagnosticTarget(
  segment: SegmentRecord,
): SketchSolveDiagnostic["target"] {
  return segment.source.kind === "entity"
    ? { kind: "entity", entityId: segment.source.entityId }
    : null;
}

function createUnusedSegmentRegionDiagnostics(
  unusedSegments: readonly SegmentRecord[],
): SketchSolveDiagnostic[] {
  const seen = new Set<string>();
  return unusedSegments.flatMap((segment) => {
    if (seen.has(segment.sourceKey)) {
      return [];
    }
    seen.add(segment.sourceKey);
    return [
      makeDiagnostic(
        "profile-open-segment",
        "warning",
        `Boundary segment ${segment.sourceKey} was not used in any closed sketch region.`,
        createSegmentDiagnosticTarget(segment),
      ),
    ];
  });
}

function createDegenerateSegmentRegionDiagnostics(
  degenerateSegments: readonly SegmentRecord[],
): SketchSolveDiagnostic[] {
  const seen = new Set<string>();
  return degenerateSegments.flatMap((segment) => {
    if (seen.has(segment.sourceKey)) {
      return [];
    }
    seen.add(segment.sourceKey);
    return [
      makeDiagnostic(
        "profile-degenerate-segment",
        "warning",
        `Boundary segment ${segment.sourceKey} is too short to participate in sketch region extraction.`,
        createSegmentDiagnosticTarget(segment),
      ),
    ];
  });
}

function createRejectedRingRegionDiagnostics(
  rejectedRings: readonly SketchRingCandidate[],
): SketchSolveDiagnostic[] {
  return rejectedRings.map((ring) =>
    makeDiagnostic(
      "profile-invalid-ring",
      "warning",
      `A closed profile ring was rejected because it is self-intersecting or below the minimum region area tolerance.`,
      ring.boundarySegments[0]?.source.kind === "entity"
        ? { kind: "entity", entityId: ring.boundarySegments[0].source.entityId }
        : null,
    ),
  );
}

function createUnsupportedAdvancedProfileDiagnostics(
  definition: SketchDefinition,
): SketchSolveDiagnostic[] {
  return definition.entities.flatMap((entity) => {
    if (
      entity.isConstruction ||
      entity.kind === "ellipse" ||
      entity.kind === "profileText"
    ) {
      return [];
    }

    if (
      entity.kind !== "ellipticalArc" &&
      entity.kind !== "conic" &&
      entity.kind !== "bezierCurve"
    ) {
      return [];
    }

    return [
      makeDiagnostic(
        "unsupported-profile-entity",
        "warning",
        `${entity.kind} ${entity.entityId} is valid sketch geometry, but profile extraction does not yet convert it into selectable boundaries.`,
        { kind: "entity", entityId: entity.entityId },
      ),
    ];
  });
}

function createProjectedReferenceRegionDiagnostics(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
): SketchSolveDiagnostic[] {
  const projectedById = new Map(
    projectedReferences.map((reference) => [reference.referenceId, reference]),
  );
  const diagnostics: SketchSolveDiagnostic[] = projectedReferences
    .filter(
      (projected) => !isAuthoredReference(definition, projected.referenceId),
    )
    .map((projected) =>
      makeDiagnostic(
        "projected-region-reference-unauthored",
        "warning",
        `Projected reference ${projected.referenceId} cannot participate in live-derived region extraction because it is not backed by the current authored sketch references.`,
        null,
      ),
    );

  return diagnostics.concat(
    definition.referenceIds.flatMap((referenceId) => {
      if (!isAuthoredReference(definition, referenceId)) {
        return [
          makeDiagnostic(
            "projected-region-reference-unauthored",
            "warning",
            `Reference ${referenceId} cannot participate in live-derived projected region extraction because it is not backed by both referenceIds and references.`,
            null,
          ),
        ];
      }

      const projected = projectedById.get(referenceId);

      if (!projected) {
        return [
          makeDiagnostic(
            "projected-region-reference-unresolved",
            "warning",
            `Reference ${referenceId} is unavailable for live-derived projected region extraction.`,
            null,
          ),
        ];
      }

      if (projected.status !== "projected") {
        return [
          makeDiagnostic(
            "projected-region-reference-invalid",
            "warning",
            `Reference ${referenceId} cannot participate in live-derived projected region extraction because projection status is ${projected.status}.`,
            null,
          ),
        ];
      }

      return [];
    }),
  );
}

function createLoopRecord(
  regionId: RegionId,
  ordinal: number,
  role: RegionLoopRecord["role"],
  ring: SketchRingCandidate,
  reverse: boolean,
): RegionLoopRecord {
  if (!reverse) {
    return {
      loopId: createRegionLoopId(regionId, ordinal),
      role,
      orientation: ring.signedArea >= 0 ? "counterClockwise" : "clockwise",
      segments: ring.boundarySegments.map((segment) =>
        toRegionSegmentRecord(segment),
      ),
      boundaryPointIds: ring.boundaryPointIds,
      isClosed: true,
    };
  }

  const lastIndex = ring.boundarySegments.length - 1;
  const reversedPointIds =
    ring.boundaryPointIds.length > 0
      ? ring.boundarySegments.map((_, index) => {
          const originalIndex = lastIndex - index;
          return ring.boundaryPointIds[
            (originalIndex + 1) % ring.boundaryPointIds.length
          ]!;
        })
      : [];

  return {
    loopId: createRegionLoopId(regionId, ordinal),
    role,
    orientation: ring.signedArea >= 0 ? "clockwise" : "counterClockwise",
    segments: [...ring.boundarySegments]
      .reverse()
      .map((segment) =>
        toRegionSegmentRecord(reverseRingBoundarySegment(segment)),
      ),
    boundaryPointIds: reversedPointIds,
    isClosed: true,
  };
}

function toRegionSegmentRecord(
  segment: RingBoundarySegment,
): RegionBoundarySegmentRecord {
  return {
    source: segment.source,
    startPointId: segment.startPointId,
    endPointId: segment.endPointId,
    ...(segment.traversalDirection === "reverse"
      ? { traversalDirection: "reverse" as const }
      : {}),
  };
}

function reverseRingBoundarySegment(
  segment: RingBoundarySegment,
): RingBoundarySegment {
  return {
    source: segment.source,
    startPointId: segment.endPointId,
    endPointId: segment.startPointId,
    traversalDirection:
      segment.traversalDirection === "forward" ? "reverse" : "forward",
  };
}
