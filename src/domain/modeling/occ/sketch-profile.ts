import type {
  RegionBoundarySource,
  RegionBoundaryVertex,
  RegionRecord,
  SolvedSketchEntityGeometryRecord,
  SketchRecord,
  SketchPoint2D,
} from "@/contracts/sketch/schema";
import type {
  ProjectedSketchReferenceGeometry,
  ProjectedSketchReferenceRecord,
} from "@/contracts/solver/schema";
import type {
  FaceId,
  ReferenceId,
  SketchEntityId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import { assertAcceptedSketchFeatureInput } from "@/domain/modeling/sketch-feature-input";
import { buildConstructionPlaneFromPlanarFace as buildConstructionPlaneFromPlanarFaceFromPlaneUtility } from "@/domain/modeling/occ/planes";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import {
  extractPlanarFaceData,
  mapSketchPointToWorld,
  midpointOnArc,
  negate,
  toGpDir,
  toGpPnt,
  type Vec3,
} from "@/domain/modeling/occ/geometry";
import {
  createProjectedRegionLoopRejection,
  getProjectedRegionLoopRejectionMessage,
  isProjectedRegionSegmentSourceSupported,
} from "@/domain/modeling/occ/implementation-policy";
import {
  combineOccCleanupError,
  deleteOccObject,
  releaseOccObjects,
} from "@/domain/modeling/occ/memory";

export type ProjectedSketchProfileEdgeKey =
  `projected:${ReferenceId}/${string}`;
export type ProjectedSketchProfileVertexKey =
  `${ProjectedSketchProfileEdgeKey}:${"start" | "end"}`;
export type SketchProfileBaseEdgeSourceKey =
  | SketchEntityId
  | ProjectedSketchProfileEdgeKey;
export type SketchProfileEdgeSourceKey =
  | SketchProfileBaseEdgeSourceKey
  | SplitSketchProfileEdgeKey;
/**
 * Distinct key for ONE split piece of a source curve that contributes several
 * boundary segments to the same profile. The ordinal is the region
 * extraction's persisted `sourceSegmentOrdinal` (split-piece position in
 * source-curve parameter order), never a geometric match, so the key is exact
 * and reproducible. Sources contributing a single segment keep their bare key.
 */
export type SplitSketchProfileEdgeKey =
  `${SketchProfileBaseEdgeSourceKey}#${number}`;
export type SketchProfileVertexSourceKey =
  | SketchPointId
  | ProjectedSketchProfileVertexKey;

export interface SketchProfileProvenance {
  edges: ReadonlyMap<
    SketchProfileEdgeSourceKey,
    InstanceType<OpenCascadeInstance["TopoDS_Edge"]>
  >;
  vertices: ReadonlyMap<
    SketchProfileVertexSourceKey,
    InstanceType<OpenCascadeInstance["TopoDS_Vertex"]>
  >;
}

export interface BuiltSketchProfileFace {
  face: InstanceType<OpenCascadeInstance["TopoDS_Face"]>;
  plane: SketchPlaneDefinition;
  normal: Vec3;
  provenance: SketchProfileProvenance;
}

/** Releases every wrapper identity owned by a successful profile-face result. */
export function releaseBuiltSketchProfileFace(result: BuiltSketchProfileFace) {
  releaseOccObjects([
    result.face,
    ...result.provenance.edges.values(),
    ...result.provenance.vertices.values(),
  ]);
}

interface MutableSketchProfileProvenance {
  edges: Map<
    SketchProfileEdgeSourceKey,
    InstanceType<OpenCascadeInstance["TopoDS_Edge"]>
  >;
  vertices: Map<
    SketchProfileVertexSourceKey,
    InstanceType<OpenCascadeInstance["TopoDS_Vertex"]>
  >;
}
type OccProfileVertex = InstanceType<OpenCascadeInstance["TopoDS_Vertex"]>;
// Resolves an open-curve chain endpoint to a single shared TopoDS_Vertex, so
// consecutive open surface-profile curves share one vertex.
type ProfileVertexResolver = (
  position: Vec3,
  sourceKey?: SketchProfileVertexSourceKey,
) => OccProfileVertex;

/**
 * Endpoint chaining of *open* surface-profile curves only
 * (`buildOpenSketchCurveWire`). Region profiles never use it: their vertices
 * are the arrangement's topological boundary vertices.
 */
const OPEN_CURVE_CHAIN_TOLERANCE = 1e-6;

function areOpenCurveEndpointsCoincident(left: Vec3, right: Vec3) {
  return (
    Math.abs(left[0] - right[0]) <= OPEN_CURVE_CHAIN_TOLERANCE &&
    Math.abs(left[1] - right[1]) <= OPEN_CURVE_CHAIN_TOLERANCE &&
    Math.abs(left[2] - right[2]) <= OPEN_CURVE_CHAIN_TOLERANCE
  );
}

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

/** Closure is structural: consecutive segments share boundary-vertex keys. */
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

  if (loop.segments.length === 1) {
    const [only] = loop.segments;
    const closesOnItself =
      (only!.start === null && only!.end === null) ||
      (only!.start !== null &&
        only!.end !== null &&
        only!.start.key === only!.end.key);
    if (!closesOnItself) {
      throw new Error(
        `Region loop ${loop.loopId} does not close back onto its starting vertex.`,
      );
    }
  } else {
    loop.segments.forEach((current, index) => {
      const next = loop.segments[(index + 1) % loop.segments.length]!;
      if (
        current.end === null ||
        next.start === null ||
        current.end.key !== next.start.key
      ) {
        throw new Error(
          `Region loop ${loop.loopId} is not closed between segments ${index} and ${(index + 1) % loop.segments.length}.`,
        );
      }
    });
  }

  for (const pointId of loop.boundaryPointIds) {
    assertBoundaryPointExists(sketch, pointId);
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
  startVertex: InstanceType<OpenCascadeInstance["TopoDS_Vertex"]>,
  endVertex: InstanceType<OpenCascadeInstance["TopoDS_Vertex"]>,
) {
  const builder = new oc.BRepBuilderAPI_MakeEdge_2(startVertex, endVertex);
  try {
    return builder.Edge();
  } finally {
    deleteOccObject(builder);
  }
}

function createProfileVertex(
  oc: OpenCascadeInstance,
  position: Vec3,
): OccProfileVertex {
  const point = toGpPnt(oc, position);
  const builder = new oc.BRepBuilderAPI_MakeVertex(point);
  try {
    return builder.Vertex();
  } finally {
    deleteOccObject(builder);
    deleteOccObject(point);
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
  startVertex: InstanceType<OpenCascadeInstance["TopoDS_Vertex"]>,
  endVertex: InstanceType<OpenCascadeInstance["TopoDS_Vertex"]>,
) {
  return buildArcEdgeFromSketchGeometry(
    oc,
    plane,
    geometry.startPosition,
    geometry.endPosition,
    geometry.centerPosition,
    geometry.sweepDirection,
    `sketch entity ${geometry.entityId}`,
    startVertex,
    endVertex,
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
  startVertex?: InstanceType<OpenCascadeInstance["TopoDS_Vertex"]>,
  endVertex?: InstanceType<OpenCascadeInstance["TopoDS_Vertex"]>,
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
    builder =
      startVertex && endVertex
        ? new oc.BRepBuilderAPI_MakeEdge_27(
            nextCurveHandle,
            startVertex,
            endVertex,
          )
        : new oc.BRepBuilderAPI_MakeEdge_24(nextCurveHandle);
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

function getProjectedSegmentId(
  source: Extract<RegionBoundarySource, { kind: "projectedGeometry" }>,
): ProjectedSketchProfileEdgeKey {
  return `projected:${source.reference.referenceId}/${source.reference.geometryId}`;
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
  source: Extract<RegionBoundarySource, { kind: "projectedGeometry" }>,
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

type RegionBoundarySegment = RegionRecord["loops"][number]["segments"][number];

function getRegionSegmentBaseEdgeKey(
  segment: RegionBoundarySegment,
): SketchProfileBaseEdgeSourceKey {
  const source = segment.branch.source;
  return source.kind === "projectedGeometry"
    ? getProjectedSegmentId(source)
    : source.entityId;
}

/**
 * Resolve the provenance key for one boundary segment's profile edge.
 *
 * A source curve crossed several times by a region boundary contributes
 * SEVERAL wire edges. Keying them all by the bare source id silently
 * overwrites every edge but the last, so the earlier edges' swept faces reach
 * later features with no lineage at all. Each split piece therefore keys on
 * its `sourceSegmentOrdinal` (split-piece position in source-parameter order).
 */
function createRegionSegmentEdgeKeyResolver(
  loops: readonly RegionRecord["loops"][number][],
) {
  const segmentCounts = new Map<SketchProfileEdgeSourceKey, number>();
  for (const loop of loops) {
    for (const segment of loop.segments) {
      const baseKey = getRegionSegmentBaseEdgeKey(segment);
      segmentCounts.set(baseKey, (segmentCounts.get(baseKey) ?? 0) + 1);
    }
  }
  return (segment: RegionBoundarySegment): SketchProfileEdgeSourceKey => {
    const baseKey = getRegionSegmentBaseEdgeKey(segment);
    if ((segmentCounts.get(baseKey) ?? 0) <= 1) {
      return baseKey;
    }
    return `${baseKey}#${segment.sourceSegmentOrdinal}` as SplitSketchProfileEdgeKey;
  };
}

/** Support geometry of one boundary branch; the edge runs through the boundary vertices. */
type RegionBranchSupport =
  | { kind: "line" }
  | { kind: "circle"; center: SketchPoint2D; radius: number };

function describeRegionBoundarySource(source: RegionBoundarySource) {
  return source.kind === "entity"
    ? `sketch entity ${source.entityId}`
    : `projected geometry ${source.reference.referenceId}/${source.reference.geometryId}`;
}

function resolveRegionBranchSupport(
  sketch: SketchRecord,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  segment: RegionBoundarySegment,
): RegionBranchSupport {
  const source = segment.branch.source;
  if (!isProjectedRegionSegmentSourceSupported(source)) {
    throw new Error("Unsupported region segment source.");
  }
  if (segment.branch.spanId !== "whole") {
    // U9 tracked gap: spline-bounded regions are derived and selectable, but
    // exact span trimming for OCC lands in T10.
    throw new Error(
      `Spline profile boundary ${describeRegionBoundarySource(source)} span ${segment.branch.spanId} is not yet supported by the OCC profile builder.`,
    );
  }

  if (source.kind === "projectedGeometry") {
    const geometry = resolveProjectedBoundaryGeometry(
      sketch,
      projectedReferences,
      source,
    );
    switch (geometry.kind) {
      case "lineSegment":
        return { kind: "line" };
      case "arc":
        return {
          kind: "circle",
          center: geometry.centerPosition,
          radius: Math.hypot(
            geometry.startPosition[0] - geometry.centerPosition[0],
            geometry.startPosition[1] - geometry.centerPosition[1],
          ),
        };
      case "circle":
        return {
          kind: "circle",
          center: geometry.centerPosition,
          radius: geometry.radius,
        };
      case "spline":
        throw new Error(
          `Spline profile boundary ${describeRegionBoundarySource(source)} is not yet supported by the OCC profile builder.`,
        );
      case "point":
        throw new Error(
          `Projected point geometry ${source.reference.geometryId} cannot define a profile boundary.`,
        );
    }
  }

  const geometry = getSolvedEntityGeometry(sketch, source.entityId);
  assertLoopSegmentOwnership(sketch, geometry);
  switch (geometry.kind) {
    case "lineSegment":
      return { kind: "line" };
    case "arc":
      return {
        kind: "circle",
        center: geometry.centerPosition,
        radius: Math.hypot(
          geometry.startPosition[0] - geometry.centerPosition[0],
          geometry.startPosition[1] - geometry.centerPosition[1],
        ),
      };
    case "circle":
      return {
        kind: "circle",
        center: geometry.centerPosition,
        radius: geometry.solvedRadius,
      };
    case "spline":
      throw new Error(
        `Spline profile boundary ${describeRegionBoundarySource(source)} is not yet supported by the OCC profile builder.`,
      );
    default:
      throw new Error(
        `Sketch entity ${geometry.entityId} of kind ${geometry.kind} cannot define a profile boundary in this OCC profile builder.`,
      );
  }
}

/**
 * One OCC vertex per boundary-vertex key, positioned at the vertex
 * representative (a declared join's realization; never identity). Declared
 * joins register the vertex under every joined authored point id, so side-edge
 * lineage keeps naming it by its sketch points.
 */
function createRegionVertexResolver(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  provenance: MutableSketchProfileProvenance,
) {
  const byKey = new Map<string, OccProfileVertex>();
  const unregistered = new Set<OccProfileVertex>();
  const resolve = (
    vertex: RegionBoundaryVertex,
    endpointKey: SketchProfileVertexSourceKey | null,
  ): OccProfileVertex => {
    let occVertex = byKey.get(vertex.key);
    if (!occVertex) {
      occVertex = createProfileVertex(
        oc,
        mapSketchPointToWorld(plane, vertex.position),
      );
      byKey.set(vertex.key, occVertex);
      unregistered.add(occVertex);
    }
    const keys: SketchProfileVertexSourceKey[] = [
      ...(vertex.kind === "declaredJoin" ? vertex.pointIds : []),
      ...(endpointKey ? [endpointKey] : []),
    ];
    for (const key of keys) {
      provenance.vertices.set(key, occVertex);
      unregistered.delete(occVertex);
    }
    return occVertex;
  };
  return { resolve, unregistered };
}

/**
 * Provenance keys of a line branch's own endpoints at this segment's ends:
 * an end whose source parameter is exactly the branch domain end (0 or 1) is
 * that line's authored (or projected) endpoint. Structural, never proximity.
 */
function lineEndpointKeys(
  sketch: SketchRecord,
  segment: RegionBoundarySegment,
): {
  start: SketchProfileVertexSourceKey | null;
  end: SketchProfileVertexSourceKey | null;
} {
  const source = segment.branch.source;
  let atZero: SketchProfileVertexSourceKey | null = null;
  let atOne: SketchProfileVertexSourceKey | null = null;
  if (source.kind === "projectedGeometry") {
    const key = getProjectedSegmentId(source);
    atZero = `${key}:start`;
    atOne = `${key}:end`;
  } else {
    const entity = getSketchEntityDefinition(sketch, source.entityId);
    if (entity.kind !== "lineSegment") return { start: null, end: null };
    atZero = entity.startPointId;
    atOne = entity.endPointId;
  }
  const [low, high] = segment.sourceParameterInterval;
  const lowKey = low === 0 ? atZero : null;
  const highKey = high === 1 ? atOne : null;
  return segment.traversalDirection === "reverse"
    ? { start: highKey, end: lowKey }
    : { start: lowKey, end: highKey };
}

function buildRegionSegmentEdge(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  sketch: SketchRecord,
  segment: RegionBoundarySegment,
  support: RegionBranchSupport,
  resolve: (
    vertex: RegionBoundaryVertex,
    endpointKey: SketchProfileVertexSourceKey | null,
  ) => OccProfileVertex,
) {
  const label = describeRegionBoundarySource(segment.branch.source);
  if ((segment.start === null) !== (segment.end === null)) {
    throw new Error(
      `Boundary segment of ${label} has exactly one null end; only an unsplit closed branch has no boundary vertices.`,
    );
  }
  // Arcs and circles use increasing (counter-clockwise) source angle; a
  // reverse traversal runs clockwise.
  const sweep =
    segment.traversalDirection === "reverse" ? "clockwise" : "counterClockwise";

  if (support.kind === "line") {
    if (segment.start === null || segment.end === null) {
      throw new Error(`Line boundary ${label} has no boundary vertices.`);
    }
    const endpointKeys = lineEndpointKeys(sketch, segment);
    return buildLineEdge(
      oc,
      resolve(segment.start, endpointKeys.start),
      resolve(segment.end, endpointKeys.end),
    );
  }

  const closesOnItself =
    segment.start === null ||
    segment.end === null ||
    segment.start.key === segment.end.key;
  if (closesOnItself) {
    // An unsplit full circle, or a full turn through one touch vertex.
    const edge = buildCircleEdgeFromSketchGeometry(
      oc,
      plane,
      support.center,
      support.radius,
    );
    if (segment.traversalDirection !== "reverse") {
      return edge;
    }
    try {
      return reverseEdge(oc, edge);
    } finally {
      deleteOccObject(edge);
    }
  }

  return buildArcEdgeFromSketchGeometry(
    oc,
    plane,
    segment.start!.position,
    segment.end!.position,
    support.center,
    sweep,
    label,
    resolve(segment.start!, null),
    resolve(segment.end!, null),
  );
}

function buildLoopWire(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  sketch: SketchRecord,
  loop: RegionRecord["loops"][number],
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  provenance: MutableSketchProfileProvenance,
  resolveSegmentEdgeKey: (
    segment: RegionBoundarySegment,
  ) => SketchProfileEdgeSourceKey,
) {
  const vertices = createRegionVertexResolver(oc, plane, provenance);
  const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();

  try {
    for (const segment of loop.segments) {
      const support = resolveRegionBranchSupport(
        sketch,
        projectedReferences,
        segment,
      );
      const edge = buildRegionSegmentEdge(
        oc,
        plane,
        sketch,
        segment,
        support,
        vertices.resolve,
      );
      wireBuilder.Add_1(edge);
      provenance.edges.set(resolveSegmentEdgeKey(segment), edge);
    }

    if (!wireBuilder.IsDone()) {
      throw new Error(
        `Failed to build OCC wire for region loop ${loop.loopId}.`,
      );
    }

    return wireBuilder.Wire();
  } finally {
    deleteOccObject(wireBuilder);
    // Unregistered vertices are loop-local; registered ones are released with
    // the profile provenance.
    for (const vertex of vertices.unregistered) deleteOccObject(vertex);
  }
}

/**
 * Each loop's wire gets its own OCC vertices, so a boundary vertex shared by
 * two loops of one face (point-touching loops) would become two coincident
 * OCC vertices and two provenance registrations. That face is rejected
 * explicitly until T10 proves touching-loop faces.
 */
function assertLoopsShareNoBoundaryVertex(region: RegionRecord) {
  const loopByVertexKey = new Map<string, string>();
  for (const loop of region.loops) {
    const keys = new Set(
      loop.segments.flatMap((segment) =>
        [segment.start, segment.end].flatMap((vertex) =>
          vertex ? [vertex.key] : [],
        ),
      ),
    );
    for (const key of keys) {
      const other = loopByVertexKey.get(key);
      if (other !== undefined) {
        throw new Error(
          `Region ${region.regionId} loops ${other} and ${loop.loopId} share boundary vertex ${key}; profiles with point-touching loops are not yet supported by the OCC profile builder.`,
        );
      }
      loopByVertexKey.set(key, loop.loopId);
    }
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
  assertLoopsShareNoBoundaryVertex(region);

  const plane = snapshotSketch.plane;
  const projectedReferences =
    snapshotSketch.projectedReferences ??
    snapshotSketch.sketch.projectedReferences ??
    [];
  const provenance: MutableSketchProfileProvenance = {
    edges: new Map(),
    vertices: new Map(),
  };
  const resolveSegmentEdgeKey = createRegionSegmentEdgeKeyResolver(
    region.loops.filter(
      (loop) => loop.role === "outer" || loop.role === "inner",
    ),
  );
  let outerWire: ReturnType<typeof buildLoopWire> | null = null;
  let faceBuilder: {
    Add(wire: unknown): void;
    Face(): InstanceType<OpenCascadeInstance["TopoDS_Face"]>;
    IsDone(): boolean;
    delete?: () => void;
  } | null = null;

  let result: BuiltSketchProfileFace;
  try {
    outerWire = buildLoopWire(
      oc,
      plane,
      snapshotSketch.sketch,
      outerLoop,
      projectedReferences,
      provenance,
      resolveSegmentEdgeKey,
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
        provenance,
        resolveSegmentEdgeKey,
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

    result = {
      face: faceBuilder.Face(),
      plane,
      normal: plane.frame.normal,
      provenance,
    };
  } catch (error) {
    try {
      releaseOccObjects([
        ...(faceBuilder ? [faceBuilder] : []),
        ...(outerWire ? [outerWire] : []),
        ...provenance.edges.values(),
        ...provenance.vertices.values(),
      ]);
    } catch (cleanupError) {
      throw combineOccCleanupError(error, cleanupError);
    }
    throw error;
  }

  try {
    releaseOccObjects([
      ...(faceBuilder ? [faceBuilder] : []),
      ...(outerWire ? [outerWire] : []),
    ]);
  } catch (cleanupError) {
    try {
      releaseBuiltSketchProfileFace(result);
    } catch (resultCleanupError) {
      throw combineOccCleanupError(cleanupError, resultCleanupError);
    }
    throw cleanupError;
  }
  return result;
}

/**
 * A profile boundary kept as a wire, for surface features that sweep the
 * boundary itself instead of a face built from it.
 */
export interface BuiltSketchProfileWire {
  wire: InstanceType<OpenCascadeInstance["TopoDS_Wire"]>;
  plane: SketchPlaneDefinition;
  normal: Vec3;
  provenance: SketchProfileProvenance;
}

function releaseProfileProvenance(provenance: SketchProfileProvenance) {
  releaseOccObjects([
    ...provenance.edges.values(),
    ...provenance.vertices.values(),
  ]);
}

/**
 * Outer boundary wire of a closed region, without face construction.
 *
 * Sweeping a wire yields a sheet; sweeping a face yields a solid. Inner loops
 * have no sheet meaning here — a sweep of two independent boundary wires cannot
 * produce one sheet body — so they are rejected instead of silently dropped.
 */
export function buildRegionProfileWire(
  oc: OpenCascadeInstance,
  snapshotSketch: {
    plane: SketchPlaneDefinition;
    sketch: SketchRecord;
    projectedReferences?: readonly ProjectedSketchReferenceRecord[];
  },
  region: RegionRecord,
): BuiltSketchProfileWire {
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
  const provenance: MutableSketchProfileProvenance = {
    edges: new Map(),
    vertices: new Map(),
  };

  try {
    const wire = buildLoopWire(
      oc,
      plane,
      snapshotSketch.sketch,
      outerLoop,
      snapshotSketch.projectedReferences ??
        snapshotSketch.sketch.projectedReferences ??
        [],
      provenance,
      createRegionSegmentEdgeKeyResolver([outerLoop]),
    );
    return { wire, plane, normal: plane.frame.normal, provenance };
  } catch (error) {
    releaseProfileProvenance(provenance);
    throw error;
  }
}

interface OpenCurveSegment {
  entityId: SketchEntityId;
  start: Vec3;
  end: Vec3;
  closed: boolean;
  startPointId?: SketchPointId;
  endPointId?: SketchPointId;
}

function resolveOpenCurveSegment(
  plane: SketchPlaneDefinition,
  sketch: SketchRecord,
  entityId: SketchEntityId,
): OpenCurveSegment {
  // [TECH] G19: a non-accepted offset output is not modeling input.
  assertAcceptedSketchFeatureInput(sketch, entityId, "an open profile curve");
  const geometry = getSolvedEntityGeometry(sketch, entityId);
  assertLoopSegmentOwnership(sketch, geometry);

  if (geometry.kind === "circle") {
    const center = mapSketchPointToWorld(plane, geometry.centerPosition);
    return { entityId, start: center, end: center, closed: true };
  }

  if (geometry.kind === "lineSegment" || geometry.kind === "arc") {
    const entity = getSketchEntityDefinition(sketch, entityId);

    if (entity.kind !== geometry.kind) {
      throw new Error(
        `Solved entity ${entityId} does not match its authored entity kind.`,
      );
    }

    return {
      entityId,
      start: getSolvedBoundaryPointPosition(plane, sketch, entity.startPointId),
      end: getSolvedBoundaryPointPosition(plane, sketch, entity.endPointId),
      closed: false,
      startPointId: entity.startPointId,
      endPointId: entity.endPointId,
    };
  }

  throw new Error(
    `unsupported-profile-group: Sketch entity ${entityId} of kind ${geometry.kind} cannot define an open surface profile curve.`,
  );
}

function assertOpenCurveSegmentsFormChain(
  segments: readonly OpenCurveSegment[],
) {
  if (segments.length === 1 && segments[0]!.closed) {
    return;
  }

  const endpoints: Array<{ position: Vec3; degree: number }> = [];
  for (const segment of segments) {
    for (const position of [segment.start, segment.end]) {
      const endpoint = endpoints.find((candidate) =>
        areOpenCurveEndpointsCoincident(candidate.position, position),
      );
      if (endpoint) {
        endpoint.degree += 1;
      } else {
        endpoints.push({ position, degree: 1 });
      }
    }
  }

  if (endpoints.some((endpoint) => endpoint.degree > 2)) {
    throw new Error(
      "unsupported-profile-group: Open sketch curves branch and do not form one sweepable chain.",
    );
  }
  const openEndpointCount = endpoints.filter(
    (endpoint) => endpoint.degree === 1,
  ).length;
  if (openEndpointCount !== 0 && openEndpointCount !== 2) {
    throw new Error(
      "unsupported-profile-group: Open sketch curves do not form one continuous chain.",
    );
  }
}

/**
 * Order open-curve segments so each one after the first shares an endpoint with
 * the segments already placed.
 *
 * `BRepBuilderAPI_MakeWire` only accepts an edge that touches the wire built so
 * far, so ordering IS the connectivity proof: if no remaining segment touches
 * the accumulated endpoints, the submitted set is not one chain. Nothing is
 * sewn or bridged — a disconnected set is reported.
 */
function orderConnectedOpenCurveSegments(
  segments: readonly OpenCurveSegment[],
) {
  const remaining = [...segments];
  const ordered: OpenCurveSegment[] = [remaining.shift()!];
  const endpoints: Vec3[] = ordered[0]!.closed
    ? []
    : [ordered[0]!.start, ordered[0]!.end];

  while (remaining.length > 0) {
    const index = remaining.findIndex(
      (segment) =>
        !segment.closed &&
        endpoints.some(
          (endpoint) =>
            areOpenCurveEndpointsCoincident(endpoint, segment.start) ||
            areOpenCurveEndpointsCoincident(endpoint, segment.end),
        ),
    );

    if (index < 0) {
      throw new Error(
        `unsupported-profile-group: Open sketch curves ${remaining
          .map((segment) => segment.entityId)
          .join(
            ", ",
          )} are not connected to the rest of the surface profile chain.`,
      );
    }

    const [segment] = remaining.splice(index, 1);
    ordered.push(segment!);
    endpoints.push(segment!.start, segment!.end);
  }

  return ordered;
}

/**
 * One wire built from durable open sketch-curve refs.
 *
 * Every submitted entity must belong to a single connected chain; the wire is
 * the sweep profile of a surface extrude or revolve, and its edges/vertices
 * carry the same provenance keys a closed region profile would, so sheet
 * topology stays nameable.
 */
export function buildOpenSketchCurveWire(
  oc: OpenCascadeInstance,
  snapshotSketch: { plane: SketchPlaneDefinition; sketch: SketchRecord },
  entityIds: readonly SketchEntityId[],
): BuiltSketchProfileWire {
  if (entityIds.length === 0) {
    throw new Error(
      "unsupported-profile-group: An open sketch-curve surface profile requires at least one sketch entity.",
    );
  }

  if (new Set(entityIds).size !== entityIds.length) {
    throw new Error(
      "unsupported-profile-group: An open sketch-curve surface profile must not repeat a sketch entity.",
    );
  }

  const plane = snapshotSketch.plane;
  const sketch = snapshotSketch.sketch;
  const segments = entityIds.map((entityId) =>
    resolveOpenCurveSegment(plane, sketch, entityId),
  );

  if (segments.length > 1 && segments.some((segment) => segment.closed)) {
    throw new Error(
      "unsupported-profile-group: A closed sketch curve cannot be chained with other open surface profile curves.",
    );
  }
  assertOpenCurveSegmentsFormChain(segments);

  const provenance: MutableSketchProfileProvenance = {
    edges: new Map(),
    vertices: new Map(),
  };
  const vertexPool: Array<{ position: Vec3; vertex: OccProfileVertex }> = [];
  const resolveProfileVertex: ProfileVertexResolver = (position, sourceKey) => {
    const registered = sourceKey
      ? provenance.vertices.get(sourceKey)
      : undefined;
    if (registered) {
      return registered;
    }

    const coincident = vertexPool.find((entry) =>
      areOpenCurveEndpointsCoincident(entry.position, position),
    );
    if (coincident) {
      if (sourceKey) {
        provenance.vertices.set(sourceKey, coincident.vertex);
      }
      return coincident.vertex;
    }

    const vertex = createProfileVertex(oc, position);
    vertexPool.push({ position, vertex });
    if (sourceKey) {
      provenance.vertices.set(sourceKey, vertex);
    }
    return vertex;
  };
  const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();
  let succeeded = false;

  try {
    for (const segment of orderConnectedOpenCurveSegments(segments)) {
      const geometry = getSolvedEntityGeometry(sketch, segment.entityId);
      const edge =
        geometry.kind === "circle"
          ? buildCircleEdge(oc, plane, geometry)
          : geometry.kind === "lineSegment"
            ? buildLineEdge(
                oc,
                resolveProfileVertex(segment.start, segment.startPointId),
                resolveProfileVertex(segment.end, segment.endPointId),
              )
            : buildArcEdge(
                oc,
                plane,
                geometry as Extract<
                  SolvedSketchEntityGeometryRecord,
                  { kind: "arc" }
                >,
                resolveProfileVertex(segment.start, segment.startPointId),
                resolveProfileVertex(segment.end, segment.endPointId),
              );
      wireBuilder.Add_1(edge);
      provenance.edges.set(segment.entityId, edge);
    }

    if (!wireBuilder.IsDone()) {
      throw new Error(
        `unsupported-profile-group: Open sketch curves ${entityIds.join(", ")} do not build one connected OCC wire.`,
      );
    }

    const wire = wireBuilder.Wire();
    succeeded = true;
    return { wire, plane, normal: plane.frame.normal, provenance };
  } finally {
    deleteOccObject(wireBuilder);
    if (!succeeded) {
      releaseProfileProvenance(provenance);
    }
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
