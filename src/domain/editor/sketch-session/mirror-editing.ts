import type {
  SketchSessionState,
  SketchEditToolState,
  SketchMirrorRepairState,
} from "./types";
import type { SketchDraftEntity } from "@/core/sketch-tools/definition";
import type { SketchPoint } from "@/contracts/modeling/schema";
import { createSketchEntityPreviewEntities } from "@/domain/sketch-editing/operations";
import type { SketchEditOperationResult } from "@/domain/sketch-editing/operations";
import type { SketchToolPresentationSchema } from "@/core/sketch-tools/editor-schema";
import { buildSketchEditToolPresentation } from "./edit-tool-activation";
import { getSketchEditOperatorResult } from "./edit-geometry-operations";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  replaceMirrorOriginal,
  replaceMirrorLine,
} from "@/core/sketch-editing/mirror-repair";
import type { MirrorReplacement } from "@/core/sketch-editing/mirror-repair";
import type { SketchEntityId } from "@/contracts/shared/ids";
import { offsetEditInputGate } from "./offset-editing";
import { solvedPairDefinition } from "@/contracts/sketch/offset-publication";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import { evaluateAuthoredSketchDerivations } from "@/domain/modeling/sketch-dimension-expressions";
import { getSketchSessionDerivationSettings } from "./session-definition";
import { rebuildSessionForDefinition } from "./definition-authoring";
import { clearActiveSketchTool } from "./drawing-tool-lifecycle";
import { getSketchSessionInvalidFeedback } from "./session-feedback";

/**
 * T16d ([TECH] T16-8/T16-21): what a ready Mirror selection reads as: "2
 * shapes about ‘axis’" (the last pick is the axis candidate, the earlier
 * picks are the seeds).
 */
function getSketchMirrorReadout(
  session: SketchSessionState,
  tool: SketchEditToolState,
) {
  const axis = tool.selectedTargets.at(-1);
  const seeds = tool.selectedTargets.length - 1;
  const axisLabel =
    axis?.kind === "sketchDatumReference"
      ? axis.datumId === "xAxis"
        ? "the sketch X axis"
        : "the sketch Y axis"
      : `‘${
          session.definition.entities.find(
            (entity) =>
              axis?.kind === "sketchEntity" &&
              entity.entityId === axis.entityId,
          )?.label ?? ""
        }’`;
  return `${seeds} ${seeds === 1 ? "shape" : "shapes"} about ${axisLabel}`;
}

/**
 * T16d (review A-11): the Mirror confirm popup sits below every sketch
 * curve and the staged copies (it grows up from its anchor, its top edge
 * at least 8 px below the lowest one), centred under the copies, so it
 * covers no geometry that can still be picked in the sketch's view.
 */
function getSketchMirrorConfirmAnchor(
  session: SketchSessionState,
  previewEntities: readonly SketchDraftEntity[],
) {
  const positions = new Map(
    session.definition.points.map((point) => [point.pointId, point.position]),
  );
  const lows = session.definition.points.map((point) => point.position[1]);
  for (const entity of session.definition.entities) {
    if (entity.kind === "circle")
      lows.push(positions.get(entity.centerPointId)![1] - entity.radius);
    if (entity.kind === "arc") {
      const centre = positions.get(entity.centerPointId)!;
      const start = positions.get(entity.startPointId)!;
      lows.push(
        centre[1] - Math.hypot(start[0] - centre[0], start[1] - centre[1]),
      );
    }
  }
  const xs: number[] = [];
  for (const preview of previewEntities) {
    const points =
      preview.kind === "line"
        ? [preview.start, preview.end]
        : preview.kind === "circle"
          ? [
              [preview.center[0] - preview.radius, preview.center[1]],
              [preview.center[0] + preview.radius, preview.center[1]],
              [preview.center[0], preview.center[1] - preview.radius],
            ]
          : preview.points;
    for (const point of points) {
      xs.push(point[0]);
      lows.push(point[1]);
    }
  }
  return {
    kind: "sketchPoint" as const,
    point: [
      (Math.min(...xs) + Math.max(...xs)) / 2,
      Math.min(...lows),
    ] as SketchPoint,
    offset: { x: -110, y: 140 },
  };
}

/**
 * T16d ([TECH] T16-8/T16-21): the Mirror presentation. A valid selection
 * (seeds, then the axis candidate; `staged` is its operator result) shows
 * its staged copies and a confirm-only Mirror/Cancel popup that updates
 * with every pick; Enter confirms too (`getEnterEvent`). Nothing is
 * authored before Confirm. Review R-1: the popup shows exactly when Enter
 * confirms (the selection's validity), also next to a refused pick's
 * message (an unsupported target leaves the staged mirror as it was).
 */
export function buildSketchMirrorPresentation(
  session: SketchSessionState,
  tool: SketchEditToolState,
  validationMessage: string | null,
  staged: SketchEditOperationResult,
): SketchToolPresentationSchema {
  const previewEntities = staged.previewEntities;
  const base = buildSketchEditToolPresentation(
    tool,
    validationMessage,
    previewEntities,
  );
  if (!staged.valid) return base;
  const readout = getSketchMirrorReadout(session, tool);
  const text = `Mirror ${readout} — Enter or Mirror to confirm`;
  return {
    ...base,
    prompts: [
      {
        id: `${tool.toolId}-prompt`,
        text,
        tone: validationMessage ? "warning" : "neutral",
      },
    ],
    completionHints: [
      { id: `${tool.toolId}-completion`, text: "Confirm mirror", ready: true },
    ],
    floatingInput: {
      id: "sketch-mirror-confirm",
      label: "Mirror",
      value: null,
      readout,
      confirmOnly: true,
      confirmLabel: "Mirror",
      cancelLabel: "Cancel",
      placement: "target",
      anchor: getSketchMirrorConfirmAnchor(session, previewEntities),
      submitAction: { type: "patch", patch: { intent: "createMirror" } },
      cancelAction: {
        type: "patch",
        patch: { intent: "cancelSketchEditOperator" },
      },
    },
  };
}

/**
 * Whether Enter confirms the active Mirror tool's staged mirror (T16d), or
 * (T16e) its repair's picked replacement.
 */
export function isSketchMirrorReady(session: SketchSessionState) {
  return getSketchMirrorConfirmIntent(session) !== null;
}

/**
 * The intent Enter (and the popup's confirm) sends for the active Mirror
 * tool: `createMirror` for a staged mirror (T16d); T16e: `replaceMirrorLine`
 * / `replaceMirrorOriginal` for a repair whose picked candidate is still a
 * valid replacement. Null when nothing is ready.
 */
export function getSketchMirrorConfirmIntent(
  session: SketchSessionState,
): "createMirror" | "replaceMirrorLine" | "replaceMirrorOriginal" | null {
  const tool = session.activeEditTool;
  if (tool?.toolId !== "sketchMirror") return null;
  if (tool.repair) {
    const picked = tool.selectedTargets[0];
    return picked &&
      getSketchMirrorRepairCandidate(session, tool.repair, picked).ok
      ? mirrorRepairIntent(tool.repair)
      : null;
  }
  return getSketchEditOperatorResult(session, tool).valid
    ? "createMirror"
    : null;
}

// ------------------------------------------------- T16e: Mirror repair

const mirrorRepairIntent = (repair: SketchMirrorRepairState) =>
  repair.target === "axis" ? "replaceMirrorLine" : "replaceMirrorOriginal";

/**
 * T16e ([TECH] T16-9/T16-10): what picking `target` would make of the
 * repaired mirror: the rebound definition, or the refusal text. Judged by
 * the domain owner (`replaceMirrorLine` / `replaceMirrorOriginal`) against
 * the current live solve's positions (τ) and the edit-input gate (G19).
 */
export function getSketchMirrorRepairCandidate(
  session: SketchSessionState,
  repair: SketchMirrorRepairState,
  target: PrimitiveRef,
): MirrorReplacement {
  const sketchId = session.sketchId ?? ("sketch_draft" as const);
  const use = repair.target === "axis" ? "a mirror line" : "a mirror original";
  const context = {
    modelingTolerance: session.modelingTolerance,
    solvedSnapshot:
      session.liveSolve?.sourceDefinition === session.definition
        ? session.liveSolve.solvedSnapshot
        : null,
    inputRefusal: (entityId: SketchEntityId) =>
      offsetEditInputGate(session, [entityId], use)?.message ?? null,
  };
  const entityId =
    target.kind === "sketchEntity" && target.sketchId === sketchId
      ? target.entityId
      : null;
  if (repair.target !== "axis")
    return entityId
      ? replaceMirrorOriginal(
          session.definition,
          repair.derivationId,
          repair.target.outputEntityId,
          entityId,
          context,
        )
      : {
          ok: false,
          message: "Pick the new original: a sketch entity of the copy's kind.",
        };
  if (target.kind === "sketchDatumReference" && target.datumId !== "origin" && target.geometryKind === "lineSegment")
    return replaceMirrorLine(
      session.definition,
      repair.derivationId,
      { kind: "sketchDatum", datum: target.datumId },
      context,
    );
  return entityId
    ? replaceMirrorLine(
        session.definition,
        repair.derivationId,
        { kind: "lineEntity", entityId },
        context,
      )
    : {
        ok: false,
        message:
          "Pick a straight line or a sketch axis as the new mirror line.",
      };
}

/** The copies a repair moves: every output for the line, the one copy for an original. */
function mirrorRepairCopyIds(
  session: SketchSessionState,
  repair: SketchMirrorRepairState,
): Set<string> {
  if (repair.target !== "axis") return new Set([repair.target.outputEntityId]);
  const relationship = session.definition.derivedRelationships?.find(
    (candidate) => candidate.derivationId === repair.derivationId,
  );
  return new Set(
    relationship?.outputs.map((output) => output.outputEntityId) ?? [],
  );
}

/** The solved definition of a session (the authored one before any solve). */
function solvedSessionDefinition(session: SketchSessionState) {
  return session.liveSolve?.sourceDefinition === session.definition
    ? solvedPairDefinition(session.definition, session.liveSolve.solvedSnapshot)
    : session.definition;
}

/**
 * T16e: the hover preview (pure reflection is allowed for a hover): the
 * copies reflected about (or from) the candidate at the current solved
 * positions, through the evaluation seam.
 */
function mirrorRepairHoverPreview(
  session: SketchSessionState,
  repair: SketchMirrorRepairState,
  definition: SketchDefinition,
) {
  const snapshot =
    session.liveSolve?.sourceDefinition === session.definition
      ? session.liveSolve.solvedSnapshot
      : null;
  return createSketchEntityPreviewEntities(
    evaluateAuthoredSketchDerivations({
      definition: snapshot
        ? solvedPairDefinition(definition, snapshot)
        : definition,
      ...getSketchSessionDerivationSettings(session),
    }).definition,
    mirrorRepairCopyIds(session, repair),
  );
}

/**
 * T16e (review A-8): the solved candidate shown at the pick, so Confirm
 * hides no jump: the candidate definition solved exactly as Confirm
 * commits it (`rebuildSessionForDefinition`), drawn for the repaired copies
 * and for every entity the solve moves (copy-side requirements can move
 * the originals and whatever they drive).
 */
function mirrorRepairSolvedPreview(
  session: SketchSessionState,
  repair: SketchMirrorRepairState,
  definition: SketchDefinition,
) {
  const solved = rebuildSessionForDefinition(session, { definition });
  const allIds = new Set(definition.entities.map((entity) => entity.entityId));
  const draw = (state: SketchSessionState) =>
    new Map(
      createSketchEntityPreviewEntities(
        solvedSessionDefinition(state),
        allIds,
      ).map((preview) => [preview.id, preview]),
    );
  const before = draw(session);
  const copies = mirrorRepairCopyIds(session, repair);
  return [...draw(solved).values()].filter(
    (preview) =>
      copies.has(preview.id.replace(/^preview-/, "")) ||
      JSON.stringify(preview) !== JSON.stringify(before.get(preview.id)),
  );
}

function mirrorRepairLabels(
  session: SketchSessionState,
  repair: SketchMirrorRepairState,
) {
  const labelOf = (entityId: string) =>
    session.definition.entities.find((entity) => entity.entityId === entityId)
      ?.label ?? "";
  const mirror =
    session.definition.derivedRelationships?.find(
      (candidate) => candidate.derivationId === repair.derivationId,
    )?.label ?? "";
  return {
    mirror,
    copy: repair.target === "axis" ? "" : labelOf(repair.target.outputEntityId),
    target: (target: PrimitiveRef) =>
      target.kind === "sketchDatumReference"
        ? `the sketch ${target.datumId === "xAxis" ? "X" : "Y"} axis`
        : target.kind === "sketchEntity"
          ? `‘${labelOf(target.entityId)}’`
          : "",
  };
}

/**
 * T16e: the repair presentation. Before a pick: the prompt (and a hovered
 * candidate's refusal). After a valid pick: the solved candidate staged
 * and a confirm-only Replace/Cancel popup ("Use ‘l2’ as the mirror line",
 * "Use ‘e’ as the original of ‘ab mirror’"); Enter confirms too.
 */
function buildSketchMirrorRepairPresentation(
  session: SketchSessionState,
  tool: SketchEditToolState & { repair: SketchMirrorRepairState },
  validationMessage: string | null,
  previewEntities: readonly SketchDraftEntity[],
): SketchToolPresentationSchema {
  const { repair } = tool;
  const base = buildSketchEditToolPresentation(
    tool,
    validationMessage,
    previewEntities,
  );
  const labels = mirrorRepairLabels(session, repair);
  const axis = repair.target === "axis";
  const picked = tool.selectedTargets[0];
  const readout = picked
    ? axis
      ? `Use ${labels.target(picked)} as the mirror line`
      : `Use ${labels.target(picked)} as the original of ‘${labels.copy}’`
    : null;
  const text = readout
    ? `${readout} — Enter or Replace to confirm`
    : axis
      ? `Pick the new mirror line of mirror ‘${labels.mirror}’: a straight line or a sketch axis.`
      : `Pick the new original of ‘${labels.copy}’ (mirror ‘${labels.mirror}’).`;
  return {
    ...base,
    prompts: [
      {
        id: `${tool.toolId}-prompt`,
        text,
        tone: validationMessage ? "warning" : "neutral",
      },
    ],
    selectionGuide: base.selectionGuide && {
      ...base.selectionGuide,
      label: axis ? "New mirror line" : "New original",
      selectedCount: picked ? 1 : 0,
      requiredCount: 1,
    },
    completionHints: [
      {
        id: `${tool.toolId}-completion`,
        // Review A-5: a short hint, not the prompt again.
        text: readout
          ? "Confirm replacement"
          : axis
            ? "Pick one line or sketch axis"
            : "Pick one original",
        ready: readout !== null,
      },
    ],
    floatingInput: readout
      ? {
          id: "sketch-mirror-repair-confirm",
          label: axis ? "Replace mirror line" : "Replace original",
          value: null,
          readout,
          confirmOnly: true,
          confirmLabel: "Replace",
          cancelLabel: "Cancel",
          placement: "target",
          anchor: getSketchMirrorConfirmAnchor(session, previewEntities),
          submitAction: {
            type: "patch",
            patch: { intent: mirrorRepairIntent(repair) },
          },
          cancelAction: {
            type: "patch",
            patch: { intent: "cancelMirrorRepair" },
          },
        }
      : null,
  };
}

/**
 * T16e: the repair tool after a hover. With no candidate picked, a hovered
 * candidate shows its refusal or the copies reflected about (from) it; a
 * picked candidate keeps its solved staging and popup.
 */
export function hoverSketchMirrorRepair(
  session: SketchSessionState,
  tool: SketchEditToolState & { repair: SketchMirrorRepairState },
): SketchSessionState {
  if (tool.selectedTargets.length > 0)
    return { ...session, activeEditTool: tool };
  const candidate = tool.hoverTarget
    ? getSketchMirrorRepairCandidate(session, tool.repair, tool.hoverTarget)
    : null;
  const preview =
    candidate?.ok === true
      ? mirrorRepairHoverPreview(session, tool.repair, candidate.definition)
      : [];
  const message = candidate?.ok === false ? candidate.message : null;
  return {
    ...session,
    activeEditTool: tool,
    toolStagedEntities: preview,
    toolPresentation: buildSketchMirrorRepairPresentation(
      session,
      tool,
      message ?? session.toolPresentation?.validation?.[0]?.message ?? null,
      preview,
    ),
  };
}

/**
 * T16e: a repair pick. A refused candidate is not kept (its text shows,
 * nothing is staged); a valid one is staged as its solved candidate with
 * the confirm popup. Nothing is authored before Confirm or Enter.
 */
export function selectSketchMirrorRepairTarget(
  session: SketchSessionState,
  tool: SketchEditToolState & { repair: SketchMirrorRepairState },
  target: PrimitiveRef,
): SketchSessionState {
  const candidate = getSketchMirrorRepairCandidate(
    session,
    tool.repair,
    target,
  );
  const next = {
    ...tool,
    hoverTarget: null,
    selectedTarget: candidate.ok ? target : null,
    selectedTargets: candidate.ok ? [target] : [],
  };
  const preview = candidate.ok
    ? mirrorRepairSolvedPreview(session, tool.repair, candidate.definition)
    : [];
  const message = candidate.ok ? null : candidate.message;
  return {
    ...session,
    activeEditTool: next,
    toolStagedEntities: preview,
    toolPresentation: buildSketchMirrorRepairPresentation(
      session,
      next,
      message,
      preview,
    ),
  };
}

/**
 * T16e (review R-2): leaving a repair without an action (Cancel, Escape,
 * or its mirror gone): the tool is cleared and the sketch's own invalid
 * feedback comes back, recomputed as `rebuildSessionForDefinition` does.
 */
export function leaveSketchMirrorRepair(
  session: SketchSessionState,
): SketchSessionState {
  const cleared = clearActiveSketchTool(session);
  return {
    ...cleared,
    validationMessage:
      cleared.liveRegions.status === "unavailable"
        ? (getSketchSessionInvalidFeedback(cleared) ??
          "Sketch profiles are unavailable until the sketch is corrected.")
        : null,
  };
}

/**
 * T16e: the repair tool on the current definition (entering it, after
 * Undo/Redo or an offset round; it ends when the mirror or its copy is
 * gone): a picked candidate is re-judged and
 * re-staged as its solved candidate (the session's own message untouched), or
 * dropped with its refusal.
 */
export function restageSketchMirrorRepair(
  session: SketchSessionState,
): SketchSessionState {
  const tool = session.activeEditTool;
  if (tool?.toolId !== "sketchMirror" || !tool.repair) return session;
  // Review A-4: Undo/Redo took the mirror (or the copy) away: the repair
  // ends, as its Cancel does.
  const { derivationId, target } = tool.repair;
  const relationship = session.definition.derivedRelationships?.find(
    (candidate) => candidate.derivationId === derivationId,
  );
  if (
    relationship?.kind !== "mirror" ||
    (target !== "axis" &&
      !session.definition.entities.some(
        (entity) => entity.entityId === target.outputEntityId,
      ))
  )
    return leaveSketchMirrorRepair(session);
  const repairTool = { ...tool, repair: tool.repair };
  const picked = tool.selectedTargets[0];
  if (picked) {
    // A still-valid pick keeps the session's own message (as T16d's re-stage).
    return selectSketchMirrorRepairTarget(session, repairTool, picked);
  }
  return hoverSketchMirrorRepair(session, { ...repairTool, hoverTarget: null });
}

/**
 * T16d review A-3: after Undo/Redo rebuilds the definition, a Mirror
 * selection re-stages against it, so its preview, popup and Enter agree
 * without waiting for a region round. A selection that no longer forms a
 * mirror shows its refusal; the rebuilt session's own message is kept
 * while it still does.
 */
export function restageSketchMirrorTool(
  session: SketchSessionState,
): SketchSessionState {
  const tool = session.activeEditTool;
  if (tool?.repair) return restageSketchMirrorRepair(session);
  if (tool?.toolId !== "sketchMirror" || tool.selectedTargets.length === 0)
    return session;
  const staged = getSketchEditOperatorResult(session, tool);
  const validationMessage = staged.valid
    ? (session.toolPresentation?.validation?.[0]?.message ?? null)
    : staged.message;
  return {
    ...session,
    toolStagedEntities: staged.previewEntities,
    toolPresentation: buildSketchMirrorPresentation(
      session,
      tool,
      validationMessage,
      staged,
    ),
  };
}
