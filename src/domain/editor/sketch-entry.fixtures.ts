import type {
  CommandSessionId,
  DocumentId,
  RequestId,
  RevisionId,
} from "@/contracts/shared/ids";
import {
  initialEditorState,
  transitionEditorState,
  type SelectionCommandEditorState,
  type SketchEditorState,
} from "@/core/editor/state-machine";
import type { SketchSessionState } from "@/core/editor/sketch-session";

/**
 * T17-10′ entered-session test builder (logic and UI lanes). Opens `session`
 * (from `createNewSketchSession*` or `createSketchSessionFromSnapshot`, with
 * any seeded definition) through the app's own entry: the sketch selection
 * command receives `effect.sketchSessionOpened`, and `enterSketchEditing`
 * establishes the live solve basis (`withLiveSolveBasis`). Rows built on it
 * see `liveSolve` exactly as a session the user opened (a never-entered
 * session has no solve: T17g3 deleted the display's best-effort fallback).
 */
export function enterSketchSessionState(
  session: SketchSessionState,
  document: { documentId: DocumentId; revisionId: RevisionId } = {
    documentId: "doc_workspace" as DocumentId,
    revisionId: "rev_entered" as RevisionId,
  },
): SketchEditorState {
  const requestId = "request_entered_sketch" as RequestId;
  const command: SelectionCommandEditorState = {
    ...initialEditorState,
    kind: "selectionCommand",
    document,
    command: {
      commandSessionId: "command_entered_sketch" as CommandSessionId,
      toolId: "sketch",
      phase: "awaitingEffect",
    },
    pendingRequestId: requestId,
  };
  const entered = transitionEditorState(command, {
    type: "effect.sketchSessionOpened",
    requestId,
    ...document,
    commandSessionId: command.command.commandSessionId,
    session,
  }).state;
  if (entered.kind !== "editingSketch" || entered.session.liveSolve === null)
    throw new Error("The sketch entry did not establish a live solve basis.");
  return entered;
}

/** The entered session of `enterSketchSessionState`. */
export const enterSketchSession = (
  session: SketchSessionState,
  document?: Parameters<typeof enterSketchSessionState>[1],
): SketchSessionState => enterSketchSessionState(session, document).session;
