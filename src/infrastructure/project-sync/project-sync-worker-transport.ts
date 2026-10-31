import type {
  ProjectSyncStatus,
  ProjectSyncTransport,
} from "@/application/project-sync/project-service-port";
import type { ProjectServiceLink } from "@/contracts/modeling/project-manifest";
import type {
  ProjectPresenceState,
  ProjectSyncGrant,
} from "@/contracts/project-sync/project-service";
import type {
  ProjectSyncWorkerRequest,
  ProjectSyncWorkerResponse,
} from "@/infrastructure/workers/project-sync-worker-protocol";
import { browserNetworkWatcher } from "./project-room-network-adapter";
import {
  createProjectSyncBridgeChannelName,
  ProjectSyncBridge,
  shareOnlyManifestsOverBridge,
  type ProjectSyncRepo,
} from "./project-sync-bridge";

/** The page's channel to the document sync worker (DocumentSyncWorkerClient). */
export interface ProjectSyncWorkerChannel {
  postProjectSyncMessage(message: ProjectSyncWorkerRequest): void;
  subscribeToProjectSync(
    listener: (message: ProjectSyncWorkerResponse) => void,
  ): () => void;
}

/** How long opening a service project waits for its documents. */
const PROJECT_DOWNLOAD_TIMEOUT_MS = 60_000;

interface StartedProject {
  link: ProjectServiceLink;
  /** Starts not yet released by a stop; the worker stops at zero. */
  holders: number;
  manifestDocumentId: string;
  issueGrant: () => Promise<ProjectSyncGrant>;
  status: ProjectSyncStatus;
  listeners: Set<(status: ProjectSyncStatus) => void>;
  syncWaiters: Set<{ resolve(): void; reject(error: Error): void }>;
  /** Latest local presence; sent once the worker has the project. */
  presence: ProjectPresenceState | null;
  startPosted: boolean;
}

export function projectRoomUrl(apiOrigin: string, projectId: string) {
  const url = new URL(`/sync/${encodeURIComponent(projectId)}`, apiOrigin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

/**
 * The page side of project sync: starts and stops projects in the worker,
 * answers its token requests and bridges the page's project Repo (holding
 * the manifests) to the worker's Repo.
 */
export function createProjectSyncWorkerTransport({
  channel,
  apiOrigin,
  getProjectRepo,
  watchNetwork = browserNetworkWatcher,
  isOnline = () =>
    (globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine ??
    true,
}: {
  channel: ProjectSyncWorkerChannel;
  apiOrigin: string;
  /** The page's online/offline events, forwarded to the worker. */
  watchNetwork?: (onChange: (online: boolean) => void) => () => void;
  isOnline?: () => boolean;
  /** The page's project Repo; manifests reach the worker over the bridge. */
  getProjectRepo: () => Promise<ProjectSyncRepo>;
}): ProjectSyncTransport & { dispose(): void } {
  const started = new Map<string, StartedProject>();
  const bridgeChannel = createProjectSyncBridgeChannelName();
  let projectRepo: Promise<ProjectSyncRepo> | null = null;

  const connectBridge = () =>
    (projectRepo ??= getProjectRepo().then((repo) => {
      const bridge = new ProjectSyncBridge(bridgeChannel);
      shareOnlyManifestsOverBridge(repo, bridge, (documentId) =>
        [...started.values()].some(
          (project) => project.manifestDocumentId === documentId,
        ),
      );
      repo.networkSubsystem.addNetworkAdapter(bridge.adapter);
      return repo;
    }));
  const shareChanged = () => {
    void projectRepo?.then((repo) => repo.shareConfigChanged());
  };

  const publish = (project: StartedProject) => {
    for (const listener of project.listeners) listener(project.status);
    for (const waiter of project.syncWaiters) {
      if (project.status.error) waiter.reject(new Error(project.status.error));
      else if (project.status.connection === "synced") waiter.resolve();
      else continue;
      project.syncWaiters.delete(waiter);
    }
  };

  const receive = (message: ProjectSyncWorkerResponse) => {
    const project = started.get(message.link.projectId);
    if (message.kind === "projectSyncStatus") {
      if (!project) return;
      project.status = {
        ...project.status,
        connection: message.connection,
        peers: message.peers,
        error: message.error ?? null,
      };
      publish(project);
      return;
    }
    const reply = (
      grant: ProjectSyncGrant | null,
      error?: string,
    ): ProjectSyncWorkerRequest => ({
      kind: "projectSyncToken",
      tokenRequestId: message.tokenRequestId,
      grant: grant && { token: grant.token, expiresIn: grant.expiresIn },
      ...(error ? { error } : {}),
    });
    if (!project) {
      channel.postProjectSyncMessage(reply(null, "Project sync stopped."));
      return;
    }
    project.issueGrant().then(
      (grant) => {
        if (project.status.role !== grant.role) {
          project.status = { ...project.status, role: grant.role };
          publish(project);
        }
        channel.postProjectSyncMessage(reply(grant));
      },
      (error: unknown) => {
        channel.postProjectSyncMessage(
          reply(
            null,
            error instanceof Error ? error.message : "No sync token issued.",
          ),
        );
      },
    );
  };
  // Subscribed while projects run, so a transport React creates and
  // discards (Strict Mode) never answers the worker.
  let unsubscribe: (() => void) | null = null;
  const subscribe = () => {
    const unsubscribeWorker = channel.subscribeToProjectSync(receive);
    const unwatchNetwork = watchNetwork((online) =>
      channel.postProjectSyncMessage({ kind: "projectSyncNetwork", online }),
    );
    if (!isOnline())
      channel.postProjectSyncMessage({
        kind: "projectSyncNetwork",
        online: false,
      });
    return () => {
      unsubscribeWorker();
      unwatchNetwork();
    };
  };

  return {
    start({ link, manifestDocumentId, foreignDocumentIds, issueGrant }) {
      const existing = started.get(link.projectId);
      if (existing) {
        existing.holders += 1;
        existing.issueGrant = issueGrant;
        return;
      }
      unsubscribe ??= subscribe();
      started.set(link.projectId, {
        link,
        holders: 1,
        manifestDocumentId,
        issueGrant,
        status: {
          connection: "connecting",
          role: null,
          peers: [],
          error: null,
        },
        listeners: new Set(),
        syncWaiters: new Set(),
        presence: null,
        startPosted: false,
      });
      // The worker asks the bridge for the manifest; the page must already
      // share it, so the start message waits for the bridge.
      void connectBridge().then(
        () => {
          shareChanged();
          const project = started.get(link.projectId);
          if (project?.link !== link) return;
          channel.postProjectSyncMessage({
            kind: "projectSyncStart",
            link,
            manifestDocumentId,
            roomUrl: projectRoomUrl(apiOrigin, link.projectId),
            bridgeChannel,
            foreignDocumentIds,
          });
          project.startPosted = true;
          if (project.presence)
            channel.postProjectSyncMessage({
              kind: "projectSyncPresence",
              link,
              state: project.presence,
            });
        },
        (error: unknown) => {
          const project = started.get(link.projectId);
          if (!project) return;
          project.status = {
            ...project.status,
            connection: "offline",
            error:
              error instanceof Error
                ? error.message
                : "Project sync could not start.",
          };
          publish(project);
        },
      );
    },
    stop(link) {
      const project = started.get(link.projectId);
      if (!project) return;
      project.holders -= 1;
      if (project.holders > 0) return;
      started.delete(link.projectId);
      for (const waiter of project.syncWaiters)
        waiter.reject(new Error("Project sync stopped."));
      channel.postProjectSyncMessage({ kind: "projectSyncStop", link });
      shareChanged();
    },
    whenSynced(link) {
      const project = started.get(link.projectId);
      if (!project)
        return Promise.reject(new Error("Project sync is not running."));
      if (project.status.connection === "synced") return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          project.syncWaiters.delete(waiter);
          reject(
            new Error(
              "The project did not finish downloading. Check your connection and try again.",
            ),
          );
        }, PROJECT_DOWNLOAD_TIMEOUT_MS);
        const waiter = {
          resolve() {
            clearTimeout(timeout);
            resolve();
          },
          reject(error: Error) {
            clearTimeout(timeout);
            reject(error);
          },
        };
        project.syncWaiters.add(waiter);
      });
    },
    setPresence(link, state) {
      const project = started.get(link.projectId);
      if (!project) return;
      project.presence = state;
      if (project.startPosted)
        channel.postProjectSyncMessage({
          kind: "projectSyncPresence",
          link,
          state,
        });
    },
    subscribe(link, listener) {
      const project = started.get(link.projectId);
      if (!project) return () => undefined;
      project.listeners.add(listener);
      listener(project.status);
      return () => {
        project.listeners.delete(listener);
      };
    },
    dispose() {
      for (const project of [...started.values()]) {
        project.holders = 1;
        this.stop(project.link);
      }
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
