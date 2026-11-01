// Lane: logic. Seam: the cloneWithHistory worker request from the page's
// WorkerBackedDocumentRepository through the worker client and runtime into
// the worker's Automerge repository (Move to project's copy step).
import { afterEach, expect, test } from "vitest";
import { Repo } from "@automerge/automerge-repo";
import * as Automerge from "@automerge/automerge";
import type { DocumentId, RequestId } from "@/contracts/shared/ids";
import { createSeedAuthoredModelDocument } from "@/application/modeling/modeling-test-fixtures";
import { createMemoryGeometryAssetStore } from "@/core/modeling/geometry-asset-store";
import {
  materializeCollaborativeDocument,
  type CollaborativeDocument,
} from "@/core/modeling/collaborative-document";
import { WorkerBackedDocumentRepository } from "@/infrastructure/modeling/worker-backed-document-repository";
import { MemoryDocumentRepositoryUrlStore } from "@/infrastructure/persistence/document-repository-url-store";
import {
  IndexedDbAutomergeDocumentRepository,
  type AutomergeRepositoryLike,
} from "@/infrastructure/persistence/indexeddb-automerge-document-repository";
import {
  DocumentSyncWorkerClient,
  type DocumentSyncWorkerLike,
} from "./document-sync-worker-client";
import type { DocumentSyncWorkerResponse } from "./document-sync-worker-protocol";
import { createDocumentSyncWorkerMessageHandler } from "./document-sync-worker-runtime";
import { isProjectSyncWorkerRequest } from "./project-sync-worker-protocol";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function makeWorker() {
  const repo = new Repo();
  const pageUrls = new MemoryDocumentRepositoryUrlStore();
  const workerDocuments = new IndexedDbAutomergeDocumentRepository({
    repo: repo as unknown as AutomergeRepositoryLike,
    urlStore: new MemoryDocumentRepositoryUrlStore(),
    assetStore: createMemoryGeometryAssetStore(),
  });
  let listener:
    | ((event: MessageEvent<DocumentSyncWorkerResponse>) => void)
    | null = null;
  const responses: DocumentSyncWorkerResponse[] = [];
  const handle = createDocumentSyncWorkerMessageHandler(
    { repository: workerDocuments },
    (message) => {
      responses.push(message);
      listener?.({ data: message } as MessageEvent<DocumentSyncWorkerResponse>);
    },
  );
  const worker: DocumentSyncWorkerLike = {
    postMessage: (message) => {
      if (!isProjectSyncWorkerRequest(message)) void handle(message);
    },
    addEventListener: (_type, callback) => {
      listener = callback;
    },
    removeEventListener: () => {
      listener = null;
    },
  };
  const client = new DocumentSyncWorkerClient({ worker });
  cleanups.push(async () => {
    client.dispose();
    await repo.shutdown();
  });
  return {
    repo,
    pageUrls,
    handle,
    responses,
    repository: new WorkerBackedDocumentRepository({
      client,
      urlStore: pageUrls,
    }),
  };
}

async function seedDocument(documentId: DocumentId) {
  return { ...(await createSeedAuthoredModelDocument()), documentId };
}

async function storedDocument(
  repo: Repo,
  urls: MemoryDocumentRepositoryUrlStore,
  documentId: DocumentId,
) {
  const handle = await repo.find<CollaborativeDocument>(urls.get(documentId)!);
  return handle.doc();
}

test("a history copy requested right after an edit holds that edit and the whole history under the new identity", async () => {
  const { repo, pageUrls, repository } = makeWorker();
  const seed = await seedDocument("doc_source");
  expect(
    (await repository.load({ documentId: seed.documentId, seedDocument: seed }))
      .ok,
  ).toBe(true);
  const renamed = await repository.mutate({
    documentId: seed.documentId,
    expected: seed,
    document: { ...seed, name: "Renamed" },
  });
  expect(renamed.ok).toBe(true);
  const named = renamed.ok ? renamed.document : seed;

  // Move to project starts the copy without waiting for the edit's answer.
  const editing = repository.mutate({
    documentId: seed.documentId,
    expected: named,
    document: { ...named, name: "Edited right before the move" },
  });
  const copying = repository.cloneWithHistory(seed.documentId, "doc_copy");
  expect((await editing).ok).toBe(true);
  await copying;

  const source = await storedDocument(repo, pageUrls, seed.documentId);
  const copy = await storedDocument(repo, pageUrls, "doc_copy");
  expect(pageUrls.get("doc_copy")).not.toBe(pageUrls.get(seed.documentId));
  expect(materializeCollaborativeDocument(copy)).toMatchObject({
    documentId: "doc_copy",
    name: "Edited right before the move",
  });
  const copyHashes = new Set(
    Automerge.getAllChanges(copy).map(
      (change) => Automerge.decodeChange(change).hash,
    ),
  );
  for (const change of Automerge.getAllChanges(source))
    expect(
      copyHashes.has(Automerge.decodeChange(change).hash),
      "Every change of the source is in the copy's history",
    ).toBe(true);
  expect(materializeCollaborativeDocument(source)).toMatchObject({
    documentId: seed.documentId,
    name: "Edited right before the move",
  });

  const reopened = await repository.load({
    documentId: "doc_copy",
    seedDocument: { ...seed, documentId: "doc_copy" },
  });
  expect(reopened.ok && reopened.document.name).toBe(
    "Edited right before the move",
  );
});

test("a copy onto an identity in use, or a malformed request, is refused and stores nothing", async () => {
  const { pageUrls, repository, handle, responses } = makeWorker();
  const seed = await seedDocument("doc_source");
  const other = await seedDocument("doc_other");
  await repository.load({ documentId: seed.documentId, seedDocument: seed });
  await repository.load({ documentId: other.documentId, seedDocument: other });
  const otherUrl = pageUrls.get(other.documentId);

  await expect(
    repository.cloneWithHistory(seed.documentId, other.documentId),
  ).rejects.toThrow("already in use");
  expect(pageUrls.get(other.documentId)).toBe(otherUrl);

  await handle({
    kind: "cloneWithHistory",
    requestId: "request_malformed" as RequestId,
    documentId: seed.documentId,
    targetDocumentId: "copy" as DocumentId,
  });
  expect(responses.at(-1)).toMatchObject({
    kind: "failure",
    requestId: "request_malformed",
    error: { message: "Invalid document history copy request." },
  });
  expect(pageUrls.get("copy" as DocumentId)).toBeNull();
});
