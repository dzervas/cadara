import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  ProjectManifest,
  ProjectResult,
} from "@/contracts/modeling/project-manifest";
import type {
  WorkbenchTab,
  WorkbenchTabsState,
} from "@/core/workspace/workbench-tabs";
import { normalizeUnknownError } from "@/contracts/errors";
import { useErrorReporter } from "@/hooks/use-error-reporter";
import { PendingLocalWrites } from "@/application/workspace/local-save-guard";
import type { LocalProjectRepository } from "@/infrastructure/persistence/local-project-repository";
import { createWorkbenchProjectSessionStore } from "@/infrastructure/persistence/workbench-project-session-store";
import {
  createDocumentRepositoryUrlStorageKey,
  createLocalStorageDocumentRepositoryUrlStore,
  getDocumentRepositoryStorageNamespace,
} from "@/infrastructure/persistence/document-repository-url-store";
import { createLocalStorageWorkbenchTabsStore } from "@/infrastructure/persistence/local-storage-workbench-tabs-store";
import { OCC_KERNEL_DOCUMENT_ID } from "@/core/modeling/opencascade-kernel-seed";

export function useWorkbenchProject() {
  const reporter = useErrorReporter();
  const [project, setProject] = useState<ProjectManifest | null>(null);
  const [projects, setProjects] = useState<ProjectManifest[]>([]);
  const [sessionKey, setSessionKey] = useState("initial");
  const [busy, setBusy] = useState(true);
  const pendingWrites = useMemo(() => new PendingLocalWrites(), []);
  const saving = useSyncExternalStore(
    useCallback(
      (listener: () => void) => pendingWrites.subscribe(listener),
      [pendingWrites],
    ),
    () => pendingWrites.getPendingWriteCount(),
  );
  const [failure, setFailure] = useState<string | null>(null);
  const context = useMemo(() => {
    const namespace = getDocumentRepositoryStorageNamespace(
      window.location.search,
    );
    const databaseName =
      new URLSearchParams(window.location.search).get("cadRepositoryDbName") ??
      "cad-authored-documents";
    // Local peer channels share part pointers across databases, not project catalogs.
    const projectNamespace = `${namespace}:projects:${databaseName}`;
    const sessionStore = createWorkbenchProjectSessionStore(
      window.localStorage,
      `cad.workbench.activeProject.v1:${projectNamespace}`,
    );
    let initialFailure: unknown = null;
    let session: ReturnType<typeof sessionStore.load> = null;
    try {
      session = sessionStore.load();
    } catch (error) {
      initialFailure = error;
    }
    const cached = createLocalStorageWorkbenchTabsStore(
      window.localStorage,
      session
        ? `cad.workbench.tabs.project.v1:${session.projectId}`
        : undefined,
    ).load();
    const defaultTab: WorkbenchTab = {
      documentId: session?.activeDocumentId ?? OCC_KERNEL_DOCUMENT_ID,
      title: "Workspace",
      storageKind: "browser",
      storageDescriptor: null,
    };
    const initialTabs: WorkbenchTabsState =
      cached.ok && cached.state
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
    let repository: Promise<LocalProjectRepository> | undefined;
    return {
      sessionStore,
      session,
      initialTabs,
      initialFailure,
      getRepository() {
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
              window.localStorage,
              createDocumentRepositoryUrlStorageKey(namespace),
            );
            const catalogUrls = createLocalStorageDocumentRepositoryUrlStore(
              window.localStorage,
              createDocumentRepositoryUrlStorageKey(projectNamespace),
            );
            return new LocalProjectRepository(
              new IndexedDbAutomergeDocumentRepository({
                databaseName,
                urlStore: urls,
              }),
              urls,
              catalogUrls,
            );
          },
        );
        return repository;
      },
    };
  }, []);
  const unwrap = useCallback(<T>(result: ProjectResult<T>): T => {
    if (!result.ok) throw new Error(result.diagnostic.message);
    return result.value;
  }, []);
  const report = useCallback(
    (error: unknown) => {
      setFailure(error instanceof Error ? error.message : String(error));
      reporter.report(
        normalizeUnknownError(error, {
          code: "app/operation-failed",
          fallbackMessage: "The project could not be saved or opened.",
        }),
        { source: "workbench-project", visibility: "user" },
      );
    },
    [reporter],
  );
  const saveSession = useCallback(
    (
      projectId: string,
      activeDocumentId: WorkbenchTabsState["activeDocumentId"],
    ) => {
      context.sessionStore.save({
        schemaVersion: 1,
        projectId,
        activeDocumentId,
      });
    },
    [context],
  );
  const initial = useRef<Promise<ProjectManifest> | null>(null);
  useEffect(() => {
    initial.current ??= (async () => {
      if (context.initialFailure) throw context.initialFailure;
      const repository = await context.getRepository();
      const available = unwrap(await repository.list());
      if (available.length)
        return unwrap(
          await repository.open(
            available.find(
              (entry) => entry.projectId === context.session?.projectId,
            )?.projectId ?? available[0].projectId,
          ),
        );
      const finish = pendingWrites.begin();
      try {
        return unwrap(
          await repository.create(
            "My project",
            context.initialTabs.tabs.map((tab) => ({
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
    let live = true;
    void initial.current
      .then(async (opened) => {
        if (!opened.entries.some((entry) => entry.kind === "part"))
          throw new Error("This project has no part documents.");
        const available = unwrap(await (await context.getRepository()).list());
        if (!live) return;
        setProject(opened);
        setProjects(available);
      })
      .catch((error: unknown) => {
        if (live) report(error);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [context, pendingWrites, report, unwrap]);

  const select = useCallback(
    async (
      operation: (
        repository: LocalProjectRepository,
      ) => Promise<ProjectResult<ProjectManifest>>,
    ) => {
      setBusy(true);
      const finish = pendingWrites.begin();
      setFailure(null);
      try {
        const repository = await context.getRepository();
        const opened = unwrap(await operation(repository));
        const first = opened.entries.find((entry) => entry.kind === "part");
        if (!first) throw new Error("This project has no part documents.");
        const available = unwrap(await repository.list());
        saveSession(opened.projectId, first.docId);
        setProjects(available);
        setProject(opened);
        setSessionKey(opened.projectId);
      } catch (error) {
        report(error);
      } finally {
        finish();
        setBusy(false);
      }
    },
    [context, pendingWrites, report, saveSession, unwrap],
  );

  const saveParts = useCallback(
    async (projectId: string, tabs: readonly WorkbenchTab[]) => {
      try {
        const result = await pendingWrites.persist(projectId, async () => {
          const repository = await context.getRepository();
          return repository.setParts(
            projectId,
            tabs.map((tab) => ({ docId: tab.documentId, name: tab.title })),
          );
        });
        if (!result.ok) report(new Error(result.diagnostic.message));
        else setFailure(null);
      } catch (error) {
        report(error);
      }
    },
    [context, pendingWrites, report],
  );

  return {
    project,
    projects,
    pendingWrites,
    sessionKey,
    initialTabs: context.initialTabs,
    initialFailure: context.initialFailure,
    busy: busy || saving > 0,
    failure,
    select,
    saveParts,
    saveSession,
    report,
  };
}
