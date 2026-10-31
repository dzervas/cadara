import {
  Presence,
  type DocHandle,
  type DocumentId,
  type PeerId,
  type Repo,
} from "@automerge/automerge-repo/slim";
import {
  nextRoomAllowList,
  sameDocumentSet,
} from "@/application/project-sync/room-allow-list";
import type { ProjectServiceLink } from "@/contracts/modeling/project-manifest";
import { parseProjectManifest } from "@/contracts/modeling/project-manifest.runtime-schema";
import type {
  ProjectPresencePeer,
  ProjectPresenceState,
  ProjectSyncConnection,
  SyncTokenResponse,
} from "@/contracts/project-sync/project-service";
import { readProjectPresenceState } from "@/contracts/project-sync/project-service.runtime-schema";
import type {
  ProjectSyncWorkerRequest,
  ProjectSyncWorkerResponse,
} from "@/infrastructure/workers/project-sync-worker-protocol";
import {
  browserNetworkWatcher,
  ProjectRoomNetworkAdapter,
  type ProjectRoomConnection,
  type ProjectRoomNetworkAdapterOptions,
} from "./project-room-network-adapter";
import { ProjectSyncBridge } from "./project-sync-bridge";

export interface ProjectSyncWorkerHostOptions {
  getRepo(): Promise<Repo>;
  postMessage(message: ProjectSyncWorkerResponse): void;
  /** Socket, timer and network seams of the room adapter (tests). */
  roomAdapterOptions?: Partial<ProjectRoomNetworkAdapterOptions>;
  /** Null disables the page bridge (tests without a page Repo). */
  createBridge?: ((channelName: string) => ProjectSyncBridge) | null;
  presenceTiming?: {
    heartbeatMs: number;
    peerTtlMs: number;
    /** Wait for the room to join the manifest's sync before re-announcing. */
    reannounceDelayMs: number;
  };
}

/** A document the room has not delivered yet is still worth a handle. */
const ANY_STATE: Parameters<Repo["find"]>[1] = {
  allowableStates: ["ready", "requesting", "unavailable"],
};
const DEFAULT_PRESENCE_TIMING = {
  heartbeatMs: 5_000,
  peerTtlMs: 15_000,
  reannounceDelayMs: 500,
};
const PRESENCE_CHANNELS = ["userId", "name", "activeDocumentId"] as const;

function sameHeads(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    [...left].sort().join() === [...right].sort().join()
  );
}

function manifestEntryIds(value: unknown) {
  const parsed = parseProjectManifest(value);
  return parsed.ok
    ? parsed.value.entries.map((entry) => entry.automergeDocumentId)
    : [];
}

interface HostContext {
  repo: Repo;
  options: ProjectSyncWorkerHostOptions;
  roomPeers: Map<PeerId, HostedProject>;
  knownRoomPeers: Set<PeerId>;
  requestToken(link: ProjectServiceLink): Promise<SyncTokenResponse>;
  watchNetwork(onChange: (online: boolean) => void): () => void;
}

/**
 * One started project in the worker: its room socket, the room's allow-list
 * (see room-allow-list.ts), presence on the manifest handle and the status
 * reported to the page.
 *
 * The room's acknowledgement of each document is its last reported heads
 * (DocHandle sync info for the room's storage id); automerge-repo persists
 * the matching sync state, which records the last-synced heads per document
 * across reloads.
 */
class HostedProject {
  allowList = new Set<string>();
  connection: ProjectRoomConnection = "offline";
  readonly adapter: ProjectRoomNetworkAdapter;
  private manifest: DocHandle<unknown> | null = null;
  private readonly watched = new Map<string, () => void>();
  private presence: Presence<ProjectPresenceState> | null = null;
  private presenceState: ProjectPresenceState | null = null;
  private reannounce: ReturnType<typeof setTimeout> | null = null;
  private lastStatus = "";
  private stopped = false;
  readonly link: ProjectServiceLink;
  readonly manifestId: string;
  private readonly host: HostContext;

  constructor(
    link: ProjectServiceLink,
    manifestId: string,
    roomUrl: string,
    host: HostContext,
  ) {
    this.link = link;
    this.manifestId = manifestId;
    this.host = host;
    this.adapter = new ProjectRoomNetworkAdapter({
      watchNetwork: host.watchNetwork,
      ...host.options.roomAdapterOptions,
      url: roomUrl,
      issueToken: () => host.requestToken(link),
      onConnectionChange: (connection) => {
        this.connection = connection;
        if (connection === "connected") this.scheduleReannounce();
        this.refresh();
      },
    });
    this.adapter.on("peer-candidate", ({ peerId }) => {
      host.knownRoomPeers.add(peerId);
      host.roomPeers.set(peerId, this);
    });
    this.adapter.on("peer-disconnected", ({ peerId }) => {
      if (host.roomPeers.get(peerId) === this) host.roomPeers.delete(peerId);
    });
  }

  allows(documentId: string) {
    return documentId === this.manifestId || this.allowList.has(documentId);
  }

  async start() {
    this.host.repo.networkSubsystem.addNetworkAdapter(this.adapter);
    const manifest = await this.host.repo.find<unknown>(
      this.manifestId as DocumentId,
      ANY_STATE,
    );
    if (this.stopped) return;
    this.manifest = manifest;
    this.watch(manifest);
    this.refresh();
  }

  setPresence(state: ProjectPresenceState) {
    const previous = this.presenceState;
    this.presenceState = state;
    if (!this.presence?.running) {
      this.refresh();
      return;
    }
    for (const channel of PRESENCE_CHANNELS)
      if (previous?.[channel] !== state[channel])
        this.presence.broadcast(channel, state[channel]);
  }

  stop() {
    this.stopped = true;
    if (this.reannounce) clearTimeout(this.reannounce);
    this.presence?.stop();
    for (const detach of this.watched.values()) detach();
    this.watched.clear();
    this.host.repo.networkSubsystem.removeNetworkAdapter(this.adapter);
    for (const [peerId, project] of this.host.roomPeers)
      if (project === this) this.host.roomPeers.delete(peerId);
    this.allowList.clear();
    this.host.repo.shareConfigChanged();
  }

  private watch(handle: DocHandle<unknown>) {
    if (this.watched.has(handle.documentId)) return;
    // A handle emits change before its ready transition: read it a turn later.
    const changed = () => queueMicrotask(() => this.refresh());
    handle.on("change", changed);
    handle.on("remote-heads", changed);
    this.watched.set(handle.documentId, () => {
      handle.off("change", changed);
      handle.off("remote-heads", changed);
    });
  }

  private roomHas(handle: DocHandle<unknown> | null | undefined) {
    const roomPeerId = this.adapter.roomPeerId;
    const storageId = roomPeerId
      ? this.host.repo.peerMetadataByPeerId[roomPeerId]?.storageId
      : undefined;
    if (!handle?.isReady() || !storageId) return false;
    const remote = handle.getSyncInfo(storageId)?.lastHeads;
    return remote !== undefined && sameHeads(remote, handle.heads());
  }

  private refresh() {
    if (this.stopped) return;
    const manifest = this.manifest;
    const next = nextRoomAllowList(
      this.allowList,
      manifest?.isReady() ? manifestEntryIds(manifest.doc()) : [],
      this.connection === "connected" && this.roomHas(manifest),
    );
    if (!sameDocumentSet(next, this.allowList)) {
      const added = [...next].filter((id) => !this.allowList.has(id));
      for (const id of this.allowList)
        if (!next.has(id)) {
          this.watched.get(id)?.();
          this.watched.delete(id);
        }
      this.allowList = next;
      this.host.repo.shareConfigChanged();
      for (const id of added)
        void this.host.repo
          .find<unknown>(id as DocumentId, ANY_STATE)
          .then((handle) => {
            if (this.stopped || !this.allowList.has(id)) return;
            this.watch(handle);
            this.refresh();
          });
    }
    this.startPresence();
    this.postStatus();
  }

  private startPresence() {
    if (this.presence || !this.presenceState || !this.manifest?.isReady())
      return;
    const timing = this.host.options.presenceTiming ?? DEFAULT_PRESENCE_TIMING;
    const presence = new Presence<ProjectPresenceState>({
      handle: this.manifest,
    });
    this.presence = presence;
    for (const event of ["update", "snapshot", "goodbye", "pruning"] as const)
      presence.on(event, () => this.postStatus());
    presence.start({
      initialState: this.presenceState,
      heartbeatMs: timing.heartbeatMs,
      peerTtlMs: timing.peerTtlMs,
    });
  }

  /**
   * Presence broadcasts reach only the manifest's current sync peers, so a
   * newly joined room learns this participant's state once it syncs the
   * manifest; the room relays it to everyone else.
   */
  private scheduleReannounce() {
    const timing = this.host.options.presenceTiming ?? DEFAULT_PRESENCE_TIMING;
    if (this.reannounce) clearTimeout(this.reannounce);
    this.reannounce = setTimeout(() => {
      this.reannounce = null;
      const state = this.presenceState;
      if (!state || !this.presence?.running) return;
      for (const channel of PRESENCE_CHANNELS)
        this.presence.broadcast(channel, state[channel]);
    }, timing.reannounceDelayMs);
  }

  private connectionStatus(): ProjectSyncConnection {
    if (this.connection !== "connected") return this.connection;
    const ids = [this.manifestId, ...this.allowList];
    const synced =
      this.manifest?.isReady() === true &&
      ids.every(
        (id) =>
          this.watched.has(id) &&
          this.roomHas(this.host.repo.handles[id as DocumentId]),
      );
    return synced ? "synced" : "syncing";
  }

  private peers(): ProjectPresencePeer[] {
    if (!this.presence) return [];
    return Object.values(this.presence.getPeerStates().value).flatMap(
      (peer) => {
        const state = readProjectPresenceState(peer.value);
        return state ? [{ ...state, peerId: peer.peerId }] : [];
      },
    );
  }

  private postStatus() {
    if (this.stopped) return;
    const message: ProjectSyncWorkerResponse = {
      kind: "projectSyncStatus",
      link: this.link,
      connection: this.connectionStatus(),
      peers: this.peers(),
    };
    const serialized = JSON.stringify(message);
    if (serialized === this.lastStatus) return;
    this.lastStatus = serialized;
    this.host.options.postMessage(message);
  }
}

/**
 * The worker side of project sync (see project-sync-worker-protocol.ts). It
 * owns the Repo's share policy: a room peer receives only its project's
 * allow-list, the page bridge only started manifests, and every other peer
 * (opt-in cross-tab sync) keeps the default of sharing everything.
 */
export function createProjectSyncWorkerHost(
  options: ProjectSyncWorkerHostOptions,
) {
  const projects = new Map<string, HostedProject>();
  const roomPeers = new Map<PeerId, HostedProject>();
  const knownRoomPeers = new Set<PeerId>();
  const tokenRequests = new Map<
    number,
    { resolve(grant: SyncTokenResponse): void; reject(error: Error): void }
  >();
  let nextTokenRequestId = 0;
  const networkListeners = new Set<(online: boolean) => void>();
  let bridge: ProjectSyncBridge | null = null;
  let context: Promise<HostContext> | null = null;

  const isStartedManifest = (documentId: string) =>
    [...projects.values()].some((project) => project.manifestId === documentId);
  const share =
    (bridgeAnnounces: boolean) =>
    async (peerId: PeerId, documentId?: string) => {
      const project = roomPeers.get(peerId);
      if (project)
        return documentId === undefined || project.allows(documentId);
      if (knownRoomPeers.has(peerId)) return false;
      if (bridge?.peers.has(peerId))
        return (
          bridgeAnnounces &&
          documentId !== undefined &&
          isStartedManifest(documentId)
        );
      return true;
    };
  const getContext = () =>
    (context ??= options.getRepo().then((repo) => {
      // The worker answers the page's manifest requests but never offers one
      // first: an offer before the room delivered the manifest would leave
      // the page's handle unavailable.
      repo.shareConfig = { announce: share(false), access: share(true) };
      return {
        repo,
        options,
        roomPeers,
        knownRoomPeers,
        watchNetwork(onChange) {
          const unwatch = browserNetworkWatcher(onChange);
          networkListeners.add(onChange);
          return () => {
            unwatch();
            networkListeners.delete(onChange);
          };
        },
        requestToken(link) {
          const tokenRequestId = ++nextTokenRequestId;
          return new Promise<SyncTokenResponse>((resolve, reject) => {
            tokenRequests.set(tokenRequestId, { resolve, reject });
            options.postMessage({
              kind: "projectSyncTokenRequest",
              tokenRequestId,
              link,
            });
          });
        },
      };
    }));

  async function start(
    request: Extract<ProjectSyncWorkerRequest, { kind: "projectSyncStart" }>,
  ) {
    if (projects.has(request.link.projectId)) return;
    const host = await getContext();
    if (projects.has(request.link.projectId)) return;
    if (!bridge && options.createBridge !== null) {
      bridge = (
        options.createBridge ?? ((name) => new ProjectSyncBridge(name))
      )(request.bridgeChannel);
      host.repo.networkSubsystem.addNetworkAdapter(bridge.adapter);
    }
    const project = new HostedProject(
      request.link,
      request.manifestDocumentId,
      request.roomUrl,
      host,
    );
    projects.set(request.link.projectId, project);
    host.repo.shareConfigChanged();
    await project.start();
  }

  return {
    async handle(request: ProjectSyncWorkerRequest) {
      switch (request.kind) {
        case "projectSyncStart":
          try {
            await start(request);
          } catch (error) {
            projects.get(request.link.projectId)?.stop();
            projects.delete(request.link.projectId);
            options.postMessage({
              kind: "projectSyncStatus",
              link: request.link,
              connection: "offline",
              peers: [],
              error:
                error instanceof Error
                  ? error.message
                  : "Project sync could not start.",
            });
          }
          return;
        case "projectSyncStop": {
          const project = projects.get(request.link.projectId);
          projects.delete(request.link.projectId);
          project?.stop();
          return;
        }
        case "projectSyncToken": {
          const pending = tokenRequests.get(request.tokenRequestId);
          tokenRequests.delete(request.tokenRequestId);
          if (request.grant) pending?.resolve(request.grant);
          else
            pending?.reject(
              new Error(request.error ?? "No sync token was issued."),
            );
          return;
        }
        case "projectSyncPresence":
          projects.get(request.link.projectId)?.setPresence(request.state);
          return;
        case "projectSyncNetwork":
          for (const listener of networkListeners) listener(request.online);
          return;
      }
    },
  };
}
