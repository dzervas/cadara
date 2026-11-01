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
import type { DocumentId } from "@/contracts/shared/ids";
import {
  generateDocumentId,
  type WorkbenchTab,
  type WorkbenchTabsState,
} from "@/core/workspace/workbench-tabs";
import { normalizeUnknownError } from "@/contracts/errors";
import { useErrorReporter } from "@/hooks/use-error-reporter";
import { PendingLocalWrites } from "@/application/workspace/local-save-guard";
import type { LocalProjectRepository } from "@/infrastructure/persistence/local-project-repository";
import { createLocalStorageProjectRoleStore } from "@/infrastructure/persistence/local-storage-project-role-store";
import { canWriteProjectDocument } from "@/application/project-sync/project-write-gate";
import { createWorkbenchProjectBootstrap } from "@/infrastructure/persistence/workbench-project-bootstrap";
import { browserOccKernelVersionRetired } from "@/infrastructure/occ/kernel-version-retired";
import { isModelingServiceInitializationFailure } from "@/application/modeling/modeling-service/initialization-failure";

export function useWorkbenchProject(persistenceEnabled: boolean) {
  const reporter = useErrorReporter();
  const [project, setProject] = useState<ProjectManifest | null>(null);
  const [projects, setProjects] = useState<ProjectManifest[]>([]);
  const [sessionKey, setSessionKey] = useState("initial");
  /** The part a switch asked to show, e.g. one that moved to this project. */
  const [requestedDocumentId, setRequestedDocumentId] =
    useState<DocumentId | null>(null);
  const pendingWrites = useMemo(() => new PendingLocalWrites(), []);
  const saving = useSyncExternalStore(
    useCallback(
      (listener: () => void) => pendingWrites.subscribe(listener),
      [pendingWrites],
    ),
    () => pendingWrites.getPendingWriteCount(),
  );
  const [failure, setFailure] = useState<string | null>(null);
  // The initial discovery ended without a project. Nothing opens until a
  // reload discovers one: editing without a project would leave the part
  // unlisted, since the next load mounts a newly generated first part.
  const [discoveryFailed, setDiscoveryFailed] = useState(false);
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
  // A project without parts (e.g. every part moved away) gets an empty part
  // when it opens, never before. An account project gets one only when the
  // role last granted here may edit its manifest; the room refuses others.
  const withPart = useCallback(
    async (repository: LocalProjectRepository, opened: ProjectManifest) => {
      if (opened.entries.some((entry) => entry.kind === "part")) return opened;
      const role = opened.service
        ? createLocalStorageProjectRoleStore(window.localStorage).load(
            opened.service,
            null,
          )
        : null;
      if (
        opened.service &&
        !(role && canWriteProjectDocument(role, "manifest"))
      )
        throw new Error("This project has no part documents.");
      return unwrap(
        await repository.addPart(opened.projectId, {
          docId: generateDocumentId(),
          name: "Workspace",
        }),
      );
    },
    [unwrap],
  );
  const report = useCallback(
    (error: unknown) => {
      setFailure(error instanceof Error ? error.message : String(error));
      // A retired kernel fails part readiness; the update notification's
      // reload is the outcome, as for the hidden project alert.
      if (browserOccKernelVersionRetired.getSnapshot()) return;
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
        const repository = await context.getRepository();
        const project = await withPart(repository, opened);
        const available = unwrap(await repository.list());
        if (!live) return;
        setProject(project);
        setProjects(available);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setDiscoveryFailed(true);
        // Creating the project needs its parts' documents open. When the
        // active part's initialization threw, its own "could not be opened"
        // notice is the outcome; this message-only copy is not news. Any
        // other part's failure has no notice on screen, so it is reported.
        if (
          isModelingServiceInitializationFailure(
            context.partReadiness.failureOf(
              context.initialTabs.activeDocumentId,
            ),
          )
        )
          return;
        report(error);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [context, pendingWrites, report, unwrap, withPart]);

  /** Switches to the project `operation` opens, showing `activeDocumentId` when given. */
  const select = useCallback(
    async (
      operation: (
        repository: LocalProjectRepository,
      ) => Promise<ProjectResult<ProjectManifest>>,
      activeDocumentId?: DocumentId,
    ) => {
      setBusy(true);
      const finish = pendingWrites.begin();
      setFailure(null);
      try {
        const repository = await context.getRepository();
        const opened = await withPart(
          repository,
          unwrap(await operation(repository)),
        );
        const first = opened.entries.find((entry) => entry.kind === "part")!;
        const available = unwrap(await repository.list());
        saveSession(opened.projectId, activeDocumentId ?? first.docId);
        setProjects(available);
        setProject(opened);
        setRequestedDocumentId(activeDocumentId ?? null);
        setSessionKey(opened.projectId);
        return true;
      } catch (error) {
        report(error);
        return false;
      } finally {
        finish();
        setBusy(false);
      }
    },
    [context, pendingWrites, report, saveSession, unwrap, withPart],
  );

  /** Writes the change from `previous` to `tabs` (see LocalProjectRepository.setParts). */
  const saveParts = useCallback(
    async (
      projectId: string,
      tabs: readonly WorkbenchTab[],
      previous?: readonly WorkbenchTab[],
    ) => {
      const parts = (list: readonly WorkbenchTab[]) =>
        list.map((tab) => ({ docId: tab.documentId, name: tab.title }));
      try {
        const result = await pendingWrites.persist(projectId, async () => {
          const repository = await context.getRepository();
          return repository.setParts(
            projectId,
            parts(tabs),
            previous && parts(previous),
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

  // Collaborators edit a synced manifest too: follow it while it is open.
  const openProjectId = project?.projectId;
  useEffect(() => {
    if (!openProjectId) return;
    let live = true;
    let unsubscribe: (() => void) | null = null;
    void context
      .getRepository()
      .then((repository) =>
        repository.subscribe(openProjectId, (manifest) => {
          setProject((current) =>
            current?.projectId === manifest.projectId &&
            JSON.stringify(current) !== JSON.stringify(manifest)
              ? manifest
              : current,
          );
        }),
      )
      .then((stop) => {
        if (live) unsubscribe = stop;
        else stop();
      })
      .catch((error: unknown) => {
        if (live) report(error);
      });
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, [context, openProjectId, report]);

  // A repair that left stored documents out ends "done": the notice says
  // so, and Reload opens the repaired list.
  const [repair, setRepair] = useState<"idle" | "running" | "done">("idle");
  /**
   * Rebuilds the project list from this browser's stored manifests (see
   * LocalProjectRepository.repairCatalog), then reloads into discovery.
   */
  const repairCatalog = useCallback(async () => {
    setRepair("running");
    try {
      const { leftOut } = unwrap(
        await (await context.getRepository()).repairCatalog(),
      );
      if (!leftOut) {
        window.location.reload();
        return;
      }
      setFailure(
        `Project list repaired. ${leftOut} stored ${leftOut === 1 ? "project" : "projects"} could not be read; their parts kept by this browser are in 'Recovered parts'. Reload to open your projects.`,
      );
      setRepair("done");
    } catch (error) {
      report(
        new Error(
          `The project list could not be repaired: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      setRepair("idle");
    }
  }, [context, report, unwrap]);

  /** Re-reads the catalog, e.g. after a project was created without switching to it. */
  const refreshProjects = useCallback(async () => {
    setProjects(unwrap(await (await context.getRepository()).list()));
  }, [context, unwrap]);

  /** Shows a manifest the active project gained in place (e.g. its service link). */
  const replaceProject = useCallback(
    async (manifest: ProjectManifest) => {
      const available = unwrap(await (await context.getRepository()).list());
      setProjects(available);
      setProject(manifest);
    },
    [context, unwrap],
  );

  return {
    project,
    projects,
    getRepository: context.getRepository,
    getProjectAutomergeRepo: context.getProjectAutomergeRepo,
    replaceProject,
    refreshProjects,
    pendingWrites,
    sessionKey,
    requestedDocumentId,
    persistenceEnabled: context.persistenceEnabled,
    registerPartReadiness: context.registerPartReadiness,
    initialTabs: context.initialTabs,
    firstPartPlaceholder: context.firstPartPlaceholder,
    initialFailure: context.initialFailure,
    busy: busy || saving > 0,
    failure,
    discoveryFailed,
    repair,
    repairCatalog,
    select,
    saveParts,
    saveSession,
    report,
  };
}
