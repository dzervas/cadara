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
import { ProjectSwitcher } from "@/components/layout/project-switcher";
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
import type { NewProjectChoice } from "@/core/account/project-location-options";
import { useBrowserOnline } from "@/hooks/use-browser-online";
import { summarizeQuota } from "@/core/account/quota-summary";
import { createProjectWriteGatedDocumentRepository } from "@/application/project-sync/project-write-gated-document-repository";
import { useWorkbenchProject } from "./use-workbench-project";
import { useProjectSync, type ProjectSync } from "./use-project-sync";
import { ProjectSyncControls } from "./project-sync-controls";

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
  const projects = useWorkbenchProject(props.documentSyncWorkerClient !== null);
  const sync = useProjectSync(props.documentSyncWorkerClient, projects);
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
      />
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
}: WorkbenchAppProps & {
  projects: ReturnType<typeof useWorkbenchProject>;
  sync: ProjectSync;
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
  const [tabsState, tabsDispatch] = useReducer(
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
  const kernelVersionRetired = useOccKernelVersionRetired();
  // A retired kernel fails the part readiness the project waits for; the
  // update notification's reload is the outcome. A failed discovery leaves
  // nothing to edit: a reload recovers from a passing cause; repairing the
  // project list recovers from a stored catalog or manifest that no longer
  // opens.
  const { repairCatalog, repair } = projects;
  const projectNotification = useMemo(
    (): WorkbenchNotificationModel | null =>
      !projects.failure || kernelVersionRetired
        ? null
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
  const newProjectChoices = useMemo(
    () => createLocalStorageNewProjectChoiceStore(window.localStorage),
    [],
  );
  const online = useBrowserOnline();
  const [newProjectDialog, setNewProjectDialog] = useState<{
    lastChoice: NewProjectChoice | null;
    busy: boolean;
    error: string | null;
  } | null>(null);
  const { refreshAccount, createAccountProject } = sync;
  const openNewProjectDialog = useCallback(() => {
    void refreshAccount();
    setNewProjectDialog({
      lastChoice: newProjectChoices.load(),
      busy: false,
      error: null,
    });
  }, [newProjectChoices, refreshAccount]);
  const createProject = async (input: NewProjectInput) => {
    const lastChoice = { location: input.location, ownerId: input.ownerId };
    setNewProjectDialog({ lastChoice, busy: true, error: null });
    newProjectChoices.save(lastChoice);
    try {
      await waitForLocalChanges();
      const created =
        input.location === "local"
          ? null
          : await createAccountProject({
              name: input.name,
              orgId: input.ownerId,
              visibility: input.location,
            });
      // A switch failure is reported with the other project notices.
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
      setNewProjectDialog({
        lastChoice,
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const [moveDialog, setMoveDialog] = useState<{
    documentId: DocumentId;
    busy: boolean;
    error: string | null;
  } | null>(null);
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
          setMoveDialog({
            documentId: tab.documentId,
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
    if (!moveDialog || !target || !workerDocumentRepository) return;
    setMoveDialog({ ...moveDialog, busy: true, error: null });
    try {
      const moved = await sync.moveDocument({
        target,
        documentId: moveDialog.documentId,
        waitForLocalChanges,
        cloneWithHistory: (documentId, targetDocumentId) =>
          workerDocumentRepository.cloneWithHistory(
            documentId,
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
      // The window follows the part to its new project; a switch failure
      // is reported with the other project notices.
      try {
        await projects.select(
          (repository) => repository.open(target.projectId),
          moved.documentId,
        );
      } finally {
        moved.release();
      }
      setMoveDialog(null);
    } catch (error) {
      setMoveDialog({
        ...moveDialog,
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

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
              projectOpenFailed={projects.discoveryFailed}
              readOnly={
                !projectAccessAllows(
                  { linked: projectLinked, role: projectRole },
                  "part",
                )
              }
              projectWriteGate={projectWriteGate}
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
                      onSwitch={(projectId) => {
                        void waitForLocalChanges()
                          .then(() =>
                            projects.select((repository) =>
                              repository.open(projectId),
                            ),
                          )
                          .catch(projects.report);
                      }}
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
        opened={moveDialog !== null}
        documentTitle={moveDocumentTitle}
        targets={moveTargets}
        busy={moveDialog?.busy ?? false}
        error={moveDialog?.error ?? null}
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
