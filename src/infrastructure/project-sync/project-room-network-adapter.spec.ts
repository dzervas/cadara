import { expect, test } from "vitest";
import { cbor, type PeerId } from "@automerge/automerge-repo/slim";
import {
  ProjectRoomNetworkAdapter,
  type ProjectRoomConnection,
  type ProjectRoomSocket,
} from "./project-room-network-adapter";

class FakeRoomSocket implements ProjectRoomSocket {
  binaryType = "blob";
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  closedWith: number | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: string;
  readonly protocols: string[];
  constructor(url: string, protocols: string[]) {
    this.url = url;
    this.protocols = protocols;
  }
  send(data: Uint8Array) {
    this.sent.push(cbor.decode(data) as Record<string, unknown>);
  }
  close(code = 1000) {
    this.closedWith = code;
    this.readyState = 3;
  }
  /** The room accepts the upgrade and answers the join. */
  accept(roomPeerId = "room-p1") {
    this.readyState = 1;
    this.onopen?.();
    this.deliver({
      type: "peer",
      senderId: roomPeerId,
      targetId: "client",
      peerMetadata: { storageId: "room-storage", isEphemeral: false },
      selectedProtocolVersion: "1",
    });
  }
  deliver(message: Record<string, unknown>) {
    const bytes = cbor.encode(message);
    this.onmessage?.({
      data: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ),
    });
  }
  /** The room or the network closes the socket. */
  drop(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

function makeHarness(
  issueToken: () => Promise<{ token: string; expiresIn: number }> = (() => {
    let count = 0;
    return async () => ({ token: `token${++count}`, expiresIn: 600 });
  })(),
) {
  const sockets: FakeRoomSocket[] = [];
  const timers: { callback: () => void; delayMs: number; live: boolean }[] = [];
  const connections: ProjectRoomConnection[] = [];
  const events: string[] = [];
  let network: ((online: boolean) => void) | null = null;
  const adapter = new ProjectRoomNetworkAdapter({
    url: "ws://api.test/sync/p1",
    issueToken,
    createSocket: (url, protocols) => {
      const socket = new FakeRoomSocket(url, protocols);
      sockets.push(socket);
      return socket;
    },
    timers: {
      set(callback, delayMs) {
        const timer = { callback, delayMs, live: true };
        timers.push(timer);
        return timer;
      },
      clear(handle) {
        (handle as { live: boolean }).live = false;
      },
    },
    watchNetwork(onChange) {
      network = onChange;
      return () => (network = null);
    },
    onConnectionChange: (connection) => connections.push(connection),
  });
  adapter.on("peer-candidate", ({ peerId }) => events.push(`peer ${peerId}`));
  adapter.on("peer-disconnected", ({ peerId }) =>
    events.push(`gone ${peerId}`),
  );
  adapter.on("message", (message) => events.push(`message ${message.type}`));
  const pendingTimers = () => timers.filter((timer) => timer.live);
  return {
    adapter,
    sockets,
    connections,
    events,
    pendingTimers,
    async fireTimer() {
      const [timer] = pendingTimers();
      expect(timer, "a reconnect or renewal timer is pending").toBeDefined();
      timer!.live = false;
      timer!.callback();
      await settle();
    },
    setOnline(online: boolean) {
      network?.(online);
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the socket authenticates with the token subprotocol and joins with protocol 1", async () => {
  const harness = makeHarness();
  harness.adapter.connect("client" as PeerId, { isEphemeral: false });
  await settle();
  const [socket] = harness.sockets;
  expect(socket!.url).toBe("ws://api.test/sync/p1");
  expect(socket!.protocols).toEqual(["cadara-sync.token1"]);
  expect(socket!.binaryType).toBe("arraybuffer");
  socket!.accept();
  expect(socket!.sent[0]).toMatchObject({
    type: "join",
    senderId: "client",
    supportedProtocolVersions: ["1"],
  });
  socket!.deliver({ type: "sync", senderId: "room-p1", targetId: "client" });
  expect(harness.events).toEqual(["peer room-p1", "message sync"]);
  expect(harness.connections).toEqual(["connecting", "connected"]);
});

test("the token is renewed one minute before expiry by reopening the socket", async () => {
  const harness = makeHarness();
  harness.adapter.connect("client" as PeerId);
  await settle();
  harness.sockets[0]!.accept();
  expect(harness.pendingTimers().map((timer) => timer.delayMs)).toEqual([
    540_000,
  ]);
  await harness.fireTimer();
  expect(harness.sockets[0]!.closedWith).toBe(1000);
  expect(harness.sockets[1]!.protocols).toEqual(["cadara-sync.token2"]);
  harness.sockets[1]!.accept();
  expect(harness.events).toEqual([
    "peer room-p1",
    "gone room-p1",
    "peer room-p1",
  ]);
});

test("failed attempts back off exponentially and a successful join resets the backoff", async () => {
  let attempts = 0;
  const harness = makeHarness(async () => {
    attempts += 1;
    if (attempts <= 3) throw new Error("offline");
    return { token: `token${attempts}`, expiresIn: 600 };
  });
  harness.adapter.connect("client" as PeerId);
  await settle();
  const delays: number[] = [];
  for (let failure = 0; failure < 3; failure += 1) {
    delays.push(harness.pendingTimers()[0]!.delayMs);
    await harness.fireTimer();
  }
  expect(delays).toEqual([1_000, 2_000, 4_000]);
  harness.sockets[0]!.accept();
  harness.sockets[0]!.drop(1006);
  expect(harness.pendingTimers().map((timer) => timer.delayMs)).toEqual([
    1_000,
  ]);
});

test("a socket the room refuses before joining counts as a failure", async () => {
  const harness = makeHarness();
  harness.adapter.connect("client" as PeerId);
  await settle();
  harness.sockets[0]!.drop(1006);
  expect(harness.pendingTimers().map((timer) => timer.delayMs)).toEqual([
    1_000,
  ]);
  expect(harness.connections.at(-1)).toBe("offline");
});

test("an expired-token close reconnects at once with a fresh token", async () => {
  const harness = makeHarness();
  harness.adapter.connect("client" as PeerId);
  await settle();
  harness.sockets[0]!.accept();
  harness.sockets[0]!.drop(4001);
  await settle();
  expect(harness.sockets).toHaveLength(2);
  expect(harness.sockets[1]!.protocols).toEqual(["cadara-sync.token2"]);
});

test("going offline closes the socket and waits for the network instead of retrying", async () => {
  const harness = makeHarness();
  harness.adapter.connect("client" as PeerId);
  await settle();
  harness.sockets[0]!.accept();
  harness.setOnline(false);
  expect(harness.sockets[0]!.closedWith).toBe(1000);
  expect(harness.pendingTimers()).toEqual([]);
  expect(harness.connections.at(-1)).toBe("offline");
  harness.setOnline(true);
  await settle();
  expect(harness.sockets).toHaveLength(2);
});

test("disconnect stops reconnecting and releases the room peer", async () => {
  const harness = makeHarness();
  harness.adapter.connect("client" as PeerId);
  await settle();
  harness.sockets[0]!.accept();
  harness.adapter.disconnect();
  expect(harness.events).toEqual(["peer room-p1", "gone room-p1"]);
  expect(harness.pendingTimers()).toEqual([]);
  harness.setOnline(true);
  await settle();
  expect(harness.sockets).toHaveLength(1);
});

test("messages are not sent before the room accepted the socket", async () => {
  const harness = makeHarness();
  harness.adapter.connect("client" as PeerId);
  await settle();
  const socket = harness.sockets[0]!;
  harness.adapter.send({
    type: "sync",
    senderId: "client" as PeerId,
    targetId: "room-p1" as PeerId,
    documentId: "doc" as never,
    data: new Uint8Array([1]),
  });
  expect(socket.sent).toEqual([]);
});

test("presence relayed from other peers is not echoed to the room", async () => {
  const harness = makeHarness();
  harness.adapter.connect("client" as PeerId);
  await settle();
  const socket = harness.sockets[0]!;
  socket.accept();
  const relayed = {
    type: "ephemeral" as const,
    senderId: "other-client" as PeerId,
    targetId: "room-p1" as PeerId,
    documentId: "doc" as never,
    sessionId: "s",
    count: 1,
    data: new Uint8Array([1]),
  };
  harness.adapter.send(relayed);
  harness.adapter.send({ ...relayed, senderId: "client" as PeerId });
  expect(socket.sent.map((message) => message.senderId)).toEqual([
    "client",
    "client",
  ]);
  expect(socket.sent.map((message) => message.type)).toEqual([
    "join",
    "ephemeral",
  ]);
});
