import { createElement, type ReactNode } from "react";

import { EditorContext, type EditorContextValue } from "@/hooks/editor-context";
import {
  createEditorStateStore,
  EditorStateStoreContext,
} from "@/hooks/editor-state-store";

/**
 * What `EditorProvider` provides for a fixed editor context value: the
 * context and its store (for `useEditorStateSelector`), without the event
 * loop. For UI specs rendering one value.
 */
export function EditorContextFixture({
  value,
  children,
}: {
  value: EditorContextValue;
  children?: ReactNode;
}) {
  return createElement(
    EditorContext.Provider,
    { value },
    createElement(
      EditorStateStoreContext.Provider,
      { value: createEditorStateStore(value) },
      children,
    ),
  );
}
