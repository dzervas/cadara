import type {
  SketchDefinition,
  SketchPoint2D,
} from "@/contracts/sketch/schema";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";
import type {
  ProjectedGeometryId,
  ReferenceId,
  SketchEntityId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type { SketchToolId } from "@/core/sketch-tools/definition";
import { distanceBetween, midpoint } from "@/domain/sketch/point-math";

const DEFAULT_SNAP_TOLERANCE = 0.18;
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
  priority: number;
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
      kind: "spline";
      source: SketchSnapSourceRef;
      fitPoints: readonly SketchPoint2D[];
      isClosed: boolean;
      label: string;
    };

export interface ResolveSketchSnapInput {
  pointer: SketchPoint2D;
  geometries: readonly SketchSnapGeometry[];
  activeTool?: SketchToolId | null;
  activeAnchor?: SketchPoint2D | null;
  tolerance?: number;
  activeCandidateKey?: string | null;
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
}): SketchSnapGeometry[] {
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
    .filter((point) => !centerPointIds.has(point.pointId))
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
        case "spline": {
          const fitPoints = entity.fitPointIds.flatMap((pointId) => {
            const point = points.get(pointId);
            return point ? [point.position] : [];
          });
          return fitPoints.length === entity.fitPointIds.length
            ? [
                {
                  kind: "spline",
                  source,
                  fitPoints,
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
            return [
              {
                kind: "spline",
                source,
                fitPoints: geometry.fitPoints,
                isClosed: geometry.isClosed,
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
        case "spline":
          return geometry.fitPoints.flatMap((point) => [
            Math.abs(point[0]),
            Math.abs(point[1]),
          ]);
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
  const tolerance = input.tolerance ?? DEFAULT_SNAP_TOLERANCE;
  const candidates = rankSnapCandidates(
    filterDatumAxisCurveCandidates([
      ...collectPointCandidates(
        input.pointer,
        input.geometries,
        tolerance,
        input.activeTool,
      ),
      ...collectCurveCandidates(
        input.pointer,
        input.geometries,
        tolerance,
        input.activeTool,
      ),
      ...collectIntersectionCandidates(
        input.pointer,
        input.geometries,
        tolerance,
        input.activeTool,
      ),
      ...collectActiveAnchorCandidates(input, tolerance),
    ]),
  );
  const activeCandidate = selectActiveCandidate(
    candidates,
    input.activeCandidateKey,
    tolerance,
  );

  return {
    rawPoint: input.pointer,
    snappedPoint: activeCandidate?.point ?? input.pointer,
    activeCandidate,
    candidates,
  };
}

function filterDatumAxisCurveCandidates(
  candidates: readonly SketchSnapCandidate[],
) {
  const hasPointLikeSnap = candidates.some(
    (candidate) =>
      !candidate.sources.some(
        (source) =>
          source.kind === "sketchDatum" &&
          source.geometryKind === "lineSegment",
      ) &&
      (candidate.kind === "endpoint" ||
        candidate.kind === "center" ||
        candidate.kind === "midpoint" ||
        candidate.kind === "intersection"),
  );

  if (!hasPointLikeSnap) {
    return candidates;
  }

  return candidates.filter(
    (candidate) =>
      !(
        candidate.kind === "nearestOnLine" &&
        candidate.sources.some(
          (source) =>
            source.kind === "sketchDatum" &&
            source.geometryKind === "lineSegment",
        )
      ),
  );
}

function collectPointCandidates(
  pointer: SketchPoint2D,
  geometries: readonly SketchSnapGeometry[],
  tolerance: number,
  activeTool: SketchToolId | null | undefined,
): SketchSnapCandidate[] {
  const candidates: SketchSnapCandidate[] = [];

  for (const geometry of geometries) {
    if (geometry.kind === "point") {
      candidates.push(
        createCandidate({
          kind: "endpoint",
          point: geometry.point,
          pointer,
          tolerance,
          activeTool,
          sources: [geometry.source],
        }),
      );
      continue;
    }

    if (geometry.kind === "lineSegment") {
      candidates.push(
        createCandidate({
          kind: "endpoint",
          point: geometry.start,
          pointer,
          tolerance,
          activeTool,
          sources: [geometry.source],
        }),
        createCandidate({
          kind: "endpoint",
          point: geometry.end,
          pointer,
          tolerance,
          activeTool,
          sources: [geometry.source],
        }),
        createCandidate({
          kind: "midpoint",
          point: midpoint(geometry.start, geometry.end),
          pointer,
          tolerance,
          activeTool,
          sources: [geometry.source],
        }),
      );
      continue;
    }

    if (geometry.kind === "spline") {
      if (!geometry.isClosed) {
        const start = geometry.fitPoints[0];
        const end = geometry.fitPoints.at(-1);
        if (start) {
          candidates.push(
            createCandidate({
              kind: "endpoint",
              point: start,
              pointer,
              tolerance,
              activeTool,
              sources: [geometry.source],
            }),
          );
        }
        if (end && end !== start) {
          candidates.push(
            createCandidate({
              kind: "endpoint",
              point: end,
              pointer,
              tolerance,
              activeTool,
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
        tolerance,
        activeTool,
        sources: [geometry.source],
      }),
    );

    if (geometry.kind === "arc") {
      candidates.push(
        createCandidate({
          kind: "endpoint",
          point: geometry.start,
          pointer,
          tolerance,
          activeTool,
          sources: [geometry.source],
        }),
        createCandidate({
          kind: "endpoint",
          point: geometry.end,
          pointer,
          tolerance,
          activeTool,
          sources: [geometry.source],
        }),
      );
    }
  }

  return candidates.filter((candidate) => candidate.distance <= tolerance);
}

function collectCurveCandidates(
  pointer: SketchPoint2D,
  geometries: readonly SketchSnapGeometry[],
  tolerance: number,
  activeTool: SketchToolId | null | undefined,
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
          tolerance,
          activeTool,
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
          tolerance,
          activeTool,
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
          tolerance,
          activeTool,
          sources: [geometry.source],
        }),
      );
      continue;
    }

    if (geometry.kind === "spline") {
      const point = nearestPointOnSpline(pointer, geometry);
      candidates.push(
        createCandidate({
          kind: "nearestOnSpline",
          point,
          pointer,
          tolerance,
          activeTool,
          sources: [geometry.source],
        }),
      );
    }
  }

  return candidates.filter((candidate) => candidate.distance <= tolerance);
}

function collectIntersectionCandidates(
  pointer: SketchPoint2D,
  geometries: readonly SketchSnapGeometry[],
  tolerance: number,
  activeTool: SketchToolId | null | undefined,
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
            tolerance,
            activeTool,
            sources: [left.source, right.source],
          }),
        );
      }
    }
  }

  return candidates.filter((candidate) => candidate.distance <= tolerance);
}

function collectActiveAnchorCandidates(
  input: ResolveSketchSnapInput,
  tolerance: number,
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
      tolerance,
      activeTool: input.activeTool,
      sources: [activeAnchorSource],
    }),
    createCandidate({
      kind: "verticalAlignment",
      point: [input.activeAnchor[0], pointer[1]],
      pointer,
      tolerance,
      activeTool: input.activeTool,
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
            tolerance,
            activeTool: input.activeTool,
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
            tolerance,
            activeTool: input.activeTool,
            sources: [activeAnchorSource, geometry.source],
          }),
        );
      }
    }
  }

  return candidates.filter((candidate) => candidate.distance <= tolerance);
}

function createCandidate(input: {
  kind: SketchSnapCandidateKind;
  point: SketchPoint2D;
  pointer: SketchPoint2D;
  tolerance: number;
  activeTool: SketchToolId | null | undefined;
  sources: readonly SketchSnapSourceRef[];
}): SketchSnapCandidate {
  const distance = distanceBetween(input.pointer, input.point);
  const priority = getCandidatePriority(input.kind, input.activeTool);
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
    priority,
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
  return dedupeCandidates(candidates).sort(
    (left, right) =>
      compareDistance(left.distance, right.distance) ||
      sourcePreference(left) - sourcePreference(right) ||
      left.priority - right.priority ||
      left.key.localeCompare(right.key),
  );
}

function selectActiveCandidate(
  candidates: readonly SketchSnapCandidate[],
  activeCandidateKey: string | null | undefined,
  tolerance: number,
) {
  const best = candidates[0] ?? null;

  if (!best || !activeCandidateKey) {
    return best;
  }

  const previous = candidates.find(
    (candidate) => candidate.key === activeCandidateKey,
  );

  if (
    previous &&
    previous.distance <= tolerance * 1.35 &&
    previous.distance <= best.distance + tolerance * 0.15
  ) {
    return previous;
  }

  return best;
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

function compareCandidate(
  left: SketchSnapCandidate,
  right: SketchSnapCandidate,
) {
  return (
    compareDistance(left.distance, right.distance) ||
    sourcePreference(left) - sourcePreference(right) ||
    left.priority - right.priority ||
    left.key.localeCompare(right.key)
  );
}

function compareDistance(left: number, right: number) {
  return Math.abs(left - right) <= EPSILON ? 0 : left - right;
}

function getCandidatePriority(
  kind: SketchSnapCandidateKind,
  activeTool: SketchToolId | null | undefined,
) {
  const basePriority: Record<SketchSnapCandidateKind, number> = {
    endpoint: 10,
    intersection: 12,
    center: 14,
    midpoint: 16,
    tangent: 18,
    perpendicularFoot: 20,
    horizontalAlignment: 24,
    verticalAlignment: 24,
    nearestOnLine: 34,
    nearestOnCircle: 36,
    nearestOnArc: 38,
    nearestOnSpline: 40,
  };
  const activeDrawingBoost =
    (activeTool === "line" || activeTool === "rectangle") &&
    (kind === "horizontalAlignment" ||
      kind === "verticalAlignment" ||
      kind === "perpendicularFoot" ||
      kind === "tangent")
      ? -4
      : 0;

  return basePriority[kind] + activeDrawingBoost;
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

function nearestPointOnSpline(
  point: SketchPoint2D,
  geometry: Extract<SketchSnapGeometry, { kind: "spline" }>,
): SketchPoint2D {
  const segments =
    geometry.isClosed && geometry.fitPoints.length > 2
      ? [...geometry.fitPoints, geometry.fitPoints[0]!]
      : geometry.fitPoints;
  let nearest = segments[0] ?? point;
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
