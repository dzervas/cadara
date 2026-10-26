import { getTangentArcSourceDirection } from "@/domain/sketch-inference/tangent-arc-source";
import type { SketchPoint } from "@/contracts/modeling/schema";
import { sketchPrimitiveContributionInput } from "@/core/sketch-tools/semantic-primitive";
import type {
  ReferenceId,
  SketchEntityId,
  SketchId,
} from "@/contracts/shared/ids";
import type {
  SketchDefinition,
  SketchReferenceDefinition,
} from "@/contracts/sketch/schema";
import { type PrimitiveRef, primitiveRefEquals } from "@/core/editor/schema";
import {
  getSketchConstraintDefinition,
  inferDimensionAnnotationPlacement,
  isRegisteredSketchConstraintToolId,
  resolveSketchConstraintTarget,
} from "@/core/sketch-constraints/registry";
import type {
  SketchConstraintTargetRecord,
  SketchConstraintToolId,
} from "@/core/sketch-constraints/definition";
import { getSketchSelectedLineCorners } from "@/domain/sketch-editing/operations";
import type {
  SketchEditToolId,
  SketchEditToolSelectionRequirement,
} from "@/core/sketch-edit-tools/definition";
import {
  getSketchEditToolDefinition,
  isRegisteredSketchEditToolId,
} from "@/core/sketch-edit-tools/registry";
import {
  bindPlacementInferences,
  inferPlacement,
  type PlacementInference,
} from "@/domain/sketch-inference/placement-inference";
import { buildSketchStylePresentation } from "@/domain/sketch-styles/definition";
import type {
  SketchDraftEntity,
  SketchToolCommitContribution,
  SketchToolDefinition,
  SketchToolPointerResult,
  SketchToolRuntimeState,
} from "@/core/sketch-tools/definition";
import type {
  SketchToolAnchorDescriptor,
  SketchToolControlValue,
  SketchToolPresentationSchema,
} from "@/core/sketch-tools/editor-schema";
import { getSketchToolDefinition } from "@/core/sketch-tools/registry";
import type { SketchSnapIntersectionTargetResult } from "@/contracts/sketch/edit-intersections";
import {
  getSketchExactIntersections,
  getSketchSnapIntersectionTargets,
} from "@/domain/sketch-snapping/snap-candidates";
import type {
  SketchAuthoringToolId,
  SketchConstraintAuthoringState,
  SketchEditToolState,
  SketchSessionState,
  SketchSnapIntersectionCache,
} from "./types";
import {
  applySketchContribution,
  createSessionCommitFactories,
  createConstraintId,
  withLiveSolveBasis,
  getCommittedSketchToolChainSegments,
  getSessionSketchId,
  getSketchSessionInvalidFeedback,
  getSketchSessionSnapIntersections,
  getTargetKey,
  hasAcceptedLiveSolveOfDefinition,
  isDrawingSketchTool,
  isSketchInferenceSuppressed,
  isSketchToolChainActive,
  rebuildSessionCommitRequest,
  restageSketchToolChain,
  withConstructionFlag,
  withPlacementPresentation,
} from "./internals";
import { getSketchSessionDisplaySolvedSnapshot } from "./solved-snapshot";
import { buildCommittedDimensionOverlays } from "./annotations";
import {
  activateSketchConstraintTool,
  authorSketchConstraintTarget,
  buildConstraintToolPresentation,
  canSketchConstraintSelectMoreTargets,
  isSketchConstraintReadyForValue,
  prepareSketchConstraintCommit,
} from "./constraints";
import {
  getSketchEditOperatorResult,
  selectSketchEditToolTarget,
  updateSketchOffsetPointer,
  updateSketchSplitPointer,
} from "./editing";
import { isSketchConstructionSelected } from "./state";
import { getSketchStyleTargetDefinition } from "./styles";
import { buildCommitRequest } from "./history";
import { keptSketchWithheldRegionText } from "./region-feedback";

export function buildConstructionTargetPresentation(): SketchToolPresentationSchema {
  return {
    prompts: [
      {
        id: "construction-prompt",
        text: "Select sketch geometry to toggle construction",
      },
    ],
    steps: [{ id: "construction-target", label: "Sketch geometry" }],
    selectionGuide: {
      id: "construction-selection-guide",
      label: "Select sketch geometry",
      acceptedKinds: ["point", "line", "circle", "arc"],
      selectedCount: 0,
      requiredCount: 1,
      hoverLabel: null,
    },
    completionHints: [
      {
        id: "construction-completion",
        text: "Select an edge or vertex to toggle construction",
        ready: false,
      },
    ],
  };
}

export function buildReferenceTargetPresentation(
  validationMessage: string | null = null,
): SketchToolPresentationSchema {
  return {
    prompts: [
      {
        id: "reference-prompt",
        text: "Select model or existing sketch geometry to reference",
      },
    ],
    steps: [{ id: "reference-target", label: "Reference geometry" }],
    selectionGuide: {
      id: "reference-selection-guide",
      label: "Select reference geometry",
      acceptedKinds: ["point", "line", "circle", "arc"],
      selectedCount: 0,
      requiredCount: 1,
      hoverLabel: null,
    },
    validation: validationMessage
      ? [
          {
            id: "reference-validation",
            message: validationMessage,
            severity: "warning",
          },
        ]
      : [],
    completionHints: [
      {
        id: "reference-completion",
        text: "Accepted references stay derived and read-only",
        ready: false,
      },
    ],
  };
}

export function beginSketchConstructionTool(
  session: SketchSessionState,
): SketchSessionState {
  if (isSketchConstructionSelected(session)) {
    return {
      ...session,
      activeTool: null,
      status: "idle",
      constructionTargetPicking: false,
      referenceTargetPicking: false,
      constructionModifierActive: false,
      pointerDownPoint: null,
      livePoint: null,
      toolStagedEntities: [],
      validationMessage: null,
      toolPresentation: null,
      constraintAuthoring: null,
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

  return {
    ...session,
    activeTool: "construction",
    status: "collectingTargets",
    constructionTargetPicking: true,
    referenceTargetPicking: false,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolStagedEntities: [],
    validationMessage: null,
    toolPresentation: buildConstructionTargetPresentation(),
    constraintAuthoring: null,
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

export function beginSketchReferenceTool(
  session: SketchSessionState,
): SketchSessionState {
  if (session.referenceTargetPicking) {
    return clearActiveSketchTool(session);
  }

  return {
    ...session,
    activeTool: "projectReference",
    status: "collectingTargets",
    constructionTargetPicking: false,
    referenceTargetPicking: true,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolStagedEntities: [],
    validationMessage: null,
    toolPresentation: buildReferenceTargetPresentation(),
    constraintAuthoring: null,
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

/** The label of an edit operator's single value (Offset: "Distance"). */
export function getSketchEditToolValueLabel(
  toolId: SketchEditToolState["toolId"],
) {
  return toolId === "sketchFillet"
    ? "Radius"
    : toolId === "sketchChamfer"
      ? "Distance"
      : toolId === "sketchSlot"
        ? "Width"
        : toolId === "sketchCircularPattern"
          ? "Angle"
          : "Distance";
}

export function buildSketchEditToolPresentation(
  state: SketchEditToolState,
  validationMessage: string | null = null,
  previewEntities: readonly SketchDraftEntity[] = [],
): SketchToolPresentationSchema {
  const isOffset = state.toolId === "offset";
  const isTrim = state.toolId === "trim";
  const definition = getSketchEditToolDefinition(state.toolId);
  const metadata = definition.metadata;
  const selectedCount = state.selectedTargets.length;
  const hasSelection = selectedCount > 0;
  const hoverLabel =
    state.hoverTarget?.kind === "sketchEntity" ? "Sketch entity" : null;
  const needsNumericValue =
    state.toolId === "sketchFillet" ||
    state.toolId === "sketchChamfer" ||
    state.toolId === "sketchSlot" ||
    state.toolId === "sketchLinearPattern" ||
    state.toolId === "sketchCircularPattern" ||
    state.toolId === "sketchTransform";
  const numericLabel = getSketchEditToolValueLabel(state.toolId);
  const numericUnit = state.toolId === "sketchCircularPattern" ? "rad" : "mm";
  const isReady =
    hasSelection && previewEntities.length > 0 && validationMessage === null;
  const promptText = isOffset
    ? hasSelection
      ? "Set offset distance"
      : metadata.validationMessages.emptySelection
    : isTrim
      ? metadata.validationMessages.emptySelection
      : hasSelection
        ? needsNumericValue
          ? `Set ${numericLabel.toLowerCase()}`
          : `Accept ${metadata.name.toLowerCase()}`
        : metadata.validationMessages.emptySelection;
  const validation = validationMessage
    ? [
        {
          id: `${state.toolId}-validation`,
          message: validationMessage,
          severity: "error" as const,
        },
      ]
    : [];

  return {
    prompts: [
      {
        id: `${state.toolId}-prompt`,
        text: promptText,
        tone: validation.length > 0 ? "warning" : "neutral",
      },
    ],
    selectionGuide: {
      id: `${state.toolId}-selection`,
      label: metadata.selection.label,
      acceptedKinds: metadata.selection.acceptedKinds,
      selectedCount,
      requiredCount: metadata.selection.requiredCount,
      hoverLabel,
    },
    controls: [
      ...(isOffset
        ? [
            {
              id: "offset-distance",
              kind: "numeric" as const,
              label: "Distance",
              value: state.offsetDistance,
              unit: "mm",
              disabled: !hasSelection,
              action: {
                type: "patch" as const,
                patch: { intent: "setOffsetDistance" },
              },
            },
            {
              id: "offset-side",
              kind: "option" as const,
              label: "Side",
              value: state.offsetSide,
              options: [
                { value: "left", label: "Left of chain" },
                { value: "right", label: "Right of chain" },
              ],
              disabled: !hasSelection,
              action: {
                type: "patch" as const,
                patch: { intent: "setOffsetSide" },
              },
            },
          ]
        : []),
      ...(needsNumericValue
        ? [
            {
              id: `${state.toolId}-value`,
              kind: "numeric" as const,
              label: numericLabel,
              value: state.toolValue,
              unit: numericUnit,
              disabled: !hasSelection,
              action: {
                type: "patch" as const,
                patch: { intent: "setSketchEditValue" },
              },
            },
          ]
        : []),
    ],
    completionHints: [
      {
        id: `${state.toolId}-completion`,
        text: isOffset
          ? hasSelection
            ? "Confirm to create offset geometry"
            : "Select connected lines or one curve"
          : hasSelection
            ? `Confirm ${metadata.previewLabel.toLowerCase()}`
            : metadata.validationMessages.emptySelection,
        ready: Boolean(isReady),
      },
    ],
    floatingInput:
      isOffset && hasSelection
        ? {
            id: "offset-distance-input",
            label: "Offset distance",
            value:
              state.offsetDistance === null
                ? null
                : String(state.offsetDistance),
            unit: "mm",
            min: 0,
            numericOnly: true,
            confirmLabel: "Create",
            cancelLabel: "Cancel",
            placement: "target",
            // T08b-g5b: a shell or joint-arc preview (polyline) anchors too;
            // otherwise its offset could not be confirmed in the viewport.
            anchor: getPreviewAnchor(previewEntities),
            submitAction: { type: "patch", patch: { intent: "commitOffset" } },
            cancelAction: { type: "patch", patch: { intent: "cancelOffset" } },
          }
        : needsNumericValue && hasSelection
          ? {
              id: `${state.toolId}-value-input`,
              label: numericLabel,
              value: state.toolValue === null ? null : String(state.toolValue),
              unit: numericUnit,
              min: 0,
              numericOnly: true,
              confirmLabel: "Create",
              cancelLabel: "Cancel",
              placement: "target",
              anchor: getPreviewAnchor(previewEntities),
              submitAction: {
                type: "patch",
                patch: { intent: "commitSketchEditOperator" },
              },
              cancelAction: {
                type: "patch",
                patch: { intent: "cancelSketchEditOperator" },
              },
            }
          : null,
    overlays: state.hoverTarget
      ? [
          {
            id: `${state.toolId}-target-feedback`,
            kind: "referenceLabel",
            label: hoverLabel ?? "Unsupported target",
            anchor: {
              kind: "sketchPoint",
              point: [0, 0],
              offset: { x: 18, y: -18 },
            },
          },
        ]
      : [],
    validation,
    extension: {
      id: `${state.toolId}-workflow`,
      payload: {
        toolId: state.toolId,
        hasSelection,
        selectedCount,
        mutationContract: metadata.mutationContract,
        previewEntityCount: previewEntities.length,
      },
    },
  };
}

export function getPreviewAnchor(
  previewEntities: readonly SketchDraftEntity[],
): SketchToolAnchorDescriptor | undefined {
  const preview = previewEntities[0];
  if (!preview) {
    return undefined;
  }

  if (preview.kind === "line") {
    return {
      kind: "sketchPoint",
      point: midpointSketchPoints(preview.start, preview.end),
      offset: { x: 18, y: -18 },
    };
  }

  if (preview.kind === "circle") {
    return {
      kind: "sketchPoint",
      point: preview.center,
      offset: { x: 18, y: -18 },
    };
  }

  const points =
    preview.kind === "spline" || preview.kind === "polyline"
      ? preview.points
      : [];
  const point = points[Math.floor(points.length / 2)];
  return point
    ? { kind: "sketchPoint", point, offset: { x: 18, y: -18 } }
    : undefined;
}

export function midpointSketchPoints(
  left: SketchPoint,
  right: SketchPoint,
): SketchPoint {
  return [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
}

export function getSketchEditSelectionKindForEntity(
  definition: SketchDefinition,
  entityId: SketchEntityId,
): SketchEditToolSelectionRequirement["acceptedKinds"][number] | null {
  const entity = definition.entities.find(
    (entry) => entry.entityId === entityId,
  );

  if (!entity) {
    return null;
  }

  switch (entity.kind) {
    case "point":
      return "point";
    case "lineSegment":
      return "line";
    case "circle":
      return "circle";
    case "arc":
      return "arc";
    case "spline":
      return "spline";
    default:
      return null;
  }
}

export function getSketchEditSelectionKindForProjectedGeometry(
  target: Extract<PrimitiveRef, { kind: "projectedReferenceGeometry" }>,
): SketchEditToolSelectionRequirement["acceptedKinds"][number] | null {
  switch (target.geometryKind) {
    case "lineSegment":
      return "line";
    case "circle":
      return "circle";
    case "arc":
      return "arc";
    case "spline":
      return "spline";
    default:
      return null;
  }
}

export function canAppendSketchEditToolActivationTarget(
  session: SketchSessionState,
  toolId: SketchEditToolId,
  selectedTargets: readonly PrimitiveRef[],
  target: PrimitiveRef,
) {
  const metadata = getSketchEditToolDefinition(toolId).metadata;

  if (
    selectedTargets.some((selected) => primitiveRefEquals(selected, target))
  ) {
    return false;
  }

  if (
    !metadata.selection.allowsMultiple &&
    selectedTargets.length >= metadata.selection.requiredCount
  ) {
    return false;
  }

  if (
    selectedTargets.some(
      (selected) => selected.kind === "projectedReferenceGeometry",
    ) ||
    target.kind === "projectedReferenceGeometry"
  ) {
    const selectionKind =
      target.kind === "projectedReferenceGeometry"
        ? getSketchEditSelectionKindForProjectedGeometry(target)
        : null;
    return (
      toolId === "offset" &&
      selectedTargets.length === 0 &&
      target.kind === "projectedReferenceGeometry" &&
      selectionKind !== null &&
      metadata.selection.acceptedKinds.includes(selectionKind)
    );
  }

  // T13j: Merge Points adopts this sketch's selected points, in order.
  if (target.kind === "sketchPoint") {
    return (
      toolId === "sketchMergePoints" &&
      target.sketchId === (session.sketchId ?? "sketch_draft")
    );
  }

  if (target.kind !== "sketchEntity") {
    return false;
  }

  const selectionKind = getSketchEditSelectionKindForEntity(
    session.definition,
    target.entityId,
  );
  return (
    selectionKind !== null &&
    metadata.selection.acceptedKinds.includes(selectionKind)
  );
}

/**
 * The preselection an edit tool adopts at activation, in selection order
 * (cadara-dd3.121: all or nothing). cadara-h026.2 (user decision): Sketch
 * Fillet and Chamfer instead adopt the selected lines when they have a
 * corner (`getSketchSelectedLineCorners`) and drop everything else, e.g. a
 * marquee's points; with no corner they adopt nothing. Lines without a
 * corner stay adopted: they still mark three-line junctions as no corner.
 */
export function adoptCompatibleSketchEditToolTargets(
  session: SketchSessionState,
  toolId: SketchEditToolId,
  targets: readonly PrimitiveRef[],
): PrimitiveRef[] {
  if (isSketchCornerEditTool(toolId)) {
    const lines = targets.filter(
      (target): target is Extract<PrimitiveRef, { kind: "sketchEntity" }> =>
        target.kind === "sketchEntity" &&
        getSketchEditSelectionKindForEntity(
          session.definition,
          target.entityId,
        ) === "line",
    );
    const uniqueLines = lines.filter(
      (line, index) =>
        lines.findIndex((other) => other.entityId === line.entityId) === index,
    );
    return getSketchSelectedLineCorners(
      session.definition,
      uniqueLines.map((line) => line.entityId),
    ).length > 0
      ? uniqueLines
      : [];
  }

  const adoptedTargets: PrimitiveRef[] = [];

  for (const target of targets) {
    if (
      !canAppendSketchEditToolActivationTarget(
        session,
        toolId,
        adoptedTargets,
        target,
      )
    ) {
      return [];
    }

    adoptedTargets.push(target);
  }

  return adoptedTargets;
}

export function beginSketchEditTool(
  session: SketchSessionState,
  toolId: SketchEditToolId,
  initialSelectedTargets: readonly PrimitiveRef[] = [],
): SketchSessionState {
  const activeEditTool: SketchEditToolState = {
    toolId,
    hoverTarget: null,
    selectedTarget: null,
    selectedTargets: [],
    offsetDistance: 1,
    offsetSide: "left",
    toolValue: toolId === "sketchSlot" ? 2 : 1,
  };

  let nextSession: SketchSessionState = {
    ...session,
    activeTool: toolId,
    activeEditTool,
    status: "collectingTargets",
    constructionTargetPicking: false,
    referenceTargetPicking: false,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolStagedEntities: [],
    validationMessage: null,
    toolPresentation: buildSketchEditToolPresentation(activeEditTool),
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    activeEditTarget: null,
    activeStyleFocus: null,
    activeDrag: null,
    activeInference: null,
    toolPlacements: [],
    toolStartPointId: null,
    toolTangentSourceEntityId: null,
  };

  const adoptedTargets = adoptCompatibleSketchEditToolTargets(
    session,
    toolId,
    initialSelectedTargets,
  );

  // cadara-h026.2: a corner tool takes all its adopted lines at once (a
  // later pick keeps only the last adopted line with it).
  if (isSketchCornerEditTool(toolId) && adoptedTargets.length > 0) {
    const tool: SketchEditToolState = {
      ...activeEditTool,
      selectedTarget: adoptedTargets[0]!,
      selectedTargets: adoptedTargets,
    };
    const preview = getSketchEditOperatorResult(nextSession, tool);
    return {
      ...nextSession,
      activeEditTool: tool,
      toolStagedEntities: preview.previewEntities,
      toolPresentation: buildSketchEditToolPresentation(
        tool,
        preview.message,
        preview.previewEntities,
      ),
    };
  }

  for (const target of adoptedTargets) {
    nextSession = selectSketchEditToolTarget(nextSession, target);
  }

  return nextSession;
}

function isSketchCornerEditTool(toolId: SketchEditToolId) {
  return toolId === "sketchFillet" || toolId === "sketchChamfer";
}

/**
 * cadara-h026.2: a tool's pick-cycle deselect entry (`selectionMode:
 * "remove"`) drops `target`, the cycle's own pick, which the tool holds as
 * its last-added pick; its other picks and values stay and the tool
 * re-stages. Unchanged when `target` is not the last-added pick.
 */
export function removeSketchToolCyclePick(
  session: SketchSessionState,
  target: PrimitiveRef,
): SketchSessionState {
  const tool = session.activeEditTool;
  if (tool) {
    const last = tool.selectedTargets.at(-1);
    if (!last || !primitiveRefEquals(last, target)) return session;
    // Edit tools toggle a held pick off, except Merge Points' source,
    // which only the tool's restart drops.
    return tool.toolId === "sketchMergePoints" &&
      tool.selectedTargets.length === 1
      ? beginSketchEditTool(session, tool.toolId)
      : selectSketchEditToolTarget(session, target);
  }
  const authoring = session.constraintAuthoring;
  if (!authoring) return session;
  const last = authoring.selectedTargets.at(-1)?.target;
  const resolved = resolveSketchConstraintTarget(
    authoring.toolId,
    session.definition,
    target,
    session.projectedReferences,
  )?.target;
  if (!last || !resolved || !primitiveRefEquals(last, resolved)) return session;
  const armed = activateSketchConstraintTool(session, authoring.toolId);
  return authoring.selectedTargets
    .slice(0, -1)
    .reduce<SketchSessionState>(
      (next, entry) => authorSketchConstraintTarget(next, entry.target).session,
      {
        ...armed,
        constraintAuthoring: {
          ...armed.constraintAuthoring!,
          pointer: authoring.pointer,
        },
      },
    );
}

/**
 * cadara-h026.2: a constraint or Dimension tool activated on the
 * preselection adopts the targets it resolves, in selection order, and
 * reports which (the editor selection keeps them while the tool holds them).
 * A tool with a `selectionExpansion` commits more targets than its steps at
 * once (Horizontal on N lines constrains each, Equal chains them); any other
 * tool takes them as picks, so a complete pick set commits (or, for a value
 * tool, previews its value) and a partial one arms the tool with them. With
 * nothing resolved the tool is armed as usual and adopts nothing.
 */
export function beginSketchConstraintToolFromSelection(
  current: SketchSessionState,
  toolId: SketchConstraintToolId,
  selection: readonly PrimitiveRef[],
): { session: SketchSessionState; adopted: PrimitiveRef[] } {
  let session = beginSketchTool(current, toolId);
  const definition = getSketchConstraintDefinition(toolId);
  const candidates: { target: PrimitiveRef; resolvedKey: string }[] = [];
  const resolved: SketchConstraintTargetRecord[] = [];
  for (const target of selection) {
    const record = resolveSketchConstraintTarget(
      toolId,
      session.definition,
      target,
      session.projectedReferences,
    );
    const resolvedKey = record ? getTargetKey(record.target) : null;
    if (
      !record ||
      !resolvedKey ||
      candidates.some((candidate) => candidate.resolvedKey === resolvedKey)
    )
      continue;
    candidates.push({ target, resolvedKey });
    resolved.push(record);
  }

  if (
    definition.selectionExpansion &&
    resolved.length > definition.steps.length
  ) {
    session = prepareSketchConstraintCommit(session, {
      ...session.constraintAuthoring!,
      selectedTargets: resolved,
    }).session;
  } else {
    for (const record of resolved.slice(0, definition.steps.length)) {
      // A commit ends the authoring; a complete value pick set waits.
      const authoring = session.constraintAuthoring;
      if (
        !authoring ||
        (isSketchConstraintReadyForValue(
          definition,
          authoring.selectedTargets,
        ) &&
          !canSketchConstraintSelectMoreTargets(
            definition,
            authoring.selectedTargets,
          ))
      )
        break;
      session = authorSketchConstraintTarget(session, record.target).session;
    }
  }

  const heldKeys = new Set(
    session.constraintAuthoring?.selectedTargets.map((entry) =>
      getTargetKey(entry.target),
    ) ?? [],
  );
  return {
    session,
    adopted: candidates
      .filter((candidate) => heldKeys.has(candidate.resolvedKey))
      .map((candidate) => candidate.target),
  };
}

export function beginSketchTool(
  current: SketchSessionState,
  toolId: SketchAuthoringToolId,
  initialSelectedTargets: readonly PrimitiveRef[] = [],
): SketchSessionState {
  // Any (re)activation ends an active Line chain (T11-D14, review A-7).
  const session = current.toolChain ? { ...current, toolChain: null } : current;

  if (toolId === "construction") {
    return beginSketchConstructionTool(session);
  }

  if (toolId === "projectReference") {
    return beginSketchReferenceTool(session);
  }

  if (isRegisteredSketchConstraintToolId(toolId)) {
    return {
      ...activateSketchConstraintTool(session, toolId),
      constructionTargetPicking: false,
      referenceTargetPicking: false,
    };
  }

  if (isRegisteredSketchEditToolId(toolId)) {
    return beginSketchEditTool(session, toolId, initialSelectedTargets);
  }

  const toolDefinition = getSketchToolDefinition(toolId);
  const activation = toolDefinition.activate();
  const constructionModifierActive =
    session.constructionModifierActive || session.constructionTargetPicking;

  return {
    ...session,
    activeTool: toolId,
    status: activation.state.status,
    constructionTargetPicking: false,
    referenceTargetPicking: false,
    constructionModifierActive,
    pointerDownPoint: activation.state.pointerDownPoint,
    livePoint: activation.state.livePoint,
    toolPlacedPoints: activation.state.placedPoints ?? [],
    toolSettings: activation.state.settings ?? {},
    toolStagedEntities: [],
    toolPresentation: activation.presentation,
    constraintAuthoring: null,
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

/** Fit-point clicks are draft state, not authored actions. */
export function canUndoSketchDraftPoint(session: SketchSessionState): boolean {
  if (!isDrawingSketchTool(session.activeTool)) return false;
  const { lifecycle } = getSketchToolDefinition(session.activeTool);
  return (
    typeof lifecycle === "object" &&
    lifecycle.kind === "fitPoints" &&
    session.toolPlacedPoints.length > 0
  );
}

export function undoSketchDraftPoint(
  session: SketchSessionState,
): SketchSessionState {
  if (
    !canUndoSketchDraftPoint(session) ||
    !isDrawingSketchTool(session.activeTool)
  ) {
    return session;
  }

  const tool = getSketchToolDefinition(session.activeTool);
  const placedPoints = session.toolPlacedPoints.slice(0, -1);
  const placements = (session.toolPlacements ?? []).slice(0, -1);
  const runtimeState: SketchToolRuntimeState = {
    ...getToolRuntimeState(session),
    status: placedPoints.length ? "drawing" : "idle",
    pointerDownPoint: placedPoints[0] ?? null,
    livePoint: null,
    placedPoints,
    validationMessage: null,
  };
  return {
    ...session,
    status: runtimeState.status,
    pointerDownPoint: runtimeState.pointerDownPoint,
    livePoint: null,
    toolPlacedPoints: placedPoints,
    toolPlacements: placements,
    toolStartPointId: placedPoints.length ? session.toolStartPointId : null,
    activeInference: null,
    validationMessage: null,
    toolStagedEntities: withConstructionFlag(
      tool.getStagedEntities(runtimeState),
      session.constructionModifierActive,
    ),
    toolPresentation: withPlacementPresentation(
      tool.getPresentation(runtimeState),
      placements,
      null,
    ),
  };
}

/** What one Escape does to an armed drawing tool (T11-D10). */
export type SketchDrawingEscapeStep =
  | "endChain"
  | "finalizeDraft"
  | "cancelDraft"
  | "exitTool";

/**
 * The Escape step order for an armed drawing tool (T11-D10). An open pick
 * chooser consumes Escape before this, in the viewport (T11e). Then: end an
 * active Line chain (Line stays armed); finalize a fit-point draft that has
 * its minimum points (one action, the tool stays armed); cancel any other
 * incomplete draft (no action, the tool stays armed); otherwise leave the
 * tool for Select.
 */
export function resolveSketchDrawingEscapeStep(draft: {
  chainActive: boolean;
  finalizable: boolean;
  incomplete: boolean;
}): SketchDrawingEscapeStep {
  if (draft.chainActive) {
    return "endChain";
  }

  if (draft.finalizable) {
    return "finalizeDraft";
  }

  return draft.incomplete ? "cancelDraft" : "exitTool";
}

export function escapeSketchDrawing(
  session: SketchSessionState,
): SketchDrawingEscapeStep {
  return resolveSketchDrawingEscapeStep({
    chainActive: isSketchToolChainActive(session),
    finalizable: isSketchFitPointDraftFinalizable(session),
    incomplete: session.status === "drawing",
  });
}

/**
 * Whether the armed tool is a fit-point tool (`lifecycle.kind:
 * "fitPoints"`) drawing a draft with at least its minimum placed points.
 */
function isSketchFitPointDraftFinalizable(session: SketchSessionState) {
  if (
    session.status !== "drawing" ||
    !isDrawingSketchTool(session.activeTool)
  ) {
    return false;
  }

  const { lifecycle } = getSketchToolDefinition(session.activeTool);
  return (
    typeof lifecycle === "object" &&
    session.toolPlacedPoints.length >= lifecycle.minimum
  );
}

/**
 * Finalizes a viable fit-point draft (T11-D10, D13): one definition change
 * through every placed point, with the start snap and the snap accepted on
 * the last fit point; the tool stays armed and idle. Anything else is left
 * unchanged (review A-9).
 */
export function finalizeSketchDraw(
  session: SketchSessionState,
): SketchSessionState {
  if (
    !isSketchFitPointDraftFinalizable(session) ||
    !isDrawingSketchTool(session.activeTool)
  ) {
    return session;
  }

  const toolDefinition = getSketchToolDefinition(session.activeTool);
  const activation = toolDefinition.activate();
  const points = session.toolPlacedPoints;

  return commitSketchDraw(
    session,
    toolDefinition,
    {
      state: { ...activation.state, placedPoints: points },
      stagedEntities: [],
      presentation: activation.presentation,
    },
    points[0]!,
    points.at(-1)!,
    session.toolPlacements ?? [],
  );
}

/**
 * What Enter does to an armed drawing tool: the Escape steps that complete
 * something (end a chain, finalize a viable fit-point draft), else nothing,
 * so Enter is not consumed (T11-D10, review A-9).
 */
export function confirmSketchDrawing(
  session: SketchSessionState,
): Extract<SketchDrawingEscapeStep, "endChain" | "finalizeDraft"> | null {
  const step = escapeSketchDrawing(session);
  return step === "endChain" || step === "finalizeDraft" ? step : null;
}

export function clearActiveSketchTool(
  session: SketchSessionState,
): SketchSessionState {
  if (
    session.activeTool === null &&
    !isSketchConstructionSelected(session) &&
    !session.referenceTargetPicking &&
    !session.activeStyleFocus
  ) {
    return session;
  }

  return {
    ...session,
    activeTool: null,
    status: "idle",
    constructionTargetPicking: false,
    referenceTargetPicking: false,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolPlacedPoints: [],
    toolSettings: {},
    toolStagedEntities: [],
    // T17k2 (T17k F-1): leaving a tool keeps the sketch's own explanation
    // (as point selection and Undo/Redo do); the tool's messages go.
    validationMessage: keptSketchStatusText(session),
    toolPresentation: null,
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    activeEditTool: null,
    activeEditTarget: null,
    activeStyleFocus: null,
    activeDrag: null,
    activeInference: null,
    toolPlacements: [],
    toolStartPointId: null,
    toolTangentSourceEntityId: null,
    toolChain: null,
  };
}

/**
 * The status line that belongs to the sketch, not to a tool: the invalid
 * sketch's explanation while its profiles are blocked (T17c3), else a
 * withheld region's explanation (T17c6), else none.
 */
function keptSketchStatusText(session: SketchSessionState) {
  return session.liveRegions.status === "unavailable"
    ? (getSketchSessionInvalidFeedback(session) ??
        "Sketch profiles are unavailable until the sketch is corrected.")
    : keptSketchWithheldRegionText(session);
}

export function updateSketchPointer(
  session: SketchSessionState,
  point: SketchPoint | null,
): SketchSessionState {
  if (session.activeEditTool?.toolId === "offset") {
    return updateSketchOffsetPointer(session, point);
  }

  if (session.activeEditTool?.toolId === "sketchSplit" || session.activeEditTool?.toolId === "trim") {
    return updateSketchSplitPointer(session, point);
  }

  if (
    session.activeTool !== null &&
    isRegisteredSketchConstraintToolId(session.activeTool)
  ) {
    if (!session.constraintAuthoring) {
      return session;
    }

    if (session.constraintAuthoring.isPreviewPinned) {
      return session;
    }

    const pendingAnnotationPlacement = isSketchConstraintReadyForValue(
      getSketchConstraintDefinition(session.constraintAuthoring.toolId),
      session.constraintAuthoring.selectedTargets,
    )
      ? inferDimensionAnnotationPlacement(
          session.constraintAuthoring.selectedTargets,
          point,
        )
      : session.constraintAuthoring.pendingAnnotationPlacement;

    if (
      sketchPointsEqual(session.constraintAuthoring.pointer, point) &&
      dimensionAnnotationPlacementsEqual(
        session.constraintAuthoring.pendingAnnotationPlacement,
        pendingAnnotationPlacement,
      )
    ) {
      return session;
    }

    const nextAuthoring: SketchConstraintAuthoringState = {
      ...session.constraintAuthoring,
      pointer: point,
      pendingAnnotationPlacement,
    };

    return {
      ...session,
      toolPresentation: buildConstraintToolPresentation(nextAuthoring),
      constraintAuthoring: nextAuthoring,
      activeInference: null,
    };
  }

  if (!isDrawingSketchTool(session.activeTool)) {
    return session.activeInference
      ? { ...session, activeInference: null }
      : session;
  }

  const toolDefinition = getSketchToolDefinition(session.activeTool);
  const inference = previewSketchPlacement(session, point);
  const result = toolDefinition.pointerMove({
    state: getToolRuntimeState(session),
    point: inference?.position ?? point,
  });

  const nextSession: SketchSessionState = {
    ...session,
    status: result.state.status,
    pointerDownPoint: result.state.pointerDownPoint,
    livePoint: result.state.livePoint,
    toolPlacedPoints: result.state.placedPoints ?? session.toolPlacedPoints,
    toolSettings: result.state.settings ?? session.toolSettings,
    toolStagedEntities: withConstructionFlag(
      result.stagedEntities,
      session.constructionModifierActive,
    ),
    toolPresentation: withPlacementPresentation(
      result.presentation,
      session.toolPlacements ?? [],
      inference,
    ),
    activeInference: inference,
  };

  return sketchPointerPreviewStateEqual(session, nextSession)
    ? session
    : nextSession;
}

function sketchPointerPreviewStateEqual(
  current: SketchSessionState,
  next: SketchSessionState,
) {
  return (
    current.status === next.status &&
    sketchPointsEqual(current.pointerDownPoint, next.pointerDownPoint) &&
    sketchPointsEqual(current.livePoint, next.livePoint) &&
    sketchPointArraysEqual(current.toolPlacedPoints, next.toolPlacedPoints) &&
    current.toolSettings === next.toolSettings &&
    current.validationMessage === next.validationMessage &&
    current.activeInference?.candidate?.key ===
      next.activeInference?.candidate?.key &&
    sketchDraftEntitiesEqual(
      current.toolStagedEntities,
      next.toolStagedEntities,
    ) &&
    JSON.stringify(current.toolPresentation) ===
      JSON.stringify(next.toolPresentation)
  );
}

function sketchPointsEqual(
  left: SketchPoint | null,
  right: SketchPoint | null,
) {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    Math.abs(left[0] - right[0]) <= 1e-9 && Math.abs(left[1] - right[1]) <= 1e-9
  );
}

function sketchPointArraysEqual(
  left: readonly SketchPoint[],
  right: readonly SketchPoint[],
) {
  return (
    left.length === right.length &&
    left.every((point, index) => sketchPointsEqual(point, right[index] ?? null))
  );
}

function dimensionAnnotationPlacementsEqual(
  left: import("@/contracts/sketch/schema").DimensionAnnotationPlacement | null,
  right:
    | import("@/contracts/sketch/schema").DimensionAnnotationPlacement
    | null,
) {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return JSON.stringify(left) === JSON.stringify(right);
}

function sketchDraftEntitiesEqual(
  left: readonly import("@/core/sketch-tools/definition").SketchDraftEntity[],
  right: readonly import("@/core/sketch-tools/definition").SketchDraftEntity[],
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function selectSketchEditTarget(
  session: SketchSessionState,
  target: PrimitiveRef,
): SketchSessionState {
  if (target.kind !== "sketchPoint") {
    return session;
  }

  if (target.sketchId !== getSessionSketchId(session)) {
    return session;
  }

  if (
    !session.definition.points.some((point) => point.pointId === target.pointId)
  ) {
    return session;
  }

  return {
    ...session,
    activeEditTarget: target,
    activeDrag: null,
    activeAnnotationEdit: null,
    // T17c3: selecting a point (the viewport selects a dragged point on
    // release) keeps the explanation of a sketch whose profiles are blocked.
    // T17c6 (D-2): and of a withheld region shown on the status line.
    validationMessage: keptSketchStatusText(session),
  };
}

export function toggleSketchConstructionTarget(
  session: SketchSessionState,
  target: PrimitiveRef,
): SketchSessionState {
  if (
    !session.constructionTargetPicking ||
    (target.kind !== "sketchEntity" && target.kind !== "sketchPoint") ||
    target.sketchId !== getSessionSketchId(session)
  ) {
    return session;
  }

  return setSketchConstructionTarget(session, target);
}

/** Shared explicit construction edit; omitting the value is the browser toggle. */
export function setSketchConstructionTarget(
  session: SketchSessionState,
  target: PrimitiveRef,
  construction?: boolean,
): SketchSessionState {
  if ((target.kind !== "sketchEntity" && target.kind !== "sketchPoint") || target.sketchId !== getSessionSketchId(session)) return session;
  const selected = target.kind === "sketchEntity"
    ? session.definition.entities.find(e => e.entityId === target.entityId)
    : session.definition.points.find(p => p.pointId === target.pointId);
  if (!selected) return session;
  if (selected.isConstruction === construction) return { ...session, validationMessage: null };
  const nextFullDefinition = toggleConstructionTargetInDefinition(
    session.definition,
    target,
  );

  if (nextFullDefinition === session.definition) {
    return session;
  }

  const definition = nextFullDefinition;

  return withLiveSolveBasis(
    {
      ...session,
      activeTool: null,
      status: "idle",
      constructionTargetPicking: false,
      referenceTargetPicking: false,
      constructionModifierActive: false,
      pointerDownPoint: null,
      livePoint: null,
      toolPlacedPoints: [],
      toolSettings: {},
      toolPresentation: null,
      constraintAuthoring: null,
      activeAnnotationEdit: null,
      activeEditTarget: null,
      activeDrag: null,
      definition,
      toolStagedEntities: [],
      commitRequest: rebuildSessionCommitRequest(session, definition),
      validationMessage: null,
    },
    definition,
  );
}

export function createReferenceId(
  sequence: number,
  target: PrimitiveRef,
): ReferenceId {
  return `ref_${sequence}_${getTargetKey(target).replaceAll(/[^a-zA-Z0-9_-]/g, "-")}_${crypto.randomUUID()}` as ReferenceId;
}

export function sourceMatchesTarget(
  reference: SketchReferenceDefinition,
  target: PrimitiveRef,
) {
  if (reference.kind === "modelReference") {
    return getTargetKey(reference.source) === getTargetKey(target);
  }

  if (reference.kind === "sketchReference") {
    return getTargetKey(reference.source) === getTargetKey(target);
  }

  if (reference.kind === "constructionPlane") {
    return getTargetKey(reference.source) === getTargetKey(target);
  }

  return false;
}

export function createReferenceDefinition(
  sequence: number,
  target: PrimitiveRef,
): SketchReferenceDefinition | { kind: "unsupported"; message: string } {
  switch (target.kind) {
    case "face":
    case "edge":
    case "vertex":
      return {
        referenceId: createReferenceId(sequence, target),
        kind: "modelReference",
        label: `Reference ${target.kind}`,
        source: target,
        projectionMode:
          target.kind === "face"
            ? "useExistingCoplanarGeometry"
            : "projectAlongPlaneNormal",
      };
    case "sketch":
    case "sketchEntity":
    case "sketchPoint":
      return {
        referenceId: createReferenceId(sequence, target),
        kind: "sketchReference",
        label: `Reference ${target.kind}`,
        source: target,
        projectionMode: "useExistingCoplanarGeometry",
      };
    case "construction":
      return {
        referenceId: createReferenceId(sequence, target),
        kind: "constructionPlane",
        label: "Reference construction plane",
        source: target,
        projectionMode: "coplanar",
      };
    default:
      return {
        kind: "unsupported",
        message: `${target.kind} cannot be referenced from a sketch.`,
      };
  }
}

export function appendReferenceDefinition(
  definition: SketchDefinition,
  reference: SketchReferenceDefinition,
): SketchDefinition {
  return {
    ...definition,
    referenceIds: [...definition.referenceIds, reference.referenceId],
    references: [...definition.references, reference],
  };
}

export function selectSketchReferenceTarget(
  session: SketchSessionState,
  target: PrimitiveRef,
): SketchSessionState {
  return session.referenceTargetPicking ? authorSketchReference(session, target) : session;
}

/** Explicit reference authoring shared with browser target selection. */
export function authorSketchReference(
  session: SketchSessionState,
  target: PrimitiveRef,
): SketchSessionState {
  if (
    (target.kind === "sketch" ||
      target.kind === "sketchEntity" ||
      target.kind === "sketchPoint") &&
    (target.sketchId === getSessionSketchId(session) || target.sketchId === session.actionContextId)
  ) {
    const message =
      "Reference geometry must come from model topology or another existing sketch.";
    return {
      ...session,
      toolPresentation: buildReferenceTargetPresentation(message),
    };
  }

  if (
    session.definition.references.some((reference) =>
      sourceMatchesTarget(reference, target),
    )
  ) {
    const message = "That reference is already authored in this sketch.";
    return {
      ...session,
      toolPresentation: buildReferenceTargetPresentation(message),
    };
  }

  const nextSequence = session.sequence + 1;
  const reference = createReferenceDefinition(nextSequence, target);

  if (reference.kind === "unsupported") {
    return {
      ...session,
      toolPresentation: buildReferenceTargetPresentation(reference.message),
    };
  }

  const definition = appendReferenceDefinition(session.definition, reference);

  return withLiveSolveBasis(
    {
      ...session,
      activeTool: null,
      status: "idle",
      constructionTargetPicking: false,
      referenceTargetPicking: false,
      constructionModifierActive: false,
      pointerDownPoint: null,
      livePoint: null,
      toolPlacedPoints: [],
      toolSettings: {},
      toolPresentation: null,
      constraintAuthoring: null,
      activeAnnotationEdit: null,
      activeEditTarget: null,
      activeDrag: null,
      sequence: nextSequence,
      definition,
      commitRequest: rebuildSessionCommitRequest(session, definition),
      validationMessage: null,
    },
    definition,
  );
}

export function deleteSketchReferenceTarget(
  session: SketchSessionState,
  target: PrimitiveRef,
): SketchSessionState {
  if (
    target.kind !== "projectedReferenceGeometry" &&
    target.kind !== "sketchExternalReference"
  ) {
    return session;
  }

  const removeFromDefinition = (
    definition: SketchDefinition,
  ): SketchDefinition => ({
    ...definition,
    referenceIds: definition.referenceIds.filter(
      (referenceId) => referenceId !== target.referenceId,
    ),
    references: definition.references.filter(
      (reference) => reference.referenceId !== target.referenceId,
    ),
  });
  const fullDefinition = removeFromDefinition(session.definition);

  if (fullDefinition === session.definition) {
    return session;
  }

  const definition = removeFromDefinition(session.definition);

  return withLiveSolveBasis(
    {
      ...session,
      definition,
      projectedReferences: session.projectedReferences.filter(
        (reference) => reference.referenceId !== target.referenceId,
      ),
      projectionDiagnostics: session.projectionDiagnostics,
      commitRequest: rebuildSessionCommitRequest(session, definition),
      validationMessage: null,
    },
    definition,
  );
}

export function toggleConstructionTargetInDefinition(
  definition: SketchDefinition,
  target: PrimitiveRef,
): SketchDefinition {
  if (target.kind === "sketchEntity") {
    const selectedEntity = definition.entities.find(
      (entity) => entity.entityId === target.entityId,
    );

    if (!selectedEntity) {
      return definition;
    }

    const isConstruction = !selectedEntity.isConstruction;
    const points =
      selectedEntity.kind === "point"
        ? definition.points.map((point) =>
            point.pointId === selectedEntity.pointId
              ? { ...point, isConstruction }
              : point,
          )
        : definition.points;

    return {
      ...definition,
      points,
      entities: definition.entities.map((entity) =>
        entity.entityId === target.entityId
          ? { ...entity, isConstruction }
          : entity,
      ),
    };
  }

  if (target.kind !== "sketchPoint") {
    return definition;
  }

  const selectedPoint = definition.points.find(
    (point) => point.pointId === target.pointId,
  );

  if (!selectedPoint) {
    return definition;
  }

  const isConstruction = !selectedPoint.isConstruction;

  return {
    ...definition,
    points: definition.points.map((point) =>
      point.pointId === target.pointId ? { ...point, isConstruction } : point,
    ),
    entities: definition.entities.map((entity) =>
      entity.kind === "point" && entity.pointId === target.pointId
        ? { ...entity, isConstruction }
        : entity,
    ),
  };
}

/**
 * Keep the constraint de-duplication helpers on this module's surface (the
 * constraint tools use them, T13-D8); the inference owner defines them.
 */
export {
  dedupeConstraints,
  getConstraintDedupeKey,
} from "@/domain/sketch-inference/placement-inference";

/**
 * How many clicks of the armed drawing tool's draft are placed: a drawing
 * two-click tool (or Line chain) has its start, a fixed-point or fit-point
 * tool its placed points.
 */
function getPlacedClickCount(
  state: Pick<SketchToolRuntimeState, "status" | "placedPoints">,
) {
  return state.status === "drawing"
    ? Math.max(1, state.placedPoints?.length ?? 0)
    : 0;
}

/**
 * T13-D15: the live inference of the armed drawing tool's next click at
 * `point`, through the one owner: where it places and what its commit will
 * author. Null without a pointer or a drawing tool.
 */
export function previewSketchPlacement(
  session: SketchSessionState,
  point: SketchPoint | null,
): PlacementInference | null {
  if (!point || !isDrawingSketchTool(session.activeTool)) {
    return null;
  }

  const index = getPlacedClickCount({
    status: session.status === "drawing" ? "drawing" : "idle",
    placedPoints: session.toolPlacedPoints,
  });
  const toolDefinition = getSketchToolDefinition(session.activeTool);
  // R-7: a Tangent arc's first click picks its tangent source; the pick is
  // structural, so suppression keeps it (the owner frees the rest).
  const tangentSourcePick =
    Boolean(toolDefinition.structuralTangentSource) && index === 0;
  return inferPlacement({
    toolId: session.activeTool,
    role: toolDefinition.placementRole(index),
    ...(tangentSourcePick
      ? {
          tangentSource: {
            previousEntityId:
              session.activeInference?.tangentSourceEntityId ?? null,
          },
        }
      : {}),
    definition: session.definition,
    projectedReferences: session.projectedReferences,
    lineStartPointId:
      index === 1
        ? (session.toolStartPointId ??
          session.toolPlacements?.[0]?.requirements.find(
            (requirement) => requirement.kind === "joins",
          )?.pointId ??
          null)
        : null,
    pointer: point,
    solvedSnapshot: getSketchSessionDisplaySolvedSnapshot(session),
    exactIntersections: getSketchSessionSnapIntersections(session),
    sketchUnitsPerPixel: session.sketchUnitsPerPixel ?? null,
    anchor: session.status === "drawing" ? session.pointerDownPoint : null,
    activeCandidateKey: session.activeInference?.candidate?.key ?? null,
    suppressed: isSketchInferenceSuppressed(session),
  });
}

/**
 * T13-D22: records Shift held (`held`) or the "Snap & infer" toggle
 * (`inferenceEnabled`). Session UI state only: nothing is authored. When the
 * effective suppression changes, the live placement preview is recomputed
 * at the last pointer, with no pointer motion.
 */
export function setSketchInferenceSuppression(
  session: SketchSessionState,
  change: { held: boolean } | { inferenceEnabled: boolean },
): SketchSessionState {
  const next: SketchSessionState =
    "held" in change
      ? { ...session, inferenceSuppressionHeld: change.held }
      : { ...session, inferenceSuppressionToggled: !change.inferenceEnabled };
  if (
    Boolean(next.inferenceSuppressionHeld) ===
      Boolean(session.inferenceSuppressionHeld) &&
    Boolean(next.inferenceSuppressionToggled) ===
      Boolean(session.inferenceSuppressionToggled)
  ) {
    return session;
  }

  const pointer = session.activeInference?.rawPosition ?? null;
  return pointer &&
    isSketchInferenceSuppressed(next) !== isSketchInferenceSuppressed(session)
    ? updateSketchPointer(next, pointer)
    : next;
}

/**
 * T13i: the accepted live basis a snap query may run on while a drawing tool
 * is armed: the accepted live solve of the current definition (with offset
 * relationships, once its publication round is current, as for Trim).
 */
function getSnapQueryBasis(session: SketchSessionState) {
  const liveSolve = session.liveSolve;
  return isDrawingSketchTool(session.activeTool) &&
    liveSolve &&
    hasAcceptedLiveSolveOfDefinition(session) &&
    !(
      (session.definition.derivedRelationships ?? []).some(
        (relationship) => relationship.kind === "offset",
      ) && session.liveRegions.status === "pending"
    )
    ? liveSolve
    : null;
}

/** The stage of `cache`'s basis after `cutters` (A-3), or the ready cache. */
function nextSnapStage(
  cache: Omit<
    SketchSnapIntersectionCache,
    "queryId" | "input" | "status" | "stage"
  >,
  liveSolve: NonNullable<SketchSessionState["liveSolve"]>,
  modelingTolerance: number,
  stages: readonly ("curves" | "splines")[],
): SketchSnapIntersectionCache {
  for (const cutters of stages) {
    const targetEntityIds = getSketchSnapIntersectionTargets(
      liveSolve.definition,
      liveSolve.solvedSnapshot,
      modelingTolerance,
      cutters,
    );
    if (targetEntityIds.length > 0)
      return {
        ...cache,
        queryId: `snap-query-${crypto.randomUUID()}`,
        stage: cutters,
        status: "pending",
        input: {
          definition: liveSolve.definition,
          solvedSnapshot: liveSolve.solvedSnapshot,
          projectedReferences: liveSolve.projectedReferences,
          modelingTolerance,
          targetEntityIds,
          cutters,
        },
      };
  }
  return {
    ...cache,
    queryId: `snap-query-${crypto.randomUUID()}`,
    stage: null,
    status: "ready",
    input: null,
  };
}

/**
 * T13i (D24 with T13 review R-3): the spline intersection snap cache of the
 * accepted live basis (`getSnapQueryBasis`), planned once per basis while a
 * drawing tool is armed. A new basis replaces the cache with its first
 * pending stage (review A-3: spline × line/circle/arc first, then spline ×
 * spline; each stage's targets are `getSketchSnapIntersectionTargets`), or
 * a ready empty cache when no spline box meets another curve. Unchanged
 * otherwise.
 */
export function planSketchSnapIntersectionQuery(
  session: SketchSessionState,
): SketchSessionState {
  const liveSolve = getSnapQueryBasis(session);
  if (
    !liveSolve ||
    session.snapIntersections?.solvedSnapshot === liveSolve.solvedSnapshot
  ) {
    return session;
  }
  return {
    ...session,
    snapIntersections: nextSnapStage(
      { solvedSnapshot: liveSolve.solvedSnapshot, intersections: [] },
      liveSolve,
      session.modelingTolerance,
      ["curves", "splines"],
    ),
  };
}

/**
 * T13i: the pending stage the editor must issue: the current basis's
 * pending stage when it is not the query in flight (`inFlightQueryId`), e.g.
 * a new basis, the next stage, or a stage restored by Undo. Else null.
 */
export function getSketchSnapIntersectionQueryToIssue(
  session: SketchSessionState,
  inFlightQueryId: string | null,
): SketchSnapIntersectionCache | null {
  const cache = session.snapIntersections;
  return cache?.status === "pending" &&
    cache.queryId !== inFlightQueryId &&
    getSnapQueryBasis(session)?.solvedSnapshot === cache.solvedSnapshot
    ? cache
    : null;
}

/**
 * T13i: the results of the snap stage `queryId` (dropped unless it is the
 * cache's pending stage). Its intersections are offered at once (review
 * A-3: spline × line/circle/arc never wait for spline × spline); after the
 * `curves` stage the `splines` stage follows when there is one. The live
 * placement preview is recomputed at the last pointer, so a crossing
 * already hovered shows without pointer motion.
 */
export function completeSketchSnapIntersectionQuery(
  session: SketchSessionState,
  queryId: string,
  targets: readonly SketchSnapIntersectionTargetResult[],
): SketchSessionState {
  const cache = session.snapIntersections;
  if (!cache || cache.queryId !== queryId || cache.status !== "pending")
    return session;
  const published = {
    solvedSnapshot: cache.solvedSnapshot,
    intersections: [
      ...cache.intersections,
      ...getSketchExactIntersections(cache.input!.definition, targets),
    ],
  };
  const liveSolve = session.liveSolve;
  const next: SketchSessionState = {
    ...session,
    snapIntersections:
      cache.stage === "curves" &&
      liveSolve?.solvedSnapshot === cache.solvedSnapshot
        ? nextSnapStage(published, liveSolve, session.modelingTolerance, [
            "splines",
          ])
        : { ...cache, ...published, status: "ready" },
  };
  const pointer = session.activeInference?.rawPosition ?? null;
  return pointer ? updateSketchPointer(next, pointer) : next;
}

/** T13i: a failed snap query offers no spline intersections for its basis. */
export function failSketchSnapIntersectionQuery(
  session: SketchSessionState,
  queryId: string,
): SketchSessionState {
  const cache = session.snapIntersections;
  if (!cache || cache.queryId !== queryId || cache.status !== "pending")
    return session;
  return { ...session, snapIntersections: { ...cache, status: "failed" } };
}

export function startSketchDraw(
  session: SketchSessionState,
  point: SketchPoint,
): SketchSessionState {
  if (!isDrawingSketchTool(session.activeTool)) {
    return session;
  }
  const toolDefinition = getSketchToolDefinition(session.activeTool);
  const inference = previewSketchPlacement(session, point)!;
  const startPoint = inference.position;
  const result = toolDefinition.pointerRelease({
    state: {
      status: "idle",
      pointerDownPoint: null,
      livePoint: null,
      placedPoints: [],
      settings: session.toolSettings,
      validationMessage: null,
    } satisfies SketchToolRuntimeState,
    point: startPoint,
    tangentSource: toolDefinition.structuralTangentSource
      ? getTangentArcSourceDirection(session.definition, inference.tangentSourceEntityId ?? null, startPoint, getSketchSessionDisplaySolvedSnapshot(session))
      : null,
  });
  // A draft started from idle never continues a chain (review R-1).
  const fresh: SketchSessionState = {
    ...session,
    toolChain: null,
    toolStartPointId: null,
    toolPlacements: [],
    // R-7: a Tangent arc records its tangent source at its first click.
    toolTangentSourceEntityId: inference.tangentSourceEntityId ?? null,
  };

  // A one-click tool (Point, T11-D19) completes on its first release.
  if (
    result.state.status === "idle" &&
    result.state.validationMessage === null
  ) {
    return commitSketchDraw(
      fresh,
      toolDefinition,
      result,
      startPoint,
      startPoint,
      [inference],
    );
  }

  const placements = getPlacedClickCount(result.state) > 0 ? [inference] : [];
  return {
    ...fresh,
    status: result.state.status,
    pointerDownPoint: result.state.pointerDownPoint,
    livePoint: result.state.livePoint,
    toolPlacedPoints: result.state.placedPoints ?? session.toolPlacedPoints,
    toolSettings: result.state.settings ?? session.toolSettings,
    toolStagedEntities: withConstructionFlag(
      result.stagedEntities,
      session.constructionModifierActive,
    ),
    toolPresentation: withPlacementPresentation(
      result.presentation,
      placements,
      placements.length > 0 ? null : inference,
    ),
    activeInference: inference,
    toolPlacements: placements,
  };
}

export function acceptSketchDraw(
  session: SketchSessionState,
  point: SketchPoint,
): SketchSessionState {
  if (
    !isDrawingSketchTool(session.activeTool) ||
    session.pointerDownPoint === null
  ) {
    return session;
  }

  const startPoint = session.pointerDownPoint;
  const toolDefinition = getSketchToolDefinition(session.activeTool);
  // The release commits the inference the preview shows at the (flushed)
  // release point, with the same hysteresis state (D15).
  const inference = previewSketchPlacement(session, point)!;
  const endPoint = inference.position;
  const runtimeState = getToolRuntimeState(session);
  const result = toolDefinition.pointerRelease({
    state: runtimeState,
    point: endPoint,
  });
  const previousPlacements = session.toolPlacements ?? [];
  // An ignored or refused release places nothing.
  const placed =
    getPlacedClickCount(result.state) > getPlacedClickCount(runtimeState);
  const placements = placed
    ? [...previousPlacements, inference]
    : previousPlacements;

  if (result.state.validationMessage || result.state.status !== "idle") {
    return {
      ...session,
      toolStagedEntities: result.state.validationMessage
        ? []
        : withConstructionFlag(
            result.stagedEntities,
            session.constructionModifierActive,
          ),
      status: result.state.status,
      pointerDownPoint: result.state.pointerDownPoint,
      livePoint: result.state.livePoint,
      toolPlacedPoints: result.state.placedPoints ?? session.toolPlacedPoints,
      toolSettings: result.state.settings ?? session.toolSettings,
      toolPresentation: withPlacementPresentation(
        result.presentation,
        placements,
        placed ? null : inference,
      ),
      activeInference: inference,
      toolPlacements: placements,
    };
  }

  return commitSketchDraw(
    session,
    toolDefinition,
    result,
    startPoint,
    endPoint,
    [...previousPlacements, inference],
  );
}

/**
 * Commits a completed draw as one definition change. The release `result`
 * completed the tool; `placements` are the inferences of every placed click
 * (the last one the release's), which the commit binds unchanged (D15). A
 * Line chain segment starts structurally at `toolStartPointId` (D20).
 */
function commitSketchDraw(
  session: SketchSessionState,
  toolDefinition: SketchToolDefinition,
  result: SketchToolPointerResult,
  startPoint: SketchPoint,
  endPoint: SketchPoint,
  placements: readonly PlacementInference[],
): SketchSessionState {
  const prepared = prepareSketchContribution(session, toolDefinition, {
    start: startPoint,
    end: endPoint,
    points: result.state.placedPoints ?? [startPoint, endPoint],
    settings: result.state.settings ?? session.toolSettings,
    placements,
  });
  const { definitionPatch } = prepared;
  const committed: SketchSessionState = {
    ...prepared.session,
    toolStagedEntities: [],
    status: result.state.status,
    pointerDownPoint: result.state.pointerDownPoint,
    livePoint: result.state.livePoint,
    toolPlacedPoints: result.state.status === "idle" ? [] : (result.state.placedPoints ?? session.toolPlacedPoints),
    toolSettings: result.state.status === "idle" ? {} : (result.state.settings ?? session.toolSettings),
    // Keep the withheld status until the new region result decides; unavailable
    // commits have no region result and retain the previous clearing behavior.
    validationMessage: prepared.session.liveRegions.status === "unavailable"
      ? null : keptSketchWithheldRegionText(session),
    toolPresentation: result.presentation,
    activeAnnotationEdit: null,
    activeEditTool: null,
    activeEditTarget: null,
    activeDrag: null,
    activeInference: null,
    toolPlacements: [],
    toolStartPointId: null,
    toolTangentSourceEntityId: null,
  };
  return toolDefinition.lifecycle === "chain"
    ? continueSketchToolChain(session, committed, definitionPatch, startPoint)
    : committed;
}

/** Shared contribution/identity/inference preparation, independent of pointer lifecycle. */
export function prepareSketchContribution(
  session: SketchSessionState,
  toolDefinition: SketchToolDefinition,
  input: { start: SketchPoint; end: SketchPoint; points: readonly SketchPoint[]; settings: SketchToolRuntimeState["settings"]; placements: readonly PlacementInference[] | null },
) {
  const nextSequence = session.sequence + 1;
  const sketchId = session.sketchId ?? ("sketch_draft" as SketchId);
  const baseDefinitionPatch = toolDefinition.createCommitContribution({
    sequence: nextSequence,
    start: input.start,
    end: input.end,
    points: input.points,
    settings: input.settings ?? {},
    isConstruction: session.constructionModifierActive,
    tangentSourceEntityId: session.toolTangentSourceEntityId ?? null,
    factories: createSessionCommitFactories(nextSequence, sketchId, session.constructionModifierActive),
  });
  const structuralStartPointId = session.toolStartPointId ?? null;
  const definitionPatch = input.placements === null ? baseDefinitionPatch : bindPlacementInferences({
    patch: baseDefinitionPatch,
    placements: structuralStartPointId ? [null, ...input.placements] : input.placements,
    structuralStartPointId,
    sequence: nextSequence,
    createConstraintId: (suffix) => createConstraintId(nextSequence, suffix),
  });
  const { definition } = applySketchContribution(session, definitionPatch);
  const next = { ...session, definition, sequence: nextSequence, commitRequest: buildCommitRequest({ sketchId: session.sketchId, sketchLabel: session.sketchLabel, plane: session.plane, definition }) };
  return { definitionPatch, session: withLiveSolveBasis(next, definition) };
}

/** A completed semantic intent enters this helper only inside the authored-action transition. */
export function authorSketchPrimitive(session: SketchSessionState, primitive: import("@/contracts/semantic/schema").SemanticSketchPrimitive, construction: boolean): SketchSessionState {
  const tool = getSketchToolDefinition(primitive.kind);
  const input = sketchPrimitiveContributionInput(primitive);
  const prepared = prepareSketchContribution({ ...session, constructionModifierActive: construction, toolStartPointId: null, toolTangentSourceEntityId: primitive.kind === "tangentArc" ? primitive.source?.entityId ?? null : null }, tool, input);
  return { ...prepared.session, constructionModifierActive: session.constructionModifierActive };
}

/**
 * After a committed chain segment (T11-D11): the chain continues from the
 * segment's end point, whose id the next segment reuses. A new commit after
 * Undo first drops the records past the committed prefix (T11-D12). A
 * segment ending on the chain's own first point closes the loop: the chain
 * ends and the tool stays armed (Q1).
 */
function continueSketchToolChain(
  before: SketchSessionState,
  committed: SketchSessionState,
  patch: SketchToolCommitContribution,
  startPosition: SketchPoint,
): SketchSessionState {
  const segment = patch.entities.find(
    (entity) => entity.kind === "lineSegment",
  );
  if (segment?.kind !== "lineSegment") {
    return committed;
  }

  const prefix = before.toolChain
    ? getCommittedSketchToolChainSegments(before.toolChain, before.definition)
    : [];
  const start =
    before.toolChain && prefix.length > 0
      ? before.toolChain.start
      : { pointId: segment.startPointId, position: startPosition };

  if (segment.endPointId === start.pointId) {
    return { ...committed, toolChain: null };
  }

  return restageSketchToolChain(committed, {
    start,
    segments: [
      ...prefix,
      {
        entityId: segment.entityId,
        startPointId: segment.startPointId,
        endPointId: segment.endPointId,
      },
    ],
  });
}

/**
 * Stores the screen scale a sketch pointer event measured (T13-D13); snapping
 * resolves against the latest one, and `null` disables it.
 */
export function setSketchSnapScale(
  session: SketchSessionState,
  sketchUnitsPerPixel: number | null,
): SketchSessionState {
  return (session.sketchUnitsPerPixel ?? null) === sketchUnitsPerPixel
    ? session
    : { ...session, sketchUnitsPerPixel };
}

export function getToolRuntimeState(
  session: SketchSessionState,
): import("@/core/sketch-tools/definition").SketchToolRuntimeState {
  return {
    status: session.status === "drawing" ? "drawing" : "idle",
    pointerDownPoint: session.pointerDownPoint,
    livePoint: session.livePoint,
    placedPoints: session.toolPlacedPoints,
    settings: session.toolSettings,
    validationMessage: session.toolPresentation?.validation?.[0]?.message ?? null,
  };
}

export function getSketchSessionPreviewLabel(
  session: SketchSessionState,
): string {
  if (session.activeAnnotationEdit) {
    return (
      session.toolPresentation?.prompts[0]?.text ?? "Edit annotation value"
    );
  }

  if (session.activeSpecialMode) {
    return "Sketch special mode active";
  }

  if (session.constraintAuthoring) {
    const definition = getSketchConstraintDefinition(
      session.constraintAuthoring.toolId,
    );
    const valueSpec =
      definition.getValueSpec?.(session.constraintAuthoring.selectedTargets) ??
      definition.valueSpec;

    if (session.status === "awaitingValue") {
      return session.constraintAuthoring.isPreviewPinned
        ? `Enter ${valueSpec?.label.toLowerCase() ?? "value"}`
        : `Place ${valueSpec?.label.toLowerCase() ?? "value"} annotation`;
    }

    const step =
      definition.steps[
        Math.min(
          session.constraintAuthoring.selectedTargets.length,
          definition.steps.length - 1,
        )
      ];

    return step?.label ?? definition.metadata.name;
  }

  const primaryPrompt =
    session.toolPresentation?.validation?.[0]?.message ??
    session.toolPresentation?.prompts[0]?.text;

  if (primaryPrompt) {
    return primaryPrompt;
  }

  if (session.validationMessage) {
    return session.validationMessage;
  }

  if (session.projectionDiagnostics.length > 0) {
    return (
      session.projectionDiagnostics[0]?.message ??
      "Sketch reference projection has diagnostics"
    );
  }

  // T13c (R-2): the conflict explanation first, else the first non-info
  // region/validity diagnostic.
  const invalidFeedback = getSketchSessionInvalidFeedback(session);
  if (invalidFeedback) {
    return invalidFeedback;
  }

  if (session.activeDrag?.status === "dragging") {
    return "Dragging sketch point";
  }

  if (session.activeEditTarget) {
    return "Sketch point selected";
  }

  if (session.activeStyleFocus) {
    return session.activeStyleFocus.target
      ? "Sketch style controls active"
      : "Select sketch geometry to edit style";
  }

  if (session.constructionTargetPicking) {
    return "Select sketch geometry to toggle construction";
  }

  if (session.activeTool === null) {
    return session.definition.entityIds.length > 0
      ? `Sketch has ${session.definition.entityIds.length} authored entities`
      : "Sketch session ready";
  }

  if (session.status === "drawing") {
    return `${session.activeTool} preview active, click again to accept`;
  }

  return `Ready to place ${session.activeTool}, click to set first point`;
}

export function getSketchToolPresentation(
  session: SketchSessionState,
): SketchToolPresentationSchema | null {
  if (session.activeSpecialMode) {
    return null;
  }

  if (session.activeAnnotationEdit) {
    return session.toolPresentation;
  }

  if (session.activeTool === "construction") {
    return session.toolPresentation;
  }

  if (session.constraintAuthoring) {
    return session.toolPresentation;
  }

  if (session.activeEditTool) {
    return session.toolPresentation;
  }

  if (session.activeStyleFocus) {
    return buildSketchStylePresentation(
      session.activeStyleFocus,
      getSketchStyleTargetDefinition(session, session.activeStyleFocus.target)
        ?.style,
    );
  }

  if (!isDrawingSketchTool(session.activeTool)) {
    if (!session.activeEditTarget) {
      const overlays = buildCommittedDimensionOverlays(
        session,
        session.definition,
      );
      return overlays.length > 0 ? { prompts: [], overlays } : null;
    }

    const overlays = buildCommittedDimensionOverlays(
      session,
      session.definition,
    );
    return overlays.length > 0 ? { prompts: [], overlays } : null;
  }

  const presentation =
    session.toolPresentation ??
    getSketchToolDefinition(session.activeTool).getPresentation(
      getToolRuntimeState(session),
    );
  // T13-D22: every drawing tool shows the visible suppression control.
  const inferenceEnabled = !session.inferenceSuppressionToggled;
  const cached = snapInferencePresentations.get(presentation);
  if (cached?.inferenceEnabled === inferenceEnabled) {
    return cached.presentation;
  }
  const withToggle: SketchToolPresentationSchema = {
    ...presentation,
    controls: [
      ...(presentation.controls ?? []),
      {
        id: "sketch-snap-inference",
        kind: "toggle",
        label: "Snap & infer",
        hint: "Hold Shift to place freely",
        value: inferenceEnabled,
        action: { type: "patch", patch: { intent: "setSnapInference" } },
      },
    ],
  };
  snapInferencePresentations.set(presentation, {
    inferenceEnabled,
    presentation: withToggle,
  });
  return withToggle;
}

/**
 * The toggle-augmented presentation per session presentation, so a render
 * that reads it twice gets the same object (the viewport keys feedback
 * projection on its identity).
 */
const snapInferencePresentations = new WeakMap<
  SketchToolPresentationSchema,
  {
    inferenceEnabled: boolean;
    presentation: SketchToolPresentationSchema;
  }
>();

export function patchSketchDrawingToolValue(
  session: SketchSessionState,
  patch: Record<string, unknown>,
): SketchSessionState {
  if (
    !isDrawingSketchTool(session.activeTool) ||
    patch.intent !== "setToolSetting"
  ) {
    return session;
  }

  const key = typeof patch.key === "string" ? patch.key : null;
  if (!key) {
    return session;
  }

  const nextSettings = {
    ...session.toolSettings,
    [key]: (patch.value ?? null) as SketchToolControlValue,
  };
  const toolDefinition = getSketchToolDefinition(session.activeTool);
  const runtimeState = {
    ...getToolRuntimeState(session),
    settings: nextSettings,
  };

  return {
    ...session,
    toolSettings: nextSettings,
    toolStagedEntities: withConstructionFlag(
      toolDefinition.getStagedEntities(runtimeState),
      session.constructionModifierActive,
    ),
    // The placed clicks keep their badges (T13g review RQ-1).
    toolPresentation: withPlacementPresentation(
      toolDefinition.getPresentation(runtimeState),
      session.toolPlacements ?? [],
      null,
    ),
  };
}
