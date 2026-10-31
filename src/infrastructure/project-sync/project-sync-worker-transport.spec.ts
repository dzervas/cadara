import { afterEach, expect, test, vi } from "vitest";
import { initializeBase64Wasm, Repo } from "@automerge/automerge-repo/slim";
import { automergeWasmBase64 } from "@automerge/automerge/automerge.wasm.base64";
import type { ProjectSyncStatus } from "@/application/project-sync/project-service-port";
import type {
  ProjectSyncWorkerRequest,
  ProjectSyncWorkerResponse,
} from "@/infrastructure/workers/project-sync-worker-protocol";
import {
  createProjectSyncWorkerTransport,
  projectRoomUrl,
} from "./project-sync-worker-transport";

const repos: Repo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.networkSubsystem.disconnect();
});

const link = { orgId: "org", projectId: "remote" };

async function makeTransport() {
  await initializeBase64Wasm(automergeWasmBase64);
  const repo = new Repo();
  repos.push(repo);
  const posted: ProjectSyncWorkerRequest[] = [];
  let workerListener: ((message: ProjectSyncWorkerResponse) => void) | null =
    null;
  const transport = createProjectSyncWorkerTransport({
    channel: {
      postProjectSyncMessage: (message) => posted.push(message),
      subscribeToProjectSync(listener) {
        workerListener = listener;
        return () => (workerListener = null);
      },
    },
    apiOrigin: "https://api.cadara.test",
    getProjectRepo: async () => repo,
  });
  return {
    transport,
    posted,
    fromWorker: (message: ProjectSyncWorkerResponse) =>
      workerListener?.(message),
  };
}

test("room URLs use the WebSocket scheme of the API origin", () => {
  expect(projectRoomUrl("https://api.cadara.app", "p 1")).toBe(
    "wss://api.cadara.app/sync/p%201",
  );
  expect(projectRoomUrl("http://localhost:8788", "p1")).toBe(
    "ws://localhost:8788/sync/p1",
  );
});

test("the worker starts after the bridge is up and receives presence set before that", async () => {
  const { transport, posted } = await makeTransport();
  transport.start({
    link,
    manifestDocumentId: "manifest",
    issueGrant: async () => ({ token: "t", expiresIn: 600, role: "editor" }),
  });
  transport.setPresence(link, {
    userId: "u",
    name: "Ada",
    activeDocumentId: null,
  });
  expect(posted).toEqual([]);
  await vi.waitFor(() => expect(posted).toHaveLength(2));
  expect(posted[0]).toMatchObject({
    kind: "projectSyncStart",
    link,
    manifestDocumentId: "manifest",
    roomUrl: "wss://api.cadara.test/sync/remote",
  });
  expect(posted[1]).toMatchObject({
    kind: "projectSyncPresence",
    state: { name: "Ada" },
  });
});

test("token requests are answered with a fresh grant whose role reaches subscribers", async () => {
  const { transport, posted, fromWorker } = await makeTransport();
  let issued = 0;
  transport.start({
    link,
    manifestDocumentId: "manifest",
    issueGrant: async () => ({
      token: `token${++issued}`,
      expiresIn: 600,
      role: "viewer",
    }),
  });
  const statuses: ProjectSyncStatus[] = [];
  transport.subscribe(link, (status) => statuses.push(status));
  fromWorker({ kind: "projectSyncTokenRequest", tokenRequestId: 7, link });
  await vi.waitFor(() =>
    expect(posted).toContainEqual({
      kind: "projectSyncToken",
      tokenRequestId: 7,
      grant: { token: "token1", expiresIn: 600 },
    }),
  );
  expect(statuses.at(-1)?.role).toBe("viewer");
});

test("a refused grant is reported to the worker so it backs off", async () => {
  const { transport, posted, fromWorker } = await makeTransport();
  transport.start({
    link,
    manifestDocumentId: "manifest",
    issueGrant: async () => {
      throw new Error("Sign in to CADara to sync projects.");
    },
  });
  fromWorker({ kind: "projectSyncTokenRequest", tokenRequestId: 1, link });
  await vi.waitFor(() =>
    expect(posted).toContainEqual({
      kind: "projectSyncToken",
      tokenRequestId: 1,
      grant: null,
      error: "Sign in to CADara to sync projects.",
    }),
  );
});

test("waiting for a download resolves once synced and fails when sync stops", async () => {
  const { transport, fromWorker } = await makeTransport();
  const start = () =>
    transport.start({
      link,
      manifestDocumentId: "manifest",
      issueGrant: async () => ({ token: "t", expiresIn: 600, role: "editor" }),
    });
  start();
  const synced = transport.whenSynced(link);
  fromWorker({
    kind: "projectSyncStatus",
    link,
    connection: "syncing",
    peers: [],
  });
  fromWorker({
    kind: "projectSyncStatus",
    link,
    connection: "synced",
    peers: [],
  });
  await expect(synced).resolves.toBeUndefined();

  transport.stop(link);
  start();
  const stopped = transport.whenSynced(link);
  transport.stop(link);
  await expect(stopped).rejects.toThrow("stopped");
});
