import type { SketchId } from "@/contracts/shared/ids";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import type {
  SketchReferenceImageRecord,
  SketchDefinition,
} from "@/contracts/sketch/schema";
import type {
  SketchConstraintRef,
  SketchDimensionRef,
  SketchEntityRef,
  SketchOperationRef,
} from "@/contracts/shared/references";

import type { SketchHistoryItem, SketchSessionState } from "./types";

function getDefinitionSketchId(definition: SketchDefinition) {
  return (
    definition.entities[0]?.target.sketchId ??
    definition.points[0]?.target.sketchId ??
    ("sketch_draft" as SketchId)
  );
}

function createSketchConstraintRef(
  sketchId: SketchId,
  constraintId: SketchDefinition["constraintIds"][number],
): SketchConstraintRef {
  return { kind: "constraint", sketchId, constraintId };
}

function createSketchDimensionRef(
  sketchId: SketchId,
  dimensionId: SketchDefinition["dimensionIds"][number],
): SketchDimensionRef {
  return { kind: "dimension", sketchId, dimensionId };
}

function createSketchEntityRef(
  sketchId: SketchId,
  entityId: SketchDefinition["entityIds"][number],
): SketchEntityRef {
  return { kind: "sketchEntity", sketchId, entityId };
}

function createSketchOperationRef(
  sketchId: SketchId,
  operationId: SketchReferenceImageRecord["operationId"],
): SketchOperationRef {
  return { kind: "sketchOperation", sketchId, operationId };
}

export function getSketchHistoryItems(
  definition: SketchDefinition,
): SketchHistoryItem[] {
  const sketchId = getDefinitionSketchId(definition);
  return [
    ...(definition.referenceImages ?? []).map((operation) => ({
      kind: "operation" as const,
      id: operation.operationId,
      label: operation.label,
      operation,
      target: createSketchOperationRef(sketchId, operation.operationId),
    })),
    ...definition.entities.map((entity) => ({
      kind: "entity" as const,
      id: entity.entityId,
      label: entity.label,
      target: createSketchEntityRef(sketchId, entity.entityId),
    })),
    ...definition.constraints.map((constraint) => ({
      kind: "constraint" as const,
      id: constraint.constraintId,
      label: constraint.label,
      target: createSketchConstraintRef(sketchId, constraint.constraintId),
    })),
    ...definition.dimensions.map((dimension) => ({
      kind: "dimension" as const,
      id: dimension.dimensionId,
      label: dimension.label,
      target: createSketchDimensionRef(sketchId, dimension.dimensionId),
    })),
  ];
}

export function buildCommitRequest(input: {
  sketchId: SketchId | null;
  sketchLabel: string;
  plane: SketchPlaneDefinition;
  definition: SketchDefinition;
}): SketchSessionState["commitRequest"] {
  return {
    solverCorrelation: null,
    sketchId: input.sketchId,
    sketchLabel: input.sketchLabel,
    plane: input.plane,
    definition: structuredClone(input.definition),
  };
}
