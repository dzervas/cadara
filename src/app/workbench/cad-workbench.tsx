import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader } from "@mantine/core";
import { appVersion, gitCommit } from "virtual:cadara-build-metadata";

import { ThreeCadViewport } from "@/components/cad/three-cad-viewport";
import { SketchSpecialModePanel } from "@/components/cad/sketch-special-mode-panel";
import { SketchToolPanel } from "@/components/cad/sketch-tool-panel";
import { FeatureInspector } from "@/components/layout/feature-inspector";
import { FloatingPartsTree } from "@/components/layout/floating-parts-tree";
import { ImportInspector } from "@/components/layout/import-inspector";
import { SketchPlaneInspector } from "@/components/layout/sketch-plane-inspector";
import {
  DocumentTabsBar,
  type DocumentTabsBarHandle,
} from "@/components/layout/document-tabs-bar";
import { BrowserTabCloseWarningModal } from "@/components/layout/browser-tab-close-warning-modal";
import { HistoryTimelineShell } from "@/components/layout/history-timeline-shell";
import { MeasurementPanel } from "@/components/layout/measurement-panel";
import { DocumentExportModal } from "@/components/layout/document-export-modal";
import {
  OpenDocumentModal,
  SaveAsDocumentModal,
} from "@/components/layout/document-file-menu";
import { WorkbenchInspectorOverlay } from "@/components/layout/workbench-inspector-overlay";
import { WorkspaceToolbar } from "@/components/layout/workspace-toolbar";
import { WorkbenchVariablesFab } from "@/components/layout/workbench-variables-fab";
import { WorkbenchVariablesPanel } from "@/components/layout/workbench-variables-panel";
import {
  WorkbenchStateDebugger,
  type WorkbenchStateDebuggerModel,
} from "@/components/layout/workbench-state-debugger";
import { WorkbenchNotification } from "@/components/layout/workbench-notification";
import {
  hasNonEmptyCommittedGeometry,
  isInitialOccRenderPending,
} from "@/app/workbench/initial-occ-render-state";
import type { PerformanceTelemetry } from "@/contracts/performance/telemetry";
import {
  noopPerformanceTelemetry,
  recordPerformanceMark,
} from "@/contracts/performance/telemetry";
import {
  composeViewportRenderables,
  isTargetHidden,
} from "@/app/workbench/shell/viewport-renderables";
import { createObjectExportModalState } from "@/domain/export/object-export-state";
import { createCadaraDebugSession } from "@/app/debug/cadara-debug-session";
import { selectCadaraDebugTarget } from "@/app/debug/cadara-debug-actions";
import {
  exportWorkbenchDocument,
  saveWorkbenchLocalFile,
} from "@/application/workbench/document-file-actions";
import { getBrowserOnlyTabCloseWarning } from "@/app/workbench/document/browser-tab-close";
import type { WorkbenchDocumentActionResult } from "@/application/workbench/document-file-actions";
import type {
  WorkbenchTab,
  WorkbenchTabsState,
} from "@/domain/workspace/workbench-tabs";
import type { DocumentId } from "@/contracts/shared/ids";
import { useWorkbenchHistory } from "@/app/workbench/controllers/use-workbench-history";
import { useWorkbenchDocumentPresentation } from "@/app/workbench/controllers/use-workbench-document-presentation";
import { useWorkbenchLocalFileSync } from "@/app/workbench/controllers/use-workbench-local-file-sync";
import { useWorkbenchNotifications } from "@/app/workbench/controllers/use-workbench-notifications";
import { useWorkbenchPartImport } from "@/app/workbench/controllers/use-workbench-part-import";
import { useWorkbenchViewportEvents } from "@/app/workbench/controllers/use-workbench-viewport-events";
import { handleWorkbenchFailure } from "@/app/workbench/failure-policy";
import { runReportedAction as runWorkbenchAction } from "@/lib/reported-action";
import type {
  DocumentFeatureCursor,
  DocumentHistoryItemRecord,
} from "@/contracts/modeling/schema";
import { createAppError, errorContext, ok } from "@/contracts/errors";
import {
  getSketchAnnotationDescriptors,
  getSketchToolPresentation,
} from "@/domain/editor/sketch-session";
import {
  getSketchSpecialModePanel,
  getSketchSpecialModeViewportPresentation,
} from "@/core/sketch-special-modes/presentation";
import {
  getPrimitiveRefLabel,
  getPrimitiveRefKey,
  isDurablePrimitiveRef,
  primitiveRefEquals,
  type PrimitiveRef,
} from "@/core/editor/schema";
import {
  getAutoHiddenSketchTargetKeys,
  getWorkbenchVisibilityState,
  reconcileVisibilityIntentKeys,
  toggleWorkbenchTargetVisibility,
} from "@/domain/editor/visibility";
import {
  getFeatureSnapshot,
  getSelectionDetail,
  getTargetContributingFeatureIds,
} from "@/domain/modeling/document-snapshot-view";
import { deriveMeasurementViewModel } from "@/domain/measure/measurement";
import { createTopologyDebugSummary } from "@/domain/modeling/topology-debug";
import { installConsoleLoggingSubscribers } from "@/domain/tools/console-logging";
import { useCadaraDebugPlatform } from "@/app/debug/use-cadara-debug-platform";
import { useEditorState } from "@/hooks/use-editor-state";
import { useErrorReporter } from "@/hooks/use-error-reporter";
import { useFeatureEditing } from "@/hooks/use-feature-editing";
import { useDurableHistory } from "@/hooks/use-durable-history";
import { useWorkbenchDocumentOwner } from "@/hooks/use-workbench-document-owner";
import { useModelingService } from "@/hooks/use-modeling-service";
import { useRuntimeExtensionRegistry } from "@/hooks/use-runtime-extension-registry";
import { WorkbenchCommandProvider } from "@/hooks/workbench-command-provider";
import { ShortcutProvider } from "@/hooks/shortcut-provider";
import { useToolActionBus, useToolActions } from "@/hooks/use-tool-actions";
import { downloadDocumentExportResult } from "@/lib/download-export";
import {
  createWorkbenchShortcutCommandHandlers,
  getWorkbenchShortcutActiveScopes,
} from "@/app/workbench/commands/workbench-shortcuts";
import {
  WORKBENCH_STATUS_TOP_STYLE,
  WORKBENCH_STATUS_TOP_WITH_RESTORE_STYLE,
  VIEWPORT_FLOATING_PANEL_LEFT_PX,
  VIEWPORT_FLOATING_PANEL_TOP_STYLE,
  getWorkbenchNotificationRightOffsetPx,
} from "@/components/cad/viewport-overlay-layout";
import {
  createBugReportDebugArtifact,
  createBugReportIssueDraft,
  createBugReportPayload,
  createBugReportStateArchive,
  createFallbackBugReportIssueUrl,
  downloadBugReportDebugArtifact,
  type BugReportArtifactStatus,
} from "@/domain/bug-reporting/report";
import { getBuildModeLabel } from "@/components/layout/build-metadata";

type FeatureHistoryItem = Extract<
  DocumentHistoryItemRecord,
  { kind: "feature" }
>;
type SketchHistoryItem = Extract<DocumentHistoryItemRecord, { kind: "sketch" }>;
type BrowserTabCloseSaveAction = "downloadCopy" | "saveLinked";

interface CadWorkbenchProps {
  tabsState: WorkbenchTabsState;
  onActivateDocumentTab: (documentId: DocumentId) => void;
  onCloseDocumentTab: (documentId: DocumentId) => void;
  onCreateNewDocument: () => Promise<DocumentId>;
  onOpenDocumentCopy: (file: File) => Promise<WorkbenchDocumentActionResult>;
  onOpenLinkedDocument: () => Promise<WorkbenchDocumentActionResult>;
  performanceTelemetry?: PerformanceTelemetry;
  onReorderDocumentTab: (documentId: DocumentId, toIndex: number) => void;
  onSyncActiveDocumentTab: (tab: WorkbenchTab) => void;
}

export function CadWorkbench({
  tabsState,
  onActivateDocumentTab,
  onCloseDocumentTab,
  onCreateNewDocument,
  onOpenDocumentCopy,
  onOpenLinkedDocument,
  performanceTelemetry = noopPerformanceTelemetry,
  onReorderDocumentTab,
  onSyncActiveDocumentTab,
}: CadWorkbenchProps) {
  const actionBus = useToolActionBus();
  const durableHistory = useDurableHistory();
  const modelingService = useModelingService();
  const { sketchSpecialModes } = useRuntimeExtensionRegistry();
  const documentOwner = useWorkbenchDocumentOwner();
  const errorReporter = useErrorReporter();
  const {
    machineState,
    state: {
      activeCommand,
      activeSectionView,
      selection,
      hoverTarget,
      sketchSession,
      activeEditSession,
      activeSketchPlaneEditSession,
      activeImportSession,
      mode,
      preview,
      selectionFilter,
      selectionCatalog,
      activeReferencePickerFieldId,
      history,
    },
    dispatch,
    getRuntimeTrace,
  } = useEditorState();
  const snapshot = machineState.snapshot;
  const sketchDraftSyncRef = useRef<{
    documentId: DocumentId | null;
    draftKey: string | null;
    sessionHash: string | null;
    wasDragging: boolean;
  }>({
    documentId: null,
    draftKey: null,
    sessionHash: null,
    wasDragging: false,
  });
  const previousSketchDraftRef = useRef<{
    documentId: DocumentId;
    draftKey: string;
  } | null>(null);
  const initialOccRenderPending = isInitialOccRenderPending(machineState);
  const previewRenderables = machineState.previewRenderables;
  const [variablesPanelOpen, setVariablesPanelOpen] = useState(false);
  const [openDocumentModalOpened, setOpenDocumentModalOpened] = useState(false);
  const [saveAsDocumentModalOpened, setSaveAsDocumentModalOpened] =
    useState(false);
  const [browserTabCloseWarning, setBrowserTabCloseWarning] =
    useState<WorkbenchTab | null>(null);
  const [
    pendingBrowserTabCloseSaveAction,
    setPendingBrowserTabCloseSaveAction,
  ] = useState<BrowserTabCloseSaveAction | null>(null);
  const [isBrowserTabCloseSavePending, setIsBrowserTabCloseSavePending] =
    useState(false);
  const snapshotRef = useRef(snapshot);
  const firstSnapshotReadyRecordedRef = useRef(false);
  const notificationRightOffset = getWorkbenchNotificationRightOffsetPx({
    reserveViewCube: true,
  });
  // TODO: Replace with the cloud-save capability flag when cloud persistence is implemented.
  const cloudSaveEnabled = false;
  const {
    invalidVariableValueMessages,
    objectExportModal,
    objectLabelOverrides,
    rawExplicitHiddenTargetKeys,
    rawExplicitlyShownAutoHiddenTargetKeys,
    setInvalidVariableValueMessages,
    setObjectExportModal,
    setObjectLabelOverrides,
    setRawExplicitHiddenTargetKeys,
    setRawExplicitlyShownAutoHiddenTargetKeys,
    viewportFitRequestId,
  } = useWorkbenchDocumentPresentation();
  const {
    reportDocumentFileActionFailure,
    restoreMessage,
    setRestoreMessage,
    setWorkbenchStatusNotification,
    showWorkbenchError,
    showWorkbenchInfo,
    workbenchStatusNotification,
  } = useWorkbenchNotifications({
    errorReporter,
    modelingService,
  });

  useEffect(() => installConsoleLoggingSubscribers(actionBus), [actionBus]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    if (typeof window === "undefined" || !snapshot) {
      return;
    }

    const firstSnapshotReadyAt =
      window.__cadOccPerf?.firstSnapshotReadyAt ?? performance.now();
    window.__cadOccPerf = {
      warmupStatus: "idle",
      ...window.__cadOccPerf,
      firstSnapshotReadyAt,
    };
    if (firstSnapshotReadyRecordedRef.current) {
      return;
    }
    firstSnapshotReadyRecordedRef.current = true;
    recordPerformanceMark(performanceTelemetry, {
      name: "Startup first snapshot ready",
      op: "cad.startup",
      attributes: {
        "cadara.seam": "startup",
        "cadara.operation": "firstSnapshotReady",
        "cadara.startup_phase": "first_snapshot_ready",
        "cadara.feature_count": snapshot.document.features.length,
        "cadara.sketch_count": snapshot.document.sketches.length,
        "cadara.body_count": snapshot.document.bodies.length,
        "cadara.render_record_count": snapshot.document.render.records.length,
        "cadara.diagnostic_count": snapshot.document.diagnostics.length,
      },
    });
  }, [performanceTelemetry, snapshot]);

  // TODO: Move the perf bridge to its own file
  useEffect(() => {
    if (typeof window === "undefined" || !shouldEnableOccPerfBridge()) {
      return;
    }

    window.__cadMeasureOccMutation = async () => {
      const currentSnapshot = snapshotRef.current;
      if (!currentSnapshot) {
        return null;
      }

      const startedAt = performance.now();
      const result = await modelingService.addDocumentVariable({
        baseRevisionId: currentSnapshot.document.revisionId,
        name: `__cad_occ_perf_${Date.now()}`,
        valueText: "1",
      });
      const elapsedMs = performance.now() - startedAt;

      window.__cadOccPerf = {
        warmupStatus: "idle",
        ...window.__cadOccPerf,
        lastMutationLatencyMs: elapsedMs,
      };

      return result.match(
        (value) => ({
          elapsedMs,
          revisionId: value.revisionId,
          accepted: value.revisionState.kind === "accepted",
        }),
        () => ({
          elapsedMs,
          revisionId: currentSnapshot.document.revisionId,
          accepted: false,
        }),
      );
    };

    return () => {
      delete window.__cadMeasureOccMutation;
    };
  }, [modelingService]);

  const { localFileBindingMetadata, localFileSyncEnabled } =
    useWorkbenchLocalFileSync({
      modelingService,
      reportDocumentFileActionFailure,
      showWorkbenchError,
      showWorkbenchInfo,
    });
  const showBrowserStorageWarning = !localFileSyncEnabled && !cloudSaveEnabled;
  const tabsBarRef = useRef<DocumentTabsBarHandle | null>(null);

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    onSyncActiveDocumentTab({
      documentId: snapshot.document.documentId,
      title: snapshot.document.name,
      storageKind: localFileBindingMetadata ? "filesystem" : "browser",
      storageDescriptor: localFileBindingMetadata?.fileName ?? null,
    });
  }, [localFileBindingMetadata, onSyncActiveDocumentTab, snapshot]);
  const handleTabClose = useCallback(
    (documentId: DocumentId) => {
      const browserOnlyTab = getBrowserOnlyTabCloseWarning(
        tabsState,
        documentId,
      );
      if (browserOnlyTab) {
        setBrowserTabCloseWarning(browserOnlyTab);
        setPendingBrowserTabCloseSaveAction(null);
        setIsBrowserTabCloseSavePending(false);
        return;
      }

      onCloseDocumentTab(documentId);
    },
    [onCloseDocumentTab, tabsState],
  );
  const cancelBrowserTabCloseWarning = useCallback(() => {
    if (isBrowserTabCloseSavePending) {
      return;
    }
    setBrowserTabCloseWarning(null);
    setPendingBrowserTabCloseSaveAction(null);
    setIsBrowserTabCloseSavePending(false);
  }, [isBrowserTabCloseSavePending]);
  const closeBrowserTabWithoutSaving = useCallback(() => {
    if (!browserTabCloseWarning || isBrowserTabCloseSavePending) {
      return;
    }

    onCloseDocumentTab(browserTabCloseWarning.documentId);
    setBrowserTabCloseWarning(null);
    setPendingBrowserTabCloseSaveAction(null);
    setIsBrowserTabCloseSavePending(false);
  }, [
    browserTabCloseWarning,
    isBrowserTabCloseSavePending,
    onCloseDocumentTab,
  ]);
  const requestBrowserTabCloseSave = useCallback(
    (action: BrowserTabCloseSaveAction) => {
      if (!browserTabCloseWarning || isBrowserTabCloseSavePending) {
        return;
      }

      setPendingBrowserTabCloseSaveAction(action);
      setIsBrowserTabCloseSavePending(true);
      if (
        modelingService.currentDocumentId !== browserTabCloseWarning.documentId
      ) {
        onActivateDocumentTab(browserTabCloseWarning.documentId);
      }
    },
    [
      browserTabCloseWarning,
      isBrowserTabCloseSavePending,
      modelingService.currentDocumentId,
      onActivateDocumentTab,
    ],
  );
  const handleTabReorder = useCallback(
    (documentId: DocumentId, toIndex: number) => {
      onReorderDocumentTab(documentId, toIndex);
    },
    [onReorderDocumentTab],
  );
  const handleTabRename = useCallback(
    (documentId: DocumentId, title: string) => {
      if (!snapshot) {
        return;
      }
      if (documentId !== modelingService.currentDocumentId) {
        onActivateDocumentTab(documentId);
        return;
      }

      const previousTitle =
        tabsState.tabs.find((tab) => tab.documentId === documentId)?.title ??
        title;
      void runWorkbenchAction({
        operation: `Rename ${previousTitle}`,
        reporter: errorReporter,
        reporting: { mappedFailure: "expected" },
        context: [
          { key: "baseRevisionId", value: snapshot.document.revisionId },
          { key: "documentId", value: documentId },
        ],
        action: () =>
          documentOwner.renameDocument(title, {
            operation: `Rename ${previousTitle}`,
            fallbackMessage: `Rename ${previousTitle} failed.`,
            context: [
              { key: "baseRevisionId", value: snapshot.document.revisionId },
              { key: "documentId", value: documentId },
            ],
          }),
        mapSuccess: (result) => ok(result),
        onError: (error) => showWorkbenchError(error.message),
      }).then((result) => {
        if (result.isErr()) {
          return;
        }
        showWorkbenchInfo(`Renamed ${previousTitle} to ${title}.`);
      });
    },
    [
      documentOwner,
      errorReporter,
      modelingService.currentDocumentId,
      onActivateDocumentTab,
      showWorkbenchError,
      showWorkbenchInfo,
      snapshot,
      tabsState.tabs,
    ],
  );

  useEffect(() => {
    if (
      !browserTabCloseWarning ||
      !pendingBrowserTabCloseSaveAction ||
      !isBrowserTabCloseSavePending
    ) {
      return;
    }
    if (
      modelingService.currentDocumentId !== browserTabCloseWarning.documentId ||
      snapshot?.document.documentId !== browserTabCloseWarning.documentId
    ) {
      return;
    }

    let disposed = false;

    void (async () => {
      const succeeded =
        pendingBrowserTabCloseSaveAction === "downloadCopy"
          ? await exportWorkbenchDocument({
              modelingService,
              reportDocumentFileActionFailure,
              showWorkbenchInfo,
            })
          : await saveWorkbenchLocalFile({
              modelingService,
              reportDocumentFileActionFailure,
              showWorkbenchError,
              showWorkbenchInfo,
            });

      if (disposed) {
        return;
      }

      setIsBrowserTabCloseSavePending(false);
      setPendingBrowserTabCloseSaveAction(null);
      if (succeeded) {
        onCloseDocumentTab(browserTabCloseWarning.documentId);
        setBrowserTabCloseWarning(null);
      }
    })();

    return () => {
      disposed = true;
    };
  }, [
    browserTabCloseWarning,
    isBrowserTabCloseSavePending,
    modelingService,
    onCloseDocumentTab,
    pendingBrowserTabCloseSaveAction,
    reportDocumentFileActionFailure,
    showWorkbenchError,
    showWorkbenchInfo,
    snapshot?.document.documentId,
  ]);

  const visibleObjectTargetKeys = useMemo(
    () =>
      new Set(
        (snapshot?.presentation.objects ?? []).map((item) =>
          getPrimitiveRefKey(item.target),
        ),
      ),
    [snapshot],
  );
  const explicitHiddenTargetKeys = useMemo(
    () =>
      reconcileVisibilityIntentKeys(
        rawExplicitHiddenTargetKeys,
        visibleObjectTargetKeys,
      ),
    [rawExplicitHiddenTargetKeys, visibleObjectTargetKeys],
  );
  const autoHiddenSketchTargetKeys = useMemo(
    () => getAutoHiddenSketchTargetKeys(snapshot),
    [snapshot],
  );
  const allowedAutoHiddenTargetKeys = useMemo(
    () => new Set(Object.keys(autoHiddenSketchTargetKeys)),
    [autoHiddenSketchTargetKeys],
  );
  const explicitlyShownAutoHiddenTargetKeys = useMemo(
    () =>
      reconcileVisibilityIntentKeys(
        rawExplicitlyShownAutoHiddenTargetKeys,
        allowedAutoHiddenTargetKeys,
      ),
    [allowedAutoHiddenTargetKeys, rawExplicitlyShownAutoHiddenTargetKeys],
  );

  const effectiveHiddenTargetKeys = useMemo(
    () =>
      getWorkbenchVisibilityState({
        snapshot,
        explicitHiddenTargetKeys,
        explicitlyShownAutoHiddenTargetKeys,
        isSketchEditing: sketchSession !== null,
      }).effectiveHiddenTargetKeys,
    [
      explicitHiddenTargetKeys,
      explicitlyShownAutoHiddenTargetKeys,
      sketchSession,
      snapshot,
    ],
  );

  const visibleSelection = useMemo(
    () =>
      selection.filter(
        (target) => !isTargetHidden(target, effectiveHiddenTargetKeys),
      ),
    [effectiveHiddenTargetKeys, selection],
  );
  const historyHighlightFeatureIds = useMemo(
    () =>
      snapshot
        ? getTargetContributingFeatureIds(snapshot, visibleSelection[0] ?? null)
        : [],
    [snapshot, visibleSelection],
  );
  const visibleHoverTarget =
    hoverTarget && !isTargetHidden(hoverTarget, effectiveHiddenTargetKeys)
      ? hoverTarget
      : null;

  const primarySelection = visibleSelection[0] ?? visibleHoverTarget ?? null;
  const selectionDetail =
    snapshot && primarySelection
      ? getSelectionDetail(snapshot, primarySelection)
      : null;
  const activeFeatureSnapshot =
    snapshot && activeEditSession?.featureId
      ? getFeatureSnapshot(snapshot, activeEditSession.featureId)
      : primarySelection?.kind === "feature" && snapshot
        ? getFeatureSnapshot(snapshot, primarySelection.featureId)
        : null;
  const editableFeatureSnapshot = activeFeatureSnapshot ?? null;

  const { commitFeature, cancelFeature } = useFeatureEditing();
  const commitSketchPlaneEdit = useCallback(() => {
    if (!activeCommand || !activeSketchPlaneEditSession) {
      return;
    }

    dispatch({
      type: "command.commitRequested",
      commandSessionId: activeCommand.commandSessionId,
    });
  }, [activeCommand, activeSketchPlaneEditSession, dispatch]);
  const cancelSketchPlaneEdit = useCallback(() => {
    if (!activeCommand || !activeSketchPlaneEditSession) {
      return;
    }

    dispatch({
      type: "command.cancelled",
      commandSessionId: activeCommand.commandSessionId,
    });
  }, [activeCommand, activeSketchPlaneEditSession, dispatch]);
  const { commitImportSession, requestPartImport } = useWorkbenchPartImport({
    activeEditSession,
    activeSketchPlaneEditSession,
    activeImportSession,
    dispatch,
    errorReporter,
    modelingService,
    showWorkbenchError,
    showWorkbenchInfo,
    snapshot,
  });
  const {
    handleDocumentHistoryReorder,
    handleVariableUpdate,
    isDocumentHistoryReorderRunning,
    isUndoRedoRunning,
    requestRedo,
    requestUndo,
    toolbarHistoryAvailability,
  } = useWorkbenchHistory({
    dispatch,
    errorReporter,
    history,
    setInvalidVariableValueMessages,
    showWorkbenchError,
    sketchSession,
    snapshot,
  });
  const { triggerTool } = useToolActions({
    commandHandlers: {
      requestPartImport,
      requestRedo,
      requestUndo,
    },
  });

  useEffect(() => {
    if (!sketchSession || !snapshot) {
      const previousDraft = previousSketchDraftRef.current;
      previousSketchDraftRef.current = null;
      sketchDraftSyncRef.current = {
        documentId: null,
        draftKey: null,
        sessionHash: null,
        wasDragging: false,
      };
      if (previousDraft) {
        void durableHistory.clearSketchDraft(previousDraft);
      }
      return;
    }

    if (sketchSession.activeDrag) {
      sketchDraftSyncRef.current.wasDragging = true;
      return;
    }

    const dragJustEnded = sketchDraftSyncRef.current.wasDragging;
    sketchDraftSyncRef.current.wasDragging = false;

    const documentId = snapshot.document.documentId;
    const draftKey = durableHistory.getSketchDraftKey(sketchSession);
    const sessionHash = `${sketchSession.sketchId}:${sketchSession.sequence}:${sketchSession.historyCursor.kind === "item" ? sketchSession.historyCursor.itemId : "empty"}`;
    const trackedSession = sketchDraftSyncRef.current;
    previousSketchDraftRef.current = { documentId, draftKey };

    let cancelled = false;
    if (
      trackedSession.documentId !== documentId ||
      trackedSession.draftKey !== draftKey
    ) {
      void durableHistory
        .restoreSketchDraft({
          documentId,
          session: sketchSession,
        })
        .then((restoredSession) => {
          if (cancelled) {
            return;
          }

          if (restoredSession) {
            const restoredHash = `${restoredSession.sketchId}:${restoredSession.sequence}:${restoredSession.historyCursor.kind === "item" ? restoredSession.historyCursor.itemId : "empty"}`;
            sketchDraftSyncRef.current = {
              documentId,
              draftKey,
              sessionHash: restoredHash,
              wasDragging: false,
            };
            if (restoredHash !== sessionHash) {
              dispatch({
                type: "sketch.draftHistoryRestored",
                session: restoredSession,
              });
              return;
            }
          }

          sketchDraftSyncRef.current = {
            documentId,
            draftKey,
            sessionHash,
            wasDragging: false,
          };
          void durableHistory.syncSketchDraft({
            documentId,
            session: sketchSession,
          });
        });

      return () => {
        cancelled = true;
      };
    }

    if (trackedSession.sessionHash === sessionHash && !dragJustEnded) {
      return;
    }

    sketchDraftSyncRef.current = {
      documentId,
      draftKey,
      sessionHash,
      wasDragging: false,
    };
    void durableHistory.syncSketchDraft({
      documentId,
      session: sketchSession,
    });

    return () => {
      cancelled = true;
    };
  }, [dispatch, durableHistory, sketchSession, snapshot]);
  const {
    handleNavigationReopen,
    handleSectionClear,
    handleSectionFlip,
    handleSectionOffsetChange,
    handleShellSelect,
    handleSketchGeometryDragEnd,
    handleSketchGeometryDragMove,
    handleSketchGeometryDragStart,
    handleSketchMove,
    handleSketchRelease,
    handleSketchSpecialModeClick,
    handleSketchSpecialModeDoubleClick,
    handleSketchSpecialModeDragEnd,
    handleSketchSpecialModeDragMove,
    handleSketchSpecialModeDragStart,
    handleViewportConnectedSketchSelect,
    handleViewportDeselect,
    handleViewportHover,
    handleViewportHoverClear,
    handleViewportLodTierChange,
    handleViewportSelect,
  } = useWorkbenchViewportEvents({
    activeCommand,
    dispatch,
    modelingService,
    snapshot,
  });
  const viewportRenderables = useMemo(() => {
    return composeViewportRenderables({
      snapshotRenderables: snapshot?.document.render.records ?? [],
      snapshotSketches: snapshot?.document.sketches ?? [],
      previewRenderables,
      sketchSession,
      hiddenTargetKeys: effectiveHiddenTargetKeys,
    });
  }, [effectiveHiddenTargetKeys, previewRenderables, sketchSession, snapshot]);
  const sketchToolPresentation = sketchSession
    ? getSketchToolPresentation(sketchSession)
    : null;
  const sketchSpecialModePanel = sketchSession
    ? getSketchSpecialModePanel(sketchSession, sketchSpecialModes)
    : null;
  const sketchSpecialModeViewportPresentation = sketchSession
    ? getSketchSpecialModeViewportPresentation(
        sketchSession,
        sketchSpecialModes,
      )
    : null;
  const sketchAnnotations = sketchSession
    ? getSketchAnnotationDescriptors(sketchSession)
    : [];

  const debuggerState: WorkbenchStateDebuggerModel = {
    activeMode: mode,
    machineState: machineState.kind,
    command: activeCommand?.toolId ?? "none",
    phase: activeCommand?.phase ?? "idle",
    selectionCount: visibleSelection.length,
    selectionTargets:
      visibleSelection.length > 0
        ? visibleSelection
            .map((target) => getPrimitiveRefLabel(target))
            .join(", ")
        : "Nothing selected",
    revision: snapshot?.document.revisionId ?? "loading",
    snapshotDiagnosticsCount: snapshot?.document.diagnostics.length ?? 0,
    sketchSession: sketchSession?.commitRequest
      ? `${sketchSession.commitRequest.definition.entityIds.length} entities staged`
      : "none",
    sketchPlane: sketchSession?.plane.key?.toUpperCase() ?? "none",
    featureSession: activeEditSession
      ? `${activeEditSession.mode}:${activeEditSession.featureType}:${activeEditSession.status}`
      : "none",
    previewState: preview?.label ?? "No active preview",
    selectionFilterLabel:
      selectionFilter?.label ?? "No active selection filter",
    activeTargetRule:
      selectionFilter?.requirements[0]?.description ?? "No active target rule",
    selectableTargets:
      snapshot?.presentation.entities.map((entity) =>
        getPrimitiveRefLabel(entity.target),
      ) ?? [],
    featureIds:
      snapshot?.document.features.map((feature) => feature.featureId) ?? [],
    previewDiagnostics:
      activeEditSession?.diagnostics
        .map((diagnostic) => `${diagnostic.severity}: ${diagnostic.message}`)
        .join("\n") ?? "",
    requirements:
      selectionFilter?.requirements.map((requirement) => ({
        id: requirement.id,
        label: requirement.label,
        description: requirement.description,
        slotCount: requirement.slots.length,
      })) ?? [],
    selectionDetail: {
      label: selectionDetail?.label ?? "none",
      kindLabel: selectionDetail?.kindLabel ?? "none",
      ownerLabel: selectionDetail?.ownerLabel ?? "n/a",
      relatedLabels: selectionDetail?.relatedLabels ?? [],
      targetLabel: primarySelection
        ? getPrimitiveRefLabel(primarySelection)
        : "none",
    },
    hoverTarget: visibleHoverTarget
      ? getPrimitiveRefLabel(visibleHoverTarget)
      : "none",
    topologyDebug: createTopologyDebugSummary(snapshot),
    sectionOffset: activeSectionView?.offset ?? null,
    sectionRetainedSide: activeSectionView?.retainedSide ?? null,
  };

  const measurementViewModel = useMemo(
    () =>
      deriveMeasurementViewModel({
        activeToolId: activeCommand?.toolId ?? null,
        selection: visibleSelection,
        snapshot,
      }),
    [activeCommand?.toolId, snapshot, visibleSelection],
  );

  useCadaraDebugPlatform({
    getState: () => debuggerState,
    getTrace: () => getRuntimeTrace(),
    selectTarget: (targetId) =>
      selectCadaraDebugTarget({
        targetId,
        snapshot,
        selection,
        selectionFilter,
        selectionCatalog,
        dispatch,
      }),
    clearSelection: () => {
      dispatch({ type: "selection.cleared" });
    },
    refreshDocument: () => {
      dispatch({ type: "document.refreshRequested" });
    },
    exportSession: () =>
      createCadaraDebugSession({
        build: {
          version: appVersion,
          commit: gitCommit,
          mode: getBuildModeLabel(import.meta.env.MODE, import.meta.env.DEV),
        },
        state: debuggerState,
        trace: getRuntimeTrace(),
        location: typeof window === "undefined" ? null : window.location,
      }),
  });

  const handleTargetVisibilityToggle = (target: PrimitiveRef) => {
    const nextVisibility = toggleWorkbenchTargetVisibility({
      target,
      explicitHiddenTargetKeys,
      explicitlyShownAutoHiddenTargetKeys,
      effectiveHiddenTargetKeys,
      autoHiddenSketchTargetKeys,
    });
    const nextEffectiveHiddenTargetKeys = getWorkbenchVisibilityState({
      snapshot,
      explicitHiddenTargetKeys: nextVisibility.explicitHiddenTargetKeys,
      explicitlyShownAutoHiddenTargetKeys:
        nextVisibility.explicitlyShownAutoHiddenTargetKeys,
      isSketchEditing: sketchSession !== null,
    }).effectiveHiddenTargetKeys;

    setRawExplicitHiddenTargetKeys(nextVisibility.explicitHiddenTargetKeys);
    setRawExplicitlyShownAutoHiddenTargetKeys(
      nextVisibility.explicitlyShownAutoHiddenTargetKeys,
    );

    if (
      nextEffectiveHiddenTargetKeys[getPrimitiveRefKey(target)] === true &&
      hoverTarget &&
      (primitiveRefEquals(hoverTarget, target) ||
        isTargetHidden(hoverTarget, nextEffectiveHiddenTargetKeys))
    ) {
      dispatch({ type: "viewport.hoverCleared" });
    }
  };

  // TODO: Split delete logics into separate file
  const handleDeleteTarget = (target: PrimitiveRef, label: string) => {
    if (!snapshot) {
      return;
    }

    if (!isDurablePrimitiveRef(target)) {
      showWorkbenchError(`Delete ${label} failed.`);
      return;
    }

    void runWorkbenchAction({
      operation: `Delete ${label}`,
      reporter: errorReporter,
      reporting: { mappedFailure: "expected" },
      context: [
        { key: "baseRevisionId", value: snapshot.document.revisionId },
        { key: "target", value: getPrimitiveRefKey(target) },
      ],
      action: () =>
        documentOwner.deleteTarget(target, {
          operation: `Delete ${label}`,
          fallbackMessage: `Delete ${label} failed.`,
          context: [
            { key: "baseRevisionId", value: snapshot.document.revisionId },
            { key: "target", value: getPrimitiveRefKey(target) },
          ],
        }),
      mapSuccess: (result) => ok(result),
      onError: (error) => showWorkbenchError(error.message),
    }).then((result) => {
      if (result.isErr()) {
        return;
      }

      showWorkbenchInfo(`Deleted ${label}.`);
    });
  };

  const handleObjectExport = (target: PrimitiveRef, label: string) => {
    const nextModalState = createObjectExportModalState(
      snapshot,
      target,
      label,
    );
    if (!nextModalState) {
      return;
    }

    setWorkbenchStatusNotification(null);
    setObjectExportModal(nextModalState);
  };

  const handleDocumentHistoryExport = (item: SketchHistoryItem) => {
    handleObjectExport(item.target, item.label);
  };

  const handleFeatureSuppressionRequested = (item: FeatureHistoryItem) => {
    if (!snapshot) {
      return;
    }

    const nextSuppressed = !item.suppressed;
    const operation = nextSuppressed
      ? `Suppress ${item.label}`
      : `Unsuppress ${item.label}`;

    void runWorkbenchAction({
      operation,
      reporter: errorReporter,
      reporting: { mappedFailure: "expected" },
      context: [
        { key: "baseRevisionId", value: snapshot.document.revisionId },
        { key: "featureId", value: item.featureId },
      ],
      action: () =>
        documentOwner.setFeatureSuppression(item.featureId, nextSuppressed, {
          operation,
          fallbackMessage: `${operation} failed.`,
          context: [
            { key: "baseRevisionId", value: snapshot.document.revisionId },
            { key: "featureId", value: item.featureId },
          ],
        }),
      mapSuccess: (result) => ok(result),
      onError: (error) => showWorkbenchError(error.message),
    }).then((result) => {
      if (result.isErr()) {
        return;
      }

      showWorkbenchInfo(
        nextSuppressed
          ? `Suppressed ${item.label}.`
          : `Unsuppressed ${item.label}.`,
      );
    });
  };

  // TODO: Split the variable logic into a separate file
  const handleVariableAdd = () => {
    if (!snapshot) {
      return;
    }

    void runWorkbenchAction({
      operation: "Add variable",
      reporter: errorReporter,
      reporting: { mappedFailure: "expected" },
      context: [{ key: "baseRevisionId", value: snapshot.document.revisionId }],
      action: () =>
        documentOwner.addDocumentVariable({
          operation: "Add variable",
          fallbackMessage: "Add variable failed.",
          context: [
            { key: "baseRevisionId", value: snapshot.document.revisionId },
          ],
        }),
      mapSuccess: (result) => ok(result),
      onError: (error) => showWorkbenchError(error.message),
    });
  };

  const handleDocumentHistoryDelete = (item: DocumentHistoryItemRecord) => {
    handleDeleteTarget(item.target, item.label);
  };

  // TODO: Extract renaming logic into a separate file
  const requestRenameLabel = (currentLabel: string) => {
    const nextLabel = window.prompt("Rename", currentLabel)?.trim();

    if (nextLabel === undefined) {
      return null;
    }

    if (!nextLabel) {
      showWorkbenchError("Name cannot be empty.");
      return null;
    }

    if (nextLabel === currentLabel) {
      return null;
    }

    return nextLabel;
  };

  const handleSketchRename = (
    item:
      | SketchHistoryItem
      | { sketchId: SketchHistoryItem["sketchId"]; label: string },
  ) => {
    if (!snapshot) {
      return;
    }

    const nextLabel = requestRenameLabel(item.label);
    if (!nextLabel) {
      return;
    }

    void runWorkbenchAction({
      operation: `Rename ${item.label}`,
      reporter: errorReporter,
      reporting: { mappedFailure: "expected" },
      context: [
        { key: "baseRevisionId", value: snapshot.document.revisionId },
        { key: "sketchId", value: item.sketchId },
      ],
      action: () =>
        documentOwner.renameTarget(
          { kind: "sketch", sketchId: item.sketchId },
          nextLabel,
          {
            operation: `Rename ${item.label}`,
            fallbackMessage: `Rename ${item.label} failed.`,
            context: [
              { key: "baseRevisionId", value: snapshot.document.revisionId },
              { key: "sketchId", value: item.sketchId },
            ],
          },
        ),
      mapSuccess: (result) => ok(result),
      onError: (error) => showWorkbenchError(error.message),
    }).then((result) => {
      if (result.isErr()) {
        return;
      }

      showWorkbenchInfo(`Renamed ${item.label} to ${nextLabel}.`);
    });
  };

  const handleFeatureRename = (
    item:
      | FeatureHistoryItem
      | { featureId: FeatureHistoryItem["featureId"]; label: string },
  ) => {
    if (!snapshot) {
      return;
    }

    const nextLabel = requestRenameLabel(item.label);
    if (!nextLabel) {
      return;
    }

    void runWorkbenchAction({
      operation: `Rename ${item.label}`,
      reporter: errorReporter,
      reporting: { mappedFailure: "expected" },
      context: [
        { key: "baseRevisionId", value: snapshot.document.revisionId },
        { key: "featureId", value: item.featureId },
      ],
      action: () =>
        documentOwner.renameTarget(
          { kind: "feature", featureId: item.featureId },
          nextLabel,
          {
            operation: `Rename ${item.label}`,
            fallbackMessage: `Rename ${item.label} failed.`,
            context: [
              { key: "baseRevisionId", value: snapshot.document.revisionId },
              { key: "featureId", value: item.featureId },
            ],
          },
        ),
      mapSuccess: (result) => ok(result),
      onError: (error) => showWorkbenchError(error.message),
    }).then((result) => {
      if (result.isErr()) {
        return;
      }

      showWorkbenchInfo(`Renamed ${item.label} to ${nextLabel}.`);
    });
  };

  const handleDocumentHistoryRename = (item: DocumentHistoryItemRecord) => {
    if (item.kind === "sketch") {
      handleSketchRename(item);
      return;
    }

    handleFeatureRename(item);
  };

  const handleTargetRename = (target: PrimitiveRef, label: string) => {
    if (target.kind === "sketch") {
      handleSketchRename({ sketchId: target.sketchId, label });
      return;
    }

    if (target.kind === "feature") {
      handleFeatureRename({ featureId: target.featureId, label });
      return;
    }

    if (target.kind === "body") {
      if (!snapshot) {
        return;
      }

      const nextLabel = requestRenameLabel(label);
      if (!nextLabel) {
        return;
      }

      void runWorkbenchAction({
        operation: `Rename ${label}`,
        reporter: errorReporter,
        reporting: { mappedFailure: "expected" },
        context: [
          { key: "baseRevisionId", value: snapshot.document.revisionId },
          { key: "bodyId", value: target.bodyId },
        ],
        action: () =>
          documentOwner.renameTarget(target, nextLabel, {
            operation: `Rename ${label}`,
            fallbackMessage: `Rename ${label} failed.`,
            context: [
              { key: "baseRevisionId", value: snapshot.document.revisionId },
              { key: "bodyId", value: target.bodyId },
            ],
          }),
        mapSuccess: (result) => ok(result),
        onError: (error) => showWorkbenchError(error.message),
      }).then((result) => {
        if (result.isErr()) {
          return;
        }

        setObjectLabelOverrides((current) => {
          const next = { ...current };
          delete next[getPrimitiveRefKey(target)];
          return next;
        });
        showWorkbenchInfo(`Renamed ${label} to ${nextLabel}.`);
      });
      return;
    }

    const nextLabel = requestRenameLabel(label);
    if (!nextLabel) {
      return;
    }

    setObjectLabelOverrides((current) => ({
      ...current,
      [getPrimitiveRefKey(target)]: nextLabel,
    }));
    showWorkbenchInfo(`Renamed ${label} to ${nextLabel}.`);
  };

  const handleTimelineCursorRequested = (cursor: DocumentFeatureCursor) => {
    dispatch({ type: "document.historyCursorRequested", cursor });
  };
  const handleSketchPlaneEditRequest = useCallback(
    (target: Extract<PrimitiveRef, { kind: "sketch" }>) => {
      dispatch({ type: "sketchPlaneEdit.requested", target });
    },
    [dispatch],
  );

  const shortcutActiveScopes = useMemo(
    () => getWorkbenchShortcutActiveScopes(mode),
    [mode],
  );
  const baseShortcutCommandHandlers = createWorkbenchShortcutCommandHandlers({
    activeCommand,
    activeReferencePickerFieldId,
    activateTool: triggerTool,
    canRedo: toolbarHistoryAvailability.canRedo,
    canUndo: toolbarHistoryAvailability.canUndo,
    dispatch,
    mode,
    requestRedo,
    requestUndo,
    selection,
    sketchSession,
  });
  const tabAtIndex = (index: number) => tabsState.tabs[index] ?? null;
  const shortcutCommandHandlers = {
    ...baseShortcutCommandHandlers,
    "document.activateTab1": {
      execute: () => {
        const tab = tabAtIndex(0);
        if (tab) onActivateDocumentTab(tab.documentId);
      },
      isEnabled: () => tabsState.tabs.length >= 1,
    },
    "document.activateTab2": {
      execute: () => {
        const tab = tabAtIndex(1);
        if (tab) onActivateDocumentTab(tab.documentId);
      },
      isEnabled: () => tabsState.tabs.length >= 2,
    },
    "document.activateTab3": {
      execute: () => {
        const tab = tabAtIndex(2);
        if (tab) onActivateDocumentTab(tab.documentId);
      },
      isEnabled: () => tabsState.tabs.length >= 3,
    },
    "document.activateTab4": {
      execute: () => {
        const tab = tabAtIndex(3);
        if (tab) onActivateDocumentTab(tab.documentId);
      },
      isEnabled: () => tabsState.tabs.length >= 4,
    },
    "document.activateTab5": {
      execute: () => {
        const tab = tabAtIndex(4);
        if (tab) onActivateDocumentTab(tab.documentId);
      },
      isEnabled: () => tabsState.tabs.length >= 5,
    },
    "document.activateNext": {
      execute: () => {
        const currentIndex = tabsState.tabs.findIndex(
          (tab) => tab.documentId === tabsState.activeDocumentId,
        );
        const next = tabsState.tabs[(currentIndex + 1) % tabsState.tabs.length];
        if (next) onActivateDocumentTab(next.documentId);
      },
      isEnabled: () => tabsState.tabs.length > 1,
    },
    "document.activatePrevious": {
      execute: () => {
        const currentIndex = tabsState.tabs.findIndex(
          (tab) => tab.documentId === tabsState.activeDocumentId,
        );
        const previousIndex =
          (currentIndex - 1 + tabsState.tabs.length) % tabsState.tabs.length;
        const previous = tabsState.tabs[previousIndex];
        if (previous) onActivateDocumentTab(previous.documentId);
      },
      isEnabled: () => tabsState.tabs.length > 1,
    },
    "document.closeActive": {
      execute: () => handleTabClose(tabsState.activeDocumentId),
      isEnabled: () =>
        tabsState.tabs.length > 1 &&
        tabsState.activeDocumentId !== modelingService.currentDocumentId,
    },
  };

  const createCurrentBugReportPayload = () =>
    createBugReportPayload({
      build: {
        version: appVersion,
        commit: gitCommit,
        mode: getBuildModeLabel(import.meta.env.MODE, import.meta.env.DEV),
      },
      editorState: {
        mode,
        activeCommand,
        selection,
        selectionFilter,
        preview,
        activeEditSession,
        activeReferencePickerFieldId,
        sketchSession,
      },
      snapshot,
      debugTrace: getRuntimeTrace(),
      storage: window.localStorage,
      environment: {
        navigator: window.navigator,
        window,
        document,
      },
    });

  // TODO: This doesn't belong here
  const handleReportBug = () => {
    try {
      const result = createCurrentBugReportPayload();
      const artifact = createBugReportDebugArtifact(result);
      let artifactStatus: BugReportArtifactStatus = { kind: "not-needed" };

      if (artifact) {
        try {
          downloadBugReportDebugArtifact(artifact);
          artifactStatus = { kind: "downloaded", filename: artifact.filename };
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Debug artifact could not be downloaded.";
          artifactStatus = {
            kind: "unavailable",
            filename: artifact.filename,
            reason: message,
          };
          handleWorkbenchFailure({
            appError: createAppError({
              code: "workbench/action-failed",
              message: "Bug-report debug artifact generation failed.",
              context: errorContext("reason", message),
              cause: error,
            }),
            reporter: errorReporter,
            metadata: {
              source: "workbench.reportBug",
              visibility: "developer",
              dedupeKey: `workbench.reportBug.artifact:${message}`,
            },
            reportability: "reportable",
          });
        }
      }

      const issueDraft = createBugReportIssueDraft(result, { artifactStatus });
      const opened = window.open(
        issueDraft.url,
        "_blank",
        "noopener,noreferrer",
      );
      if (!opened) {
        showWorkbenchError(
          "GitHub bug report could not be opened. Check popup blocking for this site.",
        );
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Bug-report payload generation failed.";
      handleWorkbenchFailure({
        appError: createAppError({
          code: "workbench/action-failed",
          message: "Bug-report generation failed.",
          context: errorContext("reason", message),
          cause: error,
        }),
        reporter: errorReporter,
        metadata: {
          source: "workbench.reportBug",
          visibility: "developer",
          dedupeKey: `workbench.reportBug.payload:${message}`,
        },
        reportability: "reportable",
      });

      const opened = window.open(
        createFallbackBugReportIssueUrl(error),
        "_blank",
        "noopener,noreferrer",
      );
      if (!opened) {
        showWorkbenchError(
          "GitHub bug report could not be opened. Check popup blocking for this site.",
        );
      }
    }
  };

  const handleDownloadBugReportState = async () => {
    try {
      const archive = await createBugReportStateArchive(
        createCurrentBugReportPayload(),
        {
          storage: window.localStorage,
          indexedDB: window.indexedDB,
        },
      );

      downloadBugReportDebugArtifact(archive);
      showWorkbenchInfo(`Downloaded ${archive.filename}.`);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Debug state archive could not be downloaded.";
      handleWorkbenchFailure({
        appError: createAppError({
          code: "workbench/action-failed",
          message: "Debug state archive generation failed.",
          context: errorContext("reason", message),
          cause: error,
        }),
        reporter: errorReporter,
        metadata: {
          source: "workbench.downloadBugReportState",
          visibility: "developer",
          dedupeKey: `workbench.downloadBugReportState:${message}`,
        },
        reportability: "reportable",
        userMessage: "Debug state download failed.",
        notify: showWorkbenchError,
      });
    }
  };

  const handleNewDocument = async () => {
    await onCreateNewDocument();
    showWorkbenchInfo("Created a new document.");
  };

  const handleOpenDocument = () => {
    setOpenDocumentModalOpened(true);
  };

  const handleSaveDocumentAs = () => {
    setSaveAsDocumentModalOpened(true);
  };

  const handleOpenDocumentCopy = async (file: File) => {
    const result = await onOpenDocumentCopy(file);
    handleDocumentActionResult(result);
    if (result.status === "success") {
      setOpenDocumentModalOpened(false);
    }
  };

  const handleOpenLinkedDocument = async () => {
    const result = await onOpenLinkedDocument();
    handleDocumentActionResult(result);
    if (result.status === "success") {
      setOpenDocumentModalOpened(false);
    }
  };

  const handleDocumentActionResult = (
    result: WorkbenchDocumentActionResult,
  ) => {
    switch (result.status) {
      case "success":
        showWorkbenchInfo(result.message);
        return;
      case "cancelled":
        return;
      case "user-error":
        showWorkbenchError(result.message);
        return;
      case "unexpected-error":
        reportDocumentFileActionFailure(
          result.source,
          result.message,
          result.error,
        );
    }
  };

  const handleSaveLinkedDocument = async () => {
    await saveWorkbenchLocalFile({
      modelingService,
      reportDocumentFileActionFailure,
      showWorkbenchError,
      showWorkbenchInfo,
    });
    setSaveAsDocumentModalOpened(false);
  };

  const handleDownloadDocumentCopy = async () => {
    await exportWorkbenchDocument({
      modelingService,
      reportDocumentFileActionFailure,
      showWorkbenchInfo,
    });
    setSaveAsDocumentModalOpened(false);
  };

  const handleViewportCanvasCreated = useCallback(() => {
    recordPerformanceMark(performanceTelemetry, {
      name: "Startup viewport canvas created",
      op: "cad.startup",
      attributes: {
        "cadara.seam": "startup",
        "cadara.operation": "viewportCanvasCreated",
        "cadara.startup_phase": "canvas_created",
        "cadara.canvas_created": true,
      },
    });
  }, [performanceTelemetry]);

  const handleFirstNonEmptyGeometryFrame = useCallback(() => {
    recordPerformanceMark(performanceTelemetry, {
      name: "Startup first non-empty geometry frame",
      op: "cad.startup",
      attributes: {
        "cadara.seam": "startup",
        "cadara.operation": "firstNonEmptyGeometryFrame",
        "cadara.startup_phase": "first_non_empty_geometry_frame",
        "cadara.render_record_count":
          viewportRenderables.documentRenderables.length,
        "cadara.body_count": snapshot?.document.bodies.length ?? 0,
      },
    });
    if (typeof window !== "undefined") {
      window.__cadOccPerf = {
        warmupStatus: "idle",
        ...window.__cadOccPerf,
        firstNonEmptyGeometryFrameAt:
          window.__cadOccPerf?.firstNonEmptyGeometryFrameAt ??
          performance.now(),
      };
    }
  }, [
    performanceTelemetry,
    snapshot?.document.bodies.length,
    viewportRenderables.documentRenderables.length,
  ]);

  return (
    <WorkbenchCommandProvider
      handlers={{
        activateTool: triggerTool,
        requestUndo,
        requestRedo,
        requestPartImport,
      }}
    >
      <ShortcutProvider
        activeScopes={shortcutActiveScopes}
        commandHandlers={shortcutCommandHandlers}
      >
        <div className="relative flex h-screen min-h-screen flex-col overflow-hidden bg-(--cad-background) text-(--cad-foreground)">
          <main className="relative min-h-0 flex-1 overflow-hidden bg-(--workbench-viewport-background)">
            <ThreeCadViewport
              renderables={viewportRenderables.documentRenderables}
              sketchDisplayRenderables={
                viewportRenderables.sketchDisplayRenderables
              }
              sketchAnnotations={sketchAnnotations}
              activeSectionView={activeSectionView ?? null}
              hoverTarget={visibleHoverTarget}
              measurementWitnesses={measurementViewModel?.witnesses ?? []}
              onHover={handleViewportHover}
              onSelect={handleViewportSelect}
              onConnectedSketchSelect={handleViewportConnectedSketchSelect}
              onDeselect={handleViewportDeselect}
              onAnnotationEdit={(target) =>
                dispatch({ type: "sketch.annotationEditRequested", target })
              }
              onClearHover={handleViewportHoverClear}
              onSketchMove={handleSketchMove}
              onSketchRelease={handleSketchRelease}
              onSketchGeometryDragStart={handleSketchGeometryDragStart}
              onSketchGeometryDragMove={handleSketchGeometryDragMove}
              onSketchGeometryDragEnd={handleSketchGeometryDragEnd}
              onSpecialModeClick={handleSketchSpecialModeClick}
              onSpecialModeDoubleClick={handleSketchSpecialModeDoubleClick}
              onSpecialModeDragStart={handleSketchSpecialModeDragStart}
              onSpecialModeDragMove={handleSketchSpecialModeDragMove}
              onSpecialModeDragEnd={handleSketchSpecialModeDragEnd}
              onSectionOffsetChange={handleSectionOffsetChange}
              onSectionFlip={handleSectionFlip}
              onSectionClear={handleSectionClear}
              onSketchToolPatch={(patch) =>
                dispatch({ type: "sketch.toolPatched", patch })
              }
              onLodTierChange={handleViewportLodTierChange}
              selection={visibleSelection}
              sketchToolPresentation={sketchToolPresentation}
              specialModePresentation={sketchSpecialModeViewportPresentation}
              fitViewRequestId={viewportFitRequestId}
              hasNonEmptyCommittedGeometry={hasNonEmptyCommittedGeometry(
                viewportRenderables.documentRenderables,
              )}
              onCanvasCreated={handleViewportCanvasCreated}
              onFirstNonEmptyGeometryFrame={handleFirstNonEmptyGeometryFrame}
            />
            {initialOccRenderPending ? (
              <div
                role="status"
                aria-label="Initial model render pending"
                className="absolute inset-0 z-30 grid place-items-center bg-(--workbench-viewport-background)/85"
              >
                <Loader color="gray" size="lg" />
              </div>
            ) : null}
            <SketchToolPanel
              schema={sketchToolPresentation}
              onPatch={(patch) =>
                dispatch({ type: "sketch.toolPatched", patch })
              }
            />
            <SketchSpecialModePanel
              schema={sketchSpecialModePanel}
              onAction={(action) =>
                dispatch({
                  type: "sketch.specialModePanelActionInvoked",
                  action,
                })
              }
            />
            {restoreMessage ? (
              <WorkbenchNotification
                type="error"
                title="History restore failed"
                message={restoreMessage}
                placement={{
                  kind: "viewport",
                  right: notificationRightOffset,
                  top: WORKBENCH_STATUS_TOP_STYLE,
                }}
                action={{
                  label: "Reset stored history",
                  onClick: () => {
                    modelingService.resetOperationHistory();
                    setRestoreMessage(null);
                  },
                }}
                onDismiss={() => setRestoreMessage(null)}
              />
            ) : null}
            {workbenchStatusNotification ? (
              <WorkbenchNotification
                {...workbenchStatusNotification}
                placement={{
                  kind: "viewport",
                  right: notificationRightOffset,
                  top: restoreMessage
                    ? WORKBENCH_STATUS_TOP_WITH_RESTORE_STYLE
                    : WORKBENCH_STATUS_TOP_STYLE,
                }}
                onDismiss={() => setWorkbenchStatusNotification(null)}
              />
            ) : null}
            {sketchSession?.validationMessage ? (
              <div
                role="status"
                className="pointer-events-none absolute z-20 max-w-sm rounded-md border border-(--cad-border-strong) bg-(--cad-surface-overlay) px-3 py-2 text-xs text-(--cad-foreground) shadow-(--cad-panel-shadow)"
                style={{
                  left: VIEWPORT_FLOATING_PANEL_LEFT_PX,
                  top: VIEWPORT_FLOATING_PANEL_TOP_STYLE,
                }}
              >
                {sketchSession.validationMessage}
              </div>
            ) : null}
            {activeImportSession ? (
              <WorkbenchInspectorOverlay>
                <ImportInspector onCommit={() => void commitImportSession()} />
              </WorkbenchInspectorOverlay>
            ) : activeSketchPlaneEditSession ? (
              <WorkbenchInspectorOverlay>
                <SketchPlaneInspector
                  session={activeSketchPlaneEditSession}
                  onPatch={(patch) =>
                    dispatch({ type: "sketchPlaneEdit.patched", patch })
                  }
                  onCommit={commitSketchPlaneEdit}
                  onCancel={cancelSketchPlaneEdit}
                />
              </WorkbenchInspectorOverlay>
            ) : activeEditSession ? (
              <WorkbenchInspectorOverlay>
                <FeatureInspector
                  featureSnapshot={editableFeatureSnapshot}
                  onPatch={(patch) =>
                    dispatch({ type: "form.featurePatched", patch })
                  }
                  onCommit={commitFeature}
                  onCancel={cancelFeature}
                />
              </WorkbenchInspectorOverlay>
            ) : null}
            <DocumentExportModal
              opened={objectExportModal !== null}
              target={objectExportModal}
              exportDocument={(input) => modelingService.exportDocument(input)}
              errorReporter={errorReporter}
              onDownload={downloadDocumentExportResult}
              onClose={() => setObjectExportModal(null)}
            />
            <OpenDocumentModal
              opened={openDocumentModalOpened}
              onClose={() => setOpenDocumentModalOpened(false)}
              onOpenCopy={handleOpenDocumentCopy}
              onOpenLinked={handleOpenLinkedDocument}
            />
            <SaveAsDocumentModal
              opened={saveAsDocumentModalOpened}
              onClose={() => setSaveAsDocumentModalOpened(false)}
              onDownloadCopy={handleDownloadDocumentCopy}
              onSaveLinked={handleSaveLinkedDocument}
            />
            <BrowserTabCloseWarningModal
              opened={browserTabCloseWarning !== null}
              documentTitle={browserTabCloseWarning?.title ?? ""}
              pending={isBrowserTabCloseSavePending}
              onCancel={cancelBrowserTabCloseWarning}
              onCloseWithoutSaving={closeBrowserTabWithoutSaving}
              onDownloadCopy={() => requestBrowserTabCloseSave("downloadCopy")}
              onSaveLinked={() => requestBrowserTabCloseSave("saveLinked")}
            />

            <WorkspaceToolbar
              historyAvailability={toolbarHistoryAvailability}
              showBrowserStorageWarning={showBrowserStorageWarning}
              onNewDocument={handleNewDocument}
              onOpenDocument={handleOpenDocument}
              onSaveDocumentAs={handleSaveDocumentAs}
              onReportBug={handleReportBug}
              onDownloadBugReportState={handleDownloadBugReportState}
            />

            <FloatingPartsTree
              snapshot={snapshot}
              hiddenTargetKeys={effectiveHiddenTargetKeys}
              objectLabelOverrides={objectLabelOverrides}
              visibleSelection={visibleSelection}
              onSelectTarget={handleShellSelect}
              onReopenTarget={handleNavigationReopen}
              onChangeSketchPlaneTarget={handleSketchPlaneEditRequest}
              onObjectDelete={handleDeleteTarget}
              onObjectExport={handleObjectExport}
              onRenameTarget={handleTargetRename}
              onToggleTargetVisibility={handleTargetVisibilityToggle}
            />

            <WorkbenchVariablesFab
              open={variablesPanelOpen}
              onToggle={() => setVariablesPanelOpen((current) => !current)}
            />
            {variablesPanelOpen ? (
              <WorkbenchVariablesPanel
                snapshot={snapshot}
                invalidVariableValueMessages={invalidVariableValueMessages}
                onAddVariable={handleVariableAdd}
                onUpdateVariable={handleVariableUpdate}
                onClose={() => setVariablesPanelOpen(false)}
              />
            ) : null}

            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col">
              <div className="flex flex-col gap-3">
                <div className="flex items-end gap-3 px-4">
                  <WorkbenchStateDebugger state={debuggerState} />
                  <MeasurementPanel measurement={measurementViewModel} />
                </div>
                <HistoryTimelineShell
                  snapshot={snapshot}
                  sketchSession={sketchSession}
                  historyHighlightFeatureIds={historyHighlightFeatureIds}
                  visibleSelection={visibleSelection}
                  onSelectTarget={handleShellSelect}
                  onReopenTarget={handleNavigationReopen}
                  onChangeSketchPlaneTarget={handleSketchPlaneEditRequest}
                  onDocumentCursorRequested={handleTimelineCursorRequested}
                  documentCursorDisabled={!history.canUndo && !history.canRedo}
                  onDocumentHistoryReorder={handleDocumentHistoryReorder}
                  documentHistoryReorderDisabled={
                    Boolean(sketchSession) ||
                    isDocumentHistoryReorderRunning ||
                    isUndoRedoRunning ||
                    (!history.canUndo && !history.canRedo)
                  }
                  onSketchCursorRequested={(cursor) =>
                    dispatch({ type: "sketch.historyCursorRequested", cursor })
                  }
                  onDeleteDocumentItem={handleDocumentHistoryDelete}
                  onExportDocumentItem={handleDocumentHistoryExport}
                  onRenameDocumentItem={handleDocumentHistoryRename}
                  onSuppressFeature={handleFeatureSuppressionRequested}
                />
              </div>
              <div className="pointer-events-auto mt-3">
                <DocumentTabsBar
                  ref={tabsBarRef}
                  state={tabsState}
                  onActivate={onActivateDocumentTab}
                  onClose={handleTabClose}
                  onReorder={handleTabReorder}
                  onRename={handleTabRename}
                />
              </div>
            </div>
          </main>
        </div>
      </ShortcutProvider>
    </WorkbenchCommandProvider>
  );
}

function shouldEnableOccPerfBridge() {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    import.meta.env.DEV ||
    new URLSearchParams(window.location.search).has("cadPerfMode")
  );
}
