import earcut, { flatten } from "earcut";

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
  nonAcceptedDerivedOutputPoints,
} from "@/contracts/sketch/offset-publication";
import { sketchNotCurrentExplanation } from "@/contracts/sketch/derived-validity";
import {
  boundaryLoopSignedArea,
  curveLength,
  regionBoundaryBasisOfRecord,
  resolveRegionBoundaryCurve,
  tessellateBoundaryLoop,
  type BoundaryCurveFailure,
  type RegionBoundaryBasis,
} from "@/contracts/sketch/region-boundary-curves";
import type { RegionRecord, SketchPoint2D } from "@/contracts/sketch/schema";
import type {
  MeasureTopologyResponse,
  TopologyMeasure,
  TopologyMeasureTarget,
  TopologyMeasureVec3,
} from "@/contracts/modeling/topology-measure";
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
import type { EditorState } from "@/core/editor/state-machine/types";
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
  /**
   * The measured targets' readout names in pick order, one per target (one
   * or two); none for a summary of more than two targets.
   */
  targetLabels: readonly string[];
  rows: readonly MeasurementRow[];
  note: string | null;
  witnesses: readonly MeasurementWitness[];
  /**
   * The distance a two-target readout shows; set exactly when it measures
   * one, so the readout offers the min / max / centre switch.
   */
  distanceMode?: MeasurementDistanceMode;
}

/**
 * Which distance a two-target readout measures (cadara-h026.3): the
 * closest points, the farthest points, or centre to centre (a point itself,
 * a circle's or arc's centre, a curve's length centroid, a face's area
 * centroid).
 */
export type MeasurementDistanceMode = "minimum" | "maximum" | "center";

/**
 * What a readout measures (cadara-h026.3): the armed Measure tool's picks,
 * or the plain selection while no tool, dialog or sketch tool owns it.
 */
export type MeasurementReadoutSource = "measureTool" | "selection";

/**
 * The open sketch's live geometry for the readout: measured in place of the
 * sketch's last committed record, with the region basis its live regions
 * were derived from (they are not bound to the live pair while pending).
 */
export interface OpenSketchMeasurementRecord {
  record: SketchSnapshotRecord;
  regionBasis: RegionBoundaryBasis | null;
}

type MeasuredTargetCategory = "body" | "surface" | "curve" | "point";

interface MeasuredQuantity {
  value: number;
  approximate: boolean;
}
/**
 * A distance primitive. `exact` marks a polyline that tessellates a curved
 * sketch curve: point distances use the exact curve, every other pairing
 * measures the tessellation and is labelled approximate (T-6, review R7).
 * `approximate` marks a mesh built from such a tessellation (a region fill)
 * and a body face mesh or edge polyline not known to be planar or straight
 * (cadara-h026.5).
 */
type DistancePrimitive =
  | { kind: "point"; point: WorkspaceVec3 }
  | {
      kind: "polyline";
      points: readonly WorkspaceVec3[];
      exact?: ExactSketchCurve;
      /** A body edge's render polyline, not known to be straight. */
      approximate?: boolean;
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
  /**
   * T17d (B3): set on a target of an invalid or stale sketch: its values
   * are measured on the held (authored) geometry and marked so, or it is
   * refused where only an accepted solve defines it.
   */
  validityNote?: string;
  /** The centre of a circle or arc: two of them measure centre to centre. */
  center?: WorkspaceVec3;
  /** A planar face's or region's normal, for the pair's angle. */
  planeNormal?: WorkspaceVec3;
  /** A curve's length or a surface's area, summed by a many-target summary. */
  total?: MeasuredQuantity & { kind: "length" | "area" };
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
/** A face mesh is planar when its triangle normals agree to 1 − cos below this. */
const PLANAR_NORMAL_TOLERANCE = 1e-6;
/** …and its triangles lie within this distance (mm) of one plane. */
const PLANAR_OFFSET_TOLERANCE = 1e-6;

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

/**
 * Whether the editor shows a measurement readout, and of what
 * (cadara-h026.3): the armed Measure tool's picks; or, with no tool armed,
 * the plain selection in part mode and in an open sketch with no sketch
 * tool, constraint, edit tool or special mode collecting picks. A feature
 * dialog, import, section view or any other armed tool owns the selection:
 * no readout (measuring there is the Measure tool's job).
 */
export function getMeasurementReadoutSource(
  state: EditorState,
): MeasurementReadoutSource | null {
  if (state.kind === "idle") return "selection";
  if (state.kind === "selectionCommand")
    return state.command.toolId === "measure" ? "measureTool" : null;
  if (state.kind !== "editingSketch") return null;
  const { session } = state;
  return session.activeTool === null &&
    session.activeEditTool === null &&
    session.constraintAuthoring === null &&
    session.activeSpecialMode === null &&
    session.activeAnnotationEdit === null
    ? "selection"
    : null;
}

/**
 * The readout of `selection` (cadara-h026.3 records which picks it means;
 * the selection is ordered oldest pick first): one measurable target shows
 * its intrinsic properties; two show the distance between them (oldest pick
 * to newest, by `distanceMode`), its X/Y/Z components and their angle
 * where both have a direction; more than two (a plain selection only: the
 * Measure tool keeps at most two) are summarised as a count, the total
 * length of the curves and the total area of the surfaces. Unmeasurable
 * targets (features, sketches, planes) are skipped. The plain selection's
 * readout draws only the distance witness: the selection highlight already
 * shows the targets themselves.
 */
export function deriveMeasurementViewModel(input: {
  source: MeasurementReadoutSource | null;
  selection: readonly PrimitiveRef[];
  snapshot: WorkspaceSnapshot | null;
  /**
   * Exact kernel measures of the selected body topology (cadara-h026.5);
   * ignored unless they measure the snapshot's revision. Without them body
   * values come from the render meshes and are marked approximate.
   */
  topologyMeasures?: MeasureTopologyResponse | null;
  /** The two-target distance; closest points by default. */
  distanceMode?: MeasurementDistanceMode;
  /** The open sketch's live geometry, measured instead of its last commit. */
  openSketch?: OpenSketchMeasurementRecord | null;
}): MeasurementViewModel | null {
  if (!input.source || !input.snapshot || input.selection.length === 0) {
    return null;
  }

  const openSketch = input.openSketch ?? null;
  const snapshot = openSketch
    ? withSketchRecord(input.snapshot, openSketch.record)
    : input.snapshot;
  const exactMeasures =
    input.topologyMeasures &&
    input.topologyMeasures.revisionId === snapshot.document.revisionId
      ? new Map(
          input.topologyMeasures.measures.map((measure) => [
            getPrimitiveRefKey(measure.target),
            measure,
          ]),
        )
      : null;
  const measured =
    input.source === "measureTool"
      ? input.selection.slice(0, 2)
      : input.selection;
  const resolvedSelection = measured.flatMap((target) => {
    const resolved = resolveMeasuredTarget(
      snapshot,
      target,
      exactMeasures?.get(getPrimitiveRefKey(target)),
      openSketch,
    );
    return resolved ? [resolved] : [];
  });

  if (resolvedSelection.length === 0) {
    return null;
  }

  const targetWitnesses = input.source === "measureTool";

  if (resolvedSelection.length === 1) {
    const target = resolvedSelection[0]!;
    return {
      targetLabels: [target.label],
      rows: target.rows,
      note: joinNotes(target.validityNote, target.note),
      witnesses: targetWitnesses ? target.witnesses : [],
    };
  }

  if (resolvedSelection.length > 2) {
    return summarizeMeasuredTargets(resolvedSelection);
  }

  const [first, second] = resolvedSelection as [MeasuredTarget, MeasuredTarget];
  const supported = supportsPairwiseMeasurement(first, second);
  // A plain selection of a pair with no distance (two bodies, a body and a
  // face) is summarised like a larger one, never told to pick another pair.
  if (!supported && input.source === "selection") {
    return summarizeMeasuredTargets(resolvedSelection);
  }

  const distanceMode = input.distanceMode ?? "minimum";
  const pairwise = supported
    ? measurePairwiseDistanceByMode(first, second, distanceMode)
    : null;

  const rows = pairwise
    ? [
        {
          id: "distance",
          label: "Distance",
          value: formatLength(pairwise.distance, pairwise.approximate),
        },
        ...distanceComponentRows(pairwise),
        ...resolvePairwiseAngleRow(first, second),
        ...(distanceMode === "center"
          ? []
          : resolveCenterDistanceRow(first, second)),
      ]
    : [];

  const note = joinNotes(
    first.validityNote,
    second.validityNote,
    pairwise
      ? null
      : supported
        ? `The ${DISTANCE_MODE_NOUNS[distanceMode]} distance is unavailable for this pair.`
        : "Select a supported point, edge, face, or profile target pair to inspect distance.",
  );

  // Two picks of one kind on one owner (two faces of a body) would read
  // alike: number them in pick order.
  const sameLabel = first.label === second.label;
  return {
    targetLabels: sameLabel
      ? [`${first.label} (1)`, `${second.label} (2)`]
      : [first.label, second.label],
    rows,
    note,
    witnesses: derivePairwiseWitnesses(first, second, pairwise, {
      targetWitnesses,
      endMarkers: distanceMode !== "minimum",
    }),
    // The switch stays while the pair has a distance in any mode, so a mode
    // without a result can be switched back from.
    ...(supported ? { distanceMode } : {}),
  };
}

const DISTANCE_MODE_NOUNS = {
  minimum: "minimum",
  maximum: "maximum",
  center: "centre",
} as const satisfies Record<MeasurementDistanceMode, string>;

/**
 * The body, face and edge targets whose exact kernel measures the readout
 * uses (cadara-h026.3): a body's volume and area only for a lone body (a
 * pair with a body measures no distance, a summary sums no volumes), and at
 * most `MAX_TOPOLOGY_MEASURE_TARGETS` (the rest stay mesh values, marked
 * approximate), so a marquee asks the worker one bounded request.
 */
export function getTopologyMeasureTargets(
  selection: readonly PrimitiveRef[],
): TopologyMeasureTarget[] {
  return selection
    .filter(
      (target): target is TopologyMeasureTarget =>
        (target.kind === "body" && selection.length === 1) ||
        target.kind === "face" ||
        target.kind === "edge",
    )
    .slice(0, MAX_TOPOLOGY_MEASURE_TARGETS);
}

export const MAX_TOPOLOGY_MEASURE_TARGETS = 64;

/** `snapshot` with `record` in place of its sketch (added for a new sketch). */
function withSketchRecord(
  snapshot: WorkspaceSnapshot,
  record: SketchSnapshotRecord,
): WorkspaceSnapshot {
  const others = snapshot.document.sketches.filter(
    (entry) => entry.sketchId !== record.sketchId,
  );
  return {
    ...snapshot,
    document: { ...snapshot.document, sketches: [...others, record] },
  };
}

/** More than two targets: their count and summed lengths and areas. */
function summarizeMeasuredTargets(
  targets: readonly MeasuredTarget[],
): MeasurementViewModel {
  const sum = (kind: "length" | "area") => {
    const parts = targets.flatMap((target) =>
      target.total?.kind === kind ? [target.total] : [],
    );
    return parts.length === 0
      ? null
      : {
          value: parts.reduce((total, part) => total + part.value, 0),
          approximate: parts.some((part) => part.approximate),
        };
  };
  const length = sum("length");
  const area = sum("area");
  return {
    targetLabels: [],
    rows: [
      { id: "targets", label: "Targets", value: String(targets.length) },
      ...(length
        ? [
            {
              id: "total-length",
              label: "Total Length",
              value: formatLength(length.value, length.approximate),
            },
          ]
        : []),
      ...(area
        ? [
            {
              id: "total-area",
              label: "Total Area",
              value: formatArea(area.value, area.approximate),
            },
          ]
        : []),
    ],
    note: null,
    witnesses: [],
  };
}

function resolveMeasuredTarget(
  snapshot: WorkspaceSnapshot | null,
  target: PrimitiveRef | null,
  exact?: TopologyMeasure,
  openSketch?: OpenSketchMeasurementRecord | null,
): MeasuredTarget | null {
  if (!snapshot || !target) {
    return null;
  }

  if (target.kind === "body") {
    return resolveBodyTarget(
      snapshot,
      target,
      exact && "volume" in exact ? exact : undefined,
    );
  }

  if (target.kind === "face") {
    return resolveFaceTarget(
      snapshot,
      target,
      exact && "surface" in exact ? exact : undefined,
    );
  }

  if (target.kind === "edge") {
    return resolveEdgeTarget(
      snapshot,
      target,
      exact && "curve" in exact ? exact : undefined,
    );
  }

  if (target.kind === "vertex") {
    return resolveVertexTarget(snapshot, target);
  }

  if (target.kind === "region") {
    return resolveRegionTarget(
      snapshot,
      target,
      openSketch?.record.sketchId === target.sketchId
        ? openSketch.regionBasis
        : null,
    );
  }

  if (target.kind === "sketchPoint" || target.kind === "sketchEntity") {
    const resolved =
      target.kind === "sketchPoint"
        ? resolveSketchPointTarget(snapshot, target)
        : resolveSketchEntityTarget(snapshot, target);
    const sketch = snapshot.document.sketches.find(
      (entry) => entry.sketchId === target.sketchId,
    );
    const notCurrent = sketch && sketchNotCurrentExplanation(sketch.sketch);
    // T17d (B3, [TECH] A-5): an invalid or stale sketch is measured on what
    // is held (its authored geometry), never on its rejected solve, and the
    // result says so.
    return resolved && notCurrent && resolved.validityNote === undefined
      ? {
          ...resolved,
          validityNote: `Sketch ‘${sketch.label}’ is ${notCurrent.state}, so this measures its held geometry (as authored), not a current solve. ${notCurrent.explanation}`,
        }
      : resolved;
  }

  if (target.kind === "projectedReferenceGeometry") {
    return resolveProjectedGeometryTarget(snapshot, target);
  }

  return null;
}

function resolveBodyTarget(
  snapshot: WorkspaceSnapshot,
  target: Extract<PrimitiveRef, { kind: "body" }>,
  exact?: Extract<TopologyMeasure, { volume: number | null }>,
): MeasuredTarget | null {
  const body = snapshot.document.bodies.find(
    (entry) => entry.bodyId === target.bodyId,
  );

  if (!body) {
    return null;
  }

  const faceRenderables = getBodyFaceRenderables(snapshot, body.bodyId);
  const edgeRenderables = getBodyEdgeRenderables(snapshot, body.bodyId);
  const meshComplete = faceRenderables.length === body.topology.faceIds.length;
  const surfaceArea = exact
    ? exact.surfaceArea
    : meshComplete
      ? faceRenderables.reduce(
          (sum, renderable) => sum + getMeshArea(renderable.geometry),
          0,
        )
      : null;
  const volume = exact
    ? exact.volume
    : meshComplete
      ? getClosedMeshVolume(
          faceRenderables.map((renderable) => renderable.geometry),
        )
      : null;
  const approximate = exact === undefined;

  const rows = [
    ...(surfaceArea === null
      ? []
      : [
          {
            id: "surface-area",
            label: "Surface Area",
            value: formatArea(surfaceArea, approximate),
          },
        ]),
    ...(volume === null
      ? []
      : [
          {
            id: "volume",
            label: "Volume",
            value: formatVolume(volume, approximate),
          },
        ]),
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
  exact?: Extract<TopologyMeasure, { surface: unknown }>,
): MeasuredTarget | null {
  const renderable = getRenderableForTarget(snapshot, target);

  if (!renderable || renderable.geometry.kind !== "mesh") {
    return null;
  }

  const boundaryEdges = collectMeshBoundaryEdges(renderable.geometry);
  const rows: readonly MeasurementRow[] = exact
    ? exactFaceRows(exact)
    : meshFaceRows(renderable.geometry, boundaryEdges);
  const triangles = trianglesFromMesh(renderable.geometry);
  const planeNormal = exact
    ? exact.surface.kind === "plane"
      ? exact.surface.normal
      : null
    : planarMeshNormal(triangles);

  return {
    target,
    key: getPrimitiveRefKey(target),
    label: getTargetLabel(snapshot, target, exact),
    category: "surface",
    ...(planeNormal ? { planeNormal } : {}),
    total: exact
      ? { kind: "area", value: exact.area, approximate: false }
      : {
          kind: "area",
          value: getMeshArea(renderable.geometry),
          approximate: true,
        },
    distancePrimitive: {
      kind: "mesh",
      triangles,
      // Only a planar face bounded by straight edges is meshed exactly: a
      // curved face's triangles, or a curved boundary's chords, approximate.
      approximate: !(
        exact?.surface.kind === "plane" && exact.surface.polygonal
      ),
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
  exact?: Extract<TopologyMeasure, { curve: unknown }>,
): MeasuredTarget | null {
  const renderable = getRenderableForTarget(snapshot, target);

  if (!renderable || renderable.geometry.kind !== "polyline") {
    return null;
  }

  const circle = exact?.curve.kind === "circle" ? exact.curve : null;
  const length: MeasuredQuantity = exact
    ? { value: exact.length, approximate: false }
    : {
        value: polylineLength(
          renderable.geometry.points,
          renderable.geometry.isClosed,
        ),
        approximate: true,
      };
  const rows: readonly MeasurementRow[] = !exact
    ? [
        {
          id: "length",
          label: "Length",
          value: formatLength(length.value, true),
        },
      ]
    : circle
      ? [
          { id: "radius", label: "Radius", value: formatLength(circle.radius) },
          {
            id: "diameter",
            label: "Diameter",
            value: formatLength(circle.radius * 2),
          },
          circle.isFull
            ? {
                id: "circumference",
                label: "Circumference",
                value: formatLength(exact.length),
              }
            : {
                id: "arc-length",
                label: "Arc Length",
                value: formatLength(exact.length),
              },
          { id: "center", label: "Center", value: formatPoint(circle.center) },
        ]
      : [{ id: "length", label: "Length", value: formatLength(exact.length) }];

  return {
    target,
    key: getPrimitiveRefKey(target),
    label: getTargetLabel(snapshot, target, exact),
    category: "curve",
    distancePrimitive: {
      kind: "polyline",
      points: renderable.geometry.points,
      approximate: exact?.curve.kind !== "line",
    },
    ...(circle ? { center: circle.center } : {}),
    total: { kind: "length", ...length },
    rows,
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
  regionBasis: RegionBoundaryBasis | null,
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

  const measured = measureSketchRegion(
    sketch,
    region,
    regionBasis ?? undefined,
  );
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
    planeNormal: sketch.plane.frame.normal,
    total: { kind: "area", value: measured.area, approximate: false },
    distancePrimitive:
      measured.area > DISTANCE_EPSILON
        ? {
            kind: "mesh",
            triangles: triangulateRegionLoops(
              measured.loops.map((loop) => loop.polygon),
              region.loops.findIndex((loop) => loop.role === "outer"),
              sketch.plane,
            ),
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
    nonAcceptedDerivedOutputPoints(
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
      label: getTargetLabel(snapshot, target),
      key: getPrimitiveRefKey(target),
      polyline: [start, end],
      length: { value: distanceBetween(start, end), approximate: false },
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
      label: getTargetLabel(snapshot, target),
      key: getPrimitiveRefKey(target),
      polyline,
      exact: exactCircle(sketch, center, entity.radius),
      isClosed: true,
      length: { value: Math.PI * entity.radius * 2, approximate: false },
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
      label: getTargetLabel(snapshot, target),
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
      length: { value: radius * sweepRadians, approximate: false },
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

  // T17d (B3, [TECH] A-5): an offset shell is defined only by an accepted
  // solve (its solved spans); an invalid or stale sketch's solved snapshot
  // is not one, so it is refused, saying why.
  const notCurrent = sketchNotCurrentExplanation(sketch.sketch);
  const refused = (reason: string): MeasuredTarget => ({
    target,
    key: getPrimitiveRefKey(target),
    label: getTargetLabel(snapshot, target),
    category: "curve",
    distancePrimitive: null,
    rows: [],
    note: null,
    validityNote: `Sketch ‘${sketch.label}’ is ${notCurrent!.state}, so ‘${entity.label}’ is not measured: ${reason} ${notCurrent!.explanation}`,
    witnesses: [],
  });
  if (notCurrent && entity.kind === "derivedPiecewiseCubic")
    return refused("its curve is only defined by an accepted solve.");

  if (entity.kind === "spline") {
    // T10f review R-1: the record's solved spans (modeling-grade); no valid
    // solved spline, no measurement. T17d2 (T17d review A-3): a spline of
    // a sketch that is not current is measured on its held (authored)
    // reconstruction, the curve part mode and sketch mode draw, and marked
    // so; never on the rejected solve. Held fit points that define no
    // spline (a degenerate span, drawn through its fit points) are refused.
    const record = notCurrent
      ? {
          entityId: entity.entityId,
          kind: "spline" as const,
          reconstruction: reconstructSplineAggregate(
            entity,
            Object.fromEntries(
              sketch.sketch.definition.points.map((point) => [
                point.pointId,
                point.position,
              ]),
            ),
          ),
        }
      : sketch.sketch.solvedSnapshot.solvedEntities.find(
          (entry) => entry.entityId === entity.entityId,
        );
    const solvedSpans =
      record?.kind === "spline" ? solvedCubicSpans(record) : [];
    if (solvedSpans.length === 0) {
      return notCurrent
        ? refused("its held fit points do not define a spline.")
        : null;
    }

    const sampledPoints = tessellateCubicSpans(
      solvedSpans,
      SPLINE_SEGMENTS,
    ).map((point) => mapSketchPointToWorkspaceWorld(sketch.plane, point));
    const spans = solvedSpans.map((span) => span.poles);
    const length = cubicSpansLength(spans);
    return createCurveTarget({
      target,
      label: getTargetLabel(snapshot, target),
      key: getPrimitiveRefKey(target),
      polyline: sampledPoints,
      exact: { plane: sketch.plane, curve: { kind: "cubics", spans } },
      length,
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
      label: getTargetLabel(snapshot, target),
      key: getPrimitiveRefKey(target),
      polyline: sampledPoints,
      exact: { plane: sketch.plane, curve: { kind: "cubics", spans, domains } },
      length,
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
      length: {
        value: distanceBetween(polyline[0], polyline[1]),
        approximate: false,
      },
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
      length: { value: Math.PI * geometry.radius * 2, approximate: false },
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
      length: { value: radius * sweepRadians, approximate: false },
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
      length,
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

function joinNotes(...notes: readonly (string | null | undefined)[]) {
  const present = new Set(
    notes.filter((note): note is string => Boolean(note)),
  );
  return present.size > 0 ? [...present].join(" ") : null;
}

function createCurveTarget(input: {
  target: PrimitiveRef;
  label: string;
  key: string;
  polyline: readonly WorkspaceVec3[];
  exact?: ExactSketchCurve;
  length: MeasuredQuantity;
  rows: readonly MeasurementRow[];
  isClosed?: boolean;
}): MeasuredTarget {
  return {
    target: input.target,
    key: input.key,
    label: input.label,
    category: "curve",
    total: { kind: "length", ...input.length },
    distancePrimitive: {
      kind: "polyline",
      points: input.polyline,
      ...(input.exact ? { exact: input.exact } : {}),
    },
    ...(input.exact?.curve.kind === "arc"
      ? {
          center: mapSketchPointToWorkspaceWorld(
            input.exact.plane,
            input.exact.curve.center,
          ),
        }
      : {}),
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

/**
 * The pair's distance by `mode` (cadara-h026.3), from the first pick to the
 * second. Maximum: the farthest pair of the primitives' vertices (where the
 * distance between two segment/triangle sets peaks), approximate on a
 * tessellated curve. Centre: see `measuredTargetCenter`.
 */
function measurePairwiseDistanceByMode(
  first: MeasuredTarget,
  second: MeasuredTarget,
  mode: MeasurementDistanceMode,
): PairwiseDistanceResult | null {
  if (mode === "minimum") return measurePairwiseDistance(first, second);
  if (!first.distancePrimitive || !second.distancePrimitive) return null;
  if (mode === "center") {
    const start = measuredTargetCenter(first);
    const end = measuredTargetCenter(second);
    return start && end
      ? {
          distance: distanceBetween(start.point, end.point),
          start: start.point,
          end: end.point,
          approximate: start.approximate || end.approximate,
        }
      : null;
  }
  const farthest = farthestPointPair(
    primitiveVertices(first.distancePrimitive),
    primitiveVertices(second.distancePrimitive),
  );
  return farthest
    ? {
        ...farthest,
        approximate:
          isTessellatedCurve(first.distancePrimitive) ||
          isTessellatedCurve(second.distancePrimitive),
      }
    : null;
}

/**
 * The farthest pair of `first` × `second`, as the brute-force scan in list
 * order finds it (ties to the earliest pair); chunk pairs are visited
 * farthest first and skipped once their boxes cannot beat the best.
 */
function farthestPointPair(
  first: readonly WorkspaceVec3[],
  second: readonly WorkspaceVec3[],
): PairwiseDistanceResult | null {
  const firstChunks = chunkElements(first, pointBound);
  const secondChunks = chunkElements(second, pointBound);
  const chunkPairs = firstChunks
    .flatMap((firstChunk) =>
      secondChunks.map((secondChunk) => ({
        firstChunk,
        secondChunk,
        reach: boxReach(firstChunk.box, secondChunk.box),
      })),
    )
    .sort((left, right) => right.reach - left.reach);
  let best: {
    result: PairwiseDistanceResult;
    first: number;
    second: number;
  } | null = null;
  for (const { firstChunk, secondChunk, reach: chunkReach } of chunkPairs) {
    if (best && chunkReach + PRUNE_SLACK < best.result.distance) break;
    for (
      let firstOffset = 0;
      firstOffset < firstChunk.bounds.length;
      firstOffset += 1
    ) {
      for (
        let secondOffset = 0;
        secondOffset < secondChunk.bounds.length;
        secondOffset += 1
      ) {
        const firstIndex = firstChunk.offset + firstOffset;
        const secondIndex = secondChunk.offset + secondOffset;
        const start = first[firstIndex]!;
        const end = second[secondIndex]!;
        const distance = distanceBetween(start, end);
        if (
          !best ||
          distance > best.result.distance ||
          (distance === best.result.distance &&
            (firstIndex < best.first ||
              (firstIndex === best.first && secondIndex < best.second)))
        )
          best = {
            result: { distance, start, end },
            first: firstIndex,
            second: secondIndex,
          };
      }
    }
  }
  return best?.result ?? null;
}

/** A primitive's distinct vertices (a mesh repeats shared corners). */
function primitiveVertices(primitive: DistancePrimitive) {
  if (primitive.kind === "point") return [primitive.point];
  if (primitive.kind === "polyline") return primitive.points;
  const vertices = new Map<string, WorkspaceVec3>();
  for (const triangle of primitive.triangles)
    for (const vertex of [triangle.first, triangle.second, triangle.third])
      vertices.set(getPointKey(vertex), vertex);
  return [...vertices.values()];
}

/**
 * The point a centre distance measures from: a point itself, a circle's or
 * arc's centre, any other curve's length centroid (its segments' midpoints
 * weighted by length: a straight curve's midpoint; off a curved open
 * curve, like a spline's), a surface's area centroid. Approximate when
 * taken from a tessellated curve or surface.
 */
function measuredTargetCenter(
  target: MeasuredTarget,
): { point: WorkspaceVec3; approximate: boolean } | null {
  if (target.center) return { point: target.center, approximate: false };
  const primitive = target.distancePrimitive;
  if (!primitive) return null;
  if (primitive.kind === "point")
    return { point: primitive.point, approximate: false };
  const approximate = isTessellatedCurve(primitive);
  let weight = 0;
  let weighted: WorkspaceVec3 = [0, 0, 0];
  const accumulate = (center: WorkspaceVec3, amount: number) => {
    weight += amount;
    weighted = add(weighted, scale(center, amount));
  };
  if (primitive.kind === "polyline") {
    forEachSegment(primitive.points, false, (start, end) =>
      accumulate(scale(add(start, end), 0.5), distanceBetween(start, end)),
    );
  } else {
    for (const triangle of primitive.triangles)
      accumulate(
        scale(add(add(triangle.first, triangle.second), triangle.third), 1 / 3),
        triangleArea(triangle),
      );
  }
  return weight > DISTANCE_EPSILON
    ? { point: scale(weighted, 1 / weight), approximate }
    : null;
}

/** The X/Y/Z components of the pair's distance, as magnitudes. */
function distanceComponentRows(
  pairwise: PairwiseDistanceResult,
): readonly MeasurementRow[] {
  const delta = subtract(pairwise.end, pairwise.start);
  return (["X", "Y", "Z"] as const).map((axis, index) => ({
    id: `delta-${axis.toLowerCase()}`,
    label: `Δ${axis}`,
    value: formatLength(Math.abs(delta[index]!), pairwise.approximate),
  }));
}

/**
 * The angle of two directions, 0 to 90 deg: two straight curves, two planar
 * faces or regions (their normals), or a straight curve and a plane.
 */
function resolvePairwiseAngleRow(
  first: MeasuredTarget,
  second: MeasuredTarget,
): readonly MeasurementRow[] {
  const firstDirection = getTargetDirection(first);
  const secondDirection = getTargetDirection(second);

  if (!firstDirection || !secondDirection) {
    return [];
  }

  const firstMagnitude = magnitude(firstDirection.vector);
  const secondMagnitude = magnitude(secondDirection.vector);

  if (
    firstMagnitude <= DISTANCE_EPSILON ||
    secondMagnitude <= DISTANCE_EPSILON
  ) {
    return [];
  }

  const cosine = clamp(
    Math.abs(
      dotProduct(firstDirection.vector, secondDirection.vector) /
        (firstMagnitude * secondMagnitude),
    ),
    -1,
    1,
  );
  // A line against a plane: the complement of its angle to the normal.
  const angle =
    firstDirection.kind === secondDirection.kind
      ? Math.acos(cosine)
      : Math.asin(cosine);

  return [
    {
      id: "angle",
      label: "Angle",
      value: formatAngle(angle),
    },
  ];
}

function getTargetDirection(
  target: MeasuredTarget,
): { kind: "line" | "plane"; vector: WorkspaceVec3 } | null {
  if (target.planeNormal) return { kind: "plane", vector: target.planeNormal };
  const segment = getLinearSegmentFromPrimitive(target.distancePrimitive);
  return segment
    ? { kind: "line", vector: subtract(segment.end, segment.start) }
    : null;
}

/** The unit normal of a mesh whose triangles all lie in one plane, or null. */
function planarMeshNormal(
  triangles: readonly Triangle[],
): WorkspaceVec3 | null {
  let normal: WorkspaceVec3 | null = null;
  for (const triangle of triangles) {
    const cross = crossProduct(
      subtract(triangle.second, triangle.first),
      subtract(triangle.third, triangle.first),
    );
    const length = magnitude(cross);
    if (length <= DISTANCE_EPSILON) continue;
    const unit = scale(cross, 1 / length);
    if (!normal) {
      normal = unit;
      continue;
    }
    if (Math.abs(dotProduct(normal, unit)) < 1 - PLANAR_NORMAL_TOLERANCE)
      return null;
    if (
      Math.abs(
        dotProduct(normal, subtract(triangle.first, triangles[0]!.first)),
      ) > PLANAR_OFFSET_TOLERANCE
    )
      return null;
  }
  return normal;
}

/** Two circles or arcs (sketch, projected or body edges): centre to centre. */
function resolveCenterDistanceRow(
  first: MeasuredTarget,
  second: MeasuredTarget,
): readonly MeasurementRow[] {
  return first.center && second.center
    ? [
        {
          id: "center-distance",
          label: "Center Distance",
          value: formatLength(distanceBetween(first.center, second.center)),
        },
      ]
    : [];
}

function meshFaceRows(
  geometry: RenderMeshGeometry,
  boundaryEdges: ReturnType<typeof collectMeshBoundaryEdges>,
): MeasurementRow[] {
  const perimeter = boundaryEdges.reduce(
    (sum, [start, end]) => sum + distanceBetween(start, end),
    0,
  );
  return [
    {
      id: "area",
      label: "Area",
      value: formatArea(getMeshArea(geometry), true),
    },
    {
      id: "perimeter",
      label: "Perimeter",
      value: formatLength(perimeter, true),
    },
    ...groupBoundaryLoops(boundaryEdges).map((loopLength, index) => ({
      id: `boundary-${index + 1}`,
      label: `Boundary ${index + 1}`,
      value: formatLength(loopLength, true),
    })),
  ];
}

function exactFaceRows(
  exact: Extract<TopologyMeasure, { surface: unknown }>,
): MeasurementRow[] {
  const area = { id: "area", label: "Area", value: formatArea(exact.area) };
  const surface = exact.surface;
  switch (surface.kind) {
    case "plane":
      return [
        area,
        {
          id: "perimeter",
          label: "Perimeter",
          value: formatLength(surface.perimeter),
        },
        {
          id: "normal",
          label: "Normal",
          value: formatDirection(surface.normal),
        },
      ];
    case "cylinder":
      return [
        { id: "radius", label: "Radius", value: formatLength(surface.radius) },
        {
          id: "diameter",
          label: "Diameter",
          value: formatLength(surface.radius * 2),
        },
        {
          id: "axis",
          label: "Axis",
          value: formatDirection(surface.axis.direction),
        },
        area,
      ];
    case "cone":
      return [
        {
          id: "half-angle",
          label: "Half Angle",
          value: formatAngle(surface.semiAngleRadians),
        },
        {
          id: "axis",
          label: "Axis",
          value: formatDirection(surface.axis.direction),
        },
        area,
      ];
    case "sphere":
      return [
        { id: "radius", label: "Radius", value: formatLength(surface.radius) },
        {
          id: "diameter",
          label: "Diameter",
          value: formatLength(surface.radius * 2),
        },
        { id: "center", label: "Center", value: formatPoint(surface.center) },
        area,
      ];
    case "torus":
      return [
        {
          id: "major-radius",
          label: "Major Radius",
          value: formatLength(surface.majorRadius),
        },
        {
          id: "minor-radius",
          label: "Minor Radius",
          value: formatLength(surface.minorRadius),
        },
        {
          id: "axis",
          label: "Axis",
          value: formatDirection(surface.axis.direction),
        },
        area,
      ];
    default:
      return [area];
  }
}

function derivePairwiseWitnesses(
  first: MeasuredTarget,
  second: MeasuredTarget,
  pairwise: PairwiseDistanceResult | null,
  options: {
    /** The curves' own witnesses (the Measure tool; a plain selection is highlighted already). */
    targetWitnesses: boolean;
    /** Mark both ends (a maximum or centre distance ends off the outlines). */
    endMarkers: boolean;
  },
): readonly MeasurementWitness[] {
  const curveWitnesses = options.targetWitnesses
    ? [
        ...(first.category === "curve" ? first.witnesses : []),
        ...(second.category === "curve" ? second.witnesses : []),
      ]
    : [];

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

  if (
    options.endMarkers ||
    first.category === "point" ||
    second.category === "point"
  ) {
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
    const result = second.exact
      ? measurePointToExactCurve(first.point, second.exact)
      : measurePointToPolyline(first.point, second.points);
    return result && second.approximate
      ? { ...result, approximate: true }
      : result;
  }

  if (first.kind === "polyline" && second.kind === "point") {
    const result = first.exact
      ? measurePointToExactCurve(second.point, first.exact)
      : measurePointToPolyline(second.point, first.points);
    return result
      ? {
          distance: result.distance,
          start: result.end,
          end: result.start,
          ...(first.approximate ? { approximate: true } : {}),
        }
      : null;
  }

  // Every other pairing measures tessellations; it is exact only when no
  // side tessellates a curved shape (T-6, review R7; cadara-h026.5).
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
    ? primitive.exact !== undefined || primitive.approximate === true
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
  return closestElementPair(
    polylineSegments(first),
    polylineSegments(second),
    segmentBound,
    segmentBound,
    (firstSegment, secondSegment) => {
      const result = closestPointsBetweenSegments(
        firstSegment[0],
        firstSegment[1],
        secondSegment[0],
        secondSegment[1],
      );
      return {
        distance: distanceBetween(result.start, result.end),
        start: result.start,
        end: result.end,
      };
    },
  );
}

function measurePolylineToMesh(
  polyline: readonly WorkspaceVec3[],
  triangles: readonly Triangle[],
): PairwiseDistanceResult | null {
  return closestElementPair(
    polylineSegments(polyline),
    triangles,
    segmentBound,
    triangleBound,
    (segment, triangle) =>
      closestPointsBetweenSegmentAndTriangle(segment[0], segment[1], triangle),
  );
}

function measureMeshToMesh(
  first: readonly Triangle[],
  second: readonly Triangle[],
): PairwiseDistanceResult | null {
  return closestElementPair(
    first,
    second,
    triangleBound,
    triangleBound,
    closestPointsBetweenTriangles,
  );
}

type Segment = readonly [WorkspaceVec3, WorkspaceVec3];

/** An axis-aligned box: per axis, its least and greatest coordinate. */
interface BoundingBox {
  min: WorkspaceVec3;
  max: WorkspaceVec3;
}

/** An element's box, its vertices and, for a triangle, its plane. */
interface ElementBound extends BoundingBox {
  points: readonly WorkspaceVec3[];
  plane: { normal: WorkspaceVec3; offset: number } | null;
}

interface ElementChunk {
  /** Index of the chunk's first element in its list. */
  offset: number;
  bounds: readonly ElementBound[];
  box: BoundingBox;
}

/** Consecutive elements per chunk: tessellations are spatially coherent. */
const ELEMENT_CHUNK_SIZE = 32;
/** Box bounds are compared with this margin (mm) for rounding. */
const PRUNE_SLACK = 1e-9;

function polylineSegments(points: readonly WorkspaceVec3[]): Segment[] {
  const segments: Segment[] = [];
  forEachSegment(points, false, (start, end) => segments.push([start, end]));
  return segments;
}

function boxOfPoints(points: readonly WorkspaceVec3[]): BoundingBox {
  const axis = (index: 0 | 1 | 2, pick: (...values: number[]) => number) =>
    pick(...points.map((point) => point[index]));
  return {
    min: [axis(0, Math.min), axis(1, Math.min), axis(2, Math.min)],
    max: [axis(0, Math.max), axis(1, Math.max), axis(2, Math.max)],
  };
}

const segmentBound = (segment: Segment): ElementBound => ({
  ...boxOfPoints(segment),
  points: segment,
  plane: null,
});

function triangleBound(triangle: Triangle): ElementBound {
  const points = [triangle.first, triangle.second, triangle.third];
  const cross = crossProduct(
    subtract(triangle.second, triangle.first),
    subtract(triangle.third, triangle.first),
  );
  const length = magnitude(cross);
  const normal = length > DISTANCE_EPSILON ? scale(cross, 1 / length) : null;
  return {
    ...boxOfPoints(points),
    points,
    plane: normal
      ? { normal, offset: dotProduct(normal, triangle.first) }
      : null,
  };
}

const pointBound = (point: WorkspaceVec3): ElementBound => ({
  min: point,
  max: point,
  points: [point],
  plane: null,
});

function chunkElements<T>(
  elements: readonly T[],
  boundOf: (element: T) => ElementBound,
): ElementChunk[] {
  const chunks: ElementChunk[] = [];
  for (let offset = 0; offset < elements.length; offset += ELEMENT_CHUNK_SIZE) {
    const bounds = elements
      .slice(offset, offset + ELEMENT_CHUNK_SIZE)
      .map(boundOf);
    chunks.push({
      offset,
      bounds,
      box: boxOfPoints(bounds.flatMap((bound) => [bound.min, bound.max])),
    });
  }
  return chunks;
}

/** No two points of the boxes are closer than this. */
function boxGap(first: BoundingBox, second: BoundingBox) {
  let sum = 0;
  for (const index of [0, 1, 2] as const) {
    const gap = Math.max(
      0,
      second.min[index] - first.max[index],
      first.min[index] - second.max[index],
    );
    sum += gap * gap;
  }
  return Math.sqrt(sum);
}

/** No point of `points` is closer than this to the plane. */
function planeGap(
  plane: ElementBound["plane"],
  points: readonly WorkspaceVec3[],
) {
  if (!plane) return 0;
  let above = Infinity;
  let below = Infinity;
  for (const point of points) {
    const offset = dotProduct(plane.normal, point) - plane.offset;
    if (offset >= 0) above = Math.min(above, offset);
    else below = Math.min(below, -offset);
  }
  return above === Infinity ? below : below === Infinity ? above : 0;
}

/**
 * No two points of the elements are closer than this: their boxes' gap, or
 * how far one lies off the other's plane (tight for parallel surfaces,
 * where boxes of slanted triangles are loose).
 */
function elementGap(first: ElementBound, second: ElementBound) {
  return Math.max(
    boxGap(first, second),
    planeGap(first.plane, second.points),
    planeGap(second.plane, first.points),
  );
}

/** No two points of the boxes are farther apart than this. */
function boxReach(first: BoundingBox, second: BoundingBox) {
  let sum = 0;
  for (const index of [0, 1, 2] as const) {
    const reach = Math.max(
      second.max[index] - first.min[index],
      first.max[index] - second.min[index],
    );
    sum += reach * reach;
  }
  return Math.sqrt(sum);
}

/**
 * The closest pair over `first` × `second`, exactly as the brute-force scan
 * in list order finds it: the least distance, ties going to the earliest
 * pair (first index, then second). Chunk pairs are visited nearest first
 * and any pair whose bounds (`elementGap`) are farther apart than the best
 * so far is skipped (cadara-h026.3: two dense curved faces took seconds to a
 * minute on the main thread; the plain selection measures every pick).
 */
function closestElementPair<A, B>(
  first: readonly A[],
  second: readonly B[],
  firstBound: (element: A) => ElementBound,
  secondBound: (element: B) => ElementBound,
  measure: (first: A, second: B) => PairwiseDistanceResult,
): PairwiseDistanceResult | null {
  const firstChunks = chunkElements(first, firstBound);
  const secondChunks = chunkElements(second, secondBound);
  const chunkPairs = firstChunks
    .flatMap((firstChunk) =>
      secondChunks.map((secondChunk) => ({
        firstChunk,
        secondChunk,
        gap: boxGap(firstChunk.box, secondChunk.box),
      })),
    )
    .sort((left, right) => left.gap - right.gap);
  let best: {
    result: PairwiseDistanceResult;
    first: number;
    second: number;
  } | null = null;
  for (const { firstChunk, secondChunk, gap } of chunkPairs) {
    if (best && gap - PRUNE_SLACK > best.result.distance) break;
    for (const [firstOffset, firstElement] of firstChunk.bounds.entries()) {
      for (const [
        secondOffset,
        secondElement,
      ] of secondChunk.bounds.entries()) {
        if (
          best &&
          elementGap(firstElement, secondElement) - PRUNE_SLACK >
            best.result.distance
        )
          continue;
        const firstIndex = firstChunk.offset + firstOffset;
        const secondIndex = secondChunk.offset + secondOffset;
        const result = measure(first[firstIndex]!, second[secondIndex]!);
        if (
          !best ||
          result.distance < best.result.distance ||
          (result.distance === best.result.distance &&
            (firstIndex < best.first ||
              (firstIndex === best.first && secondIndex < best.second)))
        )
          best = { result, first: firstIndex, second: secondIndex };
      }
    }
  }
  return best?.result ?? null;
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

  // Each vertex's distance to the other triangle is already a candidate,
  // earlier and equal, as an endpoint of its edges' segment results.

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

  const startClosest = closestPointOnTriangle(start, triangle);
  const endClosest = closestPointOnTriangle(end, triangle);
  const candidates: PairwiseDistanceResult[] = [
    {
      distance: distanceBetween(start, startClosest),
      start,
      end: startClosest,
    },
    {
      distance: distanceBetween(end, endClosest),
      start: end,
      end: endClosest,
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

type MeasurableTarget = Extract<
  PrimitiveRef,
  {
    kind:
      | "face"
      | "edge"
      | "vertex"
      | "region"
      | "sketchPoint"
      | "sketchEntity"
      | "projectedReferenceGeometry";
  }
>;

const PROJECTED_GEOMETRY_NOUNS = {
  point: "point",
  lineSegment: "line",
  circle: "circle",
  arc: "arc",
  spline: "spline",
} as const;

const FACE_SURFACE_NOUNS = {
  plane: "Planar face",
  cylinder: "Cylindrical face",
  cone: "Conical face",
  sphere: "Spherical face",
  torus: "Toroidal face",
  bspline: "Spline face",
  other: "Face",
} as const;

const EDGE_CURVE_NOUNS = {
  line: "Linear edge",
  circle: "Circular edge",
  ellipse: "Elliptical edge",
  bspline: "Spline edge",
  other: "Edge",
} as const;

/**
 * The readout name of a measured target: its geometry kind and its owner's
 * display label ("Face · Extrude 1", "Circle 2 · Sketch 3"), never a
 * durable id (cadara-h026.4). Presentation labels are not used: OCC ones
 * embed the topology id. A body face or edge measured exactly names its
 * surface or curve type ("Planar face", "Circular edge"; cadara-h026.5).
 */
function getTargetLabel(
  snapshot: WorkspaceSnapshot,
  target: MeasurableTarget,
  exact?: TopologyMeasure,
): string {
  if (
    target.kind === "face" ||
    target.kind === "edge" ||
    target.kind === "vertex"
  ) {
    const kind =
      exact && "surface" in exact
        ? FACE_SURFACE_NOUNS[exact.surface.kind]
        : exact && "curve" in exact
          ? EDGE_CURVE_NOUNS[exact.curve.kind]
          : { face: "Face", edge: "Edge", vertex: "Vertex" }[target.kind];
    const body = snapshot.document.bodies.find(
      (entry) => entry.bodyId === target.bodyId,
    );
    return `${kind} · ${body?.label || "Body"}`;
  }

  if (target.kind === "projectedReferenceGeometry") {
    const sketch = snapshot.document.sketches.find((entry) =>
      entry.sketch.projectedReferences?.some(
        (reference) => reference.referenceId === target.referenceId,
      ),
    );
    return `Projected ${PROJECTED_GEOMETRY_NOUNS[target.geometryKind]} · ${sketch?.label || "Sketch"}`;
  }

  const sketch = snapshot.document.sketches.find(
    (entry) => entry.sketchId === target.sketchId,
  );
  const ownName =
    target.kind === "region"
      ? sketch?.sketch.regions.find(
          (entry) => entry.regionId === target.regionId,
        )?.label || "Region"
      : target.kind === "sketchPoint"
        ? sketch?.sketch.definition.points.find(
            (entry) => entry.pointId === target.pointId,
          )?.label || "Point"
        : sketch?.sketch.definition.entities.find(
            (entry) => entry.entityId === target.entityId,
          )?.label || "Sketch curve";
  return `${ownName} · ${sketch?.label || "Sketch"}`;
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
 * at the record's own solved positions, or on `basis`, the pair an open
 * sketch's live regions were derived from. The polygon is display output
 * only.
 */
export function measureSketchRegion(
  sketch: SketchSnapshotRecord,
  region: RegionRecord,
  basis: RegionBoundaryBasis = regionBoundaryBasisOfRecord(sketch.sketch),
): SketchRegionMeasure | BoundaryCurveFailure {
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

function triangulateRegionLoops(
  loops: readonly (readonly SketchPoint2D[])[],
  outerIndex: number,
  plane: SketchPlaneDefinition,
): Triangle[] {
  const outer = loops[outerIndex];
  if (!outer) return [];
  const orderedLoops = [
    outer,
    ...loops.filter((_, index) => index !== outerIndex),
  ];
  // ISC-licensed Earcut is also the viewport ShapeUtils fill's algorithm. Use
  // the standalone package because measurement is shared with the Three-free SDK.
  const points = orderedLoops.flat();
  const { vertices, holes } = flatten(orderedLoops);
  const indices = earcut(vertices, holes, 2);
  const worldPoints = points.map((point) =>
    mapSketchPointToWorkspaceWorld(plane, point),
  );
  const triangles: Triangle[] = [];
  for (let index = 0; index < indices.length; index += 3) {
    triangles.push({
      first: worldPoints[indices[index]!]!,
      second: worldPoints[indices[index + 1]!]!,
      third: worldPoints[indices[index + 2]!]!,
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

/**
 * The volume enclosed by a body's face meshes, or null when they don't
 * close. T17h: the previous "outward from the vertex centroid" guess flipped
 * the walls of any hole or concavity.
 * - Face meshes are separate, so vertices are welded by exact position;
 *   triangles with fewer than three distinct vertices (the mesher's poles,
 *   apexes and fillet corners) enclose nothing and are dropped (review R-2).
 * - Every remaining edge must be used by exactly two triangles.
 * - Each shell (edge-connected set) is oriented through its shared edges:
 *   two consistently wound triangles run a shared edge in opposite
 *   directions. When every shell already is (the kernel winds faces
 *   outward), the signed sum is kept, so an inner void subtracts (review
 *   A-1); otherwise (face meshes wound either way) each shell counts by its
 *   magnitude, and a void would count as material.
 */
function getClosedMeshVolume(meshes: readonly RenderMeshGeometry[]) {
  const vertexIds = new Map<string, number>();
  const kept: Triangle[] = [];
  const corners: number[] = [];
  for (const mesh of meshes) {
    // Each face vertex is welded once (its exact position).
    const ids = mesh.vertexPositions.map((point) => {
      const key = getPointKey(point);
      let id = vertexIds.get(key);
      if (id === undefined) {
        id = vertexIds.size;
        vertexIds.set(key, id);
      }
      return id;
    });
    for (const [first, second, third] of mesh.triangleIndices) {
      const a = ids[first];
      const b = ids[second];
      const c = ids[third];
      if (a === undefined || b === undefined || c === undefined) continue;
      if (a === b || b === c || c === a) continue;
      kept.push({
        first: mesh.vertexPositions[first]!,
        second: mesh.vertexPositions[second]!,
        third: mesh.vertexPositions[third]!,
      });
      corners.push(a, b, c);
    }
  }
  if (kept.length === 0) return null;
  const vertexCount = vertexIds.size;
  // Edge key → the two uses, each `triangle * 2 + (start < end ? 1 : 0)`.
  const uses = new Map<number, number[]>();
  const edgeKey = (index: number, side: number) => {
    const start = corners[index * 3 + side]!;
    const end = corners[index * 3 + ((side + 1) % 3)]!;
    return {
      key: Math.min(start, end) * vertexCount + Math.max(start, end),
      use: index * 2 + (start < end ? 1 : 0),
    };
  };
  for (let index = 0; index < kept.length; index += 1) {
    for (let side = 0; side < 3; side += 1) {
      const { key, use } = edgeKey(index, side);
      const edgeUses = uses.get(key);
      if (edgeUses) edgeUses.push(use);
      else uses.set(key, [use]);
    }
  }
  for (const edgeUses of uses.values()) {
    if (edgeUses.length !== 2) return null;
  }
  const flipped = new Int8Array(kept.length).fill(-1);
  let signedTotal = 0;
  let magnitudeTotal = 0;
  let windingConsistent = true;
  for (let seed = 0; seed < kept.length; seed += 1) {
    if (flipped[seed] !== -1) continue;
    flipped[seed] = 0;
    const queue = [seed];
    let shellVolume = 0;
    while (queue.length > 0) {
      const current = queue.pop()!;
      const currentFlipped = flipped[current] === 1;
      shellVolume +=
        signedTetrahedronVolume(kept[current]!) * (currentFlipped ? -1 : 1);
      for (let side = 0; side < 3; side += 1) {
        const { key, use } = edgeKey(current, side);
        const [first, second] = uses.get(key)!;
        const other = first === use ? second! : first!;
        const neighbour = other >> 1;
        // The neighbour runs the shared edge against this triangle.
        const neighbourFlipped =
          ((other & 1) === 1) === (((use & 1) === 1) !== currentFlipped);
        if (flipped[neighbour] === -1) {
          flipped[neighbour] = neighbourFlipped ? 1 : 0;
          if (neighbourFlipped) windingConsistent = false;
          queue.push(neighbour);
        } else if ((flipped[neighbour] === 1) !== neighbourFlipped) {
          return null;
        }
      }
    }
    signedTotal += shellVolume;
    magnitudeTotal += Math.abs(shellVolume);
  }
  return windingConsistent ? Math.abs(signedTotal) : magnitudeTotal;
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

function formatArea(value: number, approximate = false) {
  return `${approximate ? "≈ " : ""}${formatNumber(value)} mm²`;
}

function formatVolume(value: number, approximate = false) {
  return `${approximate ? "≈ " : ""}${formatNumber(value)} mm³`;
}

function formatPoint(point: TopologyMeasureVec3) {
  return `${formatComponents(point)} mm`;
}

function formatDirection(direction: TopologyMeasureVec3) {
  return formatComponents(direction);
}

/** Components shown to 0.01; one that rounds to zero shows as 0, not -0. */
function formatComponents(vector: TopologyMeasureVec3) {
  return vector
    .map((component) =>
      formatNumber(Math.abs(component) < 0.005 ? 0 : component),
    )
    .join(", ");
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
