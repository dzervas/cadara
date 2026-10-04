import type {
  SketchDefinition,
  SketchDerivationDefinition,
  SketchDerivedEntityOutput,
  SketchEntityDefinition,
  SketchOffsetJointOutput,
  SketchOffsetPiecewiseCubicOutput,
  SketchPointDefinition,
} from "@/contracts/sketch/schema";
import {
  evaluateSketchDerivations,
  type SketchDerivationSettings,
} from "@/contracts/sketch/derived-geometry";
import {
  closestSplineSpanLocation,
  evaluateSplineSpan,
  orderedSplineOccurrences,
  orderedSplinePointIds,
  reconstructSplineAggregate,
  tessellateCubicSpans,
  type SolvedCubicSpan,
} from "@/contracts/sketch/spline-geometry";
import {
  offsetLinePoints,
  scalePointFromCenter,
} from "@/contracts/sketch/offset-geometry";
import { extractDeclaredOffsetChainConnectivity } from "@/contracts/sketch/offset-chain-connectivity";
import {
  solveOffsetFrame,
  type OffsetFramePlan,
} from "@/contracts/sketch/offset-derivation-frame";
import {
  mapOffsetFrameOutputs,
  splineSourceSpanPairs,
} from "@/contracts/sketch/offset-derivation-outputs";
import { canonicalArcSupport } from "@/contracts/sketch/canonical-arc-support";
import {
  projectedSplineIsClosed,
  type ProjectedSketchReferenceGeometry,
} from "@/contracts/solver/schema";
import type { SketchPoint } from "@/contracts/modeling/schema";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type {
  SketchDraftEntity,
  SketchToolCommitContribution,
  SketchToolCommitFactories,
} from "@/core/sketch-tools/definition";
import {
  createArcEndpointDimensions,
  createTangentConstraint,
} from "@/core/sketch-tools/constraints";
import { distanceBetween as distanceBetweenPoints } from "@/domain/sketch/point-math";

export type OffsetSide = "left" | "right";

export interface SketchMutationResult {
  changed: boolean;
  message: string | null;
  definition: SketchDefinition;
}

export interface OffsetContributionResult {
  valid: boolean;
  message: string | null;
  contribution: SketchToolCommitContribution | null;
  previewEntities: readonly SketchDraftEntity[];
}

export interface SketchEditOperationResult {
  valid: boolean;
  message: string | null;
  definition: SketchDefinition | null;
  contribution: SketchToolCommitContribution | null;
  previewEntities: readonly SketchDraftEntity[];
}

export type SketchEditOperationFactories = Pick<
  SketchToolCommitFactories,
  | "createPointId"
  | "createEntityId"
  | "createConstraintId"
  | "createDimensionId"
  | "createPoint"
  | "createLineEntity"
  | "createPointEntity"
  | "createCircleEntity"
  | "createArcEntity"
  | "createSplineEntity"
>;

type CurveSample = {
  point: SketchPoint;
  t: number;
};

type CurveSegment = {
  start: CurveSample;
  end: CurveSample;
};

type CurveDescriptor =
  | {
      kind: "lineSegment";
      entity: Extract<SketchEntityDefinition, { kind: "lineSegment" }>;
      isConstruction: boolean;
      style: SketchEntityDefinition["style"];
      start: SketchPoint;
      end: SketchPoint;
    }
  | {
      kind: "circle";
      entity: Extract<SketchEntityDefinition, { kind: "circle" }>;
      isConstruction: boolean;
      style: SketchEntityDefinition["style"];
      center: SketchPoint;
      radius: number;
    }
  | {
      kind: "arc";
      entity: Extract<SketchEntityDefinition, { kind: "arc" }>;
      isConstruction: boolean;
      style: SketchEntityDefinition["style"];
      center: SketchPoint;
      start: SketchPoint;
      end: SketchPoint;
      sweepDirection: "clockwise" | "counterClockwise";
    }
  | {
      kind: "spline";
      entity: Extract<SketchEntityDefinition, { kind: "spline" }>;
      isConstruction: boolean;
      style: SketchEntityDefinition["style"];
      /**
       * T10f: the curve's exact cubic spans (a sketch spline's
       * reconstruction, a projected neutral spline's spans), or a projected
       * spline's source samples, which are its geometry.
       */
      geometry:
        | { kind: "spans"; spans: readonly SolvedCubicSpan[] }
        | { kind: "samples"; points: readonly SketchPoint[] };
      /** A projected closed spline: its polyline returns to its start. */
      isClosed: boolean;
    };

export type OffsetCurveDescriptor =
  | Omit<Extract<CurveDescriptor, { kind: "lineSegment" }>, "entity">
  | Omit<Extract<CurveDescriptor, { kind: "circle" }>, "entity">
  | Omit<Extract<CurveDescriptor, { kind: "arc" }>, "entity">
  | Omit<Extract<CurveDescriptor, { kind: "spline" }>, "entity">;

export type SketchDerivedTransformOperatorKind =
  | "mirror"
  | "linearPattern"
  | "circularPattern"
  | "transform";

export interface SketchDerivedTransformContributionInput {
  definition: SketchDefinition;
  operatorKind: SketchDerivedTransformOperatorKind;
  entityIds: readonly SketchEntityId[];
  value: number | null;
  sequence: number;
  factories: SketchEditOperationFactories;
  /** The document's settings.modelingTolerance ([TECH] G12). */
  modelingTolerance: number;
}

type TrimIntersection = {
  point: SketchPoint;
  t: number;
};

type TrimFactories = {
  nextPointId(suffix: string): SketchPointId;
  nextEntityId(suffix: string): SketchEntityId;
  createPoint(
    label: string,
    pointId: SketchPointId,
    position: SketchPoint,
  ): SketchPointDefinition;
  createLine(
    label: string,
    entityId: SketchEntityId,
    startPointId: SketchPointId,
    endPointId: SketchPointId,
  ): SketchEntityDefinition;
  createArc(
    label: string,
    entityId: SketchEntityId,
    centerPointId: SketchPointId,
    startPointId: SketchPointId,
    endPointId: SketchPointId,
    sweepDirection: "clockwise" | "counterClockwise",
  ): SketchEntityDefinition;
  createSpline(
    label: string,
    entityId: SketchEntityId,
    fitPointIds: readonly SketchPointId[],
  ): SketchEntityDefinition;
};

const EPSILON = 1e-6;
const CURVE_SAMPLE_COUNT = 96;

function distanceBetween(left: SketchPoint, right: SketchPoint) {
  return distanceBetweenPoints(left, right);
}

function pointsAlmostEqual(left: SketchPoint, right: SketchPoint) {
  return distanceBetween(left, right) <= EPSILON;
}

function add(left: SketchPoint, right: SketchPoint): SketchPoint {
  return [left[0] + right[0], left[1] + right[1]];
}

function subtract(left: SketchPoint, right: SketchPoint): SketchPoint {
  return [left[0] - right[0], left[1] - right[1]];
}

function scale(vector: SketchPoint, scalar: number): SketchPoint {
  return [vector[0] * scalar, vector[1] * scalar];
}

function normalize(vector: SketchPoint): SketchPoint | null {
  const length = Math.hypot(vector[0], vector[1]);
  return length <= EPSILON ? null : [vector[0] / length, vector[1] / length];
}

function getPoint(definition: SketchDefinition, pointId: SketchPointId) {
  return definition.points.find((point) => point.pointId === pointId) ?? null;
}

function getCurveDescriptor(
  definition: SketchDefinition,
  entity: SketchEntityDefinition,
): CurveDescriptor | null {
  switch (entity.kind) {
    case "point":
      return null;
    case "lineSegment": {
      const start = getPoint(definition, entity.startPointId);
      const end = getPoint(definition, entity.endPointId);
      return start && end
        ? {
            kind: "lineSegment",
            entity,
            isConstruction: entity.isConstruction,
            style: entity.style,
            start: start.position,
            end: end.position,
          }
        : null;
    }
    case "circle": {
      const center = getPoint(definition, entity.centerPointId);
      return center
        ? {
            kind: "circle",
            entity,
            isConstruction: entity.isConstruction,
            style: entity.style,
            center: center.position,
            radius: entity.radius,
          }
        : null;
    }
    case "arc": {
      const center = getPoint(definition, entity.centerPointId);
      const start = getPoint(definition, entity.startPointId);
      const end = getPoint(definition, entity.endPointId);
      return center && start && end
        ? {
            kind: "arc",
            entity,
            isConstruction: entity.isConstruction,
            style: entity.style,
            center: center.position,
            start: start.position,
            end: end.position,
            sweepDirection: entity.sweepDirection,
          }
        : null;
    }
    case "spline": {
      const positions = Object.fromEntries(
        definition.points.map((point) => [point.pointId, point.position]),
      ) as Record<SketchPointId, SketchPoint>;
      const spans = reconstructSplineAggregate(entity, positions).spans;
      return spans.length > 0
        ? {
            kind: "spline",
            entity,
            isConstruction: entity.isConstruction,
            style: entity.style,
            geometry: { kind: "spans", spans },
            // A closed sketch spline's spans already return to its start.
            isClosed: false,
          }
        : null;
    }
    case "ellipse":
    case "ellipticalArc":
    case "conic":
    case "bezierCurve":
    case "profileText":
    case "derivedPiecewiseCubic":
      return null;
  }
}

export function offsetCurveDescriptorFromProjectedGeometry(
  geometry: ProjectedSketchReferenceGeometry,
): OffsetCurveDescriptor | null {
  switch (geometry.kind) {
    case "point":
      return null;
    case "lineSegment":
      return {
        kind: "lineSegment",
        isConstruction: false,
        style: undefined,
        start: geometry.startPosition,
        end: geometry.endPosition,
      };
    case "circle":
      return {
        kind: "circle",
        isConstruction: false,
        style: undefined,
        center: geometry.centerPosition,
        radius: geometry.radius,
      };
    case "arc":
      return {
        kind: "arc",
        isConstruction: false,
        style: undefined,
        center: geometry.centerPosition,
        start: geometry.startPosition,
        end: geometry.endPosition,
        sweepDirection: geometry.sweepDirection,
      };
    case "spline": {
      const { representation } = geometry;
      const usable =
        representation.kind === "neutralCubicSpans"
          ? representation.spans.length > 0
          : representation.points.length >= 2;
      return usable
        ? {
            kind: "spline",
            isConstruction: false,
            style: undefined,
            geometry:
              representation.kind === "neutralCubicSpans"
                ? { kind: "spans", spans: representation.spans }
                : { kind: "samples", points: representation.points },
            isClosed: projectedSplineIsClosed(geometry),
          }
        : null;
    }
  }
}

function normalizeAngle(angle: number) {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

function sweepOffset(
  angle: number,
  startAngle: number,
  sweepDirection: "clockwise" | "counterClockwise",
) {
  return sweepDirection === "counterClockwise"
    ? normalizeAngle(angle - startAngle)
    : normalizeAngle(startAngle - angle);
}

function arcSweep(curve: Extract<OffsetCurveDescriptor, { kind: "arc" }>) {
  const startAngle = Math.atan2(
    curve.start[1] - curve.center[1],
    curve.start[0] - curve.center[0],
  );
  const endAngle = Math.atan2(
    curve.end[1] - curve.center[1],
    curve.end[0] - curve.center[0],
  );
  return sweepOffset(endAngle, startAngle, curve.sweepDirection);
}

function pointOnCircle(
  center: SketchPoint,
  radius: number,
  angle: number,
): SketchPoint {
  return [
    center[0] + Math.cos(angle) * radius,
    center[1] + Math.sin(angle) * radius,
  ];
}

/**
 * The display polyline of a spline descriptor, read only by the sampler
 * that remains until its slice replaces it (T10f, listed in the
 * tessellation boundary guard): Trim's intersection sampling (T10g).
 */
function splineDescriptorPolyline(
  curve: Pick<
    Extract<OffsetCurveDescriptor, { kind: "spline" }>,
    "geometry" | "isClosed"
  >,
): readonly SketchPoint[] {
  const points =
    curve.geometry.kind === "spans"
      ? tessellateCubicSpans(curve.geometry.spans)
      : curve.geometry.points;
  return curve.isClosed && points.length > 2 ? [...points, points[0]!] : points;
}

function sampleSplineDisplayPolyline(
  points: readonly SketchPoint[],
  t: number,
): SketchPoint {
  const scaled = Math.max(0, Math.min(1, t)) * (points.length - 1);
  const index = Math.min(Math.floor(scaled), points.length - 2);
  const local = scaled - index;
  const start = points[index]!;
  const end = points[index + 1]!;
  return [
    start[0] + (end[0] - start[0]) * local,
    start[1] + (end[1] - start[1]) * local,
  ];
}

function sampleCurve(curve: CurveDescriptor): CurveSample[] {
  switch (curve.kind) {
    case "lineSegment":
      return [
        { point: curve.start, t: 0 },
        { point: curve.end, t: 1 },
      ];
    case "circle":
      return Array.from({ length: CURVE_SAMPLE_COUNT + 1 }, (_, index) => {
        const t = index / CURVE_SAMPLE_COUNT;
        return {
          point: pointOnCircle(curve.center, curve.radius, t * Math.PI * 2),
          t,
        };
      });
    case "arc": {
      const startAngle = Math.atan2(
        curve.start[1] - curve.center[1],
        curve.start[0] - curve.center[0],
      );
      const sweep = arcSweep(curve);
      return Array.from({ length: CURVE_SAMPLE_COUNT + 1 }, (_, index) => {
        const t = index / CURVE_SAMPLE_COUNT;
        const offset =
          sweep * t * (curve.sweepDirection === "counterClockwise" ? 1 : -1);
        return {
          point: pointOnCircle(
            curve.center,
            distanceBetween(curve.start, curve.center),
            startAngle + offset,
          ),
          t,
        };
      });
    }
    case "spline": {
      const polyline = splineDescriptorPolyline(curve);
      return Array.from({ length: CURVE_SAMPLE_COUNT + 1 }, (_, index) => {
        const t = index / CURVE_SAMPLE_COUNT;
        return {
          point: sampleSplineDisplayPolyline(polyline, t),
          t,
        };
      });
    }
  }
}

function segmentsFromSamples(samples: readonly CurveSample[]): CurveSegment[] {
  const segments: CurveSegment[] = [];
  for (let index = 0; index + 1 < samples.length; index += 1) {
    segments.push({
      start: samples[index]!,
      end: samples[index + 1]!,
    });
  }
  return segments;
}

function lineLineIntersection(input: {
  start: SketchPoint;
  end: SketchPoint;
  otherStart: SketchPoint;
  otherEnd: SketchPoint;
}) {
  const dx = input.end[0] - input.start[0];
  const dy = input.end[1] - input.start[1];
  const otherDx = input.otherEnd[0] - input.otherStart[0];
  const otherDy = input.otherEnd[1] - input.otherStart[1];
  const denominator = dx * otherDy - dy * otherDx;

  if (Math.abs(denominator) <= EPSILON) {
    return null;
  }

  const offsetX = input.otherStart[0] - input.start[0];
  const offsetY = input.otherStart[1] - input.start[1];
  const t = (offsetX * otherDy - offsetY * otherDx) / denominator;
  const u = (offsetX * dy - offsetY * dx) / denominator;

  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) {
    return null;
  }

  const clampedT = Math.max(0, Math.min(1, t));
  return {
    point: [
      input.start[0] + dx * clampedT,
      input.start[1] + dy * clampedT,
    ] as const,
    t: clampedT,
  };
}

function infiniteLineIntersection(input: {
  start: SketchPoint;
  end: SketchPoint;
  otherStart: SketchPoint;
  otherEnd: SketchPoint;
}) {
  const dx = input.end[0] - input.start[0];
  const dy = input.end[1] - input.start[1];
  const otherDx = input.otherEnd[0] - input.otherStart[0];
  const otherDy = input.otherEnd[1] - input.otherStart[1];
  const denominator = dx * otherDy - dy * otherDx;

  if (Math.abs(denominator) <= EPSILON) {
    return null;
  }

  const offsetX = input.otherStart[0] - input.start[0];
  const offsetY = input.otherStart[1] - input.start[1];
  const t = (offsetX * otherDy - offsetY * otherDx) / denominator;

  return [input.start[0] + dx * t, input.start[1] + dy * t] as const;
}

function segmentIntersection(
  target: CurveSegment,
  candidate: CurveSegment,
): TrimIntersection | null {
  const intersection = lineLineIntersection({
    start: target.start.point,
    end: target.end.point,
    otherStart: candidate.start.point,
    otherEnd: candidate.end.point,
  });

  if (!intersection) {
    return null;
  }

  return {
    point: intersection.point,
    t: target.start.t + (target.end.t - target.start.t) * intersection.t,
  };
}

function uniqueIntersections(intersections: readonly TrimIntersection[]) {
  const sorted = [...intersections].sort((left, right) => left.t - right.t);
  const unique: TrimIntersection[] = [];

  for (const intersection of sorted) {
    if (
      !unique.some(
        (entry) =>
          Math.abs(entry.t - intersection.t) <= EPSILON ||
          distanceBetween(entry.point, intersection.point) <= EPSILON,
      )
    ) {
      unique.push(intersection);
    }
  }

  return unique;
}

function collectTargetIntersections(
  definition: SketchDefinition,
  targetCurve: CurveDescriptor,
) {
  const targetSegments = segmentsFromSamples(sampleCurve(targetCurve));
  const intersections = definition.entities.flatMap(
    (entity): TrimIntersection[] => {
      if (entity.entityId === targetCurve.entity.entityId) {
        return [];
      }

      const candidateCurve = getCurveDescriptor(definition, entity);
      if (!candidateCurve) {
        return [];
      }

      const candidateSegments = segmentsFromSamples(
        sampleCurve(candidateCurve),
      );
      return targetSegments.flatMap((targetSegment) =>
        candidateSegments.flatMap((candidateSegment) => {
          const intersection = segmentIntersection(
            targetSegment,
            candidateSegment,
          );
          return intersection ? [intersection] : [];
        }),
      );
    },
  );

  return uniqueIntersections(
    intersections.filter(
      (intersection) =>
        intersection.t > EPSILON && intersection.t < 1 - EPSILON,
    ),
  );
}

function fail(
  message: string,
  definition: SketchDefinition,
): SketchMutationResult {
  return { changed: false, message, definition };
}

function withAppendedTrimPoints(
  definition: SketchDefinition,
  points: readonly SketchPointDefinition[],
) {
  return {
    pointIds: [...definition.pointIds, ...points.map((point) => point.pointId)],
    points: [...definition.points, ...points],
  };
}

export function trimLineSegmentAtIntersections(
  input: {
    definition: SketchDefinition;
    entityId: SketchEntityId;
  } & TrimFactories,
): SketchMutationResult {
  const entity = input.definition.entities.find(
    (candidate) => candidate.entityId === input.entityId,
  );
  if (!entity) {
    return fail("Trim target was not found.", input.definition);
  }

  const targetCurve = getCurveDescriptor(input.definition, entity);
  if (!targetCurve) {
    return fail(
      "Trim supports line, circle, arc, and spline entities.",
      input.definition,
    );
  }

  const intersections = collectTargetIntersections(
    input.definition,
    targetCurve,
  );
  if (intersections.length < 2) {
    return fail(
      "Trim needs two unambiguous intersections on the target curve.",
      input.definition,
    );
  }

  const trimStart = intersections[0]!;
  const trimEnd = intersections.at(-1)!;

  if (targetCurve.kind === "lineSegment") {
    const trimStartPointId = input.nextPointId("trim-start");
    const trimEndPointId = input.nextPointId("trim-end");
    const splitEntityId = input.nextEntityId("trim-split");
    const trimStartPoint = input.createPoint(
      `${entity.label} trim start`,
      trimStartPointId,
      trimStart.point,
    );
    const trimEndPoint = input.createPoint(
      `${entity.label} trim end`,
      trimEndPointId,
      trimEnd.point,
    );
    const updatedEntity = {
      ...targetCurve.entity,
      endPointId: trimStartPointId,
    };
    const splitEntity = {
      ...input.createLine(
        `${entity.label} trimmed`,
        splitEntityId,
        trimEndPointId,
        targetCurve.entity.endPointId,
      ),
      isConstruction: entity.isConstruction,
      style: entity.style,
    };
    const appended = withAppendedTrimPoints(input.definition, [
      trimStartPoint,
      trimEndPoint,
    ]);

    return {
      changed: true,
      message: null,
      definition: {
        ...input.definition,
        ...appended,
        entityIds: [...input.definition.entityIds, splitEntityId],
        entities: [
          ...input.definition.entities.map((candidate) =>
            candidate.entityId === entity.entityId ? updatedEntity : candidate,
          ),
          splitEntity,
        ],
      },
    };
  }

  if (targetCurve.kind === "circle") {
    const trimStartPointId = input.nextPointId("trim-start");
    const trimEndPointId = input.nextPointId("trim-end");
    const trimStartPoint = input.createPoint(
      `${entity.label} trim start`,
      trimStartPointId,
      trimStart.point,
    );
    const trimEndPoint = input.createPoint(
      `${entity.label} trim end`,
      trimEndPointId,
      trimEnd.point,
    );
    const updatedEntity = {
      ...input.createArc(
        entity.label,
        entity.entityId,
        targetCurve.entity.centerPointId,
        trimStartPointId,
        trimEndPointId,
        "counterClockwise",
      ),
      isConstruction: entity.isConstruction,
      style: entity.style,
    };
    const appended = withAppendedTrimPoints(input.definition, [
      trimStartPoint,
      trimEndPoint,
    ]);

    return {
      changed: true,
      message: null,
      definition: {
        ...input.definition,
        ...appended,
        entities: input.definition.entities.map((candidate) =>
          candidate.entityId === entity.entityId ? updatedEntity : candidate,
        ),
      },
    };
  }

  if (targetCurve.kind === "arc") {
    const trimStartPointId = input.nextPointId("trim-start");
    const trimEndPointId = input.nextPointId("trim-end");
    const splitEntityId = input.nextEntityId("trim-split");
    const trimStartPoint = input.createPoint(
      `${entity.label} trim start`,
      trimStartPointId,
      trimStart.point,
    );
    const trimEndPoint = input.createPoint(
      `${entity.label} trim end`,
      trimEndPointId,
      trimEnd.point,
    );
    const updatedEntity = {
      ...targetCurve.entity,
      endPointId: trimStartPointId,
    };
    const splitEntity = {
      ...input.createArc(
        `${entity.label} trimmed`,
        splitEntityId,
        targetCurve.entity.centerPointId,
        trimEndPointId,
        targetCurve.entity.endPointId,
        targetCurve.entity.sweepDirection,
      ),
      isConstruction: entity.isConstruction,
      style: entity.style,
    };
    const appended = withAppendedTrimPoints(input.definition, [
      trimStartPoint,
      trimEndPoint,
    ]);

    return {
      changed: true,
      message: null,
      definition: {
        ...input.definition,
        ...appended,
        entityIds: [...input.definition.entityIds, splitEntityId],
        entities: [
          ...input.definition.entities.map((candidate) =>
            candidate.entityId === entity.entityId ? updatedEntity : candidate,
          ),
          splitEntity,
        ],
      },
    };
  }

  return {
    changed: false,
    message:
      "Spline trimming requires exact neutral-span trimming and is not available yet.",
    definition: input.definition,
  };
}

function makePreviewSpline(
  id: string,
  points: readonly SketchPoint[],
  isConstruction: boolean,
): SketchDraftEntity {
  return {
    id,
    kind: "spline",
    points,
    entityId: null,
    status: "preview",
    label: "Offset preview",
    isConstruction,
  };
}

function createArcPreview(
  curve: Extract<OffsetCurveDescriptor, { kind: "arc" }>,
  radius: number,
) {
  const startVector =
    normalize(subtract(curve.start, curve.center)) ?? ([1, 0] as const);
  const endVector =
    normalize(subtract(curve.end, curve.center)) ?? ([1, 0] as const);
  const midAngle =
    Math.atan2(
      curve.start[1] - curve.center[1],
      curve.start[0] - curve.center[0],
    ) +
    ((curve.sweepDirection === "counterClockwise" ? 1 : -1) * arcSweep(curve)) /
      2;
  return [
    add(curve.center, scale(startVector, radius)),
    pointOnCircle(curve.center, radius, midAngle),
    add(curve.center, scale(endVector, radius)),
  ];
}

type LineChainRecord = {
  entity: Extract<SketchEntityDefinition, { kind: "lineSegment" }>;
  start: SketchPoint;
  end: SketchPoint;
  startNode: number;
  endNode: number;
};

type OrderedLineChainRecord = {
  entity: Extract<SketchEntityDefinition, { kind: "lineSegment" }>;
  start: SketchPoint;
  end: SketchPoint;
};

type LineChainNode = {
  position: SketchPoint;
  incident: number[];
};

function createLineChainFailure(message: string): {
  valid: false;
  message: string;
} {
  return { valid: false, message };
}

function findOrCreateLineChainNode(nodes: LineChainNode[], point: SketchPoint) {
  const existingIndex = nodes.findIndex((node) =>
    pointsAlmostEqual(node.position, point),
  );
  if (existingIndex >= 0) {
    return existingIndex;
  }

  nodes.push({ position: point, incident: [] });
  return nodes.length - 1;
}

function buildOrderedLineChain(
  definition: SketchDefinition,
  entityIds: readonly SketchEntityId[],
):
  | { valid: true; ordered: OrderedLineChainRecord[]; closed: boolean }
  | { valid: false; message: string } {
  const nodes: LineChainNode[] = [];
  const records: LineChainRecord[] = [];

  for (const entityId of entityIds) {
    const entity = definition.entities.find(
      (candidate) => candidate.entityId === entityId,
    );
    if (!entity || entity.kind !== "lineSegment") {
      return createLineChainFailure(
        "Multi-target offset currently supports connected line segments.",
      );
    }

    const start = getPoint(definition, entity.startPointId);
    const end = getPoint(definition, entity.endPointId);
    if (!start || !end || pointsAlmostEqual(start.position, end.position)) {
      return createLineChainFailure("Offset target is too short.");
    }

    const startNode = findOrCreateLineChainNode(nodes, start.position);
    const endNode = findOrCreateLineChainNode(nodes, end.position);
    const recordIndex = records.length;
    records.push({
      entity,
      start: start.position,
      end: end.position,
      startNode,
      endNode,
    });
    nodes[startNode]!.incident.push(recordIndex);
    nodes[endNode]!.incident.push(recordIndex);
  }

  if (records.length < 2) {
    return createLineChainFailure(
      "Continuous offset needs at least two selected line segments.",
    );
  }

  if (nodes.some((node) => node.incident.length > 2)) {
    return createLineChainFailure(
      "Continuous offset supports simple chains and loops.",
    );
  }

  const endpointNodeIndexes = nodes
    .map((node, index) => (node.incident.length === 1 ? index : null))
    .filter((index): index is number => index !== null);
  const closed = endpointNodeIndexes.length === 0;

  if (!closed && endpointNodeIndexes.length !== 2) {
    return createLineChainFailure(
      "Multi-target offset needs a connected line chain.",
    );
  }

  let currentNode = closed ? records[0]!.startNode : endpointNodeIndexes[0]!;
  const startNode = currentNode;
  const unused = new Set(records.map((_, index) => index));
  const ordered: OrderedLineChainRecord[] = [];

  while (unused.size > 0) {
    const nextRecordIndex = nodes[currentNode]!.incident.find((recordIndex) =>
      unused.has(recordIndex),
    );
    if (nextRecordIndex === undefined) {
      return createLineChainFailure(
        "Multi-target offset needs a connected line chain.",
      );
    }

    const record = records[nextRecordIndex]!;
    const nextNode =
      record.startNode === currentNode ? record.endNode : record.startNode;
    ordered.push({
      entity: record.entity,
      start: nodes[currentNode]!.position,
      end: nodes[nextNode]!.position,
    });
    unused.delete(nextRecordIndex);
    currentNode = nextNode;

    if (closed && currentNode === startNode && unused.size > 0) {
      return createLineChainFailure(
        "Multi-target offset needs one connected loop.",
      );
    }
  }

  if (closed && currentNode !== startNode) {
    return createLineChainFailure(
      "Multi-target offset needs one connected loop.",
    );
  }

  return { valid: true, ordered, closed };
}

function signedPolygonArea(vertices: readonly SketchPoint[]) {
  let area = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]!;
    const next = vertices[(index + 1) % vertices.length]!;
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
}

function offsetSideFactorForChain(
  ordered: readonly OrderedLineChainRecord[],
  closed: boolean,
  side: OffsetSide,
) {
  if (!closed) {
    return side === "left" ? 1 : -1;
  }

  const area = signedPolygonArea(ordered.map((line) => line.start));
  if (Math.abs(area) <= EPSILON) {
    return null;
  }

  const outwardFactor = area > 0 ? -1 : 1;
  return side === "left" ? outwardFactor : -outwardFactor;
}

function averagePoint(left: SketchPoint, right: SketchPoint): SketchPoint {
  return [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
}

function dot(left: SketchPoint, right: SketchPoint) {
  return left[0] * right[0] + left[1] * right[1];
}

function cross(left: SketchPoint, right: SketchPoint) {
  return left[0] * right[1] - left[1] * right[0];
}

function createInvalidOperationResult(
  message: string,
  previewEntities: readonly SketchDraftEntity[] = [],
): SketchEditOperationResult {
  return {
    valid: false,
    message,
    definition: null,
    contribution: null,
    previewEntities,
  };
}

function createContributionOperationResult(
  contribution: SketchToolCommitContribution,
  previewEntities: readonly SketchDraftEntity[],
): SketchEditOperationResult {
  return {
    valid: true,
    message: null,
    definition: null,
    contribution,
    previewEntities,
  };
}

function createMutationOperationResult(
  definition: SketchDefinition,
  previewEntities: readonly SketchDraftEntity[],
): SketchEditOperationResult {
  return {
    valid: true,
    message: null,
    definition,
    contribution: null,
    previewEntities,
  };
}

function getLineDescriptorById(
  definition: SketchDefinition,
  entityId: SketchEntityId,
) {
  const entity = definition.entities.find(
    (candidate) => candidate.entityId === entityId,
  );
  if (!entity || entity.kind !== "lineSegment") {
    return null;
  }

  const start = getPoint(definition, entity.startPointId);
  const end = getPoint(definition, entity.endPointId);
  if (!start || !end || pointsAlmostEqual(start.position, end.position)) {
    return null;
  }

  return {
    entity,
    startPoint: start,
    endPoint: end,
    start: start.position,
    end: end.position,
  };
}

function getSelectedLineDescriptors(
  definition: SketchDefinition,
  entityIds: readonly SketchEntityId[],
) {
  return entityIds.map((entityId) =>
    getLineDescriptorById(definition, entityId),
  );
}

function findSharedLineCorner(
  first: NonNullable<ReturnType<typeof getLineDescriptorById>>,
  second: NonNullable<ReturnType<typeof getLineDescriptorById>>,
) {
  const candidates = [
    {
      firstPoint: first.startPoint,
      firstOther: first.end,
      secondPoint: second.startPoint,
      secondOther: second.end,
    },
    {
      firstPoint: first.startPoint,
      firstOther: first.end,
      secondPoint: second.endPoint,
      secondOther: second.start,
    },
    {
      firstPoint: first.endPoint,
      firstOther: first.start,
      secondPoint: second.startPoint,
      secondOther: second.end,
    },
    {
      firstPoint: first.endPoint,
      firstOther: first.start,
      secondPoint: second.endPoint,
      secondOther: second.start,
    },
  ];

  const match = candidates.find(
    (candidate) =>
      candidate.firstPoint.pointId === candidate.secondPoint.pointId ||
      pointsAlmostEqual(
        candidate.firstPoint.position,
        candidate.secondPoint.position,
      ),
  );

  if (!match) {
    return null;
  }

  return {
    pointId: match.firstPoint.pointId,
    point: match.firstPoint.position,
    firstOther: match.firstOther,
    secondOther: match.secondOther,
  };
}

function replaceLineEndpoint(
  entity: Extract<SketchEntityDefinition, { kind: "lineSegment" }>,
  originalPointId: SketchPointId,
  replacementPointId: SketchPointId,
) {
  return {
    ...entity,
    startPointId:
      entity.startPointId === originalPointId
        ? replacementPointId
        : entity.startPointId,
    endPointId:
      entity.endPointId === originalPointId
        ? replacementPointId
        : entity.endPointId,
  };
}

function makePreviewLine(
  id: string,
  label: string,
  start: SketchPoint,
  end: SketchPoint,
  isConstruction: boolean,
): SketchDraftEntity {
  return {
    id,
    kind: "line",
    start,
    end,
    entityId: null,
    status: "preview",
    label,
    isConstruction,
  };
}

function makePreviewPolyline(
  id: string,
  label: string,
  points: readonly SketchPoint[],
  isClosed: boolean,
  isConstruction: boolean,
): SketchDraftEntity {
  return {
    id,
    kind: "polyline",
    points,
    isClosed,
    entityId: null,
    status: "preview",
    label,
    isConstruction,
  };
}

function appendPointsAndEntities(
  definition: SketchDefinition,
  points: readonly SketchPointDefinition[],
  entities: readonly SketchEntityDefinition[],
): SketchDefinition {
  return {
    ...definition,
    pointIds: [...definition.pointIds, ...points.map((point) => point.pointId)],
    points: [...definition.points, ...points],
    entityIds: [
      ...definition.entityIds,
      ...entities.map((entity) => entity.entityId),
    ],
    entities: [...definition.entities, ...entities],
  };
}

function updateDefinitionEntities(
  definition: SketchDefinition,
  updatedEntities: readonly SketchEntityDefinition[],
) {
  const updatedById = new Map(
    updatedEntities.map((entity) => [entity.entityId, entity]),
  );
  return {
    ...definition,
    entities: definition.entities.map(
      (entity) => updatedById.get(entity.entityId) ?? entity,
    ),
  };
}

/**
 * Issue 06 ("preserve relationships that define a primitive"): an edit
 * operation's arc is bound to its end points exactly as the arc tools bind
 * theirs (`createArcEndpointDimensions`) and is tangent to each line it
 * rounds. No radius dimension: sizes stay free (sizing decision B).
 */
function primitiveArcRelationships(input: {
  factories: SketchEditOperationFactories;
  idPrefix: string;
  label: string;
  arc: {
    entityId: SketchEntityId;
    startPointId: SketchPointId;
    endPointId: SketchPointId;
  };
  tangentLines: readonly { name: string; entityId: SketchEntityId }[];
}) {
  return {
    constraints: input.tangentLines.map((line) =>
      createTangentConstraint({
        constraintId: input.factories.createConstraintId(
          `${input.idPrefix}-tangent-${line.name.toLowerCase()}`,
        ),
        label: `${input.label} tangent ${line.name}`,
        entityIds: [input.arc.entityId, line.entityId],
      }),
    ),
    dimensions: createArcEndpointDimensions({
      createDimensionId: (suffix) =>
        input.factories.createDimensionId(`${input.idPrefix}-${suffix}`),
      labelPrefix: input.label,
      entityId: input.arc.entityId,
      startPointId: input.arc.startPointId,
      endPointId: input.arc.endPointId,
    }),
  };
}

export function createSketchFilletMutation(input: {
  definition: SketchDefinition;
  entityIds: readonly SketchEntityId[];
  radius: number | null;
  sequence: number;
  factories: SketchEditOperationFactories;
}): SketchEditOperationResult {
  if (input.radius === null || input.radius <= EPSILON) {
    return createInvalidOperationResult(
      "Fillet radius must be greater than zero.",
    );
  }

  if (input.entityIds.length !== 2) {
    return createInvalidOperationResult(
      "Sketch fillet needs two adjacent sketch lines.",
    );
  }

  const [first, second] = getSelectedLineDescriptors(
    input.definition,
    input.entityIds,
  );
  if (!first || !second) {
    return createInvalidOperationResult(
      "Sketch fillet currently supports two adjacent line segments.",
    );
  }

  const corner = findSharedLineCorner(first, second);
  if (!corner) {
    return createInvalidOperationResult(
      "Sketch fillet needs two lines that share a corner.",
    );
  }

  const firstDirection = normalize(subtract(corner.firstOther, corner.point));
  const secondDirection = normalize(subtract(corner.secondOther, corner.point));
  if (!firstDirection || !secondDirection) {
    return createInvalidOperationResult("Sketch fillet target is too short.");
  }

  const clampedDot = Math.max(
    -1,
    Math.min(1, dot(firstDirection, secondDirection)),
  );
  const angle = Math.acos(clampedDot);
  if (angle <= EPSILON || Math.abs(Math.PI - angle) <= EPSILON) {
    return createInvalidOperationResult(
      "Sketch fillet needs a non-collinear corner.",
    );
  }

  const trimDistance = input.radius / Math.tan(angle / 2);
  const firstLength = distanceBetween(corner.point, corner.firstOther);
  const secondLength = distanceBetween(corner.point, corner.secondOther);
  if (
    trimDistance <= EPSILON ||
    trimDistance >= firstLength ||
    trimDistance >= secondLength
  ) {
    return createInvalidOperationResult(
      "Fillet radius is too large for the selected corner.",
    );
  }

  const firstTangent = add(corner.point, scale(firstDirection, trimDistance));
  const secondTangent = add(corner.point, scale(secondDirection, trimDistance));
  const bisector = normalize(add(firstDirection, secondDirection));
  if (!bisector) {
    return createInvalidOperationResult(
      "Sketch fillet needs a non-collinear corner.",
    );
  }

  const center = add(
    corner.point,
    scale(bisector, input.radius / Math.sin(angle / 2)),
  );
  const centerPointId = input.factories.createPointId("fillet-center");
  const firstPointId = input.factories.createPointId("fillet-tangent-a");
  const secondPointId = input.factories.createPointId("fillet-tangent-b");
  const arcEntityId = input.factories.createEntityId("fillet-arc");
  const isConstruction =
    first.entity.isConstruction && second.entity.isConstruction;
  const arcEntity = {
    ...input.factories.createArcEntity(
      `Fillet ${input.sequence}`,
      arcEntityId,
      centerPointId,
      firstPointId,
      secondPointId,
      cross(firstDirection, secondDirection) > 0
        ? "clockwise"
        : "counterClockwise",
    ),
    isConstruction,
    style: first.entity.style ?? second.entity.style,
  };
  const updatedFirst = replaceLineEndpoint(
    first.entity,
    corner.pointId,
    firstPointId,
  );
  const updatedSecond = replaceLineEndpoint(
    second.entity,
    corner.pointId,
    secondPointId,
  );
  const { constraints, dimensions } = primitiveArcRelationships({
    factories: input.factories,
    idPrefix: "fillet",
    label: `Fillet ${input.sequence}`,
    arc: {
      entityId: arcEntityId,
      startPointId: firstPointId,
      endPointId: secondPointId,
    },
    tangentLines: [
      { name: "A", entityId: first.entity.entityId },
      { name: "B", entityId: second.entity.entityId },
    ],
  });
  const geometry = appendPointsAndEntities(
    updateDefinitionEntities(input.definition, [updatedFirst, updatedSecond]),
    [
      input.factories.createPoint(
        `Fillet ${input.sequence} center`,
        centerPointId,
        center,
      ),
      input.factories.createPoint(
        `Fillet ${input.sequence} tangent A`,
        firstPointId,
        firstTangent,
      ),
      input.factories.createPoint(
        `Fillet ${input.sequence} tangent B`,
        secondPointId,
        secondTangent,
      ),
    ],
    [arcEntity],
  );
  const definition: SketchDefinition = {
    ...geometry,
    constraintIds: [
      ...geometry.constraintIds,
      ...constraints.map((constraint) => constraint.constraintId),
    ],
    constraints: [...geometry.constraints, ...constraints],
    dimensionIds: [
      ...geometry.dimensionIds,
      ...dimensions.map((dimension) => dimension.dimensionId),
    ],
    dimensions: [...geometry.dimensions, ...dimensions],
  };

  return createMutationOperationResult(definition, [
    makePreviewLine(
      "preview-fillet-trim-a",
      "Fillet preview",
      corner.firstOther,
      firstTangent,
      first.entity.isConstruction,
    ),
    makePreviewLine(
      "preview-fillet-trim-b",
      "Fillet preview",
      corner.secondOther,
      secondTangent,
      second.entity.isConstruction,
    ),
    makePreviewSpline(
      "preview-fillet-arc",
      [
        firstTangent,
        pointOnCircle(
          center,
          input.radius,
          (Math.atan2(
            firstTangent[1] - center[1],
            firstTangent[0] - center[0],
          ) +
            Math.atan2(
              secondTangent[1] - center[1],
              secondTangent[0] - center[0],
            )) /
            2,
        ),
        secondTangent,
      ],
      isConstruction,
    ),
  ]);
}

export function createSketchChamferMutation(input: {
  definition: SketchDefinition;
  entityIds: readonly SketchEntityId[];
  distance: number | null;
  sequence: number;
  factories: SketchEditOperationFactories;
}): SketchEditOperationResult {
  if (input.distance === null || input.distance <= EPSILON) {
    return createInvalidOperationResult(
      "Chamfer distance must be greater than zero.",
    );
  }

  if (input.entityIds.length !== 2) {
    return createInvalidOperationResult(
      "Sketch chamfer needs two adjacent sketch lines.",
    );
  }

  const [first, second] = getSelectedLineDescriptors(
    input.definition,
    input.entityIds,
  );
  if (!first || !second) {
    return createInvalidOperationResult(
      "Sketch chamfer currently supports two adjacent line segments.",
    );
  }

  const corner = findSharedLineCorner(first, second);
  if (!corner) {
    return createInvalidOperationResult(
      "Sketch chamfer needs two lines that share a corner.",
    );
  }

  const firstDirection = normalize(subtract(corner.firstOther, corner.point));
  const secondDirection = normalize(subtract(corner.secondOther, corner.point));
  if (
    !firstDirection ||
    !secondDirection ||
    Math.abs(cross(firstDirection, secondDirection)) <= EPSILON
  ) {
    return createInvalidOperationResult(
      "Sketch chamfer needs a non-collinear corner.",
    );
  }

  if (
    input.distance >= distanceBetween(corner.point, corner.firstOther) ||
    input.distance >= distanceBetween(corner.point, corner.secondOther)
  ) {
    return createInvalidOperationResult(
      "Chamfer distance is too large for the selected corner.",
    );
  }

  const firstTangent = add(corner.point, scale(firstDirection, input.distance));
  const secondTangent = add(
    corner.point,
    scale(secondDirection, input.distance),
  );
  const firstPointId = input.factories.createPointId("chamfer-point-a");
  const secondPointId = input.factories.createPointId("chamfer-point-b");
  const chamferEntityId = input.factories.createEntityId("chamfer-line");
  const isConstruction =
    first.entity.isConstruction && second.entity.isConstruction;
  const chamferEntity = {
    ...input.factories.createLineEntity(
      `Chamfer ${input.sequence}`,
      chamferEntityId,
      firstPointId,
      secondPointId,
    ),
    isConstruction,
    style: first.entity.style ?? second.entity.style,
  };
  const updatedFirst = replaceLineEndpoint(
    first.entity,
    corner.pointId,
    firstPointId,
  );
  const updatedSecond = replaceLineEndpoint(
    second.entity,
    corner.pointId,
    secondPointId,
  );
  const definition = appendPointsAndEntities(
    updateDefinitionEntities(input.definition, [updatedFirst, updatedSecond]),
    [
      input.factories.createPoint(
        `Chamfer ${input.sequence} point A`,
        firstPointId,
        firstTangent,
      ),
      input.factories.createPoint(
        `Chamfer ${input.sequence} point B`,
        secondPointId,
        secondTangent,
      ),
    ],
    [chamferEntity],
  );

  return createMutationOperationResult(definition, [
    makePreviewLine(
      "preview-chamfer-trim-a",
      "Chamfer preview",
      corner.firstOther,
      firstTangent,
      first.entity.isConstruction,
    ),
    makePreviewLine(
      "preview-chamfer-trim-b",
      "Chamfer preview",
      corner.secondOther,
      secondTangent,
      second.entity.isConstruction,
    ),
    makePreviewLine(
      "preview-chamfer-line",
      "Chamfer preview",
      firstTangent,
      secondTangent,
      isConstruction,
    ),
  ]);
}

export function createSketchExtendMutation(input: {
  definition: SketchDefinition;
  entityIds: readonly SketchEntityId[];
  sequence: number;
  factories: SketchEditOperationFactories;
}): SketchEditOperationResult {
  if (input.entityIds.length !== 2) {
    return createInvalidOperationResult(
      "Sketch extend needs a target line and a boundary line.",
    );
  }

  const target = getLineDescriptorById(input.definition, input.entityIds[0]!);
  const boundary = getLineDescriptorById(input.definition, input.entityIds[1]!);
  if (!target || !boundary) {
    return createInvalidOperationResult(
      "Sketch extend currently supports a line extended to another line.",
    );
  }

  const intersection = infiniteLineIntersection({
    start: target.start,
    end: target.end,
    otherStart: boundary.start,
    otherEnd: boundary.end,
  });
  if (!intersection) {
    return createInvalidOperationResult(
      "Sketch extend needs non-parallel lines.",
    );
  }

  const targetVector = subtract(target.end, target.start);
  const targetLengthSquared = dot(targetVector, targetVector);
  const t =
    targetLengthSquared <= EPSILON
      ? 0
      : dot(subtract(intersection, target.start), targetVector) /
        targetLengthSquared;
  if (t >= -EPSILON && t <= 1 + EPSILON) {
    return createInvalidOperationResult(
      "Sketch extend needs an intersection outside the selected line.",
    );
  }

  const replaceStart = t < 0;
  const replacementPointId = input.factories.createPointId("extend-endpoint");
  const updatedTarget = {
    ...target.entity,
    startPointId: replaceStart
      ? replacementPointId
      : target.entity.startPointId,
    endPointId: replaceStart ? target.entity.endPointId : replacementPointId,
  };
  const definition = appendPointsAndEntities(
    updateDefinitionEntities(input.definition, [updatedTarget]),
    [
      input.factories.createPoint(
        `Extend ${input.sequence} endpoint`,
        replacementPointId,
        intersection,
      ),
    ],
    [],
  );

  return createMutationOperationResult(definition, [
    makePreviewLine(
      "preview-extend-line",
      "Extend preview",
      replaceStart ? intersection : target.start,
      replaceStart ? target.end : intersection,
      target.entity.isConstruction,
    ),
  ]);
}

export function createSketchSplitMutation(input: {
  definition: SketchDefinition;
  entityIds: readonly SketchEntityId[];
  sequence: number;
  factories: SketchEditOperationFactories;
}): SketchEditOperationResult {
  if (input.entityIds.length !== 2) {
    return createInvalidOperationResult(
      "Sketch split needs a target line and a crossing boundary line.",
    );
  }

  const target = getLineDescriptorById(input.definition, input.entityIds[0]!);
  const boundary = getLineDescriptorById(input.definition, input.entityIds[1]!);
  if (!target || !boundary) {
    return createInvalidOperationResult(
      "Sketch split currently supports a line split by another line.",
    );
  }

  const intersection = lineLineIntersection({
    start: target.start,
    end: target.end,
    otherStart: boundary.start,
    otherEnd: boundary.end,
  });
  if (
    !intersection ||
    intersection.t <= EPSILON ||
    intersection.t >= 1 - EPSILON
  ) {
    return createInvalidOperationResult(
      "Sketch split needs a boundary crossing inside the selected line.",
    );
  }

  const splitPointId = input.factories.createPointId("split-point");
  const splitEntityId = input.factories.createEntityId("split-line");
  const updatedTarget = {
    ...target.entity,
    endPointId: splitPointId,
  };
  const splitEntity = {
    ...input.factories.createLineEntity(
      `${target.entity.label} split`,
      splitEntityId,
      splitPointId,
      target.entity.endPointId,
    ),
    isConstruction: target.entity.isConstruction,
    style: target.entity.style,
  };
  const definition = appendPointsAndEntities(
    updateDefinitionEntities(input.definition, [updatedTarget]),
    [
      input.factories.createPoint(
        `Split ${input.sequence} point`,
        splitPointId,
        intersection.point,
      ),
    ],
    [splitEntity],
  );

  return createMutationOperationResult(definition, [
    makePreviewLine(
      "preview-split-a",
      "Split preview",
      target.start,
      intersection.point,
      target.entity.isConstruction,
    ),
    makePreviewLine(
      "preview-split-b",
      "Split preview",
      intersection.point,
      target.end,
      target.entity.isConstruction,
    ),
  ]);
}

function createContinuousLineOffsetContribution(input: {
  definition: SketchDefinition;
  entityIds: readonly SketchEntityId[];
  distance: number;
  side: OffsetSide;
  sequence: number;
  factories: Pick<
    SketchToolCommitFactories,
    "createPointId" | "createEntityId" | "createPoint" | "createLineEntity"
  >;
}): OffsetContributionResult {
  const chain = buildOrderedLineChain(input.definition, input.entityIds);
  if (!chain.valid) {
    return {
      valid: false,
      message: chain.message,
      contribution: null,
      previewEntities: [],
    };
  }

  const sideFactor = offsetSideFactorForChain(
    chain.ordered,
    chain.closed,
    input.side,
  );
  if (sideFactor === null) {
    return {
      valid: false,
      message: "Continuous offset needs a non-degenerate loop.",
      contribution: null,
      previewEntities: [],
    };
  }

  const offsetLines = chain.ordered.map((line) => {
    const offset = offsetLinePoints(
      line.start,
      line.end,
      input.distance * sideFactor,
    );
    return offset
      ? { ...line, offsetStart: offset.start, offsetEnd: offset.end }
      : null;
  });

  if (offsetLines.some((line) => line === null)) {
    return {
      valid: false,
      message: "Offset target is too short.",
      contribution: null,
      previewEntities: [],
    };
  }

  const lines = offsetLines as NonNullable<(typeof offsetLines)[number]>[];
  const joinedPoints: SketchPoint[] = [];

  if (chain.closed) {
    for (let index = 0; index < lines.length; index += 1) {
      const previous = lines[(index + lines.length - 1) % lines.length]!;
      const current = lines[index]!;
      joinedPoints.push(
        infiniteLineIntersection({
          start: previous.offsetStart,
          end: previous.offsetEnd,
          otherStart: current.offsetStart,
          otherEnd: current.offsetEnd,
        }) ?? averagePoint(previous.offsetEnd, current.offsetStart),
      );
    }
  } else {
    joinedPoints.push(lines[0]!.offsetStart);
    for (let index = 1; index < lines.length; index += 1) {
      const previous = lines[index - 1]!;
      const current = lines[index]!;
      joinedPoints.push(
        infiniteLineIntersection({
          start: previous.offsetStart,
          end: previous.offsetEnd,
          otherStart: current.offsetStart,
          otherEnd: current.offsetEnd,
        }) ?? averagePoint(previous.offsetEnd, current.offsetStart),
      );
    }
    joinedPoints.push(lines.at(-1)!.offsetEnd);
  }

  const pointIds = joinedPoints.map((_, index) =>
    input.factories.createPointId(`offset-chain-point-${index + 1}`),
  );
  const lineCount = chain.closed
    ? joinedPoints.length
    : joinedPoints.length - 1;
  const entityIds = Array.from({ length: lineCount }, (_, index) =>
    input.factories.createEntityId(`offset-chain-line-${index + 1}`),
  );

  return {
    valid: true,
    message: null,
    previewEntities: Array.from({ length: lineCount }, (_, index) => ({
      id: `preview-offset-chain-line-${index + 1}`,
      kind: "line" as const,
      start: joinedPoints[index]!,
      end: joinedPoints[(index + 1) % joinedPoints.length]!,
      entityId: null,
      status: "preview" as const,
      label: "Offset preview",
      isConstruction: lines[index % lines.length]!.entity.isConstruction,
    })),
    contribution: {
      points: joinedPoints.map((point, index) =>
        input.factories.createPoint(
          `Offset ${input.sequence} point ${index + 1}`,
          pointIds[index]!,
          point,
        ),
      ),
      entities: Array.from({ length: lineCount }, (_, index) => {
        const source = lines[index % lines.length]!.entity;
        return {
          ...input.factories.createLineEntity(
            `Offset ${input.sequence}.${index + 1}`,
            entityIds[index]!,
            pointIds[index]!,
            pointIds[(index + 1) % pointIds.length]!,
          ),
          isConstruction: source.isConstruction,
          style: source.style,
        };
      }),
    },
  };
}

function prefixFactories(
  factories: SketchEditOperationFactories,
  prefix: string,
): SketchEditOperationFactories {
  return {
    ...factories,
    createPointId: (suffix) => factories.createPointId(`${prefix}-${suffix}`),
    createEntityId: (suffix) => factories.createEntityId(`${prefix}-${suffix}`),
  };
}

function createLineSlotContribution(input: {
  curve: Extract<CurveDescriptor, { kind: "lineSegment" }>;
  width: number;
  sequence: number;
  factories: SketchEditOperationFactories;
}): SketchEditOperationResult {
  const halfWidth = input.width / 2;
  const leftOffset = offsetLinePoints(
    input.curve.start,
    input.curve.end,
    halfWidth,
  );
  const rightOffset = offsetLinePoints(
    input.curve.start,
    input.curve.end,
    -halfWidth,
  );
  if (!leftOffset || !rightOffset) {
    return createInvalidOperationResult("Slot reference is too short.");
  }

  const leftStart = leftOffset.start;
  const leftEnd = leftOffset.end;
  const rightEnd = rightOffset.end;
  const rightStart = rightOffset.start;
  const leftStartPointId = input.factories.createPointId("slot-left-start");
  const leftEndPointId = input.factories.createPointId("slot-left-end");
  const rightEndPointId = input.factories.createPointId("slot-right-end");
  const rightStartPointId = input.factories.createPointId("slot-right-start");
  const leftLineId = input.factories.createEntityId("slot-left-line");
  const endArcId = input.factories.createEntityId("slot-end-arc");
  const rightLineId = input.factories.createEntityId("slot-right-line");
  const startArcId = input.factories.createEntityId("slot-start-arc");
  const isConstruction = input.curve.isConstruction;
  const style = input.curve.style;
  const sides = [
    { name: "left", entityId: leftLineId },
    { name: "right", entityId: rightLineId },
  ];
  const relationships = [
    primitiveArcRelationships({
      factories: input.factories,
      idPrefix: "slot-end",
      label: `Slot ${input.sequence} end`,
      arc: {
        entityId: endArcId,
        startPointId: leftEndPointId,
        endPointId: rightEndPointId,
      },
      tangentLines: sides,
    }),
    primitiveArcRelationships({
      factories: input.factories,
      idPrefix: "slot-start",
      label: `Slot ${input.sequence} start`,
      arc: {
        entityId: startArcId,
        startPointId: rightStartPointId,
        endPointId: leftStartPointId,
      },
      tangentLines: sides,
    }),
  ];

  return createContributionOperationResult(
    {
      constraints: relationships.flatMap((item) => item.constraints),
      dimensions: relationships.flatMap((item) => item.dimensions),
      points: [
        input.factories.createPoint(
          `Slot ${input.sequence} left start`,
          leftStartPointId,
          leftStart,
        ),
        input.factories.createPoint(
          `Slot ${input.sequence} left end`,
          leftEndPointId,
          leftEnd,
        ),
        input.factories.createPoint(
          `Slot ${input.sequence} right end`,
          rightEndPointId,
          rightEnd,
        ),
        input.factories.createPoint(
          `Slot ${input.sequence} right start`,
          rightStartPointId,
          rightStart,
        ),
      ],
      entities: [
        {
          ...input.factories.createLineEntity(
            `Slot ${input.sequence} left`,
            leftLineId,
            leftStartPointId,
            leftEndPointId,
          ),
          isConstruction,
          style,
        },
        {
          ...input.factories.createArcEntity(
            `Slot ${input.sequence} end`,
            endArcId,
            input.curve.entity.endPointId,
            leftEndPointId,
            rightEndPointId,
            "clockwise",
          ),
          isConstruction,
          style,
        },
        {
          ...input.factories.createLineEntity(
            `Slot ${input.sequence} right`,
            rightLineId,
            rightEndPointId,
            rightStartPointId,
          ),
          isConstruction,
          style,
        },
        {
          ...input.factories.createArcEntity(
            `Slot ${input.sequence} start`,
            startArcId,
            input.curve.entity.startPointId,
            rightStartPointId,
            leftStartPointId,
            "clockwise",
          ),
          isConstruction,
          style,
        },
      ],
    },
    [
      makePreviewPolyline(
        "preview-slot-line",
        "Slot preview",
        [leftStart, leftEnd, rightEnd, rightStart],
        true,
        isConstruction,
      ),
    ],
  );
}

function createArcSlotContribution(input: {
  curve: Extract<CurveDescriptor, { kind: "arc" }>;
  width: number;
  sequence: number;
  factories: SketchEditOperationFactories;
}): SketchEditOperationResult {
  const baseRadius = distanceBetween(input.curve.center, input.curve.start);
  const halfWidth = input.width / 2;
  const innerRadius = baseRadius - halfWidth;
  const outerRadius = baseRadius + halfWidth;
  const outerStart =
    innerRadius > EPSILON
      ? scalePointFromCenter(input.curve.center, input.curve.start, outerRadius)
      : null;
  const outerEnd = scalePointFromCenter(
    input.curve.center,
    input.curve.end,
    outerRadius,
  );
  const innerStart = scalePointFromCenter(
    input.curve.center,
    input.curve.start,
    innerRadius,
  );
  const innerEnd = scalePointFromCenter(
    input.curve.center,
    input.curve.end,
    innerRadius,
  );

  if (!outerStart || !outerEnd || !innerStart || !innerEnd) {
    return createInvalidOperationResult(
      "Slot width would create an invalid arc slot.",
    );
  }
  const outerStartId = input.factories.createPointId("slot-outer-start");
  const outerEndId = input.factories.createPointId("slot-outer-end");
  const innerStartId = input.factories.createPointId("slot-inner-start");
  const innerEndId = input.factories.createPointId("slot-inner-end");
  const outerArcId = input.factories.createEntityId("slot-outer-arc");
  const innerArcId = input.factories.createEntityId("slot-inner-arc");
  const startCapId = input.factories.createEntityId("slot-start-cap");
  const endCapId = input.factories.createEntityId("slot-end-cap");
  const isConstruction = input.curve.isConstruction;
  const style = input.curve.style;
  // The caps are radial lines, so no arc here rounds a line: endpoint binding only.
  const relationships = [
    primitiveArcRelationships({
      factories: input.factories,
      idPrefix: "slot-outer",
      label: `Slot ${input.sequence} outer`,
      arc: {
        entityId: outerArcId,
        startPointId: outerStartId,
        endPointId: outerEndId,
      },
      tangentLines: [],
    }),
    primitiveArcRelationships({
      factories: input.factories,
      idPrefix: "slot-inner",
      label: `Slot ${input.sequence} inner`,
      arc: {
        entityId: innerArcId,
        startPointId: innerEndId,
        endPointId: innerStartId,
      },
      tangentLines: [],
    }),
  ];

  return createContributionOperationResult(
    {
      constraints: relationships.flatMap((item) => item.constraints),
      dimensions: relationships.flatMap((item) => item.dimensions),
      points: [
        input.factories.createPoint(
          `Slot ${input.sequence} outer start`,
          outerStartId,
          outerStart,
        ),
        input.factories.createPoint(
          `Slot ${input.sequence} outer end`,
          outerEndId,
          outerEnd,
        ),
        input.factories.createPoint(
          `Slot ${input.sequence} inner start`,
          innerStartId,
          innerStart,
        ),
        input.factories.createPoint(
          `Slot ${input.sequence} inner end`,
          innerEndId,
          innerEnd,
        ),
      ],
      entities: [
        {
          ...input.factories.createArcEntity(
            `Slot ${input.sequence} outer`,
            outerArcId,
            input.curve.entity.centerPointId,
            outerStartId,
            outerEndId,
            input.curve.sweepDirection,
          ),
          isConstruction,
          style,
        },
        {
          ...input.factories.createLineEntity(
            `Slot ${input.sequence} end cap`,
            endCapId,
            outerEndId,
            innerEndId,
          ),
          isConstruction,
          style,
        },
        {
          ...input.factories.createArcEntity(
            `Slot ${input.sequence} inner`,
            innerArcId,
            input.curve.entity.centerPointId,
            innerEndId,
            innerStartId,
            input.curve.sweepDirection === "counterClockwise"
              ? "clockwise"
              : "counterClockwise",
          ),
          isConstruction,
          style,
        },
        {
          ...input.factories.createLineEntity(
            `Slot ${input.sequence} start cap`,
            startCapId,
            innerStartId,
            outerStartId,
          ),
          isConstruction,
          style,
        },
      ],
    },
    [
      makePreviewSpline(
        "preview-slot-outer-arc",
        createArcPreview(input.curve, outerRadius),
        isConstruction,
      ),
      makePreviewSpline(
        "preview-slot-inner-arc",
        createArcPreview(input.curve, innerRadius),
        isConstruction,
      ),
      makePreviewLine(
        "preview-slot-start-cap",
        "Slot preview",
        innerStart,
        outerStart,
        isConstruction,
      ),
      makePreviewLine(
        "preview-slot-end-cap",
        "Slot preview",
        outerEnd,
        innerEnd,
        isConstruction,
      ),
    ],
  );
}

function createClosedLineSlotContribution(input: {
  definition: SketchDefinition;
  entityIds: readonly SketchEntityId[];
  width: number;
  sequence: number;
  factories: SketchEditOperationFactories;
}): SketchEditOperationResult {
  const chain = buildOrderedLineChain(input.definition, input.entityIds);
  if (!chain.valid) {
    return createInvalidOperationResult(chain.message);
  }

  if (!chain.closed) {
    return createInvalidOperationResult(
      "Slot multi-selection needs one closed line profile.",
    );
  }

  const halfWidth = input.width / 2;
  const outer = createContinuousLineOffsetContribution({
    definition: input.definition,
    entityIds: input.entityIds,
    distance: halfWidth,
    side: "left",
    sequence: input.sequence,
    factories: prefixFactories(input.factories, "slot-outer"),
  });
  const inner = createContinuousLineOffsetContribution({
    definition: input.definition,
    entityIds: input.entityIds,
    distance: halfWidth,
    side: "right",
    sequence: input.sequence,
    factories: prefixFactories(input.factories, "slot-inner"),
  });

  if (!outer.valid || !outer.contribution) {
    return createInvalidOperationResult(
      outer.message ?? "Slot could not offset the closed profile.",
    );
  }

  if (!inner.valid || !inner.contribution) {
    return createInvalidOperationResult(
      inner.message ?? "Slot could not offset the closed profile.",
    );
  }

  return createContributionOperationResult(
    {
      points: [...outer.contribution.points, ...inner.contribution.points],
      entities: [
        ...outer.contribution.entities,
        ...inner.contribution.entities,
      ],
    },
    [...outer.previewEntities, ...inner.previewEntities],
  );
}

export function createSketchSlotContribution(input: {
  definition: SketchDefinition;
  entityIds: readonly SketchEntityId[];
  width: number | null;
  sequence: number;
  factories: SketchEditOperationFactories;
}): SketchEditOperationResult {
  const entity =
    input.entityIds.length === 1
      ? input.definition.entities.find(
          (candidate) => candidate.entityId === input.entityIds[0],
        )
      : undefined;
  // T10h (D6, user decision Q2 = S1): there is no exact slot along a spline
  // yet, so it is refused before any width check.
  if (entity?.kind === "spline") {
    return createInvalidOperationResult(SPLINE_SLOT_UNSUPPORTED_MESSAGE);
  }

  if (input.width === null || input.width <= EPSILON) {
    return createInvalidOperationResult(
      "Slot width must be greater than zero.",
    );
  }

  if (input.entityIds.length === 0) {
    return createInvalidOperationResult(
      "Select a line, arc, or closed line profile for the slot.",
    );
  }

  if (input.entityIds.length > 1) {
    return createClosedLineSlotContribution({
      ...input,
      width: input.width,
    });
  }

  const curve = entity ? getCurveDescriptor(input.definition, entity) : null;
  if (!curve) {
    return createInvalidOperationResult(
      "Slot supports a line, arc, or closed line profile.",
    );
  }

  if (curve.kind === "lineSegment") {
    return createLineSlotContribution({
      curve,
      width: input.width,
      sequence: input.sequence,
      factories: input.factories,
    });
  }

  if (curve.kind === "arc") {
    return createArcSlotContribution({
      curve,
      width: input.width,
      sequence: input.sequence,
      factories: input.factories,
    });
  }

  return createInvalidOperationResult(
    "Slot supports a line, arc, or closed line profile.",
  );
}

/** T10h (D6, [TECH] T-10): a projected spline has no exact static offset. */
export const PROJECTED_SPLINE_OFFSET_UNSUPPORTED_MESSAGE =
  "Offsetting projected spline geometry is not supported yet; offset a sketch curve or use the projected line/arc/circle.";

/** T10h (D6, user decision Q2 = S1): a Slot along a spline. */
export const SPLINE_SLOT_UNSUPPORTED_MESSAGE =
  "Slot along a spline is not supported yet.";

/**
 * The static one-shot offset of one projected line, arc or circle (D6:
 * projected reference geometry cannot be a derivation master yet); a
 * projected spline is refused. Sketch entities are offset by
 * `createSketchOffsetDerivationContribution`.
 */
export function createOffsetContribution(input: {
  curve: OffsetCurveDescriptor;
  distance: number | null;
  side: OffsetSide;
  sequence: number;
  factories: Pick<
    SketchToolCommitFactories,
    | "createPointId"
    | "createEntityId"
    | "createPoint"
    | "createLineEntity"
    | "createCircleEntity"
    | "createArcEntity"
  >;
}): OffsetContributionResult {
  if (input.curve.kind === "spline") {
    return {
      valid: false,
      message: PROJECTED_SPLINE_OFFSET_UNSUPPORTED_MESSAGE,
      contribution: null,
      previewEntities: [],
    };
  }

  if (input.distance === null || input.distance <= EPSILON) {
    return {
      valid: false,
      message: "Offset distance must be greater than zero.",
      contribution: null,
      previewEntities: [],
    };
  }

  const curve = input.curve;
  const isConstruction = curve.isConstruction;
  const style = curve.style;

  if (curve.kind === "lineSegment") {
    const length = distanceBetween(curve.start, curve.end);
    if (length <= EPSILON) {
      return {
        valid: false,
        message: "Offset target is too short.",
        contribution: null,
        previewEntities: [],
      };
    }

    const sideFactor = input.side === "left" ? 1 : -1;
    const offset = offsetLinePoints(
      curve.start,
      curve.end,
      input.distance * sideFactor,
    );
    if (!offset) {
      return {
        valid: false,
        message: "Offset target is too short.",
        contribution: null,
        previewEntities: [],
      };
    }

    const offsetStart = offset.start;
    const offsetEnd = offset.end;
    const startPointId = input.factories.createPointId("offset-start");
    const endPointId = input.factories.createPointId("offset-end");
    const entityId = input.factories.createEntityId("offset-line");

    return {
      valid: true,
      message: null,
      previewEntities: [
        {
          id: "preview-offset-line",
          kind: "line",
          start: offsetStart,
          end: offsetEnd,
          entityId: null,
          status: "preview",
          label: "Offset preview",
          isConstruction,
        },
      ],
      contribution: {
        points: [
          input.factories.createPoint(
            `Offset ${input.sequence} start`,
            startPointId,
            offsetStart,
          ),
          input.factories.createPoint(
            `Offset ${input.sequence} end`,
            endPointId,
            offsetEnd,
          ),
        ],
        entities: [
          {
            ...input.factories.createLineEntity(
              `Offset ${input.sequence}`,
              entityId,
              startPointId,
              endPointId,
            ),
            isConstruction,
            style,
          },
        ],
      },
    };
  }

  if (curve.kind === "circle") {
    const sideFactor = input.side === "left" ? 1 : -1;
    const radius = curve.radius + input.distance * sideFactor;
    if (radius <= EPSILON) {
      return {
        valid: false,
        message: "Offset distance would create an invalid circle radius.",
        contribution: null,
        previewEntities: [],
      };
    }

    const centerPointId = input.factories.createPointId("offset-center");
    const entityId = input.factories.createEntityId("offset-circle");

    return {
      valid: true,
      message: null,
      previewEntities: [
        {
          id: "preview-offset-circle",
          kind: "circle",
          center: curve.center,
          radius,
          entityId: null,
          status: "preview",
          label: "Offset preview",
          isConstruction,
        },
      ],
      contribution: {
        points: [
          input.factories.createPoint(
            `Offset ${input.sequence} center`,
            centerPointId,
            curve.center,
          ),
        ],
        entities: [
          {
            ...input.factories.createCircleEntity(
              `Offset ${input.sequence}`,
              entityId,
              centerPointId,
              radius,
            ),
            isConstruction,
            style,
          },
        ],
      },
    };
  }

  // An arc: the spline was refused, the line and circle returned above.
  const sideFactor = input.side === "left" ? 1 : -1;
  const radius =
    distanceBetween(curve.center, curve.start) + input.distance * sideFactor;
  if (radius <= EPSILON) {
    return {
      valid: false,
      message: "Offset distance would create an invalid arc radius.",
      contribution: null,
      previewEntities: [],
    };
  }

  const offsetStart = scalePointFromCenter(curve.center, curve.start, radius);
  const offsetEnd = scalePointFromCenter(curve.center, curve.end, radius);
  if (!offsetStart || !offsetEnd) {
    return {
      valid: false,
      message: "Offset target has invalid arc geometry.",
      contribution: null,
      previewEntities: [],
    };
  }

  const centerPointId = input.factories.createPointId("offset-arc-center");
  const startPointId = input.factories.createPointId("offset-arc-start");
  const endPointId = input.factories.createPointId("offset-arc-end");
  const entityId = input.factories.createEntityId("offset-arc");

  return {
    valid: true,
    message: null,
    previewEntities: [
      makePreviewSpline(
        "preview-offset-arc",
        createArcPreview(curve, radius),
        isConstruction,
      ),
    ],
    contribution: {
      points: [
        input.factories.createPoint(
          `Offset ${input.sequence} center`,
          centerPointId,
          curve.center,
        ),
        input.factories.createPoint(
          `Offset ${input.sequence} start`,
          startPointId,
          offsetStart,
        ),
        input.factories.createPoint(
          `Offset ${input.sequence} end`,
          endPointId,
          offsetEnd,
        ),
      ],
      entities: [
        {
          ...input.factories.createArcEntity(
            `Offset ${input.sequence}`,
            entityId,
            centerPointId,
            startPointId,
            endPointId,
            curve.sweepDirection,
          ),
          isConstruction,
          style,
        },
      ],
    },
  };
}

function safeSuffix(value: string) {
  return value.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
}

/**
 * Authors a durable offset derivation from a declared (N2) seed chain ([TECH]
 * D3: every chain goes through the certified route). One action allocates
 * the relationship, the output entities, every driven point, each spline
 * seed's derived shell with its output span ids, and the plan's joint arcs
 * (C8), all from one certifier-free solve frame (`solveOffsetFrame`) at the
 * document modeling tolerance: an adjacency resolved by a trim or a declared
 * vertex is one shared driven point; an arc adjacency is a joint arc between
 * the neighbours' own ends ([TECH] G6, D2). A derived shell is never a seed
 * (U-G2). The relationship is certified later by publish (U-G3: Commit
 * waits for it).
 */
export function createSketchOffsetDerivationContribution(input: {
  definition: SketchDefinition;
  entityIds: readonly SketchEntityId[];
  distance: number | null;
  side: OffsetSide;
  sequence: number;
  factories: SketchEditOperationFactories;
  /** The document's settings.modelingTolerance ([TECH] G12). */
  modelingTolerance: number;
  /** A `planChanged` hint of the preview's publication (G3), passed unchanged. */
  plan?: OffsetFramePlan;
}): SketchEditOperationResult {
  if (input.entityIds.length === 0) {
    return createInvalidOperationResult(
      "Select a connected chain of entities to offset.",
    );
  }

  if (input.distance === null || input.distance <= EPSILON) {
    return createInvalidOperationResult(
      "Offset distance must be greater than zero.",
    );
  }

  const entitiesById = new Map(
    input.definition.entities.map((entity) => [entity.entityId, entity]),
  );
  for (const entityId of input.entityIds) {
    const entity = entitiesById.get(entityId);
    if (entity?.kind === "derivedPiecewiseCubic") {
      return createInvalidOperationResult(
        "An offset spline curve cannot be offset again yet.",
      );
    }
    if (
      !entity ||
      (entity.kind !== "lineSegment" &&
        entity.kind !== "arc" &&
        entity.kind !== "circle" &&
        entity.kind !== "spline")
    ) {
      return createInvalidOperationResult(
        "Offset supports line, circle, arc, and spline entities.",
      );
    }
  }

  const connectivity = extractDeclaredOffsetChainConnectivity({
    definition: input.definition,
    seedIds: input.entityIds,
  });
  if (!connectivity.ok) {
    return createInvalidOperationResult(connectivity.message);
  }

  const signedDistance =
    input.side === "left" ? input.distance : -input.distance;
  const derivationId = `sketch_derivation_${input.sequence}_offset_${crypto.randomUUID()}`;
  const seedEntityIds = connectivity.pieces.map((piece) => piece.seedEntityId);
  const frame = solveOffsetFrame(
    {
      relationship: { derivationId, seedEntityIds, distance: signedDistance },
      definition: input.definition,
      modelingTolerance: input.modelingTolerance,
    },
    input.plan,
  );
  if (!frame.ok) {
    return createInvalidOperationResult(frame.failure.message);
  }

  const { pieces } = frame;
  const count = pieces.length;
  const closed = frame.connectivity.closed;
  const plan = frame.plan.adjacencies;
  const trims = new Map(frame.trims.map((trim) => [trim.jointIndex, trim]));
  const arcs = new Map(frame.arcs.map((arc) => [arc.jointIndex, arc]));
  const points: SketchPointDefinition[] = [];
  const entities: SketchEntityDefinition[] = [];
  const outputs: SketchDerivedEntityOutput[] = [];
  const piecewiseCubicOutputs: SketchOffsetPiecewiseCubicOutput[] = [];
  const jointOutputs: SketchOffsetJointOutput[] = [];
  const createPoint = (role: string, label: string, position: SketchPoint) => {
    const pointId = input.factories.createPointId(role);
    points.push(
      input.factories.createPoint(
        `Offset ${input.sequence} ${label}`,
        pointId,
        position,
      ),
    );
    return pointId;
  };
  const naturalEnds = (index: number) => {
    const piece = pieces[index]!;
    if (piece.kind === "derivedCubic") {
      const leaves = frame.cubics.get(piece.seedEntityId)!;
      return {
        start: leaves[0]!.span.poles[0],
        end: leaves.at(-1)!.span.poles[3],
      };
    }
    if (piece.kind === "circle") return null;
    return frame.lineArcEndpoints.get(piece.seedEntityId)!;
  };
  const traversalEnd = (index: number, end: "entry" | "exit") => {
    const ends = naturalEnds(index)!;
    return (end === "exit") !== pieces[index]!.reversed ? ends.end : ends.start;
  };

  // Traversal entry/exit point of every piece.
  const entryIds: (SketchPointId | null)[] = pieces.map(() => null);
  const exitIds: (SketchPointId | null)[] = pieces.map(() => null);
  for (const [joint, entry] of plan.entries()) {
    const next = (joint + 1) % count;
    if (entry.kind === "arc") {
      const arc = arcs.get(joint)!;
      const first = pieces[joint]!.seedEntityId;
      const second = pieces[next]!.seedEntityId;
      const suffix = `${safeSuffix(first)}-${safeSuffix(second)}`;
      const startPointId = createPoint(
        `offset-joint-start-${suffix}`,
        "joint start",
        arc.start,
      );
      const endPointId = createPoint(
        `offset-joint-end-${suffix}`,
        "joint end",
        arc.end,
      );
      const centerPointId = createPoint(
        `offset-joint-${suffix}`,
        "joint center",
        arc.center,
      );
      exitIds[joint] = startPointId;
      entryIds[next] = endPointId;
      const outputEntityId = input.factories.createEntityId(
        `offset-joint-${suffix}`,
      );
      const firstSeed = entitiesById.get(first)!;
      entities.push({
        ...input.factories.createArcEntity(
          `Offset ${input.sequence} joint`,
          outputEntityId,
          centerPointId,
          startPointId,
          endPointId,
          arc.sweepDirection,
        ),
        isConstruction: firstSeed.isConstruction,
        style: firstSeed.style,
      });
      jointOutputs.push({
        firstSeedEntityId: first,
        secondSeedEntityId: second,
        outputEntityId,
        centerPointId,
        startPointId,
        endPointId,
      });
      continue;
    }
    const position =
      entry.kind === "trim"
        ? trims.get(joint)!.position
        : traversalEnd(joint, "exit");
    const pointId = createPoint(
      `offset-corner-${joint + 1}`,
      `corner ${joint + 1}`,
      position,
    );
    exitIds[joint] = pointId;
    entryIds[next] = pointId;
  }
  if (!closed && count > 0 && pieces[0]!.kind !== "circle") {
    entryIds[0] = createPoint(
      "offset-start",
      "start",
      traversalEnd(0, "entry"),
    );
    exitIds[count - 1] = createPoint(
      "offset-end",
      "end",
      traversalEnd(count - 1, "exit"),
    );
  }

  for (const [index, piece] of pieces.entries()) {
    const seed = entitiesById.get(piece.seedEntityId)!;
    const suffix = safeSuffix(piece.seedEntityId);
    const label = `${seed.label} offset`;
    const outputEntityId = input.factories.createEntityId(`offset-${suffix}`);
    const naturalStart = piece.reversed ? exitIds[index] : entryIds[index];
    const naturalEnd = piece.reversed ? entryIds[index] : exitIds[index];
    if (piece.kind === "circle") {
      const centerPointId = createPoint(
        `offset-${suffix}-center`,
        `${seed.label} center`,
        piece.center,
      );
      entities.push({
        ...input.factories.createCircleEntity(
          label,
          outputEntityId,
          centerPointId,
          piece.radius,
        ),
        isConstruction: seed.isConstruction,
        style: seed.style,
      });
      outputs.push({
        seedEntityId: piece.seedEntityId,
        outputEntityId,
        instanceIndex: 1,
        seedPointIds: getPointIdsForSupportedDerivedEntity(seed) ?? [],
        outputPointIds: [centerPointId],
      });
      continue;
    }
    // A closed single-piece chain (a closed spline) uses one point for both
    // ends: its seam (smooth) or its positional closure vertex.
    const startPointId =
      naturalStart ??
      naturalEnd ??
      createPoint(
        `offset-${suffix}-start`,
        `${seed.label} start`,
        naturalEnds(index)!.start,
      );
    const endPointId = naturalEnd ?? startPointId;
    if (piece.kind === "derivedCubic") {
      if (seed.kind !== "spline") {
        return createInvalidOperationResult(
          "Offset spline seed changed while authoring.",
        );
      }
      const pairs = splineSourceSpanPairs(seed) ?? [];
      entities.push({
        kind: "derivedPiecewiseCubic",
        entityId: outputEntityId,
        label,
        target: {
          kind: "sketchEntity",
          sketchId: seed.target.sketchId,
          entityId: outputEntityId,
        },
        isConstruction: seed.isConstruction,
        derivationId,
        ...(seed.style ? { style: seed.style } : {}),
      });
      piecewiseCubicOutputs.push({
        seedEntityId: piece.seedEntityId,
        outputEntityId,
        startPointId,
        endPointId,
        spans: pairs.map((pair) => ({
          outputSpanId: `${pair.start}>${pair.end}`,
          sourceStartOccurrenceId: pair.start,
          sourceEndOccurrenceId: pair.end,
        })),
      });
      continue;
    }
    if (piece.kind === "lineSegment") {
      entities.push({
        ...input.factories.createLineEntity(
          label,
          outputEntityId,
          startPointId,
          endPointId,
        ),
        isConstruction: seed.isConstruction,
        style: seed.style,
      });
      outputs.push({
        seedEntityId: piece.seedEntityId,
        outputEntityId,
        instanceIndex: 1,
        seedPointIds: getPointIdsForSupportedDerivedEntity(seed) ?? [],
        outputPointIds: [startPointId, endPointId],
      });
      continue;
    }
    const centerPointId = createPoint(
      `offset-${suffix}-center`,
      `${seed.label} center`,
      piece.center,
    );
    entities.push({
      ...input.factories.createArcEntity(
        label,
        outputEntityId,
        centerPointId,
        startPointId,
        endPointId,
        piece.sweepDirection,
      ),
      isConstruction: seed.isConstruction,
      style: seed.style,
    });
    outputs.push({
      seedEntityId: piece.seedEntityId,
      outputEntityId,
      instanceIndex: 1,
      seedPointIds: getPointIdsForSupportedDerivedEntity(seed) ?? [],
      outputPointIds: [centerPointId, startPointId, endPointId],
    });
  }

  const relationship: Extract<SketchDerivationDefinition, { kind: "offset" }> =
    {
      derivationId,
      label: `offset ${input.sequence}`,
      kind: "offset",
      seedEntityIds,
      distance: signedDistance,
      jointPolicy: "trimExtendArcFallback",
      outputs,
      jointOutputs,
      piecewiseCubicOutputs,
    };
  // The authored records must be exactly the frame's outputs (C8).
  const kinds = new Map([
    ...input.definition.entities.map(
      (entity) => [entity.entityId, entity.kind] as const,
    ),
    ...entities.map((entity) => [entity.entityId, entity.kind] as const),
  ]);
  const mapped = mapOffsetFrameOutputs(relationship, frame, (entityId) =>
    kinds.get(entityId),
  );
  if (typeof mapped === "string") {
    return createInvalidOperationResult(
      `Offset outputs could not be authored: ${mapped}`,
    );
  }
  const contribution: SketchToolCommitContribution = {
    points,
    entities,
    derivedRelationships: [relationship],
  };

  return {
    valid: true,
    message: null,
    definition: null,
    contribution,
    previewEntities: createPreviewEntitiesFromContribution(
      input.definition,
      contribution,
      { modelingTolerance: input.modelingTolerance },
    ),
  };
}

/**
 * [TECH] G9: the side of `point` relative to the declared (N2) traversal of
 * the selected chain, on the exact source curves: the closest source point
 * (a line's projection, a circle's radial point, an arc's radial point when
 * it lies in the arc's sweep and otherwise its nearer end, the spline
 * reconstruction's closest span location) and the traversal tangent there.
 * `left` is a positive relationship distance (left of the traversal). Null
 * when the chain is not declared or the point lies on it.
 */
export function offsetSideForSketchPoint(input: {
  definition: SketchDefinition;
  entityIds: readonly SketchEntityId[];
  point: SketchPoint;
}): OffsetSide | null {
  const connectivity = extractDeclaredOffsetChainConnectivity({
    definition: input.definition,
    seedIds: input.entityIds,
  });
  if (!connectivity.ok) return null;
  const positions = new Map(
    input.definition.points.map((point) => [point.pointId, point.position]),
  );
  const entities = new Map(
    input.definition.entities.map((entity) => [entity.entityId, entity]),
  );
  let best: { distance: number; side: number } | null = null;
  const consider = (
    closest: SketchPoint,
    tangent: SketchPoint,
    reversed: boolean,
  ) => {
    const dx = input.point[0] - closest[0];
    const dy = input.point[1] - closest[1];
    const distance = Math.hypot(dx, dy);
    const side = (reversed ? -1 : 1) * (tangent[0] * dy - tangent[1] * dx);
    if (!best || distance < best.distance) best = { distance, side };
  };
  for (const { seedEntityId, reversed } of connectivity.pieces) {
    const entity = entities.get(seedEntityId);
    if (entity?.kind === "lineSegment") {
      const start = positions.get(entity.startPointId);
      const end = positions.get(entity.endPointId);
      if (!start || !end) return null;
      const direction: SketchPoint = [end[0] - start[0], end[1] - start[1]];
      const lengthSquared = direction[0] ** 2 + direction[1] ** 2;
      if (lengthSquared === 0) return null;
      const t = Math.min(
        1,
        Math.max(
          0,
          ((input.point[0] - start[0]) * direction[0] +
            (input.point[1] - start[1]) * direction[1]) /
            lengthSquared,
        ),
      );
      consider(
        [start[0] + t * direction[0], start[1] + t * direction[1]],
        direction,
        reversed,
      );
    } else if (entity?.kind === "arc" || entity?.kind === "circle") {
      const center = positions.get(entity.centerPointId);
      if (!center) return null;
      const radius =
        entity.kind === "circle"
          ? entity.radius
          : canonicalArcSupport(
              center,
              positions.get(entity.startPointId) ?? center,
              positions.get(entity.endPointId) ?? center,
              entity.sweepDirection,
            ).radius;
      const dx = input.point[0] - center[0];
      const dy = input.point[1] - center[1];
      const length = Math.hypot(dx, dy);
      if (length === 0 || !(radius > 0)) return null;
      const sense =
        entity.kind === "arc" && entity.sweepDirection === "clockwise" ? -1 : 1;
      // The arc's own natural sweep tangent at a support point of unit
      // direction u (a circle traverses counter-clockwise, the frame's F11
      // convention).
      const onSupport = (ux: number, uy: number) =>
        consider(
          [center[0] + ux * radius, center[1] + uy * radius],
          [-sense * uy, sense * ux],
          reversed,
        );
      if (entity.kind === "circle") {
        onSupport(dx / length, dy / length);
        continue;
      }
      const start = positions.get(entity.startPointId);
      const end = positions.get(entity.endPointId);
      if (!start || !end) return null;
      const angleOf = (point: SketchPoint) =>
        Math.atan2(point[1] - center[1], point[0] - center[0]);
      const fromStart = (angle: number) => {
        const turn = (sense * (angle - angleOf(start))) % (2 * Math.PI);
        return turn < 0 ? turn + 2 * Math.PI : turn;
      };
      const sweep = fromStart(angleOf(end)) || 2 * Math.PI;
      if (fromStart(Math.atan2(dy, dx)) <= sweep) {
        onSupport(dx / length, dy / length);
        continue;
      }
      // Off the sweep: the closest arc point is its nearer end.
      const nearer =
        Math.hypot(input.point[0] - start[0], input.point[1] - start[1]) <=
        Math.hypot(input.point[0] - end[0], input.point[1] - end[1])
          ? start
          : end;
      const endAngle = angleOf(nearer);
      onSupport(Math.cos(endAngle), Math.sin(endAngle));
    } else if (entity?.kind === "spline") {
      const geometry = reconstructSplineAggregate(
        entity,
        Object.fromEntries(positions) as Record<SketchPointId, SketchPoint>,
      );
      if (geometry.validity !== "valid") return null;
      const hit = closestSplineSpanLocation(input.point, geometry.spans);
      if (!hit) return null;
      const evaluated = evaluateSplineSpan(geometry.spans[hit.spanIndex]!, {
        kind: "local",
        value: hit.u,
      });
      consider(evaluated.position, evaluated.first, reversed);
    } else {
      return null;
    }
  }
  const found = best as { distance: number; side: number } | null;
  if (!found || found.side === 0) return null;
  return found.side > 0 ? "left" : "right";
}

function getPointIdsForSupportedDerivedEntity(
  entity: SketchEntityDefinition,
): readonly SketchPointId[] | null {
  switch (entity.kind) {
    case "lineSegment":
      return [entity.startPointId, entity.endPointId];
    case "point":
      return [entity.pointId];
    case "circle":
      return [entity.centerPointId];
    case "arc":
      return [entity.centerPointId, entity.startPointId, entity.endPointId];
    case "spline":
      return orderedSplinePointIds(entity);
    case "ellipse":
    case "ellipticalArc":
    case "conic":
    case "bezierCurve":
    case "profileText":
    case "derivedPiecewiseCubic":
      return null;
  }
}

function createDerivedEntity(
  entity: SketchEntityDefinition,
  outputEntityId: SketchEntityId,
  outputPointIds: readonly SketchPointId[],
  factories: SketchEditOperationFactories,
): SketchEntityDefinition | null {
  if (entity.kind === "lineSegment") {
    return {
      ...factories.createLineEntity(
        entity.label,
        outputEntityId,
        outputPointIds[0]!,
        outputPointIds[1]!,
      ),
      isConstruction: entity.isConstruction,
      style: entity.style,
    };
  }

  if (entity.kind === "point") {
    return {
      ...factories.createPointEntity(
        entity.label,
        outputEntityId,
        outputPointIds[0]!,
      ),
      isConstruction: entity.isConstruction,
      style: entity.style,
    };
  }

  if (entity.kind === "circle") {
    return {
      ...factories.createCircleEntity(
        entity.label,
        outputEntityId,
        outputPointIds[0]!,
        entity.radius,
      ),
      isConstruction: entity.isConstruction,
      style: entity.style,
    };
  }

  if (entity.kind === "arc") {
    return {
      ...factories.createArcEntity(
        entity.label,
        outputEntityId,
        outputPointIds[0]!,
        outputPointIds[1]!,
        outputPointIds[2]!,
        entity.sweepDirection,
      ),
      isConstruction: entity.isConstruction,
      style: entity.style,
    };
  }

  if (entity.kind === "spline") {
    const created = factories.createSplineEntity(
      entity.label,
      outputEntityId,
      outputPointIds,
    );
    if (created.kind !== "spline") {
      return null;
    }
    const sourceOccurrences = orderedSplineOccurrences(entity);
    const outputOccurrences = orderedSplineOccurrences(created);
    if (
      !sourceOccurrences ||
      !outputOccurrences ||
      sourceOccurrences.length !== outputOccurrences.length
    ) {
      return null;
    }
    return {
      ...created,
      isConstruction: entity.isConstruction,
      style: entity.style,
      closure: entity.closure,
      interpolationPolicy: entity.interpolationPolicy,
      pointOccurrences: outputOccurrences.map((occurrence, index) => ({
        ...occurrence,
        tangent: sourceOccurrences[index]!.tangent,
      })),
    };
  }

  return null;
}

function appendDerivedContribution(
  definition: SketchDefinition,
  contribution: SketchToolCommitContribution,
): SketchDefinition {
  return {
    ...definition,
    pointIds: [
      ...definition.pointIds,
      ...contribution.points.map((point) => point.pointId),
    ],
    points: [...definition.points, ...contribution.points],
    entityIds: [
      ...definition.entityIds,
      ...contribution.entities.map((entity) => entity.entityId),
    ],
    entities: [...definition.entities, ...contribution.entities],
    derivedRelationships: [
      ...(definition.derivedRelationships ?? []),
      ...(contribution.derivedRelationships ?? []),
    ],
  };
}

function createPreviewEntitiesFromContribution(
  definition: SketchDefinition,
  contribution: SketchToolCommitContribution,
  derivation: SketchDerivationSettings,
): readonly SketchDraftEntity[] {
  const outputEntityIds = new Set(
    contribution.entities.map((entity) => entity.entityId),
  );
  const evaluated = evaluateSketchDerivations({
    definition: appendDerivedContribution(definition, contribution),
    ...derivation,
  }).definition;
  const pointById = new Map(
    evaluated.points.map((point) => [point.pointId, point.position] as const),
  );

  return evaluated.entities
    .filter((entity) => outputEntityIds.has(entity.entityId))
    .flatMap((entity): SketchDraftEntity[] => {
      if (entity.kind === "lineSegment") {
        const start = pointById.get(entity.startPointId);
        const end = pointById.get(entity.endPointId);
        return start && end
          ? [
              {
                id: `preview-${entity.entityId}`,
                kind: "line",
                start,
                end,
                entityId: null,
                status: "preview",
                label: entity.label,
                isConstruction: entity.isConstruction,
              },
            ]
          : [];
      }

      if (entity.kind === "circle") {
        const center = pointById.get(entity.centerPointId);
        return center
          ? [
              {
                id: `preview-${entity.entityId}`,
                kind: "circle",
                center,
                radius: entity.radius,
                entityId: null,
                status: "preview",
                label: entity.label,
                isConstruction: entity.isConstruction,
              },
            ]
          : [];
      }

      if (entity.kind === "arc") {
        const center = pointById.get(entity.centerPointId);
        const start = pointById.get(entity.startPointId);
        const end = pointById.get(entity.endPointId);
        return center && start && end
          ? [
              makePreviewSpline(
                `preview-${entity.entityId}`,
                sampleArcPreview(center, start, end, entity.sweepDirection),
                entity.isConstruction,
              ),
            ]
          : [];
      }

      if (entity.kind === "spline") {
        const pointIds = orderedSplinePointIds(entity);
        const points = pointIds.flatMap((pointId) => {
          const point = pointById.get(pointId);
          return point ? [point] : [];
        });
        return points.length === pointIds.length
          ? [
              makePreviewSpline(
                `preview-${entity.entityId}`,
                points,
                entity.isConstruction,
              ),
            ]
          : [];
      }

      if (entity.kind === "point") {
        const point = pointById.get(entity.pointId);
        return point
          ? [
              {
                id: `preview-${entity.entityId}`,
                kind: "circle",
                center: point,
                radius: 0.1,
                entityId: null,
                status: "preview",
                label: entity.label,
                isConstruction: entity.isConstruction,
              },
            ]
          : [];
      }

      return [];
    });
}

function sampleArcPreview(
  center: SketchPoint,
  start: SketchPoint,
  end: SketchPoint,
  sweepDirection: "clockwise" | "counterClockwise",
): readonly SketchPoint[] {
  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0]);
  const endAngle = Math.atan2(end[1] - center[1], end[0] - center[0]);
  const fullTurn = Math.PI * 2;
  const normalizedStart = ((startAngle % fullTurn) + fullTurn) % fullTurn;
  const normalizedEnd = ((endAngle % fullTurn) + fullTurn) % fullTurn;
  const sweep =
    sweepDirection === "counterClockwise"
      ? normalizedEnd >= normalizedStart
        ? normalizedEnd - normalizedStart
        : normalizedEnd + fullTurn - normalizedStart
      : normalizedEnd <= normalizedStart
        ? normalizedStart - normalizedEnd
        : normalizedStart + fullTurn - normalizedEnd;
  const radius = distanceBetween(center, start);

  return Array.from({ length: 33 }, (_, index) => {
    const t = index / 32;
    const angle =
      sweepDirection === "counterClockwise"
        ? normalizedStart + sweep * t
        : normalizedStart - sweep * t;
    return [
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius,
    ] as const;
  });
}

function getDerivedOperatorSeeds(
  input: SketchDerivedTransformContributionInput,
) {
  if (input.operatorKind !== "mirror") {
    return {
      seedEntityIds: [...input.entityIds],
      mirrorAxisId: null,
    };
  }

  return {
    seedEntityIds: input.entityIds.slice(0, -1),
    mirrorAxisId: input.entityIds.at(-1) ?? null,
  };
}

function createRelationship(
  input: SketchDerivedTransformContributionInput,
  seedEntityIds: readonly SketchEntityId[],
  outputs: SketchDerivationDefinition["outputs"],
  mirrorAxisId: SketchEntityId | null,
): SketchDerivationDefinition | null {
  const derivationId =
    `sketch_derivation_${input.sequence}_${input.operatorKind}_${crypto.randomUUID()}` as const;
  const label = `${input.operatorKind} ${input.sequence}`;

  if (input.operatorKind === "mirror") {
    return mirrorAxisId
      ? {
          derivationId,
          label,
          kind: "mirror",
          seedEntityIds,
          mirrorReference: { kind: "lineEntity", entityId: mirrorAxisId },
          outputs,
        }
      : null;
  }

  if (input.operatorKind === "linearPattern") {
    const spacing = input.value && input.value > 0 ? input.value : 1;
    return {
      derivationId,
      label,
      kind: "linearPattern",
      seedEntityIds,
      vector: [spacing, 0],
      instanceCount: 2,
      outputs,
    };
  }

  if (input.operatorKind === "circularPattern") {
    return {
      derivationId,
      label,
      kind: "circularPattern",
      seedEntityIds,
      center: [0, 0],
      angleRadians: input.value && input.value > 0 ? input.value : Math.PI / 2,
      instanceCount: 2,
      outputs,
    };
  }

  const distance = input.value && input.value > 0 ? input.value : 1;
  return {
    derivationId,
    label,
    kind: "transform",
    seedEntityIds,
    origin: [0, 0],
    translation: [distance, 0],
    rotationRadians: 0,
    scale: 1,
    outputs,
  };
}

export function createSketchDerivedTransformContribution(
  input: SketchDerivedTransformContributionInput,
): SketchEditOperationResult {
  const { seedEntityIds, mirrorAxisId } = getDerivedOperatorSeeds(input);
  if (seedEntityIds.length === 0) {
    return {
      valid: false,
      message:
        input.operatorKind === "mirror"
          ? "Select seed sketch entities, then a mirror axis line."
          : "Select sketch entities to derive.",
      definition: null,
      contribution: null,
      previewEntities: [],
    };
  }

  if (input.operatorKind === "mirror") {
    const axis = mirrorAxisId
      ? input.definition.entities.find(
          (entity) => entity.entityId === mirrorAxisId,
        )
      : null;
    if (!axis || axis.kind !== "lineSegment") {
      return {
        valid: false,
        message:
          "Sketch mirror needs a line segment as the final selected mirror axis.",
        definition: null,
        contribution: null,
        previewEntities: [],
      };
    }
  }

  const pointsById = new Map(
    input.definition.points.map((point) => [point.pointId, point] as const),
  );
  const pointIdBySeedAndInstance = new Map<string, SketchPointId>();
  const points: SketchPointDefinition[] = [];
  const entities: SketchEntityDefinition[] = [];
  const outputs: SketchDerivedEntityOutput[] = [];

  for (const seedEntityId of seedEntityIds) {
    const seed =
      input.definition.entities.find(
        (entity) => entity.entityId === seedEntityId,
      ) ?? null;
    if (seed?.kind === "derivedPiecewiseCubic") {
      // U-G2: rejected before any mutation.
      return {
        valid: false,
        message:
          "An offset spline curve cannot be mirrored, patterned or transformed yet.",
        definition: null,
        contribution: null,
        previewEntities: [],
      };
    }
    const seedPointIds = seed
      ? getPointIdsForSupportedDerivedEntity(seed)
      : null;
    if (!seed || !seedPointIds) {
      return {
        valid: false,
        message:
          "Derived sketch operators currently support points, lines, circles, arcs, and splines.",
        definition: null,
        contribution: null,
        previewEntities: [],
      };
    }

    const outputPointIds = seedPointIds.map((seedPointId) => {
      const key = `${seedPointId}:1`;
      const existing = pointIdBySeedAndInstance.get(key);
      if (existing) {
        return existing;
      }

      const seedPoint = pointsById.get(seedPointId);
      const outputPointId = input.factories.createPointId(
        `${input.operatorKind}-${safeSuffix(seedPointId)}`,
      );
      pointIdBySeedAndInstance.set(key, outputPointId);
      points.push(
        input.factories.createPoint(
          `${input.operatorKind} ${seedPoint?.label ?? seedPointId}`,
          outputPointId,
          seedPoint?.position ?? [0, 0],
        ),
      );
      return outputPointId;
    });
    const outputEntityId = input.factories.createEntityId(
      `${input.operatorKind}-${safeSuffix(seedEntityId)}`,
    );
    const entity = createDerivedEntity(
      seed,
      outputEntityId,
      outputPointIds,
      input.factories,
    );
    if (!entity) {
      return {
        valid: false,
        message:
          "Derived sketch operator could not create supported output geometry.",
        definition: null,
        contribution: null,
        previewEntities: [],
      };
    }

    entities.push({
      ...entity,
      label: `${seed.label} ${input.operatorKind}`,
    });
    outputs.push({
      seedEntityId,
      outputEntityId,
      instanceIndex: 1,
      seedPointIds,
      outputPointIds,
    });
  }

  const relationship = createRelationship(
    input,
    seedEntityIds,
    outputs,
    mirrorAxisId,
  );
  if (!relationship) {
    return {
      valid: false,
      message:
        "Derived sketch operator is missing required relationship references.",
      definition: null,
      contribution: null,
      previewEntities: [],
    };
  }

  const contribution: SketchToolCommitContribution = {
    points,
    entities,
    derivedRelationships: [relationship],
  };
  const evaluated = evaluateSketchDerivations({
    definition: appendDerivedContribution(input.definition, contribution),
    modelingTolerance: input.modelingTolerance,
  }).definition;
  const outputPointIds = new Set(points.map((point) => point.pointId));
  const outputEntityIds = new Set(entities.map((entity) => entity.entityId));
  const evaluatedContribution: SketchToolCommitContribution = {
    points: evaluated.points.filter((point) =>
      outputPointIds.has(point.pointId),
    ),
    entities: evaluated.entities.filter((entity) =>
      outputEntityIds.has(entity.entityId),
    ),
    derivedRelationships: [relationship],
  };

  return {
    valid: true,
    message: null,
    definition: null,
    contribution: evaluatedContribution,
    previewEntities: createPreviewEntitiesFromContribution(
      input.definition,
      evaluatedContribution,
      { modelingTolerance: input.modelingTolerance },
    ),
  };
}
