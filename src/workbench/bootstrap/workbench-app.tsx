// SLOP: Retained workbench session host while provider composition and document-tab persistence are separated from browser app bootstrap.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import { Alert, Group, Text } from "@mantine/core";
import {
  LocalDocumentOffers,
  localDocumentOfferOptOutKey,
} from "@/application/account/local-document-offers";
import { ProjectSwitcher } from "@/components/layout/project-switcher";
import type { DocumentFileMenuProject } from "@/components/layout/document-file-menu";
import type { ShareDialogTarget } from "@/components/account/sharing/share-dialog";
import { useShareDialog } from "@/components/account/sharing/use-share-dialog";
import { ACCOUNT_SESSION_CHANGED } from "@/application/account/account-session";
import { createProjectAccessHttpClient } from "@/infrastructure/account/project-access";
import { getAccountApiOrigin } from "@/infrastructure/account/api-origin";
import { recentProjects } from "@/core/project-sync/recent-projects";
import { createLocalStorageRecentProjectsStore } from "@/infrastructure/persistence/local-storage-recent-projects-store";
import {
  NewProjectModal,
  type NewProjectInput,
} from "@/components/layout/new-project-modal";
import { MoveToProjectModal } from "@/components/layout/project-service-dialogs";
import type { WorkbenchContextMenuEntry } from "@/components/layout/workbench-context-menu";
import {
  canWriteProjectDocument,
  projectAccessAllows,
  ProjectWriteGate,
} from "@/application/project-sync/project-write-gate";
import {
  documentMoveUnavailableReason,
  projectGroupLabel,
  projectMoveTargets,
} from "@/core/project-sync/project-move-targets";
import { SignInRequestProvider } from "@/hooks/sign-in-request-provider";
import { useSignInRequest } from "@/hooks/sign-in-request-context";
import { createLocalStorageNewProjectChoiceStore } from "@/infrastructure/persistence/local-storage-new-project-choice-store";
import { DEFAULT_PROJECT_NAME } from "@/infrastructure/persistence/workbench-project-bootstrap";
import type { NewProjectChoice } from "@/core/account/project-location-options";
import { useBrowserOnline } from "@/hooks/use-browser-online";
import { useLatestCallbacks } from "@/hooks/use-latest-callbacks";
import { summarizeQuota } from "@/core/account/quota-summary";
import { createProjectWriteGatedDocumentRepository } from "@/application/project-sync/project-write-gated-document-repository";
import { useEditorPageMemory } from "./editor-page-memory";
import { useWorkbenchProject } from "./use-workbench-project";
import { useTabStorageStatus } from "./use-tab-storage-status";
import { useProjectSync, type ProjectSync } from "./use-project-sync";
import {
  ProjectSyncControls,
  ProjectSyncPresence,
} from "./project-sync-controls";

import { normalizeUnknownError } from "@/contracts/errors";
import { useErrorReporter } from "@/hooks/use-error-reporter";

import type { ModelingKernelAdapter } from "@/contracts/modeling/adapter";
import type { PerformanceTelemetry } from "@/contracts/performance/telemetry";
import { noopPerformanceTelemetry } from "@/contracts/performance/telemetry";
import type { DocumentId } from "@/contracts/shared/ids";
import { createModelingService } from "@/application/modeling/modeling-service";
import { createInstrumentedModelingService } from "@/application/modeling/modeling-service/instrumented-service";
import { isLocalFileSyncDocumentRepository } from "@/core/modeling/document-repository";
import { createInstrumentedDocumentRepository } from "@/application/modeling/instrumented-document-repository";
import type { RuntimeExtensionRegistryComposition } from "@/core/extensions/runtime-extension-registries";
import { SketchConstraintSolverAdapter } from "@/application/solver/sketch-constraint-solver-adapter";
import { getBrowserSketchRegionDerivation } from "@/infrastructure/occ/sketch-derivation-worker-runtime";
import { createInstrumentedSketchSolverAdapter } from "@/application/solver/instrumented-sketch-solver-adapter";
import {
  generateDocumentId,
  reduceWorkbenchTabs,
  type WorkbenchTab,
  type WorkbenchTabsAction,
  type WorkbenchTabsState,
} from "@/core/workspace/workbench-tabs";
import {
  createWorkbenchProjectTabs,
  deriveWorkbenchProjectTabStorage,
  followWorkbenchProjectManifest,
  mergeDiscoveredWorkbenchProjectTabs,
} from "@/core/workspace/workbench-project-tabs";
import type { ProjectManifest } from "@/contracts/modeling/project-manifest";
import { EditorProvider } from "@/hooks/editor-provider";
import { ModelingServiceProvider } from "@/hooks/modeling-service-provider";
import { RuntimeExtensionRegistryProvider } from "@/hooks/runtime-extension-registry-provider";
import { CadWorkbench } from "@/workbench/shell/cad-workbench";
import { WorkbenchModelingServices } from "@/application/workspace/workbench-modeling-services";
import { createDurableHistoryService } from "@/application/history/durable-history";
import {
  createLocalStorageOperationHistoryStore,
  createOperationHistoryStorageKey,
} from "@/infrastructure/persistence/local-storage-operation-history-store";
import { createLocalStorageWorkbenchTabsStore } from "@/infrastructure/persistence/local-storage-workbench-tabs-store";
import {
  createDocumentRepositoryUrlStorageKey,
  createLocalStorageDocumentRepositoryUrlStore,
  getDocumentRepositoryStorageNamespace,
} from "@/infrastructure/persistence/document-repository-url-store";
import { createWorkerBackedDocumentRepository } from "@/infrastructure/modeling/worker-backed-document-repository";
import type { DocumentSyncWorkerClient } from "@/infrastructure/workers/document-sync-worker-client";
import { DurableHistoryProvider } from "@/hooks/durable-history-provider";
import { useLocalSaveStatus } from "@/hooks/use-local-save-status";
import { useOccKernelVersionRetired } from "@/hooks/use-occ-kernel-version-retired";
import { AppUpdateNotification } from "@/components/layout/app-update-notification";
import type { WorkbenchNotificationModel } from "@/components/layout/workbench-notification-model";
import { useWorkbenchLocalSaveGuard } from "@/workbench/adapters/use-workbench-local-save-guard";
import { useLaunchedDocumentFiles } from "@/workbench/adapters/use-launched-document-files";
import { useStorageDurabilityWarning } from "@/workbench/adapters/use-storage-durability-warning";
import {
  openDocumentCopyAsTab,
  openLinkedDocumentAsTab,
  type WorkbenchDocumentActionResult,
} from "@/workbench/document/document-file-actions";

const DEFAULT_WORKBENCH_DOCUMENT_NAME = "Workspace";

function createDefaultWorkbenchTab(documentId: DocumentId): WorkbenchTab {
  return {
    documentId,
    title: DEFAULT_WORKBENCH_DOCUMENT_NAME,
    storageKind: "browser",
    storageDescriptor: null,
  };
}

interface WorkbenchAppProps {
  createKernelAdapter: (
    documentId: DocumentId,
    performanceTelemetry?: PerformanceTelemetry,
  ) => ModelingKernelAdapter;
  documentSyncWorkerClient: DocumentSyncWorkerClient | null;
  releaseDocumentResources?: (documentId: DocumentId) => Promise<void>;
  performanceTelemetry?: PerformanceTelemetry;
  runtimeExtensionRegistries: RuntimeExtensionRegistryComposition;
}

export function WorkbenchApp(props: WorkbenchAppProps) {
  // Without a document repository there is no durable project (see createWorkbenchProjectBootstrap).
  const [localDocumentOffers] = useState(
    () =>
      new LocalDocumentOffers({
        isSuppressed: (documentId) =>
          window.localStorage.getItem(
            localDocumentOfferOptOutKey(documentId),
          ) === "1",
        suppress: (documentId) =>
          window.localStorage.setItem(
            localDocumentOfferOptOutKey(documentId),
            "1",
          ),
      }),
  );
  const projects = useWorkbenchProject(props.documentSyncWorkerClient !== null);
  const sync = useProjectSync(props.documentSyncWorkerClient, projects);
  useEditorPageMemory(projects.project);
  // The logo menu orders its recent projects from this record; the
  // per-project workbench reads it when it mounts for a switched project.
  const openProjectId = projects.project?.projectId;
  useEffect(() => {
    if (openProjectId)
      createLocalStorageRecentProjectsStore(window.localStorage).record(
        openProjectId,
      );
  }, [openProjectId]);
  // Above the per-project workbench: Share on a local part opens the dialog
  // after the window has switched to the part's new account project.
  const accessPort = useMemo(
    () => createProjectAccessHttpClient({ apiOrigin: getAccountApiOrigin() }),
    [],
  );
  const { openShareDialog, shareDialog } = useShareDialog({
    port: accessPort,
    account: sync.account,
    // Leaving the open project: the window moves to a project on this
    // device, a new one when there is none.
    onLeft: (left) => {
      if (projects.project?.service?.projectId !== left.projectId) return;
      const local = projects.projects.find((listed) => !listed.service);
      void projects.select((repository) =>
        local
          ? repository.open(local.projectId)
          : repository.create(DEFAULT_PROJECT_NAME, [
              {
                docId: generateDocumentId(),
                name: DEFAULT_WORKBENCH_DOCUMENT_NAME,
                kind: "part",
              },
            ]),
      );
    },
  });
  if (projects.initialFailure)
    return (
      <Alert color="red" title="Project could not be opened">
        {projects.failure ?? "Invalid stored project session."}
      </Alert>
    );
  return (
    <SignInRequestProvider>
      <ProjectWorkbenchApp
        key={projects.sessionKey}
        {...props}
        projects={projects}
        sync={sync}
        localDocumentOffers={localDocumentOffers}
        openShareDialog={openShareDialog}
      />
      {shareDialog}
    </SignInRequestProvider>
  );
}

function ProjectWorkbenchApp({
  createKernelAdapter,
  documentSyncWorkerClient,
  releaseDocumentResources,
  performanceTelemetry = noopPerformanceTelemetry,
  runtimeExtensionRegistries,
  projects,
  sync,
  localDocumentOffers,
  openShareDialog,
}: WorkbenchAppProps & {
  localDocumentOffers: LocalDocumentOffers;
  projects: ReturnType<typeof useWorkbenchProject>;
  sync: ProjectSync;
  openShareDialog: (target: ShareDialogTarget) => void;
}) {
  const errorReporter = useErrorReporter();
  const project = projects.project;
  const { saveParts, saveSession, registerPartReadiness } = projects;
  // Part edits and storage writes, part tabs, authoring tools, document
  // undo/redo and reopening ask this gate (see ProjectWriteGate). It follows
  // the synced project's role; set before child effects of the same commit.
  const [projectWriteGate] = useState(() => new ProjectWriteGate());
  const projectLinked = sync.linked;
  const projectRole = sync.role;
  useLayoutEffect(() => {
    projectWriteGate.setAccess({ linked: projectLinked, role: projectRole });
  }, [projectLinked, projectRole, projectWriteGate]);
  const [projectApplied, setProjectApplied] = useState(
    project !== null || !projects.persistenceEnabled,
  );
  const tabsStorage = useMemo(
    () =>
      !project
        ? null
        : createLocalStorageWorkbenchTabsStore(
            window.localStorage,
            `cad.workbench.tabs.project.v1:${project.projectId}`,
          ),
    [project],
  );
  // Move to project copies part documents through the worker directly.
  const workerDocumentRepository = useMemo(() => {
    if (typeof window === "undefined" || !documentSyncWorkerClient) {
      return null;
    }

    return createWorkerBackedDocumentRepository({
      client: documentSyncWorkerClient,
      urlStore: createLocalStorageDocumentRepositoryUrlStore(
        window.localStorage,
        createDocumentRepositoryUrlStorageKey(
          getDocumentRepositoryStorageNamespace(window.location.search),
        ),
      ),
    });
  }, [documentSyncWorkerClient]);
  const documentRepository = useMemo(() => {
    if (!workerDocumentRepository) return null;

    return createProjectWriteGatedDocumentRepository(
      createInstrumentedDocumentRepository(
        workerDocumentRepository,
        performanceTelemetry,
      ),
      projectWriteGate,
    );
  }, [workerDocumentRepository, performanceTelemetry, projectWriteGate]);
  const requestedDocumentId = projects.requestedDocumentId;
  const projectTabs = useCallback((): WorkbenchTabsState => {
    if (!project) return projects.initialTabs;
    const cached = tabsStorage?.load();
    const tabs = createWorkbenchProjectTabs(
      project,
      cached?.ok ? cached.state : null,
      projects.initialTabs,
    );
    // A part that just moved here opens as the active tab.
    return tabs.tabs.some((tab) => tab.documentId === requestedDocumentId)
      ? { ...tabs, activeDocumentId: requestedDocumentId! }
      : tabs;
  }, [project, projects.initialTabs, requestedDocumentId, tabsStorage]);
  const [rawTabsState, tabsDispatch] = useReducer(
    (
      state: WorkbenchTabsState,
      action:
        | WorkbenchTabsAction
        | { type: "restoreProject"; state: WorkbenchTabsState }
        | {
            type: "followProject";
            previous: ProjectManifest;
            next: ProjectManifest;
          },
    ) =>
      action.type === "restoreProject"
        ? action.state
        : action.type === "followProject"
          ? followWorkbenchProjectManifest(action.previous, action.next, state)
          : reduceWorkbenchTabs(state, action),
    undefined,
    projectTabs,
  );
  const tabsState = useMemo(
    () => deriveWorkbenchProjectTabStorage(project, rawTabsState),
    [project, rawTabsState],
  );
  if (project && !projectApplied) {
    tabsDispatch({
      type: "restoreProject",
      state: mergeDiscoveredWorkbenchProjectTabs(
        project,
        tabsState,
        projects.firstPartPlaceholder,
      ),
    });
    setProjectApplied(true);
  }
  const restoredBindingDocumentIdsRef = useRef(new Set<DocumentId>());
  const editorDependencies = useMemo(
    () => ({
      importProviders: runtimeExtensionRegistries.importProviders,
      sketchSpecialModes: runtimeExtensionRegistries.sketchSpecialModes,
    }),
    [
      runtimeExtensionRegistries.importProviders,
      runtimeExtensionRegistries.sketchSpecialModes,
    ],
  );
  const modelingServices = useMemo(
    () =>
      new WorkbenchModelingServices((documentId) => {
        const kernelAdapter = createKernelAdapter(
          documentId,
          performanceTelemetry,
        );
        return createInstrumentedModelingService(
          createModelingService(kernelAdapter, {
            currentDocumentId: documentId,
            sketchSolver: createInstrumentedSketchSolverAdapter(
              new SketchConstraintSolverAdapter({
                documentId,
                revisionId: null,
                neutralCurveQueries: kernelAdapter,
                // Live regions derive in a dedicated worker, never behind the
                // OCC kernel worker's feature preview/commit queue.
                regionDerivation:
                  getBrowserSketchRegionDerivation() ?? undefined,
              }),
              performanceTelemetry,
            ),
            exportProviders: runtimeExtensionRegistries.exportProviders,
            operationHistoryStore:
              typeof window === "undefined"
                ? null
                : createLocalStorageOperationHistoryStore(
                    window.localStorage,
                    createOperationHistoryStorageKey(documentId),
                  ),
            documentRepositoryPersistence: "background",
            documentRepository,
            documentWriteGate: projectWriteGate,
          }),
          performanceTelemetry,
        );
      }, releaseDocumentResources),
    [
      createKernelAdapter,
      documentRepository,
      performanceTelemetry,
      projectWriteGate,
      runtimeExtensionRegistries.exportProviders,
      releaseDocumentResources,
    ],
  );
  useEffect(
    () =>
      registerPartReadiness(async (documentId) => {
        await modelingServices.get(documentId).getCurrentDocumentSnapshot();
      }),
    [modelingServices, registerPartReadiness],
  );
  const modelingService = modelingServices.get(tabsState.activeDocumentId);
  const waitForLocalChanges = useCallback(
    () => modelingServices.waitForLocalChanges(),
    [modelingServices],
  );
  const localSaveNotification = useWorkbenchLocalSaveGuard({
    source: modelingServices,
    pendingWrites: projects.pendingWrites,
    errorReporter,
  });
  const localSaving = useLocalSaveStatus(modelingServices).saving;
  const storageDurabilityNotification = useStorageDurabilityWarning({
    source: modelingServices,
    errorReporter,
  });
  const kernelVersionRetired = useOccKernelVersionRetired();
  // A retired kernel fails the part readiness the project waits for; the
  // update notification's reload is the outcome. A failed discovery leaves
  // nothing to edit: a reload recovers from a passing cause; repairing the
  // project list recovers from a stored catalog or manifest that no longer
  // opens.
  const { repairCatalog, repair } = projects;
  const projectNotification = useMemo(
    (): WorkbenchNotificationModel | null =>
      kernelVersionRetired
        ? null
        : !projects.failure
          ? projects.openFailure
            ? {
                type: "error",
                title: "Project could not be opened",
                message: projects.openFailure,
              }
            : null
          : projects.discoveryFailed
            ? {
                type: "error",
                title: "Project could not be opened",
                message: projects.failure,
                action: {
                  label: "Reload",
                  onClick: () => window.location.reload(),
                },
                secondaryAction: {
                  label: "Repair project list",
                  onClick: () => void repairCatalog(),
                  disabled: repair !== "idle",
                },
              }
            : {
                type: "error",
                title: "Project could not be saved",
                message: projects.failure,
              },
    [
      kernelVersionRetired,
      projects.discoveryFailed,
      projects.failure,
      projects.openFailure,
      repair,
      repairCatalog,
    ],
  );

  const durableHistory = useMemo(
    () =>
      createDurableHistoryService({
        documentRepository,
        modelingService,
      }),
    [documentRepository, modelingService],
  );

  const mountedModelingServicesRef = useRef(new Set([modelingServices]));
  useEffect(() => {
    // Strict Mode replays effects; defer disposal so its immediate remount can retain this owner.
    const mountedServices = mountedModelingServicesRef.current;
    mountedServices.add(modelingServices);
    return () => {
      mountedServices.delete(modelingServices);
      queueMicrotask(() => {
        if (!mountedServices.has(modelingServices)) modelingServices.dispose();
      });
    };
  }, [modelingServices]);

  useEffect(() => {
    void modelingServices
      .retainOpenDocuments(tabsState.tabs.map((tab) => tab.documentId))
      .catch((error: unknown) => {
        errorReporter.report(
          normalizeUnknownError(error, {
            code: "app/operation-failed",
            fallbackMessage: "Closed document resources could not be released.",
          }),
          { source: "workbench-tabs.close", visibility: "user" },
        );
      });
  }, [errorReporter, modelingServices, tabsState.tabs]);

  // The manifest follows collaborators; the tabs follow the manifest.
  const followedProjectRef = useRef(project);
  useEffect(() => {
    const previous = followedProjectRef.current;
    followedProjectRef.current = project;
    if (
      previous &&
      project &&
      previous !== project &&
      previous.projectId === project.projectId
    )
      tabsDispatch({ type: "followProject", previous, next: project });
  }, [project]);

  // Each save writes only the change since the previous save, so a
  // collaborator's concurrent part edits are kept.
  const savedTabsRef = useRef<readonly WorkbenchTab[] | null>(null);
  useEffect(() => {
    if (!tabsStorage || !project || !projectApplied) return;
    tabsStorage.save(tabsState);
    saveSession(project.projectId, tabsState.activeDocumentId);
    // A read-only role keeps its tab order locally; parts are never added,
    // closed or renamed for it (see the tab actions below).
    if (projectWriteGate.allows("manifest"))
      void saveParts(
        project.projectId,
        tabsState.tabs,
        savedTabsRef.current ?? undefined,
      );
    savedTabsRef.current = tabsState.tabs;
  }, [
    tabsState,
    tabsStorage,
    project,
    projectApplied,
    projectWriteGate,
    saveParts,
    saveSession,
  ]);

  useEffect(() => {
    if (!isLocalFileSyncDocumentRepository(documentRepository)) {
      return;
    }

    return documentRepository.subscribeToLocalFileSyncStatus((status) => {
      if (status.kind === "idle") {
        tabsDispatch({
          type: "updateStorage",
          documentId: status.documentId,
          storageKind: "browser",
          storageDescriptor: null,
        });
        return;
      }

      if (!status.metadata) {
        return;
      }

      tabsDispatch({
        type: "updateStorage",
        documentId: status.documentId,
        storageKind: "filesystem",
        storageDescriptor: status.metadata.fileName,
      });
    });
  }, [documentRepository]);

  useEffect(() => {
    if (!isLocalFileSyncDocumentRepository(documentRepository)) {
      return;
    }

    for (const tab of tabsState.tabs) {
      if (restoredBindingDocumentIdsRef.current.has(tab.documentId)) {
        continue;
      }
      restoredBindingDocumentIdsRef.current.add(tab.documentId);

      void documentRepository
        .restoreLocalFileBinding(tab.documentId)
        .then((metadata) => {
          if (!metadata) {
            return;
          }

          tabsDispatch({
            type: "updateStorage",
            documentId: tab.documentId,
            storageKind: "filesystem",
            storageDescriptor: metadata.fileName,
          });
        })
        .catch(() => {
          restoredBindingDocumentIdsRef.current.delete(tab.documentId);
        });
    }
  }, [documentRepository, tabsState.tabs]);

  const tabStorageFeedback = useTabStorageStatus({
    repository: documentRepository,
    client: documentSyncWorkerClient,
    services: modelingServices,
    tabs: tabsState,
    sync,
    report: projects.report,
  });

  const { setActiveDocument } = sync;
  useEffect(() => {
    setActiveDocument(tabsState.activeDocumentId);
  }, [setActiveDocument, tabsState.activeDocumentId]);

  // Adding, opening into and closing tabs adds or removes project parts.
  const createNewDocumentTab = useCallback(async () => {
    if (!projectWriteGate.authorize("manifest")) return null;
    const documentId = generateDocumentId();
    tabsDispatch({
      type: "open",
      tab: createDefaultWorkbenchTab(documentId),
      activate: true,
    });
    return documentId;
  }, [projectWriteGate]);

  const activateDocumentTab = useCallback((documentId: DocumentId) => {
    tabsDispatch({ type: "activate", documentId });
  }, []);

  const closeDocumentTab = useCallback(
    (documentId: DocumentId) => {
      if (!projectWriteGate.authorize("manifest")) return;
      tabsDispatch({ type: "close", documentId });
    },
    [projectWriteGate],
  );

  const reorderDocumentTab = useCallback(
    (documentId: DocumentId, toIndex: number) => {
      tabsDispatch({ type: "reorder", documentId, toIndex });
    },
    [],
  );

  const syncActiveDocumentTab = useCallback((tab: WorkbenchTab) => {
    tabsDispatch({ type: "syncActive", tab });
  }, []);

  const openDocumentCopy = useCallback(
    async (file: File): Promise<WorkbenchDocumentActionResult> => {
      if (!projectWriteGate.authorize("manifest"))
        return { status: "cancelled" };
      return openDocumentCopyAsTab({
        file,
        repository: documentRepository,
        createDocumentId: generateDocumentId,
        openTab(tab) {
          tabsDispatch({ type: "open", tab, activate: true });
        },
      });
    },
    [documentRepository, projectWriteGate],
  );

  const openDocumentTab = useCallback((tab: WorkbenchTab) => {
    tabsDispatch({ type: "open", tab, activate: true });
  }, []);
  const getDocumentModelingService = useCallback(
    (documentId: DocumentId) => modelingServices.get(documentId),
    [modelingServices],
  );
  const authorizeLaunchedFileOpen = useCallback(
    () => projectWriteGate.authorize("manifest"),
    [projectWriteGate],
  );
  const openDocumentIds = useMemo(
    () => tabsState.tabs.map((tab) => tab.documentId),
    [tabsState.tabs],
  );
  const launchedFileNotifications = useLaunchedDocumentFiles({
    authorizeOpen: authorizeLaunchedFileOpen,
    openDocumentIds,
    repository: documentRepository,
    createDocumentId: generateDocumentId,
    openTab: openDocumentTab,
    getModelingService: getDocumentModelingService,
    errorReporter,
  });
  const appNotifications = [
    ...(storageDurabilityNotification
      ? [{ id: "storage-durability", ...storageDurabilityNotification }]
      : []),
    ...launchedFileNotifications,
  ];

  const openLinkedDocument =
    useCallback(async (): Promise<WorkbenchDocumentActionResult> => {
      if (!projectWriteGate.authorize("manifest"))
        return { status: "cancelled" };
      return openLinkedDocumentAsTab({
        repository: documentRepository,
        createDocumentId: generateDocumentId,
        openTab(tab) {
          tabsDispatch({ type: "open", tab, activate: true });
        },
      });
    }, [documentRepository, projectWriteGate]);

  const { requestSignIn } = useSignInRequest();
  // A signed-out visit to an account project's address offers the sign-in.
  useEffect(() => {
    if (sync.addressNeedsSignIn) requestSignIn();
  }, [requestSignIn, sync.addressNeedsSignIn]);
  const newProjectChoices = useMemo(
    () => createLocalStorageNewProjectChoiceStore(window.localStorage),
    [],
  );
  const online = useBrowserOnline();
  const [newProjectDialog, setNewProjectDialog] = useState<{
    lastChoice: NewProjectChoice | null;
    busy: boolean;
    error: string | null;
    /** Opened by Share on a local part: the project receives it, then is shared. */
    share: { documentId: DocumentId; name: string } | null;
  } | null>(() =>
    new URLSearchParams(window.location.search).get("newProject") === "1"
      ? {
          lastChoice: newProjectChoices.load(),
          busy: false,
          error: null,
          share: null,
        }
      : null,
  );
  const { refreshAccount, createAccountProject } = sync;
  // Share on a local part waiting for a sign-in: it continues once this tab
  // or the tab a sign-in link opened reports the new session. Opening
  // another project dialog drops it, since the sign-in may have been dismissed.
  const [shareAfterSignIn, setShareAfterSignIn] = useState<DocumentId | null>(
    null,
  );
  const openNewProjectDialog = useCallback(() => {
    void refreshAccount();
    setShareAfterSignIn(null);
    setNewProjectDialog({
      lastChoice: newProjectChoices.load(),
      busy: false,
      error: null,
      share: null,
    });
  }, [newProjectChoices, refreshAccount]);
  const openShareNewProjectDialog = useCallback(
    (documentId: DocumentId) => {
      // The part may have closed or moved while the sign-in ran: the active
      // part is shared instead.
      const tab =
        tabsState.tabs.find(
          (candidate) => candidate.documentId === documentId,
        ) ??
        tabsState.tabs.find(
          (candidate) => candidate.documentId === tabsState.activeDocumentId,
        );
      if (!tab) return;
      setNewProjectDialog({
        lastChoice: newProjectChoices.load(),
        busy: false,
        error: null,
        share: { documentId: tab.documentId, name: tab.title },
      });
    },
    [newProjectChoices, tabsState.activeDocumentId, tabsState.tabs],
  );
  useEffect(() => {
    if (shareAfterSignIn === null) return;
    let live = true;
    const continueWhenSignedIn = () => {
      void refreshAccount().then((account) => {
        if (!live || !account) return;
        setShareAfterSignIn(null);
        openShareNewProjectDialog(shareAfterSignIn);
      });
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === ACCOUNT_SESSION_CHANGED) continueWhenSignedIn();
    };
    window.addEventListener(ACCOUNT_SESSION_CHANGED, continueWhenSignedIn);
    window.addEventListener("storage", storageChanged);
    return () => {
      live = false;
      window.removeEventListener(ACCOUNT_SESSION_CHANGED, continueWhenSignedIn);
      window.removeEventListener("storage", storageChanged);
    };
  }, [openShareNewProjectDialog, refreshAccount, shareAfterSignIn]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("newProject") !== "1") return;
    void refreshAccount();
    url.searchParams.delete("newProject");
    window.history.replaceState(null, "", url);
  }, [refreshAccount]);
  const [moveDialog, setMoveDialog] = useState<{
    documentId: DocumentId;
    targetId: string | null;
    /** Opened from the local document offer: name the account it moves into. */
    toAccount: boolean;
    /** Retrying a Share whose part did not move: share the target after the move. */
    shareAfterMove?: boolean;
    busy: boolean;
    error: string | null;
  } | null>(null);
  /** Moves a part into `target`, then the window follows it there. */
  const moveDocumentAndFollow = async (
    target: ProjectManifest,
    documentId: DocumentId,
  ) => {
    if (!workerDocumentRepository)
      throw new Error("Moving a part needs browser storage.");
    const moved = await sync.moveDocument({
      target,
      documentId,
      waitForLocalChanges,
      cloneWithHistory: (sourceDocumentId, targetDocumentId) =>
        workerDocumentRepository.cloneWithHistory(
          sourceDocumentId,
          targetDocumentId,
        ),
    });
    if (moved.sourceRemovalUnconfirmed)
      errorReporter.report(
        normalizeUnknownError(moved.sourceRemovalUnconfirmed, {
          code: "app/operation-failed",
          fallbackMessage: moved.sourceRemovalUnconfirmed.message,
        }),
        { source: "project-sync", visibility: "user" },
      );
    // A switch failure is reported with the other project notices.
    try {
      await projects.select(
        (repository) => repository.open(target.projectId),
        moved.documentId,
      );
    } finally {
      moved.release();
    }
  };
  const createProject = async (input: NewProjectInput) => {
    const share = newProjectDialog?.share ?? null;
    const lastChoice = { location: input.location, ownerId: input.ownerId };
    setNewProjectDialog({ lastChoice, busy: true, error: null, share });
    // A project made from Move or Share is account-only; it is not the
    // user's default.
    if (!moveDialog && !share) newProjectChoices.save(lastChoice);
    let created: ProjectManifest | null = null;
    try {
      await waitForLocalChanges();
      created =
        input.location === "local"
          ? null
          : await createAccountProject({
              name: input.name,
              orgId: input.ownerId,
              visibility: input.location,
              withoutParts: share !== null,
            });
      // Created from Share (account locations only): the part moves in, the
      // window follows it and the new project's Share dialog opens.
      if (share && created?.service) {
        await moveDocumentAndFollow(created, share.documentId);
        openShareDialog({ ...created.service, name: created.name });
      }
      // Created from Move to project (account locations only): the window
      // stays on the source and the Move dialog returns with it chosen.
      else if (moveDialog && created) {
        const createdId = created.projectId;
        await projects.refreshProjects();
        setMoveDialog(
          (current) => current && { ...current, targetId: createdId },
        );
      }
      // A switch failure is reported with the other project notices.
      else
        await projects.select((repository) =>
          created
            ? repository.open(created.projectId)
            : repository.create(input.name, [
                {
                  docId: generateDocumentId(),
                  name: DEFAULT_WORKBENCH_DOCUMENT_NAME,
                  kind: "part",
                },
              ]),
        );
      setNewProjectDialog(null);
    } catch (error) {
      // A failed upload keeps the new project on this device; list it.
      if (input.location !== "local")
        void projects.refreshProjects().catch(projects.report);
      const message = error instanceof Error ? error.message : String(error);
      // The project exists but the part did not move: Move to project
      // retries into it rather than creating another.
      if (share && created) {
        setNewProjectDialog(null);
        setMoveDialog({
          documentId: share.documentId,
          targetId: created.projectId,
          toAccount: true,
          shareAfterMove: true,
          busy: false,
          error: message,
        });
        return;
      }
      setNewProjectDialog({ lastChoice, busy: false, error: message, share });
    }
  };

  const openAccountMoveDialog = useCallback(() => {
    void refreshAccount();
    setShareAfterSignIn(null);
    setMoveDialog({
      documentId: tabsState.activeDocumentId,
      targetId: null,
      toAccount: true,
      busy: false,
      error: null,
    });
  }, [refreshAccount, tabsState.activeDocumentId]);
  const organizations = sync.account?.organizations ?? [];
  const sourceEditable = projectAccessAllows(
    { linked: projectLinked, role: projectRole },
    "manifest",
  );
  const moveUnavailableReason = documentMoveUnavailableReason({
    sourceEditable,
    projectCount: projects.projects.length,
  });
  const documentTabMenuItems = useCallback(
    (tab: WorkbenchTab): WorkbenchContextMenuEntry[] => [
      {
        kind: "item",
        id: "move-to-project",
        label: "Move to project…",
        disabled: moveUnavailableReason !== null,
        onSelect: () => {
          void refreshAccount();
          setShareAfterSignIn(null);
          setMoveDialog({
            documentId: tab.documentId,
            targetId: null,
            toAccount: false,
            busy: false,
            error: null,
          });
        },
      },
      ...(moveUnavailableReason === null
        ? []
        : [
            {
              kind: "content" as const,
              id: "move-to-project-unavailable",
              render: () => (
                <Text size="xs" c="dimmed" px="sm" py={4}>
                  {moveUnavailableReason}
                </Text>
              ),
            },
          ]),
    ],
    [moveUnavailableReason, refreshAccount],
  );
  const moveDocumentTitle = moveDialog
    ? (tabsState.tabs.find((tab) => tab.documentId === moveDialog.documentId)
        ?.title ?? "")
    : "";
  const moveTargets =
    project && moveDialog
      ? projectMoveTargets(projects.projects, project.projectId, {
          online,
          // Unknown until the account check answers; the move asks the service.
          signedIn: !sync.accountChecked || sync.account !== null,
          organizations,
          storageAtLimit: (target) => {
            const usage = sync.account?.me.organizations.find(
              (org) => org.organizationId === target.service?.orgId,
            );
            return usage ? summarizeQuota(usage).storageAtLimit : false;
          },
          editable: (target) => {
            const role = sync.knownRole(target.service);
            return role === null || canWriteProjectDocument(role, "part");
          },
        })
      : [];
  const moveToProject = async (targetProjectId: string) => {
    const target = projects.projects.find(
      (candidate) => candidate.projectId === targetProjectId,
    );
    if (!moveDialog || !target) return;
    setMoveDialog({ ...moveDialog, busy: true, error: null });
    try {
      await moveDocumentAndFollow(target, moveDialog.documentId);
      setMoveDialog(null);
      if (moveDialog.shareAfterMove && target.service)
        openShareDialog({ ...target.service, name: target.name });
    } catch (error) {
      setMoveDialog({
        ...moveDialog,
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // Switching keeps the page, its kernel and workers: only the per-project
  // workbench remounts.
  const switchProject = (projectId: string) => {
    void waitForLocalChanges()
      .then(() => projects.select((repository) => repository.open(projectId)))
      .catch(projects.report);
  };
  /**
   * Share opens an account project's Share dialog. A local part first needs
   * an account project to move into: sign in if needed, then New project
   * with the part's name, then the move (see createProject).
   */
  const shareFromFileMenu = () => {
    if (!project) return;
    if (project.service) {
      openShareDialog({ ...project.service, name: project.name });
      return;
    }
    const documentId = tabsState.activeDocumentId;
    void refreshAccount().then((account) => {
      // Offline, the New project modal explains why account cards are off.
      if (account || !online) openShareNewProjectDialog(documentId);
      else {
        setShareAfterSignIn(documentId);
        requestSignIn();
      }
    });
  };
  const [recentProjectIds] = useState(() =>
    createLocalStorageRecentProjectsStore(window.localStorage).load(),
  );
  const fileMenuCallbacks = useLatestCallbacks({
    onSwitch: switchProject,
    onNewProject: openNewProjectDialog,
    onShare: shareFromFileMenu,
  });
  const fileMenuBusy = projects.busy || localSaving;
  const fileMenuProject = useMemo((): DocumentFileMenuProject | undefined => {
    if (!project) return undefined;
    return {
      name: project.name,
      recents: recentProjects(
        projects.projects,
        recentProjectIds,
        project.projectId,
      ).map(({ projectId, name }) => ({ projectId, name })),
      busy: fileMenuBusy,
      allProjectsHref: `/dashboard${window.location.search}`,
      ...fileMenuCallbacks,
    };
  }, [
    fileMenuBusy,
    fileMenuCallbacks,
    project,
    projects.projects,
    recentProjectIds,
  ]);

  return (
    <RuntimeExtensionRegistryProvider registries={runtimeExtensionRegistries}>
      <ModelingServiceProvider modelingService={modelingService}>
        <DurableHistoryProvider durableHistory={durableHistory}>
          <EditorProvider
            modelingService={modelingService}
            editorDependencies={editorDependencies}
          >
            <CadWorkbench
              projectLoading={!projectApplied}
              localDocumentOffers={localDocumentOffers}
              localProject={project !== null && !project.service}
              onMoveActiveDocumentToAccount={openAccountMoveDialog}
              projectOpenFailed={projects.discoveryFailed}
              readOnly={
                !projectAccessAllows(
                  { linked: projectLinked, role: projectRole },
                  "part",
                )
              }
              projectWriteGate={projectWriteGate}
              fileMenuProject={fileMenuProject}
              projectPresence={<ProjectSyncPresence sync={sync} />}
              presencePeers={sync.otherPeers}
              onPresenceSelectionChange={sync.setSelection}
              projectControls={
                project && (
                  <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                    <ProjectSwitcher
                      projects={projects.projects.map((listed) => ({
                        projectId: listed.projectId,
                        name: listed.name,
                        group: projectGroupLabel(listed, organizations),
                      }))}
                      activeProjectId={project.projectId}
                      busy={projects.busy || localSaving}
                      onSwitch={switchProject}
                      onCreate={openNewProjectDialog}
                    />
                    <ProjectSyncControls
                      sync={sync}
                      project={project}
                      onOpened={(manifest) =>
                        waitForLocalChanges()
                          .then(() =>
                            projects.select((repository) =>
                              repository.open(manifest.projectId),
                            ),
                          )
                          .catch((error: unknown) => {
                            projects.report(error);
                            return false;
                          })
                      }
                    />
                  </Group>
                )
              }
              tabsState={tabsState}
              tabStorageFeedback={tabStorageFeedback}
              onActivateDocumentTab={activateDocumentTab}
              onCloseDocumentTab={closeDocumentTab}
              onCreateNewDocument={createNewDocumentTab}
              onOpenDocumentCopy={openDocumentCopy}
              onOpenLinkedDocument={openLinkedDocument}
              performanceTelemetry={performanceTelemetry}
              onReorderDocumentTab={reorderDocumentTab}
              onSyncActiveDocumentTab={syncActiveDocumentTab}
              documentTabMenuItems={
                project && workerDocumentRepository
                  ? documentTabMenuItems
                  : undefined
              }
              projectNotification={projectNotification}
              localSaveNotification={localSaveNotification}
              appNotifications={appNotifications}
              localSaving={localSaving}
            />
          </EditorProvider>
        </DurableHistoryProvider>
      </ModelingServiceProvider>
      <NewProjectModal
        opened={newProjectDialog !== null}
        account={sync.account}
        offline={!online}
        lastChoice={newProjectDialog?.lastChoice ?? null}
        busy={newProjectDialog?.busy ?? false}
        error={newProjectDialog?.error ?? null}
        accountOnly={moveDialog !== null}
        localUnavailableReason={
          newProjectDialog?.share
            ? "Sharing needs an account project."
            : undefined
        }
        initialName={newProjectDialog?.share?.name}
        onSignIn={() => {
          setNewProjectDialog(null);
          requestSignIn();
        }}
        onCancel={() => {
          if (!newProjectDialog?.busy) setNewProjectDialog(null);
        }}
        onSubmit={(input) => void createProject(input)}
      />
      <MoveToProjectModal
        opened={moveDialog !== null && newProjectDialog === null}
        // Only a signed-in move out of a local project can use a new
        // account project; its form offers no Local card.
        onNewProject={
          sync.account && project && !project.service
            ? openNewProjectDialog
            : undefined
        }
        accountEmail={
          moveDialog?.toAccount ? sync.account?.user.email : undefined
        }
        documentTitle={moveDocumentTitle}
        targets={moveTargets}
        targetId={moveDialog?.targetId ?? null}
        busy={moveDialog?.busy ?? false}
        error={moveDialog?.error ?? null}
        onTargetChange={(targetId) => {
          if (moveDialog) setMoveDialog({ ...moveDialog, targetId });
        }}
        onCancel={() => {
          if (!moveDialog?.busy) setMoveDialog(null);
        }}
        onMove={(projectId) => void moveToProject(projectId)}
      />
      {/* Production builds only: the service worker's update prompt. */}
      <AppUpdateNotification waitForLocalChanges={waitForLocalChanges} />
    </RuntimeExtensionRegistryProvider>
  );
}
