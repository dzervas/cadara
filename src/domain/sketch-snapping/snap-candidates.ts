import type { SketchSnapIntersectionTargetResult } from "@/contracts/sketch/edit-intersections";
import {
  nonAcceptedDerivedOutputPoints,
  nonAcceptedDerivedOutputs,
} from "@/contracts/sketch/offset-publication";
import type {
  DerivableSketchDefinition,
  SketchDefinition,
  SketchPoint2D,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import {
  projectedSplineIsClosed,
  type ProjectedSketchReferenceRecord,
} from "@/contracts/solver/schema";
import type {
  ProjectedGeometryId,
  ReferenceId,
  SketchEntityId,
  SketchPointId,
} from "@/contracts/shared/ids";
import { distanceBetween, midpoint } from "@/core/sketch/point-math";
import {
  closestPointOnSolvedCubicSpans,
  cubicSpansPoleBounds,
  solvedCubicSpanLocalDomain,
  solvedCubicSpanPoint,
  orderedSplinePointIds,
  reconstructSplineAggregate,
  solvedCubicSpans,
  type SolvedCubicSpan,
} from "@/contracts/sketch/spline-geometry";
import { isAcceptedSketchSolve } from "@/domain/editor/sketch-session";
import {
  SKETCH_ALIGNMENT_SNAP_RADII_PX,
  SKETCH_CURVE_RADII_PX,
  SKETCH_POINT_RADII_PX,
} from "@/core/sketch-interaction/screen-radii";

const DEFAULT_SKETCH_DATUM_AXIS_EXTENT = 10;
const EPSILON = 1e-9;
const TWO_PI = Math.PI * 2;

export type SketchSnapCandidateKind =
  | "endpoint"
  | "center"
  | "midpoint"
  | "nearestOnLine"
  | "nearestOnCircle"
  | "nearestOnArc"
  | "nearestOnSpline"
  | "intersection"
  | "horizontalAlignment"
  | "verticalAlignment"
  | "perpendicularFoot"
  | "tangent";

export type SketchSnapGlyphKind =
  | "endpoint"
  | "center"
  | "midpoint"
  | "curve"
  | "intersection"
  | "horizontal"
  | "vertical"
  | "perpendicular"
  | "tangent";

export type SketchSnapSourceRef =
  | {
      kind: "localPoint";
      pointId: SketchPointId;
    }
  | {
      kind: "localEntity";
      entityId: SketchEntityId;
      geometryKind: "point" | "lineSegment" | "circle" | "arc" | "spline";
    }
  | {
      kind: "projectedGeometry";
      referenceId: ReferenceId;
      geometryId: ProjectedGeometryId;
      geometryKind: "point" | "lineSegment" | "circle" | "arc" | "spline";
    }
  | {
      kind: "sketchDatum";
      datumId: "origin" | "xAxis" | "yAxis";
      geometryKind: "point" | "lineSegment";
    }
  | {
      kind: "transientAnchor";
      id: "active-start";
    };

export interface SketchSnapPreviewMetadata {
  label: string;
  glyph: SketchSnapGlyphKind;
}

export interface SketchSnapCandidate {
  key: string;
  kind: SketchSnapCandidateKind;
  point: SketchPoint2D;
  rawPointer: SketchPoint2D;
  distance: number;
  sources: readonly SketchSnapSourceRef[];
  preview: SketchSnapPreviewMetadata;
}

export type SketchSnapGeometry =
  | {
      kind: "point";
      source: SketchSnapSourceRef;
      point: SketchPoint2D;
      label: string;
    }
  | {
      kind: "lineSegment";
      source: SketchSnapSourceRef;
      start: SketchPoint2D;
      end: SketchPoint2D;
      label: string;
    }
  | {
      kind: "circle";
      source: SketchSnapSourceRef;
      center: SketchPoint2D;
      radius: number;
      label: string;
    }
  | {
      kind: "arc";
      source: SketchSnapSourceRef;
      center: SketchPoint2D;
      start: SketchPoint2D;
      end: SketchPoint2D;
      sweepDirection: "clockwise" | "counterClockwise";
      label: string;
    }
  | {
      /**
       * Exact cubic spans (T10f): a solved spline or derived shell (its
       * `solvedCubicSpans`, drawn domains kept) or a projected neutral
       * spline. Nearest and end point candidates are points of these spans.
       */
      kind: "spline";
      source: SketchSnapSourceRef;
      spans: readonly SolvedCubicSpan[];
      isClosed: boolean;
      label: string;
    }
  | {
      /** A projected spline given as source samples (they are its geometry). */
      kind: "sampledSpline";
      source: SketchSnapSourceRef;
      points: readonly SketchPoint2D[];
      isClosed: boolean;
      label: string;
    };

export interface ResolveSketchSnapInput {
  pointer: SketchPoint2D;
  geometries: readonly SketchSnapGeometry[];
  activeAnchor?: SketchPoint2D | null;
  /**
   * Sketch units per screen pixel at the pointer (T13-D13): tolerances are
   * screen pixels. `null` (no measured scale): nothing snaps.
   */
  sketchUnitsPerPixel: number | null;
  /** The active candidate, which stays eligible up to its exit radius. */
  activeCandidateKey?: string | null;
  /**
   * T13i (D24): exact spline intersections of the current accepted basis
   * (`getSketchSnapIntersections`); offered as `intersection` candidates.
   */
  exactIntersections?: readonly SketchExactIntersection[];
}

/**
 * T13i (D24): a crossing of a spline and another local curve, at the exact
 * edit-intersection service cut position (no new tolerance).
 */
export interface SketchExactIntersection {
  point: SketchPoint2D;
  sources: readonly [SketchSnapSourceRef, SketchSnapSourceRef];
}

export interface SketchSnapResult {
  rawPoint: SketchPoint2D;
  snappedPoint: SketchPoint2D;
  activeCandidate: SketchSnapCandidate | null;
  candidates: readonly SketchSnapCandidate[];
}

export function collectSketchSnapGeometries(input: {
  definition: SketchDefinition;
  projectedReferences?: readonly ProjectedSketchReferenceRecord[];
  /**
   * T08b-g5b / T10f: the solved snapshot the session displays; derived
   * offset shells snap along its solved spans (`solvedCubicSpans`, clipped
   * to their drawn domains; absent: no candidates). Splines snap along its
   * spans when it is accepted, otherwise (or absent) along the authored
   * reconstruction the session display draws (T10f review R-2).
   * [TECH] G19: a non-accepted offset output of this snapshot (every offset
   * output when it is absent) gives no candidates; nor do its driven points
   * ([TECH] G19b).
   */
  solvedSnapshot?: SolvedSketchSnapshot | null;
}): SketchSnapGeometry[] {
  const acceptedSnapshot = input.solvedSnapshot ?? { solvedEntities: [] };
  const nonAccepted = nonAcceptedDerivedOutputs(
    input.definition,
    acceptedSnapshot,
  );
  const nonAcceptedPoints = nonAcceptedDerivedOutputPoints(
    input.definition,
    acceptedSnapshot,
  );
  let solvedSplinesDrawn: boolean | undefined;
  const splinesUseSolvedSpans = () =>
    (solvedSplinesDrawn ??=
      !!input.solvedSnapshot && isAcceptedSketchSolve(input.solvedSnapshot));
  const solvedEntities = new Map(
    (input.solvedSnapshot?.solvedEntities ?? []).map((record) => [
      record.entityId,
      record,
    ]),
  );
  const points = new Map(
    input.definition.points.map((point) => [point.pointId, point]),
  );
  const centerPointIds = new Set(
    input.definition.entities.flatMap((entity) =>
      entity.kind === "circle" || entity.kind === "arc"
        ? [entity.centerPointId]
        : [],
    ),
  );
  const localPointGeometries: SketchSnapGeometry[] = input.definition.points
    .filter(
      (point) =>
        !centerPointIds.has(point.pointId) &&
        !nonAcceptedPoints.has(point.pointId),
    )
    .map((point) => ({
      kind: "point",
      source: {
        kind: "localPoint",
        pointId: point.pointId,
      },
      point: point.position,
      label: point.label,
    }));
  const localEntityGeometries = input.definition.entities.flatMap(
    (entity): SketchSnapGeometry[] => {
      if (nonAccepted.has(entity.entityId)) return [];
      const source: SketchSnapSourceRef = {
        kind: "localEntity",
        entityId: entity.entityId,
        geometryKind: entity.kind as Extract<
          SketchSnapSourceRef,
          { kind: "localEntity" }
        >["geometryKind"],
      };

      switch (entity.kind) {
        case "point": {
          const point = points.get(entity.pointId);
          return point
            ? [
                {
                  kind: "point",
                  source,
                  point: point.position,
                  label: entity.label,
                },
              ]
            : [];
        }
        case "lineSegment": {
          const start = points.get(entity.startPointId);
          const end = points.get(entity.endPointId);
          return start && end
            ? [
                {
                  kind: "lineSegment",
                  source,
                  start: start.position,
                  end: end.position,
                  label: entity.label,
                },
              ]
            : [];
        }
        case "circle": {
          const center = points.get(entity.centerPointId);
          return center
            ? [
                {
                  kind: "circle",
                  source,
                  center: center.position,
                  radius: entity.radius,
                  label: entity.label,
                },
              ]
            : [];
        }
        case "arc": {
          const center = points.get(entity.centerPointId);
          const start = points.get(entity.startPointId);
          const end = points.get(entity.endPointId);
          return center && start && end
            ? [
                {
                  kind: "arc",
                  source,
                  center: center.position,
                  start: start.position,
                  end: end.position,
                  sweepDirection: entity.sweepDirection,
                  label: entity.label,
                },
              ]
            : [];
        }
        case "spline":
        case "derivedPiecewiseCubic": {
          const record = solvedEntities.get(entity.entityId);
          const spans =
            entity.kind === "spline" && !splinesUseSolvedSpans()
              ? authoredSplineSpans(entity, points)
              : record?.kind === entity.kind
                ? solvedCubicSpans(record)
                : [];
          return spans.length > 0
            ? [
                {
                  kind: "spline",
                  source: { ...source, geometryKind: "spline" },
                  spans,
                  isClosed: false,
                  label: entity.label,
                },
              ]
            : [];
        }
        case "ellipse":
        case "ellipticalArc":
        case "conic":
        case "bezierCurve":
        case "profileText":
          return [];
      }
    },
  );
  const projectedGeometries = (input.projectedReferences ?? []).flatMap(
    (reference): SketchSnapGeometry[] => {
      if (reference.status !== "projected") {
        return [];
      }

      return reference.geometry.flatMap((geometry): SketchSnapGeometry[] => {
        const source: SketchSnapSourceRef = {
          kind: "projectedGeometry",
          referenceId: reference.referenceId,
          geometryId: geometry.geometryId,
          geometryKind: geometry.kind,
        };
        const label = `Projected ${geometry.geometryId}`;

        switch (geometry.kind) {
          case "point":
            return [
              {
                kind: "point",
                source,
                point: geometry.position,
                label,
              },
            ];
          case "lineSegment":
            return [
              {
                kind: "lineSegment",
                source,
                start: geometry.startPosition,
                end: geometry.endPosition,
                label,
              },
            ];
          case "circle":
            return [
              {
                kind: "circle",
                source,
                center: geometry.centerPosition,
                radius: geometry.radius,
                label,
              },
            ];
          case "arc":
            return [
              {
                kind: "arc",
                source,
                center: geometry.centerPosition,
                start: geometry.startPosition,
                end: geometry.endPosition,
                sweepDirection: geometry.sweepDirection,
                label,
              },
            ];
          case "spline":
            return geometry.representation.kind === "neutralCubicSpans"
              ? [
                  {
                    kind: "spline",
                    source,
                    spans: geometry.representation.spans,
                    isClosed: projectedSplineIsClosed(geometry),
                    label,
                  },
                ]
              : [
                  {
                    kind: "sampledSpline",
                    source,
                    points: geometry.representation.points,
                    isClosed: geometry.representation.isClosed,
                    label,
                  },
                ];
        }
      });
    },
  );
  const datumAxisExtent = getSketchDatumAxisExtent(
    input.definition,
    input.projectedReferences ?? [],
  );
  const datumGeometries: SketchSnapGeometry[] = [
    {
      kind: "point",
      source: { kind: "sketchDatum", datumId: "origin", geometryKind: "point" },
      point: [0, 0],
      label: "Sketch origin",
    },
    {
      kind: "lineSegment",
      source: {
        kind: "sketchDatum",
        datumId: "xAxis",
        geometryKind: "lineSegment",
      },
      start: [-datumAxisExtent, 0],
      end: [datumAxisExtent, 0],
      label: "Sketch X axis",
    },
    {
      kind: "lineSegment",
      source: {
        kind: "sketchDatum",
        datumId: "yAxis",
        geometryKind: "lineSegment",
      },
      start: [0, -datumAxisExtent],
      end: [0, datumAxisExtent],
      label: "Sketch Y axis",
    },
  ];

  return [
    ...datumGeometries,
    ...localPointGeometries,
    ...localEntityGeometries,
    ...projectedGeometries,
  ];
}

/** The authored reconstruction of a spline (what the session display draws). */
function authoredSplineSpans(
  entity: Extract<SketchDefinition["entities"][number], { kind: "spline" }>,
  points: ReadonlyMap<SketchPointId, { position: SketchPoint2D }>,
): readonly SolvedCubicSpan[] {
  const pointIds = orderedSplinePointIds(entity);
  if (pointIds.some((pointId) => !points.has(pointId))) return [];
  const positions = Object.fromEntries(
    pointIds.map((pointId) => [pointId, points.get(pointId)!.position]),
  ) as Record<SketchPointId, SketchPoint2D>;
  return reconstructSplineAggregate(entity, positions).spans.map((span) => ({
    interval: span.interval,
    poles: span.poles,
  }));
}

function getSketchDatumAxisExtent(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
) {
  const localCoordinates = definition.points.flatMap((point) => [
    Math.abs(point.position[0]),
    Math.abs(point.position[1]),
  ]);
  const projectedCoordinates = projectedReferences.flatMap((reference) =>
    reference.geometry.flatMap((geometry) => {
      switch (geometry.kind) {
        case "point":
          return [
            Math.abs(geometry.position[0]),
            Math.abs(geometry.position[1]),
          ];
        case "lineSegment":
          return [
            Math.abs(geometry.startPosition[0]),
            Math.abs(geometry.startPosition[1]),
            Math.abs(geometry.endPosition[0]),
            Math.abs(geometry.endPosition[1]),
          ];
        case "circle":
          return [
            Math.abs(geometry.centerPosition[0]) + geometry.radius,
            Math.abs(geometry.centerPosition[1]) + geometry.radius,
          ];
        case "arc": {
          const radius = Math.hypot(
            geometry.startPosition[0] - geometry.centerPosition[0],
            geometry.startPosition[1] - geometry.centerPosition[1],
          );
          return [
            Math.abs(geometry.centerPosition[0]) + radius,
            Math.abs(geometry.centerPosition[1]) + radius,
          ];
        }
        case "spline": {
          // Exact and conservative: the pole box contains the curve.
          const { representation } = geometry;
          const bounds =
            representation.kind === "neutralCubicSpans"
              ? cubicSpansPoleBounds(representation.spans)
              : null;
          const points =
            representation.kind === "neutralCubicSpans"
              ? bounds
                ? [bounds.min, bounds.max]
                : []
              : representation.points;
          return points.flatMap((point) => [
            Math.abs(point[0]),
            Math.abs(point[1]),
          ]);
        }
      }
    }),
  );
  const maxCoordinate = Math.max(
    0,
    ...localCoordinates,
    ...projectedCoordinates,
  );

  return Math.max(
    DEFAULT_SKETCH_DATUM_AXIS_EXTENT,
    maxCoordinate * 1.35 || DEFAULT_SKETCH_DATUM_AXIS_EXTENT,
  );
}

export function resolveSketchSnap(
  input: ResolveSketchSnapInput,
): SketchSnapResult {
  const unitsPerPixel = input.sketchUnitsPerPixel;
  if (unitsPerPixel === null) {
    return {
      rawPoint: input.pointer,
      snappedPoint: input.pointer,
      activeCandidate: null,
      candidates: [],
    };
  }

  // Collect within the largest exit radius, then apply each class's radius.
  const reach = SKETCH_POINT_RADII_PX.exit * unitsPerPixel;
  const candidates = rankSnapCandidates(
    [
      ...collectPointCandidates(input.pointer, input.geometries, reach),
      ...collectCurveCandidates(input.pointer, input.geometries, reach),
      ...collectIntersectionCandidates(input.pointer, input.geometries, reach),
      ...(input.exactIntersections ?? []).flatMap((intersection) => {
        const candidate = createCandidate({
          kind: "intersection",
          point: intersection.point,
          pointer: input.pointer,
          sources: intersection.sources,
        });
        return candidate.distance <= reach ? [candidate] : [];
      }),
      ...collectActiveAnchorCandidates(input, reach),
    ].filter(
      (candidate) =>
        candidate.distance <=
        getSnapRadiiPx(candidate.kind)[
          candidate.key === input.activeCandidateKey ? "exit" : "enter"
        ] *
          unitsPerPixel,
    ),
  );
  const activeCandidate = candidates[0] ?? null;

  return {
    rawPoint: input.pointer,
    snappedPoint: activeCandidate?.point ?? input.pointer,
    activeCandidate,
    candidates,
  };
}

/**
 * Snap classes in priority order (T13-D14): point-like, constructed points,
 * on-curve, alignment.
 */
function getSnapClass(kind: SketchSnapCandidateKind) {
  switch (kind) {
    case "endpoint":
    case "intersection":
    case "center":
    case "midpoint":
      return 0;
    case "tangent":
    case "perpendicularFoot":
      return 1;
    case "nearestOnLine":
    case "nearestOnCircle":
    case "nearestOnArc":
    case "nearestOnSpline":
      return 2;
    case "horizontalAlignment":
    case "verticalAlignment":
      return 3;
  }
}

function getSnapRadiiPx(kind: SketchSnapCandidateKind) {
  switch (getSnapClass(kind)) {
    case 0:
      return SKETCH_POINT_RADII_PX;
    case 3:
      return SKETCH_ALIGNMENT_SNAP_RADII_PX;
    default:
      return SKETCH_CURVE_RADII_PX;
  }
}

function collectPointCandidates(
  pointer: SketchPoint2D,
  geometries: readonly SketchSnapGeometry[],
  reach: number,
): SketchSnapCandidate[] {
  const candidates: SketchSnapCandidate[] = [];

  for (const geometry of geometries) {
    if (geometry.kind === "point") {
      candidates.push(
        createCandidate({
          kind: "endpoint",
          point: geometry.point,
          pointer,
          sources: [geometry.source],
        }),
      );
      continue;
    }

    if (geometry.kind === "lineSegment") {
      // A datum axis is an unbounded line drawn to a display extent: its
      // drawn ends and their midpoint are not points of the sketch.
      if (geometry.source.kind === "sketchDatum") {
        continue;
      }

      candidates.push(
        createCandidate({
          kind: "endpoint",
          point: geometry.start,
          pointer,
          sources: [geometry.source],
        }),
        createCandidate({
          kind: "endpoint",
          point: geometry.end,
          pointer,
          sources: [geometry.source],
        }),
        createCandidate({
          kind: "midpoint",
          point: midpoint(geometry.start, geometry.end),
          pointer,
          sources: [geometry.source],
        }),
      );
      continue;
    }

    if (geometry.kind === "spline" || geometry.kind === "sampledSpline") {
      if (!geometry.isClosed) {
        for (const point of splineEndPoints(geometry)) {
          candidates.push(
            createCandidate({
              kind: "endpoint",
              point,
              pointer,
              sources: [geometry.source],
            }),
          );
        }
      }
      continue;
    }

    candidates.push(
      createCandidate({
        kind: "center",
        point: geometry.center,
        pointer,
        sources: [geometry.source],
      }),
    );

    if (geometry.kind === "arc") {
      candidates.push(
        createCandidate({
          kind: "endpoint",
          point: geometry.start,
          pointer,
          sources: [geometry.source],
        }),
        createCandidate({
          kind: "endpoint",
          point: geometry.end,
          pointer,
          sources: [geometry.source],
        }),
      );
    }
  }

  return candidates.filter((candidate) => candidate.distance <= reach);
}

function collectCurveCandidates(
  pointer: SketchPoint2D,
  geometries: readonly SketchSnapGeometry[],
  reach: number,
): SketchSnapCandidate[] {
  const candidates: SketchSnapCandidate[] = [];

  for (const geometry of geometries) {
    if (geometry.kind === "lineSegment") {
      const point = projectPointToSegment(
        pointer,
        geometry.start,
        geometry.end,
      );
      candidates.push(
        createCandidate({
          kind: "nearestOnLine",
          point,
          pointer,
          sources: [geometry.source],
        }),
      );
      continue;
    }

    if (geometry.kind === "circle") {
      const point = nearestPointOnCircle(
        pointer,
        geometry.center,
        geometry.radius,
      );
      candidates.push(
        createCandidate({
          kind: "nearestOnCircle",
          point,
          pointer,
          sources: [geometry.source],
        }),
      );
      continue;
    }

    if (geometry.kind === "arc") {
      const point = nearestPointOnArc(pointer, geometry);
      candidates.push(
        createCandidate({
          kind: "nearestOnArc",
          point,
          pointer,
          sources: [geometry.source],
        }),
      );
      continue;
    }

    if (geometry.kind === "spline" || geometry.kind === "sampledSpline") {
      const point = nearestPointOnSpline(pointer, geometry, reach);
      if (!point) continue;
      candidates.push(
        createCandidate({
          kind: "nearestOnSpline",
          point,
          pointer,
          sources: [geometry.source],
        }),
      );
    }
  }

  return candidates.filter((candidate) => candidate.distance <= reach);
}

function collectIntersectionCandidates(
  pointer: SketchPoint2D,
  geometries: readonly SketchSnapGeometry[],
  reach: number,
): SketchSnapCandidate[] {
  const curves = geometries.filter(isCurveGeometry);
  const candidates: SketchSnapCandidate[] = [];

  for (let leftIndex = 0; leftIndex < curves.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < curves.length;
      rightIndex += 1
    ) {
      const left = curves[leftIndex];
      const right = curves[rightIndex];

      if (!left || !right) {
        continue;
      }

      for (const point of getCurveIntersections(left, right)) {
        candidates.push(
          createCandidate({
            kind: "intersection",
            point,
            pointer,
            sources: [left.source, right.source],
          }),
        );
      }
    }
  }

  return candidates.filter((candidate) => candidate.distance <= reach);
}

function collectActiveAnchorCandidates(
  input: ResolveSketchSnapInput,
  reach: number,
): SketchSnapCandidate[] {
  if (!input.activeAnchor) {
    return [];
  }

  const pointer = input.pointer;
  const activeAnchorSource: SketchSnapSourceRef = {
    kind: "transientAnchor",
    id: "active-start",
  };
  const candidates: SketchSnapCandidate[] = [
    createCandidate({
      kind: "horizontalAlignment",
      point: [pointer[0], input.activeAnchor[1]],
      pointer,
      sources: [activeAnchorSource],
    }),
    createCandidate({
      kind: "verticalAlignment",
      point: [input.activeAnchor[0], pointer[1]],
      pointer,
      sources: [activeAnchorSource],
    }),
  ];

  for (const geometry of input.geometries) {
    if (geometry.kind === "lineSegment") {
      const foot = projectPointToFiniteSegment(
        input.activeAnchor,
        geometry.start,
        geometry.end,
      );

      if (foot) {
        candidates.push(
          createCandidate({
            kind: "perpendicularFoot",
            point: foot,
            pointer,
            sources: [activeAnchorSource, geometry.source],
          }),
        );
      }
      continue;
    }

    if (geometry.kind === "circle" || geometry.kind === "arc") {
      for (const point of tangentPointsFromPoint(
        input.activeAnchor,
        geometry,
      )) {
        candidates.push(
          createCandidate({
            kind: "tangent",
            point,
            pointer,
            sources: [activeAnchorSource, geometry.source],
          }),
        );
      }
    }
  }

  return candidates.filter((candidate) => candidate.distance <= reach);
}

function createCandidate(input: {
  kind: SketchSnapCandidateKind;
  point: SketchPoint2D;
  pointer: SketchPoint2D;
  sources: readonly SketchSnapSourceRef[];
}): SketchSnapCandidate {
  const distance = distanceBetween(input.pointer, input.point);
  const sources = [...input.sources].sort((left, right) =>
    sourceKey(left).localeCompare(sourceKey(right)),
  );
  const key = [
    input.kind,
    ...(candidateKeyNeedsPoint(input.kind) ? [pointKey(input.point)] : []),
    ...sources.map(sourceKey),
  ].join(":");

  return {
    key,
    kind: input.kind,
    point: input.point,
    rawPointer: input.pointer,
    distance,
    sources,
    preview: getCandidatePreview(input.kind),
  };
}

function candidateKeyNeedsPoint(kind: SketchSnapCandidateKind) {
  return (
    kind === "endpoint" ||
    kind === "center" ||
    kind === "midpoint" ||
    kind === "intersection" ||
    kind === "tangent"
  );
}

function rankSnapCandidates(candidates: readonly SketchSnapCandidate[]) {
  return dedupeCandidates(candidates).sort(compareCandidate);
}

function dedupeCandidates(candidates: readonly SketchSnapCandidate[]) {
  const byKey = new Map<string, SketchSnapCandidate>();

  for (const candidate of candidates) {
    const existing = byKey.get(candidate.key);
    if (!existing || compareCandidate(candidate, existing) < 0) {
      byKey.set(candidate.key, candidate);
    }
  }

  return [...byKey.values()];
}

/**
 * T13-D14: class first, then distance (screen distance; the scale is
 * uniform), then source, then the stable key.
 */
function compareCandidate(
  left: SketchSnapCandidate,
  right: SketchSnapCandidate,
) {
  return (
    getSnapClass(left.kind) - getSnapClass(right.kind) ||
    compareDistance(left.distance, right.distance) ||
    sourcePreference(left) - sourcePreference(right) ||
    left.key.localeCompare(right.key)
  );
}

function compareDistance(left: number, right: number) {
  return Math.abs(left - right) <= EPSILON ? 0 : left - right;
}

function getCandidatePreview(
  kind: SketchSnapCandidateKind,
): SketchSnapPreviewMetadata {
  switch (kind) {
    case "endpoint":
      return { label: "Endpoint", glyph: "endpoint" };
    case "center":
      return { label: "Center", glyph: "center" };
    case "midpoint":
      return { label: "Midpoint", glyph: "midpoint" };
    case "nearestOnLine":
      return { label: "On line", glyph: "curve" };
    case "nearestOnCircle":
      return { label: "On circle", glyph: "curve" };
    case "nearestOnArc":
      return { label: "On arc", glyph: "curve" };
    case "nearestOnSpline":
      return { label: "On curve", glyph: "curve" };
    case "intersection":
      return { label: "Intersection", glyph: "intersection" };
    case "horizontalAlignment":
      return { label: "Horizontal", glyph: "horizontal" };
    case "verticalAlignment":
      return { label: "Vertical", glyph: "vertical" };
    case "perpendicularFoot":
      return { label: "Perpendicular", glyph: "perpendicular" };
    case "tangent":
      return { label: "Tangent", glyph: "tangent" };
  }
}

function sourcePreference(candidate: SketchSnapCandidate) {
  if (candidate.sources.some((source) => source.kind === "localPoint")) {
    return 0;
  }

  if (candidate.sources.some((source) => source.kind === "localEntity")) {
    return 1;
  }

  const hasDatum = candidate.sources.some(
    (source) => source.kind === "sketchDatum",
  );

  if (
    !hasDatum &&
    candidate.sources.some((source) => source.kind === "projectedGeometry")
  ) {
    return 2;
  }

  if (
    !hasDatum &&
    candidate.sources.some((source) => source.kind === "transientAnchor")
  ) {
    return 3;
  }

  if (hasDatum) {
    return 4;
  }

  return 5;
}

function sourceKey(source: SketchSnapSourceRef) {
  switch (source.kind) {
    case "localPoint":
      return `local-point:${source.pointId}`;
    case "localEntity":
      return `local-entity:${source.entityId}:${source.geometryKind}`;
    case "projectedGeometry":
      return `projected:${source.referenceId}:${source.geometryId}:${source.geometryKind}`;
    case "sketchDatum":
      return `datum:${source.datumId}:${source.geometryKind}`;
    case "transientAnchor":
      return `transient:${source.id}`;
  }
}

function pointKey(point: SketchPoint2D) {
  return `${point[0].toFixed(6)},${point[1].toFixed(6)}`;
}

function projectPointToSegment(
  point: SketchPoint2D,
  start: SketchPoint2D,
  end: SketchPoint2D,
): SketchPoint2D {
  const t = projectPointToSegmentParameter(point, start, end);

  if (t === null) {
    return start;
  }

  const clamped = clamp(t, 0, 1);
  return [
    start[0] + (end[0] - start[0]) * clamped,
    start[1] + (end[1] - start[1]) * clamped,
  ];
}

/**
 * Spline end point candidates: the exact ends of the first and last drawn
 * spans (poles 0 and 3 of untrimmed spans), or the first and last samples.
 */
function splineEndPoints(
  geometry: Extract<SketchSnapGeometry, { kind: "spline" | "sampledSpline" }>,
): SketchPoint2D[] {
  if (geometry.kind === "sampledSpline")
    return geometry.points.length > 0
      ? [geometry.points[0]!, geometry.points.at(-1)!]
      : [];
  const first = geometry.spans[0];
  const last = geometry.spans.at(-1);
  return first && last
    ? [
        solvedCubicSpanPoint(first, solvedCubicSpanLocalDomain(first)[0]),
        solvedCubicSpanPoint(last, solvedCubicSpanLocalDomain(last)[1]),
      ]
    : [];
}

/**
 * The nearest point on a spline (T10f): the owner's exact closest point of
 * its spans (a point of the curve, so a snapped position stays on it), or
 * the closest point of the source-sample polyline. Null when no span lies
 * within `tolerance` (the candidate would be dropped anyway).
 */
function nearestPointOnSpline(
  point: SketchPoint2D,
  geometry: Extract<SketchSnapGeometry, { kind: "spline" | "sampledSpline" }>,
  tolerance: number,
): SketchPoint2D | null {
  if (geometry.kind === "spline")
    return (
      closestPointOnSolvedCubicSpans(point, geometry.spans, tolerance)?.point ??
      null
    );
  const segments =
    geometry.isClosed && geometry.points.length > 2
      ? [...geometry.points, geometry.points[0]!]
      : geometry.points;
  let nearest = segments[0] ?? null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const candidate = projectPointToSegment(
      point,
      segments[index]!,
      segments[index + 1]!,
    );
    const distance = distanceBetween(point, candidate);
    if (distance < bestDistance) {
      nearest = candidate;
      bestDistance = distance;
    }
  }

  return nearest;
}

function projectPointToFiniteSegment(
  point: SketchPoint2D,
  start: SketchPoint2D,
  end: SketchPoint2D,
): SketchPoint2D | null {
  const t = projectPointToSegmentParameter(point, start, end);

  if (t === null || t < -EPSILON || t > 1 + EPSILON) {
    return null;
  }

  const clamped = clamp(t, 0, 1);
  return [
    start[0] + (end[0] - start[0]) * clamped,
    start[1] + (end[1] - start[1]) * clamped,
  ];
}

function projectPointToSegmentParameter(
  point: SketchPoint2D,
  start: SketchPoint2D,
  end: SketchPoint2D,
) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq <= EPSILON) {
    return null;
  }

  return ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSq;
}

function nearestPointOnCircle(
  point: SketchPoint2D,
  center: SketchPoint2D,
  radius: number,
): SketchPoint2D {
  const dx = point[0] - center[0];
  const dy = point[1] - center[1];
  const length = Math.hypot(dx, dy);

  if (length <= EPSILON) {
    return [center[0] + radius, center[1]];
  }

  return [
    center[0] + (dx / length) * radius,
    center[1] + (dy / length) * radius,
  ];
}

function nearestPointOnArc(
  point: SketchPoint2D,
  arc: Extract<SketchSnapGeometry, { kind: "arc" }>,
): SketchPoint2D {
  const radius = arcRadius(arc);
  const circlePoint = nearestPointOnCircle(point, arc.center, radius);

  return pointLiesOnArc(circlePoint, arc)
    ? circlePoint
    : distanceBetween(point, arc.start) <= distanceBetween(point, arc.end)
      ? arc.start
      : arc.end;
}

function tangentPointsFromPoint(
  point: SketchPoint2D,
  geometry: Extract<SketchSnapGeometry, { kind: "circle" | "arc" }>,
): SketchPoint2D[] {
  const radius =
    geometry.kind === "circle" ? geometry.radius : arcRadius(geometry);
  const dx = point[0] - geometry.center[0];
  const dy = point[1] - geometry.center[1];
  const distance = Math.hypot(dx, dy);

  if (distance <= radius + EPSILON) {
    return [];
  }

  const baseAngle = Math.atan2(dy, dx);
  const offset = Math.acos(radius / distance);
  const points: SketchPoint2D[] = [
    [
      geometry.center[0] + Math.cos(baseAngle + offset) * radius,
      geometry.center[1] + Math.sin(baseAngle + offset) * radius,
    ],
    [
      geometry.center[0] + Math.cos(baseAngle - offset) * radius,
      geometry.center[1] + Math.sin(baseAngle - offset) * radius,
    ],
  ];

  return geometry.kind === "arc"
    ? points.filter((candidate) => pointLiesOnArc(candidate, geometry))
    : points;
}

function isCurveGeometry(
  geometry: SketchSnapGeometry,
): geometry is Extract<
  SketchSnapGeometry,
  { kind: "lineSegment" | "circle" | "arc" }
> {
  return (
    geometry.kind === "lineSegment" ||
    geometry.kind === "circle" ||
    geometry.kind === "arc"
  );
}

function getCurveIntersections(
  left: Extract<SketchSnapGeometry, { kind: "lineSegment" | "circle" | "arc" }>,
  right: Extract<
    SketchSnapGeometry,
    { kind: "lineSegment" | "circle" | "arc" }
  >,
): SketchPoint2D[] {
  if (left.kind === "lineSegment" && right.kind === "lineSegment") {
    return lineLineIntersection(left, right);
  }

  if (left.kind === "lineSegment") {
    if (right.kind === "lineSegment") {
      return lineLineIntersection(left, right);
    }

    return lineCircleIntersections(left, right).filter((point) =>
      pointLiesOnGeometry(point, right),
    );
  }

  if (right.kind === "lineSegment") {
    return lineCircleIntersections(right, left).filter((point) =>
      pointLiesOnGeometry(point, left),
    );
  }

  return circleCircleIntersections(left, right).filter(
    (point) =>
      pointLiesOnGeometry(point, left) && pointLiesOnGeometry(point, right),
  );
}

function lineLineIntersection(
  left: Extract<SketchSnapGeometry, { kind: "lineSegment" }>,
  right: Extract<SketchSnapGeometry, { kind: "lineSegment" }>,
): SketchPoint2D[] {
  const p = left.start;
  const r: SketchPoint2D = [
    left.end[0] - left.start[0],
    left.end[1] - left.start[1],
  ];
  const q = right.start;
  const s: SketchPoint2D = [
    right.end[0] - right.start[0],
    right.end[1] - right.start[1],
  ];
  const denominator = cross(r, s);

  if (Math.abs(denominator) <= EPSILON) {
    return [];
  }

  const qp: SketchPoint2D = [q[0] - p[0], q[1] - p[1]];
  const t = cross(qp, s) / denominator;
  const u = cross(qp, r) / denominator;

  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) {
    return [];
  }

  return [[p[0] + r[0] * t, p[1] + r[1] * t]];
}

function lineCircleIntersections(
  line: Extract<SketchSnapGeometry, { kind: "lineSegment" }>,
  circleLike: Extract<SketchSnapGeometry, { kind: "circle" | "arc" }>,
): SketchPoint2D[] {
  const radius =
    circleLike.kind === "circle" ? circleLike.radius : arcRadius(circleLike);
  const dx = line.end[0] - line.start[0];
  const dy = line.end[1] - line.start[1];
  const fx = line.start[0] - circleLike.center[0];
  const fy = line.start[1] - circleLike.center[1];
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  const discriminant = b * b - 4 * a * c;

  if (a <= EPSILON || discriminant < -EPSILON) {
    return [];
  }

  if (Math.abs(discriminant) <= EPSILON) {
    const t = -b / (2 * a);
    return t >= -EPSILON && t <= 1 + EPSILON
      ? [[line.start[0] + dx * t, line.start[1] + dy * t]]
      : [];
  }

  const sqrt = Math.sqrt(discriminant);
  return [(-b - sqrt) / (2 * a), (-b + sqrt) / (2 * a)]
    .filter((t) => t >= -EPSILON && t <= 1 + EPSILON)
    .map(
      (t) => [line.start[0] + dx * t, line.start[1] + dy * t] as SketchPoint2D,
    );
}

function circleCircleIntersections(
  left: Extract<SketchSnapGeometry, { kind: "circle" | "arc" }>,
  right: Extract<SketchSnapGeometry, { kind: "circle" | "arc" }>,
): SketchPoint2D[] {
  const leftRadius = left.kind === "circle" ? left.radius : arcRadius(left);
  const rightRadius = right.kind === "circle" ? right.radius : arcRadius(right);
  const dx = right.center[0] - left.center[0];
  const dy = right.center[1] - left.center[1];
  const distance = Math.hypot(dx, dy);

  if (
    distance <= EPSILON ||
    distance > leftRadius + rightRadius + EPSILON ||
    distance < Math.abs(leftRadius - rightRadius) - EPSILON
  ) {
    return [];
  }

  const a =
    (leftRadius * leftRadius -
      rightRadius * rightRadius +
      distance * distance) /
    (2 * distance);
  const heightSq = leftRadius * leftRadius - a * a;

  if (heightSq < -EPSILON) {
    return [];
  }

  const base: SketchPoint2D = [
    left.center[0] + (a * dx) / distance,
    left.center[1] + (a * dy) / distance,
  ];

  if (Math.abs(heightSq) <= EPSILON) {
    return [base];
  }

  const height = Math.sqrt(heightSq);
  const rx = (-dy * height) / distance;
  const ry = (dx * height) / distance;

  return [
    [base[0] + rx, base[1] + ry],
    [base[0] - rx, base[1] - ry],
  ];
}

function pointLiesOnGeometry(
  point: SketchPoint2D,
  geometry: Extract<
    SketchSnapGeometry,
    { kind: "lineSegment" | "circle" | "arc" }
  >,
) {
  if (geometry.kind === "lineSegment") {
    return (
      distanceBetween(
        projectPointToSegment(point, geometry.start, geometry.end),
        point,
      ) <= 1e-6
    );
  }

  if (geometry.kind === "circle") {
    return (
      Math.abs(distanceBetween(point, geometry.center) - geometry.radius) <=
      1e-6
    );
  }

  return pointLiesOnArc(point, geometry);
}

function pointLiesOnArc(
  point: SketchPoint2D,
  arc: Extract<SketchSnapGeometry, { kind: "arc" }>,
) {
  const radius = arcRadius(arc);

  if (Math.abs(distanceBetween(point, arc.center) - radius) > 1e-6) {
    return false;
  }

  const start = normalizeAngle(
    Math.atan2(arc.start[1] - arc.center[1], arc.start[0] - arc.center[0]),
  );
  const end = normalizeAngle(
    Math.atan2(arc.end[1] - arc.center[1], arc.end[0] - arc.center[0]),
  );
  const angle = normalizeAngle(
    Math.atan2(point[1] - arc.center[1], point[0] - arc.center[0]),
  );
  const sweep = directedAngleDelta(start, end, arc.sweepDirection);
  const candidateDelta = directedAngleDelta(start, angle, arc.sweepDirection);

  return candidateDelta <= sweep + 1e-6;
}

function arcRadius(arc: Extract<SketchSnapGeometry, { kind: "arc" }>) {
  return distanceBetween(arc.center, arc.start);
}

function normalizeAngle(angle: number) {
  const normalized = angle % TWO_PI;
  return normalized < 0 ? normalized + TWO_PI : normalized;
}

function directedAngleDelta(
  start: number,
  end: number,
  direction: "clockwise" | "counterClockwise",
) {
  if (direction === "counterClockwise") {
    const delta = end - start;
    return delta < 0 ? delta + TWO_PI : delta;
  }

  const delta = start - end;
  return delta < 0 ? delta + TWO_PI : delta;
}

function cross(left: SketchPoint2D, right: SketchPoint2D) {
  return left[0] * right[1] - left[1] * right[0];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type SolvedEntityRecord = SolvedSketchSnapshot["solvedEntities"][number];
type Box = { min: SketchPoint2D; max: SketchPoint2D };

/**
 * T13i (D24): the spline targets of one stage of a basis's snap query: every
 * local spline with a valid reconstruction whose pole box meets the box of
 * a stage cutter (`curves`: a line, circle or arc; `splines`: another
 * spline), each box widened by the modeling tolerance. Box overlap is the
 * only cap. Offset shells are neither targets nor cutters of the service,
 * so they are not considered (recorded).
 */
export function getSketchSnapIntersectionTargets(
  definition: DerivableSketchDefinition,
  solvedSnapshot: SolvedSketchSnapshot,
  modelingTolerance: number,
  cutters: "curves" | "splines",
): SketchEntityId[] {
  const kinds = new Map(
    definition.entities.map((entity) => [entity.entityId, entity.kind]),
  );
  const boxes = solvedSnapshot.solvedEntities.flatMap((record) => {
    if (kinds.get(record.entityId) !== record.kind) return [];
    const box = solvedEntityBox(record);
    return box
      ? [
          {
            entityId: record.entityId,
            spline: record.kind === "spline",
            box: {
              min: [
                box.min[0] - modelingTolerance,
                box.min[1] - modelingTolerance,
              ] as SketchPoint2D,
              max: [
                box.max[0] + modelingTolerance,
                box.max[1] + modelingTolerance,
              ] as SketchPoint2D,
            },
          },
        ]
      : [];
  });
  return boxes.flatMap((target) =>
    target.spline &&
    boxes.some(
      (other) =>
        other.entityId !== target.entityId &&
        other.spline === (cutters === "splines") &&
        other.box.min[0] <= target.box.max[0] &&
        target.box.min[0] <= other.box.max[0] &&
        other.box.min[1] <= target.box.max[1] &&
        target.box.min[1] <= other.box.max[1],
    )
      ? [target.entityId]
      : [],
  );
}

function solvedEntityBox(record: SolvedEntityRecord): Box | null {
  switch (record.kind) {
    case "lineSegment":
      return pointsBox([record.startPosition, record.endPosition]);
    case "circle":
      return circleBox(record.centerPosition, record.solvedRadius);
    case "arc":
      // Conservative: the arc's full circle.
      return circleBox(
        record.centerPosition,
        distanceBetween(record.centerPosition, record.startPosition),
      );
    case "spline": {
      const bounds = cubicSpansPoleBounds(solvedCubicSpans(record));
      return bounds
        ? {
            min: [bounds.min[0], bounds.min[1]],
            max: [bounds.max[0], bounds.max[1]],
          }
        : null;
    }
    default:
      return null;
  }
}

function pointsBox(points: readonly SketchPoint2D[]): Box {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return {
    min: [Math.min(...xs), Math.min(...ys)],
    max: [Math.max(...xs), Math.max(...ys)],
  };
}

function circleBox(center: SketchPoint2D, radius: number): Box {
  return {
    min: [center[0] - radius, center[1] - radius],
    max: [center[0] + radius, center[1] + radius],
  };
}

/**
 * T13i (D24): the snap candidates of a basis's snap query results. Each
 * verified cut gives one intersection per cutter at the cut's exact
 * `position`, sources the spline target and that cutter. Not offered (they
 * are endpoint candidates already): a cut at a fit point (knot) and a cut
 * where a cutter's end point lies (a `coincident` tie). A failed target
 * gives nothing (all-or-nothing, like Trim). A spline-spline crossing is
 * taken once: from the target with the smaller id when the other target's
 * query verified too (review R-1: the batch then does not even compute it
 * from the larger id).
 * Review A-8 (intended): a crossing within ulps of another spline's interior
 * fit point, whose certified enclosure excludes the knot, is offered as an
 * intersection; the fit point's `endpoint` candidate wins that tie (same
 * class, equal distance, `localPoint` source first), so it authors the
 * coincident, not two on-curve relations. A ranking change must keep that.
 */
export function getSketchExactIntersections(
  definition: DerivableSketchDefinition,
  targets: readonly SketchSnapIntersectionTargetResult[],
): SketchExactIntersection[] {
  const entities = new Map(
    definition.entities.map((entity) => [entity.entityId, entity]),
  );
  const verifiedTargets = new Set(
    targets.flatMap((target) =>
      target.result.kind === "verified" ? [target.targetEntityId] : [],
    ),
  );
  const sourceOf = (entityId: SketchEntityId): SketchSnapSourceRef | null => {
    const kind = entities.get(entityId)?.kind;
    return kind === "lineSegment" ||
      kind === "circle" ||
      kind === "arc" ||
      kind === "spline"
      ? { kind: "localEntity", entityId, geometryKind: kind }
      : null;
  };
  return targets.flatMap(({ targetEntityId, result }) => {
    const target = sourceOf(targetEntityId);
    if (result.kind !== "verified" || !target) return [];
    return result.cuts.flatMap((cut) => {
      if (
        cut.knotOccurrenceIndex !== null ||
        cut.cutters.some((cutter) => cutter.tie?.kind === "coincident")
      )
        return [];
      return cut.cutters.flatMap((cutter): SketchExactIntersection[] => {
        const other = sourceOf(cutter.entityId);
        if (
          !other ||
          (verifiedTargets.has(cutter.entityId) &&
            cutter.entityId < targetEntityId)
        )
          return [];
        return [{ point: cut.position, sources: [target, other] }];
      });
    });
  });
}
