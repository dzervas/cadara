import type { SemanticDiscovery } from "@/contracts/semantic/schema";

export interface SelectionCandidate {
  label: string;
  /** The canonical typed value that would have been substituted. */
  target: unknown;
  /** The sketch or body that owns the candidate, when it has one. */
  owner:
    | { kind: "sketch"; sketchId: string; label: string | null }
    | { kind: "body"; bodyId: string; label: string | null }
    | null;
}

export interface SelectionFailure {
  code: "selection-unresolved" | "selection-ambiguous";
  message: string;
  selector: unknown;
  eligibleKinds: readonly string[];
  candidates: readonly SelectionCandidate[];
  available?: readonly SelectionCandidate[];
  availableCount?: number;
}

/** Selection never fabricates a semantic result: the command did not execute. */
export class SelectionError extends Error {
  readonly selection: SelectionFailure;
  constructor(selection: SelectionFailure) {
    super(selection.message);
    this.name = "SelectionError";
    this.selection = selection;
  }
}

type Reference = { label: string; target: unknown };

function owner(
  target: unknown,
  discovery: SemanticDiscovery | undefined,
): SelectionCandidate["owner"] {
  if (!target || typeof target !== "object" || !("kind" in target)) return null;
  const label = (kind: string, key: string, id: string) =>
    discovery?.references.find(
      (r) =>
        r.target.kind === kind &&
        (r.target as unknown as Record<string, unknown>)[key] === id,
    )?.label ?? null;
  if (
    "sketchId" in target &&
    typeof target.sketchId === "string" &&
    target.kind !== "sketch"
  )
    return {
      kind: "sketch",
      sketchId: target.sketchId,
      label: label("sketch", "sketchId", target.sketchId),
    };
  if (
    "bodyId" in target &&
    typeof target.bodyId === "string" &&
    target.kind !== "body"
  )
    return {
      kind: "body",
      bodyId: target.bodyId,
      label: label("body", "bodyId", target.bodyId),
    };
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
  eligible: readonly Reference[] = discovery?.references.filter((r) =>
    eligibleKinds.includes(r.target.kind),
  ) ?? [],
) {
  const describe = (r: Reference): SelectionCandidate => ({
    label: r.label,
    target: r.target,
    owner: owner(r.target, discovery),
  });
  const summary =
    matches.length > 1
      ? ` ${matches.length} eligible candidates match; choose one from error.candidates.`
      : eligible.length
        ? ` No eligible match; error.available lists ${eligible.length} eligible values.`
        : "";
  return new SelectionError({
    code: matches.length > 1 ? "selection-ambiguous" : "selection-unresolved",
    message: message + summary,
    selector,
    eligibleKinds,
    candidates: matches.map(describe),
    ...(matches.length
      ? {}
      : {
          available: eligible.slice(0, 50).map(describe),
          availableCount: eligible.length,
        }),
  });
}
