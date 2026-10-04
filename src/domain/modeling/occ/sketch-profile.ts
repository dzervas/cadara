import type {
  RegionBoundarySource,
  RegionBoundaryVertex,
  RegionRecord,
  SolvedSketchEntityGeometryRecord,
  SketchRecord,
} from "@/contracts/sketch/schema";
import {
  regionBoundaryBasisOfRecord,
  resolveRegionBoundaryCurve,
  type RegionBoundaryBasis,
  type ResolvedBoundaryCurve,
} from "@/contracts/sketch/region-boundary-curves";
import type { OwnedCurve } from "@/contracts/sketch/region-interval-geometry";
import {
  declaredJoinClasses,
  type DeclaredJoinClasses,
} from "@/contracts/sketch/region-extraction";
import {
  solvedCubicSpans,
  type SolvedCubicSpan,
  type SplineSpan,
} from "@/contracts/sketch/spline-geometry";
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
import { canonicalArcSupport } from "@/contracts/sketch/canonical-arc-support";
import { assertAcceptedSketchFeatureInput } from "@/domain/modeling/sketch-feature-input";
import { buildConstructionPlaneFromPlanarFace as buildConstructionPlaneFromPlanarFaceFromPlaneUtility } from "@/domain/modeling/occ/planes";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import {
  extractPlanarFaceData,
  mapSketchPointToWorld,
  negate,
  toGpDir,
  toGpPnt,
  type Vec3,
} from "@/domain/modeling/occ/geometry";
import {
  admitCurveEndAtVertex,
  bezierEvaluationScale,
  buildExactArcEdge,
  buildExactBezierEdge,
  buildSketchArcEdge,
  buildVertexLineEdge,
  circleEvaluationScale,
  curveEvaluationRoundingBound,
  edgeBelowKernelResolution,
  evaluateOccBezier,
  evaluateOccCircle,
  OCC_PRECISION_CONFUSION,
  replaceWithReversedEdge,
  sketchCircleSupport,
  withOccTemporaries,
  type OccCircleSupport,
} from "@/domain/modeling/occ/exact-edges";
import {
  createProjectedRegionLoopRejection,
  getProjectedRegionLoopRejectionMessage,
} from "@/domain/modeling/occ/implementation-policy";
import {
  combineOccCleanupError,
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
  | SpanSketchProfileEdgeKey
  | SplitSketchProfileEdgeKey;
/**
 * Key of one neutral cubic span of a spline, projected spline or offset
 * shell source (the region branch's `spanId`; a `whole` branch keeps the
 * bare source key).
 */
export type SpanSketchProfileEdgeKey =
  `${SketchProfileBaseEdgeSourceKey}@${string}`;
/**
 * Distinct key for ONE split piece of a source branch that contributes several
 * boundary segments to the same profile. The ordinal is the region
 * extraction's persisted `sourceSegmentOrdinal` (split-piece position in
 * branch parameter order), never a geometric match, so the key is exact
 * and reproducible. Branches contributing a single segment keep their key.
 */
export type SplitSketchProfileEdgeKey =
  `${SketchProfileBaseEdgeSourceKey | SpanSketchProfileEdgeKey}#${number}`;
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
type OccEdge = InstanceType<OpenCascadeInstance["TopoDS_Edge"]>;

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

/**
 * A malformed region record (ownership, loop structure): a known profile
 * failure, tagged `profile-face-invalid` so the part-mode render reports it as
 * a region diagnostic (review A-4); its message stays the same. Any untagged,
 * unprefixed error is a code fault and is rethrown there.
 */
function profileRecordError(message: string) {
  return Object.assign(new Error(message), {
    code: "profile-face-invalid" as const,
  });
}

function assertRegionBelongsToSketch(
  sketch: SketchRecord,
  region: RegionRecord,
) {
  if (region.ownerSketchId !== sketch.sketchId) {
    throw profileRecordError(
      `Region ${region.regionId} is owned by sketch ${region.ownerSketchId}, not sketch ${sketch.sketchId}.`,
    );
  }

  if (region.sourceSketch.sketchId !== sketch.sketchId) {
    throw profileRecordError(
      `Region ${region.regionId} sources sketch ${region.sourceSketch.sketchId}, not sketch ${sketch.sketchId}.`,
    );
  }

  if (region.target.sketchId !== sketch.sketchId) {
    throw profileRecordError(
      `Region ${region.regionId} targets sketch ${region.target.sketchId}, not sketch ${sketch.sketchId}.`,
    );
  }
}

/** Closure is structural: consecutive segments share boundary-vertex keys. */
function assertLoopCanBuildProfile(
  region: RegionRecord,
  loop: RegionRecord["loops"][number],
) {
  if (!region.isClosed) {
    throw profileRecordError(`Region ${region.regionId} is not closed.`);
  }

  if (!loop.isClosed) {
    throw profileRecordError(`Region loop ${loop.loopId} is not closed.`);
  }

  if (loop.segments.length === 0) {
    throw profileRecordError(
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
      throw profileRecordError(
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
        throw profileRecordError(
          `Region loop ${loop.loopId} is not closed between segments ${index} and ${(index + 1) % loop.segments.length}.`,
        );
      }
    });
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

function createProfileVertex(
  oc: OpenCascadeInstance,
  position: Vec3,
): OccProfileVertex {
  return withOccTemporaries((own) =>
    own(new oc.BRepBuilderAPI_MakeVertex(own(toGpPnt(oc, position)))).Vertex(),
  );
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
  return withOccTemporaries((own) => {
    const axis = own(
      new oc.gp_Ax2_2(
        own(toGpPnt(oc, center)),
        own(toGpDir(oc, plane.frame.normal)),
        own(toGpDir(oc, plane.frame.xAxis)),
      ),
    );
    const circle = own(new oc.gp_Circ_2(axis, radius));
    return own(new oc.BRepBuilderAPI_MakeEdge_8(circle)).Edge();
  });
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

type RegionBoundarySegment = RegionRecord["loops"][number]["segments"][number];

/** The source key of a segment's branch: its entity or projected geometry, plus its span when not `whole`. */
function getRegionSegmentBaseEdgeKey(
  segment: RegionBoundarySegment,
): SketchProfileBaseEdgeSourceKey | SpanSketchProfileEdgeKey {
  const source = segment.branch.source;
  const base =
    source.kind === "projectedGeometry"
      ? getProjectedSegmentId(source)
      : source.entityId;
  return segment.branch.spanId === "whole"
    ? base
    : `${base}@${segment.branch.spanId}`;
}

/**
 * Resolve the provenance key for one boundary segment's profile edge.
 *
 * A source curve crossed several times by a region boundary contributes
 * SEVERAL wire edges. Keying them all by the bare source id silently
 * overwrites every edge but the last, so the earlier edges' swept faces reach
 * later features with no lineage at all. Each spline (or shell) span keys on
 * its span id, and each split piece of one branch on its
 * `sourceSegmentOrdinal` (split-piece position in source-parameter order).
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

function describeRegionBoundarySource(source: RegionBoundarySource) {
  return source.kind === "entity"
    ? `sketch entity ${source.entityId}`
    : `projected geometry ${source.reference.referenceId}/${source.reference.geometryId}`;
}

/** The source branch a diagnostic names: its source, and its span unless `whole`. */
function describeRegionBoundaryBranch(segment: RegionBoundarySegment) {
  const source = describeRegionBoundarySource(segment.branch.source);
  return segment.branch.spanId === "whole"
    ? source
    : `${source} span ${segment.branch.spanId}`;
}

/**
 * The region-boundary basis of one OCC sketch record (T10b review R-2),
 * through the contracts owner's cached `regionBoundaryBasisOfRecord`. Only a
 * `current` record has consumable regions; a stale or invalid one fails
 * closed.
 */
export function regionBoundaryBasisOfSketchRecord(
  sketch: SketchRecord,
): RegionBoundaryBasis {
  if (sketch.derivedValidity.state !== "current") {
    throw new Error(
      `profile-boundary-unresolved: Sketch ${sketch.sketchId} derived output is ${sketch.derivedValidity.state}; only the regions of a current sketch resolve.`,
    );
  }
  return regionBoundaryBasisOfRecord(sketch);
}

/**
 * Registers one provenance key, failing closed when the key already names a
 * different OCC wrapper (review A-8): an overwrite would drop the earlier
 * wrapper's lineage and leak it.
 */
function bindProvenance<K, V>(map: Map<K, V>, key: K, value: V, what: string) {
  const bound = map.get(key);
  if (bound !== undefined && bound !== value)
    throw new Error(
      `profile-face-invalid: provenance key ${String(key)} would name two different OCC ${what}s.`,
    );
  map.set(key, value);
}

type RegionVertexResolver = (
  vertex: RegionBoundaryVertex,
  endpointKey: SketchProfileVertexSourceKey | null,
) => OccProfileVertex;

/**
 * One OCC vertex per boundary-vertex key for a whole face (outer and inner
 * loops together, so point-touching loops share one `TopoDS_Vertex`; T-4),
 * positioned at the vertex representative (a declared join's realization;
 * never identity). Declared joins register the vertex under every joined
 * authored point id, so side-edge lineage keeps naming it by its sketch
 * points. Vertices left `unregistered` belong to the face build only.
 */
function createRegionVertexResolver(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  provenance: MutableSketchProfileProvenance,
) {
  const byKey = new Map<string, OccProfileVertex>();
  const unregistered = new Set<OccProfileVertex>();
  const resolve: RegionVertexResolver = (vertex, endpointKey) => {
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
      bindProvenance(provenance.vertices, key, occVertex, "vertex");
      unregistered.delete(occVertex);
    }
    return occVertex;
  };
  return { resolve, unregistered };
}

/**
 * Provenance keys of a branch's own endpoints at this segment's low and high
 * source-parameter ends, by the exact-parameter rule: an end whose source
 * parameter is bitwise the branch's own domain end is that branch's
 * endpoint. Lines: the authored (or projected `…:start/:end`) endpoint at
 * t = 0 / 1. Projected arcs (A5): `…:start/:end` at the resolver's own arc
 * draft domain ends [θ_lo, θ_hi] (θ_lo is the start of a counter-clockwise
 * arc, the end of a clockwise one), never OCC parameters (R3). Structural,
 * never proximity.
 */
function branchEndpointKeys(
  sketch: SketchRecord,
  segment: RegionBoundarySegment,
  curve: OwnedCurve,
  projected: ProjectedSketchReferenceGeometry | null,
): {
  low: SketchProfileVertexSourceKey | null;
  high: SketchProfileVertexSourceKey | null;
} {
  const source = segment.branch.source;
  const [a, b] = segment.sourceParameterInterval;
  if (curve.kind === "line") {
    let atZero: SketchProfileVertexSourceKey;
    let atOne: SketchProfileVertexSourceKey;
    if (source.kind === "projectedGeometry") {
      const key = getProjectedSegmentId(source);
      atZero = `${key}:start`;
      atOne = `${key}:end`;
    } else {
      const entity = getSketchEntityDefinition(sketch, source.entityId);
      if (entity.kind !== "lineSegment") return { low: null, high: null };
      atZero = entity.startPointId;
      atOne = entity.endPointId;
    }
    return { low: a === 0 ? atZero : null, high: b === 1 ? atOne : null };
  }
  if (
    curve.kind === "circle" &&
    curve.sourceDomain.kind === "arc" &&
    source.kind === "projectedGeometry" &&
    projected?.kind === "arc"
  ) {
    const key = getProjectedSegmentId(source);
    const [lo, hi] = curve.sourceDomain.interval;
    const counterClockwise = projected.sweepDirection === "counterClockwise";
    return {
      low: a === lo ? `${key}:${counterClockwise ? "start" : "end"}` : null,
      high: b === hi ? `${key}:${counterClockwise ? "end" : "start"}` : null,
    };
  }
  return { low: null, high: null };
}

/**
 * A resolved boundary curve in world space: its point at a kernel parameter
 * (the owner's evaluation of exactly the curve the arrangement certified),
 * the coordinate scale of its points, and an upper bound on its extent over
 * a source-parameter interval (for the intersection caps).
 */
type WorldBoundaryCurve =
  | {
      kind: "line";
      at(parameter: number): Vec3;
      scale: number;
      extent(bounds: readonly [number, number]): number;
    }
  | {
      kind: "circle";
      support: OccCircleSupport;
      at(parameter: number): Vec3;
      scale: number;
      extent(bounds: readonly [number, number]): number;
    }
  | {
      kind: "cubicBezier";
      poles: readonly Vec3[];
      at(parameter: number): Vec3;
      scale: number;
      extent(bounds: readonly [number, number]): number;
    };

function worldBoundaryCurve(
  plane: SketchPlaneDefinition,
  curve: OwnedCurve,
): WorldBoundaryCurve {
  if (curve.kind === "line") {
    const start = mapSketchPointToWorld(plane, curve.start);
    const end = mapSketchPointToWorld(plane, curve.end);
    const length = Math.hypot(
      end[0] - start[0],
      end[1] - start[1],
      end[2] - start[2],
    );
    return {
      kind: "line",
      at: (t) => [
        start[0] + t * (end[0] - start[0]),
        start[1] + t * (end[1] - start[1]),
        start[2] + t * (end[2] - start[2]),
      ],
      scale: Math.max(...start.map(Math.abs), ...end.map(Math.abs)),
      extent: ([low, high]) => length * (high - low),
    };
  }
  if (curve.kind === "circle") {
    // The arrangement's circles all carry xAxis [1, 0]: angles from the
    // sketch's +x, which `sketchCircleSupport` maps to the plane frame.
    const support = sketchCircleSupport(plane, curve.center, curve.radius);
    return {
      kind: "circle",
      support,
      at: (angle) => evaluateOccCircle(support, angle),
      scale: circleEvaluationScale(support),
      extent: ([low, high]) => curve.radius * (high - low),
    };
  }
  const poles = curve.poles.map((pole) => mapSketchPointToWorld(plane, pole));
  // |B'(u)| ≤ 3·max|P_{i+1} − P_i| (hodograph hull), and u = (t − s₀)/(s₁ − s₀).
  const speed =
    3 *
    Math.max(
      ...poles
        .slice(1)
        .map((pole, index) =>
          Math.hypot(
            pole[0] - poles[index]![0],
            pole[1] - poles[index]![1],
            pole[2] - poles[index]![2],
          ),
        ),
    );
  const [s0, s1] = curve.sourceDomain;
  return {
    kind: "cubicBezier",
    poles,
    at: (u) => evaluateOccBezier(poles, u),
    scale: bezierEvaluationScale(poles),
    extent: ([low, high]) => (speed * (high - low)) / (s1 - s0),
  };
}

function isSameBoundaryBranch(
  left: RegionBoundarySegment["branch"],
  right: RegionBoundarySegment["branch"],
) {
  if (left.spanId !== right.spanId) return false;
  const [a, b] = [left.source, right.source];
  if (a.kind === "entity" || b.kind === "entity")
    return (
      a.kind === "entity" && b.kind === "entity" && a.entityId === b.entityId
    );
  return (
    a.reference.referenceId === b.reference.referenceId &&
    a.reference.geometryId === b.reference.geometryId
  );
}

/**
 * The extent of the owner's curve of one witness side over its parameter
 * bounds (plus rounding), read from a record segment of the same basis on
 * that side's branch (for a cubic, the sub-span holding the bounds), or null
 * when no region of the record runs along that branch there.
 */
type WitnessSideExtent = (
  side: Extract<
    RegionBoundaryVertex,
    { kind: "verifiedIntersection" }
  >["witness"]["first"],
) => number | null;

function createWitnessSideExtent(
  plane: SketchPlaneDefinition,
  basis: RegionBoundaryBasis,
): WitnessSideExtent {
  return (side) => {
    const [low, high] = side.parameterBounds;
    for (const region of basis.regions)
      for (const loop of region.loops)
        for (const segment of loop.segments) {
          if (!isSameBoundaryBranch(segment.branch, side.branch)) continue;
          const resolved = resolveRegionBoundaryCurve(basis, segment);
          if (resolved.kind !== "resolved") continue;
          const { curve } = resolved;
          if (
            curve.kind === "cubicBezier" &&
            !(curve.sourceDomain[0] <= low && high <= curve.sourceDomain[1])
          )
            continue;
          const world = worldBoundaryCurve(plane, curve);
          return (
            world.extent(side.parameterBounds) +
            curveEvaluationRoundingBound(world.scale)
          );
        }
    return null;
  };
}

/**
 * The largest gap a boundary vertex may absorb at one edge end (T10 T-3):
 * - a declared join: its certified ball, min(ballRadius, τ) (a class with
 *   more than two members carries its largest pair ball, so the cap is that
 *   radius; a member end further away fails closed);
 * - a verified intersection (R6, review A-1): the crossing lies on both
 *   witness curves over their parameter bounds, so a representative on
 *   either curve there is within ext_this + ext_other of this end's curve
 *   value: the extent of this curve over the side on this branch whose
 *   bounds hold the end's source parameter (mod 2π for a circle), plus the
 *   other side's curve extent over its bounds, plus rounding, clamped at τ.
 *   τ is the backstop: when no witness side is on this branch (an overlap
 *   end named by another branch) or the other side's curve is not in this
 *   record's regions.
 */
function regionVertexGapCap(
  segment: RegionBoundarySegment,
  vertex: RegionBoundaryVertex,
  parameter: number,
  curve: WorldBoundaryCurve,
  witnessSideExtent: WitnessSideExtent,
  tolerance: number,
) {
  if (vertex.kind === "declaredJoin")
    return Math.min(vertex.ballRadius, tolerance);
  const shifts = curve.kind === "circle" ? [0, -2 * Math.PI, 2 * Math.PI] : [0];
  const holds = ([low, high]: readonly [number, number]) =>
    shifts.some(
      (shift) => low <= parameter + shift && parameter + shift <= high,
    );
  const sides = [vertex.witness.first, vertex.witness.second] as const;
  const caps = sides.flatMap((side, index) => {
    if (
      !isSameBoundaryBranch(side.branch, segment.branch) ||
      !holds(side.parameterBounds)
    )
      return [];
    const other = witnessSideExtent(sides[1 - index]!);
    return [
      other === null
        ? tolerance
        : curve.extent(side.parameterBounds) +
          curveEvaluationRoundingBound(curve.scale) +
          other,
    ];
  });
  return caps.length === 0 ? tolerance : Math.min(Math.max(...caps), tolerance);
}

/**
 * The exact edge of one boundary segment (T10 §2.2): the resolver's curve,
 * forward over its kernel interval between the face's low and high
 * vertices, reversed for a reverse traversal. Lines run through their two
 * vertices (built start → end, as traversed); arcs and split circles are the
 * source circle at its source angles; an unsplit circle is the full
 * `gp_Circ`, a circle touching the boundary at one vertex the full turn
 * through that vertex; a cubic span (ordinary, projected or shell sub-span)
 * is its Bézier poles trimmed by the edge range. Every edge end first
 * admits its exact curve value at its vertex under the vertex's cap.
 */
function buildRegionSegmentEdge(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  sketch: SketchRecord,
  segment: RegionBoundarySegment,
  resolved: ResolvedBoundaryCurve,
  projected: ProjectedSketchReferenceGeometry | null,
  resolve: RegionVertexResolver,
  witnessSideExtent: WitnessSideExtent,
  tolerance: number,
): OccEdge {
  const label = describeRegionBoundaryBranch(segment);
  if ((segment.start === null) !== (segment.end === null)) {
    throw profileRecordError(
      `Boundary segment of ${label} has exactly one null end; only an unsplit closed branch has no boundary vertices.`,
    );
  }
  const curve = worldBoundaryCurve(plane, resolved.curve);
  const forward = resolved.traversal === "forward";
  if (
    curve.kind === "circle" &&
    !(curve.support.radius >= OCC_PRECISION_CONFUSION)
  ) {
    throw edgeBelowKernelResolution(
      label,
      `has radius ${curve.support.radius}, below OCC's Precision::Confusion (${OCC_PRECISION_CONFUSION})`,
    );
  }

  if (segment.start === null || segment.end === null) {
    if (curve.kind !== "circle") {
      throw profileRecordError(`Boundary ${label} has no boundary vertices.`);
    }
    // An unsplit full circle: its own seam vertex.
    const edge = buildCircleEdgeFromSketchGeometry(
      oc,
      plane,
      (resolved.curve as Extract<OwnedCurve, { kind: "circle" }>).center,
      curve.support.radius,
    );
    return forward ? edge : replaceWithReversedEdge(oc, edge);
  }

  const ends = forward
    ? { low: segment.start, high: segment.end }
    : { low: segment.end, high: segment.start };
  const keys = branchEndpointKeys(sketch, segment, resolved.curve, projected);
  const vertices = {
    low: resolve(ends.low, keys.low),
    high: resolve(ends.high, keys.high),
  };
  const kernel = resolved.kernelInterval;
  const source = resolved.sourceInterval;
  for (const [vertex, occVertex, kernelParameter, sourceParameter] of [
    [ends.low, vertices.low, kernel[0], source[0]],
    [ends.high, vertices.high, kernel[1], source[1]],
  ] as const) {
    admitCurveEndAtVertex(
      oc,
      occVertex,
      curve.at(kernelParameter),
      regionVertexGapCap(
        segment,
        vertex,
        sourceParameter,
        curve,
        witnessSideExtent,
        tolerance,
      ),
      curve.scale,
      label,
    );
  }

  if (curve.kind === "line") {
    return forward
      ? buildVertexLineEdge(oc, vertices.low, vertices.high, label)
      : buildVertexLineEdge(oc, vertices.high, vertices.low, label);
  }
  const edge =
    curve.kind === "circle"
      ? buildExactArcEdge(oc, curve.support, kernel, label, vertices)
      : buildExactBezierEdge(oc, curve.poles, kernel, label, vertices);
  return forward ? edge : replaceWithReversedEdge(oc, edge);
}

function buildLoopWire(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  sketch: SketchRecord,
  basis: RegionBoundaryBasis,
  loop: RegionRecord["loops"][number],
  provenance: MutableSketchProfileProvenance,
  resolveSegmentEdgeKey: (
    segment: RegionBoundarySegment,
  ) => SketchProfileEdgeSourceKey,
  resolveVertex: RegionVertexResolver,
  witnessSideExtent: WitnessSideExtent,
  tolerance: number,
) {
  return withOccTemporaries((own) => {
    const wireBuilder = own(new oc.BRepBuilderAPI_MakeWire_1());
    for (const segment of loop.segments) {
      const source = segment.branch.source;
      const projected =
        source.kind === "projectedGeometry"
          ? resolveProjectedBoundaryGeometry(
              sketch,
              sketch.projectedReferences ?? [],
              source,
            )
          : null;
      const resolved = resolveRegionBoundaryCurve(basis, segment);
      if (resolved.kind === "failed") throw new Error(resolved.message);
      const edge = buildRegionSegmentEdge(
        oc,
        plane,
        sketch,
        segment,
        resolved,
        projected,
        resolveVertex,
        witnessSideExtent,
        tolerance,
      );
      try {
        bindProvenance(
          provenance.edges,
          resolveSegmentEdgeKey(segment),
          edge,
          "edge",
        );
      } catch (error) {
        try {
          releaseOccObjects([edge]);
        } catch (cleanupError) {
          throw combineOccCleanupError(error, cleanupError);
        }
        throw error;
      }
      wireBuilder.Add_1(edge);
    }

    if (!wireBuilder.IsDone()) {
      throw new Error(
        `profile-wire-invalid: OCC did not build the wire of region loop ${loop.loopId}.`,
      );
    }

    return wireBuilder.Wire();
  });
}

/** `profile-face-invalid` unless OCC's full geometric check accepts the face. */
function assertValidProfileFace(
  oc: OpenCascadeInstance,
  face: InstanceType<OpenCascadeInstance["TopoDS_Face"]>,
  region: RegionRecord,
) {
  const valid = withOccTemporaries((own) =>
    own(new oc.BRepCheck_Analyzer(face, true, false)).IsValid_2(),
  );
  if (!valid) {
    throw new Error(
      `profile-face-invalid: BRepCheck_Analyzer rejects the OCC face of region ${region.regionId}.`,
    );
  }
}

/**
 * The exact OCC face of one region of a current sketch record (T10 §2.2):
 * every segment resolves through the record's own region-boundary basis
 * (`regionBoundaryBasisOfSketchRecord`), so `region` must be one of
 * `sketch.regions`. One vertex resolver serves the whole face, so loops that
 * touch at a point share one `TopoDS_Vertex` (T-4). No healing: the wire and
 * face must be done and `BRepCheck_Analyzer(face, true, false)` must accept
 * the face, otherwise the build fails closed (`profile-wire-invalid`,
 * `profile-face-invalid`).
 */
export function buildRegionProfileFace(
  oc: OpenCascadeInstance,
  snapshotSketch: {
    plane: SketchPlaneDefinition;
    sketch: SketchRecord;
    /** The document's settings.modelingTolerance (τ): the vertex-gap backstop. */
    modelingTolerance: number;
  },
  region: RegionRecord,
): BuiltSketchProfileFace {
  const sketch = snapshotSketch.sketch;
  assertRegionBelongsToSketch(sketch, region);

  const outerLoops = region.loops.filter((loop) => loop.role === "outer");

  if (outerLoops.length !== 1) {
    throw profileRecordError(
      `Region ${region.regionId} must contain exactly one outer loop.`,
    );
  }

  const [outerLoop] = outerLoops;
  const innerLoops = region.loops.filter((loop) => loop.role === "inner");
  for (const loop of [outerLoop!, ...innerLoops]) {
    assertLoopCanBuildProfile(region, loop);
  }
  const basis = regionBoundaryBasisOfSketchRecord(sketch);

  const plane = snapshotSketch.plane;
  const provenance: MutableSketchProfileProvenance = {
    edges: new Map(),
    vertices: new Map(),
  };
  const resolveSegmentEdgeKey = createRegionSegmentEdgeKeyResolver([
    outerLoop!,
    ...innerLoops,
  ]);
  const vertices = createRegionVertexResolver(oc, plane, provenance);
  const witnessSideExtent = createWitnessSideExtent(plane, basis);
  let outerWire: ReturnType<typeof buildLoopWire> | null = null;
  let faceBuilder: {
    Add(wire: unknown): void;
    Face(): InstanceType<OpenCascadeInstance["TopoDS_Face"]>;
    IsDone(): boolean;
    delete?: () => void;
  } | null = null;
  let face: InstanceType<OpenCascadeInstance["TopoDS_Face"]> | null = null;

  let result: BuiltSketchProfileFace;
  try {
    outerWire = buildLoopWire(
      oc,
      plane,
      sketch,
      basis,
      outerLoop!,
      provenance,
      resolveSegmentEdgeKey,
      vertices.resolve,
      witnessSideExtent,
      snapshotSketch.modelingTolerance,
    );
    faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(outerWire, true);

    for (const innerLoop of innerLoops) {
      const innerWire = buildLoopWire(
        oc,
        plane,
        sketch,
        basis,
        innerLoop,
        provenance,
        resolveSegmentEdgeKey,
        vertices.resolve,
        witnessSideExtent,
        snapshotSketch.modelingTolerance,
      );
      const builder = faceBuilder;
      withOccTemporaries((own) => builder.Add(own(innerWire)));
    }

    if (!faceBuilder.IsDone()) {
      throw new Error(
        `profile-face-invalid: OCC did not build the face of region ${region.regionId}.`,
      );
    }

    face = faceBuilder.Face();
    assertValidProfileFace(oc, face, region);
    result = {
      face,
      plane,
      normal: plane.frame.normal,
      provenance,
    };
  } catch (error) {
    try {
      releaseOccObjects([
        ...(face ? [face] : []),
        ...(faceBuilder ? [faceBuilder] : []),
        ...(outerWire ? [outerWire] : []),
        ...vertices.unregistered,
        ...provenance.edges.values(),
        ...provenance.vertices.values(),
      ]);
    } catch (cleanupError) {
      throw combineOccCleanupError(error, cleanupError);
    }
    throw error;
  }

  try {
    // Unregistered vertices are face-build temporaries; registered ones are
    // released with the profile provenance.
    releaseOccObjects([
      ...(faceBuilder ? [faceBuilder] : []),
      ...(outerWire ? [outerWire] : []),
      ...vertices.unregistered,
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

/**
 * Outer boundary wire of a closed region, without face construction (the
 * same exact edges as `buildRegionProfileFace`, so `region` must be one of
 * the current `sketch.regions`).
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
    /** The document's settings.modelingTolerance (τ): the vertex-gap backstop. */
    modelingTolerance: number;
  },
  region: RegionRecord,
): BuiltSketchProfileWire {
  const sketch = snapshotSketch.sketch;
  assertRegionBelongsToSketch(sketch, region);

  const outerLoops = region.loops.filter((loop) => loop.role === "outer");

  if (outerLoops.length !== 1) {
    throw profileRecordError(
      `Region ${region.regionId} must contain exactly one outer loop.`,
    );
  }

  const [outerLoop] = outerLoops;
  assertLoopCanBuildProfile(region, outerLoop!);
  const basis = regionBoundaryBasisOfSketchRecord(sketch);

  const plane = snapshotSketch.plane;
  const provenance: MutableSketchProfileProvenance = {
    edges: new Map(),
    vertices: new Map(),
  };
  const vertices = createRegionVertexResolver(oc, plane, provenance);

  let result: BuiltSketchProfileWire;
  try {
    const wire = buildLoopWire(
      oc,
      plane,
      sketch,
      basis,
      outerLoop!,
      provenance,
      createRegionSegmentEdgeKeyResolver([outerLoop!]),
      vertices.resolve,
      createWitnessSideExtent(plane, basis),
      snapshotSketch.modelingTolerance,
    );
    result = { wire, plane, normal: plane.frame.normal, provenance };
  } catch (error) {
    try {
      releaseOccObjects([
        ...vertices.unregistered,
        ...provenance.edges.values(),
        ...provenance.vertices.values(),
      ]);
    } catch (cleanupError) {
      throw combineOccCleanupError(error, cleanupError);
    }
    throw error;
  }
  try {
    releaseOccObjects([...vertices.unregistered]);
  } catch (cleanupError) {
    try {
      releaseOccObjects([
        result.wire,
        ...provenance.edges.values(),
        ...provenance.vertices.values(),
      ]);
    } catch (resultCleanupError) {
      throw combineOccCleanupError(cleanupError, resultCleanupError);
    }
    throw cleanupError;
  }
  return result;
}

/** One end of an open profile curve: its authored point and that point's declared-join class. */
interface OpenCurveEnd {
  pointId: SketchPointId;
  classRoot: string;
}

/**
 * One selected open-profile curve: a full circle (no ends; it must be the
 * only curve), or a line, arc or valid spline with its two authored end
 * points. A spline also carries its interior knots, whose classes may not be
 * any chain end's (a curve end joined to a knot is a branch).
 */
type OpenProfileCurve =
  | {
      kind: "circle";
      entityId: SketchEntityId;
      geometry: Extract<SolvedSketchEntityGeometryRecord, { kind: "circle" }>;
    }
  | {
      kind: "lineSegment";
      entityId: SketchEntityId;
      geometry: Extract<
        SolvedSketchEntityGeometryRecord,
        { kind: "lineSegment" }
      >;
      start: OpenCurveEnd;
      end: OpenCurveEnd;
    }
  | {
      kind: "arc";
      entityId: SketchEntityId;
      geometry: Extract<SolvedSketchEntityGeometryRecord, { kind: "arc" }>;
      start: OpenCurveEnd;
      end: OpenCurveEnd;
    }
  | {
      kind: "spline";
      entityId: SketchEntityId;
      /** The solved reconstruction's spans (`solvedCubicSpans` poles) with their knot provenance. */
      spans: readonly {
        poles: SolvedCubicSpan["poles"];
        source: SplineSpan["source"];
      }[];
      knots: readonly OpenCurveEnd[];
      start: OpenCurveEnd;
      end: OpenCurveEnd;
    };

function resolveOpenProfileCurve(
  sketch: SketchRecord,
  classes: DeclaredJoinClasses,
  entityId: SketchEntityId,
): OpenProfileCurve {
  // [TECH] G19: a non-accepted offset output is not modeling input.
  assertAcceptedSketchFeatureInput(sketch, entityId, "an open profile curve");
  const geometry = getSolvedEntityGeometry(sketch, entityId);
  assertLoopSegmentOwnership(sketch, geometry);

  if (geometry.kind === "circle") return { kind: "circle", entityId, geometry };

  const entity = getSketchEntityDefinition(sketch, entityId);
  if (entity.kind !== geometry.kind) {
    throw new Error(
      `Solved entity ${entityId} does not match its authored entity kind.`,
    );
  }
  const end = (pointId: string): OpenCurveEnd => ({
    pointId: pointId as SketchPointId,
    classRoot: classes.find(pointId),
  });

  if (geometry.kind === "lineSegment" && entity.kind === "lineSegment")
    return {
      kind: "lineSegment",
      entityId,
      geometry,
      start: end(entity.startPointId),
      end: end(entity.endPointId),
    };
  if (geometry.kind === "arc" && entity.kind === "arc")
    return {
      kind: "arc",
      entityId,
      geometry,
      start: end(entity.startPointId),
      end: end(entity.endPointId),
    };
  if (geometry.kind === "spline") {
    const reconstruction = geometry.reconstruction;
    if (reconstruction.validity !== "valid")
      throw new Error(
        `unsupported-profile-group: Sketch entity ${entityId} has an invalid spline reconstruction (${reconstruction.diagnostics.map((diagnostic) => diagnostic.code).join(", ")}) and cannot be part of an open sketch-curve chain.`,
      );
    const poles = solvedCubicSpans(geometry);
    const spans = reconstruction.spans.map((span, index) => ({
      poles: poles[index]!.poles,
      source: span.source,
    }));
    return {
      kind: "spline",
      entityId,
      spans,
      knots: spans.slice(1).map((span) => end(span.source.startPointId)),
      start: end(spans[0]!.source.startPointId),
      end: end(spans[spans.length - 1]!.source.endPointId),
    };
  }

  throw new Error(
    `unsupported-profile-group: Sketch entity ${entityId} of kind ${geometry.kind} cannot be part of an open sketch-curve chain.`,
  );
}

/**
 * Structural chain check and wire order (T10d, user decision 2026-09-28):
 * curve ends connect only where they share a declared-join class (a shared
 * point id or a satisfied `coincident` / `coincidentProjectedPoint`;
 * `declaredJoinClasses`). Endpoint distance never connects. A class touched
 * by more than two curve ends, or by a curve end and a spline's interior
 * knot, branches. Otherwise the curves are placed so each one after the
 * first shares a class with the curves already placed; a curve that shares
 * none is disconnected. Nothing is sewn or bridged.
 */
function orderOpenProfileChain(curves: readonly OpenProfileCurve[]) {
  if (curves.length > 1 && curves.some((curve) => curve.kind === "circle")) {
    throw new Error(
      "unsupported-profile-group: A closed sketch curve cannot be chained with other open sketch curves.",
    );
  }
  const names = (list: readonly OpenProfileCurve[]) =>
    list.map((curve) => curve.entityId).join(", ");
  const ends = (curve: OpenProfileCurve) =>
    curve.kind === "circle" ? [] : [curve.start, curve.end];
  const degree = new Map<string, number>();
  for (const end of curves.flatMap(ends))
    degree.set(end.classRoot, (degree.get(end.classRoot) ?? 0) + 1);
  if (
    [...degree.values()].some((count) => count > 2) ||
    curves.some(
      (curve) =>
        curve.kind === "spline" &&
        curve.knots.some((knot) => degree.has(knot.classRoot)),
    )
  ) {
    throw new Error(
      `unsupported-profile-group: Open sketch curves ${names(curves)} branch at a declared join and do not form one sweepable chain.`,
    );
  }

  const remaining = [...curves];
  const ordered = [remaining.shift()!];
  const placed = new Set(ends(ordered[0]!).map((end) => end.classRoot));
  while (remaining.length > 0) {
    const index = remaining.findIndex((curve) =>
      ends(curve).some((end) => placed.has(end.classRoot)),
    );
    if (index < 0) {
      throw new Error(
        `unsupported-profile-group: Open sketch curves ${names(remaining)} are not connected to the rest of the open sketch-curve chain: curve ends connect only through a shared point or a satisfied coincident constraint.`,
      );
    }
    const [curve] = remaining.splice(index, 1);
    ordered.push(curve!);
    for (const end of ends(curve!)) placed.add(end.classRoot);
  }
  return ordered;
}

/** The lexicographically smallest member point of each declared-join class. */
function classRepresentativePoints(
  sketch: SketchRecord,
  classes: DeclaredJoinClasses,
) {
  const smallest = new Map<string, SketchPointId>();
  for (const { pointId } of sketch.definition.points) {
    const root = classes.find(pointId);
    const current = smallest.get(root);
    if (current === undefined || pointId < current) smallest.set(root, pointId);
  }
  return smallest;
}

/**
 * One wire built from durable open sketch-curve refs (surface extrude and
 * revolve profiles, sweep paths).
 *
 * The submitted curves must form one structural chain
 * (`orderOpenProfileChain`). Each declared-join class touched by a curve end
 * is one shared `TopoDS_Vertex` at the solved position of the class's
 * lexicographically smallest member point; every curve end admits its exact
 * curve value there with `admitCurveEndAtVertex` capped at τ (a satisfied
 * coincident is within the solve policy, whose tolerance is τ), failing
 * closed above it. Edges are exact: lines through their two vertices, arcs
 * at their source angles, a full circle as one closed edge, and a spline as
 * one Bézier edge per solved span whose interior knots each share one
 * vertex. Edges and vertices carry the provenance keys a region profile
 * would (`<spline>@<span>` per span; vertices by their authored point ids),
 * so sheet topology stays nameable.
 */
export function buildOpenSketchCurveWire(
  oc: OpenCascadeInstance,
  snapshotSketch: {
    plane: SketchPlaneDefinition;
    sketch: SketchRecord;
    /** The document's settings.modelingTolerance (τ). */
    modelingTolerance: number;
  },
  entityIds: readonly SketchEntityId[],
): BuiltSketchProfileWire {
  if (entityIds.length === 0) {
    throw new Error(
      "unsupported-profile-group: An open sketch-curve chain requires at least one sketch entity.",
    );
  }

  if (new Set(entityIds).size !== entityIds.length) {
    throw new Error(
      "unsupported-profile-group: An open sketch-curve chain must not repeat a sketch entity.",
    );
  }

  const plane = snapshotSketch.plane;
  const sketch = snapshotSketch.sketch;
  const tolerance = snapshotSketch.modelingTolerance;
  const classes = declaredJoinClasses(sketch.definition, sketch.solvedSnapshot);
  const ordered = orderOpenProfileChain(
    entityIds.map((entityId) =>
      resolveOpenProfileCurve(sketch, classes, entityId),
    ),
  );
  const representatives = classRepresentativePoints(sketch, classes);

  const provenance: MutableSketchProfileProvenance = {
    edges: new Map(),
    vertices: new Map(),
  };
  // Every vertex and edge made here: released with the provenance on failure.
  const created: (OccProfileVertex | OccEdge)[] = [];
  const classVertices = new Map<string, OccProfileVertex>();
  const endVertex = (end: OpenCurveEnd) => {
    let vertex = classVertices.get(end.classRoot);
    if (!vertex) {
      vertex = createProfileVertex(
        oc,
        getSolvedBoundaryPointPosition(
          plane,
          sketch,
          representatives.get(end.classRoot) ?? end.pointId,
        ),
      );
      created.push(vertex);
      classVertices.set(end.classRoot, vertex);
    }
    bindProvenance(provenance.vertices, end.pointId, vertex, "vertex");
    return vertex;
  };
  const knotVertex = (knot: OpenCurveEnd, position: Vec3) => {
    const vertex = createProfileVertex(oc, position);
    created.push(vertex);
    bindProvenance(provenance.vertices, knot.pointId, vertex, "vertex");
    return vertex;
  };
  const addEdge = (key: SketchProfileEdgeSourceKey, edge: OccEdge) => {
    created.push(edge);
    bindProvenance(provenance.edges, key, edge, "edge");
    return edge;
  };

  const curveEdges = (curve: OpenProfileCurve): OccEdge[] => {
    const label = `sketch entity ${curve.entityId}`;
    switch (curve.kind) {
      case "circle":
        return [
          addEdge(curve.entityId, buildCircleEdge(oc, plane, curve.geometry)),
        ];
      case "lineSegment": {
        const start = mapSketchPointToWorld(
          plane,
          curve.geometry.startPosition,
        );
        const end = mapSketchPointToWorld(plane, curve.geometry.endPosition);
        const scale = Math.max(...start.map(Math.abs), ...end.map(Math.abs));
        const vertices = [
          endVertex(curve.start),
          endVertex(curve.end),
        ] as const;
        admitCurveEndAtVertex(oc, vertices[0], start, tolerance, scale, label);
        admitCurveEndAtVertex(oc, vertices[1], end, tolerance, scale, label);
        return [
          addEdge(
            curve.entityId,
            buildVertexLineEdge(oc, vertices[0], vertices[1], label),
          ),
        ];
      }
      case "arc":
        return [
          addEdge(
            curve.entityId,
            buildSketchArcEdge(
              oc,
              plane,
              canonicalArcSupport(
                curve.geometry.centerPosition,
                curve.geometry.startPosition,
                curve.geometry.endPosition,
                curve.geometry.sweepDirection,
              ),
              label,
              {
                start: endVertex(curve.start),
                end: endVertex(curve.end),
                cap: tolerance,
              },
            ),
          ),
        ];
      case "spline": {
        let low = endVertex(curve.start);
        const last = curve.spans.length - 1;
        return curve.spans.map((span, index) => {
          const spanId = `${span.source.startOccurrenceId}>${span.source.endOccurrenceId}`;
          const spanLabel = `${label} span ${spanId}`;
          const poles = span.poles.map((pole) =>
            mapSketchPointToWorld(plane, pole),
          );
          const high =
            index === last
              ? endVertex(curve.end)
              : knotVertex(curve.knots[index]!, poles[3]!);
          const scale = bezierEvaluationScale(poles);
          admitCurveEndAtVertex(
            oc,
            low,
            poles[0]!,
            tolerance,
            scale,
            spanLabel,
          );
          admitCurveEndAtVertex(
            oc,
            high,
            poles[3]!,
            tolerance,
            scale,
            spanLabel,
          );
          const edge = addEdge(
            `${curve.entityId}@${spanId}`,
            buildExactBezierEdge(oc, poles, [0, 1], spanLabel, { low, high }),
          );
          low = high;
          return edge;
        });
      }
    }
  };

  try {
    const wire = withOccTemporaries((own) => {
      const wireBuilder = own(new oc.BRepBuilderAPI_MakeWire_1());
      for (const curve of ordered)
        for (const edge of curveEdges(curve)) wireBuilder.Add_1(edge);
      if (!wireBuilder.IsDone()) {
        throw new Error(
          `unsupported-profile-group: Open sketch curves ${entityIds.join(", ")} do not build one connected OCC wire.`,
        );
      }
      return wireBuilder.Wire();
    });
    return { wire, plane, normal: plane.frame.normal, provenance };
  } catch (error) {
    try {
      releaseOccObjects([
        ...new Set([
          ...created,
          ...provenance.edges.values(),
          ...provenance.vertices.values(),
        ]),
      ]);
    } catch (cleanupError) {
      throw combineOccCleanupError(error, cleanupError);
    }
    throw error;
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
