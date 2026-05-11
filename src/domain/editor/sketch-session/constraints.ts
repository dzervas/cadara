import type { SketchPoint } from "@/contracts/modeling/schema";
import type { DimensionId } from "@/contracts/shared/ids";
import type {
  SketchDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import type {
  SketchConstraintTargetRecord,
  SketchConstraintToolId,
} from "@/core/sketch-constraints/definition";
import {
  getSketchConstraintDefinition,
  inferDimensionAnnotationPlacement,
  resolveSketchConstraintTarget,
} from "@/core/sketch-constraints/registry";
import type {
  SketchToolAnchorDescriptor,
  SketchToolFloatingInputDescriptor,
  SketchToolOverlayDescriptor,
  SketchToolPresentationSchema,
  SketchToolSelectionGuideDescriptor,
} from "@/core/sketch-tools/editor-schema";
import type {
  SketchConstraintAuthoringState,
  SketchSessionState,
} from "./types";
import {
  SKETCH_DIRECT_EDIT_TOLERANCES,
  applySketchHistoryContribution,
  createAuthoringOperationFromContribution,
  createConstraintId,
  createDimensionId,
  createSketchDimensionRef,
  deriveSolvedRegionsForSession,
  filterSketchDefinitionThroughCursor,
  getSessionSketchId,
  getTargetKey,
  normalizeConstraintValue,
  rebuildSessionCommitRequest,
} from "./internals";
import {
  patchSketchAnnotationEditValue,
  updateDimensionAnnotationPlacementInDefinition,
} from "./annotations";
import {
  applyPointPositionsToDefinition,
  addAnchorOffset,
} from "./definition-patches";

export function buildConstraintSelectionGuide(
  toolId: SketchConstraintToolId,
  selectedTargets: readonly SketchConstraintTargetRecord[],
  hoverTarget: SketchConstraintTargetRecord | null,
): SketchToolSelectionGuideDescriptor {
  const definition = getSketchConstraintDefinition(toolId);
  const step =
    definition.steps[
      Math.min(selectedTargets.length, definition.steps.length - 1)
    ];

  return {
    id: `${toolId}-selection-guide`,
    label: step?.label ?? definition.metadata.name,
    acceptedKinds: step?.acceptedKinds ?? ["annotation"],
    selectedCount: selectedTargets.length,
    requiredCount: definition.steps.length,
    hoverLabel: hoverTarget?.label ?? null,
  };
}

export function buildConstraintToolPresentation(
  authoring: SketchConstraintAuthoringState,
  validationMessage: string | null = null,
): SketchToolPresentationSchema {
  const definition = getSketchConstraintDefinition(authoring.toolId);
  const valueSpec =
    definition.getValueSpec?.(authoring.selectedTargets) ??
    definition.valueSpec;
  const selectionGuide = buildConstraintSelectionGuide(
    authoring.toolId,
    authoring.selectedTargets,
    authoring.hoverTarget,
  );
  const overlays = definition.buildPreview({
    selectedTargets: authoring.selectedTargets,
    hoverTarget: authoring.hoverTarget,
    pointer: authoring.pointer,
    value: authoring.pendingValue,
    annotationPlacement: authoring.pendingAnnotationPlacement,
  });
  const needsValue =
    Boolean(valueSpec) &&
    isSketchConstraintReadyForValue(definition, authoring.selectedTargets);
  const promptText = needsValue
    ? authoring.isPreviewPinned
      ? `Enter ${valueSpec?.label.toLowerCase() ?? "value"}`
      : `Place ${valueSpec?.label.toLowerCase() ?? "value"} annotation`
    : selectionGuide.label;

  const floatingInput: SketchToolFloatingInputDescriptor | null =
    needsValue && valueSpec && authoring.isPreviewPinned
      ? {
          id: `${authoring.toolId}-value-input`,
          label: valueSpec.label,
          value: authoring.pendingValue,
          unit: valueSpec.unit,
          min: valueSpec.min,
          confirmLabel: "Commit",
          cancelLabel: "Cancel",
          anchor: getConstraintFloatingInputAnchor(authoring, overlays),
          placement: "previewReference",
          submitAction: {
            type: "patch",
            patch: { intent: "commitConstraintValue" },
          },
          cancelAction: {
            type: "patch",
            patch: { intent: "cancelConstraintValue" },
          },
        }
      : null;

  return {
    prompts: [
      {
        id: `${authoring.toolId}-prompt`,
        text: promptText,
      },
    ],
    steps: definition.steps.map((step) => ({
      id: step.id,
      label: step.label,
    })),
    cursor: {
      id: `${authoring.toolId}-cursor`,
      label: definition.metadata.name,
      icon:
        definition.metadata.group === "dimensions" ? "dimension" : "constraint",
    },
    selectionGuide,
    overlays,
    floatingInput,
    validation: validationMessage
      ? [
          {
            id: `${authoring.toolId}-validation`,
            message: validationMessage,
            severity: "warning",
          },
        ]
      : [],
    completionHints: [
      {
        id: `${authoring.toolId}-completion`,
        text:
          needsValue && authoring.isPreviewPinned
            ? "Confirm the entered value to commit the annotation"
            : needsValue
              ? "Click to place the annotation"
              : `Select ${definition.steps.length} target${definition.steps.length === 1 ? "" : "s"}`,
        ready:
          needsValue && authoring.isPreviewPinned
            ? authoring.pendingValue !== null
            : false,
      },
    ],
  };
}

export function isSketchConstraintReadyForValue(
  definition: ReturnType<typeof getSketchConstraintDefinition>,
  selectedTargets: readonly SketchConstraintTargetRecord[],
) {
  return (
    definition.isReadyForValue?.(selectedTargets) ??
    selectedTargets.length >= definition.steps.length
  );
}

export function canSketchConstraintSelectMoreTargets(
  definition: ReturnType<typeof getSketchConstraintDefinition>,
  selectedTargets: readonly SketchConstraintTargetRecord[],
) {
  return (
    definition.canSelectMoreTargets?.(selectedTargets) ??
    selectedTargets.length < definition.steps.length
  );
}

export function shouldPinSketchConstraintPreviewBeforeSelection(
  session: SketchSessionState,
) {
  const authoring = session.constraintAuthoring;
  if (
    !authoring ||
    session.status !== "awaitingValue" ||
    authoring.isPreviewPinned
  ) {
    return false;
  }

  const definition = getSketchConstraintDefinition(authoring.toolId);
  return (
    isSketchConstraintReadyForValue(definition, authoring.selectedTargets) &&
    !canSketchConstraintSelectMoreTargets(definition, authoring.selectedTargets)
  );
}

export function shouldDeferSketchConstraintPreviewPinToSelection(
  session: SketchSessionState,
  target: PrimitiveRef | null | undefined,
) {
  const authoring = session.constraintAuthoring;

  if (
    !authoring ||
    !target ||
    session.status !== "awaitingValue" ||
    authoring.isPreviewPinned
  ) {
    return false;
  }

  const definition = getSketchConstraintDefinition(authoring.toolId);

  if (
    !canSketchConstraintSelectMoreTargets(definition, authoring.selectedTargets)
  ) {
    return false;
  }

  const resolved = resolveSketchConstraintTarget(
    authoring.toolId,
    session.definition,
    target,
    session.projectedReferences,
  );

  if (!resolved) {
    return false;
  }

  return !authoring.selectedTargets.some(
    (entry) => getTargetKey(entry.target) === getTargetKey(resolved.target),
  );
}

export function getConstraintFloatingInputAnchor(
  authoring: SketchConstraintAuthoringState,
  overlays: readonly SketchToolOverlayDescriptor[],
): SketchToolAnchorDescriptor | undefined {
  const previewAnchor = overlays.find(
    (overlay) =>
      overlay.kind === "dimensionLine" || overlay.kind === "angleArc",
  );

  if (
    previewAnchor?.kind === "dimensionLine" ||
    previewAnchor?.kind === "angleArc"
  ) {
    return addAnchorOffset(previewAnchor.labelAnchor, { x: 18, y: -12 });
  }

  if (authoring.pointer) {
    return {
      kind: "cursor",
      point: authoring.pointer,
      offset: { x: 18, y: -18 },
    };
  }

  const lastTarget =
    authoring.selectedTargets[authoring.selectedTargets.length - 1];

  return lastTarget
    ? {
        kind: "sketchPoint",
        point: lastTarget.anchor,
        offset: { x: 18, y: -18 },
      }
    : undefined;
}

export function activateSketchConstraintTool(
  session: SketchSessionState,
  toolId: SketchConstraintToolId,
): SketchSessionState {
  const definition = getSketchConstraintDefinition(toolId);
  const authoring: SketchConstraintAuthoringState = {
    toolId,
    selectedTargets: [],
    hoverTarget: null,
    pointer: null,
    isPreviewPinned: false,
    pendingValue: definition.valueSpec?.defaultValue ?? null,
    pendingAnnotationPlacement: null,
  };

  return {
    ...session,
    activeTool: toolId,
    status: "collectingTargets",
    constructionTargetPicking: false,
    referenceTargetPicking: false,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolPlacedPoints: [],
    toolSettings: {},
    toolStagedEntities: [],
    validationMessage: null,
    toolPresentation: buildConstraintToolPresentation(authoring),
    constraintAuthoring: authoring,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTool: null,
    activeEditTarget: null,
    activeStyleFocus: null,
    activeDrag: null,
    activeSnap: null,
    drawStartSnap: null,
  };
}

export function updateSketchConstraintHover(
  session: SketchSessionState,
  target: PrimitiveRef | null,
): SketchSessionState {
  const authoring = session.constraintAuthoring;

  if (!authoring) {
    return session;
  }

  const hoverTarget =
    target === null
      ? null
      : resolveSketchConstraintTarget(
          authoring.toolId,
          session.definition,
          target,
          session.projectedReferences,
        );

  return {
    ...session,
    toolPresentation: buildConstraintToolPresentation({
      ...authoring,
      hoverTarget,
    }),
    constraintAuthoring: {
      ...authoring,
      hoverTarget,
    },
  };
}

export function selectSketchConstraintTarget(
  session: SketchSessionState,
  target: PrimitiveRef,
): SketchSessionState {
  const authoring = session.constraintAuthoring;

  if (!authoring) {
    return session;
  }

  const definition = getSketchConstraintDefinition(authoring.toolId);

  if (
    authoring.isPreviewPinned ||
    (Boolean(definition.valueSpec) &&
      isSketchConstraintReadyForValue(definition, authoring.selectedTargets) &&
      !canSketchConstraintSelectMoreTargets(
        definition,
        authoring.selectedTargets,
      ))
  ) {
    return session;
  }

  const resolved = resolveSketchConstraintTarget(
    authoring.toolId,
    session.definition,
    target,
    session.projectedReferences,
  );

  if (!resolved) {
    const validationMessage = `${definition.metadata.name} needs the supported target combination.`;

    return {
      ...session,
      validationMessage,
      toolPresentation: buildConstraintToolPresentation(
        authoring,
        validationMessage,
      ),
    };
  }

  if (
    authoring.selectedTargets.some(
      (entry) => getTargetKey(entry.target) === getTargetKey(resolved.target),
    )
  ) {
    return session;
  }

  const nextTargets = [...authoring.selectedTargets, resolved].slice(
    0,
    definition.steps.length,
  );
  const readyForValue =
    Boolean(definition.valueSpec) &&
    isSketchConstraintReadyForValue(definition, nextTargets);
  const pendingAnnotationPlacement = readyForValue
    ? inferDimensionAnnotationPlacement(nextTargets, authoring.pointer)
    : null;
  const nextSession: SketchSessionState = {
    ...session,
    status: readyForValue ? "awaitingValue" : "collectingTargets",
    validationMessage: null,
    toolPresentation: buildConstraintToolPresentation({
      ...authoring,
      selectedTargets: nextTargets,
      hoverTarget: null,
      isPreviewPinned: false,
      pendingAnnotationPlacement,
    }),
    constraintAuthoring: {
      ...authoring,
      selectedTargets: nextTargets,
      hoverTarget: null,
      isPreviewPinned: false,
      pendingAnnotationPlacement,
    },
    activeAnnotationEdit: null,
    selectedAnnotation: null,
  };

  if (!definition.valueSpec && nextTargets.length >= definition.steps.length) {
    return commitSketchConstraintAuthoring(nextSession);
  }

  return nextSession;
}

export function pinSketchConstraintPreview(
  session: SketchSessionState,
  point: SketchPoint | null,
): SketchSessionState {
  const authoring = session.constraintAuthoring;

  if (
    !authoring ||
    session.status !== "awaitingValue" ||
    authoring.isPreviewPinned
  ) {
    return session;
  }

  const nextAuthoring: SketchConstraintAuthoringState = {
    ...authoring,
    pointer: point ?? authoring.pointer,
    isPreviewPinned: true,
    pendingAnnotationPlacement: inferDimensionAnnotationPlacement(
      authoring.selectedTargets,
      point ?? authoring.pointer,
    ),
  };

  return {
    ...session,
    toolPresentation: buildConstraintToolPresentation(nextAuthoring),
    constraintAuthoring: nextAuthoring,
  };
}

export function patchSketchConstraintValue(
  session: SketchSessionState,
  patch: Record<string, unknown>,
): SketchSessionState {
  const authoring = session.constraintAuthoring;

  if (session.activeAnnotationEdit) {
    return patchSketchAnnotationEditValue(session, patch);
  }

  if (!authoring) {
    return session;
  }

  const intent = patch.intent;

  if (intent === "cancelConstraintValue") {
    return activateSketchConstraintTool(session, authoring.toolId);
  }

  if (intent === "setConstraintAnnotationPlacement") {
    const definition = getSketchConstraintDefinition(authoring.toolId);
    const readyForValue = isSketchConstraintReadyForValue(
      definition,
      authoring.selectedTargets,
    );
    const point =
      Array.isArray(patch.point) &&
      typeof patch.point[0] === "number" &&
      typeof patch.point[1] === "number"
        ? ([patch.point[0], patch.point[1]] as SketchPoint)
        : authoring.pointer;
    const nextAuthoring = {
      ...authoring,
      pointer: point,
      isPreviewPinned: readyForValue ? true : authoring.isPreviewPinned,
      pendingAnnotationPlacement: inferDimensionAnnotationPlacement(
        authoring.selectedTargets,
        point,
      ),
    };

    return {
      ...session,
      toolPresentation: buildConstraintToolPresentation(nextAuthoring),
      constraintAuthoring: nextAuthoring,
    };
  }

  if ("value" in patch) {
    const nextAuthoring = {
      ...authoring,
      pendingValue: normalizeConstraintValue(
        patch.value as number | null | undefined,
      ),
    };

    return {
      ...session,
      toolPresentation: buildConstraintToolPresentation(nextAuthoring),
      constraintAuthoring: nextAuthoring,
    };
  }

  if (intent !== "commitConstraintValue") {
    return session;
  }

  return commitSketchConstraintAuthoring(session);
}

export function patchSketchDimensionAnnotationPlacement(
  session: SketchSessionState,
  patch: Record<string, unknown>,
): SketchSessionState {
  if (
    patch.intent !== "setDimensionAnnotationPlacement" ||
    typeof patch.dimensionId !== "string"
  ) {
    return session;
  }

  const point =
    Array.isArray(patch.point) &&
    typeof patch.point[0] === "number" &&
    typeof patch.point[1] === "number"
      ? ([patch.point[0], patch.point[1]] as SketchPoint)
      : null;

  if (!point) {
    return session;
  }

  const dimensionId = patch.dimensionId as DimensionId;
  const target = createSketchDimensionRef(
    getSessionSketchId(session),
    dimensionId,
  );
  const nextFullDefinition = updateDimensionAnnotationPlacementInDefinition(
    session,
    session.fullDefinition,
    target,
    point,
  );

  if (nextFullDefinition === session.fullDefinition) {
    return session;
  }

  const nextDefinition = filterSketchDefinitionThroughCursor(
    nextFullDefinition,
    session.historyCursor,
  );

  return {
    ...session,
    fullDefinition: nextFullDefinition,
    definition: nextDefinition,
    toolPresentation: null,
    commitRequest: rebuildSessionCommitRequest(session, nextDefinition),
    solvedRegions: deriveSolvedRegionsForSession(session, nextDefinition),
  };
}

export function solveCommittedConstraintDefinition(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
): { definition: SketchDefinition; solvedSnapshot?: SolvedSketchSnapshot } {
  const solved = solveSketchDefinitionCore({
    definition,
    projectedReferences,
    tolerances: SKETCH_DIRECT_EDIT_TOLERANCES,
    partialSolvePolicy: "bestEffort",
  });
  const constraintsSatisfied = solved.solvedSnapshot.constraintStatuses.every(
    (status) => status.status === "satisfied",
  );

  if (solved.status.solveState !== "solved" || !constraintsSatisfied) {
    return { definition };
  }

  return {
    definition: applyPointPositionsToDefinition(
      definition,
      solved.solvedSnapshot.solvedPoints.map((point) => ({
        pointId: point.pointId,
        position: point.solvedPosition,
      })),
    ),
    solvedSnapshot: solved.solvedSnapshot,
  };
}

export function commitSketchConstraintAuthoring(
  session: SketchSessionState,
): SketchSessionState {
  const authoring = session.constraintAuthoring;

  if (!authoring) {
    return session;
  }

  const definition = getSketchConstraintDefinition(authoring.toolId);
  const contribution = definition.createCommitContribution({
    sequence: session.sequence + 1,
    selectedTargets: authoring.selectedTargets,
    pointer: authoring.pointer,
    value: authoring.pendingValue,
    annotationPlacement: authoring.pendingAnnotationPlacement,
    createConstraintId: (suffix) =>
      createConstraintId(session.sequence + 1, suffix),
    createDimensionId: (suffix) =>
      createDimensionId(session.sequence + 1, suffix),
  });
  if (
    (contribution.constraints?.length ?? 0) === 0 &&
    (contribution.dimensions?.length ?? 0) === 0
  ) {
    const validationMessage = `${definition.metadata.name} needs the supported target combination.`;

    return {
      ...session,
      validationMessage,
      toolPresentation: buildConstraintToolPresentation(
        authoring,
        validationMessage,
      ),
    };
  }

  const history = applySketchHistoryContribution(session, {
    points: [],
    entities: [],
    ...contribution,
    authoringOperation: createAuthoringOperationFromContribution(
      {
        points: [],
        entities: [],
        ...contribution,
      },
      {
        sequence: session.sequence + 1,
        kind:
          (contribution.dimensions?.length ?? 0) > 0
            ? "dimension"
            : "constraint",
        label: `${definition.metadata.name} ${session.sequence + 1}`,
        suffix: authoring.toolId,
      },
    ),
  });
  const solvedDefinition = solveCommittedConstraintDefinition(
    history.definition,
    session.projectedReferences,
  );
  const solvedFullDefinition = solveCommittedConstraintDefinition(
    history.fullDefinition,
    session.projectedReferences,
  );

  return {
    ...session,
    toolStagedEntities: [],
    definition: solvedDefinition.definition,
    fullDefinition: solvedFullDefinition.definition,
    historyCursor: history.historyCursor,
    historyOperations: history.historyOperations,
    sequence: session.sequence + 1,
    status: "idle",
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    commitRequest: rebuildSessionCommitRequest(
      session,
      solvedDefinition.definition,
    ),
    solvedRegions: deriveSolvedRegionsForSession(
      session,
      solvedDefinition.definition,
      solvedDefinition.solvedSnapshot,
    ),
    selectedAnnotation: null,
    toolPresentation: null,
    activeTool: null,
    activeEditTarget: null,
    activeDrag: null,
  };
}
