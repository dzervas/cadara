import type {
  ReferenceImageOperationState,
  ReferenceImagePayload,
} from "@/contracts/reference-image/schema";
import type {
  SketchAuthoringOperation,
  SketchDefinition,
  SketchEntityDefinition,
  SketchPoint2D,
  SketchPointDefinition,
} from "@/contracts/sketch/schema";
import type {
  SketchAuthoringOperationId,
  SketchId,
} from "@/contracts/shared/ids";
import {
  createDefaultReferenceImageCalibrationState,
  stripReferenceImageRuntimeState,
} from "@/domain/reference-image-calibration/state";

const DEFAULT_REFERENCE_IMAGE_EXTENT = 200;

export interface CreateReferenceImageOperationInput {
  sequence: number;
  sketchId: SketchId;
  payload: ReferenceImagePayload;
}

export interface EditReferenceImageOperationInput {
  sequence: number;
  operationId: SketchAuthoringOperationId;
  state: ReferenceImageOperationState;
  label?: string;
  createdPoints?: readonly SketchPointDefinition[];
  createdEntities?: readonly SketchEntityDefinition[];
}

export interface ActiveReferenceImageOperation {
  operation: SketchAuthoringOperation;
  state: ReferenceImageOperationState;
}

export interface ReferenceImageOperationStateOverride {
  state: ReferenceImageOperationState;
  label?: string;
}

export function createReferenceImageOperation(
  input: CreateReferenceImageOperationInput,
): SketchAuthoringOperation {
  const placement = createReferenceImagePlacement(input.payload);
  const operationId =
    `sketch_operation_${input.sequence}_reference-image` as SketchAuthoringOperationId;

  return {
    operationId,
    label:
      input.payload.fileName?.trim() || `Reference image ${input.sequence}`,
    kind: "referenceImage",
    targets: {
      created: [{ kind: "operation", operationId }],
    },
    ownedState: {
      kind: "referenceImage",
      image: input.payload,
      placement,
      calibration: createDefaultReferenceImageCalibrationState(),
    },
  };
}

export function createReferenceImageEditOperation(
  input: EditReferenceImageOperationInput,
): SketchAuthoringOperation {
  const createdPointTargets = (input.createdPoints ?? []).map((point) => ({
    kind: "point" as const,
    pointId: point.pointId,
  }));
  const createdEntityTargets = (input.createdEntities ?? []).map((entity) => ({
    kind: "entity" as const,
    entityId: entity.entityId,
  }));
  return {
    operationId:
      `sketch_operation_${input.sequence}_edit-reference-image` as SketchAuthoringOperationId,
    label:
      input.label ??
      input.state.image.fileName?.trim() ??
      `Edit reference image ${input.sequence}`,
    kind: "edit",
    targets: {
      ...(createdPointTargets.length > 0 || createdEntityTargets.length > 0
        ? { created: [...createdPointTargets, ...createdEntityTargets] }
        : {}),
      edited: [{ kind: "operation", operationId: input.operationId }],
    },
    ...((input.createdPoints && input.createdPoints.length > 0) ||
    (input.createdEntities && input.createdEntities.length > 0)
      ? {
          createdGraph: {
            points: input.createdPoints,
            entities: input.createdEntities,
          },
        }
      : {}),
    ownedState: stripReferenceImageRuntimeState(input.state),
  };
}

export function createReferenceImagePlacement(
  payload: Pick<ReferenceImagePayload, "pixelWidth" | "pixelHeight">,
) {
  const scale =
    DEFAULT_REFERENCE_IMAGE_EXTENT /
    Math.max(payload.pixelWidth, payload.pixelHeight);
  const width = payload.pixelWidth * scale;
  const height = payload.pixelHeight * scale;

  return {
    center: [0, 0] as SketchPoint2D,
    width,
    height,
    rotationRadians: 0,
  };
}

export function collectActiveReferenceImageOperations(
  definition: Pick<SketchDefinition, "authoringOperations">,
  overrides?: ReadonlyMap<
    SketchAuthoringOperationId,
    ReferenceImageOperationStateOverride
  >,
): ActiveReferenceImageOperation[] {
  const operations = definition.authoringOperations ?? [];
  const activeOperations = new Map<
    SketchAuthoringOperationId,
    ActiveReferenceImageOperation
  >();

  for (const operation of operations) {
    if (
      operation.kind === "referenceImage" &&
      operation.ownedState.kind === "referenceImage"
    ) {
      const override = overrides?.get(operation.operationId);
      activeOperations.set(operation.operationId, {
        operation: override?.label
          ? {
              ...operation,
              label: override.label,
            }
          : operation,
        state: override?.state ?? {
          ...operation.ownedState,
          calibration:
            operation.ownedState.calibration ??
            createDefaultReferenceImageCalibrationState(),
        },
      });
      continue;
    }

    if (
      operation.kind === "edit" &&
      operation.ownedState?.kind === "referenceImage"
    ) {
      for (const target of operation.targets.edited ?? []) {
        if (target.kind !== "operation") {
          continue;
        }

        const current = activeOperations.get(target.operationId);
        if (!current) {
          continue;
        }

        const override = overrides?.get(target.operationId);
        activeOperations.set(target.operationId, {
          operation: {
            ...current.operation,
            kind: "referenceImage",
            label: override?.label ?? operation.label,
            ownedState: override?.state ?? {
              ...operation.ownedState,
              calibration:
                operation.ownedState.calibration ??
                createDefaultReferenceImageCalibrationState(),
            },
          },
          state: override?.state ?? {
            ...operation.ownedState,
            calibration:
              operation.ownedState.calibration ??
              createDefaultReferenceImageCalibrationState(),
          },
        });
      }
      continue;
    }

    if (operation.kind !== "delete") {
      continue;
    }

    for (const target of operation.targets.removed ?? []) {
      if (target.kind === "operation") {
        activeOperations.delete(target.operationId);
      }
    }
  }

  return [...activeOperations.values()];
}

export function createReferenceImageDeleteOperation(input: {
  sequence: number;
  removedOperationIds: readonly SketchAuthoringOperationId[];
}) {
  return {
    operationId:
      `sketch_operation_${input.sequence}_delete` as SketchAuthoringOperationId,
    label: `Delete ${input.sequence}`,
    kind: "delete" as const,
    targets: {
      removed: input.removedOperationIds.map((operationId) => ({
        kind: "operation" as const,
        operationId,
      })),
    },
  } satisfies SketchAuthoringOperation;
}

export function createReferenceImageOperationTarget(
  sketchId: SketchId,
  operationId: SketchAuthoringOperationId,
) {
  return {
    kind: "sketchOperation" as const,
    sketchId,
    operationId,
  };
}
