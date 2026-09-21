import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type {
  AuthoredActionState,
  AuthoredFieldWrite,
  AuthoredValue,
} from "@/contracts/modeling/authored-actions";
import {
  encodeAuthoredActionState,
  decodeAuthoredActionState,
} from "./authored-action-history";

type Fields = Record<string, AuthoredValue>;
export interface CollaborativeDocument {
  format: "cadara-stable-authored-v3";
  authored: Fields;
  revisionId: AuthoredModelDocument["revisionId"];
  provenance: Record<string, Fields>;
  topologyLineage: Fields;
}
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const object = (value: unknown): value is Fields =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (!object(a) || !object(b)) return false;
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every(
      (key) => Object.hasOwn(b, key) && equal(a[key], b[key]),
    )
  );
}
function keyed(records: Fields[], id: string): Fields {
  return Object.fromEntries(
    records.map((record) => [String(record[id]), record]),
  );
}
function provenance(document: AuthoredModelDocument) {
  const topologyLineage = keyed(
    plain(document.topologyLineage ?? []) as unknown as Fields[],
    "featureId",
  );
  for (const feature of Object.values(topologyLineage) as Fields[]) {
    feature.outputs = keyed(feature.outputs as Fields[], "outputSlot");
    for (const output of Object.values(feature.outputs) as Fields[])
      output.sourceTargets = keyed(
        output.sourceTargets as Fields[],
        "sourceKey",
      );
  }
  return {
    topologyLineage,
    sketches: Object.fromEntries(
      document.sketches.map((sketch) => [
        sketch.sketchId,
        {
          ...(sketch.regionSlots
            ? {
                regionSlots: keyed(
                  plain(sketch.regionSlots) as unknown as Fields[],
                  "regionId",
                ),
              }
            : {}),
          // NOT-YET-replaced replay metadata. Its order remains meaningful until T03 removes the seam.
        },
      ]),
    ) as Record<string, Fields>,
  };
}
export function documentActionState(
  document: AuthoredModelDocument,
): AuthoredActionState {
  return {
    documentId: document.documentId,
    context: { kind: "document" },
    data: document,
  };
}
export function createCollaborativeDocument(
  document: AuthoredModelDocument,
): CollaborativeDocument {
  const metadata = provenance(document);
  return {
    format: "cadara-stable-authored-v3",
    authored: encodeAuthoredActionState(documentActionState(document)),
    revisionId: document.revisionId,
    provenance: metadata.sketches,
    topologyLineage: metadata.topologyLineage,
  };
}
export function materializeCollaborativeDocument(
  storage: CollaborativeDocument,
): AuthoredModelDocument {
  if (storage.format !== "cadara-stable-authored-v3" || !storage.authored)
    throw new Error("Unsupported collaborative document storage format");
  const state = decodeAuthoredActionState(
    {
      documentId: storage.authored.documentId,
      context: { kind: "document" },
    } as AuthoredActionState,
    plain(storage.authored),
  );
  const document = state.data as AuthoredModelDocument;
  document.revisionId = storage.revisionId;
  const lineage = Object.values(plain(storage.topologyLineage)) as Fields[];
  for (const feature of lineage) {
    feature.outputs = Object.values(feature.outputs as Fields);
    for (const output of feature.outputs as Fields[])
      output.sourceTargets = Object.values(output.sourceTargets as Fields);
  }
  document.topologyLineage =
    lineage as unknown as AuthoredModelDocument["topologyLineage"];
  for (const sketch of document.sketches) {
    const metadata = storage.provenance[sketch.sketchId];
    if (metadata?.regionSlots)
      sketch.regionSlots = Object.values(
        plain(metadata.regionSlots) as Fields,
      ) as unknown as NonNullable<typeof sketch.regionSlots>;
  }
  return document;
}
/** LCS edit script preserves every unchanged interior list element, not just prefix/suffix.
 * Deleting/reinserting equal elements would resurrect a concurrent peer deletion on merge.
 */
function updateSequence(list: AuthoredValue[], next: AuthoredValue[]) {
  const before = plain(list);
  const lengths = Array.from(
    { length: before.length + 1 },
    () => new Uint32Array(next.length + 1),
  );
  for (let i = before.length - 1; i >= 0; i--)
    for (let j = next.length - 1; j >= 0; j--)
      lengths[i]![j] = equal(before[i], next[j])
        ? lengths[i + 1]![j + 1]! + 1
        : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
  let i = 0,
    j = 0,
    position = 0;
  while (i < before.length || j < next.length) {
    if (i < before.length && j < next.length && equal(before[i], next[j])) {
      i++;
      j++;
      position++;
    } else if (
      j < next.length &&
      (i === before.length || lengths[i]![j + 1]! > lengths[i + 1]![j]!)
    ) {
      list.splice(position++, 0, plain(next[j++]!));
    } else {
      list.splice(position, 1);
      i++;
    }
  }
}
export function applyCollaborativeWrites(
  storage: CollaborativeDocument,
  writes: readonly AuthoredFieldWrite[],
) {
  for (const change of writes) {
    let parent = storage.authored;
    for (const key of change.address.slice(0, -1))
      parent = parent[key] as Fields;
    const key = change.address.at(-1)!;
    if (!change.after.exists) delete parent[key];
    else if (Array.isArray(parent[key]) && Array.isArray(change.after.value))
      updateSequence(parent[key] as AuthoredValue[], change.after.value);
    else parent[key] = structuredClone(change.after.value);
  }
}
export class DocumentProvenanceConflict extends Error {
  constructor(path: string) {
    super(
      `Provenance changed at ${path}; recompute against the current document before retrying.`,
    );
  }
}
/** Three-way field/record writes, checked completely before any metadata write.
 * Conflicting witnesses/replay sequences block the transaction and require recomputation;
 * they are neither silently overwritten nor guessed to correspond to a peer's geometry.
 */
export function updateDocumentProvenance(
  storage: CollaborativeDocument,
  document: AuthoredModelDocument,
  expected: AuthoredModelDocument,
) {
  const before = provenance(expected),
    after = provenance(document);
  const changes: Array<() => void> = [];
  function plan(
    current: Fields,
    base: Fields,
    candidate: Fields,
    path: string,
  ) {
    for (const key of new Set([
      ...Object.keys(base),
      ...Object.keys(candidate),
    ])) {
      const left = base[key],
        right = candidate[key];
      if (equal(left, right)) continue;
      if (object(left) && object(right)) {
        if (!object(current[key]))
          throw new DocumentProvenanceConflict(`${path}.${key}`);
        plan(current[key] as Fields, left, right, `${path}.${key}`);
      } else {
        if (!equal(current[key], left) && !equal(current[key], right))
          throw new DocumentProvenanceConflict(`${path}.${key}`);
        if (equal(current[key], right)) continue;
        changes.push(() => {
          if (right === undefined) delete current[key];
          else if (Array.isArray(current[key]) && Array.isArray(right))
            updateSequence(current[key] as AuthoredValue[], right);
          else current[key] = plain(right);
        });
      }
    }
  }
  plan(
    storage.topologyLineage,
    before.topologyLineage,
    after.topologyLineage,
    "topologyLineage",
  );
  for (const [id, candidate] of Object.entries(after.sketches)) {
    const base = before.sketches[id] ?? {};
    // Keep deleted sketches' stable provenance for compensation, outside authored history.
    const current = storage.provenance[id];
    if (current) plan(current, base, candidate, `sketches.${id}`);
    else {
      if (Object.keys(base).length)
        throw new DocumentProvenanceConflict(`sketches.${id}`);
      changes.push(() => {
        storage.provenance[id] = plain(candidate);
      });
    }
  }
  for (const write of changes) write();
  storage.revisionId = document.revisionId;
}
