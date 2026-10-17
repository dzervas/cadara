import type { RevisionId } from "@/contracts/shared/ids";

export function parseRevisionSequence(revisionId: RevisionId) {
  const match = /^rev_(\d+)$/.exec(revisionId);
  if (!match) throw new Error(`Unsupported revision format ${revisionId}.`);
  return Number.parseInt(match[1]!, 10);
}

export function createRevisionId(sequence: number) {
  return `rev_${String(sequence).padStart(4, "0")}` as RevisionId;
}
