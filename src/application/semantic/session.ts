import { semanticCommandCorrelation } from "@/contracts/semantic/correlation";
import { semanticResultIssues } from "@/contracts/semantic/validation";
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
export function createSemanticResult(
  command: SemanticCommand,
  state: SemanticState | null,
): SemanticResult {
  return {
    version: 1,
    correlation: semanticCommandCorrelation(command),
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
    const empty = createSemanticResult(command, this.state);
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
          ...createSemanticResult(command, this.state),
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
    const terminal = createSemanticResult(command, this.state);
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
      if (command.operation.startsWith("timeline.") || command.operation === "target.delete" || command.operation === "body.rename" || command.operation.startsWith("feature.") || command.operation.startsWith("variable.") || command.operation.startsWith("sketch.") || command.operation.startsWith("extrude.") || command.operation.startsWith("revolve.") || command.operation.startsWith("plane.") || command.operation.startsWith("fillet.") || command.operation.startsWith("chamfer.") || command.operation.startsWith("shell.") || command.operation.startsWith("thicken.") || command.operation.startsWith("hole.") || command.operation.startsWith("sweep.") || command.operation.startsWith("history.") || command.operation.startsWith("export.")) {
        const execute = command.operation.startsWith("timeline.") || command.operation === "target.delete" || command.operation === "body.rename" || command.operation.startsWith("feature.")
          ? this.owner.featureLifecycle?.bind(this.owner)
          : command.operation.startsWith("variable.")
          ? this.owner.variable?.bind(this.owner)
          : command.operation.startsWith("sketch.")
          ? this.owner.sketch?.bind(this.owner)
          : command.operation.startsWith("history.")
            ? this.owner.history?.bind(this.owner)
            : command.operation.startsWith("export.")
              ? this.owner.export?.bind(this.owner)
              : command.operation.startsWith("sweep.")
                ? this.owner.sweep?.bind(this.owner)
              : command.operation.startsWith("hole.")
                ? this.owner.hole?.bind(this.owner)
              : command.operation.startsWith("shell.") || command.operation.startsWith("thicken.")
                ? this.owner.shellThicken?.bind(this.owner)
              : command.operation.startsWith("fillet.") || command.operation.startsWith("chamfer.")
                 ? this.owner.edgeTreatment?.bind(this.owner)
               : command.operation.startsWith("plane.")
                ? this.owner.plane?.bind(this.owner)
              : command.operation.startsWith("revolve.")
                ? this.owner.revolve?.bind(this.owner)
                : this.owner.extrude?.bind(this.owner);
        if (!execute)
          return {
            ...terminal,
            outcome: { kind: "unavailable", capability: command.operation },
          };
        const executed = await (execute as (input: SemanticCommand) => Promise<SemanticResult>)(command);
        if (executed.completion.live.state)
          this.state = executed.completion.live.state;
        const issues = semanticResultIssues(terminal.correlation, executed);
        if (issues.length)
          return {
            ...executed,
            outcome: {
              kind: "failed",
              failures: [
                "execution",
                "handoff",
                ...(executed.completion.geometry.kind !== "not-required"
                  ? ["geometry" as const]
                  : []),
                ...(executed.completion.persistence.kind === "failed"
                  ? ["persistence" as const]
                  : []),
              ],
            },
            completion: {
              ...executed.completion,
              handoff: { kind: "failed" },
              geometry:
                executed.completion.geometry.kind === "not-required"
                  ? executed.completion.geometry
                  : { ...executed.completion.geometry, kind: "failed" },
            },
            discovery: null,
            diagnostics: [
              ...executed.diagnostics,
              ...issues.map((issue) =>
                semanticDiagnostic(new Error(issue.message)),
              ),
            ],
          };
        return executed;
      }
      if (
        ["document.open", "document.rename", "document.save"].includes(
          command.operation,
        ) &&
        !this.owner.nativeFiles
      ) {
        return {
          ...terminal,
          outcome: { kind: "unavailable", capability: "document.native-files" },
        };
      }
      if (
        command.operation === "document.create" ||
        command.operation === "document.open" ||
        command.operation === "document.rename"
      ) {
        const accepted =
          command.operation === "document.create"
            ? await this.owner.create({
                commandId: command.commandId,
                label: command.label,
              })
            : command.operation === "document.open"
              ? await this.owner.nativeFiles!.open({
                  commandId: command.commandId,
                  path: command.path,
                  currentState: this.state,
                })
              : await this.owner.nativeFiles!.rename({
                  commandId: command.commandId,
                  label: command.label,
                  currentState: this.state,
                });
        terminal.diagnostics = accepted.diagnostics;
        terminal.completion.persistence = accepted.persistence;
        if (accepted.state) {
          this.state = accepted.state;
          terminal.completion.live = { kind: "applied", state: accepted.state };
        } else if ("rejected" in accepted && accepted.rejected) {
          terminal.outcome = {
            kind: "rejected",
            reasonCode: accepted.rejected,
          };
          return terminal;
        } else if (
          accepted.failure ||
          command.operation !== "document.rename"
        ) {
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
          : {
              kind: "completed",
              change: accepted.state ? "changed" : "unchanged",
            };
      }
      if (command.operation === "document.save") {
        const saved = await this.owner.nativeFiles!.save({
          commandId: command.commandId,
          path: command.path,
          state: this.state,
        });
        terminal.completion.file = saved.file;
        terminal.completion.persistence = saved.persistence;
        terminal.diagnostics = saved.diagnostics;
        const failures = [
          ...(saved.persistence.kind === "failed"
            ? ["persistence" as const]
            : []),
          ...(saved.file.kind === "failed" ? ["file" as const] : []),
          ...(saved.failure ? [saved.failure] : []),
        ];
        if (failures.length) terminal.outcome = { kind: "failed", failures };
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
        if (
          command.operation === "document.open" &&
          terminal.completion.live.kind === "applied"
        ) {
          const invalid = current.diagnostics.some(
            (diagnostic) => diagnostic.severity === "error",
          );
          terminal.completion.geometry = {
            kind: invalid ? "failed" : "current",
            state: this.state,
            sketchBasis: null,
            solve: null,
            derivation: null,
            rebuildRevisionId: this.state.revisionId,
          };
          if (invalid)
            terminal.outcome = {
              kind: "failed",
              failures: [
                ...(terminal.outcome.kind === "failed"
                  ? terminal.outcome.failures
                  : []),
                "geometry",
              ],
            };
        }
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
