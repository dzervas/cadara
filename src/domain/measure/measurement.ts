import type {
  WorkspaceSnapshot,
  SketchSnapshotRecord,
} from "@/contracts/modeling/schema";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import type {
  RenderMeshGeometry,
  RenderPoint3D,
  RenderableEntityRecord,
} from "@/contracts/render/schema";
import {
  projectedSplineIsClosed,
  type ProjectedSketchArcGeometry,
  type ProjectedSketchCircleGeometry,
} from "@/contracts/solver/schema";
import {
  isAcceptedOffsetOutput,
  nonAcceptedOffsetOutputPoints,
} from "@/contracts/sketch/offset-publication";
import {
  boundaryLoopSignedArea,
  createRegionBoundaryBasis,
  curveLength,
  resolveRegionBoundaryCurve,
  tessellateBoundaryLoop,
  type BoundaryCurveFailure,
  type RegionBoundaryBasis,
} from "@/contracts/sketch/region-boundary-curves";
import type {
  RegionRecord,
  SketchPoint2D,
  SketchRecord,
} from "@/contracts/sketch/schema";
import {
  closestSplineSpanLocation,
  reconstructSplineAggregate,
  tessellateCubicSpans,
  tessellateProjectedSpline,
  solvedCubicSpanLocalDomain,
  solvedCubicSpanPoint,
  solvedCubicSpans,
  type SplinePoles,
} from "@/contracts/sketch/spline-geometry";
import {
  getPrimitiveRefKey,
  getPrimitiveRefLabel,
  primitiveRefEquals,
  type PrimitiveRef,
} from "@/core/editor/schema";
import {
  mapSketchPointToWorkspaceWorld,
  mapWorldPointToWorkspaceSketch,
  type WorkspaceVec3,
} from "@/core/workspace/sketch-plane-mapping";

export interface MeasurementRow {
  id: string;
  label: string;
  value: string;
}

export interface MeasurementWitnessPolyline {
  id: string;
  kind: "polyline";
  points: readonly RenderPoint3D[];
  isClosed: boolean;
}

export interface MeasurementWitnessMarker {
  id: string;
  kind: "marker";
  position: RenderPoint3D;
  radius: number;
}

export type MeasurementWitness =
  | MeasurementWitnessPolyline
  | MeasurementWitnessMarker;

export interface MeasurementViewModel {
  title: string;
  subtitle: string;
  rows: readonly MeasurementRow[];
  note: string | null;
  witnesses: readonly MeasurementWitness[];
}

type MeasuredTargetCategory = "body" | "surface" | "curve" | "point";
/**
 * A distance primitive. `exact` marks a polyline that tessellates a curved
 * sketch curve: point distances use the exact curve, every other pairing
 * measures the tessellation and is labelled approximate (T-6, review R7).
 * `approximate` marks a mesh built from such a tessellation (a region fill).
 */
type DistancePrimitive =
  | { kind: "point"; point: WorkspaceVec3 }
  | {
      kind: "polyline";
      points: readonly WorkspaceVec3[];
      exact?: ExactSketchCurve;
    }
  | { kind: "mesh"; triangles: readonly Triangle[]; approximate?: boolean };

/** A curved sketch curve in its plane, for exact closest points. */
interface ExactSketchCurve {
  plane: SketchPlaneDefinition;
  curve:
    | {
        kind: "arc";
        center: SketchPoint2D;
        radius: number;
        /** Counter-clockwise radian interval, from < to ≤ from + 2π. */
        from: number;
        to: number;
      }
    | {
        kind: "cubics";
        spans: readonly SplinePoles[];
        /** Local drawn domain per span (absent: each whole span). */
        domains?: readonly (readonly [number, number])[];
      };
}

interface Triangle {
  first: WorkspaceVec3;
  second: WorkspaceVec3;
  third: WorkspaceVec3;
}

interface MeasuredTarget {
  target: PrimitiveRef;
  key: string;
  label: string;
  category: MeasuredTargetCategory;
  distancePrimitive: DistancePrimitive | null;
  rows: readonly MeasurementRow[];
  note: string | null;
  witnesses: readonly MeasurementWitness[];
}

interface PairwiseDistanceResult {
  distance: number;
  start: WorkspaceVec3;
  end: WorkspaceVec3;
  /** Measured on a tessellation of a curved sketch shape (shown with "≈"). */
  approximate?: boolean;
}

const CIRCLE_SEGMENTS = 48;
const ARC_SEGMENTS = 32;
const SPLINE_SEGMENTS = 48;
const WITNESS_MARKER_RADIUS = 0.16;
const DISTANCE_EPSILON = 1e-9;

export function isMeasureSelectableTarget(
  snapshot: WorkspaceSnapshot | null,
  target: PrimitiveRef,
) {
  return resolveMeasuredTarget(snapshot, target) !== null;
}

export function resolveMeasureSelectionCandidate(
  snapshot: WorkspaceSnapshot | null,
  selection: readonly PrimitiveRef[],
  target: PrimitiveRef,
) {
  const nextTarget = resolveMeasuredTarget(snapshot, target);

  if (!nextTarget) {
    return {
      accepted: false,
      nextSelection: [...selection],
      reason: `${getPrimitiveRefLabel(target)} cannot be measured.`,
    };
  }

  if (selection.some((entry) => primitiveRefEquals(entry, target))) {
    return {
      accepted: false,
      nextSelection: [...selection],
      reason: `${nextTarget.label} is already selected.`,
    };
  }

  if (selection.length === 0) {
    return {
      accepted: true,
      nextSelection: [target],
      reason: null,
    };
  }

  const currentTarget = resolveMeasuredTarget(snapshot, selection[0] ?? null);

  if (!currentTarget) {
    return {
      accepted: true,
      nextSelection: [target],
      reason: null,
    };
  }

  if (
    selection.length === 1 &&
    supportsPairwiseMeasurement(currentTarget, nextTarget)
  ) {
    return {
      accepted: true,
      nextSelection: [selection[0]!, target],
      reason: null,
    };
  }

  return {
    accepted: true,
    nextSelection: [target],
    reason: null,
  };
}

export function deriveMeasurementViewModel(input: {
  activeToolId: string | null;
  selection: readonly PrimitiveRef[];
  snapshot: WorkspaceSnapshot | null;
}): MeasurementViewModel | null {
  if (
    input.activeToolId !== "measure" ||
    !input.snapshot ||
    input.selection.length === 0
  ) {
    return null;
  }

  const resolvedSelection = input.selection.slice(0, 2).flatMap((target) => {
    const resolved = resolveMeasuredTarget(input.snapshot, target);
    return resolved ? [resolved] : [];
  });

  if (resolvedSelection.length === 0) {
    return null;
  }

  if (resolvedSelection.length === 1) {
    const target = resolvedSelection[0]!;
    return {
      title: target.label,
      subtitle: "Single target",
      rows: target.rows,
      note: target.note,
      witnesses: target.witnesses,
    };
  }

  const [first, second] = resolvedSelection;
  const pairwise = supportsPairwiseMeasurement(first!, second!)
    ? measurePairwiseDistance(first!, second!)
    : null;

  const rows = pairwise
    ? [
        {
          id: "distance",
          label: "Distance",
          value: formatLength(pairwise.distance, pairwise.approximate),
        },
        ...resolvePairwiseAngleRow(first!, second!),
      ]
    : [];

  const note = pairwise
    ? null
    : "Select a supported point, edge, face, or profile target pair to inspect distance.";

  return {
    title: `${first!.label} + ${second!.label}`,
    subtitle: "Two targets",
    rows,
    note,
    witnesses: derivePairwiseWitnesses(first!, second!, pairwise),
  };
}

function resolveMeasuredTarget(
  snapshot: WorkspaceSnapshot | null,
  target: PrimitiveRef | null,
): MeasuredTarget | null {
  if (!snapshot || !target) {
    return null;
  }

  if (target.kind === "body") {
    return resolveBodyTarget(snapshot, target);
  }

  if (target.kind === "face") {
    return resolveFaceTarget(snapshot, target);
  }

  if (target.kind === "edge") {
    return resolveEdgeTarget(snapshot, target);
  }

  if (target.kind === "vertex") {
    return resolveVertexTarget(snapshot, target);
  }

  if (target.kind === "region") {
    return resolveRegionTarget(snapshot, target);
  }

  if (target.kind === "sketchPoint") {
    return resolveSketchPointTarget(snapshot, target);
  }

  if (target.kind === "sketchEntity") {
    return resolveSketchEntityTarget(snapshot, target);
  }

  if (target.kind === "projectedReferenceGeometry") {
    return resolveProjectedGeometryTarget(snapshot, target);
  }

  return null;
}

function resolveBodyTarget(
  snapshot: WorkspaceSnapshot,
  target: Extract<PrimitiveRef, { kind: "body" }>,
): MeasuredTarget | null {
  const body = snapshot.document.bodies.find(
    (entry) => entry.bodyId === target.bodyId,
  );

  if (!body) {
    return null;
  }

  const faceRenderables = getBodyFaceRenderables(snapshot, body.bodyId);
  const edgeRenderables = getBodyEdgeRenderables(snapshot, body.bodyId);
  const bodyTriangles = faceRenderables.flatMap((renderable) =>
    trianglesFromMesh(renderable.geometry),
  );
  const surfaceArea =
    faceRenderables.length === body.topology.faceIds.length
      ? faceRenderables.reduce(
          (sum, renderable) => sum + getMeshArea(renderable.geometry),
          0,
        )
      : null;
  const volume =
    faceRenderables.length === body.topology.faceIds.length &&
    bodyTriangles.length > 0
      ? getClosedMeshVolume(bodyTriangles)
      : null;

  const rows = [
    ...(surfaceArea === null
      ? []
      : [
          {
            id: "surface-area",
            label: "Surface Area",
            value: formatArea(surfaceArea),
          },
        ]),
    ...(volume === null
      ? []
      : [{ id: "volume", label: "Volume", value: formatVolume(volume) }]),
  ];

  const witnesses = edgeRenderables.flatMap((renderable, index) =>
    polylineWitnessFromPoints(
      `${target.bodyId}:edge:${index}`,
      renderable.geometry.points,
      false,
    ),
  );

  return {
    target,
    key: getPrimitiveRefKey(target),
    label: body.label,
    category: "body",
    distancePrimitive: null,
    rows,
    note:
      rows.length > 0
        ? null
        : "Surface area and volume are unavailable for this body in the current snapshot.",
    witnesses,
  };
}

function resolveFaceTarget(
  snapshot: WorkspaceSnapshot,
  target: Extract<PrimitiveRef, { kind: "face" }>,
): MeasuredTarget | null {
  const renderable = getRenderableForTarget(snapshot, target);

  if (!renderable || renderable.geometry.kind !== "mesh") {
    return null;
  }

  const boundaryEdges = collectMeshBoundaryEdges(renderable.geometry);
  const boundaryLoops = groupBoundaryLoops(boundaryEdges);
  const area = getMeshArea(renderable.geometry);
  const perimeter = boundaryEdges.reduce(
    (sum, [start, end]) => sum + distanceBetween(start, end),
    0,
  );
  const rows: MeasurementRow[] = [
    { id: "area", label: "Area", value: formatArea(area) },
    { id: "perimeter", label: "Perimeter", value: formatLength(perimeter) },
    ...boundaryLoops.map((loopLength, index) => ({
      id: `boundary-${index + 1}`,
      label: `Boundary ${index + 1}`,
      value: formatLength(loopLength),
    })),
  ];

  return {
    target,
    key: getPrimitiveRefKey(target),
    label: getTargetLabel(snapshot, target),
    category: "surface",
    distancePrimitive: {
      kind: "mesh",
      triangles: trianglesFromMesh(renderable.geometry),
    },
    rows,
    note: null,
    witnesses: boundaryEdges.map(([start, end], index) => ({
      id: `${target.faceId}:boundary:${index}`,
      kind: "polyline",
      points: [start, end],
      isClosed: false,
    })),
  };
}

function resolveEdgeTarget(
  snapshot: WorkspaceSnapshot,
  target: Extract<PrimitiveRef, { kind: "edge" }>,
): MeasuredTarget | null {
  const renderable = getRenderableForTarget(snapshot, target);

  if (!renderable || renderable.geometry.kind !== "polyline") {
    return null;
  }

  const length = polylineLength(
    renderable.geometry.points,
    renderable.geometry.isClosed,
  );

  return {
    target,
    key: getPrimitiveRefKey(target),
    label: getTargetLabel(snapshot, target),
    category: "curve",
    distancePrimitive: {
      kind: "polyline",
      points: renderable.geometry.points,
    },
    rows: [{ id: "length", label: "Length", value: formatLength(length) }],
    note: null,
    witnesses: [
      {
        id: `${target.edgeId}:witness`,
        kind: "polyline",
        points: renderable.geometry.points,
        isClosed: renderable.geometry.isClosed,
      },
    ],
  };
}

function resolveVertexTarget(
  snapshot: WorkspaceSnapshot,
  target: Extract<PrimitiveRef, { kind: "vertex" }>,
): MeasuredTarget | null {
  const renderable = getRenderableForTarget(snapshot, target);

  if (!renderable || renderable.geometry.kind !== "marker") {
    return null;
  }

  return {
    target,
    key: getPrimitiveRefKey(target),
    label: getTargetLabel(snapshot, target),
    category: "point",
    distancePrimitive: {
      kind: "point",
      point: renderable.geometry.position,
    },
    rows: [],
    note: "Select another measurable target to inspect distance.",
    witnesses: [
      {
        id: `${target.vertexId}:witness`,
        kind: "marker",
        position: renderable.geometry.position,
        radius: WITNESS_MARKER_RADIUS,
      },
    ],
  };
}

function resolveRegionTarget(
  snapshot: WorkspaceSnapshot,
  target: Extract<PrimitiveRef, { kind: "region" }>,
): MeasuredTarget | null {
  const sketch = snapshot.document.sketches.find(
    (entry) => entry.sketchId === target.sketchId,
  );
  const region = sketch?.sketch.regions.find(
    (entry) => entry.regionId === target.regionId,
  );

  if (!sketch || !region) {
    return null;
  }

  const measured = measureSketchRegion(sketch, region);
  if (measured.kind === "failed") {
    return {
      target,
      key: getPrimitiveRefKey(target),
      label: getTargetLabel(snapshot, target),
      category: "surface",
      distancePrimitive: null,
      rows: [],
      note: `Region boundary geometry is unavailable: ${measured.message}`,
      witnesses: [],
    };
  }
  const witnesses = measured.loops.map((entry, index) => ({
    id: `${target.regionId}:loop:${index}`,
    kind: "polyline" as const,
    points: entry.polygon.map((point) =>
      mapSketchPointToWorkspaceWorld(sketch.plane, point),
    ),
    isClosed: true,
  }));

  return {
    target,
    key: getPrimitiveRefKey(target),
    label: getTargetLabel(snapshot, target),
    category: "surface",
    distancePrimitive:
      measured.area > DISTANCE_EPSILON
        ? {
            kind: "mesh",
            triangles: triangulateLoopFan(witnesses[0]?.points ?? []),
            approximate: true,
          }
        : null,
    rows: [
      { id: "area", label: "Area", value: formatArea(measured.area) },
      {
        id: "perimeter",
        label: "Perimeter",
        value: formatLength(measured.perimeter, measured.approximate),
      },
      ...measured.loops.map((entry, index) => ({
        id: `boundary-${index + 1}`,
        label: `Boundary ${index + 1}`,
        value: formatLength(entry.length, entry.approximate),
      })),
    ],
    note: null,
    witnesses,
  };
}

function resolveSketchPointTarget(
  snapshot: WorkspaceSnapshot,
  target: Extract<PrimitiveRef, { kind: "sketchPoint" }>,
): MeasuredTarget | null {
  const sketch = snapshot.document.sketches.find(
    (entry) => entry.sketchId === target.sketchId,
  );
  const point = sketch?.sketch.definition.points.find(
    (entry) => entry.pointId === target.pointId,
  );

  if (!sketch || !point) {
    return null;
  }

  // [TECH] G19b: a driven point of a non-accepted offset output is not
  // measurable, like its output.
  if (
    nonAcceptedOffsetOutputPoints(
      sketch.sketch.definition,
      sketch.sketch.solvedSnapshot,
    ).has(point.pointId)
  ) {
    return null;
  }

  const position = mapSketchPointToWorkspaceWorld(sketch.plane, point.position);

  return {
    target,
    key: getPrimitiveRefKey(target),
    label: point.label,
    category: "point",
    distancePrimitive: {
      kind: "point",
      point: position,
    },
    rows: [],
    note: "Select another measurable target to inspect distance.",
    witnesses: [
      {
        id: `${target.pointId}:witness`,
        kind: "marker",
        position,
        radius: WITNESS_MARKER_RADIUS,
      },
    ],
  };
}

function resolveSketchEntityTarget(
  snapshot: WorkspaceSnapshot,
  target: Extract<PrimitiveRef, { kind: "sketchEntity" }>,
): MeasuredTarget | null {
  const sketch = snapshot.document.sketches.find(
    (entry) => entry.sketchId === target.sketchId,
  );
  const entity = sketch?.sketch.definition.entities.find(
    (entry) => entry.entityId === target.entityId,
  );

  if (!sketch || !entity) {
    return null;
  }

  // [TECH] G19: a non-accepted offset output (of a failed or pending
  // relationship, or an uncertified shell) is not measured.
  if (
    !isAcceptedOffsetOutput(
      sketch.sketch.definition,
      sketch.sketch.solvedSnapshot,
      entity.entityId,
    )
  ) {
    return null;
  }

  if (entity.kind === "point") {
    const point = sketch.sketch.definition.points.find(
      (entry) => entry.pointId === entity.pointId,
    );
    return point
      ? resolveSketchPointTarget(snapshot, {
          kind: "sketchPoint",
          sketchId: target.sketchId,
          pointId: point.pointId,
        })
      : null;
  }

  if (entity.kind === "lineSegment") {
    const start = getSketchDefinitionPoint(sketch, entity.startPointId);
    const end = getSketchDefinitionPoint(sketch, entity.endPointId);

    if (!start || !end) {
      return null;
    }

    return createCurveTarget({
      target,
      label: entity.label,
      key: getPrimitiveRefKey(target),
      polyline: [start, end],
      rows: [
        {
          id: "length",
          label: "Length",
          value: formatLength(distanceBetween(start, end)),
        },
      ],
    });
  }

  if (entity.kind === "circle") {
    const center = getSketchDefinitionPoint2D(sketch, entity.centerPointId);

    if (!center) {
      return null;
    }

    const polyline = sampleCirclePoints(sketch, center, entity.radius);
    return createCurveTarget({
      target,
      label: entity.label,
      key: getPrimitiveRefKey(target),
      polyline,
      exact: exactCircle(sketch, center, entity.radius),
      isClosed: true,
      rows: [
        { id: "radius", label: "Radius", value: formatLength(entity.radius) },
        {
          id: "diameter",
          label: "Diameter",
          value: formatLength(entity.radius * 2),
        },
        {
          id: "circumference",
          label: "Circumference",
          value: formatLength(Math.PI * entity.radius * 2),
        },
      ],
    });
  }

  if (entity.kind === "arc") {
    const center = getSketchDefinitionPoint2D(sketch, entity.centerPointId);
    const start = getSketchDefinitionPoint2D(sketch, entity.startPointId);
    const end = getSketchDefinitionPoint2D(sketch, entity.endPointId);

    if (!center || !start || !end) {
      return null;
    }

    const radius = distanceBetween2D(center, start);
    const sweepRadians = getArcSweepRadians(
      center,
      start,
      end,
      entity.sweepDirection,
    );
    const chordLength = distanceBetween2D(start, end);
    const polyline = sampleArcPoints(
      sketch,
      center,
      radius,
      start,
      end,
      entity.sweepDirection,
    );

    return createCurveTarget({
      target,
      label: entity.label,
      key: getPrimitiveRefKey(target),
      polyline,
      exact: exactArc(
        sketch,
        center,
        radius,
        start,
        end,
        entity.sweepDirection,
      ),
      rows: [
        { id: "radius", label: "Radius", value: formatLength(radius) },
        { id: "diameter", label: "Diameter", value: formatLength(radius * 2) },
        { id: "sweep", label: "Sweep", value: formatAngle(sweepRadians) },
        {
          id: "chord-length",
          label: "Chord Length",
          value: formatLength(chordLength),
        },
        {
          id: "arc-length",
          label: "Arc Length",
          value: formatLength(radius * sweepRadians),
        },
      ],
    });
  }

  if (entity.kind === "spline") {
    const positions = Object.fromEntries(
      sketch.sketch.definition.points.map((point) => [
        point.pointId,
        point.position,
      ]),
    );
    const splineGeometry = reconstructSplineAggregate(entity, positions);
    const fitPoints = tessellateCubicSpans(
      splineGeometry.spans,
      SPLINE_SEGMENTS,
    );

    if (fitPoints.length < 2) {
      return null;
    }

    const sampledPoints = fitPoints.map((point) =>
      mapSketchPointToWorkspaceWorld(sketch.plane, point),
    );
    const spans = splineGeometry.spans.map((span) => span.poles);
    const length = cubicSpansLength(spans);
    return createCurveTarget({
      target,
      label: entity.label,
      key: getPrimitiveRefKey(target),
      polyline: sampledPoints,
      exact: { plane: sketch.plane, curve: { kind: "cubics", spans } },
      rows: [
        {
          id: "length",
          label: "Length",
          value: formatLength(length.value, length.approximate),
        },
        {
          id: "closed",
          label: "Closed",
          value: entity.closure === "open" ? "No" : "Yes",
        },
        {
          id: "fit-points",
          label: "Fit Points",
          value: String(entity.pointOccurrenceIds.length),
        },
      ],
    });
  }

  if (entity.kind === "derivedPiecewiseCubic") {
    // [TECH] G7/G19: an accepted (certified) shell is measured along its
    // solved spans clipped to their drawn domains.
    const record = sketch.sketch.solvedSnapshot.solvedEntities.find(
      (entry) => entry.entityId === entity.entityId,
    );
    if (record?.kind !== "derivedPiecewiseCubic") {
      return null;
    }
    const solvedSpans = solvedCubicSpans(record);
    const sampledPoints = tessellateCubicSpans(
      solvedSpans,
      SPLINE_SEGMENTS,
    ).map((point) => mapSketchPointToWorkspaceWorld(sketch.plane, point));
    if (sampledPoints.length < 2) {
      return null;
    }
    const spans = solvedSpans.map((span) => span.poles);
    const domains = solvedSpans.map(solvedCubicSpanLocalDomain);
    const length = cubicSpansLength(spans, domains);
    return createCurveTarget({
      target,
      label: entity.label,
      key: getPrimitiveRefKey(target),
      polyline: sampledPoints,
      exact: { plane: sketch.plane, curve: { kind: "cubics", spans, domains } },
      rows: [
        {
          id: "length",
          label: "Length",
          value: formatLength(length.value, length.approximate),
        },
      ],
    });
  }

  return null;
}

function resolveProjectedGeometryTarget(
  snapshot: WorkspaceSnapshot,
  target: Extract<PrimitiveRef, { kind: "projectedReferenceGeometry" }>,
): MeasuredTarget | null {
  const sketch = snapshot.document.sketches.find((entry) =>
    entry.sketch.projectedReferences?.some(
      (reference) => reference.referenceId === target.referenceId,
    ),
  );
  const projectedReferences = sketch?.sketch.projectedReferences ?? [];
  const reference = projectedReferences.find(
    (entry) => entry.referenceId === target.referenceId,
  );
  const geometry = reference?.geometry.find(
    (entry) => entry.geometryId === target.geometryId,
  );

  if (!sketch || !reference || !geometry) {
    return null;
  }

  if (geometry.kind === "point") {
    const position = mapSketchPointToWorkspaceWorld(
      sketch.plane,
      geometry.position,
    );
    return {
      target,
      key: getPrimitiveRefKey(target),
      label: getTargetLabel(snapshot, target),
      category: "point",
      distancePrimitive: {
        kind: "point",
        point: position,
      },
      rows: [],
      note: "Select another measurable target to inspect distance.",
      witnesses: [
        {
          id: `${target.referenceId}:${target.geometryId}:witness`,
          kind: "marker",
          position,
          radius: WITNESS_MARKER_RADIUS,
        },
      ],
    };
  }

  if (geometry.kind === "lineSegment") {
    const polyline = [
      mapSketchPointToWorkspaceWorld(sketch.plane, geometry.startPosition),
      mapSketchPointToWorkspaceWorld(sketch.plane, geometry.endPosition),
    ] as const;

    return createCurveTarget({
      target,
      label: getTargetLabel(snapshot, target),
      key: getPrimitiveRefKey(target),
      polyline,
      rows: [
        {
          id: "length",
          label: "Length",
          value: formatLength(distanceBetween(polyline[0], polyline[1])),
        },
      ],
    });
  }

  if (geometry.kind === "circle") {
    const polyline = sampleProjectedCirclePoints(sketch, geometry);
    return createCurveTarget({
      target,
      label: getTargetLabel(snapshot, target),
      key: getPrimitiveRefKey(target),
      polyline,
      exact: exactCircle(sketch, geometry.centerPosition, geometry.radius),
      isClosed: true,
      rows: [
        { id: "radius", label: "Radius", value: formatLength(geometry.radius) },
        {
          id: "diameter",
          label: "Diameter",
          value: formatLength(geometry.radius * 2),
        },
        {
          id: "circumference",
          label: "Circumference",
          value: formatLength(Math.PI * geometry.radius * 2),
        },
      ],
    });
  }

  if (geometry.kind === "arc") {
    const radius = distanceBetween2D(
      geometry.centerPosition,
      geometry.startPosition,
    );
    const sweepRadians = getArcSweepRadians(
      geometry.centerPosition,
      geometry.startPosition,
      geometry.endPosition,
      geometry.sweepDirection,
    );
    const polyline = sampleProjectedArcPoints(sketch, geometry);
    return createCurveTarget({
      target,
      label: getTargetLabel(snapshot, target),
      key: getPrimitiveRefKey(target),
      polyline,
      exact: exactArc(
        sketch,
        geometry.centerPosition,
        radius,
        geometry.startPosition,
        geometry.endPosition,
        geometry.sweepDirection,
      ),
      rows: [
        { id: "radius", label: "Radius", value: formatLength(radius) },
        { id: "diameter", label: "Diameter", value: formatLength(radius * 2) },
        { id: "sweep", label: "Sweep", value: formatAngle(sweepRadians) },
        {
          id: "chord-length",
          label: "Chord Length",
          value: formatLength(
            distanceBetween2D(geometry.startPosition, geometry.endPosition),
          ),
        },
        {
          id: "arc-length",
          label: "Arc Length",
          value: formatLength(radius * sweepRadians),
        },
      ],
    });
  }

  if (geometry.kind === "spline") {
    const points = tessellateProjectedSpline(geometry);
    const isClosed = projectedSplineIsClosed(geometry);
    const sampledPoints = points.map((point) =>
      mapSketchPointToWorkspaceWorld(sketch.plane, point),
    );
    // Source samples are the projected geometry itself (an exact polyline);
    // neutral spans are measured and located on their cubics.
    const spans =
      geometry.representation.kind === "neutralCubicSpans"
        ? geometry.representation.spans.map((span) => span.poles)
        : null;
    const length = spans
      ? cubicSpansLength(spans)
      : {
          value: polylineLength(sampledPoints, isClosed),
          approximate: false,
        };
    return createCurveTarget({
      target,
      label: getTargetLabel(snapshot, target),
      key: getPrimitiveRefKey(target),
      polyline: sampledPoints,
      ...(spans
        ? { exact: { plane: sketch.plane, curve: { kind: "cubics", spans } } }
        : {}),
      isClosed,
      rows: [
        {
          id: "length",
          label: "Length",
          value: formatLength(length.value, length.approximate),
        },
        {
          id: "closed",
          label: "Closed",
          value: isClosed ? "Yes" : "No",
        },
        {
          id: "fit-points",
          label: "Fit Points",
          value: String(points.length),
        },
      ],
    });
  }

  return null;
}

function createCurveTarget(input: {
  target: PrimitiveRef;
  label: string;
  key: string;
  polyline: readonly WorkspaceVec3[];
  exact?: ExactSketchCurve;
  rows: readonly MeasurementRow[];
  isClosed?: boolean;
}): MeasuredTarget {
  return {
    target: input.target,
    key: input.key,
    label: input.label,
    category: "curve",
    distancePrimitive: {
      kind: "polyline",
      points: input.polyline,
      ...(input.exact ? { exact: input.exact } : {}),
    },
    rows: input.rows,
    note: null,
    witnesses: [
      {
        id: `${input.key}:witness`,
        kind: "polyline",
        points: input.polyline,
        isClosed: input.isClosed ?? false,
      },
    ],
  };
}

function supportsPairwiseMeasurement(
  first: MeasuredTarget,
  second: MeasuredTarget,
) {
  if (first.category === "body" || second.category === "body") {
    return false;
  }

  return first.distancePrimitive !== null && second.distancePrimitive !== null;
}

function measurePairwiseDistance(
  first: MeasuredTarget,
  second: MeasuredTarget,
): PairwiseDistanceResult | null {
  if (!first.distancePrimitive || !second.distancePrimitive) {
    return null;
  }

  return measureDistanceBetweenPrimitives(
    first.distancePrimitive,
    second.distancePrimitive,
  );
}

function resolvePairwiseAngleRow(
  first: MeasuredTarget,
  second: MeasuredTarget,
): readonly MeasurementRow[] {
  const firstSegment = getLinearSegmentFromPrimitive(first.distancePrimitive);
  const secondSegment = getLinearSegmentFromPrimitive(second.distancePrimitive);

  if (!firstSegment || !secondSegment) {
    return [];
  }

  const firstDirection = subtract(firstSegment.end, firstSegment.start);
  const secondDirection = subtract(secondSegment.end, secondSegment.start);
  const firstMagnitude = magnitude(firstDirection);
  const secondMagnitude = magnitude(secondDirection);

  if (
    firstMagnitude <= DISTANCE_EPSILON ||
    secondMagnitude <= DISTANCE_EPSILON
  ) {
    return [];
  }

  const cosine = clamp(
    Math.abs(
      dotProduct(firstDirection, secondDirection) /
        (firstMagnitude * secondMagnitude),
    ),
    -1,
    1,
  );

  return [
    {
      id: "angle",
      label: "Angle",
      value: formatAngle(Math.acos(cosine)),
    },
  ];
}

function derivePairwiseWitnesses(
  first: MeasuredTarget,
  second: MeasuredTarget,
  pairwise: PairwiseDistanceResult | null,
): readonly MeasurementWitness[] {
  const curveWitnesses = [
    ...(first.category === "curve" ? first.witnesses : []),
    ...(second.category === "curve" ? second.witnesses : []),
  ];

  if (!pairwise || pairwise.distance <= DISTANCE_EPSILON) {
    return curveWitnesses;
  }

  const connectorWitnesses: MeasurementWitness[] = [
    {
      id: `${first.key}:${second.key}:distance`,
      kind: "polyline",
      points: [pairwise.start, pairwise.end],
      isClosed: false,
    },
  ];

  if (first.category === "point" || second.category === "point") {
    connectorWitnesses.push(
      {
        id: `${first.key}:${second.key}:start`,
        kind: "marker",
        position: pairwise.start,
        radius: WITNESS_MARKER_RADIUS,
      },
      {
        id: `${first.key}:${second.key}:end`,
        kind: "marker",
        position: pairwise.end,
        radius: WITNESS_MARKER_RADIUS,
      },
    );
  }

  return [...curveWitnesses, ...connectorWitnesses];
}

function getLinearSegmentFromPrimitive(
  primitive: DistancePrimitive | null,
): { start: WorkspaceVec3; end: WorkspaceVec3 } | null {
  if (
    !primitive ||
    primitive.kind !== "polyline" ||
    primitive.points.length !== 2
  ) {
    return null;
  }

  return {
    start: primitive.points[0]!,
    end: primitive.points[1]!,
  };
}

function measureDistanceBetweenPrimitives(
  first: DistancePrimitive,
  second: DistancePrimitive,
): PairwiseDistanceResult | null {
  if (first.kind === "point" && second.kind === "point") {
    return {
      distance: distanceBetween(first.point, second.point),
      start: first.point,
      end: second.point,
    };
  }

  if (first.kind === "point" && second.kind === "polyline") {
    return second.exact
      ? measurePointToExactCurve(first.point, second.exact)
      : measurePointToPolyline(first.point, second.points);
  }

  if (first.kind === "polyline" && second.kind === "point") {
    const result = first.exact
      ? measurePointToExactCurve(second.point, first.exact)
      : measurePointToPolyline(second.point, first.points);
    return result
      ? { distance: result.distance, start: result.end, end: result.start }
      : null;
  }

  // Every other pairing measures tessellations; it is exact only when no
  // side tessellates a curved sketch shape (T-6, review R7).
  const result = measureTessellatedPrimitives(first, second);
  return result
    ? {
        ...result,
        approximate: isTessellatedCurve(first) || isTessellatedCurve(second),
      }
    : null;
}

function isTessellatedCurve(primitive: DistancePrimitive) {
  return primitive.kind === "polyline"
    ? primitive.exact !== undefined
    : primitive.kind === "mesh" && primitive.approximate === true;
}

function measureTessellatedPrimitives(
  first: DistancePrimitive,
  second: DistancePrimitive,
): PairwiseDistanceResult | null {
  if (first.kind === "point" && second.kind === "mesh") {
    return measurePointToMesh(first.point, second.triangles);
  }

  if (first.kind === "mesh" && second.kind === "point") {
    const result = measurePointToMesh(second.point, first.triangles);
    return result
      ? { distance: result.distance, start: result.end, end: result.start }
      : null;
  }

  if (first.kind === "polyline" && second.kind === "polyline") {
    return measurePolylineToPolyline(first.points, second.points);
  }

  if (first.kind === "polyline" && second.kind === "mesh") {
    return measurePolylineToMesh(first.points, second.triangles);
  }

  if (first.kind === "mesh" && second.kind === "polyline") {
    const result = measurePolylineToMesh(second.points, first.triangles);
    return result
      ? { distance: result.distance, start: result.end, end: result.start }
      : null;
  }

  if (first.kind === "mesh" && second.kind === "mesh") {
    return measureMeshToMesh(first.triangles, second.triangles);
  }

  return null;
}

function measurePointToPolyline(
  point: WorkspaceVec3,
  points: readonly WorkspaceVec3[],
): PairwiseDistanceResult | null {
  let best: PairwiseDistanceResult | null = null;

  forEachSegment(points, false, (start, end) => {
    const closest = closestPointOnSegment(point, start, end);
    const distance = distanceBetween(point, closest);
    if (!best || distance < best.distance) {
      best = { distance, start: point, end: closest };
    }
  });

  return best;
}

/**
 * Exact point ↔ curve distance (T10 plan §2.3): the closest point of the
 * point's projection into the sketch plane on the curve itself (closed form
 * for arcs and circles, `closestSplineSpanLocation` for cubic spans), which
 * is the 3D closest point because the out-of-plane offset is constant.
 */
function measurePointToExactCurve(
  point: WorkspaceVec3,
  exact: ExactSketchCurve,
): PairwiseDistanceResult | null {
  const local = mapWorldPointToWorkspaceSketch(exact.plane, point);
  const closest = closestPointOnExactCurve(local, exact.curve);
  if (!closest) return null;
  const end = mapSketchPointToWorkspaceWorld(exact.plane, closest);
  return { distance: distanceBetween(point, end), start: point, end };
}

function closestPointOnExactCurve(
  point: SketchPoint2D,
  curve: ExactSketchCurve["curve"],
): SketchPoint2D | null {
  if (curve.kind === "arc") {
    const { center, radius, from, to } = curve;
    const onCircle = (angle: number): SketchPoint2D => [
      center[0] + radius * Math.cos(angle),
      center[1] + radius * Math.sin(angle),
    ];
    let angle = Math.atan2(point[1] - center[1], point[0] - center[0]);
    while (angle < from) angle += Math.PI * 2;
    while (angle >= from + Math.PI * 2) angle -= Math.PI * 2;
    if (angle <= to) return onCircle(angle);
    const [start, end] = [onCircle(from), onCircle(to)];
    return distanceBetween2D(point, start) <= distanceBetween2D(point, end)
      ? start
      : end;
  }
  const spans = curve.spans.map((poles) => ({
    interval: [0, 1] as const,
    poles,
    differential: { interval: [0, 0] as const, poles: ZERO_POLES },
  }));
  const located = closestSplineSpanLocation(point, spans, curve.domains);
  return located
    ? solvedCubicSpanPoint(spans[located.spanIndex]!, located.u)
    : null;
}

const ZERO_POLES: SplinePoles = [
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
];

/** Σ `curveLength` over cubic spans (each on its local drawn domain). */
function cubicSpansLength(
  spans: readonly SplinePoles[],
  domains?: readonly (readonly [number, number])[],
) {
  return spans.reduce(
    (total, poles, index) => {
      const length = curveLength(
        { kind: "cubicBezier", poles },
        domains?.[index] ?? [0, 1],
      );
      return {
        value: total.value + length.value,
        approximate: total.approximate || length.approximate,
      };
    },
    { value: 0, approximate: false },
  );
}

function exactCircle(
  sketch: SketchSnapshotRecord,
  center: SketchPoint2D,
  radius: number,
): ExactSketchCurve {
  return {
    plane: sketch.plane,
    curve: { kind: "arc", center, radius, from: 0, to: Math.PI * 2 },
  };
}

function exactArc(
  sketch: SketchSnapshotRecord,
  center: SketchPoint2D,
  radius: number,
  start: SketchPoint2D,
  end: SketchPoint2D,
  sweepDirection: "clockwise" | "counterClockwise",
): ExactSketchCurve {
  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0]);
  const endAngle = normalizeArcEndAngle(
    startAngle,
    Math.atan2(end[1] - center[1], end[0] - center[0]),
    sweepDirection,
  );
  return {
    plane: sketch.plane,
    curve: {
      kind: "arc",
      center,
      radius,
      from: Math.min(startAngle, endAngle),
      to: Math.max(startAngle, endAngle),
    },
  };
}

function measurePointToMesh(
  point: WorkspaceVec3,
  triangles: readonly Triangle[],
): PairwiseDistanceResult | null {
  let best: PairwiseDistanceResult | null = null;

  for (const triangle of triangles) {
    const closest = closestPointOnTriangle(point, triangle);
    const distance = distanceBetween(point, closest);
    if (!best || distance < best.distance) {
      best = { distance, start: point, end: closest };
    }
  }

  return best;
}

function measurePolylineToPolyline(
  first: readonly WorkspaceVec3[],
  second: readonly WorkspaceVec3[],
): PairwiseDistanceResult | null {
  let best: PairwiseDistanceResult | null = null;

  forEachSegment(first, false, (firstStart, firstEnd) => {
    forEachSegment(second, false, (secondStart, secondEnd) => {
      const segmentResult = closestPointsBetweenSegments(
        firstStart,
        firstEnd,
        secondStart,
        secondEnd,
      );
      const distance = distanceBetween(segmentResult.start, segmentResult.end);
      if (!best || distance < best.distance) {
        best = { distance, start: segmentResult.start, end: segmentResult.end };
      }
    });
  });

  return best;
}

function measurePolylineToMesh(
  polyline: readonly WorkspaceVec3[],
  triangles: readonly Triangle[],
): PairwiseDistanceResult | null {
  let best: PairwiseDistanceResult | null = null;

  forEachSegment(polyline, false, (segmentStart, segmentEnd) => {
    for (const triangle of triangles) {
      const segmentTriangle = closestPointsBetweenSegmentAndTriangle(
        segmentStart,
        segmentEnd,
        triangle,
      );
      if (!best || segmentTriangle.distance < best.distance) {
        best = segmentTriangle;
      }
    }
  });

  return best;
}

function measureMeshToMesh(
  first: readonly Triangle[],
  second: readonly Triangle[],
): PairwiseDistanceResult | null {
  let best: PairwiseDistanceResult | null = null;

  for (const firstTriangle of first) {
    for (const secondTriangle of second) {
      const triangleResult = closestPointsBetweenTriangles(
        firstTriangle,
        secondTriangle,
      );
      if (!best || triangleResult.distance < best.distance) {
        best = triangleResult;
      }
    }
  }

  return best;
}

function closestPointsBetweenTriangles(
  first: Triangle,
  second: Triangle,
): PairwiseDistanceResult {
  const candidates: PairwiseDistanceResult[] = [];

  for (const [start, end] of triangleEdges(first)) {
    candidates.push(closestPointsBetweenSegmentAndTriangle(start, end, second));
  }

  for (const [start, end] of triangleEdges(second)) {
    const reversed = closestPointsBetweenSegmentAndTriangle(start, end, first);
    candidates.push({
      distance: reversed.distance,
      start: reversed.end,
      end: reversed.start,
    });
  }

  for (const point of [first.first, first.second, first.third]) {
    const closest = closestPointOnTriangle(point, second);
    candidates.push({
      distance: distanceBetween(point, closest),
      start: point,
      end: closest,
    });
  }

  for (const point of [second.first, second.second, second.third]) {
    const closest = closestPointOnTriangle(point, first);
    candidates.push({
      distance: distanceBetween(point, closest),
      start: closest,
      end: point,
    });
  }

  return candidates.reduce((best, entry) =>
    entry.distance < best.distance ? entry : best,
  );
}

function closestPointsBetweenSegmentAndTriangle(
  start: WorkspaceVec3,
  end: WorkspaceVec3,
  triangle: Triangle,
): PairwiseDistanceResult {
  const intersection = intersectSegmentTriangle(start, end, triangle);

  if (intersection) {
    return {
      distance: 0,
      start: intersection,
      end: intersection,
    };
  }

  const candidates: PairwiseDistanceResult[] = [
    {
      distance: distanceBetween(start, closestPointOnTriangle(start, triangle)),
      start,
      end: closestPointOnTriangle(start, triangle),
    },
    {
      distance: distanceBetween(end, closestPointOnTriangle(end, triangle)),
      start: end,
      end: closestPointOnTriangle(end, triangle),
    },
  ];

  for (const [edgeStart, edgeEnd] of triangleEdges(triangle)) {
    const result = closestPointsBetweenSegments(start, end, edgeStart, edgeEnd);
    candidates.push({
      distance: distanceBetween(result.start, result.end),
      start: result.start,
      end: result.end,
    });
  }

  return candidates.reduce((best, entry) =>
    entry.distance < best.distance ? entry : best,
  );
}

function getBodyFaceRenderables(snapshot: WorkspaceSnapshot, bodyId: string) {
  return snapshot.document.render.records.filter(
    (renderable) =>
      renderable.ownerBodyId === bodyId &&
      renderable.binding.target.kind === "face" &&
      renderable.geometry.kind === "mesh",
  ) as Array<RenderableEntityRecord & { geometry: RenderMeshGeometry }>;
}

function getBodyEdgeRenderables(snapshot: WorkspaceSnapshot, bodyId: string) {
  return snapshot.document.render.records.filter(
    (renderable) =>
      renderable.ownerBodyId === bodyId &&
      renderable.binding.target.kind === "edge" &&
      renderable.geometry.kind === "polyline",
  ) as Array<
    RenderableEntityRecord & {
      geometry: Extract<
        RenderableEntityRecord["geometry"],
        { kind: "polyline" }
      >;
    }
  >;
}

function getRenderableForTarget(
  snapshot: WorkspaceSnapshot,
  target: PrimitiveRef,
) {
  const key = getPrimitiveRefKey(target);
  return (
    snapshot.document.render.records.find(
      (record) => getPrimitiveRefKey(record.binding.target) === key,
    ) ?? null
  );
}

function getTargetLabel(snapshot: WorkspaceSnapshot, target: PrimitiveRef) {
  return (
    snapshot.presentation.entities.find(
      (entry) =>
        getPrimitiveRefKey(entry.target) === getPrimitiveRefKey(target),
    )?.label ?? getPrimitiveRefLabel(target)
  );
}

function getSketchDefinitionPoint(
  sketch: SketchSnapshotRecord,
  pointId: string,
) {
  const point = sketch.sketch.definition.points.find(
    (entry) => entry.pointId === pointId,
  );
  return point
    ? mapSketchPointToWorkspaceWorld(sketch.plane, point.position)
    : null;
}

function getSketchDefinitionPoint2D(
  sketch: SketchSnapshotRecord,
  pointId: string,
) {
  return (
    sketch.sketch.definition.points.find((entry) => entry.pointId === pointId)
      ?.position ?? null
  );
}

function sampleCirclePoints(
  sketch: SketchSnapshotRecord,
  center: SketchPoint2D,
  radius: number,
) {
  return Array.from({ length: CIRCLE_SEGMENTS }, (_, index) => {
    const angle = (Math.PI * 2 * index) / CIRCLE_SEGMENTS;
    return mapSketchPointToWorkspaceWorld(sketch.plane, [
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius,
    ]);
  });
}

function sampleArcPoints(
  sketch: SketchSnapshotRecord,
  center: SketchPoint2D,
  radius: number,
  start: SketchPoint2D,
  end: SketchPoint2D,
  sweepDirection: "clockwise" | "counterClockwise",
) {
  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0]);
  const endAngle = Math.atan2(end[1] - center[1], end[0] - center[0]);
  const normalizedEnd = normalizeArcEndAngle(
    startAngle,
    endAngle,
    sweepDirection,
  );

  return Array.from({ length: ARC_SEGMENTS + 1 }, (_, index) => {
    const angle =
      startAngle + ((normalizedEnd - startAngle) * index) / ARC_SEGMENTS;
    return mapSketchPointToWorkspaceWorld(sketch.plane, [
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius,
    ]);
  });
}

function sampleProjectedCirclePoints(
  sketch: SketchSnapshotRecord,
  geometry: ProjectedSketchCircleGeometry,
) {
  return sampleCirclePoints(sketch, geometry.centerPosition, geometry.radius);
}

function sampleProjectedArcPoints(
  sketch: SketchSnapshotRecord,
  geometry: ProjectedSketchArcGeometry,
) {
  return sampleArcPoints(
    sketch,
    geometry.centerPosition,
    distanceBetween2D(geometry.centerPosition, geometry.startPosition),
    geometry.startPosition,
    geometry.endPosition,
    geometry.sweepDirection,
  );
}

function polylineWitnessFromPoints(
  id: string,
  points: readonly WorkspaceVec3[],
  isClosed: boolean,
) {
  return points.length >= 2
    ? [
        {
          id,
          kind: "polyline" as const,
          points,
          isClosed,
        },
      ]
    : [];
}

const sketchRecordBases = new WeakMap<
  SketchRecord,
  {
    definition: SketchRecord["definition"];
    solvedSnapshot: SketchRecord["solvedSnapshot"];
    projectedReferences: SketchRecord["projectedReferences"];
    regions: SketchRecord["regions"];
    basis: RegionBoundaryBasis;
  }
>();

/**
 * The region-boundary basis of a committed sketch record (review R2): the
 * record holds its regions together with the pair that produced them.
 * Cached per record object while its pair and regions are the same objects.
 */
function regionBoundaryBasisOfRecord(sketch: SketchRecord) {
  const cached = sketchRecordBases.get(sketch);
  if (
    cached &&
    cached.definition === sketch.definition &&
    cached.solvedSnapshot === sketch.solvedSnapshot &&
    cached.projectedReferences === sketch.projectedReferences &&
    cached.regions === sketch.regions
  )
    return cached.basis;
  const basis = createRegionBoundaryBasis(
    {
      definition: sketch.definition,
      solvedSnapshot: sketch.solvedSnapshot,
      projectedReferences: sketch.projectedReferences ?? [],
    },
    sketch.regions,
  );
  sketchRecordBases.set(sketch, {
    definition: sketch.definition,
    solvedSnapshot: sketch.solvedSnapshot,
    projectedReferences: sketch.projectedReferences,
    regions: sketch.regions,
    basis,
  });
  return basis;
}

export interface SketchRegionMeasure {
  readonly kind: "measured";
  /** |Σ loop signed areas|: the outer loop minus its holes. */
  readonly area: number;
  readonly perimeter: number;
  /** A boundary length did not converge (shown with "≈"). */
  readonly approximate: boolean;
  readonly loops: readonly {
    /** Midpoint of the owner's certified loop area interval. */
    readonly signedArea: number;
    readonly length: number;
    readonly approximate: boolean;
    /** Display tessellation (witness polyline) in sketch coordinates. */
    readonly polygon: readonly SketchPoint2D[];
  }[];
}

/**
 * Exact measures of one committed region from the region-boundary owner
 * (T10 plan §2.3, [TECH] T-6): each loop's area is the midpoint of
 * `boundaryLoopSignedArea`, its length the sum of `curveLength` over its
 * segments' kernel intervals, both on the curves the arrangement certified
 * at the record's own solved positions. The polygon is display output only.
 */
export function measureSketchRegion(
  sketch: SketchSnapshotRecord,
  region: RegionRecord,
): SketchRegionMeasure | BoundaryCurveFailure {
  const basis = regionBoundaryBasisOfRecord(sketch.sketch);
  const loops: SketchRegionMeasure["loops"][number][] = [];
  for (const loop of region.loops) {
    const area = boundaryLoopSignedArea(basis, loop);
    if (area.kind === "failed") return area;
    const polygon = tessellateBoundaryLoop(basis, loop, SPLINE_SEGMENTS);
    if ("kind" in polygon) return polygon;
    let length = 0;
    let approximate = false;
    for (const segment of loop.segments) {
      const resolved = resolveRegionBoundaryCurve(basis, segment);
      if (resolved.kind === "failed") return resolved;
      const measured = curveLength(resolved.curve, resolved.kernelInterval);
      length += measured.value;
      approximate ||= measured.approximate;
    }
    loops.push({ signedArea: area.value, length, approximate, polygon });
  }
  return {
    kind: "measured",
    area: Math.abs(loops.reduce((sum, entry) => sum + entry.signedArea, 0)),
    perimeter: loops.reduce((sum, entry) => sum + entry.length, 0),
    approximate: loops.some((entry) => entry.approximate),
    loops,
  };
}

function triangulateLoopFan(points: readonly WorkspaceVec3[]) {
  if (points.length < 3) {
    return [];
  }

  const triangles: Triangle[] = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    triangles.push({
      first: points[0]!,
      second: points[index]!,
      third: points[index + 1]!,
    });
  }
  return triangles;
}

function getMeshArea(geometry: RenderMeshGeometry) {
  return trianglesFromMesh(geometry).reduce(
    (sum, triangle) => sum + triangleArea(triangle),
    0,
  );
}

function trianglesFromMesh(geometry: RenderMeshGeometry) {
  return geometry.triangleIndices.flatMap((indices) => {
    const first = geometry.vertexPositions[indices[0]];
    const second = geometry.vertexPositions[indices[1]];
    const third = geometry.vertexPositions[indices[2]];
    return first && second && third ? [{ first, second, third }] : [];
  });
}

function collectMeshBoundaryEdges(geometry: RenderMeshGeometry) {
  const edges = new Map<
    string,
    {
      count: number;
      start: WorkspaceVec3;
      end: WorkspaceVec3;
    }
  >();

  for (const [
    firstIndex,
    secondIndex,
    thirdIndex,
  ] of geometry.triangleIndices) {
    addBoundaryEdge(
      edges,
      geometry.vertexPositions[firstIndex],
      geometry.vertexPositions[secondIndex],
    );
    addBoundaryEdge(
      edges,
      geometry.vertexPositions[secondIndex],
      geometry.vertexPositions[thirdIndex],
    );
    addBoundaryEdge(
      edges,
      geometry.vertexPositions[thirdIndex],
      geometry.vertexPositions[firstIndex],
    );
  }

  return [...edges.values()]
    .filter((entry) => entry.count === 1)
    .map((entry) => [entry.start, entry.end] as const);
}

function addBoundaryEdge(
  edges: Map<
    string,
    { count: number; start: WorkspaceVec3; end: WorkspaceVec3 }
  >,
  start: WorkspaceVec3 | undefined,
  end: WorkspaceVec3 | undefined,
) {
  if (!start || !end) {
    return;
  }

  const startKey = getPointKey(start);
  const endKey = getPointKey(end);
  const key =
    startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`;
  const existing = edges.get(key);

  if (existing) {
    existing.count += 1;
    return;
  }

  edges.set(key, { count: 1, start, end });
}

function groupBoundaryLoops(
  edges: readonly (readonly [WorkspaceVec3, WorkspaceVec3])[],
) {
  const adjacency = new Map<string, WorkspaceVec3[]>();

  for (const [start, end] of edges) {
    const startKey = getPointKey(start);
    const endKey = getPointKey(end);
    adjacency.set(startKey, [...(adjacency.get(startKey) ?? []), end]);
    adjacency.set(endKey, [...(adjacency.get(endKey) ?? []), start]);
  }

  const visited = new Set<string>();
  const lengths: number[] = [];

  for (const [start, end] of edges) {
    const edgeKey = getUndirectedEdgeKey(start, end);
    if (visited.has(edgeKey)) {
      continue;
    }

    let length = 0;
    const stack: Array<readonly [WorkspaceVec3, WorkspaceVec3]> = [
      [start, end],
    ];

    while (stack.length > 0) {
      const [currentStart, currentEnd] = stack.pop()!;
      const currentKey = getUndirectedEdgeKey(currentStart, currentEnd);
      if (visited.has(currentKey)) {
        continue;
      }

      visited.add(currentKey);
      length += distanceBetween(currentStart, currentEnd);

      for (const neighbor of adjacency.get(getPointKey(currentEnd)) ?? []) {
        const nextKey = getUndirectedEdgeKey(currentEnd, neighbor);
        if (!visited.has(nextKey)) {
          stack.push([currentEnd, neighbor]);
        }
      }
    }

    lengths.push(length);
  }

  return lengths;
}

function triangleArea(triangle: Triangle) {
  const cross = crossProduct(
    subtract(triangle.second, triangle.first),
    subtract(triangle.third, triangle.first),
  );
  return magnitude(cross) / 2;
}

function signedTetrahedronVolume(triangle: Triangle) {
  return (
    dotProduct(triangle.first, crossProduct(triangle.second, triangle.third)) /
    6
  );
}

function getClosedMeshVolume(triangles: readonly Triangle[]) {
  const vertices = triangles.flatMap((triangle) => [
    triangle.first,
    triangle.second,
    triangle.third,
  ]);
  const centroid = scale(
    vertices.reduce((sum, point) => add(sum, point), [0, 0, 0]),
    1 / vertices.length,
  );

  return Math.abs(
    triangles.reduce((sum, triangle) => {
      const oriented = orientTriangleOutward(triangle, centroid);
      return sum + signedTetrahedronVolume(oriented);
    }, 0),
  );
}

function orientTriangleOutward(triangle: Triangle, centroid: WorkspaceVec3) {
  const triangleCentroid = scale(
    add(add(triangle.first, triangle.second), triangle.third),
    1 / 3,
  );
  const normal = crossProduct(
    subtract(triangle.second, triangle.first),
    subtract(triangle.third, triangle.first),
  );

  return dotProduct(normal, subtract(triangleCentroid, centroid)) < 0
    ? {
        first: triangle.first,
        second: triangle.third,
        third: triangle.second,
      }
    : triangle;
}

function triangleEdges(triangle: Triangle) {
  return [
    [triangle.first, triangle.second],
    [triangle.second, triangle.third],
    [triangle.third, triangle.first],
  ] as const;
}

function intersectSegmentTriangle(
  start: WorkspaceVec3,
  end: WorkspaceVec3,
  triangle: Triangle,
) {
  const direction = subtract(end, start);
  const edgeOne = subtract(triangle.second, triangle.first);
  const edgeTwo = subtract(triangle.third, triangle.first);
  const pVector = crossProduct(direction, edgeTwo);
  const determinant = dotProduct(edgeOne, pVector);

  if (Math.abs(determinant) <= DISTANCE_EPSILON) {
    return null;
  }

  const inverseDeterminant = 1 / determinant;
  const tVector = subtract(start, triangle.first);
  const u = dotProduct(tVector, pVector) * inverseDeterminant;

  if (u < 0 || u > 1) {
    return null;
  }

  const qVector = crossProduct(tVector, edgeOne);
  const v = dotProduct(direction, qVector) * inverseDeterminant;

  if (v < 0 || u + v > 1) {
    return null;
  }

  const t = dotProduct(edgeTwo, qVector) * inverseDeterminant;

  if (t < 0 || t > 1) {
    return null;
  }

  return add(start, scale(direction, t));
}

function closestPointOnTriangle(
  point: WorkspaceVec3,
  triangle: Triangle,
): WorkspaceVec3 {
  const ab = subtract(triangle.second, triangle.first);
  const ac = subtract(triangle.third, triangle.first);
  const ap = subtract(point, triangle.first);
  const d1 = dotProduct(ab, ap);
  const d2 = dotProduct(ac, ap);

  if (d1 <= 0 && d2 <= 0) {
    return triangle.first;
  }

  const bp = subtract(point, triangle.second);
  const d3 = dotProduct(ab, bp);
  const d4 = dotProduct(ac, bp);
  if (d3 >= 0 && d4 <= d3) {
    return triangle.second;
  }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return add(triangle.first, scale(ab, v));
  }

  const cp = subtract(point, triangle.third);
  const d5 = dotProduct(ab, cp);
  const d6 = dotProduct(ac, cp);
  if (d6 >= 0 && d5 <= d6) {
    return triangle.third;
  }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return add(triangle.first, scale(ac, w));
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return add(
      triangle.second,
      scale(subtract(triangle.third, triangle.second), w),
    );
  }

  const denominator = 1 / (va + vb + vc);
  const v = vb * denominator;
  const w = vc * denominator;
  return add(triangle.first, add(scale(ab, v), scale(ac, w)));
}

function closestPointsBetweenSegments(
  firstStart: WorkspaceVec3,
  firstEnd: WorkspaceVec3,
  secondStart: WorkspaceVec3,
  secondEnd: WorkspaceVec3,
) {
  const firstDirection = subtract(firstEnd, firstStart);
  const secondDirection = subtract(secondEnd, secondStart);
  const between = subtract(firstStart, secondStart);
  const a = dotProduct(firstDirection, firstDirection);
  const e = dotProduct(secondDirection, secondDirection);
  const f = dotProduct(secondDirection, between);

  let firstT = 0;
  let secondT = 0;

  if (a <= DISTANCE_EPSILON && e <= DISTANCE_EPSILON) {
    return { start: firstStart, end: secondStart };
  }

  const b = dotProduct(firstDirection, secondDirection);
  const denominator = a * e - b * b;

  if (
    a > DISTANCE_EPSILON &&
    e > DISTANCE_EPSILON &&
    Math.abs(denominator) <= DISTANCE_EPSILON * a * e
  ) {
    return closestPointsBetweenParallelSegments(
      firstStart,
      firstEnd,
      secondStart,
      secondEnd,
    );
  }

  if (a <= DISTANCE_EPSILON) {
    secondT = clamp(f / e, 0, 1);
  } else {
    const c = dotProduct(firstDirection, between);
    if (e <= DISTANCE_EPSILON) {
      firstT = clamp(-c / a, 0, 1);
    } else {
      firstT =
        denominator !== 0 ? clamp((b * f - c * e) / denominator, 0, 1) : 0;
      secondT = (b * firstT + f) / e;

      if (secondT < 0) {
        secondT = 0;
        firstT = clamp(-c / a, 0, 1);
      } else if (secondT > 1) {
        secondT = 1;
        firstT = clamp((b - c) / a, 0, 1);
      }
    }
  }

  return {
    start: add(firstStart, scale(firstDirection, firstT)),
    end: add(secondStart, scale(secondDirection, secondT)),
  };
}

function closestPointsBetweenParallelSegments(
  firstStart: WorkspaceVec3,
  firstEnd: WorkspaceVec3,
  secondStart: WorkspaceVec3,
  secondEnd: WorkspaceVec3,
) {
  const firstDirection = subtract(firstEnd, firstStart);
  const firstLength = magnitude(firstDirection);

  if (firstLength <= DISTANCE_EPSILON) {
    return {
      start: firstStart,
      end: closestPointOnSegment(firstStart, secondStart, secondEnd),
    };
  }

  const axis = scale(firstDirection, 1 / firstLength);
  const secondStartProjection = dotProduct(
    subtract(secondStart, firstStart),
    axis,
  );
  const secondEndProjection = dotProduct(subtract(secondEnd, firstStart), axis);
  const secondMinimum = Math.min(secondStartProjection, secondEndProjection);
  const secondMaximum = Math.max(secondStartProjection, secondEndProjection);
  const overlapStart = Math.max(0, secondMinimum);
  const overlapEnd = Math.min(firstLength, secondMaximum);

  if (overlapStart <= overlapEnd + DISTANCE_EPSILON) {
    const overlapMidpoint = (overlapStart + overlapEnd) / 2;
    const anchor = add(
      firstStart,
      scale(axis, clamp(overlapMidpoint, 0, firstLength)),
    );

    return {
      start: closestPointOnSegment(anchor, firstStart, firstEnd),
      end: closestPointOnSegment(anchor, secondStart, secondEnd),
    };
  }

  const candidates = [
    {
      start: firstStart,
      end: closestPointOnSegment(firstStart, secondStart, secondEnd),
    },
    {
      start: firstEnd,
      end: closestPointOnSegment(firstEnd, secondStart, secondEnd),
    },
    {
      start: closestPointOnSegment(secondStart, firstStart, firstEnd),
      end: secondStart,
    },
    {
      start: closestPointOnSegment(secondEnd, firstStart, firstEnd),
      end: secondEnd,
    },
  ];

  return candidates.reduce((best, entry) =>
    distanceBetween(entry.start, entry.end) <
    distanceBetween(best.start, best.end)
      ? entry
      : best,
  );
}

function closestPointOnSegment(
  point: WorkspaceVec3,
  start: WorkspaceVec3,
  end: WorkspaceVec3,
) {
  const direction = subtract(end, start);
  const lengthSquared = dotProduct(direction, direction);
  if (lengthSquared <= DISTANCE_EPSILON) {
    return start;
  }

  const t = clamp(
    dotProduct(subtract(point, start), direction) / lengthSquared,
    0,
    1,
  );
  return add(start, scale(direction, t));
}

function forEachSegment(
  points: readonly WorkspaceVec3[],
  isClosed: boolean,
  callback: (start: WorkspaceVec3, end: WorkspaceVec3) => void,
) {
  for (let index = 0; index < points.length - 1; index += 1) {
    callback(points[index]!, points[index + 1]!);
  }

  if (isClosed && points.length > 1) {
    callback(points[points.length - 1]!, points[0]!);
  }
}

function polylineLength(points: readonly WorkspaceVec3[], isClosed: boolean) {
  let length = 0;
  forEachSegment(points, isClosed, (start, end) => {
    length += distanceBetween(start, end);
  });
  return length;
}

function getArcSweepRadians(
  center: SketchPoint2D,
  start: SketchPoint2D,
  end: SketchPoint2D,
  sweepDirection: "clockwise" | "counterClockwise",
) {
  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0]);
  const endAngle = Math.atan2(end[1] - center[1], end[0] - center[0]);
  return Math.abs(
    normalizeArcEndAngle(startAngle, endAngle, sweepDirection) - startAngle,
  );
}

function normalizeArcEndAngle(
  startAngle: number,
  endAngle: number,
  sweepDirection: "clockwise" | "counterClockwise",
) {
  if (sweepDirection === "counterClockwise" && endAngle < startAngle) {
    return endAngle + Math.PI * 2;
  }

  if (sweepDirection === "clockwise" && endAngle > startAngle) {
    return endAngle - Math.PI * 2;
  }

  return endAngle;
}

function formatLength(value: number, approximate = false) {
  return `${approximate ? "≈ " : ""}${formatNumber(value)} mm`;
}

function formatArea(value: number) {
  return `${formatNumber(value)} mm²`;
}

function formatVolume(value: number) {
  return `${formatNumber(value)} mm³`;
}

function formatAngle(valueRadians: number) {
  return `${formatNumber((valueRadians * 180) / Math.PI)} deg`;
}

function formatNumber(value: number) {
  const rounded = Math.abs(value) < DISTANCE_EPSILON ? 0 : value;
  return rounded
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1");
}

function getUndirectedEdgeKey(start: WorkspaceVec3, end: WorkspaceVec3) {
  const startKey = getPointKey(start);
  const endKey = getPointKey(end);
  return startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`;
}

function getPointKey(point: WorkspaceVec3) {
  return `${point[0]}:${point[1]}:${point[2]}`;
}

function distanceBetween(first: WorkspaceVec3, second: WorkspaceVec3) {
  return magnitude(subtract(second, first));
}

function distanceBetween2D(first: SketchPoint2D, second: SketchPoint2D) {
  return Math.hypot(second[0] - first[0], second[1] - first[1]);
}

function magnitude(vector: WorkspaceVec3) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function subtract(left: WorkspaceVec3, right: WorkspaceVec3): WorkspaceVec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function add(left: WorkspaceVec3, right: WorkspaceVec3): WorkspaceVec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function scale(vector: WorkspaceVec3, amount: number): WorkspaceVec3 {
  return [vector[0] * amount, vector[1] * amount, vector[2] * amount];
}

function dotProduct(left: WorkspaceVec3, right: WorkspaceVec3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function crossProduct(
  left: WorkspaceVec3,
  right: WorkspaceVec3,
): WorkspaceVec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
