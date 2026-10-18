import type { SemanticCommand, SemanticDiscovery, SemanticBasis } from "@/contracts/semantic/schema";
import type { SelectableCommand } from "./target-inputs";
import type { RecipeTrace } from "./sdk-types";
import { sameTarget } from "./sdk-queries";
import { resolveSemanticCommand } from "./target-resolution";
import { SelectionError } from "./selection-error";
import { validateSemanticCommand } from "@/contracts/semantic/runtime-schema";
import { validateDurableRef } from "@/contracts/shared/references.runtime-schema";

export class SemanticTraceError extends Error {
  readonly commandId: string;
  readonly operation: SemanticCommand["operation"];
  readonly reference: unknown;
  constructor(command: SemanticCommand, reference: unknown, reason: string) {
    super(`Cannot export trace step ${command.commandId} (${command.operation}): ${reason}: ${JSON.stringify(reference)}`);
    this.name = "SemanticTraceError";
    this.commandId = command.commandId;
    this.operation = command.operation;
    this.reference = reference;
  }
}

class UnportableReference extends Error {
  readonly reference: unknown;
  constructor(reference: unknown) { super("Reference is not uniquely label-selectable"); this.reference = reference; }
}

function authority(state: SemanticBasis) {
  const { documentId, revisionId, repositoryHeads } = state;
  return { documentId, revisionId, repositoryHeads: [...repositoryHeads].sort() };
}

/** Recipe encoding only. Selection/execution still belongs to the shared resolver/session. */
export class SemanticTrace {
  private readonly operations: (SelectableCommand & { as: string })[] = [];
  private readonly snapshots = new Map<string, SemanticDiscovery>();
  private readonly commands: SemanticCommand[] = [];
  private readonly errors: SemanticTraceError[] = [];
  private readonly origins = new WeakMap<object, unknown>();

  executed(): readonly SemanticCommand[] { return structuredClone(this.commands); }

  record(command: SemanticCommand): string {
    const alias = `trace${this.operations.length + 1}`;
    this.commands.push(structuredClone(command));
    let encoded: SelectableCommand = command;
    try {
      encoded = this.encode(command) as SelectableCommand;
      const replay = resolveSemanticCommand(encoded, { aliases: this.snapshots });
      const checked = validateSemanticCommand(replay);
      if (!checked.success) throw new UnportableReference({ command, issues: checked.issues });
    } catch (error) {
      if (error instanceof UnportableReference) this.errors.push(new SemanticTraceError(command, error.reference, error.message));
      else if (error instanceof SelectionError) {
        const selector = error.selection.selector;
        const reference = selector && typeof selector === "object" ? this.origins.get(selector) ?? selector : selector;
        this.errors.push(new SemanticTraceError(command, reference, error.message));
      }
      else throw error;
    }
    this.operations.push({ ...encoded, as: alias });
    return alias;
  }
  publish(alias: string, discovery: SemanticDiscovery | null) {
    if (discovery) this.snapshots.set(alias, discovery);
  }
  encode(input: unknown): unknown {
    const snapshots = [...this.snapshots].reverse();
    const selector = (label: string, alias: string, sketchId: string | undefined, source: unknown) => {
      const owner = sketchId && snapshots.find(([, d]) => d.sketch?.sketchId === sketchId);
      const selector = { alias, label, ...(owner ? { sketch: owner[0] } : {}) };
      this.origins.set(selector, source);
      return selector;
    };
    const visit = (value: unknown, key = ""): unknown => {
      if (value === null || value === undefined) return value;
      if (key === "basis" && typeof value === "object") {
        const match = snapshots.find(([, d]) => sameTarget(authority(d.state), authority(value as SemanticBasis)));
        return match ? { alias: match[0] } : value;
      }
      if (key === "draft" && typeof value === "object") {
        const match = snapshots.find(([, d]) => sameTarget(d.state.draft, value));
        return match ? { alias: match[0] } : value;
      }
      if (typeof value === "object" && !Array.isArray(value) && "kind" in value) {
        if (value.kind === "sketchTangentHandle") throw new UnportableReference(value);
        for (const [alias, d] of snapshots) {
          const ref = d.references.find((r) => sameTarget(r.target, value));
          if (ref) return selector(ref.label, alias, ref.owner?.kind === "sketch" ? ref.owner.sketchId : undefined, value);
          const operand = d.sketch?.operands.find((r) => sameTarget(r.target, value));
          if (operand) return selector(operand.label, alias, d.sketch?.sketchId ?? undefined, value);
        }
        if (validateDurableRef(value).success) throw new UnportableReference(value);
      }
      if (typeof value === "string" && (/Ids?$/.test(key) || key === "points" || key === "derivationId")) {
        for (const [alias, d] of snapshots) {
          const ref = d.references.find((r) => Object.entries(r.target).some(([field, id]) => /Id$/.test(field) && field !== "sketchId" && field !== "bodyId" && id === value) ||
            (r.target.kind === "sketch" && r.target.sketchId === value) || (r.target.kind === "body" && r.target.bodyId === value));
          if (ref) return selector(ref.label, alias, ref.owner?.kind === "sketch" ? ref.owner.sketchId : undefined, value);
          const variable = d.variables?.find((v) => v.variableId === value);
          if (variable) return selector(variable.name, alias, undefined, value);
          const derivation = [...(d.sketch?.mirrors ?? []), ...(d.sketch?.offsets ?? [])].find((v) => v.derivationId === value);
          if (derivation) return selector(derivation.label, alias, d.sketch?.sketchId ?? undefined, value);
        }
      }
      if (Array.isArray(value)) return value.map((v) => visit(v, key));
      if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, visit(v, k)]));
      return value;
    };
    return visit(input);
  }
  recipe(): RecipeTrace {
    if (this.errors.length) throw this.errors[0];
    const first = this.operations[0]?.operation;
    if (first !== "document.create" && first !== "document.open")
      throw new Error("Replayable traces must begin with document.create or document.open.");
    return structuredClone({ version: 1, operations: this.operations });
  }
}
