/** A fake CADara room and worker hosts connected to it, for project sync specs. */
import {
  cbor,
  NetworkAdapter,
  Repo,
  type DocumentId,
  type Message,
  type PeerId,
  type PeerMetadata,
} from "@automerge/automerge-repo/slim";
import type { ProjectManifest } from "@/contracts/modeling/project-manifest";
import { SharedMemoryStorage } from "@/infrastructure/persistence/shared-memory-automerge-storage.fixtures";
import type { ProjectSyncWorkerResponse } from "@/infrastructure/workers/project-sync-worker-protocol";
import type { ProjectRoomSocket } from "./project-room-network-adapter";
import {
  createProjectSyncWorkerHost,
  type ProjectSyncWorkerHostOptions,
} from "./project-sync-worker-host";

/** A socket whose other end is the fake room; delivery is asynchronous like a network. */
export class ClientSocket implements ProjectRoomSocket {
  binaryType = "blob";
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly room: FakeRoomNetwork;
  constructor(room: FakeRoomNetwork) {
    this.room = room;
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }
  send(data: Uint8Array) {
    const copy = data.slice();
    queueMicrotask(() => this.room.receive(this, copy));
  }
  deliver(message: unknown) {
    const bytes = cbor.encode(message);
    const data = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    queueMicrotask(() => this.onmessage?.({ data }));
  }
  close() {
    this.readyState = 3;
  }
  drop(code: number) {
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.({ code }));
  }
}

/**
 * The room's contract as the service implements it: every message must come
 * from the socket's own peer and name the manifest or a document listed in
 * the room's own copy of the manifest, otherwise the socket is closed with
 * 1008.
 */
export class FakeRoomNetwork extends NetworkAdapter {
  readonly violations: string[] = [];
  private readonly sockets = new Map<PeerId, ClientSocket>();
  private readonly allowed: (documentId: string) => boolean;
  constructor(allowed: (documentId: string) => boolean) {
    super();
    this.allowed = allowed;
  }
  isReady() {
    return true;
  }
  whenReady() {
    return Promise.resolve();
  }
  connect(peerId: PeerId, peerMetadata?: PeerMetadata) {
    this.peerId = peerId;
    this.peerMetadata = peerMetadata;
  }
  disconnect() {}
  send(message: Message) {
    this.sockets.get(message.targetId)?.deliver(message);
  }
  receive(socket: ClientSocket, bytes: Uint8Array) {
    const message = cbor.decode(bytes) as Message;
    if (message.type === "join") {
      this.sockets.set(message.senderId, socket);
      this.emit("peer-candidate", {
        peerId: message.senderId,
        peerMetadata: { isEphemeral: true },
      });
      socket.deliver({
        type: "peer",
        senderId: this.peerId,
        targetId: message.senderId,
        peerMetadata: this.peerMetadata,
        selectedProtocolVersion: "1",
      });
      return;
    }
    const joined = [...this.sockets].find(([, open]) => open === socket)?.[0];
    if (message.senderId !== joined) {
      this.violations.push(`sender ${message.senderId}`);
      socket.drop(1008);
      return;
    }
    if (!("documentId" in message) || !this.allowed(message.documentId!)) {
      this.violations.push(
        String((message as { documentId?: string }).documentId),
      );
      socket.drop(1008);
      return;
    }
    this.emit("message", message);
  }
}

export function makeRoom(manifestId: string) {
  const room: { repo: Repo | null } = { repo: null };
  const allowed = (documentId: string) => {
    if (documentId === manifestId) return true;
    const manifest = room.repo?.handles[manifestId as DocumentId];
    const value = manifest?.isReady()
      ? (manifest.doc() as Partial<ProjectManifest>)
      : undefined;
    return (value?.entries ?? []).some(
      (entry) => entry.automergeDocumentId === documentId,
    );
  };
  const network = new FakeRoomNetwork(allowed);
  const share = async (_peer: PeerId, documentId?: string) =>
    documentId === undefined || allowed(documentId);
  const repo = new Repo({
    storage: new SharedMemoryStorage(),
    network: [network],
    peerId: "room-remote" as PeerId,
    shareConfig: { announce: share, access: share },
  });
  room.repo = repo;
  return { repo, network };
}

export function makeManifest(
  entries: ProjectManifest["entries"],
): ProjectManifest {
  return {
    format: "cadara-project",
    schemaVersion: 1,
    projectId: "local_project",
    name: "Bracket",
    entries,
    versions: [],
  };
}

export const link = { orgId: "org", projectId: "remote" };

/**
 * A worker host on its own Repo, connected to `room`; its network can be
 * switched off and on, and tokens are always granted.
 */
export function makeClient(
  room: ReturnType<typeof makeRoom>,
  repo = new Repo({ storage: new SharedMemoryStorage(), network: [] }),
  options: Partial<ProjectSyncWorkerHostOptions> = {},
) {
  const networkListeners = new Set<(online: boolean) => void>();
  const statuses: Extract<
    ProjectSyncWorkerResponse,
    { kind: "projectSyncStatus" }
  >[] = [];
  const host = createProjectSyncWorkerHost({
    getRepo: async () => repo,
    postMessage(message) {
      if (message.kind === "projectSyncStatus") statuses.push(message);
      else
        void host.handle({
          kind: "projectSyncToken",
          tokenRequestId: message.tokenRequestId,
          grant: { token: "token", expiresIn: 600 },
        });
    },
    roomAdapterOptions: {
      createSocket: () => new ClientSocket(room.network),
      watchNetwork: (onChange) => {
        networkListeners.add(onChange);
        return () => networkListeners.delete(onChange);
      },
    },
    createBridge: null,
    presenceTiming: {
      heartbeatMs: 200,
      peerTtlMs: 2_000,
      reannounceDelayMs: 20,
    },
    ...options,
  });
  return {
    repo,
    host,
    status: () => statuses.at(-1),
    setOnline(online: boolean) {
      for (const listener of networkListeners) listener(online);
    },
    start: (manifestDocumentId: string, foreignDocumentIds: string[] = []) =>
      host.handle({
        kind: "projectSyncStart",
        link,
        manifestDocumentId,
        roomUrl: "ws://api.test/sync/remote",
        bridgeChannel: "unused",
        foreignDocumentIds,
      }),
  };
}
