import type {
  SketchDefinition,
  SketchDerivationDefinition,
  SketchEntityDefinition,
  SketchPoint2D,
  SketchPointDefinition,
  SketchSolveDiagnostic,
} from "@/contracts/sketch/schema";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import { getAuthoredLiteralValue } from "@/contracts/modeling/authored-values";
import {
  OFFSET_DIAGNOSTIC_CODES,
  computeOffsetChain,
  offsetSeedCurveFromEntity,
  type OffsetSeedCurve,
} from "@/contracts/sketch/offset-geometry";

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
    case "offset":
      // Offset relationships recompute per-segment geometry rather than a
      // point transform; they are evaluated by evaluateOffsetRelationship.
      return null;
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

interface OffsetPointUpdate {
  pointId: SketchPointId;
  position: SketchPoint2D;
}

/**
 * Recomputes an offset relationship's derived geometry from its seed chain.
 * All updates are collected before any is applied so a diagnostic failure
 * keeps the outputs in their last resolvable state.
 */
function evaluateOffsetRelationship(
  relationship: Extract<SketchDerivationDefinition, { kind: "offset" }>,
  entityById: Map<SketchEntityId, SketchEntityDefinition>,
  pointById: Map<SketchPointId, SketchPointDefinition>,
  diagnostics: SketchSolveDiagnostic[],
  replacePoint: (pointId: SketchPointId, position: SketchPoint2D) => void,
  replaceEntity: (entity: SketchEntityDefinition) => void,
) {
  const fail = (
    code: string,
    message: string,
    entityId: SketchEntityId | null = null,
  ) => {
    diagnostics.push(
      diagnostic(
        code,
        "error",
        `Offset relationship ${relationship.derivationId}: ${message}`,
        entityId ? { kind: "entity", entityId } : null,
      ),
    );
  };

  const distance = getAuthoredLiteralValue<number>(relationship.distance);
  if (typeof distance !== "number" || !Number.isFinite(distance)) {
    fail(
      OFFSET_DIAGNOSTIC_CODES.unresolvedDistance,
      "distance is unresolved; resolve expressions before evaluating derivations.",
    );
    return;
  }

  const curves: OffsetSeedCurve[] = [];
  const splineFitPointCounts = new Map<SketchEntityId, number>();
  for (const seedEntityId of relationship.seedEntityIds) {
    const seed = entityById.get(seedEntityId);
    const curve = seed
      ? offsetSeedCurveFromEntity(
          seed,
          (pointId) => pointById.get(pointId)?.position ?? null,
        )
      : null;
    if (!curve) {
      fail(
        OFFSET_DIAGNOSTIC_CODES.unsupportedSeed,
        `seed entity ${seedEntityId} is missing or unsupported.`,
        seedEntityId,
      );
      return;
    }

    curves.push(curve);
    if (curve.kind === "spline") {
      const output = relationship.outputs.find(
        (candidate) => candidate.seedEntityId === seedEntityId,
      );
      if (output) {
        splineFitPointCounts.set(seedEntityId, output.outputPointIds.length);
      }
    }
  }

  const result = computeOffsetChain({ curves, distance, splineFitPointCounts });
  if (!result.ok) {
    fail(result.code, result.message, result.seedEntityId);
    return;
  }

  const segmentBySeed = new Map(
    result.segments.map((segment) => [segment.seedEntityId, segment] as const),
  );
  const pointUpdates: OffsetPointUpdate[] = [];
  const entityUpdates: SketchEntityDefinition[] = [];

  for (const output of relationship.outputs) {
    const target = entityById.get(output.outputEntityId);
    const segment = segmentBySeed.get(output.seedEntityId);
    if (!target || !segment || target.kind !== segment.kind) {
      fail(
        OFFSET_DIAGNOSTIC_CODES.unsupportedSeed,
        `output entity ${output.outputEntityId} no longer matches its seed segment.`,
        output.seedEntityId,
      );
      return;
    }

    const positions: SketchPoint2D[] = [];
    switch (segment.kind) {
      case "lineSegment":
        positions.push(segment.start, segment.end);
        break;
      case "circle":
        positions.push(segment.center);
        if (target.kind === "circle") {
          entityUpdates.push({ ...target, radius: segment.radius });
        }
        break;
      case "arc":
        positions.push(segment.center, segment.start, segment.end);
        break;
      case "spline":
        positions.push(...segment.points);
        break;
    }

    if (positions.length !== output.outputPointIds.length) {
      fail(
        OFFSET_DIAGNOSTIC_CODES.splineFitFailure,
        `output entity ${output.outputEntityId} has a stale point map.`,
        output.seedEntityId,
      );
      return;
    }

    output.outputPointIds.forEach((pointId, index) => {
      pointUpdates.push({ pointId, position: positions[index]! });
    });
  }

  const jointKey = (first: SketchEntityId, second: SketchEntityId) =>
    `${first} ${second}`;
  const geometryJoints = new Map(
    result.joints.map(
      (joint) =>
        [jointKey(joint.firstSeedEntityId, joint.secondSeedEntityId), joint] as const,
    ),
  );

  if (geometryJoints.size !== relationship.jointOutputs.length) {
    fail(
      OFFSET_DIAGNOSTIC_CODES.jointUnsatisfied,
      "the joint topology changed; the committed joints no longer match the recomputed chain.",
    );
    return;
  }

  for (const jointOutput of relationship.jointOutputs) {
    const joint = geometryJoints.get(
      jointKey(jointOutput.firstSeedEntityId, jointOutput.secondSeedEntityId),
    );
    const target = entityById.get(jointOutput.outputEntityId);
    if (!joint || !target || target.kind !== "arc") {
      fail(
        OFFSET_DIAGNOSTIC_CODES.jointUnsatisfied,
        `joint arc ${jointOutput.outputEntityId} cannot be maintained.`,
        jointOutput.outputEntityId,
      );
      return;
    }

    pointUpdates.push({
      pointId: jointOutput.centerPointId,
      position: joint.center,
    });
    if (target.sweepDirection !== joint.sweepDirection) {
      entityUpdates.push({ ...target, sweepDirection: joint.sweepDirection });
    }
  }

  for (const update of pointUpdates) {
    replacePoint(update.pointId, update.position);
  }
  for (const entity of entityUpdates) {
    replaceEntity(entity);
  }
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
    if (relationship.kind === "offset") {
      evaluateOffsetRelationship(
        relationship,
        entityById,
        pointById,
        diagnostics,
        replacePoint,
        replaceEntity,
      );
      continue;
    }

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
