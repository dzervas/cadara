import { createAppError, type ErrorReporter } from "@/contracts/errors";
import type { ProjectResult } from "@/contracts/modeling/project-manifest";
import type {
  LocalSaveFailure,
  LocalSaveStatus,
} from "@/application/modeling/modeling-service";

export interface LocalSaveStatusSource {
  getLocalSaveStatus(): LocalSaveStatus;
  subscribeToLocalSaveStatus(listener: () => void): () => void;
}

export interface LocalSaveGuardSource extends LocalSaveStatusSource {
  /** Every failure to report, of any tab; each keeps its identity. */
  getLocalSaveFailures(): readonly LocalSaveFailure[];
}

/** Manifest writes and their unsaved failures share the part guard without a fake document failure. */
export class PendingLocalWrites {
  private count = 0;
  private readonly failures = new Map<string, string>();
  private readonly listeners = new Set<() => void>();

  getPendingWriteCount() {
    return this.count;
  }
  getFailure() {
    return this.failures.values().next().value ?? null;
  }
  async persist<T>(projectId: string, write: () => Promise<ProjectResult<T>>) {
    const finish = this.begin();
    try {
      const result = await write();
      if (result.ok) this.failures.delete(projectId);
      else this.failures.set(projectId, result.diagnostic.message);
      return result;
    } catch (error) {
      this.failures.set(
        projectId,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    } finally {
      finish();
    }
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  begin() {
    this.count++;
    for (const listener of this.listeners) listener();
    return () => {
      this.count--;
      for (const listener of this.listeners) listener();
    };
  }
}

export interface LeaveAttemptEvent {
  preventDefault(): void;
  returnValue: unknown;
}

/** The page (`window`); a fake in tests. */
export interface LeaveGuardTarget {
  addEventListener(
    type: "beforeunload",
    listener: (event: LeaveAttemptEvent) => void,
  ): void;
  removeEventListener(
    type: "beforeunload",
    listener: (event: LeaveAttemptEvent) => void,
  ): void;
}

/** What the workbench tells the user about local saving. */
export type LocalSaveNotice =
  | { kind: "none" }
  /** The user stayed on the page while a change was still being saved. */
  | { kind: "saving-after-leave-attempt" }
  /** An accepted change exists in memory only. */
  | { kind: "unsaved"; failure: LocalSaveFailure; leaveBlocked: boolean }
  | { kind: "unsaved-project"; message: string; leaveBlocked: boolean };

const NO_NOTICE: LocalSaveNotice = { kind: "none" };

/**
 * cadara-8p7o: while a local change is saving, or exists in memory only, a
 * page leave asks first through the browser's native dialog. The listener is
 * registered only then: an always-on beforeunload listener disables bfcache.
 * Every save failure of every tab is reported once; the notice shows the
 * combined status's failure.
 */
export class LocalSaveGuard {
  private readonly source: LocalSaveGuardSource;
  private readonly reporter: ErrorReporter;
  private readonly pendingWrites?: PendingLocalWrites;
  private readonly target: LeaveGuardTarget;
  private readonly noticeListeners = new Set<() => void>();
  private notice: LocalSaveNotice = NO_NOTICE;
  private listening = false;
  private leaveBlocked = false;
  private readonly reportedFailures = new Set<LocalSaveFailure>();
  private dismissedFailure: LocalSaveFailure | null = null;

  constructor(input: {
    source: LocalSaveGuardSource;
    pendingWrites?: PendingLocalWrites;
    reporter: ErrorReporter;
    target: LeaveGuardTarget;
  }) {
    this.source = input.source;
    this.pendingWrites = input.pendingWrites;
    this.reporter = input.reporter;
    this.target = input.target;
  }

  /** Follows the status until the returned stop is called. */
  start(): () => void {
    const unsubscribe = this.source.subscribeToLocalSaveStatus(() =>
      this.update(),
    );
    const unsubscribePending = this.pendingWrites?.subscribe(() =>
      this.update(),
    );
    this.update();
    return () => {
      unsubscribe();
      unsubscribePending?.();
      this.setListening(false);
    };
  }

  getNotice(): LocalSaveNotice {
    return this.notice;
  }

  subscribeToNotice(listener: () => void): () => void {
    this.noticeListeners.add(listener);
    return () => {
      this.noticeListeners.delete(listener);
    };
  }

  dismissUnsavedNotice() {
    this.dismissedFailure = this.source.getLocalSaveStatus().failure;
    this.update();
  }

  private readonly handleLeaveAttempt = (event: LeaveAttemptEvent) => {
    event.preventDefault();
    // Older Chromium shows the dialog only for a set returnValue.
    event.returnValue = true;
    // If the page is still alive afterwards, the user chose to stay.
    this.leaveBlocked = true;
    this.dismissedFailure = null;
    this.update();
  };

  private update() {
    const status = this.source.getLocalSaveStatus();
    const saving =
      status.saving || (this.pendingWrites?.getPendingWriteCount() ?? 0) > 0;
    const failure = status.failure;
    const unsaved = failure?.target === "repository" ? failure : null;
    const projectFailure = this.pendingWrites?.getFailure() ?? null;
    this.setListening(saving || unsaved !== null || projectFailure !== null);
    if (!saving && unsaved === null && projectFailure === null)
      this.leaveBlocked = false;
    for (const entry of this.source.getLocalSaveFailures()) {
      if (this.reportedFailures.has(entry)) continue;
      this.reportedFailures.add(entry);
      this.report(entry);
    }

    const next: LocalSaveNotice =
      unsaved && unsaved !== this.dismissedFailure
        ? { kind: "unsaved", failure: unsaved, leaveBlocked: this.leaveBlocked }
        : projectFailure !== null
          ? {
              kind: "unsaved-project",
              message: projectFailure,
              leaveBlocked: this.leaveBlocked,
            }
          : saving && this.leaveBlocked
            ? { kind: "saving-after-leave-attempt" }
            : NO_NOTICE;
    if (isSameNotice(next, this.notice)) return;
    this.notice = next;
    for (const listener of this.noticeListeners) listener();
  }

  private setListening(listening: boolean) {
    if (listening === this.listening) return;
    this.listening = listening;
    if (listening) {
      this.target.addEventListener("beforeunload", this.handleLeaveAttempt);
    } else {
      this.target.removeEventListener("beforeunload", this.handleLeaveAttempt);
    }
  }

  private report(failure: LocalSaveFailure) {
    this.reporter.report(
      createAppError({
        code: "persistence/background-write-failed",
        message:
          failure.target === "repository"
            ? "A local change could not be saved."
            : "A linked local file could not be written.",
        context: [
          { key: "documentId", value: failure.documentId },
          { key: "target", value: failure.target },
          { key: "reasonCode", value: failure.reasonCode },
          { key: "diagnosticMessage", value: failure.message },
          { key: "leaveBlocked", value: this.leaveBlocked },
        ],
      }),
      {
        source: "document.persistence",
        visibility: "user",
        // Decision (cadara-8p7o): no document content in this event.
        attachActiveDocumentPayload: false,
        dedupeKey: [
          "document.persistence",
          failure.documentId,
          failure.target,
          failure.reasonCode,
          failure.message,
        ].join(":"),
      },
    );
  }
}

function isSameNotice(a: LocalSaveNotice, b: LocalSaveNotice) {
  if (a.kind !== b.kind) return false;
  if (a.kind === "unsaved-project" && b.kind === "unsaved-project")
    return a.message === b.message && a.leaveBlocked === b.leaveBlocked;
  if (a.kind !== "unsaved" || b.kind !== "unsaved") return true;
  return a.failure === b.failure && a.leaveBlocked === b.leaveBlocked;
}
