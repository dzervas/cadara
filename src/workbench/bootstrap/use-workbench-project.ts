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
import { createWorkbenchProjectBootstrap } from "@/infrastructure/persistence/workbench-project-bootstrap";

export function useWorkbenchProject(persistenceEnabled: boolean) {
  const reporter = useErrorReporter();
  const [project, setProject] = useState<ProjectManifest | null>(null);
  const [projects, setProjects] = useState<ProjectManifest[]>([]);
  const [sessionKey, setSessionKey] = useState("initial");
  const pendingWrites = useMemo(() => new PendingLocalWrites(), []);
  const saving = useSyncExternalStore(
    useCallback(
      (listener: () => void) => pendingWrites.subscribe(listener),
      [pendingWrites],
    ),
    () => pendingWrites.getPendingWriteCount(),
  );
  const [failure, setFailure] = useState<string | null>(null);
  const context = useMemo(
    () =>
      createWorkbenchProjectBootstrap(
        window.localStorage,
        window.location.search,
        persistenceEnabled,
      ),
    [persistenceEnabled],
  );
  const [busy, setBusy] = useState(context.persistenceEnabled);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Strict Mode replays effects before this microtask; only a real unmount cancels discovery.
      queueMicrotask(() => {
        if (!mounted.current) context.partReadiness.dispose();
      });
    };
  }, [context]);
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
      context.sessionStore?.save({
        schemaVersion: 1,
        projectId,
        activeDocumentId,
      });
    },
    [context],
  );
  useEffect(() => {
    const opening = context.openInitialProject(pendingWrites);
    if (!opening) return;
    let live = true;
    void opening
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
    persistenceEnabled: context.persistenceEnabled,
    registerPartReadiness: context.registerPartReadiness,
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
