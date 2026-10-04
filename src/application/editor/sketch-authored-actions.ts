import type {
  AuthoredActionIdentity,
  AuthoredActionState,
} from "@/contracts/modeling/authored-actions";
import type { DocumentId, SketchId } from "@/contracts/shared/ids";
import type {
  EditorEvent,
  EditorState,
  EditorTransitionResult,
} from "@/core/editor/state-machine";
import type { SketchSessionState } from "@/domain/editor/sketch-session";
import { rebuildSessionForDefinition } from "@/domain/editor/sketch-session/internals";
import { AuthoredActionHistory } from "@/domain/modeling/authored-action-history";

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

const ANNOTATION_DRAG_THRESHOLD_PX = 6;

function actionLabel(event: EditorEvent) {
  switch (event.type) {
    case "sketch.geometryDragEnded":
      return "Move Sketch Geometry";
    case "sketch.annotationDeleteRequested":
      return "Delete Sketch Item";
    case "sketch.toolPatched":
      return event.patch.intent === "setDimensionAnnotationPlacement"
        ? "Move Dimension Label"
        : event.patch.intent === "setConstraintAnnotationPlacement"
          ? "Move Constraint Label"
          : typeof event.patch.intent === "string"
            ? event.patch.intent
                .replace(/([A-Z])/g, " $1")
                .replace(/^./, (value) => value.toUpperCase())
            : "Update Sketch";
    case "sketch.pointerReleased":
      return "Create Sketch Geometry";
    case "sketch.specialModeDragEnded":
      return "Edit Sketch Operation";
    // T10g-1 (T-g15): the applied exact Trim is one labelled action.
    case "effect.sketchEditIntersectionsQueried":
      return "Trim";
    default:
      return event.type
        .replace(/^sketch\./, "")
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (value) => value.toUpperCase());
  }
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

function annotationGesturePhase(event: EditorEvent) {
  if (
    event.type !== "sketch.toolPatched" ||
    (event.patch.intent !== "setDimensionAnnotationPlacement" &&
      event.patch.intent !== "setConstraintAnnotationPlacement")
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
  private readonly annotationGestures = new Map<
    string,
    readonly [number, number] | null
  >();

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
    if (beforeKey && annotationPhase === "start") {
      this.annotationGestures.set(beforeKey, annotationClientPoint);
    } else if (
      beforeKey &&
      annotationPhase === "move" &&
      !this.annotationGestures.has(beforeKey)
    ) {
      this.annotationGestures.set(beforeKey, annotationClientPoint);
    }
    const leavesGesture =
      event.type === "command.cancelled" ||
      event.type === "command.commitRequested" ||
      event.type === "tool.activated" ||
      event.type === "sketch.activeToolCleared";
    const hasAnnotationGesture =
      beforeKey !== null && this.annotationGestures.has(beforeKey);
    const annotationStartPoint = beforeKey
      ? this.annotationGestures.get(beforeKey)
      : undefined;
    const annotationMoved =
      annotationPhase === "end" &&
      annotationStartPoint !== undefined &&
      (annotationStartPoint === null ||
        annotationClientPoint === null ||
        Math.hypot(
          annotationClientPoint[0] - annotationStartPoint[0],
          annotationClientPoint[1] - annotationStartPoint[1],
        ) >= ANNOTATION_DRAG_THRESHOLD_PX);

    // Leaving a pointer gesture must not publish its preview through Finish or a tool switch.
    if (
      before.kind === "editingSketch" &&
      beforeKey &&
      (before.session.activeDrag ||
        before.session.activeSpecialMode?.activeDragHandle ||
        hasAnnotationGesture) &&
      (leavesGesture || annotationPhase === "cancel")
    ) {
      const accepted = this.accepted.get(beforeKey);
      if (accepted) {
        before = {
          ...before,
          session: restoreAuthoredSession(before.session, accepted),
        };
      }
      this.annotationGestures.delete(beforeKey);
    }
    const result = reduce(before);
    if (
      before.kind === "editingSketch" &&
      beforeKey &&
      event.type === "tool.activated" &&
      event.toolId === "finishSketch"
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
    if (annotationPhase === "start" || annotationPhase === "move") {
      return this.withAvailability(result, identity);
    }
    if (annotationPhase === "cancel") {
      this.annotationGestures.delete(key);
      result.state = {
        ...state,
        session: restoreAuthoredSession(state.session, expected),
      };
      return this.withAvailability(result, identity);
    }
    if (annotationPhase === "end") {
      this.annotationGestures.delete(key);
      if (!annotationMoved) {
        result.state = {
          ...state,
          session: restoreAuthoredSession(state.session, expected),
        };
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
        return {
          ...available,
          state: {
            ...available.state,
            session: {
              ...available.state.session,
              validationMessage: `Cannot ${direction}: ${action.reason}`,
              actionHistory: {
                undo:
                  available.state.session.actionHistory?.undo.map((entry) =>
                    direction === "undo" && entry.sequence === blockedSequence
                      ? { ...entry, blockedReason: action.reason }
                      : entry,
                  ) ?? [],
                redo:
                  available.state.session.actionHistory?.redo.map((entry) =>
                    direction === "redo" && entry.sequence === blockedSequence
                      ? { ...entry, blockedReason: action.reason }
                      : entry,
                  ) ?? [],
              },
            },
          },
        };
      }
      const restored = action.status === "applied" ? action.state : expected;
      if (action.status === "applied") this.accepted.set(key, restored);
      if (
        restored.context.kind === "sketch" &&
        restored.data &&
        "definition" in restored.data
      ) {
        result.state = {
          ...state,
          selection: [],
          hoverTarget: null,
          session: restoreAuthoredSession(state.session, restored),
        };
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
        result.state = {
          ...state,
          session: restoreAuthoredSession(state.session, expected),
        };
      return this.withAvailability(result, identity);
    }
    const candidate = authoredState(documentId, state.session);
    const action = this.history.commit(
      identity,
      expected,
      candidate,
      actionLabel(event),
      expected,
    );
    if (action.status === "blocked")
      throw new Error(`Sketch action rejected: ${action.reason}`);
    if (action.status === "applied") this.accepted.set(key, action.state);
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
    return {
      ...result,
      state: {
        ...result.state,
        session: {
          ...result.state.session,
          actionAvailability: {
            canUndo: entries.undo.length > 0,
            canRedo: entries.redo.length > 0,
          },
          actionHistory: {
            undo: entries.undo.map(({ sequence, label }) => ({
              sequence,
              label,
            })),
            redo: entries.redo.map(({ sequence, label }) => ({
              sequence,
              label,
            })),
          },
        },
      },
    };
  }
}
