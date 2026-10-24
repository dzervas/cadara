import typia from "typia";
import type { LoadingProgress } from "@/contracts/modeling/loading-status";
import type { RequestId } from "@/contracts/shared/ids";

/**
 * One per feature evaluated by a restoreAuthoredModelDocument request
 * (cadara-ku5k). Kept apart from worker-protocol.ts so the main thread bundles
 * only this validator, not the worker's request validator.
 */
export interface OccWorkerRestoreProgressMessage {
  kind: "restoreProgress";
  requestId: RequestId;
  progress: LoadingProgress;
}

const occWorkerRestoreProgressMessageValidator =
  typia.createValidateEquals<OccWorkerRestoreProgressMessage>();

export function validateOccWorkerRestoreProgressMessage(value: unknown) {
  return occWorkerRestoreProgressMessageValidator(value);
}
