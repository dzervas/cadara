// SLOP: Retained shell orchestrator while document/object/debug actions and visible regions are split into named workbench modules.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InitialLoadingStatus } from "@/components/layout/initial-loading-status";
import { useInitialLoadingPhase } from "@/hooks/use-initial-loading-phase";
import { appVersion, gitCommit } from "@/build-info";

import { ThreeCadViewport } from "@/components/cad/three-cad-viewport";
import { useLatestCallbacks } from "@/hooks/use-latest-callbacks";
import { SketchSpecialModePanel } from "@/components/cad/sketch-special-mode-panel";
import { SketchMirrorActions } from "@/components/cad/sketch-mirror-actions";
import { SketchOffsetActions } from "@/components/cad/sketch-offset-actions";
import { SketchSplineActions } from "@/components/cad/sketch-spline-actions";
import { getSketchSessionDiagnosticPresentation } from "@/core/editor/sketch-session/diagnostic-presentation";
import {
  SketchSelectionContextStack,
  SketchValidationStatus,
} from "@/components/cad/sketch-selection-context";
import { SketchDeletedNotice } from "@/components/cad/sketch-deleted-notice";
import {
  getPeerDeletedSketchNotice,
  isMultiSelectionContext,
} from "@/core/editor/state-machine";
import { SketchConstraintList } from "@/components/cad/sketch-constraint-list";
import {
  solvedCubicSpans,
  splineVisibleHandleVectors,
} from "@/contracts/sketch/spline-geometry";
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
import { useTopologyMeasures } from "@/workbench/shell/use-topology-measures";
import { DocumentExportModal } from "@/components/layout/document-export-modal";
import {
  OpenDocumentModal,
  SaveAsDocumentModal,
} from "@/components/layout/document-file-menu";
import { WorkbenchInspectorOverlay } from "@/components/layout/workbench-inspector-overlay";
import { WorkspaceToolbar } from "@/components/layout/workspace-toolbar";
import {
  WORKBENCH_VARIABLES_FAB_BOTTOM_PX,
  WORKBENCH_VARIABLES_FAB_SIZE_PX,
  WorkbenchVariablesFab,
} from "@/components/layout/workbench-variables-fab";
import { WorkbenchVariablesPanel } from "@/components/layout/workbench-variables-panel";
import {
  WorkbenchStateDebugger,
  type WorkbenchStateDebuggerModel,
} from "@/components/layout/workbench-state-debugger";
import { WorkbenchNotification } from "@/components/layout/workbench-notification";
import type { WorkbenchNotificationModel } from "@/components/layout/workbench-notification-model";
import {
  hasNonEmptyCommittedGeometry,
  isInitialOccRenderPending,
} from "@/workbench/runtime/initial-occ-render-state";
import {
  getDocumentRefreshFailureNotification,
  getEditorFailureNotification,
} from "@/workbench/runtime/document-refresh-failure";
import { installOccPerfMutationBridge } from "@/workbench/runtime/occ-performance-bridge";
import type { PerformanceTelemetry } from "@/contracts/performance/telemetry";
import {
  noopPerformanceTelemetry,
  recordPerformanceMark,
} from "@/contracts/performance/telemetry";
import {
  composeViewportDocumentRenderables,
  composeViewportSketchDisplayRenderables,
  getBodyDisplayColors,
  isTargetHidden,
} from "@/workbench/shell/viewport-renderables";
import { createObjectExportModalState } from "@/core/export/object-export-state";
import { createCadaraDebugSession } from "@/workbench/debug/cadara-debug-session";
import { selectCadaraDebugTarget } from "@/workbench/debug/cadara-debug-actions";
import {
  exportWorkbenchDocument,
  saveWorkbenchLocalFile,
} from "@/workbench/document/document-file-actions";
import { getBrowserOnlyTabCloseWarning } from "@/workbench/document/browser-tab-close";
import type { WorkbenchDocumentActionResult } from "@/workbench/document/document-file-actions";
import type {
  WorkbenchTab,
  WorkbenchTabsState,
} from "@/core/workspace/workbench-tabs";
import type { BodyId, DocumentId } from "@/contracts/shared/ids";
import {
  resolveBodyAppearanceHex,
  type BodyAppearance,
} from "@/contracts/modeling/body-appearance";
import { useWorkbenchHistory } from "@/workbench/adapters/use-workbench-history";
import { useWorkbenchDocumentPresentation } from "@/workbench/adapters/use-workbench-document-presentation";
import { useWorkbenchLocalFileSync } from "@/workbench/adapters/use-workbench-local-file-sync";
import { useWorkbenchNotifications } from "@/workbench/adapters/use-workbench-notifications";
import { useWorkbenchSketchDraftRecovery } from "@/workbench/adapters/use-workbench-sketch-draft-recovery";
import { SketchDraftRecoveryNotification } from "@/workbench/adapters/sketch-draft-recovery-notification";
import { useWorkbenchPartImport } from "@/workbench/adapters/use-workbench-part-import";
import { useWorkbenchViewportEvents } from "@/workbench/adapters/use-workbench-viewport-events";
import { runReportedAction as runWorkbenchAction } from "@/lib/reported-action";
import type {
  DocumentFeatureCursor,
  DocumentHistoryItemRecord,
  DocumentVariableRecord,
} from "@/contracts/modeling/schema";
import { ok } from "@/contracts/errors";
import {
  computeSketchCloseSplineState,
  computeSketchMirrorActionState,
  computeSketchOffsetActionState,
  computeSketchTangentActionState,
  getSketchAnnotationDescriptors,
  getSketchAnnotationListRows,
  getSketchToolPresentation,
} from "@/core/editor/sketch-session";
import {
  doesSketchSpecialModeAcceptTarget,
  getSketchSpecialModePanel,
  getSketchSpecialModeViewportPresentation,
} from "@/core/sketch-special-modes/presentation";
import {
  getPrimitiveRefLabel,
  getPrimitiveRefKey,
  primitiveRefEquals,
  type PrimitiveRef,
} from "@/core/editor/schema";
import {
  getAutoHiddenSketchTargetKeys,
  getWorkbenchVisibilityState,
  reconcileVisibilityIntentKeys,
  toggleWorkbenchTargetVisibility,
} from "@/core/editor/visibility";
import {
  getFeatureSnapshot,
  getSelectionDetail,
  getTargetContributingFeatureIds,
} from "@/core/modeling/document-snapshot-view";
import {
  deriveMeasurementViewModel,
  getMeasurementReadoutSource,
  type MeasurementDistanceMode,
} from "@/core/measure/measurement";
import { openSketchMeasurementRecord } from "@/core/measure/open-sketch-measurement";
import { createTopologyDebugSummary } from "@/core/modeling/topology-debug";
import { useCadaraDebugPlatform } from "@/workbench/debug/use-cadara-debug-platform";
import { useEditorState } from "@/hooks/use-editor-state";
import { useErrorReporter } from "@/hooks/use-error-reporter";
import { useFeatureEditing } from "@/hooks/use-feature-editing";

import { useWorkbenchDocumentOwner } from "@/hooks/use-workbench-document-owner";
import { useModelingService } from "@/hooks/use-modeling-service";
import { useRuntimeExtensionRegistry } from "@/hooks/use-runtime-extension-registry";
import { WorkbenchCommandProvider } from "@/hooks/workbench-command-provider";
import { ShortcutProvider } from "@/hooks/shortcut-provider";
import { useToolActions } from "@/hooks/use-tool-actions";
import { downloadDocumentExportResult } from "@/lib/download-export";
import {
  createWorkbenchShortcutCommandHandlers,
  getWorkbenchShortcutActiveScopes,
} from "@/workbench/commands/workbench-shortcuts";
import {
  addWorkbenchVariable,
  deleteWorkbenchTarget,
  removeWorkbenchVariable,
  renameWorkbenchTarget,
  setWorkbenchBodyAppearance,
  setWorkbenchFeatureSuppression,
} from "@/workbench/commands/object-actions";
import {
  createWorkbenchViewportCommands,
  createWorkbenchViewportIntentHandler,
  createWorkbenchViewportModel,
} from "@/workbench/viewport/workbench-viewport-adapter";
import type { ViewportSpecialModeTargetInput } from "@/workbench/viewport/viewport-boundary";
import {
  VIEW_CUBE_SIZE_PX,
  VIEWPORT_OVERLAY_GAP_PX,
  WORKBENCH_STATUS_TOP_STYLE,
  getWorkbenchNotificationRightOffsetPx,
} from "@/components/cad/viewport-overlay-layout";
import { createBugReportPayload } from "@/application/bug-reporting/report";
import {
  downloadWorkbenchBugReportState,
  reportWorkbenchBug,
} from "@/workbench/debug/workbench-bug-report-actions";
import { getBuildModeLabel } from "@/components/layout/build-metadata";

type FeatureHistoryItem = Extract<
  DocumentHistoryItemRecord,
  { kind: "feature" }
>;
type SketchHistoryItem = Extract<DocumentHistoryItemRecord, { kind: "sketch" }>;
type BrowserTabCloseSaveAction = "downloadCopy" | "saveLinked";

/**
 * T14e: the height of the view-cube column (`three-cad-viewport.tsx`: the
 * 120 px cube, `gap-1` and the projection selector), as measured in the
 * browser (review A-1: 154 px). Its section controls never show in a sketch
 * (a section view is its own editor state).
 */
const VIEW_CUBE_COLUMN_RESERVE_PX = 154;
/**
 * T14e review B-1: the right-side column ends above the Variables FAB and a
 * gap, which also keeps it above the bottom history/timeline/tabs stack the
 * FAB clears.
 */
const VARIABLES_FAB_RESERVE_PX =
  WORKBENCH_VARIABLES_FAB_BOTTOM_PX +
  WORKBENCH_VARIABLES_FAB_SIZE_PX +
  VIEWPORT_OVERLAY_GAP_PX;

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
  /** Every open tab's page-leave save notice (cadara-8p7o). */
  localSaveNotification?: WorkbenchNotificationModel | null;
  /** A local save is underway in any open tab (cadara-781c logo ring). */
  localSaving?: boolean;
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
  localSaveNotification = null,
  localSaving = false,
}: CadWorkbenchProps) {
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
      annotationContext,
      showAllAnnotations,
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
    draftRecovery,
  } = useEditorState();
  const snapshot = machineState.snapshot;
  // T17-20 (T17k2): the edited sketch was deleted by another session.
  const deletedSketchNotice = getPeerDeletedSketchNotice(machineState);
  const loading = useInitialLoadingPhase(modelingService);
  const initialOccRenderPending = isInitialOccRenderPending(machineState);
  const [graphicsUnavailable, setGraphicsUnavailable] = useState(false);
  const handleGraphicsUnavailable = useCallback(
    () => setGraphicsUnavailable(true),
    [],
  );
  const documentRefreshFailureNotification =
    getDocumentRefreshFailureNotification(machineState, () =>
      dispatch({ type: "document.refreshRequested" }),
    );
  const editorFailureNotification = getEditorFailureNotification(
    machineState,
    () => dispatch({ type: "failureNotice.dismissed" }),
  );
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
  } = useWorkbenchDocumentPresentation(snapshot?.document.documentId ?? null);
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
  const draftRecoveryNotification = useWorkbenchSketchDraftRecovery(draftRecovery, reportDocumentFileActionFailure);

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

  useEffect(() => {
    return installOccPerfMutationBridge({
      getSnapshot: () => snapshotRef.current,
      modelingService,
    });
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

  const isSketchEditing = sketchSession !== null;
  const effectiveHiddenTargetKeys = useMemo(
    () =>
      getWorkbenchVisibilityState({
        snapshot,
        explicitHiddenTargetKeys,
        explicitlyShownAutoHiddenTargetKeys,
        isSketchEditing,
      }).effectiveHiddenTargetKeys,
    [
      explicitHiddenTargetKeys,
      explicitlyShownAutoHiddenTargetKeys,
      isSketchEditing,
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
    contextualActionHistory,
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
  const [bodyColorPreview, setBodyColorPreview] = useState<{
    bodyId: BodyId;
    hex: string;
  } | null>(null);
  // A sketch drag move changes only the session's display renderables: the
  // document renderables keep their identity (the viewport skips their
  // per-move re-render).
  const activeSketchId = sketchSession?.sketchId ?? null;
  const documentRenderables = useMemo(
    () =>
      composeViewportDocumentRenderables({
        snapshotRenderables: snapshot?.document.render.records ?? [],
        snapshotSketches: snapshot?.document.sketches ?? [],
        previewRenderables,
        activeSketch: isSketchEditing ? { sketchId: activeSketchId } : null,
        hiddenTargetKeys: effectiveHiddenTargetKeys,
        bodyColors: getBodyDisplayColors(
          snapshot?.document.bodies ?? [],
          bodyColorPreview,
        ),
      }),
    [
      activeSketchId,
      bodyColorPreview,
      effectiveHiddenTargetKeys,
      isSketchEditing,
      previewRenderables,
      snapshot,
    ],
  );
  const sketchDisplayRenderables = useMemo(
    () => composeViewportSketchDisplayRenderables(sketchSession),
    [sketchSession],
  );
  const viewportRenderables = useMemo(
    () => ({ documentRenderables, sketchDisplayRenderables }),
    [documentRenderables, sketchDisplayRenderables],
  );
  const sketchToolPresentation = sketchSession
    ? getSketchToolPresentation(sketchSession)
    : null;
  const sketchTangentActionState = useMemo(
    () =>
      sketchSession
        ? computeSketchTangentActionState(sketchSession, selection)
        : null,
    [sketchSession, selection],
  );
  const sketchMirrorActionState = useMemo(
    () =>
      sketchSession
        ? computeSketchMirrorActionState(sketchSession, selection)
        : null,
    [sketchSession, selection],
  );
  const sketchOffsetActionState = useMemo(
    () =>
      sketchSession
        ? computeSketchOffsetActionState(sketchSession, selection)
        : null,
    [sketchSession, selection],
  );
  const sketchCloseSplineState = useMemo(
    () =>
      sketchSession
        ? computeSketchCloseSplineState(sketchSession, selection)
        : null,
    [sketchSession, selection],
  );
  const sketchDiagnostic = sketchSession
    ? getSketchSessionDiagnosticPresentation(sketchSession)
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
  const sketchAnnotations = useMemo(
    () => (sketchSession ? getSketchAnnotationDescriptors(sketchSession) : []),
    [sketchSession],
  );
  // As the history strip: select it, then delete the selection (one
  // action); the row goes with its hover. Stable, so the list's memoized
  // rows re-render only when their own props change (review A-2).
  const handleConstraintListDelete = useCallback(
    (target: PrimitiveRef) => {
      handleViewportSelect(target);
      dispatch({ type: "sketch.annotationDeleteRequested" });
      handleViewportHoverClear();
    },
    [dispatch, handleViewportHoverClear, handleViewportSelect],
  );
  const sketchAnnotationListRows = useMemo(
    () => getSketchAnnotationListRows(sketchAnnotations),
    [sketchAnnotations],
  );

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

  // cadara-h026.3: the readout follows the plain selection with no tool
  // armed, and the Measure tool's picks while it is.
  const measurementReadoutSource = getMeasurementReadoutSource(machineState);
  const measuredSelection = useMemo(
    () =>
      measurementReadoutSource === "measureTool"
        ? visibleSelection.slice(0, 2)
        : visibleSelection,
    [measurementReadoutSource, visibleSelection],
  );
  const [measurementDistanceMode, setMeasurementDistanceMode] =
    useState<MeasurementDistanceMode>("minimum");
  const topologyMeasures = useTopologyMeasures({
    enabled: measurementReadoutSource !== null,
    modelingService,
    snapshot,
    selection: measuredSelection,
    errorReporter,
    showError: showWorkbenchError,
  });
  const openSketchMeasurement = useMemo(
    () =>
      snapshot &&
      sketchSession &&
      measurementReadoutSource &&
      measuredSelection.length > 0
        ? openSketchMeasurementRecord(snapshot, sketchSession)
        : null,
    [
      measuredSelection.length,
      measurementReadoutSource,
      sketchSession,
      snapshot,
    ],
  );
  const measurementViewModel = useMemo(
    () =>
      deriveMeasurementViewModel({
        source: measurementReadoutSource,
        selection: measuredSelection,
        snapshot,
        topologyMeasures,
        distanceMode: measurementDistanceMode,
        openSketch: openSketchMeasurement,
      }),
    [
      measuredSelection,
      measurementDistanceMode,
      measurementReadoutSource,
      openSketchMeasurement,
      snapshot,
      topologyMeasures,
    ],
  );
  // The readout sits under the parts tree's column (cadara-h026.4): publish
  // its height so the tree's max height stops above it; 0px when hidden.
  const publishMeasurementPanelHeight = useCallback(
    (panel: HTMLDivElement | null) => {
      const root = panel?.closest("main");
      if (!panel || !root) return;
      const publish = () =>
        root.style.setProperty(
          "--workbench-measure-readout-height",
          `${panel.offsetHeight}px`,
        );
      const observer = new ResizeObserver(publish);
      observer.observe(panel);
      publish();
      return () => {
        observer.disconnect();
        root.style.setProperty("--workbench-measure-readout-height", "0px");
      };
    },
    [],
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
    getSketchSnapshot: () => {
      if (!sketchSession) return null;
      const def = sketchSession.definition;
      const solved = sketchSession.liveSolve?.solvedSnapshot.solvedPoints ?? [];
      const solvedMap = new Map(
        solved.map((sp) => [sp.pointId, sp.solvedPosition] as const),
      );
      const positionsRecord = Object.fromEntries(
        def.points.map((p) => [
          p.pointId,
          solvedMap.get(p.pointId) ?? p.position,
        ]),
      ) as Record<string, readonly [number, number]>;
      return {
        points: def.points.map((p) => ({
          id: p.pointId,
          position: solvedMap.get(p.pointId) ?? p.position,
        })),
        entities: def.entities.map((e) => {
          if (e.kind === "lineSegment") {
            return {
              id: e.entityId,
              kind: e.kind,
              pointIds: [e.startPointId, e.endPointId],
            };
          }
          if (e.kind === "circle") {
            const solvedCircle =
              sketchSession.liveSolve?.solvedSnapshot.solvedEntities.find(
                (se) => se.kind === "circle" && se.entityId === e.entityId,
              );
            return {
              id: e.entityId,
              kind: e.kind,
              pointIds: [e.centerPointId],
              radius:
                solvedCircle?.kind === "circle"
                  ? solvedCircle.solvedRadius
                  : e.radius,
            };
          }
          if (e.kind === "arc") {
            return {
              id: e.entityId,
              kind: e.kind,
              pointIds: [e.centerPointId, e.startPointId, e.endPointId],
              sweepDirection: e.sweepDirection,
            };
          }
          if (e.kind !== "spline") {
            return { id: e.entityId, kind: e.kind };
          }
          const visibleVectors = splineVisibleHandleVectors(e, positionsRecord);
          const solvedSpline =
            sketchSession.liveSolve?.solvedSnapshot.solvedEntities.find(
              (se) => se.kind === "spline" && se.entityId === e.entityId,
            );
          return {
            id: e.entityId,
            kind: e.kind,
            closure: e.closure,
            spans: solvedSpline
              ? solvedCubicSpans(solvedSpline).map((span) => span.poles)
              : [],
            occurrences: e.pointOccurrences.map((occ, i) => ({
              occId: occ.occurrenceId,
              pointId: occ.pointId,
              tangent: occ.tangent,
              visibleVector: visibleVectors?.[i] ?? null,
            })),
          };
        }),
        offsetShells: sketchSession.liveSolve?.solvedSnapshot.solvedEntities
          .filter(
            (se): se is Extract<typeof se, { kind: "derivedPiecewiseCubic" }> =>
              se.kind === "derivedPiecewiseCubic",
          )
          .map((se) => ({
            entityId: se.entityId,
            publication: se.publication,
          })),
        // T17e (B12): regions count only while they are current; a
        // pending or unavailable state holds stale regions.
        liveRegions: {
          status: sketchSession.liveRegions.status,
          count:
            sketchSession.liveRegions.status === "current"
              ? sketchSession.liveRegions.regions.length
              : 0,
        },
        dimensions: def.dimensions.map((dimension) => ({
          id: dimension.dimensionId,
          kind: dimension.kind,
        })),
        derivedRelationships: (def.derivedRelationships ?? []).map(
          (relationship) => ({
            id: relationship.derivationId,
            kind: relationship.kind,
            mirrorReference:
              relationship.kind === "mirror"
                ? relationship.mirrorReference
                : undefined,
            outputs: relationship.outputs.map((output) => ({
              seedEntityId: output.seedEntityId,
              outputEntityId: output.outputEntityId,
              seedPointIds: output.seedPointIds,
              outputPointIds: output.outputPointIds,
            })),
          }),
        ),
        definition: def,
      };
    },
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

  const objectActionContext = {
    documentOwner,
    errorReporter,
    snapshot,
    showWorkbenchError,
    showWorkbenchInfo,
  };

  const handleDeleteTarget = (target: PrimitiveRef, label: string) => {
    deleteWorkbenchTarget({ ...objectActionContext, target, label });
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
    setWorkbenchFeatureSuppression({ ...objectActionContext, item });
  };

  const handleVariableAdd = () => addWorkbenchVariable(objectActionContext);

  const handleVariableRemove = (variable: DocumentVariableRecord) => {
    removeWorkbenchVariable({ ...objectActionContext, variable });
  };

  const handleDocumentHistoryDelete = (item: DocumentHistoryItemRecord) => {
    handleDeleteTarget(item.target, item.label);
  };

  const [renameInProgress, setRenameInProgress] = useState<{
    target: PrimitiveRef;
    label: string;
    surface: "parts" | "history";
  } | null>(null);
  const inlineRenameSession = renameInProgress
    ? {
        targetKey: getPrimitiveRefKey(renameInProgress.target),
        onCancel: () => setRenameInProgress(null),
        onCommit: (requestedLabel: string) => {
          setRenameInProgress(null);
          renameWorkbenchTarget({
            ...objectActionContext,
            target: renameInProgress.target,
            label: renameInProgress.label,
            requestedLabel,
            setObjectLabelOverrides,
          });
        },
      }
    : undefined;
  const handleDocumentHistoryRename = (item: DocumentHistoryItemRecord) => {
    setRenameInProgress({
      target: item.target,
      label: item.label,
      surface: "history",
    });
  };

  const handleBodyAppearanceChange = (
    target: Extract<PrimitiveRef, { kind: "body" }>,
    label: string,
    appearance: BodyAppearance,
  ) => {
    // Show the chosen colour at once; the persisted action can take seconds.
    setBodyColorPreview({
      bodyId: target.bodyId,
      hex: resolveBodyAppearanceHex(appearance),
    });
    void setWorkbenchBodyAppearance({
      ...objectActionContext,
      target,
      label,
      appearance,
    }).finally(() => setBodyColorPreview(null));
  };

  const handleBodyColorPreview = (bodyId: BodyId, hex: string | null) => {
    setBodyColorPreview(hex === null ? null : { bodyId, hex });
  };

  const handleTargetRename = (target: PrimitiveRef, label: string) => {
    setRenameInProgress({ target, label, surface: "parts" });
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
    annotationContext,
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

  const handleReportBug = () => {
    reportWorkbenchBug({
      createPayload: createCurrentBugReportPayload,
      errorReporter,
      showWorkbenchError,
    });
  };

  const handleDownloadBugReportState = async () => {
    await downloadWorkbenchBugReportState({
      createPayload: createCurrentBugReportPayload,
      errorReporter,
      showWorkbenchError,
      showWorkbenchInfo,
    });
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
    const result = await loading.openDocument(() => onOpenDocumentCopy(file));
    handleDocumentActionResult(result);
    if (result.status === "success") {
      setOpenDocumentModalOpened(false);
    }
  };

  const handleOpenLinkedDocument = async () => {
    const result = await loading.openDocument(onOpenLinkedDocument);
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
    setGraphicsUnavailable(false);
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

  const acceptsSpecialModeTarget = useCallback(
    ({
      session,
      target,
      selection: viewportSelection,
      selectionCatalog: viewportSelectionCatalog,
    }: ViewportSpecialModeTargetInput) =>
      doesSketchSpecialModeAcceptTarget(
        session,
        target,
        viewportSelection,
        viewportSelectionCatalog,
        sketchSpecialModes,
      ),
    [sketchSpecialModes],
  );
  // cadara-h026.1: the viewport's click and cycle follow the reducer's rule.
  const multiSelection = isMultiSelectionContext(machineState);
  const viewportModel = useMemo(
    () =>
      createWorkbenchViewportModel({
        documentId: snapshot?.document.documentId ?? null,
        activeSectionView: activeSectionView ?? null,
        hoverTarget: visibleHoverTarget,
        measurementWitnesses: measurementViewModel?.witnesses ?? [],
        renderables: viewportRenderables.documentRenderables,
        sketchDisplayRenderables: viewportRenderables.sketchDisplayRenderables,
        sketchAnnotations,
        selection: visibleSelection,
        annotationContext,
        showAllAnnotations,
        sketchToolPresentation,
        documentVariableNames:
          snapshot?.document.variables.map((variable) => variable.name) ?? [],
        specialModePresentation: sketchSpecialModeViewportPresentation,
        hasNonEmptyCommittedGeometry: hasNonEmptyCommittedGeometry(
          viewportRenderables.documentRenderables,
        ),
        mode,
        selectionFilter,
        selectionCatalog,
        sketchSession,
        isEditorRenderIdle: machineState.kind === "idle",
        multiSelection,
        acceptsSpecialModeTarget,
      }),
    [
      acceptsSpecialModeTarget,
      multiSelection,
      activeSectionView,
      annotationContext,
      machineState.kind,
      showAllAnnotations,
      measurementViewModel?.witnesses,
      mode,
      selectionCatalog,
      selectionFilter,
      sketchAnnotations,
      sketchSession,
      sketchSpecialModeViewportPresentation,
      snapshot?.document.documentId,
      snapshot?.document.variables,
      sketchToolPresentation,
      viewportRenderables.documentRenderables,
      viewportRenderables.sketchDisplayRenderables,
      visibleHoverTarget,
      visibleSelection,
    ],
  );
  const viewportCommands = useMemo(
    () =>
      createWorkbenchViewportCommands({
        fitViewRequestId: viewportFitRequestId,
      }),
    [viewportFitRequestId],
  );
  const handleViewportIntent = useMemo(
    () =>
      createWorkbenchViewportIntentHandler({
        dispatch,
        onHover: handleViewportHover,
        onSelect: handleViewportSelect,
        onConnectedSketchSelect: handleViewportConnectedSketchSelect,
        onDeselect: handleViewportDeselect,
        onClearHover: handleViewportHoverClear,
        onSketchMove: handleSketchMove,
        onSketchRelease: handleSketchRelease,
        onSketchGeometryDragStart: handleSketchGeometryDragStart,
        onSketchGeometryDragMove: handleSketchGeometryDragMove,
        onSketchGeometryDragEnd: handleSketchGeometryDragEnd,
        onSpecialModeClick: handleSketchSpecialModeClick,
        onSpecialModeDoubleClick: handleSketchSpecialModeDoubleClick,
        onSpecialModeDragStart: handleSketchSpecialModeDragStart,
        onSpecialModeDragMove: handleSketchSpecialModeDragMove,
        onSpecialModeDragEnd: handleSketchSpecialModeDragEnd,
        onSectionOffsetChange: handleSectionOffsetChange,
        onSectionFlip: handleSectionFlip,
        onSectionClear: handleSectionClear,
        onLodTierChange: handleViewportLodTierChange,
        onCanvasCreated: handleViewportCanvasCreated,
        onFirstNonEmptyGeometryFrame: handleFirstNonEmptyGeometryFrame,
      }),
    [
      dispatch,
      handleFirstNonEmptyGeometryFrame,
      handleSectionClear,
      handleSectionFlip,
      handleSectionOffsetChange,
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
      handleViewportCanvasCreated,
      handleViewportConnectedSketchSelect,
      handleViewportDeselect,
      handleViewportHover,
      handleViewportHoverClear,
      handleViewportLodTierChange,
      handleViewportSelect,
    ],
  );

  // The toolbar, the parts tree and the document timeline are memoized: a
  // sketch drag move re-renders the workbench but not them, so their
  // handlers keep one identity (each call runs the latest handler).
  const toolbarCallbacks = useLatestCallbacks({
    onNewDocument: handleNewDocument,
    onOpenDocument: handleOpenDocument,
    onSaveDocumentAs: handleSaveDocumentAs,
    onReportBug: handleReportBug,
    onDownloadBugReportState: handleDownloadBugReportState,
  });
  const { canUndo: toolbarCanUndo, canRedo: toolbarCanRedo } =
    toolbarHistoryAvailability;
  const stableToolbarHistoryAvailability = useMemo(
    () => ({ canUndo: toolbarCanUndo, canRedo: toolbarCanRedo }),
    [toolbarCanRedo, toolbarCanUndo],
  );
  const partsTreeCallbacks = useLatestCallbacks({
    onSelectTarget: handleShellSelect,
    onReopenTarget: handleNavigationReopen,
    onChangeSketchPlaneTarget: handleSketchPlaneEditRequest,
    onObjectDelete: handleDeleteTarget,
    onObjectExport: handleObjectExport,
    onRenameTarget: handleTargetRename,
    onToggleTargetVisibility: handleTargetVisibilityToggle,
    onBodyAppearanceChange: handleBodyAppearanceChange,
    onBodyColorPreview: handleBodyColorPreview,
  });
  const historyTimelineCallbacks = useLatestCallbacks({
    onSelectTarget: handleShellSelect,
    onReopenTarget: handleNavigationReopen,
    onChangeSketchPlaneTarget: handleSketchPlaneEditRequest,
    onDocumentCursorRequested: handleTimelineCursorRequested,
    onDocumentHistoryReorder: handleDocumentHistoryReorder,
    onDeleteDocumentItem: handleDocumentHistoryDelete,
    onExportDocumentItem: handleDocumentHistoryExport,
    onRenameDocumentItem: handleDocumentHistoryRename,
    onSuppressFeature: handleFeatureSuppressionRequested,
    onUndoAction: requestUndo,
    onRedoAction: requestRedo,
  });

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
              model={viewportModel}
              commands={viewportCommands}
              onIntent={handleViewportIntent}
              performanceTelemetry={performanceTelemetry}
              onGraphicsUnavailable={handleGraphicsUnavailable}
            />
            {(initialOccRenderPending ||
              (!openDocumentModalOpened && loading.filePhase === "opening-document")) &&
            !graphicsUnavailable ? (
              <div
                role="status"
                aria-label="Initial model render pending"
                className="absolute inset-0 z-30 grid place-items-center bg-(--workbench-viewport-background)/85"
              >
                <InitialLoadingStatus
                  phase={loading.phase}
                  progress={loading.progress}
                />
              </div>
            ) : null}
            {/* T14d (A-11): the left floating panel stack. The sketch
                annotation layout avoids the rects of the children of every
                `data-viewport-annotation-obstacles` wrapper (read by the
                viewport once per render). */}
            <div className="contents" data-viewport-annotation-obstacles="">
              <SketchToolPanel
                schema={sketchToolPresentation}
                onUndo={requestUndo}
                onPatch={(patch) =>
                  dispatch({ type: "sketch.toolPatched", patch })
                }
              />
              {/* Selection actions flow together; diagnostics use the notification column. */}
              {deletedSketchNotice ||
              sketchMirrorActionState ||
              sketchOffsetActionState ||
              sketchCloseSplineState ||
              sketchTangentActionState?.visible ? (
                <SketchSelectionContextStack>
                  {deletedSketchNotice &&
                  machineState.kind === "editingSketch" ? (
                    <SketchDeletedNotice
                      message={deletedSketchNotice}
                      onDiscard={() =>
                        dispatch({
                          type: "command.cancelled",
                          commandSessionId:
                            machineState.command.commandSessionId,
                        })
                      }
                    />
                  ) : null}
                  {sketchMirrorActionState ? (
                    <SketchMirrorActions
                      entries={sketchMirrorActionState.entries}
                      onRemove={(derivationId) =>
                        dispatch({
                          type: "sketch.toolPatched",
                          patch: { intent: "removeMirror", derivationId },
                        })
                      }
                      onReplace={(derivationId, outputEntityId) =>
                        dispatch({
                          type: "sketch.toolPatched",
                          patch: {
                            intent: "startMirrorRepair",
                            derivationId,
                            ...(outputEntityId ? { outputEntityId } : {}),
                          },
                        })
                      }
                    />
                  ) : null}
                  {sketchOffsetActionState ? (
                    <SketchOffsetActions
                      entries={sketchOffsetActionState.entries}
                      onEditDistance={(derivationId) =>
                        dispatch({
                          type: "sketch.toolPatched",
                          patch: { intent: "editOffsetDistance", derivationId },
                        })
                      }
                      onRemove={(derivationId) =>
                        dispatch({
                          type: "sketch.toolPatched",
                          patch: { intent: "removeOffset", derivationId },
                        })
                      }
                    />
                  ) : null}
                  <SketchSplineActions
                    closeSpline={sketchCloseSplineState}
                    tangent={sketchTangentActionState}
                    onPatch={(patch) =>
                      dispatch({ type: "sketch.toolPatched", patch })
                    }
                  />
                </SketchSelectionContextStack>
              ) : null}
              <SketchSpecialModePanel
                schema={sketchSpecialModePanel}
                onAction={(action) =>
                  dispatch({
                    type: "sketch.specialModePanelActionInvoked",
                    action,
                  })
                }
              />
            </div>
            {/* T14d review B-1: workbench chrome over the canvas. The
                annotation layout never places a label over the children of
                a `data-viewport-annotation-chrome` wrapper and does not
                render a label anchored under them; the
                `data-viewport-annotation-bottom-band` children bound the
                usable canvas from below.
                T14e (T-12/Q2, R-4): the right-side column. Row 1: the
                notifications beside the view-cube column's reserve (this
                grid is the source of truth for their right offset: inset +
                cube + gap); row 2: the sketch's Constraints panel under both,
                right-aligned with the cube column. The panel sits below the
                cube and every notification by flow, so neither covers the
                other. Review B-1: the column ends above the Variables FAB (and
                so the bottom stack); the panel takes the height left and its
                list scrolls. Notifications stay above the Variables panel
                (z 27) and FAB (z 28); the Constraints panel stays below them,
                so the open Variables panel draws over it. */}
            <div
              className="pointer-events-none absolute grid items-start justify-items-end"
              style={{
                right: getWorkbenchNotificationRightOffsetPx({
                  reserveViewCube: false,
                }),
                top: WORKBENCH_STATUS_TOP_STYLE,
                bottom: VARIABLES_FAB_RESERVE_PX,
                gridTemplateColumns: `auto ${VIEW_CUBE_SIZE_PX}px`,
                gridTemplateRows: "auto minmax(0, 1fr)",
                gap: VIEWPORT_OVERLAY_GAP_PX,
              }}
            >
              <div className="contents" data-viewport-annotation-chrome="">
                <div className="pointer-events-auto relative z-30 col-start-1 row-start-1 flex flex-col items-end gap-2">
                  {sketchDiagnostic && sketchSession?.validationMessage ? (
                    <SketchValidationStatus
                      message={sketchSession.validationMessage}
                      displayMessage={sketchDiagnostic.message}
                      severity={sketchDiagnostic.severity}
                      onUndo={requestUndo}
                      onHover={
                        sketchDiagnostic.target
                          ? () => handleViewportHover(sketchDiagnostic.target!)
                          : undefined
                      }
                      onClearHover={
                        sketchDiagnostic.target
                          ? handleViewportHoverClear
                          : undefined
                      }
                    />
                  ) : null}
                  {restoreMessage ? (
                    <WorkbenchNotification
                      type="error"
                      title="History restore failed"
                      message={restoreMessage}
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
                  {localSaveNotification ? (
                    <WorkbenchNotification {...localSaveNotification} />
                  ) : null}
                  {draftRecoveryNotification ? <SketchDraftRecoveryNotification {...draftRecoveryNotification} /> : null}
                  {workbenchStatusNotification ? (
                    <WorkbenchNotification
                      {...workbenchStatusNotification}
                      onDismiss={() => setWorkbenchStatusNotification(null)}
                    />
                  ) : null}
                  {documentRefreshFailureNotification ? (
                    <WorkbenchNotification
                      {...documentRefreshFailureNotification}
                    />
                  ) : null}
                  {editorFailureNotification ? (
                    <WorkbenchNotification {...editorFailureNotification} />
                  ) : null}
                </div>
              </div>
              <div
                aria-hidden="true"
                className="col-start-2 row-start-1"
                style={{ height: VIEW_CUBE_COLUMN_RESERVE_PX }}
              />
              <div className="contents" data-viewport-annotation-chrome="">
                {sketchSession ? (
                  <SketchConstraintList
                    className="relative z-[26] col-span-2 row-start-2 max-h-full"
                    rows={sketchAnnotationListRows}
                    selection={selection}
                    hoverTarget={hoverTarget}
                    showAll={showAllAnnotations}
                    filter={
                      annotationContext?.wheel?.listFiltered
                        ? annotationContext.wheel.members
                        : null
                    }
                    onClearFilter={() =>
                      dispatch({
                        type: "sketch.annotationWheelListFilterChanged",
                        filtered: false,
                      })
                    }
                    onShowAllChange={(showAll) =>
                      dispatch({
                        type: "sketch.showAllAnnotationsChanged",
                        showAll,
                      })
                    }
                    onHover={handleViewportHover}
                    onClearHover={handleViewportHoverClear}
                    onSelect={handleViewportSelect}
                    onDelete={handleConstraintListDelete}
                  />
                ) : null}
              </div>
            </div>
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
              loadingPhase={loading.filePhase}
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
              historyAvailability={stableToolbarHistoryAvailability}
              showBrowserStorageWarning={showBrowserStorageWarning}
              localSaving={localSaving}
              {...toolbarCallbacks}
            />

            <div className="contents" data-viewport-annotation-chrome="">
              <FloatingPartsTree
                snapshot={snapshot}
                hiddenTargetKeys={effectiveHiddenTargetKeys}
                objectLabelOverrides={objectLabelOverrides}
                visibleSelection={visibleSelection}
                renameSession={
                  renameInProgress?.surface === "parts"
                    ? inlineRenameSession
                    : undefined
                }
                {...partsTreeCallbacks}
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
                  onRemoveVariable={handleVariableRemove}
                  onClose={() => setVariablesPanelOpen(false)}
                />
              ) : null}
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col">
              <div className="flex flex-col gap-3">
                <div className="flex items-end gap-3 px-4">
                  <div className="contents" data-viewport-annotation-chrome="">
                    {/* The readout leads the row so it stays pinned at the
                        left inset; after the 360px debugger it drifted to
                        mid/right on narrow viewports (cadara-h026.4). */}
                    <MeasurementPanel
                      ref={publishMeasurementPanelHeight}
                      measurement={measurementViewModel}
                      onDistanceModeChange={setMeasurementDistanceMode}
                    />
                    <WorkbenchStateDebugger state={debuggerState} />
                  </div>
                </div>
                <div
                  className="contents"
                  data-viewport-annotation-bottom-band=""
                >
                  <HistoryTimelineShell
                    snapshot={snapshot}
                    sketchSession={sketchSession}
                    historyHighlightFeatureIds={historyHighlightFeatureIds}
                    visibleSelection={visibleSelection}
                    documentCursorDisabled={
                      !history.canUndo && !history.canRedo
                    }
                    documentHistoryReorderDisabled={
                      Boolean(sketchSession) ||
                      isDocumentHistoryReorderRunning ||
                      isUndoRedoRunning ||
                      (!history.canUndo && !history.canRedo)
                    }
                    renameSession={
                      renameInProgress?.surface === "history"
                        ? inlineRenameSession
                        : undefined
                    }
                    actionHistory={contextualActionHistory}
                    actionHistoryDisabled={isUndoRedoRunning}
                    {...historyTimelineCallbacks}
                  />
                </div>
              </div>
              <div className="pointer-events-auto mt-3">
                <div
                  className="contents"
                  data-viewport-annotation-bottom-band=""
                >
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
            </div>
          </main>
        </div>
      </ShortcutProvider>
    </WorkbenchCommandProvider>
  );
}
