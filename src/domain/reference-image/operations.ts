import type {
  ReferenceImageOperationState,
  ReferenceImagePayload,
} from "@/contracts/reference-image/schema";
import type {
  SketchReferenceImageRecord,
  SketchDefinition,
  SketchPoint2D,
} from "@/contracts/sketch/schema";
import type {
  SketchAuthoringOperationId,
  SketchId,
} from "@/contracts/shared/ids";
import { createDefaultReferenceImageCalibrationState } from "@/domain/reference-image-calibration/state";

const DEFAULT_REFERENCE_IMAGE_EXTENT = 200;

export interface CreateReferenceImageOperationInput {
  sequence: number;
  sketchId: SketchId;
  payload: ReferenceImagePayload;
}

export interface ActiveReferenceImageOperation {
  operation: SketchReferenceImageRecord;
  state: ReferenceImageOperationState;
}

export interface ReferenceImageOperationStateOverride {
  state: ReferenceImageOperationState;
  label?: string;
}

export function createReferenceImageOperation(
  input: CreateReferenceImageOperationInput,
): SketchReferenceImageRecord {
  return {
    operationId:
      `sketch_operation_${crypto.randomUUID()}` as SketchAuthoringOperationId,
    label:
      input.payload.fileName?.trim() || `Reference image ${input.sequence}`,
    kind: "referenceImage",
    ownedPointIds: [],
    ownedEntityIds: [],
    ownedState: {
      kind: "referenceImage",
      image: input.payload,
      placement: createReferenceImagePlacement(input.payload),
      calibration: createDefaultReferenceImageCalibrationState(),
    },
  };
}

export function createReferenceImagePlacement(
  payload: Pick<ReferenceImagePayload, "pixelWidth" | "pixelHeight">,
) {
  const scale =
    DEFAULT_REFERENCE_IMAGE_EXTENT /
    Math.max(payload.pixelWidth, payload.pixelHeight);
  return {
    center: [0, 0] as SketchPoint2D,
    width: payload.pixelWidth * scale,
    height: payload.pixelHeight * scale,
    rotationRadians: 0,
  };
}

export function collectActiveReferenceImageOperations(
  definition: Pick<SketchDefinition, "referenceImages">,
  overrides?: ReadonlyMap<
    SketchAuthoringOperationId,
    ReferenceImageOperationStateOverride
  >,
): ActiveReferenceImageOperation[] {
  return (definition.referenceImages ?? []).map((record) => {
    const override = overrides?.get(record.operationId);
    const state = override?.state ?? record.ownedState;
    return {
      operation: {
        ...record,
        label: override?.label ?? record.label,
        ownedState: state,
      },
      state,
    };
  });
}

export function createReferenceImageOperationTarget(
  sketchId: SketchId,
  operationId: SketchAuthoringOperationId,
) {
  return { kind: "sketchOperation" as const, sketchId, operationId };
}
