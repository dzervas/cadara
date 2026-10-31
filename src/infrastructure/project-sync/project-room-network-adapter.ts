import {
  cbor,
  NetworkAdapter,
  type Message,
  type PeerId,
  type PeerMetadata,
} from "@automerge/automerge-repo/slim";
import {
  syncReconnectDelayMs,
  syncTokenRefreshDelayMs,
} from "@/application/project-sync/sync-connection-schedule";
import type { SyncTokenResponse } from "@/contracts/project-sync/project-service";

/** The subset of the browser WebSocket the adapter uses. */
export interface ProjectRoomSocket {
  binaryType: string;
  readyState: number;
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
}

export type ProjectRoomConnection = "offline" | "connecting" | "connected";

export interface ProjectRoomTimers {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export interface ProjectRoomNetworkAdapterOptions {
  /** `ws(s)://<api>/sync/<projectId>`. */
  url: string;
  issueToken: () => Promise<SyncTokenResponse>;
  createSocket?: (url: string, protocols: string[]) => ProjectRoomSocket;
  timers?: ProjectRoomTimers;
  /** Registers browser online/offline callbacks; returns the unsubscribe. */
  watchNetwork?: (onChange: (online: boolean) => void) => () => void;
  onConnectionChange?: (connection: ProjectRoomConnection) => void;
}

const SOCKET_OPEN = 1;
/** The room's close code for an expired or revoked token. */
const ROOM_TOKEN_REJECTED = 4001;

/** The online/offline events of the current global scope (window or worker). */
export function browserNetworkWatcher(onChange: (online: boolean) => void) {
  const scope = globalThis as unknown as {
    addEventListener?: (type: string, listener: () => void) => void;
    removeEventListener?: (type: string, listener: () => void) => void;
  };
  const online = () => onChange(true);
  const offline = () => onChange(false);
  scope.addEventListener?.("online", online);
  scope.addEventListener?.("offline", offline);
  return () => {
    scope.removeEventListener?.("online", online);
    scope.removeEventListener?.("offline", offline);
  };
}

/**
 * Connects a Repo to one project's room on the CADara service.
 *
 * The room speaks the automerge-repo wire protocol (CBOR messages, join/peer
 * handshake, protocol "1") and authenticates the upgrade with the
 * `cadara-sync.<token>` subprotocol. Tokens are fixed per socket, so the
 * adapter reopens the socket with a fresh token before expiry, and after any
 * close it reconnects with exponential backoff until `disconnect`. The
 * adapter is always "ready": an offline room must not delay local loads.
 */
export class ProjectRoomNetworkAdapter extends NetworkAdapter {
  readonly #options: ProjectRoomNetworkAdapterOptions;
  readonly #timers: ProjectRoomTimers;
  #socket: ProjectRoomSocket | null = null;
  #roomPeerId: PeerId | null = null;
  #timer: unknown = null;
  #failures = 0;
  #renewing = false;
  #opening = false;
  #stopped = true;
  #online = true;
  #unwatchNetwork: (() => void) | null = null;
  #connection: ProjectRoomConnection = "offline";

  constructor(options: ProjectRoomNetworkAdapterOptions) {
    super();
    this.#options = options;
    this.#timers = options.timers ?? {
      set: (callback, delayMs) => setTimeout(callback, delayMs),
      clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
  }

  get connection() {
    return this.#connection;
  }

  /** The room's peer id once the room accepted the socket. */
  get roomPeerId() {
    return this.#roomPeerId;
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
    this.#stopped = false;
    this.#unwatchNetwork ??= (
      this.#options.watchNetwork ?? browserNetworkWatcher
    )((online) => this.#networkChanged(online));
    void this.#open();
  }

  send(message: Message) {
    const socket = this.#socket;
    if (!socket || !this.#roomPeerId || socket.readyState !== SOCKET_OPEN)
      return;
    // automerge-repo gossips other peers' presence to every peer; the room
    // relays presence itself and closes a socket that sends as someone else.
    if (message.senderId !== this.peerId) return;
    socket.send(cbor.encode(message));
  }

  disconnect() {
    this.#stopped = true;
    this.#unwatchNetwork?.();
    this.#unwatchNetwork = null;
    this.#clearTimer();
    const socket = this.#socket;
    if (socket) {
      socket.close(1000, "Disconnected");
      this.#closed(socket, 1000);
    }
    this.#setConnection("offline");
  }

  #setConnection(connection: ProjectRoomConnection) {
    if (this.#connection === connection) return;
    this.#connection = connection;
    this.#options.onConnectionChange?.(connection);
  }

  #clearTimer() {
    if (this.#timer !== null) this.#timers.clear(this.#timer);
    this.#timer = null;
  }

  #schedule(callback: () => void, delayMs: number) {
    this.#clearTimer();
    this.#timer = this.#timers.set(() => {
      this.#timer = null;
      callback();
    }, delayMs);
  }

  #networkChanged(online: boolean) {
    this.#online = online;
    if (this.#stopped) return;
    if (!online) {
      // Emulated or flaky offline states can leave a dead socket open.
      this.#clearTimer();
      const socket = this.#socket;
      if (socket) {
        socket.close(1000, "Offline");
        this.#closed(socket, 1000);
      }
      this.#setConnection("offline");
      return;
    }
    if (!this.#socket) {
      this.#failures = 0;
      this.#clearTimer();
      void this.#open();
    }
  }

  async #open() {
    if (this.#stopped || !this.#online || this.#socket || this.#opening) return;
    this.#opening = true;
    this.#setConnection("connecting");
    let grant: SyncTokenResponse;
    try {
      grant = await this.#options.issueToken();
    } catch {
      // Signed out or unreachable: keep working locally and retry later.
      this.#opening = false;
      if (!this.#stopped && this.#online) this.#retry();
      return;
    }
    this.#opening = false;
    if (this.#stopped || !this.#online) {
      this.#setConnection("offline");
      return;
    }
    const socket = (
      this.#options.createSocket ??
      ((url, protocols) =>
        new WebSocket(url, protocols) as unknown as ProjectRoomSocket)
    )(this.#options.url, [`cadara-sync.${grant.token}`]);
    socket.binaryType = "arraybuffer";
    this.#socket = socket;
    socket.onopen = () => {
      socket.send(
        cbor.encode({
          type: "join",
          senderId: this.peerId,
          peerMetadata: this.peerMetadata ?? {},
          supportedProtocolVersions: ["1"],
        }),
      );
    };
    socket.onmessage = (event) => this.#receive(socket, event.data, grant);
    socket.onclose = (event) => this.#closed(socket, event.code);
    // Every error is followed by a close event, which schedules the retry.
    socket.onerror = () => undefined;
  }

  #retry() {
    this.#failures += 1;
    this.#setConnection("offline");
    this.#schedule(
      () => void this.#open(),
      syncReconnectDelayMs(this.#failures),
    );
  }

  #receive(socket: ProjectRoomSocket, data: unknown, grant: SyncTokenResponse) {
    if (socket !== this.#socket || !(data instanceof ArrayBuffer)) return;
    const message = cbor.decode(new Uint8Array(data)) as Message & {
      peerMetadata?: PeerMetadata;
    };
    if (message.type === "peer") {
      this.#roomPeerId = message.senderId;
      this.#failures = 0;
      this.#schedule(
        () => this.#renew(socket),
        syncTokenRefreshDelayMs(grant.expiresIn),
      );
      this.#setConnection("connected");
      this.emit("peer-candidate", {
        peerId: message.senderId,
        peerMetadata: message.peerMetadata ?? {},
      });
      return;
    }
    if (this.#roomPeerId) this.emit("message", message);
  }

  #renew(socket: ProjectRoomSocket) {
    if (socket !== this.#socket) return;
    this.#renewing = true;
    socket.close(1000, "Token renewal");
    this.#closed(socket, 1000);
  }

  #closed(socket: ProjectRoomSocket, code: number) {
    if (socket !== this.#socket) return;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    this.#socket = null;
    this.#clearTimer();
    const roomPeerId = this.#roomPeerId;
    this.#roomPeerId = null;
    if (roomPeerId) this.emit("peer-disconnected", { peerId: roomPeerId });
    const renewing = this.#renewing;
    this.#renewing = false;
    if (this.#stopped || !this.#online) {
      this.#setConnection("offline");
      return;
    }
    if (renewing || (roomPeerId && code === ROOM_TOKEN_REJECTED)) {
      // A planned renewal or an expired token: reconnect at once with a new one.
      this.#failures = 0;
      void this.#open();
      return;
    }
    this.#retry();
  }
}
