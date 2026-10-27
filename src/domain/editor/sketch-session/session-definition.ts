import type { SketchSessionState } from "./types";
import type {
  SketchPointId,
  SketchEntityId,
  ConstraintId,
  DimensionId,
  SketchAuthoringOperationId,
  SketchId,
} from "@/contracts/shared/ids";
import type {
  SketchEntityRef,
  SketchPointRef,
  SketchConstraintRef,
  SketchDimensionRef,
} from "@/contracts/shared/references";
import { SKETCH_SCHEMA_VERSION } from "@/contracts/sketch/schema";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import { REFERENCE_IMAGE_CALIBRATION_MODE_ID } from "@/domain/reference-image-calibration/mode/shared";
import type { ReferenceImageCalibrationModeState } from "@/domain/reference-image-calibration/mode/shared";
import type { ReferenceImageOperationState } from "@/contracts/reference-image/schema";
import { collectActiveReferenceImageOperations } from "@/domain/reference-image/operations";
import type { ReferenceImageOperationStateOverride } from "@/domain/reference-image/operations";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";
import {
  buildReferenceImageAnchorProjectedReferences,
  mergeReferenceImageAnchorReferences,
} from "@/domain/reference-image-calibration/export/references";
import { evaluateAuthoredSketchDerivations } from "@/domain/modeling/sketch-dimension-expressions";
import type { AuthoredSketchDerivationSettings } from "@/domain/modeling/sketch-dimension-expressions";

export const CONSTRAINED_DRAG_BLOCKED_MESSAGE =
  "Geometry is constrained and cannot move to that position.";

// D6 constrained-drag feedback gate (minimum-motion-sketch-drag). A drag frame
// is only a candidate for constrained-movement feedback when a meaningful move
// was requested (> CONSTRAINED_DRAG_REQUEST_EPSILON world units) yet the target
// barely followed (< CONSTRAINED_DRAG_MOVE_FRACTION of the request). Whether
// that barely-moved frame is truly constrained (feedback) or just lagged along a
// free DOF (no feedback) is then decided by a solver mobility probe.
export const CONSTRAINED_DRAG_REQUEST_EPSILON = 1e-3;

export const CONSTRAINED_DRAG_MOVE_FRACTION = 0.01;

export const REFERENCE_IMAGE_ANCHOR_MARKER_RADIUS = 0.28;

export const REFERENCE_IMAGE_ANCHOR_OVERLAY_RADIUS = 0.4;

export const REFERENCE_IMAGE_ANCHOR_MARKER_COLOR = 0xf6c453;

/** Tool diagnostics never enter the session/region notification channel. */
export function withSketchToolValidation(
  session: SketchSessionState,
  message: string | null,
): SketchSessionState {
  return {
    ...session,
    toolPresentation: {
      ...session.toolPresentation,
      prompts: session.toolPresentation?.prompts ?? [],
      validation: message
        ? [{ id: "tool-validation", message, severity: "warning" }]
        : [],
    },
  };
}

export function createPointId(sequence: number, suffix: string): SketchPointId {
  return `sketch_point_${sequence}_${suffix}_${crypto.randomUUID()}` as SketchPointId;
}

export function createEntityId(
  sequence: number,
  suffix: string,
): SketchEntityId {
  return `sketch_entity_${sequence}_${suffix}_${crypto.randomUUID()}` as SketchEntityId;
}

export function createConstraintId(
  sequence: number,
  suffix: string,
): ConstraintId {
  return `constraint_${sequence}_${suffix}_${crypto.randomUUID()}` as ConstraintId;
}

export function createDimensionId(
  sequence: number,
  suffix: string,
): DimensionId {
  return `dimension_${sequence}_${suffix}_${crypto.randomUUID()}` as DimensionId;
}

export function createSketchEntityRef(
  sketchId: SketchId,
  entityId: SketchEntityId,
): SketchEntityRef {
  return {
    kind: "sketchEntity",
    sketchId,
    entityId,
  };
}

export function createSketchPointRef(
  sketchId: SketchId,
  pointId: SketchPointId,
): SketchPointRef {
  return {
    kind: "sketchPoint",
    sketchId,
    pointId,
  };
}

export function createSketchConstraintRef(
  sketchId: SketchId,
  constraintId: ConstraintId,
): SketchConstraintRef {
  return {
    kind: "constraint",
    sketchId,
    constraintId,
  };
}

export function createSketchDimensionRef(
  sketchId: SketchId,
  dimensionId: DimensionId,
): SketchDimensionRef {
  return {
    kind: "dimension",
    sketchId,
    dimensionId,
  };
}

export function createEmptyDefinition(): SketchDefinition {
  return {
    schemaVersion: SKETCH_SCHEMA_VERSION,
    referenceIds: [],
    references: [],
    pointIds: [],
    points: [],
    entityIds: [],
    entities: [],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
    svgRenderingEnabled: false,
    derivedRelationships: [],
  };
}

export function getReferenceImageOperationOverrides(
  session: SketchSessionState,
) {
  const activeMode = session.activeSpecialMode;
  if (
    !activeMode ||
    activeMode.modeId !== REFERENCE_IMAGE_CALIBRATION_MODE_ID
  ) {
    return undefined;
  }

  const modeState = activeMode.state as ReferenceImageCalibrationModeState;
  if (modeState.draftState.kind !== "referenceImage") {
    return undefined;
  }

  return new Map([
    [
      modeState.operationId,
      {
        state: modeState.draftState as ReferenceImageOperationState,
        label: modeState.draftState.image.fileName,
      },
    ],
  ]);
}

export function collectVisibleReferenceImageAnchorPointIds(
  definition: Pick<SketchDefinition, "referenceImages">,
  overrides?: ReadonlyMap<
    SketchAuthoringOperationId,
    ReferenceImageOperationStateOverride
  >,
) {
  const pointIds = new Set<SketchPointId>();

  for (const { state } of collectActiveReferenceImageOperations(
    definition,
    overrides,
  )) {
    if (!state.calibration?.showExportedAnchorsInSketch) {
      continue;
    }

    for (const anchor of state.calibration.anchors) {
      pointIds.add(anchor.pointId as SketchPointId);
    }
  }

  return pointIds;
}

export function collectVisibleReferenceImageAnchorLabels(
  definition: Pick<SketchDefinition, "referenceImages">,
  overrides?: ReadonlyMap<
    SketchAuthoringOperationId,
    ReferenceImageOperationStateOverride
  >,
) {
  const labels = new Map<SketchPointId, string>();

  for (const { state } of collectActiveReferenceImageOperations(
    definition,
    overrides,
  )) {
    if (!state.calibration?.showExportedAnchorsInSketch) {
      continue;
    }

    for (const anchor of state.calibration.anchors) {
      labels.set(anchor.pointId as SketchPointId, anchor.label);
    }
  }

  return labels;
}

export function cloneDefinition(
  definition: SketchDefinition,
): SketchDefinition {
  return {
    ...definition,
    schemaVersion: definition.schemaVersion,
    referenceIds: [...definition.referenceIds],
    references: [...definition.references],
    pointIds: [...definition.pointIds],
    points: [...definition.points],
    entityIds: [...definition.entityIds],
    entities: [...definition.entities],
    constraintIds: [...definition.constraintIds],
    constraints: [...definition.constraints],
    dimensionIds: [...definition.dimensionIds],
    dimensions: [...definition.dimensions],
    styleIds: definition.styleIds ? [...definition.styleIds] : undefined,
    styles: definition.styles ? [...definition.styles] : undefined,
    svgRenderingEnabled: definition.svgRenderingEnabled ?? false,
    derivedRelationships: definition.derivedRelationships
      ? [...definition.derivedRelationships]
      : undefined,
  };
}

export function mergeDerivedProjectedReferences(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  overrides?: ReturnType<typeof getReferenceImageOperationOverrides>,
): ProjectedSketchReferenceRecord[] {
  const derivedReferences = buildReferenceImageAnchorProjectedReferences(
    definition,
    overrides,
  );
  const derivedReferenceIds = new Set(
    derivedReferences.map((reference) => reference.referenceId),
  );
  return [
    ...projectedReferences.filter(
      (reference) => !derivedReferenceIds.has(reference.referenceId),
    ),
    ...derivedReferences,
  ];
}

/**
 * τ, the session's offset plan hints ([TECH] G3/G12/G17) and (T17p3) the
 * document variables offset distances resolve against, for every session
 * evaluation.
 */
export function getSketchSessionDerivationSettings(
  session: Pick<
    SketchSessionState,
    "modelingTolerance" | "offsetPlans" | "documentVariables"
  >,
): AuthoredSketchDerivationSettings {
  return {
    modelingTolerance: session.modelingTolerance,
    ...(session.offsetPlans ? { offsetPlans: session.offsetPlans } : {}),
    documentVariables: session.documentVariables,
  };
}

export function getSketchSessionDisplayDefinition(session: SketchSessionState) {
  const sketchId = session.sketchId ?? ("sketch_draft" as SketchId);
  const evaluatedDefinition = evaluateAuthoredSketchDerivations({
    definition: session.definition,
    ...getSketchSessionDerivationSettings(session),
  }).definition;
  return mergeReferenceImageAnchorReferences(
    evaluatedDefinition,
    sketchId,
    getReferenceImageOperationOverrides(session),
  );
}

export function getSketchSessionDisplayProjectedReferences(
  session: SketchSessionState,
  definition: SketchDefinition,
) {
  return mergeDerivedProjectedReferences(
    definition,
    session.projectedReferences,
    getReferenceImageOperationOverrides(session),
  );
}
