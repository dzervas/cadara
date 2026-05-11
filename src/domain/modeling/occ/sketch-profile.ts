import type {
  RegionRecord,
  RegionBoundarySegmentRecord,
  SolvedSketchEntityGeometryRecord,
  SketchRecord,
  SketchPoint2D,
} from "@/contracts/sketch/schema";
import type {
  ProjectedSketchReferenceGeometry,
  ProjectedSketchReferenceRecord,
} from "@/contracts/solver/schema";
import type { FaceId, ReferenceId } from "@/contracts/shared/ids";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import { buildConstructionPlaneFromPlanarFace as buildConstructionPlaneFromPlanarFaceFromPlaneUtility } from "@/domain/modeling/occ/planes";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import {
  extractPlanarFaceData,
  mapSketchPointToWorld,
  midpointOnArc,
  negate,
  toGpDir,
  toGpPnt,
  toVec3FromGpPoint,
  type Vec3,
} from "@/domain/modeling/occ/geometry";
import {
  createProjectedRegionLoopRejection,
  getProjectedRegionLoopRejectionMessage,
  isProjectedRegionSegmentSourceSupported,
} from "@/domain/modeling/occ/implementation-policy";
import { getClosedCurveSampleCount } from "@/contracts/sketch/region-geometry";
import { deleteOccObject } from "@/domain/modeling/occ/memory";

export interface BuiltSketchProfileFace {
  face: InstanceType<OpenCascadeInstance["TopoDS_Face"]>;
  plane: SketchPlaneDefinition;
  normal: Vec3;
}

const PROFILE_LOOP_TOLERANCE = 1e-6;

interface OpenBoundarySegmentGeometry {
  kind: "open";
  segmentId: string;
  start: Vec3;
  end: Vec3;
}

interface ClosedBoundarySegmentGeometry {
  kind: "closed";
  segmentId: string;
}

interface ClosedPolylineBoundarySegmentGeometry {
  kind: "closedPolyline";
  segmentId: string;
  points: Vec3[];
}

type BoundarySegmentGeometry =
  | OpenBoundarySegmentGeometry
  | ClosedBoundarySegmentGeometry
  | ClosedPolylineBoundarySegmentGeometry;

const PROFILE_TEXT_WIDTH_FACTOR = 0.6;

function getSolvedEntityGeometry(
  sketch: SketchRecord,
  entityId: string,
): SolvedSketchEntityGeometryRecord {
  const geometry = sketch.solvedSnapshot.solvedEntities.find(
    (entry) => entry.entityId === entityId,
  );

  if (!geometry) {
    throw new Error(
      `Sketch entity ${entityId} does not resolve in solved geometry.`,
    );
  }

  return geometry;
}

function getSketchEntityDefinition(sketch: SketchRecord, entityId: string) {
  const entity = sketch.definition.entities.find(
    (entry) => entry.entityId === entityId,
  );

  if (!entity) {
    throw new Error(
      `Sketch entity ${entityId} is not authored on sketch ${sketch.sketchId}.`,
    );
  }

  return entity;
}

function assertRegionBelongsToSketch(
  sketch: SketchRecord,
  region: RegionRecord,
) {
  if (region.ownerSketchId !== sketch.sketchId) {
    throw new Error(
      `Region ${region.regionId} is owned by sketch ${region.ownerSketchId}, not sketch ${sketch.sketchId}.`,
    );
  }

  if (region.sourceSketch.sketchId !== sketch.sketchId) {
    throw new Error(
      `Region ${region.regionId} sources sketch ${region.sourceSketch.sketchId}, not sketch ${sketch.sketchId}.`,
    );
  }

  if (region.target.sketchId !== sketch.sketchId) {
    throw new Error(
      `Region ${region.regionId} targets sketch ${region.target.sketchId}, not sketch ${sketch.sketchId}.`,
    );
  }
}

function assertBoundaryPointExists(sketch: SketchRecord, pointId: string) {
  const authoredPoint = sketch.definition.points.find(
    (entry) => entry.pointId === pointId,
  );

  if (!authoredPoint) {
    throw new Error(
      `Boundary point ${pointId} is not authored on sketch ${sketch.sketchId}.`,
    );
  }
}

function assertLoopCanBuildProfile(
  sketch: SketchRecord,
  region: RegionRecord,
  loop: RegionRecord["loops"][number],
) {
  if (!region.isClosed) {
    throw new Error(`Region ${region.regionId} is not closed.`);
  }

  if (!loop.isClosed) {
    throw new Error(`Region loop ${loop.loopId} is not closed.`);
  }

  if (loop.segments.length === 0) {
    throw new Error(
      `Region loop ${loop.loopId} does not contain any boundary segments.`,
    );
  }

  for (const pointId of loop.boundaryPointIds) {
    assertBoundaryPointExists(sketch, pointId);
  }
}

function toBoundarySegmentGeometry(
  plane: SketchPlaneDefinition,
  geometry: SolvedSketchEntityGeometryRecord,
): BoundarySegmentGeometry {
  switch (geometry.kind) {
    case "lineSegment":
      return {
        kind: "open",
        segmentId: geometry.entityId,
        start: mapSketchPointToWorld(plane, geometry.startPosition),
        end: mapSketchPointToWorld(plane, geometry.endPosition),
      };
    case "arc":
      return {
        kind: "open",
        segmentId: geometry.entityId,
        start: mapSketchPointToWorld(plane, geometry.startPosition),
        end: mapSketchPointToWorld(plane, geometry.endPosition),
      };
    case "circle":
      return {
        kind: "closed",
        segmentId: geometry.entityId,
      };
    case "ellipse": {
      const majorRadius = Math.hypot(
        geometry.majorAxisEndpointPosition[0] - geometry.centerPosition[0],
        geometry.majorAxisEndpointPosition[1] - geometry.centerPosition[1],
      );
      const points = sampleEllipsePoints(
        geometry.centerPosition,
        geometry.majorAxisEndpointPosition,
        geometry.minorRadius,
        getClosedCurveSampleCount(Math.max(majorRadius, geometry.minorRadius)),
      );
      return {
        kind: "closedPolyline",
        segmentId: geometry.entityId,
        points: points.map((point) => mapSketchPointToWorld(plane, point)),
      };
    }
    case "profileText":
      return {
        kind: "closedPolyline",
        segmentId: geometry.entityId,
        points: getProfileTextOutlinePoints(geometry).map((point) =>
          mapSketchPointToWorld(plane, point),
        ),
      };
    case "point":
      throw new Error(
        `Point entity ${geometry.entityId} cannot define a profile boundary.`,
      );
    case "spline":
      throw new Error(
        `Spline entity ${geometry.entityId} cannot define a profile boundary.`,
      );
    case "ellipticalArc":
      throw new Error(
        `Elliptical arc entity ${geometry.entityId} cannot define a profile boundary in this OCC profile builder.`,
      );
    case "conic":
      throw new Error(
        `Conic entity ${geometry.entityId} cannot define a profile boundary in this OCC profile builder.`,
      );
    case "bezierCurve":
      throw new Error(
        `Bezier curve entity ${geometry.entityId} cannot define a profile boundary in this OCC profile builder.`,
      );
  }
}

function sampleEllipsePoints(
  center: SketchPoint2D,
  majorAxisEndpoint: SketchPoint2D,
  minorRadius: number,
  sampleCount: number,
): SketchPoint2D[] {
  const major = [
    majorAxisEndpoint[0] - center[0],
    majorAxisEndpoint[1] - center[1],
  ] as const;
  const majorRadius = Math.hypot(major[0], major[1]);
  if (majorRadius <= Number.EPSILON || minorRadius <= 0) {
    return [];
  }

  const majorUnit = [major[0] / majorRadius, major[1] / majorRadius] as const;
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
  const cos = Math.cos(entity.rotationRadians);
  const sin = Math.sin(entity.rotationRadians);

  return [
    [x, y],
    [x + width, y],
    [x + width, y + entity.height],
    [x, y + entity.height],
  ].map((point) => [
    entity.anchorPosition[0] + point[0]! * cos - point[1]! * sin,
    entity.anchorPosition[1] + point[0]! * sin + point[1]! * cos,
  ]);
}

function arePointsCoincident(left: Vec3, right: Vec3) {
  return (
    Math.abs(left[0] - right[0]) <= PROFILE_LOOP_TOLERANCE &&
    Math.abs(left[1] - right[1]) <= PROFILE_LOOP_TOLERANCE &&
    Math.abs(left[2] - right[2]) <= PROFILE_LOOP_TOLERANCE
  );
}

function assertLoopGeometryIsClosed(
  loop: RegionRecord["loops"][number],
  segments: BoundarySegmentGeometry[],
) {
  if (segments.length === 1) {
    const [onlySegment] = segments;

    if (onlySegment.kind === "closed") {
      return;
    }

    if (onlySegment.kind === "closedPolyline") {
      if (onlySegment.points.length >= 3) {
        return;
      }
      throw new Error(
        `Region loop ${loop.loopId} does not contain enough sampled profile points.`,
      );
    }

    if (arePointsCoincident(onlySegment.start, onlySegment.end)) {
      return;
    }

    throw new Error(
      `Region loop ${loop.loopId} does not close back onto its starting point.`,
    );
  }

  for (const segment of segments) {
    if (segment.kind === "closed" || segment.kind === "closedPolyline") {
      throw new Error(
        `Closed curve segment ${segment.segmentId} cannot participate in multi-segment loop ${loop.loopId}.`,
      );
    }
  }

  for (let index = 0; index < segments.length; index += 1) {
    const current = segments[index];
    const next = segments[(index + 1) % segments.length];

    if (current.kind !== "open" || next.kind !== "open") {
      throw new Error(
        `Region loop ${loop.loopId} contains unsupported mixed segment topology.`,
      );
    }

    if (!arePointsCoincident(current.end, next.start)) {
      throw new Error(
        `Region loop ${loop.loopId} is not geometrically closed between segments ${current.segmentId} and ${next.segmentId}.`,
      );
    }
  }
}

function assertLoopSegmentOwnership(
  sketch: SketchRecord,
  geometry: SolvedSketchEntityGeometryRecord,
) {
  const entity = getSketchEntityDefinition(sketch, geometry.entityId);

  if (entity.isConstruction) {
    throw new Error(
      `Construction entity ${geometry.entityId} cannot define a profile boundary.`,
    );
  }
}

function buildLineEdge(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  geometry: Extract<SolvedSketchEntityGeometryRecord, { kind: "lineSegment" }>,
) {
  return buildLineEdgeFromWorld(
    oc,
    mapSketchPointToWorld(plane, geometry.startPosition),
    mapSketchPointToWorld(plane, geometry.endPosition),
  );
}

function buildLineEdgeFromWorld(
  oc: OpenCascadeInstance,
  startPosition: Vec3,
  endPosition: Vec3,
) {
  const start = toGpPnt(oc, startPosition);
  const end = toGpPnt(oc, endPosition);
  const builder = new oc.BRepBuilderAPI_MakeEdge_3(start, end);
  try {
    return builder.Edge();
  } finally {
    deleteOccObject(builder);
    deleteOccObject(start);
    deleteOccObject(end);
  }
}

function buildCircleEdge(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  geometry: Extract<SolvedSketchEntityGeometryRecord, { kind: "circle" }>,
) {
  return buildCircleEdgeFromSketchGeometry(
    oc,
    plane,
    geometry.centerPosition,
    geometry.solvedRadius,
  );
}

function buildCircleEdgeFromSketchGeometry(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  centerPosition: readonly [number, number],
  radius: number,
) {
  const center = mapSketchPointToWorld(plane, centerPosition);
  const centerPoint = toGpPnt(oc, center);
  const normalDirection = toGpDir(oc, plane.frame.normal);
  const xDirection = toGpDir(oc, plane.frame.xAxis);
  const axis = new oc.gp_Ax2_2(centerPoint, normalDirection, xDirection);
  const circle = new oc.gp_Circ_2(axis, radius);
  const builder = new oc.BRepBuilderAPI_MakeEdge_8(circle);
  try {
    return builder.Edge();
  } finally {
    deleteOccObject(builder);
    deleteOccObject(circle);
    deleteOccObject(axis);
    deleteOccObject(centerPoint);
    deleteOccObject(normalDirection);
    deleteOccObject(xDirection);
  }
}

function buildArcEdge(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  geometry: Extract<SolvedSketchEntityGeometryRecord, { kind: "arc" }>,
) {
  return buildArcEdgeFromSketchGeometry(
    oc,
    plane,
    geometry.startPosition,
    geometry.endPosition,
    geometry.centerPosition,
    geometry.sweepDirection,
    `sketch entity ${geometry.entityId}`,
  );
}

function buildArcEdgeFromSketchGeometry(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  startPosition: readonly [number, number],
  endPosition: readonly [number, number],
  centerPosition: readonly [number, number],
  sweepDirection: "clockwise" | "counterClockwise",
  label: string,
) {
  const start = mapSketchPointToWorld(plane, startPosition);
  const end = mapSketchPointToWorld(plane, endPosition);
  const midpoint = midpointOnArc(
    start,
    end,
    mapSketchPointToWorld(plane, centerPosition),
    plane.frame.normal,
    sweepDirection,
  );
  const startPoint = toGpPnt(oc, start);
  const midpointPoint = toGpPnt(oc, midpoint);
  const endPoint = toGpPnt(oc, end);
  const arc = new oc.GC_MakeArcOfCircle_4(startPoint, midpointPoint, endPoint);

  let curveHandle: { delete?: () => void } | null = null;
  let builder: {
    Edge(): InstanceType<OpenCascadeInstance["TopoDS_Edge"]>;
    delete?: () => void;
  } | null = null;
  try {
    if (!arc.IsDone()) {
      throw new Error(`Failed to build OCC arc for ${label}.`);
    }

    const arcValue = arc.Value();
    let nextCurveHandle: InstanceType<
      OpenCascadeInstance["Handle_Geom_Curve"]
    > | null = null;
    try {
      nextCurveHandle = new oc.Handle_Geom_Curve_2(arcValue.get());
      curveHandle = nextCurveHandle;
    } finally {
      deleteOccObject(arcValue);
    }
    builder = new oc.BRepBuilderAPI_MakeEdge_24(nextCurveHandle);
    return builder.Edge();
  } finally {
    deleteOccObject(builder);
    deleteOccObject(curveHandle);
    deleteOccObject(arc);
    deleteOccObject(startPoint);
    deleteOccObject(midpointPoint);
    deleteOccObject(endPoint);
  }
}

function addClosedPolylineEdges(
  oc: OpenCascadeInstance,
  wireBuilder: { Add_1(edge: unknown): void },
  geometry: ClosedPolylineBoundarySegmentGeometry,
) {
  for (let index = 0; index < geometry.points.length; index += 1) {
    const start = geometry.points[index]!;
    const end = geometry.points[(index + 1) % geometry.points.length]!;
    const edge = buildLineEdgeFromWorld(oc, start, end);
    try {
      wireBuilder.Add_1(edge);
    } finally {
      deleteOccObject(edge);
    }
  }
}

function getProjectedSegmentId(
  source: Extract<
    RegionBoundarySegmentRecord["source"],
    { kind: "projectedGeometry" }
  >,
) {
  return `${source.reference.referenceId}/${source.reference.geometryId}`;
}

function projectedGeometryKindForRef(
  geometry: ProjectedSketchReferenceGeometry,
) {
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

function isAuthoredProjectedReference(
  sketch: SketchRecord,
  referenceId: ReferenceId,
) {
  const isOrdered = sketch.definition.referenceIds.includes(referenceId);
  const hasRecord = sketch.definition.references.some(
    (reference) => reference.referenceId === referenceId,
  );
  return isOrdered && hasRecord;
}

function resolveProjectedBoundaryGeometry(
  sketch: SketchRecord,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  source: Extract<
    RegionBoundarySegmentRecord["source"],
    { kind: "projectedGeometry" }
  >,
) {
  if (!isAuthoredProjectedReference(sketch, source.reference.referenceId)) {
    const rejection = createProjectedRegionLoopRejection(source);
    const error = new Error(
      `${rejection.message} The referenced projection is not backed by the current authored sketch references.`,
    ) as Error & {
      code?: string;
    };
    error.code = rejection.code;
    throw error;
  }

  const projectedReference = projectedReferences.find(
    (entry) => entry.referenceId === source.reference.referenceId,
  );
  const geometry =
    projectedReference?.geometry.find(
      (entry) => entry.geometryId === source.reference.geometryId,
    ) ?? null;

  if (
    !projectedReference ||
    projectedReference.status !== "projected" ||
    !geometry
  ) {
    const rejection = createProjectedRegionLoopRejection(source);
    const error = new Error(
      getProjectedRegionLoopRejectionMessage(source),
    ) as Error & { code?: string };
    error.code = rejection.code;
    throw error;
  }

  if (
    source.reference.kind &&
    projectedGeometryKindForRef(geometry) !== source.reference.kind
  ) {
    const rejection = createProjectedRegionLoopRejection(source);
    const error = new Error(
      `${rejection.message} Expected ${source.reference.kind}, received ${geometry.kind}.`,
    ) as Error & {
      code?: string;
    };
    error.code = rejection.code;
    throw error;
  }

  return geometry;
}

function toProjectedBoundarySegmentGeometry(
  plane: SketchPlaneDefinition,
  source: Extract<
    RegionBoundarySegmentRecord["source"],
    { kind: "projectedGeometry" }
  >,
  geometry: ProjectedSketchReferenceGeometry,
  traversalDirection: RegionBoundarySegmentRecord["traversalDirection"],
): BoundarySegmentGeometry {
  const segmentId = getProjectedSegmentId(source);

  if (geometry.kind === "lineSegment") {
    const base = {
      kind: "open" as const,
      segmentId,
      start: mapSketchPointToWorld(plane, geometry.startPosition),
      end: mapSketchPointToWorld(plane, geometry.endPosition),
    };
    return traversalDirection === "reverse"
      ? { ...base, start: base.end, end: base.start }
      : base;
  }

  if (geometry.kind === "arc") {
    const base = {
      kind: "open" as const,
      segmentId,
      start: mapSketchPointToWorld(plane, geometry.startPosition),
      end: mapSketchPointToWorld(plane, geometry.endPosition),
    };
    return traversalDirection === "reverse"
      ? { ...base, start: base.end, end: base.start }
      : base;
  }

  if (geometry.kind === "circle") {
    return {
      kind: "closed",
      segmentId,
    };
  }

  const rejection = createProjectedRegionLoopRejection(source);
  const error = new Error(
    `Projected ${geometry.kind} geometry ${source.reference.geometryId} cannot define a profile boundary.`,
  ) as Error & {
    code?: string;
  };
  error.code = rejection.code;
  throw error;
}

function getLoopSegmentTraversal(
  plane: SketchPlaneDefinition,
  sketch: SketchRecord,
  segment: RegionBoundarySegmentRecord,
  geometry: SolvedSketchEntityGeometryRecord,
): BoundarySegmentGeometry {
  const baseGeometry = toBoundarySegmentGeometry(plane, geometry);

  if (baseGeometry.kind === "closed") {
    return baseGeometry;
  }

  if (baseGeometry.kind === "closedPolyline") {
    return baseGeometry;
  }

  if (segment.startPointId === null || segment.endPointId === null) {
    return baseGeometry;
  }

  const startPoint = getSolvedBoundaryPointPosition(
    plane,
    sketch,
    segment.startPointId,
  );
  const endPoint = getSolvedBoundaryPointPosition(
    plane,
    sketch,
    segment.endPointId,
  );

  if (
    arePointsCoincident(baseGeometry.start, startPoint) &&
    arePointsCoincident(baseGeometry.end, endPoint)
  ) {
    return baseGeometry;
  }

  if (
    arePointsCoincident(baseGeometry.start, endPoint) &&
    arePointsCoincident(baseGeometry.end, startPoint)
  ) {
    return {
      kind: "open",
      segmentId: baseGeometry.segmentId,
      start: baseGeometry.end,
      end: baseGeometry.start,
    };
  }

  throw new Error(
    `Region loop segment for entity ${geometry.entityId} does not match authored traversal endpoints.`,
  );
}

function getSolvedBoundaryPointPosition(
  plane: SketchPlaneDefinition,
  sketch: SketchRecord,
  pointId: string,
) {
  const solvedPoint = sketch.solvedSnapshot.solvedPoints.find(
    (entry) => entry.pointId === pointId,
  );

  if (solvedPoint) {
    return mapSketchPointToWorld(plane, solvedPoint.solvedPosition);
  }

  const authoredPoint = sketch.definition.points.find(
    (entry) => entry.pointId === pointId,
  );

  if (!authoredPoint) {
    throw new Error(
      `Boundary point ${pointId} is not authored on sketch ${sketch.sketchId}.`,
    );
  }

  return mapSketchPointToWorld(plane, authoredPoint.position);
}

function orientEdgeForLoop(
  oc: OpenCascadeInstance,
  edge: InstanceType<OpenCascadeInstance["TopoDS_Edge"]>,
  loopGeometry: BoundarySegmentGeometry,
  segment: RegionBoundarySegmentRecord,
) {
  if (
    loopGeometry.kind !== "open" ||
    segment.startPointId === null ||
    segment.endPointId === null
  ) {
    return edge;
  }

  const curve = new oc.BRepAdaptor_Curve_2(edge);
  const first = curve.Value(curve.FirstParameter());
  const last = curve.Value(curve.LastParameter());
  try {
    const currentStart = toVec3FromGpPoint(first);
    const currentEnd = toVec3FromGpPoint(last);

    if (
      arePointsCoincident(currentStart, loopGeometry.start) &&
      arePointsCoincident(currentEnd, loopGeometry.end)
    ) {
      return edge;
    }

    if (
      arePointsCoincident(currentStart, loopGeometry.end) &&
      arePointsCoincident(currentEnd, loopGeometry.start)
    ) {
      return reverseEdge(oc, edge);
    }
  } finally {
    deleteOccObject(first);
    deleteOccObject(last);
    deleteOccObject(curve);
  }

  throw new Error(
    `Built OCC edge for segment ${loopGeometry.segmentId} does not match loop traversal geometry.`,
  );
}

function reverseEdge(
  oc: OpenCascadeInstance,
  edge: InstanceType<OpenCascadeInstance["TopoDS_Edge"]>,
) {
  const reversed = edge.Reversed();
  try {
    return oc.TopoDS.Edge_1(reversed);
  } finally {
    deleteOccObject(reversed);
  }
}

function buildProjectedBoundaryEdge(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  source: Extract<
    RegionBoundarySegmentRecord["source"],
    { kind: "projectedGeometry" }
  >,
  geometry: ProjectedSketchReferenceGeometry,
  loopGeometry: BoundarySegmentGeometry,
  loopRole: RegionRecord["loops"][number]["role"],
  traversalDirection: RegionBoundarySegmentRecord["traversalDirection"],
) {
  switch (geometry.kind) {
    case "lineSegment":
      if (loopGeometry.kind !== "open") {
        throw new Error(
          `Projected line ${source.reference.geometryId} did not resolve to open loop geometry.`,
        );
      }
      return buildLineEdgeFromWorld(oc, loopGeometry.start, loopGeometry.end);
    case "circle": {
      const edge = buildCircleEdgeFromSketchGeometry(
        oc,
        plane,
        geometry.centerPosition,
        geometry.radius,
      );
      if (loopRole !== "inner") {
        return edge;
      }
      try {
        return reverseEdge(oc, edge);
      } finally {
        deleteOccObject(edge);
      }
    }
    case "arc": {
      const edge = buildArcEdgeFromSketchGeometry(
        oc,
        plane,
        geometry.startPosition,
        geometry.endPosition,
        geometry.centerPosition,
        geometry.sweepDirection,
        `projected geometry ${source.reference.geometryId}`,
      );
      if (traversalDirection !== "reverse") {
        return edge;
      }
      try {
        return reverseEdge(oc, edge);
      } finally {
        deleteOccObject(edge);
      }
    }
    case "point":
      throw new Error(
        `Projected point geometry ${source.reference.geometryId} cannot define a profile boundary.`,
      );
    case "spline":
      throw new Error(
        `Projected spline geometry ${source.reference.geometryId} cannot define a profile boundary.`,
      );
  }
}

function buildLoopWire(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  sketch: SketchRecord,
  loop: RegionRecord["loops"][number],
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
) {
  const loopGeometry: BoundarySegmentGeometry[] = [];
  const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();

  try {
    for (const segment of loop.segments) {
      if (!isProjectedRegionSegmentSourceSupported(segment.source)) {
        throw new Error("Unsupported region segment source.");
      }

      if (segment.source.kind === "projectedGeometry") {
        const projectedGeometry = resolveProjectedBoundaryGeometry(
          sketch,
          projectedReferences,
          segment.source,
        );
        const segmentGeometry = toProjectedBoundarySegmentGeometry(
          plane,
          segment.source,
          projectedGeometry,
          segment.traversalDirection,
        );
        loopGeometry.push(segmentGeometry);
        const edge = buildProjectedBoundaryEdge(
          oc,
          plane,
          segment.source,
          projectedGeometry,
          segmentGeometry,
          loop.role,
          segment.traversalDirection,
        );
        try {
          wireBuilder.Add_1(edge);
        } finally {
          deleteOccObject(edge);
        }
      } else {
        const geometry = getSolvedEntityGeometry(
          sketch,
          segment.source.entityId,
        );
        assertLoopSegmentOwnership(sketch, geometry);
        const segmentGeometry = getLoopSegmentTraversal(
          plane,
          sketch,
          segment,
          geometry,
        );
        loopGeometry.push(segmentGeometry);

        switch (geometry.kind) {
          case "lineSegment": {
            const baseEdge = buildLineEdge(oc, plane, geometry);
            let edge = baseEdge;
            try {
              edge = orientEdgeForLoop(oc, baseEdge, segmentGeometry, segment);
              wireBuilder.Add_1(edge);
            } finally {
              if (edge !== baseEdge) {
                deleteOccObject(edge);
              }
              deleteOccObject(baseEdge);
            }
            break;
          }
          case "circle": {
            const baseEdge = buildCircleEdge(oc, plane, geometry);
            let edge = baseEdge;
            try {
              edge =
                loop.role === "inner" ? reverseEdge(oc, baseEdge) : baseEdge;
              wireBuilder.Add_1(edge);
            } finally {
              if (edge !== baseEdge) {
                deleteOccObject(edge);
              }
              deleteOccObject(baseEdge);
            }
            break;
          }
          case "arc": {
            const baseEdge = buildArcEdge(oc, plane, geometry);
            let edge = baseEdge;
            try {
              edge = orientEdgeForLoop(oc, baseEdge, segmentGeometry, segment);
              wireBuilder.Add_1(edge);
            } finally {
              if (edge !== baseEdge) {
                deleteOccObject(edge);
              }
              deleteOccObject(baseEdge);
            }
            break;
          }
          case "ellipse":
          case "profileText":
            if (segmentGeometry.kind !== "closedPolyline") {
              throw new Error(
                `Advanced entity ${geometry.entityId} did not resolve to closed profile geometry.`,
              );
            }
            addClosedPolylineEdges(oc, wireBuilder, segmentGeometry);
            break;
          case "point":
            throw new Error(
              `Point entity ${geometry.entityId} cannot define a profile boundary.`,
            );
          case "spline":
            throw new Error(
              `Spline entity ${geometry.entityId} cannot define a profile boundary.`,
            );
          case "ellipticalArc":
            throw new Error(
              `Elliptical arc entity ${geometry.entityId} cannot define a profile boundary in this OCC profile builder.`,
            );
          case "conic":
            throw new Error(
              `Conic entity ${geometry.entityId} cannot define a profile boundary in this OCC profile builder.`,
            );
          case "bezierCurve":
            throw new Error(
              `Bezier curve entity ${geometry.entityId} cannot define a profile boundary in this OCC profile builder.`,
            );
        }
      }
    }

    assertLoopGeometryIsClosed(loop, loopGeometry);

    if (!wireBuilder.IsDone()) {
      throw new Error(
        `Failed to build OCC wire for region loop ${loop.loopId}.`,
      );
    }

    return wireBuilder.Wire();
  } finally {
    deleteOccObject(wireBuilder);
  }
}

export function buildRegionProfileFace(
  oc: OpenCascadeInstance,
  snapshotSketch: {
    plane: SketchPlaneDefinition;
    sketch: SketchRecord;
    projectedReferences?: readonly ProjectedSketchReferenceRecord[];
  },
  region: RegionRecord,
): BuiltSketchProfileFace {
  assertRegionBelongsToSketch(snapshotSketch.sketch, region);

  const outerLoops = region.loops.filter((loop) => loop.role === "outer");

  if (outerLoops.length !== 1) {
    throw new Error(
      `Region ${region.regionId} must contain exactly one outer loop.`,
    );
  }

  const [outerLoop] = outerLoops;

  assertLoopCanBuildProfile(snapshotSketch.sketch, region, outerLoop);

  const plane = snapshotSketch.plane;
  const projectedReferences =
    snapshotSketch.projectedReferences ??
    snapshotSketch.sketch.projectedReferences ??
    [];
  let outerWire: ReturnType<typeof buildLoopWire> | null = null;
  let faceBuilder: {
    Add(wire: unknown): void;
    Face(): InstanceType<OpenCascadeInstance["TopoDS_Face"]>;
    IsDone(): boolean;
    delete?: () => void;
  } | null = null;

  try {
    outerWire = buildLoopWire(
      oc,
      plane,
      snapshotSketch.sketch,
      outerLoop,
      projectedReferences,
    );
    faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(outerWire, true);

    for (const innerLoop of region.loops.filter(
      (loop) => loop.role === "inner",
    )) {
      assertLoopCanBuildProfile(snapshotSketch.sketch, region, innerLoop);
      const innerWire = buildLoopWire(
        oc,
        plane,
        snapshotSketch.sketch,
        innerLoop,
        projectedReferences,
      );
      try {
        faceBuilder.Add(innerWire);
      } finally {
        deleteOccObject(innerWire);
      }
    }

    if (!faceBuilder.IsDone()) {
      throw new Error(
        `Failed to build OCC face for region ${region.regionId}.`,
      );
    }

    return {
      face: faceBuilder.Face(),
      plane,
      normal: plane.frame.normal,
    };
  } finally {
    deleteOccObject(faceBuilder);
    deleteOccObject(outerWire);
  }
}

export function getExtrusionNormalForSketchProfile(
  plane: SketchPlaneDefinition,
  direction: "positive" | "negative",
): Vec3 {
  return direction === "positive"
    ? plane.frame.normal
    : negate(plane.frame.normal);
}

export function getExtrusionNormalForPlanarFace(
  oc: OpenCascadeInstance,
  face: InstanceType<OpenCascadeInstance["TopoDS_Face"]>,
  direction: "positive" | "negative",
) {
  const { frame } = extractPlanarFaceData(
    oc,
    face,
    "Face-backed profile requires a planar face.",
  );
  const normal = frame.normal as Vec3;
  return direction === "positive" ? normal : negate(normal);
}

export function buildConstructionPlaneFromPlanarFace(
  oc: OpenCascadeInstance,
  face: InstanceType<OpenCascadeInstance["TopoDS_Face"]>,
  faceId: FaceId,
  support: SketchPlaneDefinition["support"],
): SketchPlaneDefinition {
  return buildConstructionPlaneFromPlanarFaceFromPlaneUtility(
    oc,
    face,
    faceId,
    support,
  );
}

export function buildAxisFromLineEdge(
  oc: OpenCascadeInstance,
  edge: InstanceType<OpenCascadeInstance["TopoDS_Edge"]>,
) {
  const curve = new oc.BRepAdaptor_Curve_2(edge);

  if (curve.GetType() !== oc.GeomAbs_CurveType.GeomAbs_Line) {
    throw new Error("Revolve axis edges must resolve to linear OCC edges.");
  }

  return curve.Line().Position();
}

export function buildCircleAxis(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  center: Vec3,
  radius: number,
) {
  const normal = toGpDir(oc, plane.frame.normal);
  return new oc.GC_MakeCircle_6(toGpPnt(oc, center), normal, radius);
}
