import type { SketchSessionState, SketchEditToolState } from "./types";
import {
  restageSketchMirrorRepair,
  buildSketchMirrorPresentation,
  hoverSketchMirrorRepair,
  selectSketchMirrorRepairTarget,
} from "./mirror-editing";
import {
  isSketchEditQueryTool,
  advanceSketchEditQueryQueue,
  editSelectionMessage,
  applySketchEditOperationResult,
  stageSketchTrimHover,
  editQueryClick,
  queueSketchEditQueryClick,
  selectSketchEditQueryTargets,
} from "./edit-queries";
import {
  buildSketchEditToolPresentation,
  getSketchEditToolValueLabel,
} from "./edit-tool-activation";
import {
  getOffsetPreview,
  stageOffsetPreviewPublication,
  withoutOffsetPublication,
  commitOffsetContribution,
  withOffsetPublication,
} from "./offset-editing";
import {
  getSketchEditOperatorResult,
  getSelectedSketchEntityIds,
} from "./edit-geometry-operations";
import { mirrorEditRefusal } from "@/core/sketch-editing/operations";
import type { SketchEditOperationResult } from "@/core/sketch-editing/operations";
import { withSketchToolValidation } from "./session-definition";
import { withLiveSolveBasis } from "./session-live-solve";
import { primitiveRefEquals } from "@/core/editor/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  buildSketchMergePointsPresentation,
  selectSketchMergePointsTarget,
  commitSketchMergePoints,
  withSketchMergePointsTool,
} from "./point-merge";
import { getSketchEditToolDefinition } from "@/core/sketch-edit-tools/registry";
import { parseOperationParameter } from "./tool-authoring";

/**
 * T10i review R-1: re-evaluates the active edit tool's current selection
 * after an offset publication round settles (the editor applies it to
 * every live-region result, published or failed), so a "still being
 * checked" input clears or becomes its decided refusal without reselection.
 * Only the preview, message and presentation change: nothing is applied
 * (no Mirror confirm, no Commit). An Offset with a staged
 * check keeps it (its own completion re-checks the seeds); one without
 * (refused or still checking) re-stages its preview, whose check the
 * editor loop then emits. The edit-query tools (Trim, Extend, Split)
 * advance their queued clicks instead (T10g-1, review R-1: a click deferred
 * while the round was pending is queried now); an Extend/Split selection
 * still being made only has its message re-evaluated.
 */
export function refreshSketchEditToolAfterOffsetRound(
  session: SketchSessionState,
): SketchSessionState {
  const tool = session.activeEditTool;
  // T13j: a merge does not read offset publications.
  if (tool?.toolId === "sketchMergePoints") return session;
  // T16e: a repair re-judges its candidate (the gate may have decided).
  if (tool?.repair) return restageSketchMirrorRepair(session);
  if (tool && isSketchEditQueryTool(tool.toolId)) {
    const advanced = advanceSketchEditQueryQueue(session);
    if (tool.selectedTargets.length === 0) return advanced;
    const message =
      editSelectionMessage(advanced, advanced.activeEditTool!) ??
      advanced.toolPresentation?.validation?.[0]?.message ?? null;
    return {
      ...advanced,
      toolPresentation: buildSketchEditToolPresentation(
        advanced.activeEditTool!,
        message,
      ),
    };
  }
  if (!tool || tool.selectedTargets.length === 0) return session;
  // Parsing collapses nonnumeric text to null, so retain that specific error.
  // Other errors are recomputed: a failed round must replace a pending gate.
  const parseMessage = `Enter a number for the ${getSketchEditToolValueLabel(tool.toolId).toLowerCase()}.`;
  const retainedValueMessage =
    session.toolPresentation?.validation?.[0]?.message === parseMessage
      ? parseMessage
      : null;
  if (tool.toolId === "offset") {
    if (tool.offsetPublication) return session;
    const preview = getOffsetPreview(session, tool);
    if (!preview.valid)
      return withInvalidSketchEditValue(
        session,
        tool,
        retainedValueMessage ?? preview.message,
      );
    return {
      ...session,
      activeEditTool: stageOffsetPreviewPublication(session, tool, preview),
      toolStagedEntities: preview.previewEntities,
      toolPresentation: buildSketchEditToolPresentation(
        tool,
        preview.message,
        preview.previewEntities,
      ),
    };
  }
  const preview = getSketchEditOperatorResult(session, tool);
  if (!preview.valid && tool.toolId !== "sketchMirror")
    return withInvalidSketchEditValue(
      session,
      tool,
      retainedValueMessage ?? preview.message,
    );
  return {
    ...session,
    toolStagedEntities: preview.previewEntities,
    toolPresentation:
      tool.toolId === "sketchMirror"
        ? buildSketchMirrorPresentation(session, tool, preview.message, preview)
        : buildSketchEditToolPresentation(
            tool,
            preview.message,
            preview.previewEntities,
          ),
  };
}

/** Both semantic construction and browser confirmation use this solve-basis handoff. */
export function completeSketchEditOperation(
  session: SketchSessionState,
  result: SketchEditOperationResult,
): SketchSessionState {
  if (!result.valid) return session.activeEditTool
    ? withSketchToolValidation(session, result.message)
    : { ...session, validationMessage: result.message };
  const applied = applySketchEditOperationResult(session, result);
  return applied ? withLiveSolveBasis({
    ...session,
    ...applied,
    toolStagedEntities: [],
    validationMessage: null,
    activeEditTarget: null,
    activeDrag: null,
  }, applied.definition) : session;
}

export function updateSketchEditToolHover(
  session: SketchSessionState,
  target: PrimitiveRef | null,
): SketchSessionState {
  if (!session.activeEditTool) {
    return session;
  }

  const activeEditTool = {
    ...session.activeEditTool,
    hoverTarget: target,
  };
  if (activeEditTool.toolId === "trim")
    return stageSketchTrimHover({ ...session, activeEditTool });
  if (activeEditTool.repair)
    return hoverSketchMirrorRepair(session, {
      ...activeEditTool,
      repair: activeEditTool.repair,
    });
  if (activeEditTool.toolId === "sketchMergePoints")
    return {
      ...session,
      activeEditTool,
      toolPresentation: buildSketchMergePointsPresentation(
        session,
        activeEditTool,
        session.toolPresentation?.validation?.[0]?.message ?? null,
      ),
    };
  const preview =
    activeEditTool.toolId === "offset"
      ? getOffsetPreview(session, activeEditTool)
      : isSketchEditQueryTool(activeEditTool.toolId)
        ? null
        : getSketchEditOperatorResult(session, activeEditTool);

  return {
    ...session,
    activeEditTool,
    toolPresentation:
      activeEditTool.toolId === "sketchMirror"
        ? buildSketchMirrorPresentation(
            session,
            activeEditTool,
            session.toolPresentation?.validation?.[0]?.message ?? null,
            preview ?? getSketchEditOperatorResult(session, activeEditTool),
          )
        : buildSketchEditToolPresentation(
            activeEditTool,
            session.toolPresentation?.validation?.[0]?.message ?? null,
            preview?.valid === false
              ? session.toolStagedEntities
              : preview?.previewEntities ?? [],
          ),
  };
}

export function selectSketchEditToolTarget(
  session: SketchSessionState,
  target: PrimitiveRef,
): SketchSessionState {
  const activeEditTool = session.activeEditTool;
  if (!activeEditTool) {
    return session;
  }

  if (activeEditTool.toolId === "sketchMergePoints")
    return selectSketchMergePointsTarget(session, activeEditTool, target);

  if (activeEditTool.repair)
    return selectSketchMirrorRepairTarget(
      session,
      { ...activeEditTool, repair: activeEditTool.repair },
      target,
    );

  if (activeEditTool.toolId === "trim") {
    if (target.kind !== "sketchEntity") {
      return session;
    }
    const click = editQueryClick(session, target.entityId, null);
    const tool = activeEditTool.editQuery?.queue[0]?.preview
      ? { ...activeEditTool, editQuery: { queue: [], inFlight: null } } : activeEditTool;
    return click
      ? queueSketchEditQueryClick({ ...session, toolStagedEntities: [] }, tool, click)
      : session;
  }

  if (
    activeEditTool.toolId === "offset" &&
    target.kind !== "sketchEntity" &&
    target.kind !== "projectedReferenceGeometry"
  ) {
    return session;
  }

  if (activeEditTool.toolId === "offset") {
    const nextSelectedTargets = activeEditTool.selectedTargets.some(
      (selected) => primitiveRefEquals(selected, target),
    )
      ? activeEditTool.selectedTargets.filter(
          (selected) => !primitiveRefEquals(selected, target),
        )
      : [...activeEditTool.selectedTargets, target];
    const nextEditTool = {
      ...activeEditTool,
      selectedTarget: nextSelectedTargets[0] ?? null,
      selectedTargets: nextSelectedTargets,
      hoverTarget: null,
    };
    const preview = getOffsetPreview(session, nextEditTool);
    const stagedEditTool = stageOffsetPreviewPublication(
      session,
      nextEditTool,
      preview,
    );

    return {
      ...session,
      activeEditTool: stagedEditTool,
      toolStagedEntities: preview.previewEntities,
      toolPresentation: buildSketchEditToolPresentation(
        nextEditTool,
        preview.message,
        preview.previewEntities,
      ),
    };
  }

  // T15b (T-7): Sketch Mirror also takes a sketch datum axis as its axis.
  const isMirrorDatumAxis =
    activeEditTool.toolId === "sketchMirror" &&
    target.kind === "sketchDatumReference" &&
    target.datumId !== "origin";
  if (target.kind !== "sketchEntity" && !isMirrorDatumAxis) {
    const message = getSketchEditToolDefinition(activeEditTool.toolId).metadata
      .validationMessages.unsupportedTarget;
    return {
      ...session,
      // T16d review R-1: a staged Mirror keeps its popup next to the message.
      toolPresentation:
        activeEditTool.toolId === "sketchMirror"
          ? buildSketchMirrorPresentation(
              session,
              activeEditTool,
              message,
              getSketchEditOperatorResult(session, activeEditTool),
            )
          : buildSketchEditToolPresentation(activeEditTool, message),
    };
  }

  const metadata = getSketchEditToolDefinition(activeEditTool.toolId).metadata;
  const isSelected = activeEditTool.selectedTargets.some((selected) =>
    primitiveRefEquals(selected, target),
  );
  // T16a (review A-7, as B7): Fillet and Chamfer refuse a mirror seed or
  // copy at its own pick, which is not kept; earlier picks and the tool stay.
  const filletLike =
    activeEditTool.toolId === "sketchFillet"
      ? "fillet"
      : activeEditTool.toolId === "sketchChamfer"
        ? "chamfer"
        : null;
  const pickRefusal =
    filletLike && !isSelected && target.kind === "sketchEntity"
      ? mirrorEditRefusal(
          session.definition,
          [{ kind: "entity", entityId: target.entityId }],
          filletLike,
        )
      : null;
  if (pickRefusal)
    return {
      ...session,
      toolStagedEntities: [],
      toolPresentation: buildSketchEditToolPresentation(
        activeEditTool,
        pickRefusal,
      ),
    };
  const nextSelectedTargets = isSelected
    ? activeEditTool.selectedTargets.filter(
        (selected) => !primitiveRefEquals(selected, target),
      )
    : metadata.selection.allowsMultiple ||
        activeEditTool.selectedTargets.length < metadata.selection.requiredCount
      ? [...activeEditTool.selectedTargets, target]
      : // cadara-h026.2: past an adopted superset, too.
        [
          ...activeEditTool.selectedTargets.slice(
            activeEditTool.selectedTargets.length -
              metadata.selection.requiredCount +
              1,
          ),
          target,
        ];
  const nextEditTool = {
    ...activeEditTool,
    selectedTarget: nextSelectedTargets[0] ?? null,
    selectedTargets: nextSelectedTargets,
    hoverTarget: null,
  };
  if (isSketchEditQueryTool(nextEditTool.toolId))
    return selectSketchEditQueryTargets(session, nextEditTool);
  const preview = getSketchEditOperatorResult(session, nextEditTool);

  // T16d ([TECH] T16-21): every Mirror pick re-stages (the last line or
  // datum is the axis candidate); only Confirm or Enter commits.
  return {
    ...session,
    activeEditTool: nextEditTool,
    toolStagedEntities: preview.previewEntities,
    toolPresentation:
      nextEditTool.toolId === "sketchMirror"
        ? buildSketchMirrorPresentation(
            session,
            nextEditTool,
            preview.message,
            preview,
          )
        : buildSketchEditToolPresentation(
            nextEditTool,
            preview.message,
            preview.previewEntities,
          ),
  };
}

// An invalid intermediate number must not remove the preview: its anchor
// keeps the focused floating input on screen while the user types (O29).
// Keep the invalid parameter for commit validation, but discard any old
// offset publication so it cannot certify/commit the previous valid value.
function withInvalidSketchEditValue(
  session: SketchSessionState,
  tool: SketchEditToolState,
  message: string | null,
): SketchSessionState {
  const nextEditTool = withoutOffsetPublication(tool);
  return {
    ...session,
    activeEditTool: nextEditTool,
    toolPresentation: buildSketchEditToolPresentation(
      nextEditTool,
      message,
      session.toolStagedEntities,
    ),
  };
}

export function patchSketchEditToolValue(
  session: SketchSessionState,
  patch: Record<string, unknown>,
): SketchSessionState {
  const activeEditTool = session.activeEditTool;
  if (!activeEditTool) {
    return session;
  }

  if (activeEditTool.toolId !== "offset") {
    return patchSketchEditOperatorValue(session, activeEditTool, patch);
  }

  if (patch.intent === "cancelOffset") {
    const tool = withoutOffsetPublication(activeEditTool);
    const nextEditTool = {
      ...tool,
      selectedTarget: null,
      selectedTargets: [],
    };

    return {
      ...session,
      activeEditTool: nextEditTool,
      toolStagedEntities: [],
      toolPresentation: buildSketchEditToolPresentation(nextEditTool),
    };
  }

  if ("value" in patch && patch.intent !== "commitOffset") {
    const distance =
      patch.intent === "setOffsetSide"
        ? null
        : parseOperationParameter(
            patch.value,
            getSketchEditToolValueLabel("offset").toLowerCase(),
          );
    const nextEditTool = {
      ...activeEditTool,
      offsetDistance: distance ? distance.value : activeEditTool.offsetDistance,
      offsetSide:
        patch.intent === "setOffsetSide" &&
        (patch.value === "left" || patch.value === "right")
          ? patch.value
          : activeEditTool.offsetSide,
    };
    const preview = getOffsetPreview(session, nextEditTool);
    if (distance?.message || !preview.valid)
      return withInvalidSketchEditValue(
        session,
        nextEditTool,
        distance?.message ?? preview.message,
      );
    const stagedEditTool = stageOffsetPreviewPublication(
      session,
      nextEditTool,
      preview,
    );

    return {
      ...session,
      activeEditTool: stagedEditTool,
      toolStagedEntities: preview.previewEntities,
      toolPresentation: buildSketchEditToolPresentation(
        nextEditTool,
        distance?.message ?? preview.message,
        preview.previewEntities,
      ),
    };
  }

  if (patch.intent !== "commitOffset") {
    return session;
  }

  // U-G3: a derived offset commits only its certified preview, exactly.
  const staged = activeEditTool.offsetPublication;
  if (staged) {
    if (staged.status === "certified")
      return commitOffsetContribution(
        session,
        activeEditTool,
        staged.contribution,
      );
    return withOffsetPublication(session, activeEditTool, {
      ...staged,
      commitRequested: staged.status === "pending",
    });
  }

  const preview = getOffsetPreview(session, activeEditTool);
  if (!preview.valid || !preview.contribution) {
    return withInvalidSketchEditValue(session, activeEditTool, preview.message);
  }

  const stagedEditTool = stageOffsetPreviewPublication(
    session,
    activeEditTool,
    preview,
  );
  if (stagedEditTool.offsetPublication)
    return withOffsetPublication(
      { ...session, toolStagedEntities: preview.previewEntities },
      stagedEditTool,
      {
        ...stagedEditTool.offsetPublication,
        commitRequested: stagedEditTool.offsetPublication.status === "pending",
      },
    );
  // The static one-shot projected offset (D6) has no derivation to certify.
  return commitOffsetContribution(
    session,
    activeEditTool,
    preview.contribution,
  );
}

function patchSketchEditOperatorValue(
  session: SketchSessionState,
  activeEditTool: SketchEditToolState,
  patch: Record<string, unknown>,
): SketchSessionState {
  if (activeEditTool.toolId === "sketchMergePoints") {
    if (patch.intent === "mergePoints")
      return commitSketchMergePoints(session, activeEditTool);
    if (patch.intent !== "cancelSketchEditOperator") return session;
    // Cancel authors nothing: the picks are dropped and the tool stays armed.
    return withSketchMergePointsTool(
      session,
      { ...activeEditTool, selectedTarget: null, selectedTargets: [] },
      null,
    );
  }

  if (patch.intent === "cancelSketchEditOperator") {
    const nextEditTool = {
      ...activeEditTool,
      selectedTarget: null,
      selectedTargets: [],
    };

    return {
      ...session,
      activeEditTool: nextEditTool,
      toolStagedEntities: [],
      toolPresentation: buildSketchEditToolPresentation(nextEditTool),
    };
  }

  // T16d: the Mirror tool's one confirm (popup Mirror, Enter) is its own
  // intent, so the action is labelled "Mirror".
  const commitIntent =
    activeEditTool.toolId === "sketchMirror"
      ? "createMirror"
      : "commitSketchEditOperator";

  if ("value" in patch && patch.intent !== commitIntent) {
    const value = parseOperationParameter(
      patch.value,
      getSketchEditToolValueLabel(activeEditTool.toolId).toLowerCase(),
    );
    const nextEditTool = { ...activeEditTool, toolValue: value.value };
    const preview = getSketchEditOperatorResult(session, nextEditTool);
    if (value.message || !preview.valid)
      return withInvalidSketchEditValue(
        session,
        nextEditTool,
        value.message ?? preview.message,
      );

    return {
      ...session,
      activeEditTool: nextEditTool,
      toolStagedEntities: preview.previewEntities,
      toolPresentation: buildSketchEditToolPresentation(
        nextEditTool,
        value.message ?? preview.message,
        preview.previewEntities,
      ),
    };
  }

  if (patch.intent !== commitIntent) {
    return session;
  }

  // T10g-2: Extend/Split commit a complete selection as its click (an
  // incomplete one, e.g. already queued, commits nothing).
  if (isSketchEditQueryTool(activeEditTool.toolId))
    return getSelectedSketchEntityIds(activeEditTool).length === 2
      ? selectSketchEditQueryTargets(session, activeEditTool)
      : session;

  const preview = getSketchEditOperatorResult(session, activeEditTool);
  if (!preview.valid) {
    return withInvalidSketchEditValue(session, activeEditTool, preview.message);
  }

  const nextEditTool = {
    ...activeEditTool,
    selectedTarget: null,
    selectedTargets: [],
  };

  return {
    ...completeSketchEditOperation(session, preview),
    activeEditTool: nextEditTool,
    toolPresentation: buildSketchEditToolPresentation(nextEditTool),
  };
}
