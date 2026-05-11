import type {
  SketchDefinition,
  SketchDerivationDefinition,
  SketchEntityDefinition,
  SketchPoint2D,
  SketchPointDefinition,
  SketchSolveDiagnostic,
} from "@/contracts/sketch/schema";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";

interface SketchDerivationEvaluationResult {
  definition: SketchDefinition;
  diagnostics: SketchSolveDiagnostic[];
}

type TransformPoint = (point: SketchPoint2D) => SketchPoint2D;

const EPSILON = 1e-9;

function diagnostic(
  code: string,
  severity: SketchSolveDiagnostic["severity"],
  message: string,
  target: SketchSolveDiagnostic["target"],
): SketchSolveDiagnostic {
  return { code, severity, message, target };
}

function getEntityPointIds(
  entity: SketchEntityDefinition,
): readonly SketchPointId[] {
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
      return entity.fitPointIds;
    case "ellipse":
      return [entity.centerPointId, entity.majorAxisPointId];
    case "ellipticalArc":
      return [
        entity.centerPointId,
        entity.majorAxisPointId,
        entity.startPointId,
        entity.endPointId,
      ];
    case "conic":
      return [entity.startPointId, entity.controlPointId, entity.endPointId];
    case "bezierCurve":
      return entity.controlPointIds;
    case "profileText":
      return [entity.anchorPointId];
  }
}

function supportsDerivedEntity(entity: SketchEntityDefinition) {
  return (
    entity.kind === "lineSegment" ||
    entity.kind === "point" ||
    entity.kind === "circle" ||
    entity.kind === "arc" ||
    entity.kind === "spline"
  );
}

function rotateAround(
  point: SketchPoint2D,
  origin: SketchPoint2D,
  angle: number,
  scale = 1,
): SketchPoint2D {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const x = (point[0] - origin[0]) * scale;
  const y = (point[1] - origin[1]) * scale;

  return [origin[0] + x * cos - y * sin, origin[1] + x * sin + y * cos];
}

function reflectAcrossLine(
  point: SketchPoint2D,
  start: SketchPoint2D,
  end: SketchPoint2D,
): SketchPoint2D | null {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared <= EPSILON) {
    return null;
  }

  const t =
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared;
  const projection: SketchPoint2D = [start[0] + t * dx, start[1] + t * dy];

  return [projection[0] * 2 - point[0], projection[1] * 2 - point[1]];
}

function getMirrorTransform(
  relationship: Extract<SketchDerivationDefinition, { kind: "mirror" }>,
  entityById: Map<SketchEntityId, SketchEntityDefinition>,
  pointById: Map<SketchPointId, SketchPointDefinition>,
  diagnostics: SketchSolveDiagnostic[],
): TransformPoint | null {
  const axis = entityById.get(relationship.mirrorReference.entityId);
  if (!axis || axis.kind !== "lineSegment") {
    diagnostics.push(
      diagnostic(
        "derived-transform-missing-mirror-axis",
        "error",
        `Mirror relationship ${relationship.derivationId} references a missing or unsupported axis.`,
        axis ? { kind: "entity", entityId: axis.entityId } : null,
      ),
    );
    return null;
  }

  const start = pointById.get(axis.startPointId);
  const end = pointById.get(axis.endPointId);
  if (!start || !end) {
    diagnostics.push(
      diagnostic(
        "derived-transform-unsatisfied-mirror-axis",
        "error",
        `Mirror relationship ${relationship.derivationId} cannot resolve its axis points.`,
        { kind: "entity", entityId: axis.entityId },
      ),
    );
    return null;
  }

  return (point) => {
    const reflected = reflectAcrossLine(point, start.position, end.position);
    return reflected ?? point;
  };
}

function getRelationshipTransform(
  relationship: SketchDerivationDefinition,
  entityById: Map<SketchEntityId, SketchEntityDefinition>,
  pointById: Map<SketchPointId, SketchPointDefinition>,
  instanceIndex: number,
  diagnostics: SketchSolveDiagnostic[],
): TransformPoint | null {
  switch (relationship.kind) {
    case "mirror":
      return getMirrorTransform(
        relationship,
        entityById,
        pointById,
        diagnostics,
      );
    case "linearPattern":
      return (point) => [
        point[0] + relationship.vector[0] * instanceIndex,
        point[1] + relationship.vector[1] * instanceIndex,
      ];
    case "circularPattern":
      return (point) =>
        rotateAround(
          point,
          relationship.center,
          relationship.angleRadians * instanceIndex,
        );
    case "transform":
      return (point) => {
        const rotated = rotateAround(
          point,
          relationship.origin,
          relationship.rotationRadians,
          relationship.scale,
        );
        return [
          rotated[0] + relationship.translation[0],
          rotated[1] + relationship.translation[1],
        ];
      };
  }
}

function transformedEntity(
  relationship: SketchDerivationDefinition,
  seed: SketchEntityDefinition,
  output: SketchEntityDefinition,
): SketchEntityDefinition {
  if (seed.kind === "circle" && output.kind === "circle") {
    return {
      ...output,
      radius:
        relationship.kind === "transform"
          ? seed.radius * Math.abs(relationship.scale)
          : seed.radius,
    };
  }

  if (seed.kind === "arc" && output.kind === "arc") {
    return {
      ...output,
      sweepDirection:
        relationship.kind === "mirror"
          ? seed.sweepDirection === "clockwise"
            ? "counterClockwise"
            : "clockwise"
          : seed.sweepDirection,
    };
  }

  return output;
}

let cachedDerivationInput: SketchDefinition | null = null;
let cachedDerivationResult: SketchDerivationEvaluationResult | null = null;

export function evaluateSketchDerivations(
  definition: SketchDefinition,
): SketchDerivationEvaluationResult {
  if (cachedDerivationInput === definition && cachedDerivationResult) {
    return cachedDerivationResult;
  }

  const relationships = definition.derivedRelationships ?? [];
  if (relationships.length === 0) {
    cachedDerivationInput = definition;
    cachedDerivationResult = { definition, diagnostics: [] };
    return cachedDerivationResult;
  }

  const diagnostics: SketchSolveDiagnostic[] = [];
  const pointById = new Map(
    definition.points.map((point) => [point.pointId, point]),
  );
  const entityById = new Map(
    definition.entities.map((entity) => [entity.entityId, entity]),
  );
  let nextPoints = definition.points;
  let nextEntities = definition.entities;

  const replacePoint = (pointId: SketchPointId, position: SketchPoint2D) => {
    const current = pointById.get(pointId);
    if (!current) {
      return;
    }

    const next = { ...current, position };
    pointById.set(pointId, next);
    nextPoints = nextPoints.map((point) =>
      point.pointId === pointId ? next : point,
    );
  };

  const replaceEntity = (entity: SketchEntityDefinition) => {
    entityById.set(entity.entityId, entity);
    nextEntities = nextEntities.map((entry) =>
      entry.entityId === entity.entityId ? entity : entry,
    );
  };

  for (const relationship of relationships) {
    for (const output of relationship.outputs) {
      const seed = entityById.get(output.seedEntityId);
      const target = entityById.get(output.outputEntityId);
      if (!seed) {
        diagnostics.push(
          diagnostic(
            "derived-transform-missing-seed",
            "error",
            `Derived relationship ${relationship.derivationId} references missing seed entity ${output.seedEntityId}.`,
            { kind: "entity", entityId: output.seedEntityId },
          ),
        );
        continue;
      }

      if (!target) {
        diagnostics.push(
          diagnostic(
            "derived-transform-missing-output",
            "error",
            `Derived relationship ${relationship.derivationId} references missing output entity ${output.outputEntityId}.`,
            { kind: "entity", entityId: output.seedEntityId },
          ),
        );
        continue;
      }

      if (!supportsDerivedEntity(seed) || seed.kind !== target.kind) {
        diagnostics.push(
          diagnostic(
            "derived-transform-unsupported-entity",
            "warning",
            `${seed.kind} ${seed.entityId} is valid sketch geometry, but this derived transform evaluator does not support it yet.`,
            { kind: "entity", entityId: seed.entityId },
          ),
        );
        continue;
      }

      const seedPointIds =
        output.seedPointIds.length > 0
          ? output.seedPointIds
          : getEntityPointIds(seed);
      if (seedPointIds.length !== output.outputPointIds.length) {
        diagnostics.push(
          diagnostic(
            "derived-transform-output-map-invalid",
            "error",
            `Derived relationship ${relationship.derivationId} has mismatched seed and output point maps.`,
            { kind: "entity", entityId: output.outputEntityId },
          ),
        );
        continue;
      }

      const transform = getRelationshipTransform(
        relationship,
        entityById,
        pointById,
        output.instanceIndex,
        diagnostics,
      );
      if (!transform) {
        continue;
      }

      for (let index = 0; index < seedPointIds.length; index += 1) {
        const seedPointId = seedPointIds[index]!;
        const outputPointId = output.outputPointIds[index]!;
        const seedPoint = pointById.get(seedPointId);
        const outputPoint = pointById.get(outputPointId);

        if (!seedPoint || !outputPoint) {
          diagnostics.push(
            diagnostic(
              "derived-transform-unsatisfied-point-map",
              "error",
              `Derived relationship ${relationship.derivationId} cannot resolve point map ${seedPointId} -> ${outputPointId}.`,
              { kind: "entity", entityId: output.outputEntityId },
            ),
          );
          continue;
        }

        replacePoint(outputPointId, transform(seedPoint.position));
      }

      replaceEntity(transformedEntity(relationship, seed, target));
    }
  }

  const result: SketchDerivationEvaluationResult = {
    definition: {
      ...definition,
      points: nextPoints,
      entities: nextEntities,
    },
    diagnostics,
  };
  cachedDerivationInput = definition;
  cachedDerivationResult = result;
  return result;
}
