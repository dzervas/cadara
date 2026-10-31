import {
  cbor,
  NetworkAdapter,
  type Message,
  type PeerId,
  type PeerMetadata,
} from "@automerge/automerge-repo/slim";
import {
  SYNC_RECONNECT_MAX_DELAY_MS,
  syncReconnectDelayMs,
  syncTokenRefreshDelayMs,
} from "@/core/project-sync/sync-connection-schedule";
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
  /** Whether the network is up when the adapter starts (navigator.onLine). */
  initiallyOnline?: boolean;
  now?: () => number;
}

const SOCKET_OPEN = 1;

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
 * `cadara-sync.<token>` subprotocol. Tokens are fixed per socket, so before
 * expiry the adapter opens a second socket with a fresh token and switches
 * to it once the room accepted it. After any other close it reconnects with
 * exponential backoff until `disconnect`; the backoff only resets once a
 * socket has lasted (its renewal fired, or it stayed up longer than the
 * longest backoff) or the room closed it cleanly, so a room that accepts the
 * join and then refuses every message (1008) is retried ever more slowly.
 * The adapter is always "ready": an offline room must not delay local loads.
 */
export class ProjectRoomNetworkAdapter extends NetworkAdapter {
  readonly #options: ProjectRoomNetworkAdapterOptions;
  readonly #timers: ProjectRoomTimers;
  readonly #now: () => number;
  #socket: ProjectRoomSocket | null = null;
  /** The renewal socket, until the room accepts it. */
  #pending: ProjectRoomSocket | null = null;
  #roomPeerId: PeerId | null = null;
  #joinedAt = 0;
  #timer: unknown = null;
  #failures = 0;
  #opening = false;
  #stopped = true;
  #online: boolean;
  #unwatchNetwork: (() => void) | null = null;
  #connection: ProjectRoomConnection = "offline";

  constructor(options: ProjectRoomNetworkAdapterOptions) {
    super();
    this.#options = options;
    this.#online = options.initiallyOnline ?? true;
    this.#now = options.now ?? Date.now;
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
    this.#closeAll("Disconnected");
  }

  #closeAll(reason: string) {
    this.#clearTimer();
    const pending = this.#pending;
    if (pending) {
      pending.close(1000, reason);
      this.#closed(pending, 1000);
    }
    const socket = this.#socket;
    if (socket) {
      socket.close(1000, reason);
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
    // Emulated or flaky offline states can leave a dead socket open.
    if (!online) this.#closeAll("Offline");
    else if (!this.#socket) {
      this.#failures = 0;
      this.#clearTimer();
      void this.#open();
    }
  }

  async #grant() {
    try {
      return await this.#options.issueToken();
    } catch {
      // Signed out or unreachable: keep working locally and retry later.
      return null;
    }
  }

  async #open() {
    if (this.#stopped || !this.#online || this.#socket || this.#opening) return;
    this.#opening = true;
    this.#setConnection("connecting");
    const grant = await this.#grant();
    this.#opening = false;
    if (this.#stopped || !this.#online) {
      this.#setConnection("offline");
      return;
    }
    if (!grant) {
      this.#retry();
      return;
    }
    this.#socket = this.#createSocket(grant);
  }

  #createSocket(grant: SyncTokenResponse) {
    const socket = (
      this.#options.createSocket ??
      ((url, protocols) =>
        new WebSocket(url, protocols) as unknown as ProjectRoomSocket)
    )(this.#options.url, [`cadara-sync.${grant.token}`]);
    socket.binaryType = "arraybuffer";
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
    return socket;
  }

  #retry() {
    this.#failures += 1;
    this.#setConnection("offline");
    this.#schedule(
      () => void this.#open(),
      syncReconnectDelayMs(this.#failures),
    );
  }

  #joined(
    socket: ProjectRoomSocket,
    message: Message,
    grant: SyncTokenResponse,
  ) {
    const previous = this.#roomPeerId;
    this.#roomPeerId = message.senderId;
    this.#joinedAt = this.#now();
    this.#schedule(
      () => void this.#renew(socket),
      syncTokenRefreshDelayMs(grant.expiresIn),
    );
    this.#setConnection("connected");
    // A renewed socket restarts the sync handshake: messages sent on the old
    // socket after the room replaced it are lost.
    if (previous) this.emit("peer-disconnected", { peerId: previous });
    this.emit("peer-candidate", {
      peerId: message.senderId,
      peerMetadata:
        (message as Message & { peerMetadata?: PeerMetadata }).peerMetadata ??
        {},
    });
  }

  #receive(socket: ProjectRoomSocket, data: unknown, grant: SyncTokenResponse) {
    if (!(data instanceof ArrayBuffer)) return;
    if (socket !== this.#socket && socket !== this.#pending) return;
    const message = cbor.decode(new Uint8Array(data)) as Message;
    if (socket === this.#pending) {
      if (message.type !== "peer") return;
      const previous = this.#socket;
      this.#pending = null;
      this.#socket = socket;
      if (previous) {
        this.#detach(previous);
        previous.close(1000, "Token renewal");
      }
      this.#joined(socket, message, grant);
      return;
    }
    if (message.type === "peer") {
      this.#joined(socket, message, grant);
      return;
    }
    if (this.#roomPeerId) this.emit("message", message);
  }

  /** The socket lasted a whole token: open its successor before closing it. */
  async #renew(socket: ProjectRoomSocket) {
    if (socket !== this.#socket) return;
    this.#failures = 0;
    const grant = await this.#grant();
    // Without a new token the current socket serves until the room closes it.
    if (!grant || this.#stopped || !this.#online || socket !== this.#socket)
      return;
    this.#pending = this.#createSocket(grant);
  }

  #detach(socket: ProjectRoomSocket) {
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
  }

  #closed(socket: ProjectRoomSocket, code: number) {
    if (socket === this.#pending) {
      // A failed renewal: the current socket serves until it closes.
      this.#detach(socket);
      this.#pending = null;
      return;
    }
    if (socket !== this.#socket) return;
    this.#detach(socket);
    this.#socket = null;
    this.#clearTimer();
    const roomPeerId = this.#roomPeerId;
    this.#roomPeerId = null;
    if (roomPeerId) this.emit("peer-disconnected", { peerId: roomPeerId });
    if (this.#stopped || !this.#online) {
      this.#setConnection("offline");
      return;
    }
    if (this.#pending) {
      // The room replaced this socket with the renewal; it joins shortly.
      this.#socket = this.#pending;
      this.#pending = null;
      return;
    }
    const lasted =
      roomPeerId !== null &&
      this.#now() - this.#joinedAt >= SYNC_RECONNECT_MAX_DELAY_MS;
    if (lasted || (roomPeerId !== null && (code === 1000 || code === 1001)))
      this.#failures = 0;
    this.#retry();
  }
}
