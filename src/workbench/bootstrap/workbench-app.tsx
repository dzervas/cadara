// SLOP: Retained workbench session host while provider composition and document-tab persistence are separated from browser app bootstrap.
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import { Alert } from "@mantine/core";
import { ProjectSwitcher } from "@/components/layout/project-switcher";
import { useWorkbenchProject } from "./use-workbench-project";

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
  reduceWorkbenchTabs,
  type WorkbenchTab,
  type WorkbenchTabsAction,
  type WorkbenchTabsState,
} from "@/core/workspace/workbench-tabs";
import {
  createWorkbenchProjectTabs,
  mergeDiscoveredWorkbenchProjectTabs,
} from "@/core/workspace/workbench-project-tabs";
import { EditorProvider } from "@/hooks/editor-provider";
import { ModelingServiceProvider } from "@/hooks/modeling-service-provider";
import { RuntimeExtensionRegistryProvider } from "@/hooks/runtime-extension-registry-provider";
import { CadWorkbench } from "@/workbench/shell/cad-workbench";
import { WorkbenchModelingServices } from "@/application/workspace/workbench-modeling-services";
import { createDurableHistoryService } from "@/application/history/durable-history";
import { createLocalStorageOperationHistoryStore } from "@/infrastructure/persistence/local-storage-operation-history-store";
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
import { AppUpdateNotification } from "@/components/layout/app-update-notification";
import { useWorkbenchLocalSaveGuard } from "@/workbench/adapters/use-workbench-local-save-guard";
import {
  openDocumentCopyAsTab,
  openLinkedDocumentAsTab,
  type WorkbenchDocumentActionResult,
} from "@/workbench/document/document-file-actions";

const DEFAULT_WORKBENCH_DOCUMENT_NAME = "Workspace";

function generateDocumentId(): DocumentId {
  const slug =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replaceAll("-", "")
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `doc_${slug}` as DocumentId;
}

function createDefaultWorkbenchTab(documentId: DocumentId): WorkbenchTab {
  return {
    documentId,
    title: DEFAULT_WORKBENCH_DOCUMENT_NAME,
    storageKind: "browser",
    storageDescriptor: null,
  };
}

function createWorkbenchOperationHistoryKey(documentId: DocumentId) {
  return `cad.modeling.operationHistory.${documentId}.v1`;
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
  const projects = useWorkbenchProject();
  if (projects.initialFailure)
    return (
      <Alert color="red" title="Project could not be opened">
        {projects.failure ?? "Invalid stored project session."}
      </Alert>
    );
  return (
    <ProjectWorkbenchApp
      key={projects.sessionKey}
      {...props}
      projects={projects}
    />
  );
}

function ProjectWorkbenchApp({
  createKernelAdapter,
  documentSyncWorkerClient,
  releaseDocumentResources,
  performanceTelemetry = noopPerformanceTelemetry,
  runtimeExtensionRegistries,
  projects,
}: WorkbenchAppProps & { projects: ReturnType<typeof useWorkbenchProject> }) {
  const errorReporter = useErrorReporter();
  const project = projects.project;
  const { saveParts, saveSession } = projects;
  const [projectApplied, setProjectApplied] = useState(project !== null);
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
  const documentRepository = useMemo(() => {
    if (typeof window === "undefined" || !documentSyncWorkerClient) {
      return null;
    }

    return createInstrumentedDocumentRepository(
      createWorkerBackedDocumentRepository({
        client: documentSyncWorkerClient,
        urlStore: createLocalStorageDocumentRepositoryUrlStore(
          window.localStorage,
          createDocumentRepositoryUrlStorageKey(
            getDocumentRepositoryStorageNamespace(window.location.search),
          ),
        ),
      }),
      performanceTelemetry,
    );
  }, [documentSyncWorkerClient, performanceTelemetry]);
  const projectTabs = useCallback((): WorkbenchTabsState => {
    if (!project) return projects.initialTabs;
    const cached = tabsStorage?.load();
    return createWorkbenchProjectTabs(
      project,
      cached?.ok ? cached.state : null,
      projects.initialTabs,
    );
  }, [project, projects.initialTabs, tabsStorage]);
  const [tabsState, tabsDispatch] = useReducer(
    (
      state: WorkbenchTabsState,
      action:
        | WorkbenchTabsAction
        | { type: "restoreProject"; state: WorkbenchTabsState },
    ) =>
      action.type === "restoreProject"
        ? action.state
        : reduceWorkbenchTabs(state, action),
    undefined,
    projectTabs,
  );
  if (project && !projectApplied) {
    tabsDispatch({
      type: "restoreProject",
      state: mergeDiscoveredWorkbenchProjectTabs(project, tabsState),
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
                    createWorkbenchOperationHistoryKey(documentId),
                  ),
            documentRepositoryPersistence: "background",
            documentRepository,
          }),
          performanceTelemetry,
        );
      }, releaseDocumentResources),
    [
      createKernelAdapter,
      documentRepository,
      performanceTelemetry,
      runtimeExtensionRegistries.exportProviders,
      releaseDocumentResources,
    ],
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

  useEffect(() => {
    if (!tabsStorage || !project || !projectApplied) return;
    tabsStorage.save(tabsState);
    saveSession(project.projectId, tabsState.activeDocumentId);
    void saveParts(project.projectId, tabsState.tabs);
  }, [tabsState, tabsStorage, project, projectApplied, saveParts, saveSession]);

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

  const createNewDocumentTab = useCallback(async () => {
    const documentId = generateDocumentId();
    tabsDispatch({
      type: "open",
      tab: createDefaultWorkbenchTab(documentId),
      activate: true,
    });
    return documentId;
  }, []);

  const activateDocumentTab = useCallback((documentId: DocumentId) => {
    tabsDispatch({ type: "activate", documentId });
  }, []);

  const closeDocumentTab = useCallback((documentId: DocumentId) => {
    tabsDispatch({ type: "close", documentId });
  }, []);

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
      return openDocumentCopyAsTab({
        file,
        repository: documentRepository,
        createDocumentId: generateDocumentId,
        openTab(tab) {
          tabsDispatch({ type: "open", tab, activate: true });
        },
      });
    },
    [documentRepository],
  );

  const openLinkedDocument =
    useCallback(async (): Promise<WorkbenchDocumentActionResult> => {
      return openLinkedDocumentAsTab({
        repository: documentRepository,
        createDocumentId: generateDocumentId,
        openTab(tab) {
          tabsDispatch({ type: "open", tab, activate: true });
        },
      });
    }, [documentRepository]);

  return (
    <RuntimeExtensionRegistryProvider registries={runtimeExtensionRegistries}>
      <ModelingServiceProvider modelingService={modelingService}>
        <DurableHistoryProvider durableHistory={durableHistory}>
          <EditorProvider
            modelingService={modelingService}
            editorDependencies={editorDependencies}
          >
            {projects.failure && (
              <Alert
                color="red"
                title="Project could not be saved"
                pos="absolute"
                top={80}
                right={16}
                style={{ zIndex: 200 }}
              >
                {projects.failure}
              </Alert>
            )}
            <CadWorkbench
              projectLoading={!projectApplied}
              projectControls={
                project && (
                  <ProjectSwitcher
                    projects={projects.projects}
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
                    onCreate={(name) => {
                      void waitForLocalChanges()
                        .then(() =>
                          projects.select((repository) =>
                            repository.create(name, [
                              {
                                docId: generateDocumentId(),
                                name: DEFAULT_WORKBENCH_DOCUMENT_NAME,
                                kind: "part",
                              },
                            ]),
                          ),
                        )
                        .catch(projects.report);
                    }}
                  />
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
              localSaveNotification={localSaveNotification}
              localSaving={localSaving}
            />
          </EditorProvider>
        </DurableHistoryProvider>
      </ModelingServiceProvider>
      {/* Production builds only: the service worker's update prompt. */}
      <AppUpdateNotification waitForLocalChanges={waitForLocalChanges} />
    </RuntimeExtensionRegistryProvider>
  );
}
