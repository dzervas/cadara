import type {
  ProjectManifest,
  ProjectResult,
} from "@/contracts/modeling/project-manifest";
import type {
  WorkbenchTab,
  WorkbenchTabsState,
} from "@/core/workspace/workbench-tabs";
import { OCC_KERNEL_DOCUMENT_ID } from "@/core/modeling/opencascade-kernel-seed";
import { WorkbenchPartReadiness } from "@/application/workspace/workbench-part-readiness";
import type { PendingLocalWrites } from "@/application/workspace/local-save-guard";
import type { LocalProjectRepository } from "./local-project-repository";
import type { IndexedDbAutomergeDocumentRepository } from "./indexeddb-automerge-document-repository";
import { createWorkbenchProjectSessionStore } from "./workbench-project-session-store";
import {
  createDocumentRepositoryUrlStorageKey,
  createLocalStorageDocumentRepositoryUrlStore,
  getDocumentRepositoryStorageNamespace,
} from "./document-repository-url-store";
import {
  createLocalStorageWorkbenchTabsStore,
  type StorageLike,
} from "./local-storage-workbench-tabs-store";

function unwrapProjectResult<T>(result: ProjectResult<T>): T {
  if (!result.ok) throw new Error(result.diagnostic.message);
  return result.value;
}

/**
 * Opens the workbench's project state before the shell mounts.
 *
 * Invariant: no document repository means no durable project. Without a
 * repository (the app runs with `cadDisableRepository=1`, so parts have no
 * Automerge URLs) the workbench keeps only its in-memory tabs: it neither reads
 * nor writes the project session or cached tabs, never discovers or creates a
 * project, and project loading is complete from the start.
 */
export function createWorkbenchProjectBootstrap(
  storage: StorageLike,
  search: string,
  persistenceEnabled: boolean,
) {
  const namespace = getDocumentRepositoryStorageNamespace(search);
  const databaseName =
    new URLSearchParams(search).get("cadRepositoryDbName") ??
    "cad-authored-documents";
  // Local peer channels share part pointers across databases, not project catalogs.
  const projectNamespace = `${namespace}:projects:${databaseName}`;
  const sessionStore = persistenceEnabled
    ? createWorkbenchProjectSessionStore(
        storage,
        `cad.workbench.activeProject.v1:${projectNamespace}`,
      )
    : null;
  let initialFailure: unknown = null;
  let session: ReturnType<
    ReturnType<typeof createWorkbenchProjectSessionStore>["load"]
  > = null;
  try {
    session = sessionStore?.load() ?? null;
  } catch (error) {
    initialFailure = error;
  }
  const cached = persistenceEnabled
    ? createLocalStorageWorkbenchTabsStore(
        storage,
        session
          ? `cad.workbench.tabs.project.v1:${session.projectId}`
          : undefined,
      ).load()
    : null;
  const defaultTab: WorkbenchTab = {
    documentId: session?.activeDocumentId ?? OCC_KERNEL_DOCUMENT_ID,
    title: "Workspace",
    storageKind: "browser",
    storageDescriptor: null,
  };
  const initialTabs: WorkbenchTabsState =
    cached?.ok && cached.state
      ? cached.state
      : {
          tabs: [defaultTab],
          activeDocumentId: defaultTab.documentId,
        };
  if (session) {
    if (
      !initialTabs.tabs.some(
        (tab) => tab.documentId === session.activeDocumentId,
      )
    )
      initialTabs.tabs = [...initialTabs.tabs, defaultTab];
    initialTabs.activeDocumentId = session.activeDocumentId;
  }
  const partReadiness = new WorkbenchPartReadiness();
  let repository:
    | Promise<{
        projects: LocalProjectRepository;
        documents: IndexedDbAutomergeDocumentRepository;
      }>
    | undefined;
  let initialProject: Promise<ProjectManifest> | undefined;
  const openRepository = () => {
    if (!persistenceEnabled)
      throw new Error("Project persistence is disabled.");
    // Automerge initialization is independent of mounting the current part's shell.
    repository ??= Promise.all([
      import("@/infrastructure/persistence/local-project-repository"),
      import("@/infrastructure/persistence/indexeddb-automerge-document-repository"),
    ]).then(
      ([
        { LocalProjectRepository },
        { IndexedDbAutomergeDocumentRepository },
      ]) => {
        const urls = createLocalStorageDocumentRepositoryUrlStore(
          storage,
          createDocumentRepositoryUrlStorageKey(namespace),
        );
        const catalogUrls = createLocalStorageDocumentRepositoryUrlStore(
          storage,
          createDocumentRepositoryUrlStorageKey(projectNamespace),
        );
        const documents = new IndexedDbAutomergeDocumentRepository({
          databaseName,
          urlStore: urls,
        });
        return {
          documents,
          projects: new LocalProjectRepository(
            documents,
            urls,
            catalogUrls,
            (docId) => partReadiness.ensure(docId),
          ),
        };
      },
    );
    return repository;
  };
  const getRepository = () => openRepository().then(({ projects }) => projects);
  return {
    persistenceEnabled,
    sessionStore,
    session,
    initialTabs,
    initialFailure,
    partReadiness,
    registerPartReadiness: (
      owner: Parameters<WorkbenchPartReadiness["register"]>[0],
    ) => partReadiness.register(owner),
    getRepository,
    /** The Repo holding catalog and manifests; project sync bridges it. */
    getProjectAutomergeRepo: async () =>
      (await openRepository()).documents.getOwnedAutomergeRepo(),
    /**
     * Opens the stored project, or creates one from the initial tabs. Returns
     * null when persistence is disabled: there is no project to load.
     * Repeated calls (Strict Mode effect replays) share one discovery.
     */
    openInitialProject(
      pendingWrites: PendingLocalWrites,
    ): Promise<ProjectManifest> | null {
      if (!persistenceEnabled) return null;
      initialProject ??= (async () => {
        if (initialFailure) throw initialFailure;
        const projects = await getRepository();
        const available = unwrapProjectResult(await projects.list());
        if (available.length)
          return unwrapProjectResult(
            await projects.open(
              available.find((entry) => entry.projectId === session?.projectId)
                ?.projectId ?? available[0].projectId,
            ),
          );
        const finish = pendingWrites.begin();
        try {
          return unwrapProjectResult(
            await projects.create(
              "My project",
              initialTabs.tabs.map((tab) => ({
                docId: tab.documentId,
                name: tab.title,
                kind: "part" as const,
              })),
            ),
          );
        } finally {
          finish();
        }
      })();
      return initialProject;
    },
  };
}
