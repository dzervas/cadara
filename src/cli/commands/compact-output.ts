/**
 * Compact `document recipe` output (`--output compact`, output version 1).
 *
 * A presentation projection applied only when printing: execution, alias
 * resolution and validation always use the full semantic results. Every
 * terminal fact (correlation, outcome, completion receipts, diagnostics,
 * changed targets, unexecuted commands and cleanup) is retained verbatim.
 * Only discovery is reduced, and each reduction is explicit:
 * - every result's discovery except the last non-null one keeps just its exact
 *   `state` (basis and draft) as `{ detail: "omitted", state }`;
 * - the last discovery is `{ detail: "included", ... }` with all references,
 *   but each body's exact topology signatures become
 *   `{ detail: "omitted", entries }`. `null` still means unavailable topology
 *   and `entries: 0` an empty signature list; omission certifies nothing.
 * `discovery: null` (failed handoff) stays null.
 */
import type {
  SemanticDiscovery,
  SemanticResult,
  SemanticState,
} from "@/contracts/semantic/schema";
import type {
  SemanticCloseResult,
  SemanticSessionFactory,
} from "@/application/semantic/ports";

import type { RecipeCliError } from "./recipe-diagnostics";

type Model = NonNullable<SemanticDiscovery["model"]>;
type Body = Model["bodies"][number];
export type CompactBody = Omit<Body, "topology"> & {
  topology?: { detail: "omitted"; entries: number } | null;
};
export type CompactDiscovery =
  | { detail: "omitted"; state: SemanticState }
  | (Omit<SemanticDiscovery, "model"> & {
      detail: "included";
      model?: Omit<Model, "bodies"> & { bodies: readonly CompactBody[] };
    });
export type CompactSemanticResult = Omit<SemanticResult, "discovery"> & {
  discovery: CompactDiscovery | null;
};
type CompactCleanup<T = SemanticCloseResult> = T extends SemanticCloseResult
  ? Omit<T, "settled"> & { settled: readonly CompactSemanticResult[] }
  : never;
type InitializationFailure = Exclude<
  Awaited<ReturnType<SemanticSessionFactory["open"]>>,
  { kind: "ready" }
>;
export const compactOutput = { mode: "compact", version: 1 } as const;
export type CompactRecipeOutput = { error?: RecipeCliError } & (
  | {
      version: 1;
      output: typeof compactOutput;
      results: readonly CompactSemanticResult[];
      unexecuted: readonly string[];
      cleanup: CompactCleanup;
      initialization?: never;
    }
  | {
      version: 1;
      output: typeof compactOutput;
      initialization: Omit<InitializationFailure, "cleanup"> & {
        cleanup: CompactCleanup;
      };
      results: readonly [];
      unexecuted?: never;
      cleanup?: never;
    });

function compactResult(
  result: SemanticResult,
  included: boolean,
): CompactSemanticResult {
  const { discovery, ...facts } = result;
  if (!discovery) return { ...facts, discovery: null };
  if (!included)
    return {
      ...facts,
      discovery: { detail: "omitted", state: discovery.state },
    };
  const { model, ...rest } = discovery;
  return {
    ...facts,
    discovery: {
      detail: "included",
      ...rest,
      ...(model
        ? {
            model: {
              ...model,
              bodies: model.bodies.map(({ topology, ...body }) => ({
                ...body,
                ...(topology === undefined
                  ? {}
                  : {
                      topology: topology && {
                        detail: "omitted" as const,
                        entries: topology.length,
                      },
                    }),
              })),
            },
          }
        : {}),
    },
  };
}

function compactCleanup(cleanup: SemanticCloseResult): CompactCleanup {
  return {
    ...cleanup,
    settled: cleanup.settled.map((result) => compactResult(result, false)),
  } as CompactCleanup;
}

export function compactRecipeOutput(
  results: readonly SemanticResult[],
  unexecuted: readonly string[],
  cleanup: SemanticCloseResult,
  error?: RecipeCliError,
): CompactRecipeOutput {
  const last = results.findLastIndex((result) => result.discovery !== null);
  return {
    version: 1,
    output: compactOutput,
    results: results.map((result, index) =>
      compactResult(result, index === last),
    ),
    unexecuted,
    cleanup: compactCleanup(cleanup),
    ...(error ? { error } : {}),
  };
}

export function compactInitializationOutput(
  initialization: InitializationFailure,
  error?: RecipeCliError,
): CompactRecipeOutput {
  return {
    version: 1,
    output: compactOutput,
    initialization: {
      ...initialization,
      cleanup: compactCleanup(initialization.cleanup),
    },
    results: [],
    ...(error ? { error } : {}),
  };
}
