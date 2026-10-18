import type { SemanticBasis, SemanticResult, SemanticState } from "@/contracts/semantic/schema";
import { semanticCommandCorrelation } from "@/contracts/semantic/correlation";
import { validateSemanticCommand, validateSemanticResult } from "@/contracts/semantic/runtime-schema";
import { semanticOperationMetadata, semanticFeatureKinds } from "@/contracts/semantic/operation-metadata";
import type { SemanticSession } from "./ports";
import { resolveSemanticCommand, type TargetResolutionContext } from "./target-resolution";
import type { SelectableCommand, TargetSelector } from "./target-inputs";
import type { OperationFields, OperationId, OperationOptions, Operations, RecipeTrace } from "./sdk-types";
import { SemanticTrace } from "./sdk-trace";
import type { SemanticSessionFactory } from "./ports";
import { SelectionError } from "./selection-error";
import { references, topology, inspection, sketchFrame, type Inspection } from "./sdk-queries";
import type { DurableRef } from "@/contracts/shared/references";
import type { SemanticReferenceOwner } from "@/contracts/semantic/schema";
import type { ModelingFeatureKind } from "@/contracts/modeling/schema";

export type OperationAttempt = { ok: true; handle: SemanticHandle } | { ok: false; error: SemanticOperationError | SelectionError };
export type ProbeEdit = { operation: "variable.update"; fields: OperationFields<"variable.update"> } | { operation: "sketch.dimension.update"; fields: OperationFields<"sketch.dimension.update"> };

export class SemanticInitializationError extends Error {
  readonly initialization: Exclude<Awaited<ReturnType<SemanticSessionFactory["open"]>>, { kind: "ready" }>;
  constructor(initialization: SemanticInitializationError["initialization"]) {
    super(`Semantic initialization ${initialization.kind}: ${initialization.diagnostics.map((d) => d.message).join("; ")}`);
    this.name = "SemanticInitializationError";
    this.initialization = initialization;
  }
}

export async function openSemanticDocument(factory: SemanticSessionFactory): Promise<SemanticDocument> {
  const opened = await factory.open();
  if (opened.kind !== "ready") throw new SemanticInitializationError(opened);
  return new SemanticDocument(opened.session, opened.initialization.state, () => openSemanticDocument(factory));
}

export class SemanticOperationError extends Error {
  readonly result: SemanticResult;
  constructor(result: SemanticResult) {
    super(`${result.correlation.commandId}: ${result.outcome.kind}: ${result.diagnostics.map((d) => d.message).join("; ")}`);
    this.name = "SemanticOperationError";
    this.result = result;
  }
}

function operations(run: (id: OperationId, fields: never, options?: OperationOptions) => Promise<SemanticHandle>): Operations {
  const root: Record<string, unknown> = {};
  for (const id of semanticOperationMetadata.keys()) {
    const path = id.split(".");
    let node = root;
    for (const key of path.slice(0, -1)) node = (node[key] ??= {}) as Record<string, unknown>;
    node[path.at(-1)!] = (fields: never, options?: OperationOptions) => run(id, fields, options);
  }
  return root as Operations;
}

function basis(state: SemanticState | undefined | null): SemanticBasis | null {
  if (!state) return null;
  const { documentId, revisionId, repositoryHeads } = state;
  return { documentId, revisionId, repositoryHeads };
}

/** Immutable result authority; calling through an old handle deliberately submits its old basis. */
export class SemanticHandle {
  readonly ops: Operations;
  readonly document: SemanticDocument;
  readonly result: SemanticResult;
  private readonly selectorAlias: string;
  constructor(document: SemanticDocument, result: SemanticResult, selectorAlias: string) {
    this.document = document;
    this.result = result;
    this.selectorAlias = selectorAlias;
    this.ops = operations((id, fields, options) => this.op(id, fields, options));
  }
  get discovery() { return this.result.discovery; }
  /** Owner-qualified label against LIVE discovery, not this handle's historical geometry. */
  ref(label: string): TargetSelector {
    if (!this.discovery?.sketch?.sketchId) throw new Error("This handle does not identify a sketch owner.");
    return { label, sketch: this.selectorAlias };
  }
  op<K extends OperationId>(id: K, fields: OperationFields<K>, options?: OperationOptions) {
    return this.document.run(id, fields, options, this);
  }
}

/** Typed policy and selection over the semantic session; never a second modelling owner. */
export class SemanticDocument {
  readonly ops: Operations;
  private readonly recorder = new SemanticTrace();
  private readonly terminals: SemanticResult[] = [];
  private readonly openCopy: (() => Promise<SemanticDocument>) | undefined;
  private state: SemanticState | undefined;
  private sequence = 0;
  private readonly commandIds = new Set<string>();
  private readonly handleAliases = new Map<string, NonNullable<SemanticResult["discovery"]>>();
  private replayAliases = new Map<string, NonNullable<SemanticResult["discovery"]>>();
  private tail: Promise<unknown> = Promise.resolve();
  private latest: SemanticHandle | undefined;
  private closing = false;
  get current() { return this.latest; }
  private readonly session: SemanticSession;
  constructor(session: SemanticSession, initialState?: SemanticState, openCopy?: () => Promise<SemanticDocument>) {
    this.session = session;
    this.openCopy = openCopy;
    this.state = initialState;
    this.ops = operations((id, fields, options) => this.op(id, fields, options));
  }
  op<K extends OperationId>(id: K, fields: OperationFields<K>, options?: OperationOptions) {
    return this.run(id, fields, options);
  }
  async tryOp<K extends OperationId>(id: K, fields: OperationFields<K>, options?: OperationOptions): Promise<OperationAttempt> {
    try { return { ok: true, handle: await this.op(id, fields, options) }; }
    catch (error) {
      if (error instanceof SemanticOperationError || error instanceof SelectionError) return { ok: false, error };
      throw error;
    }
  }
  run<K extends OperationId>(id: K, fields: OperationFields<K>, options?: OperationOptions, from?: SemanticHandle): Promise<SemanticHandle> {
    const next = this.tail.then(async () => {
      const required = semanticOperationMetadata.get(id);
      if (!required) throw new Error(`Unknown semantic operation: ${id}`);
      const state = from ? from.result.completion.live.state : this.state;
      let commandId: string;
      do { commandId = `sdk-${++this.sequence}`; } while (this.commandIds.has(commandId));
      const input = {
        ...fields,
        version: 1,
        commandId,
        operation: id,
        basis: id === "document.create" || id === "document.open" ? null : basis(state),
        ...(required.has("draft") ? { draft: state?.draft ?? null } : {}),
        ...(required.has("intent") ? { intent: "fulfill", ...("intent" in fields ? { intent: fields.intent } : {}) } : {}),
      } as SelectableCommand;
      const result = await this.execute(input, {}, options);
      const handle = this.current!;
      const kind = result.outcome.kind;
      if (kind !== "completed" && kind !== "canceled" && !(kind === "accepted-invalid" && "intent" in input && input.intent === "author-invalid"))
        throw new SemanticOperationError(result);
      return handle;
    });
    // A rejected operation must not strand the SDK queue; the caller still receives the rejection.
    this.tail = next.then(() => undefined, () => undefined);
    return next;
  }
  /** Adapter seam: explicit recipe authority and alias context, same validation and state tracking as op(). */
  async execute(input: SelectableCommand, context: TargetResolutionContext = {}, options?: OperationOptions): Promise<SemanticResult> {
    const command = resolveSemanticCommand(input, { discovery: this.current?.discovery ?? undefined, aliases: new Map([...this.handleAliases, ...this.replayAliases]), ...context });
    const checked = validateSemanticCommand(command);
    if (!checked.success) throw new Error(`Invalid semantic command: ${JSON.stringify(checked.issues)}`);
    // Record the attempt BEFORE execution: semantic failures and thrown programming errors retain their step.
    const alias = this.recorder.record(checked.data);
    this.commandIds.add(checked.data.commandId);
    const result = await this.session.execute(checked.data, options);
    const validated = validateSemanticResult(semanticCommandCorrelation(checked.data), result);
    if (!validated.success) throw new Error(`Invalid semantic completion certificate: ${JSON.stringify(validated.issues)}`);
    this.terminals.push(result);
    this.state = result.completion.live.state ?? this.state;
    const selectorAlias = `handle${this.terminals.length}`;
    this.latest = new SemanticHandle(this, result, selectorAlias);
    this.recorder.publish(alias, result.discovery);
    if (result.discovery) this.handleAliases.set(selectorAlias, result.discovery);
    return result;
  }
  results(): readonly SemanticResult[] { return [...this.terminals]; }
  commands() { return this.recorder.executed(); }
  trace(): RecipeTrace { return this.recorder.recipe(); }
  /** Same stop-first-failure policy as CLI recipes. The failing command remains in the trace. */
  async replay(recipe: RecipeTrace, options: { omitFileWrites?: boolean } = {}): Promise<SemanticResult[]> {
    if (recipe.version !== 1) throw new Error("Unsupported recipe trace version.");
    const aliases = new Map<string, NonNullable<SemanticResult["discovery"]>>();
    this.replayAliases = aliases;
    const results: SemanticResult[] = [];
    for (const operation of recipe.operations) {
      const { as: alias, ...input } = operation;
      if (options.omitFileWrites && (input.operation === "document.save" || input.operation.startsWith("export."))) {
        if (alias && this.current?.discovery) aliases.set(alias, this.current.discovery);
        continue;
      }
      const result = await this.execute(input as SelectableCommand, { aliases });
      results.push(result);
      if (result.outcome.kind !== "completed" && result.outcome.kind !== "accepted-invalid") break;
      if (alias && result.discovery) aliases.set(alias, result.discovery);
    }
    return results;
  }
  /** Reconstruct into an isolated session; never save/export or edit the delivered document. */
  async probe(edits: readonly ProbeEdit[]) {
    if (!this.openCopy) throw new Error("This SDK document has no disposable-session factory.");
    const recipe = this.trace();
    const copy = await this.openCopy();
    let facts: Inspection | undefined;
    const results: SemanticResult[] = [];
    let replayResults: SemanticResult[] = [];
    let failure: { error: unknown } | undefined;
    try {
      replayResults = await copy.replay(recipe, { omitFileWrites: true });
      if (replayResults.some((r) => r.outcome.kind !== "completed" && r.outcome.kind !== "accepted-invalid"))
        throw new SemanticOperationError(replayResults.at(-1)!);
      for (const original of edits) {
        const edit = this.recorder.encode(original) as ProbeEdit;
        const attempted = edit.operation === "variable.update"
          ? await copy.tryOp(edit.operation, edit.fields)
          : await copy.tryOp(edit.operation, edit.fields);
        if (attempted.ok) results.push(attempted.handle.result);
        else if (attempted.error instanceof SemanticOperationError) results.push(attempted.error.result);
        else throw attempted.error;
        if (!attempted.ok) break;
      }
      facts = copy.inspect();
    } catch (error) { failure = { error }; }
    const cleanup = await copy.close();
    if (failure) throw cleanup.kind === "closed" ? failure.error : new AggregateError([failure.error, cleanup], "Probe execution and cleanup failed");
    return { facts: facts!, results, replayResults, cleanup };
  }
  /** Capability poll only, not a promise that targets/options or current context will be accepted. */
  canRun(id: OperationId): boolean {
    if (this.closing || !semanticOperationMetadata.has(id)) return false;
    const capabilities = this.current?.discovery?.model?.capabilities;
    if (!capabilities) return false;
    const family = id.split(".")[0] as ModelingFeatureKind;
    // Feature families are the generated ModelingFeatureKind literals in discovery's matrix.
    const knownFeature = semanticFeatureKinds.has(family);
    return !knownFeature || capabilities.supportedFeatureKinds.includes(family);
  }
  references<K extends DurableRef["kind"] = DurableRef["kind"]>(filter?: { owner?: SemanticReferenceOwner; kind?: K }) { return references(this.current?.discovery, filter); }
  topology(entityClass?: Parameters<typeof topology>[1]) { return topology(this.current?.discovery, entityClass); }
  inspect<K extends keyof Inspection = keyof Inspection>(fields?: readonly K[]): Pick<Inspection, K> {
    const facts = inspection(this.current?.discovery);
    return Object.fromEntries((fields ?? Object.keys(facts) as K[]).map((key) => [key, facts[key]])) as Pick<Inspection, K>;
  }
  localToWorld(point: readonly [number, number]): [number, number, number] {
    const { origin, xAxis, yAxis } = sketchFrame(this.current?.discovery);
    return [0, 1, 2].map((i) => origin[i]! + point[0] * xAxis[i]! + point[1] * yAxis[i]!) as [number, number, number];
  }
  /** Orthogonal projection onto the discovered plane, in document length units. */
  worldToLocal(point: readonly [number, number, number]): [number, number] {
    const { origin, xAxis, yAxis } = sketchFrame(this.current?.discovery);
    return [xAxis, yAxis].map((axis) => axis.reduce((sum, v, i) => sum + v * (point[i]! - origin[i]!), 0)) as [number, number];
  }
  close() { this.closing = true; return this.session.close(); }
}
