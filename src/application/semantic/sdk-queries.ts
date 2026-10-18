import type { SemanticDiscovery, SemanticReferenceOwner } from "@/contracts/semantic/schema";
import type { DurableRef } from "@/contracts/shared/references";

/** Ref identity is independent of object property insertion order. */
export function sameTarget(left: unknown, right: unknown): boolean {
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return left === right;
  const a = Object.entries(left), b = Object.entries(right);
  return a.length === b.length && a.every(([key, value]) => sameTarget(value, (right as Record<string, unknown>)[key]));
}

type ReferenceOf<K extends DurableRef["kind"]> = { label: string; target: Extract<DurableRef, { kind: K }>; owner: SemanticReferenceOwner | null };

export function references<K extends DurableRef["kind"] = DurableRef["kind"]>(discovery: SemanticDiscovery | null | undefined, filter: { owner?: SemanticReferenceOwner; kind?: K } = {}): readonly ReferenceOf<K>[] {
  return (discovery?.references ?? []).filter((r): r is ReferenceOf<K> =>
    (!filter.kind || r.target.kind === filter.kind) &&
    (!filter.owner || sameTarget(r.owner, filter.owner) || sameTarget(r.target, filter.owner)),
  );
}

export function topology(discovery: SemanticDiscovery | null | undefined, entityClass?: "face" | "edge" | "vertex" | "body") {
  return (discovery?.model?.bodies ?? []).flatMap((body) => (body.topology ?? []).flatMap((entry) => {
    if (entityClass && entry.entityClass !== entityClass) return [];
    const reference = discovery?.references.find((r) => sameTarget(r.target, entry.reference));
    return reference ? [{ ...entry, bodyId: body.bodyId, reference }] : [];
  }));
}

export function inspection(discovery: SemanticDiscovery | null | undefined) {
  const bodies = discovery?.model?.bodies ?? [];
  return {
    bodies: bodies.map(({ bodyId, kind, bounds }) => ({ bodyId, kind, bounds })),
    bounds: bodies.map((body) => body.bounds),
    topologyCounts: bodies.map((body) => {
      if (body.topology == null) return null;
      return { face: body.topology.filter((t) => t.entityClass === "face").length, edge: body.topology.filter((t) => t.entityClass === "edge").length, vertex: body.topology.filter((t) => t.entityClass === "vertex").length };
    }),
    features: discovery?.model?.features ?? [],
    variables: discovery?.variables ?? [],
    solveStatus: discovery?.sketch?.solveStatus ?? null,
  };
}
export type Inspection = ReturnType<typeof inspection>;

export function sketchFrame(discovery: SemanticDiscovery | null | undefined) {
  const frame = discovery?.sketch?.support?.frame;
  if (!frame) throw new Error("No discovered sketch support frame.");
  return frame;
}
