import type { SketchId } from "@/contracts/shared/ids";
import type {
  SketchDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import { getPrimitiveRefKey } from "@/core/editor/schema";
import {
  getConstraintAffectedGeometryRefs,
  getDimensionAffectedGeometryRefs,
} from "./annotation-targets";
import type {
  SketchConstraintDisplayState,
  SketchConstraintDisplaySummary,
  SketchConstraintDisplayTargetState,
} from "./types";

function createSketchConstraintRef(
  sketchId: SketchId,
  constraintId: string,
): PrimitiveRef {
  return {
    kind: "constraint",
    sketchId,
    constraintId: constraintId as import("@/contracts/shared/ids").ConstraintId,
  };
}

function createSketchDimensionRef(
  sketchId: SketchId,
  dimensionId: string,
): PrimitiveRef {
  return {
    kind: "dimension",
    sketchId,
    dimensionId: dimensionId as import("@/contracts/shared/ids").DimensionId,
  };
}

function createSketchEntityRef(
  sketchId: SketchId,
  entityId: string,
): PrimitiveRef {
  return {
    kind: "sketchEntity",
    sketchId,
    entityId: entityId as import("@/contracts/shared/ids").SketchEntityId,
  };
}

function createSketchPointRef(
  sketchId: SketchId,
  pointId: string,
): PrimitiveRef {
  return {
    kind: "sketchPoint",
    sketchId,
    pointId: pointId as import("@/contracts/shared/ids").SketchPointId,
  };
}

export function normalizeSketchConstraintDisplayState(
  status: SolvedSketchSnapshot["status"],
  affectedTargetCount: number,
): SketchConstraintDisplayState {
  if (
    status.constraintState === "overConstrained" ||
    status.constraintState === "inconsistent" ||
    (status.solveState !== "solved" && affectedTargetCount > 0)
  ) {
    return "overconstrained";
  }

  if (status.constraintState === "wellConstrained") {
    return "constrained";
  }

  return "underconstrained";
}

export function getSketchConstraintDisplaySummary(input: {
  sketchId: SketchId;
  definition: SketchDefinition;
  solvedSnapshot: SolvedSketchSnapshot;
}): SketchConstraintDisplaySummary {
  const affectedTargetKeys = getSketchAffectedConstraintTargetKeys(input);

  return {
    state: normalizeSketchConstraintDisplayState(
      input.solvedSnapshot.status,
      affectedTargetKeys.size,
    ),
    affectedTargetKeys,
  };
}

export function getSketchConstraintDisplayForTarget(
  target: PrimitiveRef | null,
  summary: SketchConstraintDisplaySummary,
): SketchConstraintDisplayTargetState {
  return {
    state: summary.state,
    isAffectedOverconstraint:
      target !== null &&
      summary.state === "overconstrained" &&
      summary.affectedTargetKeys.has(getPrimitiveRefKey(target)),
  };
}

function getSketchAffectedConstraintTargetKeys(input: {
  sketchId: SketchId;
  definition: SketchDefinition;
  solvedSnapshot: SolvedSketchSnapshot;
}) {
  const targetKeys = new Set<string>();
  const constraintById = new Map(
    input.definition.constraints.map((c) => [c.constraintId, c]),
  );
  const dimensionById = new Map(
    input.definition.dimensions.map((d) => [d.dimensionId, d]),
  );

  for (const diagnostic of input.solvedSnapshot.diagnostics) {
    if (diagnostic.severity !== "error" || !diagnostic.target) {
      continue;
    }

    for (const target of getSketchDiagnosticAffectedTargets(
      input.sketchId,
      constraintById,
      dimensionById,
      diagnostic.target,
    )) {
      targetKeys.add(getPrimitiveRefKey(target));
    }
  }

  for (const status of input.solvedSnapshot.constraintStatuses) {
    if (status.status === "satisfied") {
      continue;
    }

    targetKeys.add(
      getPrimitiveRefKey(
        createSketchConstraintRef(input.sketchId, status.constraintId),
      ),
    );
    const constraint = constraintById.get(status.constraintId);
    if (!constraint) {
      continue;
    }

    for (const target of getConstraintAffectedGeometryRefs(
      input.sketchId,
      constraint,
    )) {
      targetKeys.add(getPrimitiveRefKey(target));
    }
  }

  for (const status of input.solvedSnapshot.dimensionStatuses) {
    if (status.status !== "unsatisfied") {
      continue;
    }

    targetKeys.add(
      getPrimitiveRefKey(
        createSketchDimensionRef(input.sketchId, status.dimensionId),
      ),
    );
    const dimension = dimensionById.get(status.dimensionId);
    if (!dimension) {
      continue;
    }

    for (const target of getDimensionAffectedGeometryRefs(
      input.sketchId,
      dimension,
    )) {
      targetKeys.add(getPrimitiveRefKey(target));
    }
  }

  return targetKeys;
}

function getSketchDiagnosticAffectedTargets(
  sketchId: SketchId,
  constraintById: Map<string, SketchDefinition["constraints"][number]>,
  dimensionById: Map<string, SketchDefinition["dimensions"][number]>,
  target: NonNullable<SolvedSketchSnapshot["diagnostics"][number]["target"]>,
): readonly PrimitiveRef[] {
  switch (target.kind) {
    case "entity":
      return [createSketchEntityRef(sketchId, target.entityId)];
    case "point":
      return [createSketchPointRef(sketchId, target.pointId)];
    case "region":
      return [{ kind: "region", sketchId, regionId: target.regionId }];
    case "constraint": {
      const constraint = constraintById.get(target.constraintId);
      return constraint
        ? [
            createSketchConstraintRef(sketchId, target.constraintId),
            ...getConstraintAffectedGeometryRefs(sketchId, constraint),
          ]
        : [createSketchConstraintRef(sketchId, target.constraintId)];
    }
    case "dimension": {
      const dimension = dimensionById.get(target.dimensionId);
      return dimension
        ? [
            createSketchDimensionRef(sketchId, target.dimensionId),
            ...getDimensionAffectedGeometryRefs(sketchId, dimension),
          ]
        : [createSketchDimensionRef(sketchId, target.dimensionId)];
    }
  }
}
