import type { SketchDerivationSettings } from "@/contracts/sketch/derived-geometry";
import {
  isAcceptedConstraintStatus,
  isReferenceDimension,
} from "@/contracts/sketch/schema";
import type { MirrorDimensionCorrespondence } from "@/contracts/sketch/mirror-requirements";
import type {
  DocumentVariableRecord,
  SketchPoint,
} from "@/contracts/modeling/schema";
import {
  createLiteralAuthoredValue,
  getAuthoredFormText,
  getAuthoredLiteralValue,
  type MaybeAuthoredValue,
} from "@/contracts/modeling/authored-values";
import type { DimensionId } from "@/contracts/shared/ids";
import type {
  DimensionDefinition,
  SketchDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import {
  probeSketchDimensionRedundancy,
  solveSketchDefinitionCore,
} from "@/contracts/sketch/solver-core";
import type {
  ProjectedSketchReferenceRecord,
  SolverTolerancePolicy,
} from "@/contracts/solver/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import type { SketchConstraintRef } from "@/contracts/shared/references";
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
  SketchSharedDimensionEdit,
} from "./types";
import {
  applySketchContribution,
  getSketchSessionInvalidFeedback,
  hasAcceptedLiveSolveOfDefinition,
  createConstraintId,
  createDimensionId,
  createSketchConstraintRef,
  createSketchDimensionRef,
  withLiveSolveBasis,
  resolveSketchDefinitionForSolve,
  getSessionSketchId,
  getTargetKey,
  normalizeConstraintValue,
  rebuildSessionCommitRequest,
  getSketchSessionDerivationSettings,
  describeSharedMirrorPath,
  getSketchSessionSharedMirrorDimensions,
  sharedMirrorDriverRefusal,
} from "./internals";
import {
  beginSketchAnnotationEdit,
  patchSketchAnnotationEditValue,
  updateDimensionAnnotationPlacementInDefinition,
} from "./annotations";
import {
  applySolvedSketchToDefinition,
  addAnchorOffset,
} from "./definition-patches";
import { getConstraintDedupeKey } from "./tools";

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
  const needsValue =
    Boolean(valueSpec) &&
    isSketchConstraintReadyForValue(definition, authoring.selectedTargets);
  // T13c (D5): until the annotation is pinned (and the value input opens),
  // the preview reads the measured quantity at the current pointer.
  const overlays = definition.buildPreview({
    selectedTargets: authoring.selectedTargets,
    hoverTarget: authoring.hoverTarget,
    pointer: authoring.pointer,
    value:
      needsValue && !authoring.isPreviewPinned
        ? (definition.measureValue?.(
            authoring.selectedTargets,
            authoring.pointer,
          ) ?? null)
        : getAuthoredLiteralValue(authoring.pendingValue),
    annotationPlacement: authoring.pendingAnnotationPlacement,
  });
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
          value:
            authoring.pendingValue === null
              ? null
              : getAuthoredFormText(
                  authoring.pendingValue,
                  formatMeasuredValueText,
                ),
          unit: valueSpec.unit,
          min: valueSpec.min,
          ...getConstraintValueModePresentation(authoring),
          confirmLabel: authoring.authorsReference ? "Add reference" : "Commit",
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
  const authoring: SketchConstraintAuthoringState = {
    toolId,
    selectedTargets: [],
    hoverTarget: null,
    pointer: null,
    isPreviewPinned: false,
    pendingValue: null,
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
    activeEditTool: null,
    activeEditTarget: null,
    activeStyleFocus: null,
    activeDrag: null,
    activeInference: null,
    toolPlacements: [],
    toolStartPointId: null,
    toolTangentSourceEntityId: null,
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
  return authorSketchConstraintTarget(session, target).session;
}

/**
 * A constraint tool's pick (`selectSketchConstraintTarget`), with the existing
 * constraints a refused duplicate commit matched (T14c A2/T-14: the editor
 * selects the first one); empty unless the pick was refused as a duplicate.
 */
export function authorSketchConstraintTarget(
  session: SketchSessionState,
  target: PrimitiveRef,
): ConstraintCommitResult {
  const authoring = session.constraintAuthoring;

  if (!authoring) {
    return { session, duplicates: [] };
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
    return { session, duplicates: [] };
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
      session: {
        ...session,
        validationMessage,
        toolPresentation: buildConstraintToolPresentation(
          authoring,
          validationMessage,
        ),
      },
      duplicates: [],
    };
  }

  if (
    authoring.selectedTargets.some(
      (entry) => getTargetKey(entry.target) === getTargetKey(resolved.target),
    )
  ) {
    return { session, duplicates: [] };
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
  };

  if (!definition.valueSpec && nextTargets.length >= definition.steps.length) {
    return commitConstraintAuthoring(nextSession);
  }

  return { session: nextSession, duplicates: [] };
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
    pendingValue: measureSketchConstraintValue(
      session,
      authoring,
      point ?? authoring.pointer,
    ),
    pendingAnnotationPlacement: inferDimensionAnnotationPlacement(
      authoring.selectedTargets,
      point ?? authoring.pointer,
    ),
  };

  return openConstraintValueInput(session, nextAuthoring);
}

/**
 * The value input opens for placed picks. T16f ([TECH] T16-12, review
 * A-9): when they correspond, through a healthy mirror, to an existing
 * driving dimension, that driver's edit opens instead (before the T13e
 * redundancy probe, so no second driver can be authored); otherwise the
 * probe decides Reference vs driving (T13e).
 */
function openConstraintValueInput(
  session: SketchSessionState,
  placed: SketchConstraintAuthoringState,
): SketchSessionState {
  const candidate = createConstraintCommitContribution(session, placed)
    .dimensions?.[0];
  const driver = candidate
    ? getSketchSessionSharedMirrorDimensions(session, candidate)[0]
    : undefined;
  if (driver) {
    return openSharedMirrorDriverEdit(session, placed, driver);
  }
  const probed = withConstraintRedundancy(session, placed);

  return {
    ...session,
    toolPresentation: buildConstraintToolPresentation(probed),
    constraintAuthoring: probed,
  };
}

/**
 * T16f: the corresponding driver's annotation edit, prefilled with its
 * value and shown in its own kind, explaining what it shares; the tool's
 * picks are kept for "Add as reference instead" and the re-armed tool.
 */
function openSharedMirrorDriverEdit(
  session: SketchSessionState,
  authoring: SketchConstraintAuthoringState,
  driver: MirrorDimensionCorrespondence,
  message?: string,
): SketchSessionState {
  const definition = getSketchConstraintDefinition(authoring.toolId);
  return beginSketchAnnotationEdit(
    session,
    createSketchDimensionRef(
      getSessionSketchId(session),
      driver.dimension.dimensionId,
    ),
    {
      shared: {
        readout: `Shared with ${driver.dimension.label} through ${describeSharedMirrorPath(driver.mirrors)}`,
        authoring: { ...authoring, authorsReference: true },
        // Review R-2: only a value tool (a Dimension tool) can author its
        // picks as a reference measurement instead.
        referenceLabel:
          (
            definition.getValueSpec?.(authoring.selectedTargets) ??
            definition.valueSpec
          )?.label ?? null,
        addsReference: false,
      },
      ...(message ? { message } : {}),
    },
  );
}

/**
 * T16f (issue 04): a routed Dimension tool stays armed once its edit ends
 * (committed, or cancelled with no action), keeping any explanation.
 */
export function rearmSharedDimensionTool(
  session: SketchSessionState,
  shared: SketchSharedDimensionEdit,
): SketchSessionState {
  return {
    ...activateSketchConstraintTool(session, shared.authoring.toolId),
    validationMessage: session.validationMessage,
  };
}

export function patchSketchConstraintValue(
  session: SketchSessionState,
  patch: Record<string, unknown>,
): SketchSessionState {
  const authoring = session.constraintAuthoring;

  if (session.activeAnnotationEdit) {
    const shared = session.activeAnnotationEdit.shared;
    if (!shared) {
      return patchSketchAnnotationEditValue(session, patch);
    }
    // T16f: "Add as reference instead" commits the tool's picks as a
    // reference (non-driving, so allowed); any other end of the routed edit
    // re-arms the tool.
    const next =
      shared.addsReference && patch.intent === "commitConstraintValue"
        ? commitSketchConstraintAuthoring({
            ...session,
            activeAnnotationEdit: null,
            constraintAuthoring: shared.authoring,
          })
        : patchSketchAnnotationEditValue(session, patch);
    return next.activeAnnotationEdit ||
      (next.constraintAuthoring && next.activeTool)
      ? next
      : rearmSharedDimensionTool(next, shared);
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
    const pins = readyForValue && !authoring.isPreviewPinned;
    const placed = {
      ...authoring,
      pointer: point,
      isPreviewPinned: readyForValue ? true : authoring.isPreviewPinned,
      // T13c (D5): the value input opens prefilled with the measured value.
      pendingValue: pins
        ? measureSketchConstraintValue(session, authoring, point)
        : authoring.pendingValue,
      pendingAnnotationPlacement: inferDimensionAnnotationPlacement(
        authoring.selectedTargets,
        point,
      ),
    };
    if (pins) {
      return openConstraintValueInput(session, placed);
    }

    return {
      ...session,
      toolPresentation: buildConstraintToolPresentation(placed),
      constraintAuthoring: placed,
    };
  }

  if (intent === "setConstraintValueMode") {
    if (authoring.redundancy !== "determined") {
      return session;
    }
    // T13e (D11): leaving Reference mode keeps the measured value for the
    // user to change (a different value is a retained conflict); returning
    // to it restores the measured value.
    const authorsReference = patch.reference === true;
    const nextAuthoring = {
      ...authoring,
      authorsReference,
      pendingValue: authorsReference
        ? measureSketchConstraintValue(session, authoring, authoring.pointer)
        : authoring.pendingValue,
    };

    return {
      ...session,
      toolPresentation: buildConstraintToolPresentation(nextAuthoring),
      constraintAuthoring: nextAuthoring,
    };
  }

  if ("value" in patch) {
    if (authoring.authorsReference) {
      // Reference mode: the measured value is read-only.
      return session;
    }
    const nextAuthoring = {
      ...authoring,
      pendingValue: normalizeConstraintValue(patch.value),
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
    session.definition,
    target,
    point,
  );

  if (nextFullDefinition === session.definition) {
    return session;
  }

  const nextDefinition = nextFullDefinition;

  // A label placement never affects the solve or region records (T09b review
  // A6(a)), so the live solve basis and the published live regions are kept.
  // T17f (D3, T17b0 P-6): a solve of the current definition is re-based onto
  // the new one without re-solving, so Trim/Split/Extend, intersection snaps
  // and near-gap warnings keep reading it as the solve of this definition.
  const liveSolve =
    session.liveSolve?.sourceDefinition === session.definition
      ? { ...session.liveSolve, sourceDefinition: nextDefinition }
      : session.liveSolve;
  return {
    ...session,
    liveSolve,
    definition: nextDefinition,
    toolPresentation: null,
    commitRequest: rebuildSessionCommitRequest(session, nextDefinition),
  };
}

export function solveCommittedConstraintDefinition(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  tolerances: SolverTolerancePolicy,
  documentVariables: readonly DocumentVariableRecord[],
  derivation: SketchDerivationSettings,
): { definition: SketchDefinition; solvedSnapshot?: SolvedSketchSnapshot } {
  const solved = solveSketchDefinitionCore({
    definition: resolveSketchDefinitionForSolve(definition, documentVariables),
    projectedReferences,
    tolerances,
    ...derivation,
    partialSolvePolicy: "bestEffort",
  });
  const constraintsSatisfied = solved.solvedSnapshot.constraintStatuses.every(
    (status) => isAcceptedConstraintStatus(status.status),
  );

  if (solved.status.solveState !== "solved" || !constraintsSatisfied) {
    return { definition };
  }

  return {
    definition: applySolvedSketchToDefinition(
      definition,
      solved.solvedSnapshot,
      derivation,
    ),
    solvedSnapshot: solved.solvedSnapshot,
  };
}

export function commitSketchConstraintAuthoring(
  session: SketchSessionState,
): SketchSessionState {
  return commitConstraintAuthoring(session).session;
}

export interface ConstraintCommitResult {
  session: SketchSessionState;
  duplicates: readonly SketchConstraintRef[];
}

function commitConstraintAuthoring(
  session: SketchSessionState,
): ConstraintCommitResult {
  const authoring = session.constraintAuthoring;

  if (!authoring) {
    return { session, duplicates: [] };
  }

  const definition = getSketchConstraintDefinition(authoring.toolId);
  const contribution = createConstraintCommitContribution(session, authoring);
  // T13c (D8): a constraint identical to an existing one (same dedupe key)
  // is a no-op; it is not authored again.
  const existingByKey = new Map(
    session.definition.constraints.map((constraint) => [
      getConstraintDedupeKey(constraint),
      constraint,
    ]),
  );
  const constraints = (contribution.constraints ?? []).filter(
    (constraint) => !existingByKey.has(getConstraintDedupeKey(constraint)),
  );
  // T13e (D11): a commit in Reference mode authors a reference dimension.
  const dimensions = (contribution.dimensions ?? []).map((dimension) =>
    authoring.authorsReference ? toReferenceDimension(dimension) : dimension,
  );
  // T16f ([TECH] T16-12, review A-9): no commit authors a second driving
  // record of one mirrored quantity, whatever the entry point (the Dimension
  // tool routes before this; Fix on a copy circle authors a diameter here):
  // refused, and the driver's edit opens instead.
  for (const dimension of dimensions) {
    if (isReferenceDimension(dimension)) continue;
    const driver = getSketchSessionSharedMirrorDimensions(
      session,
      dimension,
    )[0];
    if (driver) {
      return {
        session: openSharedMirrorDriverEdit(
          session,
          authoring,
          driver,
          sharedMirrorDriverRefusal(driver),
        ),
        duplicates: [],
      };
    }
  }
  if (constraints.length === 0 && dimensions.length === 0) {
    const duplicates = (contribution.constraints ?? []).flatMap(
      (constraint) =>
        existingByKey.get(getConstraintDedupeKey(constraint)) ?? [],
    );
    const refusal =
      duplicates.length > 0
        ? `Already constrained: ${[...new Set(duplicates.map((constraint) => constraint.label))].join(", ")}`
        : (contribution.refusal ?? null);

    if (refusal) {
      // The tool restarts with nothing authored and says why.
      const restarted = activateSketchConstraintTool(session, authoring.toolId);
      const sketchId = getSessionSketchId(session);
      return {
        session: {
          ...restarted,
          validationMessage: refusal,
          toolPresentation: buildConstraintToolPresentation(
            restarted.constraintAuthoring!,
            refusal,
          ),
        },
        duplicates: [
          ...new Set(duplicates.map((constraint) => constraint.constraintId)),
        ].map((constraintId) =>
          createSketchConstraintRef(sketchId, constraintId),
        ),
      };
    }

    const validationMessage = `${definition.metadata.name} needs the supported target combination.`;

    return {
      session: {
        ...session,
        validationMessage,
        toolPresentation: buildConstraintToolPresentation(
          authoring,
          validationMessage,
        ),
      },
      duplicates: [],
    };
  }

  const history = applySketchContribution(session, {
    points: [],
    entities: [],
    constraints,
    dimensions,
  });
  const solvedDefinition = solveCommittedConstraintDefinition(
    history.definition,
    session.projectedReferences,
    session.solverTolerances,
    session.documentVariables,
    getSketchSessionDerivationSettings(session),
  );

  const committed = withLiveSolveBasis(
    {
      ...session,
      toolStagedEntities: [],
      definition: solvedDefinition.definition,
      sequence: session.sequence + 1,
      status: "idle",
      constraintAuthoring: null,
      activeAnnotationEdit: null,
      commitRequest: rebuildSessionCommitRequest(
        session,
        solvedDefinition.definition,
      ),
      toolPresentation: null,
      activeTool: null,
      activeEditTarget: null,
      activeDrag: null,
    },
    solvedDefinition.definition,
    solvedDefinition.solvedSnapshot,
  );

  // T13c (D7): a commit that leaves requirements unsatisfied is retained and
  // explained (the new requirement named first); otherwise no message.
  return {
    session: {
      ...committed,
      // T15b (O-1): explained whenever profiles are unavailable (as after Undo/Redo).
      validationMessage:
        committed.liveRegions.status !== "unavailable"
          ? null
          : getSketchSessionInvalidFeedback(
              committed,
              [
                ...constraints.map((constraint) => constraint.constraintId),
                ...dimensions.map((dimension) => dimension.dimensionId),
              ],
              // T13e2 (review R-1): the commit caused the invalidity only if
              // the sketch was accepted before it.
              hasAcceptedLiveSolveOfDefinition(session),
            ),
    },
    duplicates: [],
  };
}

/**
 * T13c (D5): the measured quantity of the authoring targets, read from the
 * live solve's positions when it is current (accepted, or the best-effort
 * solve the viewport displays), else from the authored definition.
 */
function measureSketchConstraintValue(
  session: SketchSessionState,
  authoring: SketchConstraintAuthoringState,
  pointer: SketchPoint | null,
): MaybeAuthoredValue<number> | null {
  const definition = getSketchConstraintDefinition(authoring.toolId);
  if (!definition.measureValue) {
    return authoring.pendingValue;
  }
  const liveSolve = session.liveSolve;
  const basis =
    liveSolve && liveSolve.sourceDefinition === session.definition
      ? applySolvedSketchToDefinition(
          session.definition,
          liveSolve.solvedSnapshot,
          getSketchSessionDerivationSettings(session),
        )
      : session.definition;
  const targets = authoring.selectedTargets.map(
    (entry) =>
      resolveSketchConstraintTarget(
        authoring.toolId,
        basis,
        entry.target,
        session.projectedReferences,
      ) ?? entry,
  );
  const measured = definition.measureValue(targets, pointer);
  return measured === null || !Number.isFinite(measured)
    ? null
    : createLiteralAuthoredValue(measured);
}

function createConstraintCommitContribution(
  session: SketchSessionState,
  authoring: SketchConstraintAuthoringState,
) {
  return getSketchConstraintDefinition(
    authoring.toolId,
  ).createCommitContribution({
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
}

/** T13d (D9): a reference dimension carries the marker and no value. */
function toReferenceDimension(
  dimension: SketchDefinition["dimensions"][number],
): SketchDefinition["dimensions"][number] {
  if (
    dimension.kind === "arcStartPointCoincident" ||
    dimension.kind === "arcEndPointCoincident"
  ) {
    return dimension;
  }
  const reference = { ...dimension, reference: true as const };
  delete (reference as { value?: unknown }).value;
  delete (reference as { valueRadians?: unknown }).valueRadians;
  return reference;
}

/**
 * T13e (D11): the probe verdicts per definition identity, candidate,
 * document variables, tolerances and projected references, so reopening
 * the input on the same targets never re-runs the trial solves.
 */
const redundancyCache = new WeakMap<
  SketchDefinition,
  Map<string, "determined" | "independent">
>();

/**
 * T13e (D11): run the determined-quantity probe once, when the value input
 * opens (the candidate dimension, including the Distance tool's
 * pointer-chosen axis, is complete only then). A determined quantity opens in
 * Reference mode; an unaccepted live solve skips the probe.
 */
function withConstraintRedundancy(
  session: SketchSessionState,
  authoring: SketchConstraintAuthoringState,
): SketchConstraintAuthoringState {
  if (!session.liveSolve?.accepted) {
    return {
      ...authoring,
      redundancy: "invalidSketch",
      authorsReference: false,
    };
  }
  const candidate = createConstraintCommitContribution(session, authoring)
    .dimensions?.[0];
  if (
    !candidate ||
    candidate.kind === "arcStartPointCoincident" ||
    candidate.kind === "arcEndPointCoincident"
  ) {
    return authoring;
  }
  // The key is the candidate's structure (its kind and targets: the fresh
  // id, label, value and placement never change the verdict) plus the
  // probe's other inputs besides the definition (review A-1/A-1′): document
  // variables, tolerances and the projected references (a projection lands
  // asynchronously on the same definition).
  const structural: Record<string, unknown> = {
    ...toReferenceDimension(candidate),
  };
  delete structural.dimensionId;
  delete structural.label;
  delete structural.annotationPlacement;
  const key = JSON.stringify([
    structural,
    session.documentVariables,
    session.solverTolerances,
    session.modelingTolerance,
    session.projectedReferences,
  ]);
  const cached = redundancyCache.get(session.definition)?.get(key);
  const redundancy = cached ?? probeConstraintRedundancy(session, candidate);
  if (!cached) {
    const entries = redundancyCache.get(session.definition) ?? new Map();
    entries.set(key, redundancy);
    redundancyCache.set(session.definition, entries);
  }
  return {
    ...authoring,
    redundancy,
    authorsReference: redundancy === "determined",
  };
}

function probeConstraintRedundancy(
  session: SketchSessionState,
  candidate: DimensionDefinition,
): "determined" | "independent" {
  const settings = getSketchSessionDerivationSettings(session);
  const liveSolve = session.liveSolve!;
  const basis =
    liveSolve.sourceDefinition === session.definition
      ? applySolvedSketchToDefinition(
          session.definition,
          liveSolve.solvedSnapshot,
          settings,
        )
      : session.definition;
  const probe = probeSketchDimensionRedundancy({
    definition: resolveSketchDefinitionForSolve(
      basis,
      session.documentVariables,
    ),
    // The probe sets the candidate's trial values itself.
    candidate,
    projectedReferences: session.projectedReferences,
    tolerances: session.solverTolerances,
    ...settings,
  });
  return probe.kind === "determined" ? "determined" : "independent";
}

/**
 * T13e (D11): the value input's Reference-mode presentation: a determined
 * quantity shows the note and a visible "Make driving" switch, its measured
 * value read-only while in Reference mode; an invalid sketch says why the
 * check was skipped.
 */
export function getConstraintValueModePresentation(
  authoring: Pick<
    SketchConstraintAuthoringState,
    "redundancy" | "authorsReference"
  >,
): Pick<
  SketchToolFloatingInputDescriptor,
  "readout" | "readOnly" | "modeSwitch"
> {
  if (authoring.redundancy === "invalidSketch") {
    return { readout: CONSTRAINT_REDUNDANCY_UNCHECKED_NOTE };
  }
  if (authoring.redundancy !== "determined") {
    return {};
  }
  return {
    readout: CONSTRAINT_DETERMINED_NOTE,
    ...(authoring.authorsReference ? { readOnly: true as const } : {}),
    modeSwitch: {
      label: "Make driving",
      checked: !authoring.authorsReference,
      action: {
        type: "patch",
        patch: {
          intent: "setConstraintValueMode",
          reference: !authoring.authorsReference,
        },
      },
    },
  };
}

export const CONSTRAINT_DETERMINED_NOTE =
  "Already determined by other requirements";
export const CONSTRAINT_REDUNDANCY_UNCHECKED_NOTE =
  "Can't check redundancy while the sketch is invalid";

/** Display text of a measured prefill: the exact value is committed. */
function formatMeasuredValueText(value: number) {
  return String(Number(value.toFixed(6)));
}
