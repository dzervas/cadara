import type { EditorState } from "@/core/editor/state-machine";

/**
 * An edit session that rolled the history back (reopening a mid-history sketch
 * or feature) has finished, and the cursor is on its way back to its pre-edit
 * position. The current snapshot is the rolled-back model, which can list no
 * bodies at all, so the workbench shows a rebuild in progress instead of it.
 *
 * A refused or failed roll-forward keeps the context in its restore phase
 * (the editor recovers to the pre-move state), so its failure notice, or a
 * failed snapshot refresh, ends the rebuild status: the user then sees the
 * rolled-back model next to the explanation, never an endless rebuild.
 */
export function isEditSessionCursorRestorePending(
  machineState: Pick<
    EditorState,
    "editSessionCursorContext" | "failureNotice" | "documentRefreshFailure"
  >,
) {
  const phase = machineState.editSessionCursorContext?.phase;
  return (
    (phase === "restorePending" || phase === "restoring") &&
    machineState.failureNotice?.kind !== "historyMove" &&
    machineState.documentRefreshFailure === null
  );
}
