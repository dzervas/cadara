import { createContext } from "react";

import type { Dispatch } from "react";

import type {
  EditorEvent,
  EditorState,
  EditorViewState,
} from "@/domain/editor/state-machine";
import type { EditorRuntimeTraceSnapshot } from "@/domain/debug/debug-platform";
import type { SketchDraftRecoveryController } from "@/application/sketch-draft-recovery/controller";

export interface EditorContextValue {
  machineState: EditorState;
  state: EditorViewState;
  dispatch: Dispatch<EditorEvent>;
  getRuntimeTrace(): EditorRuntimeTraceSnapshot;
  /** Absent in headless/non-browser editor hosts. */
  draftRecovery?: SketchDraftRecoveryController;
}

export const EditorContext = createContext<EditorContextValue | null>(null);
