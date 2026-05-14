import { test, expect } from "vitest";

import type { DocumentSyncWorkerRequest } from "@/domain/modeling/document-sync-worker-protocol";
import { createDocumentSyncWorkerDispatcher } from "@/infrastructure/workers/document-sync-worker-dispatcher";

test("src/infrastructure/workers/document-sync-worker-dispatcher.spec.ts", async () => {
  async function testRequestsWaitForBootstrapConfiguration() {
    const observedSearches: string[] = [];
    const handledRequests: string[] = [];
    const dispatcher = createDocumentSyncWorkerDispatcher((search) => {
      observedSearches.push(search);
      return (request) => {
        handledRequests.push(`${search}:${request.kind}:${request.documentId}`);
      };
    });

    dispatcher({
      kind: "subscribe",
      requestId:
        "request_document_sync_subscribe" as DocumentSyncWorkerRequest["requestId"],
      subscriptionId: "subscription_document_sync_1",
      documentId: "doc_workspace",
    });

    expect(
      handledRequests.length,
      "Document sync worker requests should wait until bootstrap configuration is available.",
    ).toBe(0);

    dispatcher({
      kind: "bootstrap",
      search:
        "?cadLocalPeerSync=1&cadLocalPeerSyncChannel=peer-a&cadRepositoryDbName=repo-a",
    });

    expect(
      observedSearches.join(","),
      "The worker dispatcher should initialize the worker message handler from the bootstrap search string.",
    ).toBe("?cadLocalPeerSync=1&cadLocalPeerSyncChannel=peer-a&cadRepositoryDbName=repo-a");
    expect(
      handledRequests.join(","),
      "Requests queued before bootstrap should be replayed through the configured worker handler.",
    ).toBe("?cadLocalPeerSync=1&cadLocalPeerSyncChannel=peer-a&cadRepositoryDbName=repo-a:subscribe:doc_workspace");
  }

  function testConfiguredWorkerHandlesLaterRequestsImmediately() {
    const handledRequests: string[] = [];
    const dispatcher = createDocumentSyncWorkerDispatcher((search) => {
      return (request) => {
        handledRequests.push(`${search}:${request.kind}:${request.documentId}`);
      };
    });

    dispatcher({ kind: "bootstrap", search: "?cadRepositoryDbName=repo-b" });
    dispatcher({
      kind: "load",
      requestId:
        "request_document_sync_load" as DocumentSyncWorkerRequest["requestId"],
      documentId: "doc_workspace",
      seedDocument: {} as Extract<
        DocumentSyncWorkerRequest,
        { kind: "load" }
      >["seedDocument"],
    });

    expect(
      handledRequests.join(","),
      "Once bootstrapped, later worker requests should run immediately through the configured handler.",
    ).toBe("?cadRepositoryDbName=repo-b:load:doc_workspace");
  }

  await testRequestsWaitForBootstrapConfiguration();
  testConfiguredWorkerHandlesLaterRequestsImmediately();
});
