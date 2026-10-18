/**
 * Structured CLI diagnostics for `cadara document recipe`: the `error` member
 * of the stdout envelope. These describe CLI encoding/selection problems for a
 * command that did NOT execute; they never stand in for a SemanticResult.
 */
import type { SemanticDiscovery } from "@/contracts/semantic/schema";
import type { JsonSchema } from "@/cli/commands/recipe-catalog";

export interface SelectionCandidate {
  label: string;
  /** The canonical typed value that would have been substituted. */
  target: unknown;
  /** The sketch or body that owns the candidate, when it has one. */
  owner: { kind: "sketch"; sketchId: string; label: string | null } | { kind: "body"; bodyId: string; label: string | null } | null;
}

export interface RecipeCliError {
  code: "usage" | "recipe-unreadable" | "invalid-recipe" | "unknown-operation" | "selection-unresolved" | "selection-ambiguous" | "initialization";
  /** preflight: nothing executed, kernel never started; resolution: earlier operations executed. */
  phase: "preflight" | "initialization" | "resolution";
  message: string;
  commandIndex: number | null;
  commandId: string | null;
  operation: string | null;
  /** Relative to the operation object when commandIndex is set, else to the recipe document. */
  path: string | null;
  /** Contract validation issues, each with the generated schema expected at its path. */
  issues?: readonly { path: string; expected: string; value?: unknown; schema?: JsonSchema; allowed?: readonly string[] }[];
  suggestions?: readonly string[];
  knownAliases?: readonly string[];
  selector?: unknown;
  eligibleKinds?: readonly string[];
  /** Selection: every eligible reference carrying the requested label. */
  candidates?: readonly SelectionCandidate[];
  /** Selection without a label match: eligible references in the snapshot (at most 50). */
  available?: readonly SelectionCandidate[];
  availableCount?: number;
  /** Generated contract schema for the field at `path`. */
  expected?: JsonSchema;
  help?: string;
}

type ErrorFields = Partial<Omit<RecipeCliError, "code" | "phase" | "message">>;

export class RecipeError extends Error {
  readonly error: RecipeCliError;
  constructor(error: RecipeCliError) {
    super(error.message);
    this.name = "RecipeError";
    this.error = error;
  }
}

export function recipeError(code: RecipeCliError["code"], phase: RecipeCliError["phase"], message: string, fields: ErrorFields = {}) {
  return new RecipeError({ code, phase, message, commandIndex: null, commandId: null, operation: null, path: null, ...fields });
}

export function invalidRecipe(message: string, fields: ErrorFields = {}) {
  return recipeError("invalid-recipe", "preflight", message, fields);
}

type Reference = { label: string; target: unknown };

function owner(target: unknown, discovery: SemanticDiscovery | undefined): SelectionCandidate["owner"] {
  if (!target || typeof target !== "object" || !("kind" in target)) return null;
  const label = (kind: string, key: string, id: string) =>
    discovery?.references.find((r) => r.target.kind === kind && (r.target as unknown as Record<string, unknown>)[key] === id)?.label ?? null;
  if ("sketchId" in target && typeof target.sketchId === "string" && target.kind !== "sketch")
    return { kind: "sketch", sketchId: target.sketchId, label: label("sketch", "sketchId", target.sketchId) };
  if ("bodyId" in target && typeof target.bodyId === "string" && target.kind !== "body")
    return { kind: "body", bodyId: target.bodyId, label: label("body", "bodyId", target.bodyId) };
  return null;
}

/**
 * A selector that matched zero or several eligible values. `eligible` lists the
 * snapshot's values of the field's eligible kinds, used when nothing matched.
 */
export function selectionError(
  message: string,
  selector: unknown,
  eligibleKinds: readonly string[],
  matches: readonly Reference[],
  discovery: SemanticDiscovery | undefined,
  eligible: readonly Reference[] = discovery?.references.filter((r) => eligibleKinds.includes(r.target.kind)) ?? [],
) {
  const describe = (r: Reference): SelectionCandidate => ({ label: r.label, target: r.target, owner: owner(r.target, discovery) });
  const summary = matches.length > 1 ? ` ${matches.length} eligible candidates match; choose one from error.candidates.` : eligible.length ? ` No eligible match; error.available lists ${eligible.length} eligible values.` : "";
  return recipeError(matches.length > 1 ? "selection-ambiguous" : "selection-unresolved", "resolution", message + summary, {
    selector,
    eligibleKinds,
    candidates: matches.map(describe),
    ...(matches.length ? {} : { available: eligible.slice(0, 50).map(describe), availableCount: eligible.length }),
  });
}

/** Path (Typia notation, relative to `root`) of the exact object `needle`. */
export function pathOf(root: unknown, needle: unknown, path = ""): string | null {
  if (root === needle) return path;
  if (!root || typeof root !== "object") return null;
  for (const [key, value] of Object.entries(root)) {
    const child = Array.isArray(root) ? `${path}[${key}]` : /^[A-Za-z_$][\w$]*$/.test(key) ? (path ? `${path}.${key}` : key) : `${path}[${JSON.stringify(key)}]`;
    const found = pathOf(value, needle, child);
    if (found !== null) return found;
  }
  return null;
}
