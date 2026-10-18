import type { SemanticDiscovery } from "@/contracts/semantic/schema";
import { selectionError } from "@/cli/commands/recipe-diagnostics";

/*
 * Owner-qualified target selector `{ alias, label, sketch }`: `sketch` names an
 * earlier recipe alias whose discovery identifies one sketch (the sketch a
 * `sketch.publish` result published, or the sketch a private draft edits).
 * It resolves exactly like `{ alias, label }` against only that sketch's
 * references in the `alias` snapshot, so eligible kinds, uniqueness and
 * currentness checks are unchanged. Unqualified selectors keep their meaning.
 */

/** The canonical identity used by the alias snapshot's own sketch references. */
function ownerOf(discovery: SemanticDiscovery | undefined) {
  if (!discovery) return null;
  const context = discovery.state.editingContext;
  return (
    discovery.sketch?.sketchId ??
    (context.kind === "sketch" ? context.sketchId : null)
  );
}

function scope(discovery: SemanticDiscovery, owner: string): SemanticDiscovery {
  const { sketch, ...rest } = discovery;
  return {
    ...rest,
    // Variables are document-owned, never sketch-owned.
    variables: [],
    references: discovery.references.filter(
      (r) => "sketchId" in r.target && r.target.sketchId === owner,
    ),
    // Private draft records (requirements, operands, derivations) all belong
    // to the draft's own sketch; keep them only when that is the owner.
    ...(sketch && ownerOf(discovery) === owner ? { sketch } : {}),
  };
}

/**
 * Rewrites every owner-qualified selector in `command` to an unqualified one
 * pointing at a per-operation scoped snapshot, returned in `aliases`.
 * `origins` maps each rewritten object to the recipe's original object.
 */
export function scopeSketchOwners<T>(
  command: T,
  snapshots: ReadonlyMap<string, SemanticDiscovery>,
  origins: Map<unknown, unknown>,
): { command: T; aliases: Map<string, SemanticDiscovery> } {
  const aliases = new Map(snapshots);
  const scoped = new Map<string, string>();
  function rewrite(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(rewrite);
    if (!value || typeof value !== "object") return value;
    if (!("alias" in value && "sketch" in value)) {
      const copy = Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, rewrite(entry)]),
      );
      origins.set(copy, value);
      return copy;
    }
    const { alias, sketch, ...selector } = value as {
      alias: string;
      sketch: string;
    };
    const key = JSON.stringify([alias, sketch]);
    if (!scoped.has(key)) {
      const owner = ownerOf(snapshots.get(sketch));
      if (!owner) throw selectionError("Sketch owner alias has no sketch identity.", value, ["sketch"], [], undefined, []);
      let name = `${alias}#${scoped.size}`;
      while (aliases.has(name)) name += "#";
      const discovery = snapshots.get(alias);
      if (discovery) aliases.set(name, scope(discovery, owner));
      scoped.set(key, name);
    }
    const rewritten = { ...selector, alias: scoped.get(key) };
    origins.set(rewritten, value);
    return rewritten;
  }
  return { command: rewrite(command) as T, aliases };
}
