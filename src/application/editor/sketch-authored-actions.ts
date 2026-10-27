import type {
  AuthoredActionIdentity,
  AuthoredActionState,
} from "@/contracts/modeling/authored-actions";
import type { DocumentId, SketchId } from "@/contracts/shared/ids";
import type { SketchDraftCheckpoint } from "@/contracts/sketch/draft-recovery";
import { publishedSketchRevision } from "@/application/sketch-draft-recovery/rules";
import type {
  EditorEvent,
  EditorState,
  EditorTransitionResult,
} from "@/core/editor/state-machine";
import { stableJsonValue } from "@/contracts/modeling/authored-document-serialization";
import {
  canUndoSketchDraftPoint,
  undoSketchDraftPoint,
  pruneSketchAnnotationContext,
  restageSketchMergePointsTool,
  restageSketchMirrorTool,
  withoutSketchAnnotationWheel,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import { rebuildSessionForDefinition } from "@/domain/editor/sketch-session";
import { getToolById } from "@/core/tools/tool-registry";
import { describeBlockedSketchAction } from "@/core/modeling/document-action-blocked";
import { getSketchEditToolDefinition } from "@/core/sketch-edit-tools/registry";
import { isRegisteredSketchConstraintToolId } from "@/core/sketch-constraints/registry";
import {
  parseSketchStylePatch,
  SKETCH_STYLE_PATCH_INTENT,
} from "@/core/sketch-styles/definition";
import { getSketchStylePatchToolId } from "@/domain/editor/sketch-session/styles";
import {
  AuthoredActionHistory,
  encodeAuthoredActionState,
} from "@/core/modeling/authored-action-history";

function authoredState(
  documentId: DocumentId,
  session: SketchSessionState,
): AuthoredActionState {
  return {
    documentId,
    context: { kind: "sketch", sketchId: session.actionContextId },
    data: {
      sketchId: session.actionContextId,
      label: session.sketchLabel,
      plane: session.plane,
      definition: session.definition,
    },
  };
}

function restoreAuthoredSession(
  session: SketchSessionState,
  state: AuthoredActionState,
) {
  if (
    state.context.kind !== "sketch" ||
    !state.data ||
    !("definition" in state.data)
  ) {
    return session;
  }

  const authoredSession = {
    ...session,
    sketchLabel: state.data.label,
    plane: state.data.plane,
    planeTarget: state.data.plane.support,
    planeKey: state.data.plane.key,
  };
  return rebuildSessionForDefinition(authoredSession, {
    definition: state.data.definition,
  });
}

/** The session fields a label placement frame rewrites (`patchSketchDimensionAnnotationPlacement`;
 * T17f D3: it re-bases the live solve onto the moved definition). */
type AnnotationGestureBasis = Pick<
  SketchSessionState,
  "definition" | "commitRequest" | "toolPresentation" | "liveSolve"
>;

interface AnnotationGesture {
  startPoint: readonly [number, number] | null;
  basis: AnnotationGestureBasis;
}

/**
 * T14a C1: label frames keep the live solve and regions, so putting back the
 * pre-gesture basis restores the accepted state without re-basing (no
 * generation bump, no derivation). That holds only when the basis is the
 * accepted state; otherwise the session is rebuilt from the accepted state.
 */
function restoreAnnotationGesture(
  session: SketchSessionState,
  accepted: AuthoredActionState,
  gesture: AnnotationGesture,
) {
  const restored = { ...session, ...gesture.basis };
  const encoded = (state: AuthoredActionState) =>
    JSON.stringify(stableJsonValue(encodeAuthoredActionState(state)));
  return encoded(authoredState(accepted.documentId, restored)) ===
    encoded(accepted)
    ? restored
    : restoreAuthoredSession(session, accepted);
}

/**
 * T14a (T-19): results of background derivations that never change the
 * authored definition. They keep a pending label gesture and enter no
 * ledger entry; every other non-frame event cancels the gesture first.
 */
const ANNOTATION_GESTURE_NEUTRAL_EVENTS = new Set<EditorEvent["type"]>([
  "effect.sketchRegionsDerived",
  "effect.sketchRegionDerivationFailed",
  "effect.sketchSnapIntersectionsQueried",
  "effect.sketchSnapIntersectionsQueryFailed",
]);

/**
 * Replaces the reducer's state with a session restored after the reducer
 * (T10 A11/A13). The reducer's post-transition hook may just have requested a
 * live region derivation for the basis this restore supersedes; that request
 * is dropped (its effect and its `pendingRegionRequest`), so the event loop's
 * hook derives the restored basis once instead of twice.
 */
function restoreAfterReducer(
  before: EditorState,
  result: EditorTransitionResult,
  restored: Extract<EditorState, { kind: "editingSketch" }>,
) {
  const prior =
    before.kind === "editingSketch" ? before.pendingRegionRequest : null;
  const requested = restored.pendingRegionRequest;
  if (requested && requested.requestId !== prior?.requestId) {
    result.effects = result.effects.filter(
      (effect) =>
        effect.type !== "sketch.deriveRegions" ||
        effect.requestId !== requested.requestId,
    );
    result.state = { ...restored, pendingRegionRequest: prior };
    return;
  }
  result.state = restored;
}

const ANNOTATION_DRAG_THRESHOLD_PX = 6;

type ActionHistoryEntries = NonNullable<
  SketchSessionState["actionHistory"]
>["undo"];

/** Whole-entry equality, including an absent `blockedReason`. */
function sameActionHistoryEntries(
  stored: ActionHistoryEntries | undefined,
  next: readonly { sequence: number; label: string }[],
) {
  return (
    stored !== undefined &&
    stored.length === next.length &&
    stored.every(
      (entry, index) =>
        entry.sequence === next[index]!.sequence &&
        entry.label === next[index]!.label &&
        entry.blockedReason === undefined,
    )
  );
}

function actionLabel(event: EditorEvent, before: EditorState) {
  // T13-D23: Finish's own definition change is the finalized spline (a
  // commit request with a special mode open commits that mode instead).
  if (
    (event.type === "tool.activated" && event.toolId === "finishSketch") ||
    (event.type === "command.commitRequested" &&
      before.kind === "editingSketch" &&
      !before.session.activeSpecialMode)
  ) {
    return "Create Sketch Geometry";
  }
  switch (event.type) {
    case "sketch.intersectionEditCompleted":
      return event.basis.input.operation.kind === "extend" ? "Extend" : event.basis.input.operation.kind === "split" ? "Split" : "Trim";
    case "sketch.imageEdited":
      return event.edit.kind === "replace" ? "Replace Reference Image" : "Edit Reference Image";
    case "sketch.imageRemoved":
      return "Remove Reference Image";
    case "sketch.imageAuthored":
      return getToolById("importImage").name;
    case "sketch.styleAuthored":
      return before.kind === "editingSketch"
        ? getToolById(getSketchStylePatchToolId(before.session, { intent: SKETCH_STYLE_PATCH_INTENT, ...event.patch })).name : "Style";
    case "sketch.referenceAuthored":
      return getToolById("projectReference").name;
    case "sketch.derivationCreated":
      return event.input.kind === "linearPattern" ? "Sketch Linear Pattern" : event.input.kind === "circularPattern" ? "Sketch Circular Pattern" : "Sketch Transform";
    case "sketch.mirrorRemoved":
      return "Remove Mirror";
    case "sketch.mirrorRepaired":
      return event.repair.target === "axis" ? "Replace Mirror Line" : "Replace Mirror Original";
    case "sketch.mirrorCreated":
      return "Mirror";
    case "sketch.offsetCompleted":
      return "Commit Offset";
    case "sketch.offsetRemoved":
      return "Remove Offset";
    case "sketch.geometryBuilt":
      return event.input.kind === "fillet" ? "Fillet" : event.input.kind === "chamfer" ? "Chamfer" : "Slot";
    case "sketch.geometryUpdated":
      return event.edit.kind === "point" || event.edit.kind === "translate"
        ? "Move Sketch Geometry" : event.edit.kind === "mergePoints" ? "Merge Points" : "Edit Sketch Geometry";
    case "sketch.geometryDeleted":
      return "Delete Sketch Geometry";
    case "sketch.labelSet":
      return "Label Sketch Item";
    case "sketch.constructionSet":
      return getToolById("construction").name;
    case "sketch.requirementRemoved":
      return "Remove Sketch Requirement";
    case "sketch.requirementAuthored":
      return getToolById(event.input.tool).name;
    case "sketch.dimensionAuthored":
      return getToolById("dimension").name;
    case "sketch.dimensionMadeReference":
      return "Make Reference";
    case "sketch.dimensionUpdated":
      return "Update Sketch Dimension";
    case "sketch.geometryDragEnded":
      return "Move Sketch Geometry";
    case "sketch.annotationDeleteRequested":
      return "Delete Sketch Item";
    case "sketch.toolPatched": {
      const intent = event.patch.intent;
      if (typeof intent !== "string") return "Update Sketch";
      // T17k2 (T17k F-4): a style patch is the Fill or Stroke tool's action
      // and an edit operator's confirm is that tool's (e.g. "Sketch
      // Fillet"), not the generated "Patch Sketch Style" / "Commit Sketch
      // Edit Operator".
      if (
        intent === SKETCH_STYLE_PATCH_INTENT ||
        intent === "commitSketchEditOperator"
      )
        return patchingToolName(before, event.patch);
      return (
        PATCH_LABELS[intent] ??
        intent
          .replace(/([A-Z])/g, " $1")
          .replace(/^./, (value) => value.toUpperCase())
      );
    }
    // A committing Escape or Enter is a finalized spline (T11-D10).
    case "sketch.primitiveAuthored":
    case "sketch.pointerReleased":
    case "sketch.escapeRequested":
    case "sketch.confirmRequested":
      return "Create Sketch Geometry";
    case "sketch.specialModeDragEnded":
    case "sketch.specialModeClickRequested":
    case "sketch.specialModeDoubleClickRequested":
    case "sketch.specialModePanelActionInvoked":
    case "effect.sketchSpecialModeEffectCompleted":
      return "Edit Sketch Operation";
    // T17k2 (review A-5): reference images picked inside a sketch are one
    // private action.
    case "sketch.referenceImagePayloadsPicked":
      return getToolById("importImage").name;
    // T17c3 (T17b0 P-9): a pick that completes an action (a constraint's
    // last pick, a construction toggle, a reference pick) is the armed
    // tool's action, labelled by its name (e.g. "Coincident").
    case "viewport.selectionRequested": {
      const toolId =
        before.kind === "editingSketch" ? before.session.activeTool : null;
      if (toolId) return getToolById(toolId).name;
      break;
    }
    // T17c3 review F-4: the SVG Rendering toggle is one action.
    // cadara-h026.2: so is a constraint applied to the preselection at its
    // activation, labelled by the tool's name (e.g. "Horizontal").
    case "tool.activated":
      if (
        event.toolId === "svgRendering" ||
        isRegisteredSketchConstraintToolId(event.toolId)
      )
        return getToolById(event.toolId).name;
      break;
    // T17c3 (T17c review F-B): a Create that waited for the preview's
    // certification commits with the publication; it is the same action.
    case "effect.sketchOffsetPreviewPublished":
      return "Commit Offset";
    // T10g-1/T10g-2 (T-g15): the applied exact Trim, Extend or Split is
    // one action labelled by the operation of the query it answers (review
    // A-4: the in-flight query before the transition).
    case "effect.sketchEditIntersectionsQueried": {
      const kind =
        before.kind === "editingSketch"
          ? before.session.activeEditTool?.editQuery?.inFlight?.input.operation
              .kind
          : undefined;
      return kind === "extend" ? "Extend" : kind === "split" ? "Split" : "Trim";
    }
  }
  // T17k2: never an event's type name (e.g. "Viewport.selection Requested").
  return "Edit Sketch";
}

const PATCH_LABELS: Readonly<Record<string, string>> = {
  resetTangentToAutomatic: "Reset Tangent",
  setTangentToZero: "Zero Tangent",
  mergePoints: "Merge Points",
  createMirror: "Mirror",
  setDimensionAnnotationPlacement: "Move Dimension Label",
  setConstraintAnnotationPlacement: "Move Constraint Label",
  makeAnnotationReference: "Make Reference",
};

function patchingToolName(before: EditorState, patch: Record<string, unknown>) {
  const session = before.kind === "editingSketch" ? before.session : null;
  if (patch.intent === SKETCH_STYLE_PATCH_INTENT) {
    const style = parseSketchStylePatch(patch);
    return session && style
      ? getToolById(getSketchStylePatchToolId(session, style)).name
      : "Style";
  }
  return session?.activeEditTool
    ? getSketchEditToolDefinition(session.activeEditTool.toolId).metadata.name
    : "Edit Sketch";
}

function replaceSemanticSketchIdentity<T>(
  value: T,
  aliases: ReadonlySet<string>,
  publishedSketchId: SketchId,
): T {
  if (Array.isArray(value))
    return value.map((entry) =>
      replaceSemanticSketchIdentity(entry, aliases, publishedSketchId),
    ) as T;
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === "sketchId" && typeof entry === "string" && aliases.has(entry)
        ? publishedSketchId
        : replaceSemanticSketchIdentity(entry, aliases, publishedSketchId),
    ]),
  ) as T;
}

/**
 * The phase of a dimension label gesture frame. The Dimension tool's preview
 * handle (`setConstraintAnnotationPlacement`) only moves tool state, never
 * authored state, so its frames go straight to the reducer (T14a review B-1:
 * its no-move end is the placement click that pins the value input).
 */
function annotationGesturePhase(event: EditorEvent) {
  if (
    event.type !== "sketch.toolPatched" ||
    event.patch.intent !== "setDimensionAnnotationPlacement"
  ) {
    return null;
  }

  const phase = event.patch.gesturePhase;
  return phase === "start" ||
    phase === "move" ||
    phase === "end" ||
    phase === "cancel"
    ? phase
    : null;
}

function annotationGestureClientPoint(event: EditorEvent) {
  if (event.type !== "sketch.toolPatched") return null;
  const point = event.patch.clientPoint;
  return Array.isArray(point) &&
    typeof point[0] === "number" &&
    typeof point[1] === "number"
    ? ([point[0], point[1]] as const)
    : null;
}

/** Completed editor candidates enter the same action engine as document intents.
 * The accepted base stays separate from gesture previews; tools never capture inverses.
 */
export class SketchAuthoredActions {
  private history = new AuthoredActionHistory();
  private readonly localActorId = crypto.randomUUID();
  private readonly accepted = new Map<string, AuthoredActionState>();
  private readonly publicationBases = new Map<
    string,
    Extract<AuthoredActionState, { context: { kind: "sketch" } }>["data"]
  >();
  private readonly annotationGestures = new Map<string, AnnotationGesture>();
  private completedActions = 0;

  /** Accepted authored state, not the live pointer/label gesture preview. */
  getDraftCheckpoint(state: EditorState): SketchDraftCheckpoint | null {
    if (state.kind !== "editingSketch" || !state.snapshot) return null;
    const documentId = state.snapshot.document.documentId;
    const key = JSON.stringify({
      actorId: state.snapshot.provenance?.actorId ?? this.localActorId,
      documentId,
      context: { kind: "sketch", sketchId: state.session.actionContextId },
    });
    const accepted = this.accepted.get(key);
    if (!accepted?.data || !("definition" in accepted.data)) return null;
    const base = this.publicationBases.get(key);
    return {
      documentId, sketchId: state.session.actionContextId,
      published: base != null,
      publishedRevision: base ? publishedSketchRevision(base) : null,
      label: accepted.data.label, plane: accepted.data.plane,
      definition: accepted.data.definition,
      sequence: state.session.sequence,
      completedActions: this.completedActions,
    };
  }

  reset() {
    this.history = new AuthoredActionHistory();
    this.accepted.clear();
    this.publicationBases.clear();
    this.annotationGestures.clear();
  }

  transition(
    before: EditorState,
    event: EditorEvent,
    reduce: (state: EditorState) => EditorTransitionResult,
  ): EditorTransitionResult {
    if (
      event.type === "document.replaced" &&
      event.historyDisposition === "fresh-file-open"
    )
      this.reset();
    // Both toolbar activation and the shortcut reach this owner. Consume
    // draft clicks before invoking the authored-action history engine.
    if (
      before.kind === "editingSketch" &&
      before.pendingCommitRequestId === null &&
      (event.type === "history.undoRequested" ||
        (event.type === "tool.activated" && event.toolId === "undo")) &&
      canUndoSketchDraftPoint(before.session)
    ) {
      return {
        state: { ...before, session: undoSketchDraftPoint(before.session) },
        effects: [],
      };
    }
    const beforeIdentity: AuthoredActionIdentity | null =
      before.kind === "editingSketch" && before.snapshot
        ? {
            actorId: before.snapshot.provenance?.actorId ?? this.localActorId,
            documentId: before.snapshot.document.documentId,
            context: {
              kind: "sketch",
              sketchId: before.session.actionContextId,
            },
          }
        : null;
    const beforeKey = beforeIdentity ? JSON.stringify(beforeIdentity) : null;
    if (
      before.kind === "editingSketch" &&
      beforeIdentity?.context.kind === "sketch" &&
      event.type === "effect.sketchCommitted" &&
      event.accepted &&
      event.publishedSketchId
    ) {
      this.reconcilePublishedIdentity(
        beforeIdentity,
        event.publishedSketchId,
        before.session,
      );
    }
    const annotationPhase = annotationGesturePhase(event);
    const annotationClientPoint = annotationGestureClientPoint(event);
    const pendingGesture = beforeKey
      ? this.annotationGestures.get(beforeKey)
      : undefined;
    if (before.kind === "editingSketch" && beforeKey) {
      // T14a: frames of a gesture that was never started or was already
      // cancelled (the chip keeps reporting it) change nothing.
      if (annotationPhase && annotationPhase !== "start" && !pendingGesture)
        return { state: before, effects: [] };
      if (annotationPhase === "start")
        this.annotationGestures.set(beforeKey, {
          startPoint: annotationClientPoint,
          basis: pendingGesture?.basis ?? {
            definition: before.session.definition,
            commitRequest: before.session.commitRequest,
            toolPresentation: before.session.toolPresentation,
            liveSolve: before.session.liveSolve,
          },
        });
    }
    const leavesGesture =
      event.type === "command.cancelled" ||
      event.type === "sketch.publishRequested" ||
      event.type === "sketch.discardRequested" ||
      event.type === "command.commitRequested" ||
      event.type === "tool.activated" ||
      event.type === "sketch.activeToolCleared" ||
      event.type === "sketch.escapeRequested";
    const annotationMoved =
      annotationPhase === "end" &&
      pendingGesture !== undefined &&
      (pendingGesture.startPoint === null ||
        annotationClientPoint === null ||
        Math.hypot(
          annotationClientPoint[0] - pendingGesture.startPoint[0],
          annotationClientPoint[1] - pendingGesture.startPoint[1],
        ) >= ANNOTATION_DRAG_THRESHOLD_PX);

    // T14a (T-19): a pending label gesture is a gesture like a drag. A
    // cancel frame or any event that is not one of its frames (Escape,
    // hover, Delete, Undo, selection, tools, Finish, ...) cancels it first,
    // then is handled against the restored accepted state.
    if (
      before.kind === "editingSketch" &&
      beforeKey &&
      pendingGesture &&
      (annotationPhase === "cancel" ||
        (annotationPhase === null &&
          !ANNOTATION_GESTURE_NEUTRAL_EVENTS.has(event.type)))
    ) {
      this.annotationGestures.delete(beforeKey);
      const accepted = this.accepted.get(beforeKey);
      if (accepted) {
        before = {
          ...before,
          session: restoreAnnotationGesture(
            before.session,
            accepted,
            pendingGesture,
          ),
        };
      }
      if (annotationPhase === "cancel")
        return this.withAvailability(
          { state: before, effects: [] },
          beforeIdentity!,
        );
    }

    // Leaving a pointer gesture must not publish its preview through Finish or a tool switch.
    if (
      before.kind === "editingSketch" &&
      beforeKey &&
      (before.session.activeDrag ||
        before.session.activeSpecialMode?.activeDragHandle) &&
      leavesGesture
    ) {
      const accepted = this.accepted.get(beforeKey);
      if (accepted) {
        before = {
          ...before,
          session: restoreAuthoredSession(before.session, accepted),
        };
      }
    }
    const result = reduce(before);
    if (
      before.kind === "editingSketch" &&
      beforeKey &&
      result.effects.some((effect) => effect.type === "sketch.commit")
    ) {
      const publicationBase = this.publicationBases.get(beforeKey);
      result.effects = result.effects.map((effect) =>
        effect.type === "sketch.commit"
          ? {
              ...effect,
              publicationBase: {
                actionContextId: before.session.actionContextId,
                expectedSketch: structuredClone(publicationBase ?? null),
              },
            }
          : effect,
      );
    }
    if (result.state.kind !== "editingSketch") return result;
    const state = result.state;
    const documentId = state.snapshot?.document.documentId;
    if (!documentId) return result;
    const identity: AuthoredActionIdentity = {
      actorId: state.snapshot?.provenance?.actorId ?? this.localActorId,
      documentId,
      context: { kind: "sketch", sketchId: state.session.actionContextId },
    };
    const key = JSON.stringify(identity);
    const entered =
      before.kind !== "editingSketch" ||
      before.session.actionContextId !== state.session.actionContextId;
    // The entering snapshot can lack repository provenance; the actor then
    // resolves on a later snapshot. That is the same session: carry its own
    // entry base and accepted state to the resolved identity, never reuse
    // what an earlier session left there (cadara-7j8).
    if (!entered && beforeKey !== null && beforeKey !== key) {
      for (const records of [
        this.accepted,
        this.publicationBases,
        this.annotationGestures,
      ] as Map<string, unknown>[]) {
        if (records.has(beforeKey)) records.set(key, records.get(beforeKey));
        else records.delete(key);
        records.delete(beforeKey);
      }
    }
    if (entered || !this.accepted.has(key)) {
      this.accepted.set(key, authoredState(documentId, state.session));
      if (entered || !this.publicationBases.has(key)) {
        const sharedSketch = state.session.sketchId
          ? state.snapshot?.document.sketches.find(
              (sketch) => sketch.sketchId === state.session.sketchId,
            )
          : null;
        this.publicationBases.set(
          key,
          sharedSketch
            ? {
                sketchId: sharedSketch.sketchId,
                label: sharedSketch.label,
                plane: structuredClone(sharedSketch.plane),
                definition: structuredClone(sharedSketch.sketch.definition),
              }
            : null,
        );
      }
      return this.withAvailability(result, identity);
    }
    const expected = this.accepted.get(key)!;
    const neutralGesture = ANNOTATION_GESTURE_NEUTRAL_EVENTS.has(event.type)
      ? this.annotationGestures.get(key)
      : undefined;
    // Review A-1: a neutral result may rebuild the tool presentation; a
    // later cancel restores that one, not the pre-gesture one.
    if (
      neutralGesture &&
      before.kind === "editingSketch" &&
      state.session.toolPresentation !== before.session.toolPresentation
    ) {
      neutralGesture.basis = {
        ...neutralGesture.basis,
        toolPresentation: state.session.toolPresentation,
      };
    }
    if (
      annotationPhase === "start" ||
      annotationPhase === "move" ||
      neutralGesture
    ) {
      return this.withAvailability(result, identity);
    }
    if (annotationPhase === "end" && pendingGesture) {
      this.annotationGestures.delete(key);
      if (!annotationMoved) {
        restoreAfterReducer(before, result, {
          ...state,
          session: restoreAnnotationGesture(
            state.session,
            expected,
            pendingGesture,
          ),
        });
        return this.withAvailability(result, identity);
      }
    }
    const direction =
      event.type === "history.undoRequested" ||
      (event.type === "tool.activated" && event.toolId === "undo")
        ? "undo"
        : event.type === "history.redoRequested" ||
            (event.type === "tool.activated" && event.toolId === "redo")
          ? "redo"
          : null;
    if (direction) {
      const actionSequence =
        event.type === "history.undoRequested" ||
        event.type === "history.redoRequested"
          ? event.actionSequence
          : undefined;
      const action = this.history[direction](
        identity,
        expected,
        actionSequence,
      );
      if (action.status === "blocked") {
        const available = this.withAvailability(result, identity);
        if (available.state.kind !== "editingSketch") return available;
        const blockedSequence =
          actionSequence ??
          available.state.session.actionHistory?.[direction].at(-1)?.sequence;
        // T17k2 (review A-2): the reason by label, as the document strip
        // says it, never the reason code.
        const entries = this.history.entries(identity);
        const reason = describeBlockedSketchAction({
          direction,
          label:
            entries[direction].find(
              (entry) => entry.sequence === blockedSequence,
            )?.label ?? "this action",
          result: action,
          definition: available.state.session.definition,
          history: [...entries.undo, ...entries.redo],
        });
        return {
          ...available,
          state: {
            ...available.state,
            session: {
              ...available.state.session,
              validationMessage: reason,
              actionHistory: {
                undo:
                  available.state.session.actionHistory?.undo.map((entry) =>
                    direction === "undo" && entry.sequence === blockedSequence
                      ? { ...entry, blockedReason: reason }
                      : entry,
                  ) ?? [],
                redo:
                  available.state.session.actionHistory?.redo.map((entry) =>
                    direction === "redo" && entry.sequence === blockedSequence
                      ? { ...entry, blockedReason: reason }
                      : entry,
                  ) ?? [],
              },
            },
          },
        };
      }
      const restored = action.status === "applied" ? action.state : expected;
      if (action.status === "applied") {
        this.accepted.set(key, restored);
        this.completedActions += 1;
      }
      if (
        restored.context.kind === "sketch" &&
        restored.data &&
        "definition" in restored.data
      ) {
        // T16d review A-3: a Mirror selection re-stages on the restored
        // definition (its preview, popup and Enter agree at once); T17f:
        // so do Merge Points' picks.
        const session = restageSketchMergePointsTool(
          restageSketchMirrorTool(
            restoreAuthoredSession(state.session, restored),
          ),
        );
        restoreAfterReducer(before, result, {
          ...state,
          // T17f (T16e review A-4): a repair the restore ended leaves no
          // tool, so the command is the sketch again, as after its Cancel.
          ...(state.session.activeEditTool?.repair && !session.activeEditTool
            ? {
                command: {
                  ...state.command,
                  toolId: "sketch" as const,
                  phase: "editing" as const,
                },
              }
            : {}),
          selection: [],
          hoverTarget: null,
          // T14c: refs the restored definition no longer holds leave the
          // annotation context. T14g: an open wheel closes (its spokes are
          // the pre-restore cluster).
          annotationContext: withoutSketchAnnotationWheel(
            pruneSketchAnnotationContext(
              state.annotationContext ?? null,
              session,
            ),
          ),
          session,
        });
      }
      return this.withAvailability(result, identity);
    }
    // Gesture frames never advance the accepted state or ledger.
    if (
      state.session.activeDrag ||
      state.session.activeSpecialMode?.activeDragHandle ||
      event.type === "sketch.specialModeDragMoved" ||
      event.type === "sketch.specialModeDragStarted"
    )
      return this.withAvailability(result, identity);
    if (
      before.kind === "editingSketch" &&
      before.session.activeDrag &&
      event.type !== "sketch.geometryDragEnded"
    ) {
      if (
        expected.context.kind === "sketch" &&
        expected.data &&
        "definition" in expected.data
      )
        restoreAfterReducer(before, result, {
          ...state,
          session: restoreAuthoredSession(state.session, expected),
        });
      return this.withAvailability(result, identity);
    }
    const candidate = authoredState(documentId, state.session);
    const action = this.history.commit(
      identity,
      expected,
      candidate,
      actionLabel(event, before),
      expected,
    );
    if (action.status === "blocked")
      throw new Error(`Sketch action rejected: ${action.reason}`);
    if (action.status === "applied") {
      this.accepted.set(key, action.state);
      this.completedActions += 1;
    }
    return this.withAvailability(result, identity);
  }

  private reconcilePublishedIdentity(
    identity: AuthoredActionIdentity,
    publishedSketchId: SketchId,
    session: SketchSessionState,
  ) {
    if (identity.context.kind !== "sketch") return;
    const aliases = new Set([identity.context.sketchId, "sketch_draft"]);
    const nextIdentity = this.history.remapSketchContext(
      identity,
      publishedSketchId,
      ["sketch_draft"],
    );
    const oldKey = JSON.stringify(identity);
    const nextKey = JSON.stringify(nextIdentity);
    const accepted = this.accepted.get(oldKey);
    if (accepted) {
      this.accepted.delete(oldKey);
      this.accepted.set(
        nextKey,
        replaceSemanticSketchIdentity(accepted, aliases, publishedSketchId),
      );
    }
    const publicationBase = this.publicationBases.get(oldKey);
    this.publicationBases.delete(oldKey);
    this.publicationBases.set(
      nextKey,
      publicationBase
        ? replaceSemanticSketchIdentity(
            publicationBase,
            aliases,
            publishedSketchId,
          )
        : replaceSemanticSketchIdentity(
            {
              sketchId: identity.context.sketchId,
              label: session.sketchLabel,
              plane: session.plane,
              definition: session.definition,
            },
            aliases,
            publishedSketchId,
          ),
    );
  }

  private withAvailability(
    result: EditorTransitionResult,
    identity: AuthoredActionIdentity,
  ): EditorTransitionResult {
    if (result.state.kind !== "editingSketch") return result;
    const entries = this.history.entries(identity);
    const actionAvailability = {
      canUndo: entries.undo.length > 0,
      canRedo: entries.redo.length > 0,
    };
    const actionHistory = {
      undo: entries.undo.map(({ sequence, label }) => ({ sequence, label })),
      redo: entries.redo.map(({ sequence, label }) => ({ sequence, label })),
    };
    const session = result.state.session;
    // T14c (R-7 option (b)): an unchanged ledger keeps the session object, so
    // nothing keyed on it (the annotation descriptor solve) re-runs for
    // lifecycle clicks or hover. The comparison covers the whole stored
    // entries, so a `blockedReason` mark is still cleared by the next event.
    if (
      session.actionAvailability?.canUndo === actionAvailability.canUndo &&
      session.actionAvailability.canRedo === actionAvailability.canRedo &&
      sameActionHistoryEntries(
        session.actionHistory?.undo,
        actionHistory.undo,
      ) &&
      sameActionHistoryEntries(session.actionHistory?.redo, actionHistory.redo)
    ) {
      return result;
    }
    return {
      ...result,
      state: {
        ...result.state,
        session: { ...session, actionAvailability, actionHistory },
      },
    };
  }
}
