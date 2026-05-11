import type { RequestId } from "@/contracts/shared/ids";
import type {
  DocumentSyncSubscriptionId,
  DocumentSyncWorkerRequest,
  DocumentSyncWorkerResponse,
  DocumentSyncWriteStatus,
} from "@/domain/modeling/document-sync-worker-protocol";

export interface DocumentSyncWorkerLike {
  postMessage(message: DocumentSyncWorkerRequest): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<DocumentSyncWorkerResponse>) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<DocumentSyncWorkerResponse>) => void,
  ): void;
  terminate?(): void;
}

export interface BrowserDocumentSyncWorkerClientOptions {
  search?: string;
}

type PendingRequest = {
  expectedKind: DocumentSyncWorkerResponse["kind"];
  resolve: (value: DocumentSyncWorkerResponse) => void;
  reject: (error: Error) => void;
};

export class DocumentSyncWorkerClient {
  private readonly worker: DocumentSyncWorkerLike;
  private nextRequestSequence = 0;
  private nextSubscriptionSequence = 0;
  private disposed = false;
  private readonly pendingRequests = new Map<RequestId, PendingRequest>();
  private readonly documentListeners = new Map<
    DocumentSyncSubscriptionId,
    (
      event: Extract<
        DocumentSyncWorkerResponse,
        { kind: "documentChanged" }
      >["event"],
    ) => void
  >();
  private readonly writeStatusListeners = new Set<
    (status: DocumentSyncWriteStatus) => void
  >();
  private readonly latestWriteStatusSequences = new Map<string, number>();
  private readonly handleMessage = (
    event: MessageEvent<DocumentSyncWorkerResponse>,
  ) => {
    this.receiveMessage(event.data);
  };

  constructor(options: { worker: DocumentSyncWorkerLike }) {
    this.worker = options.worker;
    this.worker.addEventListener("message", this.handleMessage);
  }

  async load(
    input: Omit<
      Extract<DocumentSyncWorkerRequest, { kind: "load" }>,
      "kind" | "requestId"
    >,
  ) {
    const message = await this.request("load", "loaded", input);
    return (message as Extract<DocumentSyncWorkerResponse, { kind: "loaded" }>)
      .result;
  }

  async mutate(
    input: Omit<
      Extract<DocumentSyncWorkerRequest, { kind: "mutate" }>,
      "kind" | "requestId"
    >,
  ) {
    const message = await this.request("mutate", "mutated", input);
    return (message as Extract<DocumentSyncWorkerResponse, { kind: "mutated" }>)
      .result;
  }

  async getGeometryAssetBytes(
    input: Omit<
      Extract<DocumentSyncWorkerRequest, { kind: "getGeometryAssetBytes" }>,
      "kind" | "requestId"
    >,
  ) {
    const message = await this.request(
      "getGeometryAssetBytes",
      "geometryAssetBytes",
      input,
    );
    return (
      message as Extract<
        DocumentSyncWorkerResponse,
        { kind: "geometryAssetBytes" }
      >
    ).bytes;
  }

  async getGeometryAssetRecord(
    input: Omit<
      Extract<DocumentSyncWorkerRequest, { kind: "getGeometryAssetRecord" }>,
      "kind" | "requestId"
    >,
  ) {
    const message = await this.request(
      "getGeometryAssetRecord",
      "geometryAssetRecord",
      input,
    );
    return (
      message as Extract<
        DocumentSyncWorkerResponse,
        { kind: "geometryAssetRecord" }
      >
    ).bytes;
  }

  async reset(
    input: Omit<
      Extract<DocumentSyncWorkerRequest, { kind: "reset" }>,
      "kind" | "requestId"
    >,
  ) {
    const message = await this.request("reset", "reset", input);
    return (message as Extract<DocumentSyncWorkerResponse, { kind: "reset" }>)
      .status;
  }

  async normalize(
    input: Omit<
      Extract<DocumentSyncWorkerRequest, { kind: "normalize" }>,
      "kind" | "requestId"
    >,
  ) {
    const message = await this.request("normalize", "normalized", input);
    return (
      message as Extract<DocumentSyncWorkerResponse, { kind: "normalized" }>
    ).result;
  }

  async restoreBinding(
    input: Omit<
      Extract<DocumentSyncWorkerRequest, { kind: "restoreBinding" }>,
      "kind" | "requestId"
    >,
  ) {
    const message = await this.request(
      "restoreBinding",
      "bindingRestored",
      input,
    );
    return (
      message as Extract<
        DocumentSyncWorkerResponse,
        { kind: "bindingRestored" }
      >
    ).record;
  }

  async bindFileHandle(
    input: Omit<
      Extract<DocumentSyncWorkerRequest, { kind: "bindFileHandle" }>,
      "kind" | "requestId"
    >,
  ) {
    const message = await this.request(
      "bindFileHandle",
      "fileHandleBound",
      input,
    );
    return (
      message as Extract<
        DocumentSyncWorkerResponse,
        { kind: "fileHandleBound" }
      >
    ).metadata;
  }

  async getWriteStatus(
    input: Omit<
      Extract<DocumentSyncWorkerRequest, { kind: "getWriteStatus" }>,
      "kind" | "requestId"
    >,
  ) {
    const message = await this.request("getWriteStatus", "writeStatus", input);
    return (
      message as Extract<DocumentSyncWorkerResponse, { kind: "writeStatus" }>
    ).status;
  }

  async getDurableHistoryAvailability(
    input: Omit<
      Extract<
        DocumentSyncWorkerRequest,
        { kind: "getDurableHistoryAvailability" }
      >,
      "kind" | "requestId"
    >,
  ) {
    const message = await this.request(
      "getDurableHistoryAvailability",
      "durableHistoryAvailability",
      input,
    );
    return (
      message as Extract<
        DocumentSyncWorkerResponse,
        { kind: "durableHistoryAvailability" }
      >
    ).availability;
  }

  async undoDurableHistory(
    input: Omit<
      Extract<DocumentSyncWorkerRequest, { kind: "undoDurableHistory" }>,
      "kind" | "requestId"
    >,
  ) {
    const message = await this.request(
      "undoDurableHistory",
      "durableHistoryMutated",
      input,
    );
    return (
      message as Extract<
        DocumentSyncWorkerResponse,
        { kind: "durableHistoryMutated" }
      >
    ).result;
  }

  async redoDurableHistory(
    input: Omit<
      Extract<DocumentSyncWorkerRequest, { kind: "redoDurableHistory" }>,
      "kind" | "requestId"
    >,
  ) {
    const message = await this.request(
      "redoDurableHistory",
      "durableHistoryMutated",
      input,
    );
    return (
      message as Extract<
        DocumentSyncWorkerResponse,
        { kind: "durableHistoryMutated" }
      >
    ).result;
  }

  async getSketchDraftHistory(
    input: Omit<
      Extract<DocumentSyncWorkerRequest, { kind: "getSketchDraftHistory" }>,
      "kind" | "requestId"
    >,
  ) {
    const message = await this.request(
      "getSketchDraftHistory",
      "sketchDraftHistory",
      input,
    );
    return {
      session: (
        message as Extract<
          DocumentSyncWorkerResponse,
          { kind: "sketchDraftHistory" }
        >
      ).session,
      availability: (
        message as Extract<
          DocumentSyncWorkerResponse,
          { kind: "sketchDraftHistory" }
        >
      ).availability,
    };
  }

  async saveSketchDraftHistory(
    input: Omit<
      Extract<DocumentSyncWorkerRequest, { kind: "saveSketchDraftHistory" }>,
      "kind" | "requestId"
    >,
  ) {
    const message = await this.request(
      "saveSketchDraftHistory",
      "sketchDraftHistorySaved",
      input,
    );
    return (
      message as Extract<
        DocumentSyncWorkerResponse,
        { kind: "sketchDraftHistorySaved" }
      >
    ).availability;
  }

  async undoSketchDraftHistory(
    input: Omit<
      Extract<DocumentSyncWorkerRequest, { kind: "undoSketchDraftHistory" }>,
      "kind" | "requestId"
    >,
  ) {
    const message = await this.request(
      "undoSketchDraftHistory",
      "sketchDraftHistory",
      input,
    );
    return {
      session: (
        message as Extract<
          DocumentSyncWorkerResponse,
          { kind: "sketchDraftHistory" }
        >
      ).session,
      availability: (
        message as Extract<
          DocumentSyncWorkerResponse,
          { kind: "sketchDraftHistory" }
        >
      ).availability,
    };
  }

  async redoSketchDraftHistory(
    input: Omit<
      Extract<DocumentSyncWorkerRequest, { kind: "redoSketchDraftHistory" }>,
      "kind" | "requestId"
    >,
  ) {
    const message = await this.request(
      "redoSketchDraftHistory",
      "sketchDraftHistory",
      input,
    );
    return {
      session: (
        message as Extract<
          DocumentSyncWorkerResponse,
          { kind: "sketchDraftHistory" }
        >
      ).session,
      availability: (
        message as Extract<
          DocumentSyncWorkerResponse,
          { kind: "sketchDraftHistory" }
        >
      ).availability,
    };
  }

  async clearSketchDraftHistory(
    input: Omit<
      Extract<DocumentSyncWorkerRequest, { kind: "clearSketchDraftHistory" }>,
      "kind" | "requestId"
    >,
  ) {
    await this.request(
      "clearSketchDraftHistory",
      "sketchDraftHistoryCleared",
      input,
    );
    return undefined;
  }

  async subscribe(
    documentId: Extract<
      DocumentSyncWorkerRequest,
      { kind: "subscribe" }
    >["documentId"],
    listener: (
      event: Extract<
        DocumentSyncWorkerResponse,
        { kind: "documentChanged" }
      >["event"],
    ) => void,
  ) {
    const subscriptionId = this.createSubscriptionId();
    this.documentListeners.set(subscriptionId, listener);
    try {
      await this.request("subscribe", "subscribed", {
        documentId,
        subscriptionId,
      });
    } catch (error: unknown) {
      this.documentListeners.delete(subscriptionId);
      throw error;
    }

    return () => {
      this.documentListeners.delete(subscriptionId);
      if (!this.disposed) {
        void this.request("unsubscribe", "unsubscribed", {
          subscriptionId,
        }).catch(() => undefined);
      }
    };
  }

  subscribeToWriteStatus(listener: (status: DocumentSyncWriteStatus) => void) {
    this.writeStatusListeners.add(listener);
    return () => {
      this.writeStatusListeners.delete(listener);
    };
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.worker.removeEventListener("message", this.handleMessage);
    for (const [requestId, pending] of this.pendingRequests) {
      pending.reject(new Error("Document sync worker client disposed."));
      this.pendingRequests.delete(requestId);
    }
    this.documentListeners.clear();
    this.writeStatusListeners.clear();
    this.worker.terminate?.();
  }

  // TODO: This feels wrong - custom dispatcher if/else per kind which is split across functions
  private request<TKind extends DocumentSyncWorkerRequest["kind"]>(
    kind: TKind,
    expectedKind: DocumentSyncWorkerResponse["kind"],
    input: Omit<
      Extract<DocumentSyncWorkerRequest, { kind: TKind }>,
      "kind" | "requestId"
    >,
  ) {
    if (this.disposed) {
      return Promise.reject(new Error("Document sync worker client disposed."));
    }

    const requestId = this.createRequestId();
    const request = { ...input, kind, requestId } as Extract<
      DocumentSyncWorkerRequest,
      { kind: TKind }
    >;

    return new Promise<DocumentSyncWorkerResponse>((resolve, reject) => {
      this.pendingRequests.set(requestId, { expectedKind, resolve, reject });
      this.worker.postMessage(request);
    });
  }

  private receiveMessage(message: DocumentSyncWorkerResponse) {
    if (message.kind === "documentChanged") {
      this.documentListeners.get(message.subscriptionId)?.(message.event);
      return;
    }

    if (message.kind === "writeStatusChanged") {
      this.acceptWriteStatus(message.status);
      return;
    }

    const pending = this.pendingRequests.get(message.requestId);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(message.requestId);
    if (message.kind === "failure") {
      pending.reject(new Error(message.error.message));
      return;
    }

    if (message.kind !== pending.expectedKind) {
      pending.reject(
        new Error(`Unexpected document sync worker response ${message.kind}.`),
      );
      return;
    }

    if (message.kind === "writeStatus") {
      this.acceptWriteStatus(message.status);
    }

    pending.resolve(message);
  }

  private acceptWriteStatus(status: DocumentSyncWriteStatus) {
    const previousSequence =
      this.latestWriteStatusSequences.get(status.documentId) ?? -1;
    if (status.sequence <= previousSequence) {
      return;
    }

    this.latestWriteStatusSequences.set(status.documentId, status.sequence);
    for (const listener of this.writeStatusListeners) {
      listener(status);
    }
  }

  private createRequestId() {
    this.nextRequestSequence += 1;
    return `request_document_sync_${this.nextRequestSequence}` as RequestId;
  }

  private createSubscriptionId() {
    this.nextSubscriptionSequence += 1;
    return `subscription_document_sync_${this.nextSubscriptionSequence}` as DocumentSyncSubscriptionId;
  }
}
