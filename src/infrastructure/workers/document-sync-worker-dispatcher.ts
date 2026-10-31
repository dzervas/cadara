import type { DocumentSyncWorkerInbound } from "@/infrastructure/workers/project-sync-worker-protocol";

export type DocumentSyncWorkerBootstrapMessage = {
  kind: "bootstrap";
  search: string;
};

type DocumentSyncWorkerIncomingMessage =
  | DocumentSyncWorkerBootstrapMessage
  | DocumentSyncWorkerInbound;

type DocumentSyncWorkerMessageHandler = (
  request: DocumentSyncWorkerInbound,
) => Promise<void> | void;

export function createDocumentSyncWorkerDispatcher(
  createWorkerMessageHandler: (
    search: string,
  ) => DocumentSyncWorkerMessageHandler,
) {
  let handleMessage: DocumentSyncWorkerMessageHandler | null = null;
  const pendingRequests: DocumentSyncWorkerInbound[] = [];

  return function dispatchDocumentSyncWorkerMessage(
    message: DocumentSyncWorkerIncomingMessage,
  ) {
    if (isDocumentSyncWorkerBootstrapMessage(message)) {
      handleMessage = createWorkerMessageHandler(message.search);
      for (const pendingRequest of pendingRequests.splice(0)) {
        void handleMessage(pendingRequest);
      }
      return;
    }

    if (!handleMessage) {
      pendingRequests.push(message);
      return;
    }

    void handleMessage(message);
  };
}

export function isDocumentSyncWorkerBootstrapMessage(
  message: DocumentSyncWorkerIncomingMessage,
): message is DocumentSyncWorkerBootstrapMessage {
  return message.kind === "bootstrap";
}
