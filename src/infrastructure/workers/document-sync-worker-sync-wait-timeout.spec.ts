import { Repo, type Message, type PeerId } from "@automerge/automerge-repo";
import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";
import { afterEach, expect, test, vi } from "vitest";
import {
  reportAbandonedAutomergeSyncWaits,
  type UnhandledRejectionScope,
} from "./document-sync-worker-sync-wait-timeout";

const repos: Repo[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(repos.splice(0).map((repo) => repo.shutdown()));
});

/** An EventTarget dispatches the PromiseRejectionEvent shape a worker scope does. */
function asWorkerScope(scope: EventTarget) {
  return scope as unknown as UnhandledRejectionScope;
}

/**
 * Routes Node's unhandled rejections to `scope` as a browser worker would
 * dispatch them. Returns the rejections the scope did not handle.
 */
function routeUnhandledRejectionsTo(scope: EventTarget) {
  const nodeListeners = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  const unhandled: unknown[] = [];
  process.on("unhandledRejection", (reason, promise) => {
    const event = Object.assign(
      new Event("unhandledrejection", { cancelable: true }),
      { reason, promise },
    );
    if (scope.dispatchEvent(event)) unhandled.push(reason);
  });
  return {
    unhandled,
    restore() {
      process.removeAllListeners("unhandledRejection");
      for (const listener of nodeListeners)
        process.on("unhandledRejection", listener);
    },
  };
}

test("a peer that announces a document and goes silent leaves a reported, handled sync wait timeout", async () => {
  const channelName = `document-sync-wait-${crypto.randomUUID()}`;
  const receiver = new Repo({
    peerId: "receiver" as PeerId,
    network: [
      new BroadcastChannelNetworkAdapter({ channelName, peerWaitMs: 10 }),
    ],
  });
  // The announcing peer sends its first message and then nothing more, as a
  // closed tab or a dropped room link does.
  const announcerNetwork = new BroadcastChannelNetworkAdapter({
    channelName,
    peerWaitMs: 10,
  });
  const sendOnline = announcerNetwork.send.bind(announcerNetwork);
  let documentMessagesSent = 0;
  announcerNetwork.send = (message: Message) => {
    if ("documentId" in message && documentMessagesSent++ > 0) return;
    sendOnline(message);
  };
  const announcer = new Repo({
    peerId: "announcer" as PeerId,
    network: [announcerNetwork],
  });
  repos.push(receiver, announcer);
  await vi.waitFor(() => expect(receiver.peers).toContain("announcer"));

  const scope = new EventTarget();
  const reported: Error[] = [];
  reportAbandonedAutomergeSyncWaits(asWorkerScope(scope), (error) =>
    reported.push(error),
  );
  const rejections = routeUnhandledRejectionsTo(scope);
  try {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const announced = announcer.create({ length: 1 });
    await vi.waitFor(() =>
      expect(receiver.handles[announced.documentId]?.state).toBe("requesting"),
    );
    await vi.advanceTimersByTimeAsync(61_000);
    vi.useRealTimers();
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    rejections.restore();
  }

  expect(rejections.unhandled).toEqual([]);
  expect(reported.map((error) => error.name)).toEqual(["TimeoutError"]);
});

test("other unhandled rejections stay unhandled", () => {
  const scope = new EventTarget();
  const reported: Error[] = [];
  reportAbandonedAutomergeSyncWaits(asWorkerScope(scope), (error) =>
    reported.push(error),
  );
  const event = Object.assign(
    new Event("unhandledrejection", { cancelable: true }),
    { reason: new Error("withTimeout: not a TimeoutError") },
  );

  expect(scope.dispatchEvent(event)).toBe(true);
  expect(reported).toEqual([]);
});
