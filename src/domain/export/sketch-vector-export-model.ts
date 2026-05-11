import type {
  SketchVectorEntity,
  SketchVectorExportModel,
  SketchVectorRegion,
  SketchVectorRegionLoop,
  SketchVectorStyle,
} from "@/contracts/export/sketch-vector";
import type { DocumentExportDiagnostic } from "@/contracts/modeling/export";
import type {
  WorkspaceSnapshot,
  SketchSnapshotRecord,
} from "@/contracts/modeling/schema";
import type {
  RegionRecord,
  SketchDefinition,
  SketchEntityDefinition,
  SketchPoint2D,
  SketchStyleDefinition,
  SketchStyleFill,
  SketchStyleRecord,
  SketchStyleStroke,
  SolvedSketchEntityGeometryRecord,
} from "@/contracts/sketch/schema";
import type {
  DocumentId,
  RevisionId,
  SketchEntityId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";

export interface BuildSketchVectorExportModelInput {
  documentId: DocumentId;
  revisionId: RevisionId;
  sketches: readonly SketchSnapshotRecord[];
  target: DurableRef;
}

const DEFAULT_STROKE: SketchStyleStroke = {
  color: "black",
  opacity: 1,
  width: 1,
  lineCap: "round",
  lineJoin: "round",
  miterLimit: 4,
};

function createDiagnostic(
  code: string,
  message: string,
  target: DurableRef | null,
  severity: DocumentExportDiagnostic["severity"] = "warning",
): DocumentExportDiagnostic {
  return { code, severity, message, target };
}

function pointKey(point: SketchPoint2D) {
  return `${point[0]},${point[1]}`;
}

function distance(left: SketchPoint2D, right: SketchPoint2D) {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function getPoint(
  pointMap: ReadonlyMap<SketchPointId, SketchPoint2D>,
  pointId: SketchPointId,
  diagnostics: DocumentExportDiagnostic[],
  target: DurableRef,
) {
  const point = pointMap.get(pointId);
  if (!point) {
    diagnostics.push(
      createDiagnostic(
        "sketch-vector-missing-point",
        `Sketch export skipped geometry because point ${pointId} is missing.`,
        target,
      ),
    );
  }
  return point;
}

function resolveLocalFill(
  style: SketchStyleDefinition | undefined,
): SketchStyleFill {
  if (!style?.fillMode || style.fillMode === "none") {
    return { kind: "none" };
  }

  if (style.fillMode === "gradient") {
    return {
      kind: "gradient",
      gradient: {
        kind: "linear",
        angleRadians: 0,
        startColor: style.gradientStartColor ?? style.fillColor ?? "dodgerblue",
        startOpacity: 1,
        endColor: style.gradientEndColor ?? "black",
        endOpacity: 1,
      },
    };
  }

  return {
    kind: "solid",
    color: style.fillColor ?? "dodgerblue",
    opacity: 1,
  };
}

function resolveLocalStroke(
  style: SketchStyleDefinition | undefined,
): SketchStyleStroke | null {
  if (!style?.strokeEnabled) {
    return null;
  }

  return {
    color: style.strokeColor ?? DEFAULT_STROKE.color,
    opacity: 1,
    width: style.strokeWidth ?? DEFAULT_STROKE.width,
    lineCap: style.strokeCap ?? DEFAULT_STROKE.lineCap,
    lineJoin: style.strokeJoin ?? DEFAULT_STROKE.lineJoin,
    miterLimit: style.strokeMiterLimit ?? DEFAULT_STROKE.miterLimit,
    dashSize: style.strokeDashSize,
    gapSize: style.strokeGapSize,
  };
}

export function resolveAuthoredSketchVectorStyle(
  style: SketchStyleDefinition | SketchStyleRecord | undefined,
): SketchVectorStyle | null {
  if (!style) {
    return null;
  }

  if ("styleId" in style) {
    return {
      fill: style.fill,
      stroke:
        style.stroke.opacity > 0 && style.stroke.width > 0
          ? style.stroke
          : null,
    };
  }

  return {
    fill: resolveLocalFill(style),
    stroke: resolveLocalStroke(style),
  };
}

function buildEntity(
  entity: SketchEntityDefinition,
  solvedEntity: SolvedSketchEntityGeometryRecord | undefined,
  pointMap: ReadonlyMap<SketchPointId, SketchPoint2D>,
  target: DurableRef,
  diagnostics: DocumentExportDiagnostic[],
): SketchVectorEntity | null {
  const style = resolveAuthoredSketchVectorStyle(entity.style);

  if (solvedEntity) {
    if (solvedEntity.kind === "lineSegment") {
      return {
        kind: "lineSegment",
        entityId: entity.entityId,
        label: entity.label,
        start: solvedEntity.startPosition,
        end: solvedEntity.endPosition,
        isConstruction: entity.isConstruction,
        style,
      };
    }

    if (solvedEntity.kind === "circle") {
      return {
        kind: "circle",
        entityId: entity.entityId,
        label: entity.label,
        center: solvedEntity.centerPosition,
        radius: solvedEntity.solvedRadius,
        isConstruction: entity.isConstruction,
        style,
      };
    }

    if (solvedEntity.kind === "arc") {
      return {
        kind: "arc",
        entityId: entity.entityId,
        label: entity.label,
        center: solvedEntity.centerPosition,
        start: solvedEntity.startPosition,
        end: solvedEntity.endPosition,
        radius: distance(
          solvedEntity.centerPosition,
          solvedEntity.startPosition,
        ),
        sweepDirection: solvedEntity.sweepDirection,
        isConstruction: entity.isConstruction,
        style,
      };
    }

    if (solvedEntity.kind === "spline") {
      return {
        kind: "spline",
        entityId: entity.entityId,
        label: entity.label,
        points: solvedEntity.fitPoints,
        degree: solvedEntity.degree,
        isConstruction: entity.isConstruction,
        style,
      };
    }

    if (solvedEntity.kind === "bezierCurve") {
      return {
        kind: "bezierCurve",
        entityId: entity.entityId,
        label: entity.label,
        controlPoints: solvedEntity.controlPoints,
        degree: solvedEntity.degree,
        isConstruction: entity.isConstruction,
        style,
      };
    }

    if (solvedEntity.kind === "conic") {
      return {
        kind: "conic",
        entityId: entity.entityId,
        label: entity.label,
        start: solvedEntity.startPosition,
        control: solvedEntity.controlPosition,
        end: solvedEntity.endPosition,
        rho: solvedEntity.rho,
        isConstruction: entity.isConstruction,
        style,
      };
    }

    diagnostics.push(
      createDiagnostic(
        "sketch-vector-unsupported-entity",
        `Sketch entity ${entity.entityId} of kind '${solvedEntity.kind}' is not supported by sketch vector export yet.`,
        target,
      ),
    );
    return null;
  }

  switch (entity.kind) {
    case "lineSegment": {
      const start = getPoint(
        pointMap,
        entity.startPointId,
        diagnostics,
        target,
      );
      const end = getPoint(pointMap, entity.endPointId, diagnostics, target);
      return start && end
        ? {
            kind: entity.kind,
            entityId: entity.entityId,
            label: entity.label,
            start,
            end,
            isConstruction: entity.isConstruction,
            style,
          }
        : null;
    }
    case "circle": {
      const center = getPoint(
        pointMap,
        entity.centerPointId,
        diagnostics,
        target,
      );
      return center
        ? {
            kind: entity.kind,
            entityId: entity.entityId,
            label: entity.label,
            center,
            radius: entity.radius,
            isConstruction: entity.isConstruction,
            style,
          }
        : null;
    }
    case "arc": {
      const center = getPoint(
        pointMap,
        entity.centerPointId,
        diagnostics,
        target,
      );
      const start = getPoint(
        pointMap,
        entity.startPointId,
        diagnostics,
        target,
      );
      const end = getPoint(pointMap, entity.endPointId, diagnostics, target);
      return center && start && end
        ? {
            kind: entity.kind,
            entityId: entity.entityId,
            label: entity.label,
            center,
            start,
            end,
            radius: distance(center, start),
            sweepDirection: entity.sweepDirection,
            isConstruction: entity.isConstruction,
            style,
          }
        : null;
    }
    case "spline": {
      const points = entity.fitPointIds
        .map((pointId) => getPoint(pointMap, pointId, diagnostics, target))
        .filter((point): point is SketchPoint2D => point !== undefined);
      if (points.length < 2) {
        diagnostics.push(
          createDiagnostic(
            "sketch-vector-unsupported-entity",
            `Spline ${entity.entityId} needs at least two exportable points.`,
            target,
          ),
        );
        return null;
      }
      return {
        kind: entity.kind,
        entityId: entity.entityId,
        label: entity.label,
        points,
        degree: entity.degree,
        isConstruction: entity.isConstruction,
        style,
      };
    }
    case "bezierCurve": {
      const controlPoints = entity.controlPointIds
        .map((pointId) => getPoint(pointMap, pointId, diagnostics, target))
        .filter((point): point is SketchPoint2D => point !== undefined);
      if (controlPoints.length < 3) {
        diagnostics.push(
          createDiagnostic(
            "sketch-vector-unsupported-entity",
            `Bezier curve ${entity.entityId} needs at least three exportable control points.`,
            target,
          ),
        );
        return null;
      }
      return {
        kind: entity.kind,
        entityId: entity.entityId,
        label: entity.label,
        controlPoints,
        degree: entity.degree,
        isConstruction: entity.isConstruction,
        style,
      };
    }
    case "conic": {
      const start = getPoint(
        pointMap,
        entity.startPointId,
        diagnostics,
        target,
      );
      const control = getPoint(
        pointMap,
        entity.controlPointId,
        diagnostics,
        target,
      );
      const end = getPoint(pointMap, entity.endPointId, diagnostics, target);
      return start && control && end
        ? {
            kind: entity.kind,
            entityId: entity.entityId,
            label: entity.label,
            start,
            control,
            end,
            rho: entity.rho,
            isConstruction: entity.isConstruction,
            style,
          }
        : null;
    }
    case "point":
    case "ellipse":
    case "ellipticalArc":
    case "profileText":
      diagnostics.push(
        createDiagnostic(
          "sketch-vector-unsupported-entity",
          `Sketch entity ${entity.entityId} of kind '${entity.kind}' is not supported by sketch vector export yet.`,
          target,
        ),
      );
      return null;
  }
}

function buildRegionLoop(
  loop: RegionRecord["loops"][number],
  entityIds: ReadonlySet<SketchEntityId>,
): SketchVectorRegionLoop {
  return {
    role: loop.role,
    isClosed: loop.isClosed,
    boundaryPointIds: loop.boundaryPointIds,
    segments: loop.segments
      .filter(
        (segment) =>
          segment.source.kind === "entity" &&
          entityIds.has(segment.source.entityId),
      )
      .map((segment) => ({
        entityId:
          segment.source.kind === "entity"
            ? segment.source.entityId
            : ("" as SketchEntityId),
        traversalDirection: segment.traversalDirection ?? "forward",
      })),
  };
}

function buildRegions(
  definition: SketchDefinition,
  regions: readonly RegionRecord[],
  entityIds: ReadonlySet<SketchEntityId>,
): SketchVectorRegion[] {
  return regions
    .filter((region) => region.isClosed)
    .map((region) => {
      const styleRecord = definition.styles?.find(
        (style) =>
          style.target.kind === "region" &&
          style.target.regionId === region.regionId,
      );
      return {
        regionId: region.regionId,
        label: region.label,
        loops: region.loops
          .filter((loop) => loop.isClosed)
          .map((loop) => buildRegionLoop(loop, entityIds)),
        style: resolveAuthoredSketchVectorStyle(styleRecord),
      };
    });
}

export function buildSketchVectorExportModel(
  input: BuildSketchVectorExportModelInput,
): SketchVectorExportModel | { diagnostic: DocumentExportDiagnostic } {
  if (input.target.kind !== "sketch") {
    return {
      diagnostic: createDiagnostic(
        "sketch-vector-unexportable-target",
        "Sketch vector export requires a committed sketch target.",
        input.target,
        "error",
      ),
    };
  }

  const sketchTarget = input.target;
  const sketch = input.sketches.find(
    (candidate) => candidate.sketchId === sketchTarget.sketchId,
  );
  if (!sketch) {
    return {
      diagnostic: createDiagnostic(
        "sketch-vector-missing-sketch",
        `Sketch ${input.target.sketchId} does not resolve in the current document revision.`,
        input.target,
        "error",
      ),
    };
  }

  const diagnostics: DocumentExportDiagnostic[] = [];
  const points = new Map<SketchPointId, SketchPoint2D>();
  const solvedPoints = new Map(
    sketch.sketch.solvedSnapshot.solvedPoints.map(
      (point) => [point.pointId, point.solvedPosition] as const,
    ),
  );
  const solvedEntities = new Map(
    sketch.sketch.solvedSnapshot.solvedEntities.map(
      (entity) => [entity.entityId, entity] as const,
    ),
  );

  for (const point of sketch.sketch.definition.points) {
    if (points.has(point.pointId)) {
      diagnostics.push(
        createDiagnostic(
          "sketch-vector-duplicate-point",
          `Sketch export found duplicate point ${point.pointId}; the first point was kept.`,
          input.target,
        ),
      );
      continue;
    }
    points.set(
      point.pointId,
      solvedPoints.get(point.pointId) ?? point.position,
    );
  }

  const entities = sketch.sketch.definition.entities
    .map((entity) =>
      buildEntity(
        entity,
        solvedEntities.get(entity.entityId),
        points,
        input.target,
        diagnostics,
      ),
    )
    .filter((entity): entity is SketchVectorEntity => entity !== null);
  const entityIds = new Set(entities.map((entity) => entity.entityId));
  const regions = buildRegions(
    sketch.sketch.definition,
    sketch.sketch.regions,
    entityIds,
  );

  if (entities.length === 0 && regions.length === 0) {
    diagnostics.push(
      createDiagnostic(
        "sketch-vector-empty-sketch",
        `Sketch ${sketch.sketchId} has no exportable vector geometry.`,
        input.target,
        "error",
      ),
    );
  }

  return {
    documentId: input.documentId,
    revisionId: input.revisionId,
    sketchId: sketch.sketchId,
    label: sketch.label,
    units: "millimeter",
    points,
    entities,
    regions,
    diagnostics,
  };
}

export function buildSketchVectorExportModelFromSnapshot(
  snapshot: WorkspaceSnapshot,
  target: DurableRef,
): SketchVectorExportModel | { diagnostic: DocumentExportDiagnostic } {
  return buildSketchVectorExportModel({
    documentId: snapshot.document.documentId,
    revisionId: snapshot.document.revisionId,
    sketches: snapshot.document.sketches,
    target,
  });
}

export function getSketchVectorPointKey(point: SketchPoint2D) {
  return pointKey(point);
}
