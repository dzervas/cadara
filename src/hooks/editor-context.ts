import { createContext } from "react";

import type { Dispatch } from "react";

import type {
  EditorEvent,
  EditorState,
  EditorViewState,
} from "@/domain/editor/state-machine";
import type { EditorRuntimeTraceSnapshot } from "@/domain/debug/debug-platform";

export interface EditorContextValue {
  machineState: EditorState;
  state: EditorViewState;
  dispatch: Dispatch<EditorEvent>;
  getRuntimeTrace(): EditorRuntimeTraceSnapshot;
}

export const EditorContext = createContext<EditorContextValue | null>(null);
