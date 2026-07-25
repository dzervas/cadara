import { useCallback } from "react";

import type {
  EditorEvent,
  EditorViewState,
} from "@/domain/editor/state-machine";
import type {
  ModelingDiagnostic,
  WorkspaceSnapshot,
} from "@/contracts/modeling/schema";
import type { ImportProvider } from "@/contracts/import/provider";
import type { FeatureEditorFormSchema } from "@/core/feature-authoring/form-schema";
import {
  createAppError,
  errorContext,
  isAppError,
  normalizeUnknownError,
  type ErrorReporter,
} from "@/contracts/errors";
import {
  createImportCapabilities,
  createImportSession,
  resolveLocalFileImportSource,
} from "@/domain/import/orchestrator";
import type { ImportProviderRegistry } from "@/domain/import/provider-registry";
import type { ImportHistoryProbeCapabilities } from "@/contracts/import/capabilities";
import type { GeometryAssetStore } from "@/domain/modeling/geometry-asset-store";
import { getBrowserGeometryAssetComposition } from "@/infrastructure/modeling/browser-geometry-asset-store";
import { createBrowserOccImportHistoryProbe } from "@/infrastructure/occ/browser-import-history-probe";
import type { ModelingService } from "@/domain/modeling/modeling-service";
import { useWorkbenchDocumentOwner } from "@/hooks/use-workbench-document-owner";
import { useRuntimeExtensionRegistry } from "@/hooks/use-runtime-extension-registry";
import { handleWorkbenchFailure } from "@/workbench/commands/failure-policy";
import { showOpenImportFilePicker } from "@/lib/import-file-picker";

/**
 * Extract a human-readable message from an unknown thrown value by walking the
 * AppError message/cause chain instead of relying on an `instanceof Error`
 * guard (which silently drops AppError context and nested causes).
 */
function describeImportError(error: unknown, fallback: string): string {
  const appError = normalizeUnknownError(error, { fallbackMessage: fallback });
  const parts: string[] = [appError.message];
  const seen = new Set<unknown>();
  let cause: unknown = appError.cause;

  while (cause && !seen.has(cause)) {
    seen.add(cause);
    let message: string | null = null;
    if (isAppError(cause)) {
      message = cause.message;
      cause = cause.cause;
    } else if (cause instanceof Error) {
      message = cause.message;
      cause = (cause as { cause?: unknown }).cause;
    } else {
      break;
    }
    if (message && message.trim() && message !== parts[parts.length - 1]) {
      parts.push(message);
    }
  }

  return parts.join(": ");
}

function describeImportDiagnostics(diagnostics: readonly ModelingDiagnostic[]) {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const messages = errors.flatMap((diagnostic) => {
    const nested = diagnostic.detail?.kind === "advancedFeatureValidation"
      ? diagnostic.detail.diagnostic
      : null;
    if (nested && nested.message !== diagnostic.message) {
      return [diagnostic.message, `${nested.code}: ${nested.message}`];
    }
    if (diagnostic.detail?.kind === "invalidReference") {
      return [
        diagnostic.message,
        `${diagnostic.code}: ${diagnostic.detail.reference.reason} — ${JSON.stringify(diagnostic.detail.reference.target)}`,
      ];
    }
    return [diagnostic.message];
  });
  const unique = [...new Set(messages.filter((message) => message.trim().length > 0))];
  return unique.join("\n") || diagnostics[0]?.message || "Import failed.";
}

function promptForImportProvider(
  providers: readonly ImportProvider<
    unknown,
    unknown,
    FeatureEditorFormSchema
  >[],
) {
  if (typeof window === "undefined") {
    return providers[0] ?? null;
  }

  const message = providers
    .map((provider, index) => `${index + 1}. ${provider.label}`)
    .join("\n");
  const response = window.prompt(
    `Multiple importers match this file.\n${message}\n\nChoose a provider number:`,
  );
  const selectedIndex = Number.parseInt(response ?? "", 10);

  if (
    !Number.isFinite(selectedIndex) ||
    selectedIndex < 1 ||
    selectedIndex > providers.length
  ) {
    return null;
  }

  return providers[selectedIndex - 1] ?? null;
}

interface WorkbenchPartImportControllerInput {
  activeEditSession: EditorViewState["activeEditSession"];
  activeSketchPlaneEditSession?: EditorViewState["activeSketchPlaneEditSession"];
  activeImportSession: EditorViewState["activeImportSession"];
  deps?: Partial<WorkbenchPartImportDependencies>;
  dispatch: (event: EditorEvent) => void;
  errorReporter: ErrorReporter;
  modelingService: ModelingService;
  showWorkbenchError: (message: string) => void;
  showWorkbenchInfo: (message: string) => void;
  snapshot: WorkspaceSnapshot | null;
}

interface WorkbenchPartImportDependencies {
  createCapabilities: typeof createImportCapabilities;
  createImportHistoryProbe: () => ImportHistoryProbeCapabilities;
  /** Shared browser composition store used by review baking and kernel reads. */
  geometryAssetStore: GeometryAssetStore;
  createSession: typeof createImportSession;
  documentOwner: Pick<
    ReturnType<typeof useWorkbenchDocumentOwner>,
    "commitPartImport"
  >;
  importProviders: ImportProviderRegistry;
  openImportFilePicker: typeof showOpenImportFilePicker;
  promptForProvider: typeof promptForImportProvider;
  resolveImportSource: typeof resolveLocalFileImportSource;
}

export function useWorkbenchPartImport({
  activeEditSession,
  activeSketchPlaneEditSession = null,
  activeImportSession,
  deps,
  dispatch,
  errorReporter,
  modelingService,
  showWorkbenchError,
  showWorkbenchInfo,
  snapshot,
}: WorkbenchPartImportControllerInput) {
  const hookDocumentOwner = useWorkbenchDocumentOwner();
  const runtimeExtensionRegistry = useRuntimeExtensionRegistry();
  const documentOwner = deps?.documentOwner ?? hookDocumentOwner;
  const importProviders =
    deps?.importProviders ?? runtimeExtensionRegistry.importProviders;
  const openImportFilePicker =
    deps?.openImportFilePicker ?? showOpenImportFilePicker;
  const resolveImportSource =
    deps?.resolveImportSource ?? resolveLocalFileImportSource;
  const createCapabilities =
    deps?.createCapabilities ?? createImportCapabilities;
  const createImportHistoryProbe =
    deps?.createImportHistoryProbe ?? createBrowserOccImportHistoryProbe;
  const geometryAssetStore =
    deps?.geometryAssetStore ?? getBrowserGeometryAssetComposition().assetStore;
  const createSession = deps?.createSession ?? createImportSession;
  const promptForProvider = deps?.promptForProvider ?? promptForImportProvider;

  const commitImportSession = useCallback(async () => {
    if (!activeImportSession || !snapshot) {
      return;
    }

    dispatch({ type: "import.commitRequested" });

    try {
      // Capture the pristine pre-import authored document so that a mid-apply
      // failure can be undone with a single atomic restore instead of replaying
      // N durable-history undos. The per-operation undo path could strand a
      // half-built document or hang for 90s on repository undo synchronization
      // when the apply pipeline failed mid-sequence; restoring the captured
      // document rebuilds the exact pre-import state in one step.
      const exported = await modelingService.exportCurrentDocument();
      const preImportDocument = JSON.parse(
        typeof exported.payload === "string"
          ? exported.payload
          : new TextDecoder().decode(exported.payload),
      ) as unknown;
      const rollback = async () => {
        // Flush any in-flight background persistence first so a queued write
        // cannot re-commit the half-built document after the restore lands.
        await modelingService.waitForPersistence();
        const restored = await modelingService.importDocument({
          document: preImportDocument,
        });
        if (!restored.ok) {
          throw new Error(describeImportDiagnostics(restored.diagnostics));
        }
      };
      const result = await documentOwner.commitPartImport(activeImportSession, {
        rollback,
      });
      if (!result.ok) {
        dispatch({ type: "import.failed", diagnostics: result.diagnostics });
        showWorkbenchError(describeImportDiagnostics(result.diagnostics));
        return;
      }

      dispatch({ type: "import.committed" });
      if (result.createdEntityIds.sketchIds.length === 1) {
        dispatch({
          type: "authoring.reopenRequested",
          target: {
            kind: "sketch",
            sketchId: result.createdEntityIds.sketchIds[0]!,
          },
          toolId: "sketch",
        });
      }
      showWorkbenchInfo(`Imported ${activeImportSession.resolvedSource.name}.`);
    } catch (error: unknown) {
      const message = describeImportError(error, "Import failed.");
      dispatch({
        type: "import.failed",
        diagnostics: [
          {
            code: "import-commit-failed",
            severity: "error",
            message,
            target: null,
            detail: null,
          },
        ],
      });
      handleWorkbenchFailure({
        appError: createAppError({
          code: "workbench/action-failed",
          message,
          context: errorContext("operation", "commitPartImport"),
          cause: error,
        }),
        reporter: errorReporter,
        metadata: {
          source: "workbench.import.commit",
          visibility: "user",
          dedupeKey: `workbench.import.commit:${message}`,
        },
        reportability: "reportable",
        userMessage: message,
        notify: showWorkbenchError,
      });
    }
  }, [
    activeImportSession,
    dispatch,
    documentOwner,
    modelingService,
    errorReporter,
    showWorkbenchError,
    showWorkbenchInfo,
    snapshot,
  ]);

  const requestPartImport = useCallback(async () => {
    if (
      activeEditSession ||
      activeSketchPlaneEditSession ||
      activeImportSession
    ) {
      return;
    }

    if (!snapshot) {
      showWorkbenchError("The current document is still loading.");
      return;
    }

    const acceptedFileTypes = importProviders.getAcceptedFileTypes();
    if (acceptedFileTypes.length === 0) {
      showWorkbenchError("No part importers are currently registered.");
      return;
    }

    const pickerResult = await openImportFilePicker({
      acceptedFileTypes,
    });

    if (!pickerResult.ok) {
      if (pickerResult.reason === "failed") {
        showWorkbenchError("Import file selection failed.");
      }
      return;
    }

    const file = pickerResult.files[0];
    if (!file) {
      showWorkbenchError("Import file selection failed.");
      return;
    }

    const resolvedSource = await resolveImportSource(file);
    const matchedProviders = importProviders.matchProviders(resolvedSource);

    if (matchedProviders.length === 0) {
      showWorkbenchError(
        `No importer is available for ${resolvedSource.name}.`,
      );
      return;
    }

    const provider =
      matchedProviders.length === 1
        ? matchedProviders[0]!
        : promptForProvider(matchedProviders);

    if (!provider) {
      return;
    }

    try {
      const session = await createSession({
        provider,
        source: resolvedSource,
        capabilities: createCapabilities(modelingService, snapshot, {
          history: createImportHistoryProbe(),
          assetStore: geometryAssetStore,
        }),
      });
      dispatch({ type: "import.fileSelected", session });
    } catch (error: unknown) {
      const message = describeImportError(error, "Import review failed.");
      handleWorkbenchFailure({
        appError: createAppError({
          code: "workbench/action-failed",
          message,
          context: errorContext("operation", "requestPartImport"),
          cause: error,
        }),
        reporter: errorReporter,
        metadata: {
          source: "workbench.import.review",
          visibility: "user",
          dedupeKey: `workbench.import.review:${message}`,
        },
        reportability: "reportable",
        userMessage: message,
        notify: showWorkbenchError,
      });
    }
  }, [
    activeEditSession,
    activeSketchPlaneEditSession,
    activeImportSession,
    createCapabilities,
    createImportHistoryProbe,
    createSession,
    geometryAssetStore,
    dispatch,
    errorReporter,
    importProviders,
    modelingService,
    openImportFilePicker,
    promptForProvider,
    resolveImportSource,
    showWorkbenchError,
    snapshot,
  ]);

  return {
    commitImportSession,
    requestPartImport,
  };
}
