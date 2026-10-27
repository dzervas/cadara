import type {
  SketchToolPresentationSchema,
  SketchToolAnchorDescriptor,
} from "@/core/sketch-tools/editor-schema";
import type { SketchSessionState, SketchEditToolState } from "./types";
import { isSketchConstructionSelected } from "./state";
import {
  clearActiveSketchTool,
  keptSketchStatusText,
} from "./drawing-tool-lifecycle";
import type { SketchDraftEntity } from "@/core/sketch-tools/definition";
import { getSketchEditToolDefinition } from "@/core/sketch-edit-tools/registry";
import type { SketchPoint } from "@/contracts/modeling/schema";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import type { SketchEntityId } from "@/contracts/shared/ids";
import type {
  SketchEditToolSelectionRequirement,
  SketchEditToolId,
} from "@/core/sketch-edit-tools/definition";
import { primitiveRefEquals } from "@/core/editor/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import { getSketchSelectedLineCorners } from "@/domain/sketch-editing/operations";
import { getSketchEditOperatorResult } from "./edit-geometry-operations";
import { selectSketchEditToolTarget } from "./edit-tool-interaction";
import { resolveSketchConstraintTarget } from "@/core/sketch-constraints/registry";
import {
  activateSketchConstraintTool,
  authorSketchConstraintTarget,
} from "./constraints";
import { getSessionSketchId } from "./tool-authoring";

function buildConstructionTargetPresentation(): SketchToolPresentationSchema {
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

function getPreviewAnchor(
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

function midpointSketchPoints(
  left: SketchPoint,
  right: SketchPoint,
): SketchPoint {
  return [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
}

function getSketchEditSelectionKindForEntity(
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

function getSketchEditSelectionKindForProjectedGeometry(
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

function canAppendSketchEditToolActivationTarget(
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
