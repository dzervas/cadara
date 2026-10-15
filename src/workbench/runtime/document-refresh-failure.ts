import type { WorkbenchNotificationModel } from "@/components/layout/workbench-notification-model";
import type { EditorState } from "@/domain/editor/state-machine";

/**
 * T17o (T17c3 route; specification "Minimum failure feedback"): a failed
 * document snapshot refresh leaves the editor on the older revision's
 * snapshot. The workbench says so, with the reason and a retry (the editor
 * clears the failure on the next loaded snapshot). Null when nothing failed.
 */
export function getDocumentRefreshFailureNotification(
  machineState: Pick<EditorState, "documentRefreshFailure">,
  retry: () => void,
): WorkbenchNotificationModel | null {
  const error = machineState.documentRefreshFailure;
  return error === null
    ? null
    : {
        type: "error",
        title: "Document refresh failed",
        message: `${error} The view may still show an older revision of the document.`,
        action: { label: "Retry", onClick: retry },
      };
}

const FAILURE_NOTICE_TITLES: Record<
  NonNullable<EditorState["failureNotice"]>["kind"],
  string
> = {
  sketchOpen: "Sketch could not be opened",
  featureEdit: "Feature could not be edited",
  historyMove: "History move failed",
};

/**
 * T17o review fixes: the one shared notice of a failed sketch open, feature
 * edit or history move (its refusal, or an unexpected error that the event
 * loop also reported). Dismissible; the next success of the same kind
 * clears it. Null when nothing failed.
 */
export function getEditorFailureNotification(
  machineState: Pick<EditorState, "failureNotice">,
  dismiss: () => void,
): WorkbenchNotificationModel | null {
  const notice = machineState.failureNotice;
  return notice === null
    ? null
    : {
        type: "error",
        title: FAILURE_NOTICE_TITLES[notice.kind],
        message: notice.message,
        onDismiss: dismiss,
      };
}
