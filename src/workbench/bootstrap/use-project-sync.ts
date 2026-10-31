import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectSyncStatus,
  SyncedProjectStore,
} from "@/application/project-sync/project-service-port";
import {
  openServiceProject,
  presenceDisplayName,
  startProjectSync,
  uploadProjectToService,
} from "@/application/project-sync/project-service-use-cases";
import type { Account } from "@/contracts/account/account";
import { normalizeUnknownError } from "@/contracts/errors";
import type {
  ProjectManifest,
  ProjectResult,
} from "@/contracts/modeling/project-manifest";
import type {
  ProjectVisibility,
  RemoteProject,
} from "@/contracts/project-sync/project-service";
import type { DocumentId } from "@/contracts/shared/ids";
import { useErrorReporter } from "@/hooks/use-error-reporter";
import { getAccountApiOrigin } from "@/infrastructure/account/api-origin";
import type { LocalProjectRepository } from "@/infrastructure/persistence/local-project-repository";
import { createLocalStorageProjectRoleStore } from "@/infrastructure/persistence/local-storage-project-role-store";
import { createProjectServiceHttpClient } from "@/infrastructure/project-sync/project-service-http-client";
import { createProjectSyncWorkerTransport } from "@/infrastructure/project-sync/project-sync-worker-transport";
import type { DocumentSyncWorkerClient } from "@/infrastructure/workers/document-sync-worker-client";
import { getWorkbenchSessionPort } from "@/workbench/shell/workbench-session";
import type { useWorkbenchProject } from "./use-workbench-project";

function unwrap<T>(result: ProjectResult<T>): T {
  if (!result.ok) throw new Error(result.diagnostic.message);
  return result.value;
}

function syncedProjectStore(
  repository: LocalProjectRepository,
): SyncedProjectStore {
  return {
    manifestDocumentId: async (projectId) =>
      unwrap(await repository.manifestDocumentId(projectId)),
    linkService: async (projectId, link) =>
      unwrap(await repository.linkService(projectId, link)),
    adoptManifest: async (id) => unwrap(await repository.adoptManifest(id)),
    foreignDocumentIds: async (id) =>
      unwrap(await repository.foreignDocumentIds(id)),
  };
}

/**
 * The workbench's CADara project sync: the active project's live connection
 * and presence, and the upload / open-from-service actions. It lives above
 * the per-project workbench so switching projects never tears down a
 * connection the next project reuses.
 */
export function useProjectSync(
  client: DocumentSyncWorkerClient | null,
  projects: ReturnType<typeof useWorkbenchProject>,
) {
  const reporter = useErrorReporter();
  const { project, getRepository, getProjectAutomergeRepo, replaceProject } =
    projects;
  const service = useMemo(
    () => createProjectServiceHttpClient({ apiOrigin: getAccountApiOrigin() }),
    [],
  );
  const transport = useMemo(
    () =>
      client && projects.persistenceEnabled
        ? createProjectSyncWorkerTransport({
            channel: client,
            apiOrigin: getAccountApiOrigin(),
            getProjectRepo: getProjectAutomergeRepo,
          })
        : null,
    [client, getProjectAutomergeRepo, projects.persistenceEnabled],
  );
  useEffect(() => () => transport?.dispose(), [transport]);

  const report = useCallback(
    (error: unknown) => {
      reporter.report(
        normalizeUnknownError(error, {
          code: "app/operation-failed",
          fallbackMessage: "Project sync failed.",
        }),
        { source: "project-sync", visibility: "user" },
      );
    },
    [reporter],
  );

  // The account is fetched only when a project syncs or the CADara menu
  // opens, so local-only use makes no account requests of its own.
  const [account, setAccount] = useState<Account | null>(null);
  const [accountChecked, setAccountChecked] = useState(false);
  const refreshAccount = useCallback(
    () =>
      getWorkbenchSessionPort()
        .getAccount()
        .then(
          (next) => {
            setAccount(next);
            setAccountChecked(true);
          },
          () => {
            // Unreachable service: the project keeps working locally and
            // the indicator shows "offline".
            setAccount(null);
            setAccountChecked(true);
          },
        ),
    [],
  );
  const link = project?.service ?? null;
  const needsAccount = link !== null && !accountChecked;
  useEffect(() => {
    if (needsAccount) void refreshAccount();
  }, [needsAccount, refreshAccount]);

  // Status is kept per link so a switched project never shows the last one's.
  const [statusEntry, setStatusEntry] = useState<{
    key: string;
    status: ProjectSyncStatus;
  } | null>(null);
  const activeDocumentRef = useRef<DocumentId | null>(null);
  const linkOrgId = link?.orgId;
  const linkProjectId = link?.projectId;
  const projectId = project?.projectId;
  const userId = account?.user.id;
  const presenceName = account ? presenceDisplayName(account.user) : "";
  const publishPresence = useCallback(() => {
    if (!transport || !linkOrgId || !linkProjectId || !userId) return;
    transport.setPresence(
      { orgId: linkOrgId, projectId: linkProjectId },
      {
        userId,
        name: presenceName,
        activeDocumentId: activeDocumentRef.current,
      },
    );
  }, [transport, linkOrgId, linkProjectId, userId, presenceName]);

  const statusKey = `${projectId}:${linkOrgId}/${linkProjectId}:${userId}`;
  const status = statusEntry?.key === statusKey ? statusEntry.status : null;

  // The latest token's role, else the one remembered from the last token
  // this browser received, so a reload or an offline session starts with it.
  const roleStore = useMemo(
    () => createLocalStorageProjectRoleStore(window.localStorage),
    [],
  );
  const grantedRole = status?.role ?? null;
  useEffect(() => {
    if (grantedRole && linkOrgId && linkProjectId && userId)
      roleStore.save(
        { orgId: linkOrgId, projectId: linkProjectId },
        userId,
        grantedRole,
      );
  }, [grantedRole, linkOrgId, linkProjectId, roleStore, userId]);
  const role = useMemo(
    () =>
      grantedRole ??
      (linkOrgId && linkProjectId
        ? roleStore.load(
            { orgId: linkOrgId, projectId: linkProjectId },
            userId ?? null,
          )
        : null),
    [grantedRole, linkOrgId, linkProjectId, roleStore, userId],
  );
  useEffect(() => {
    if (!transport || !projectId || !linkOrgId || !linkProjectId || !userId)
      return;
    const syncLink = { orgId: linkOrgId, projectId: linkProjectId };
    let live = true;
    let stop: (() => void) | null = null;
    let unsubscribe: (() => void) | null = null;
    void getRepository()
      .then(async (repository) => {
        const manifestDocumentId = unwrap(
          await repository.manifestDocumentId(projectId),
        );
        if (!live) return;
        const release = await startProjectSync(
          {
            service,
            transport,
            projects: syncedProjectStore(repository),
          },
          syncLink,
          manifestDocumentId,
        );
        if (!live) {
          release();
          return;
        }
        stop = release;
        publishPresence();
        let reported: string | null = null;
        unsubscribe = transport.subscribe(syncLink, (next) => {
          setStatusEntry({ key: statusKey, status: next });
          if (next.error && next.error !== reported) {
            reported = next.error;
            report(new Error(next.error));
          }
        });
      })
      .catch((error: unknown) => {
        if (live) report(error);
      });
    return () => {
      live = false;
      unsubscribe?.();
      stop?.();
    };
  }, [
    transport,
    service,
    getRepository,
    projectId,
    linkOrgId,
    linkProjectId,
    userId,
    statusKey,
    publishPresence,
    report,
  ]);

  const setActiveDocument = useCallback(
    (documentId: DocumentId) => {
      if (activeDocumentRef.current === documentId) return;
      activeDocumentRef.current = documentId;
      publishPresence();
    },
    [publishPresence],
  );

  const upload = useCallback(
    async (input: {
      orgId: string;
      name: string;
      slug: string;
      visibility: ProjectVisibility;
    }) => {
      if (!project) throw new Error("No project is open.");
      const repository = await getRepository();
      const linked = await uploadProjectToService(
        { service, projects: syncedProjectStore(repository) },
        { manifest: project, ...input },
      );
      await replaceProject(linked);
    },
    [getRepository, project, replaceProject, service],
  );

  const openRemote = useCallback(
    async (
      remote: RemoteProject,
    ): Promise<{ manifest: ProjectManifest; release: () => void }> => {
      if (!transport) throw new Error("Project sync needs browser storage.");
      const repository = await getRepository();
      return openServiceProject(
        { service, transport, projects: syncedProjectStore(repository) },
        remote,
      );
    },
    [getRepository, service, transport],
  );

  return {
    available: transport !== null,
    account,
    accountChecked,
    refreshAccount,
    status,
    /** The role this project's writes follow; null before any token. */
    role,
    linked: link !== null,
    setActiveDocument,
    upload,
    listProjects: (orgId: string) => service.listProjects(orgId),
    openRemote,
  };
}

export type ProjectSync = ReturnType<typeof useProjectSync>;
