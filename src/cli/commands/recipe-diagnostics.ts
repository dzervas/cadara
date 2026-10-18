/**
 * Structured CLI diagnostics for `cadara document recipe`: the `error` member
 * of the stdout envelope. These describe CLI encoding/selection problems for a
 * command that did NOT execute; they never stand in for a SemanticResult.
 */
import type { SelectionCandidate } from "@/application/semantic/selection-error";
import type { JsonSchema } from "@/cli/commands/recipe-catalog";

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
