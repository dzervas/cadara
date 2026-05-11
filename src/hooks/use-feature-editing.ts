import { useEditorState } from "@/hooks/use-editor-state";

export function useFeatureEditing() {
  const {
    state: { activeEditSession, activeCommand },
    dispatch,
  } = useEditorState();

  return {
    activeEditSession,
    activeCommand,
    commitFeature() {
      if (!activeEditSession || !activeCommand) {
        return;
      }

      dispatch({
        type: "command.commitRequested",
        commandSessionId: activeCommand.commandSessionId,
      });
    },
    cancelFeature() {
      if (!activeCommand) {
        return;
      }

      dispatch({
        type: "command.cancelled",
        commandSessionId: activeCommand.commandSessionId,
      });
    },
  };
}
