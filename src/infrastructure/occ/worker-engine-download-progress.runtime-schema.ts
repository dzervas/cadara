import typia from "typia";

/**
 * Decoded kernel wasm bytes received during worker startup (cadara-5hlf).
 * Worker-global, so it carries no requestId; kept apart from
 * worker-protocol.ts like the restore progress validator.
 */
export interface OccWorkerEngineDownloadProgressMessage {
  kind: "engineDownloadProgress";
  completedBytes: number;
  totalBytes: number;
}

const occWorkerEngineDownloadProgressMessageValidator =
  typia.createValidateEquals<OccWorkerEngineDownloadProgressMessage>();

export function validateOccWorkerEngineDownloadProgressMessage(value: unknown) {
  return occWorkerEngineDownloadProgressMessageValidator(value);
}
