import { useEffect, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";

import { getEditorViewState } from "@/domain/editor/state-machine";
import { createAppEditorEffectRuntime } from "@/application/editor/create-app-editor-effect-runtime";
import {
  clearActiveDocumentTelemetryContext,
  createActiveDocumentTelemetryContext,
  publishActiveDocumentTelemetryContext,
} from "@/contracts/errors/telemetry-context";
import { useEditorEventLoop } from "@/hooks/use-editor-event-loop";
import type { EditorExtensionDependencies } from "@/domain/editor/state-machine";
import type { ModelingService } from "@/domain/modeling/modeling-service";
import { EditorContext } from "@/hooks/editor-context";
import { useErrorReporter } from "@/hooks/use-error-reporter";
import { createEditorDebugTraceRecorder } from "@/application/editor/editor-debug-trace";
import { SketchAuthoredActions } from "@/application/editor/sketch-authored-actions";

interface EditorProviderProps extends PropsWithChildren {
  modelingService: ModelingService;
  editorDependencies: EditorExtensionDependencies;
}

export function EditorProvider({
  modelingService,
  editorDependencies,
  children,
}: EditorProviderProps) {
  const errorReporter = useErrorReporter();
  const runtime = useMemo(
    () => createAppEditorEffectRuntime(modelingService),
    [modelingService],
  );
  const stableEditorDependencies = useMemo(
    () => ({
      importProviders: editorDependencies.importProviders,
      sketchSpecialModes: editorDependencies.sketchSpecialModes,
    }),
    [editorDependencies.importProviders, editorDependencies.sketchSpecialModes],
  );
  const traceRecorder = useMemo(() => createEditorDebugTraceRecorder(), []);
  const [sketchActionsByDocument] = useState(
    () => new Map<string, SketchAuthoredActions>(),
  );
  const sketchActions = useMemo(() => {
    const existing = sketchActionsByDocument.get(
      modelingService.currentDocumentId,
    );
    if (existing) return existing;
    const created = new SketchAuthoredActions();
    sketchActionsByDocument.set(modelingService.currentDocumentId, created);
    return created;
  }, [modelingService.currentDocumentId, sketchActionsByDocument]);
  const { machineState, dispatch } = useEditorEventLoop(
    runtime,
    errorReporter,
    stableEditorDependencies,
    undefined,
    traceRecorder.record,
    sketchActions,
  );

  useEffect(() => {
    return modelingService.subscribeToDocumentChanges((event) => {
      if (event.metadata.source === "peer") {
        dispatch({ type: "document.refreshRequested" });
      }
    });
  }, [dispatch, modelingService]);

  useEffect(() => {
    if (!machineState.snapshot) {
      clearActiveDocumentTelemetryContext();
      return undefined;
    }

    publishActiveDocumentTelemetryContext(
      createActiveDocumentTelemetryContext(machineState.snapshot),
    );
    return () => {
      clearActiveDocumentTelemetryContext();
    };
  }, [machineState.snapshot]);

  const value = useMemo(
    () => ({
      machineState,
      state: getEditorViewState(machineState),
      dispatch,
      getRuntimeTrace: () => traceRecorder.getSnapshot(),
    }),
    [dispatch, machineState, traceRecorder],
  );

  return (
    <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
  );
}
