import type { ModelingDiagnostic } from "@/contracts/modeling/schema";
import type {
  SemanticCommand,
  SemanticResult,
  SemanticState,
} from "@/contracts/semantic/schema";
import type {
  SemanticCloseResult,
  SemanticSession,
  SemanticSessionFactory,
} from "./ports";
import type { SemanticDocumentPort } from "./document-port";

export function semanticDiagnostic(error: unknown): ModelingDiagnostic {
  return {
    code: "semantic-execution-failed",
    severity: "error",
    message: error instanceof Error ? error.message : String(error),
    target: null,
    detail: null,
  };
}
function result(
  command: SemanticCommand,
  state: SemanticState | null,
): SemanticResult {
  return {
    version: 1,
    correlation: {
      commandId: command.commandId,
      family: "document",
      intent: command.operation === "document.inspect" ? "inspect" : "fulfill",
      basis: command.basis
        ? {
            documentId: command.basis.documentId,
            revisionId: command.basis.revisionId,
            repositoryHeads: command.basis.repositoryHeads,
          }
        : null,
    },
    outcome: { kind: "completed", change: "unchanged" },
    completion: {
      live: { kind: "unchanged", state },
      handoff: { kind: "not-required" },
      geometry: { kind: "not-required" },
      persistence: { kind: "not-required" },
      file: { kind: "not-required" },
    },
    diagnostics: [],
    discovery: null,
  };
}
function sameBasis(a: SemanticState, b: NonNullable<SemanticCommand["basis"]>) {
  return (
    a.documentId === b.documentId &&
    a.revisionId === b.revisionId &&
    [...a.repositoryHeads].sort().join("\0") ===
      [...b.repositoryHeads].sort().join("\0")
  );
}

export function createSemanticSessionFactory(
  acquire: () => Promise<SemanticDocumentPort>,
): SemanticSessionFactory {
  return {
    async open(options) {
      let owner: SemanticDocumentPort | null = null;
      try {
        if (options?.signal?.aborted)
          return {
            kind: "canceled",
            diagnostics: [],
            cleanup: { kind: "closed", settled: [], resourcesReleased: true },
          };
        owner = await acquire();
        const initialized = await owner.initialize();
        if (initialized.kind === "failed" || options?.signal?.aborted) {
          const cleanup = await closeOwner(owner);
          return {
            kind: options?.signal?.aborted ? "canceled" : "failed",
            diagnostics:
              initialized.kind === "failed" ? initialized.diagnostics : [],
            cleanup,
          };
        }
        const session = new DocumentSession(owner, initialized.discovery.state);
        return {
          kind: "ready",
          session,
          initialization: {
            kind: "initialized",
            state: initialized.discovery.state,
          },
        };
      } catch (error) {
        return {
          kind: "failed",
          diagnostics: [semanticDiagnostic(error)],
          cleanup: owner
            ? await closeOwner(owner)
            : { kind: "closed", settled: [], resourcesReleased: true },
        };
      }
    },
  };
}
async function closeOwner(
  owner: SemanticDocumentPort,
  settled: readonly SemanticResult[] = [],
): Promise<SemanticCloseResult> {
  const failures: ("flush" | "release")[] = [];
  const diagnostics: ModelingDiagnostic[] = [];
  try {
    await owner.drain();
  } catch (error) {
    failures.push("flush");
    diagnostics.push(semanticDiagnostic(error));
  }
  let resourcesReleased = false;
  try {
    await owner.release();
    resourcesReleased = true;
  } catch (error) {
    failures.push("release");
    diagnostics.push(semanticDiagnostic(error));
  }
  return failures.length
    ? { kind: "failed", settled, resourcesReleased, failures, diagnostics }
    : { kind: "closed", settled, resourcesReleased: true };
}
class DocumentSession implements SemanticSession {
  private closing = false;
  private closePromise: Promise<SemanticCloseResult> | null = null;
  private tail: Promise<void> = Promise.resolve();
  private readonly outstanding = new Set<Promise<SemanticResult>>();
  private readonly ids = new Set<string>();
  private readonly owner: SemanticDocumentPort;
  private state: SemanticState;
  constructor(owner: SemanticDocumentPort, state: SemanticState) {
    this.owner = owner;
    this.state = state;
  }
  execute(
    command: SemanticCommand,
    options?: { signal?: AbortSignal },
  ): Promise<SemanticResult> {
    const empty = result(command, this.state);
    if (this.closing)
      return Promise.resolve({
        ...empty,
        outcome: { kind: "unavailable", capability: "session.closed" },
      });
    if (this.ids.has(command.commandId))
      return Promise.resolve({
        ...empty,
        outcome: { kind: "rejected", reasonCode: "duplicate-command-id" },
      });
    this.ids.add(command.commandId);
    const task = this.tail.then(async () => {
      if (this.closing || options?.signal?.aborted)
        return {
          ...result(command, this.state),
          outcome: { kind: "canceled", phase: "not-started" },
        } satisfies SemanticResult;
      return this.run(command);
    });
    this.outstanding.add(task);
    this.tail = task.then(
      () => {
        this.outstanding.delete(task);
      },
      () => {
        this.outstanding.delete(task);
      },
    );
    return task;
  }
  private async run(command: SemanticCommand): Promise<SemanticResult> {
    const terminal = result(command, this.state);
    if (command.basis && !sameBasis(this.state, command.basis))
      return {
        ...terminal,
        outcome: {
          kind: "conflicted",
          actualBasis: {
            documentId: this.state.documentId,
            revisionId: this.state.revisionId,
            repositoryHeads: this.state.repositoryHeads,
          },
        },
      };
    try {
      if (command.operation === "document.create") {
        const accepted = await this.owner.create({
          commandId: command.commandId,
          label: command.label,
        });
        terminal.diagnostics = accepted.diagnostics;
        terminal.completion.persistence = accepted.persistence;
        if (accepted.state) {
          this.state = accepted.state;
          terminal.completion.live = { kind: "applied", state: accepted.state };
        } else {
          terminal.outcome = {
            kind: "failed",
            failures: [accepted.failure ?? "persistence"],
          };
          return terminal;
        }
        const failures = [
          ...(accepted.persistence.kind === "failed"
            ? ["persistence" as const]
            : []),
          ...(accepted.failure ? [accepted.failure] : []),
        ];
        terminal.outcome = failures.length
          ? { kind: "failed", failures }
          : { kind: "completed", change: "changed" };
      }
      try {
        const current = await this.owner.inspect({
          commandId: command.commandId,
        });
        if (
          terminal.completion.live.kind === "applied" &&
          !sameBasis(current.discovery.state, terminal.completion.live.state)
        ) {
          throw new Error(
            "Snapshot handoff does not match the accepted transaction.",
          );
        }
        this.state = current.discovery.state;
        terminal.completion.handoff = { kind: "current", state: this.state };
        if (terminal.completion.live.kind === "unchanged")
          terminal.completion.live.state = this.state;
        terminal.discovery = current.discovery;
        terminal.diagnostics = [
          ...terminal.diagnostics,
          ...current.diagnostics,
        ];
      } catch (error) {
        terminal.completion.handoff = { kind: "failed" };
        terminal.outcome = {
          kind: "failed",
          failures: [
            ...(terminal.outcome.kind === "failed"
              ? terminal.outcome.failures
              : []),
            "handoff",
          ],
        };
        terminal.diagnostics = [
          ...terminal.diagnostics,
          semanticDiagnostic(error),
        ];
      }
      return terminal;
    } catch (error) {
      return {
        ...terminal,
        outcome: { kind: "failed", failures: ["execution"] },
        diagnostics: [...terminal.diagnostics, semanticDiagnostic(error)],
      };
    }
  }
  close(): Promise<SemanticCloseResult> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    const pending = [...this.outstanding];
    this.closePromise = Promise.all(pending).then((settled) =>
      closeOwner(this.owner, settled),
    );
    return this.closePromise;
  }
}
