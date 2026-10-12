import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type {
  AuthoredAction,
  AuthoredActionResult,
  AuthoredPresence,
} from "@/contracts/modeling/authored-actions";

/** The document records a blocked action can name: id field, label field, noun. */
const NAMED_RECORDS = {
  sketches: { id: "sketchId", label: "label", noun: "a sketch" },
  features: { id: "featureId", label: "label", noun: "a feature" },
  variables: { id: "variableId", label: "name", noun: "a variable" },
  bodyLabels: { id: "bodyId", label: "label", noun: "a body" },
} as const;

type NamedCollection = keyof typeof NAMED_RECORDS;

/** The label of a whole written record, or of a write to its label field. */
function writtenLabel(
  address: readonly string[],
  presence: AuthoredPresence,
  field: string,
): string | undefined {
  if (!presence.exists) return undefined;
  const { value } = presence;
  if (address.length === 3 && address[2] === field)
    return typeof value === "string" ? value : undefined;
  if (
    address.length !== 2 ||
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    return undefined;
  const label = value[field];
  return typeof label === "string" ? label : undefined;
}

/**
 * T17e (P-8, specification "Two-author editing": conflicting compensation
 * blocks with a reason): the user text of a blocked document action
 * (commit, Undo or Redo), shared by both document repositories. It names
 * the entry by its history label and every conflicting record once, by its
 * own label (from the current document, else, when the record was deleted,
 * from the writes of this session's history entries, e.g. the Publish that
 * created it), never by id or address.
 */
export function describeBlockedDocumentAction(input: {
  readonly direction: "commit" | "undo" | "redo";
  /** The history entry's label ("Publish Sketch"). */
  readonly label: string;
  readonly result: Extract<AuthoredActionResult, { status: "blocked" }>;
  /** The document the action was checked against. */
  readonly current: Pick<AuthoredModelDocument, NamedCollection> | undefined;
  /** This session's history entries (their writes name deleted records). */
  readonly history: readonly Pick<AuthoredAction, "writes">[];
}): string {
  const { result, current, history } = input;
  const subject = `Can't ${input.direction === "commit" ? "apply" : input.direction} ${input.label}`;
  const deleted = new Set<string>();
  const changed = new Set<string>();
  const named = (address: readonly string[]) =>
    address[0] !== undefined &&
    address[1] !== undefined &&
    Object.hasOwn(NAMED_RECORDS, address[0]);
  // A document-level field (e.g. the history order a sketch deletion also
  // rewrites) is named only when no record is.
  if (!result.targets.some(named) && result.targets.length > 0)
    changed.add("the document");
  for (const address of result.targets) {
    if (!named(address)) continue;
    const collection = address[0]!;
    const id = address[1]!;
    const fields = NAMED_RECORDS[collection as NamedCollection];
    const record = (
      current?.[collection as NamedCollection] as
        | readonly Record<string, unknown>[]
        | undefined
    )?.find((entry) => entry[fields.id] === id);
    const own = record?.[fields.label];
    if (typeof own === "string") {
      changed.add(`‘${own}’`);
      continue;
    }
    const written = history
      .flatMap((action) => action.writes)
      .filter(
        (write) => write.address[0] === collection && write.address[1] === id,
      )
      .flatMap((write) => [
        writtenLabel(write.address, write.before, fields.label),
        writtenLabel(write.address, write.after, fields.label),
      ])
      .find((label) => label !== undefined);
    (record ? changed : deleted).add(
      written === undefined ? fields.noun : `‘${written}’`,
    );
  }
  const all = new Set([...deleted, ...changed]);
  const list = (names: ReadonlySet<string>) => {
    const items = [...names];
    return items.length <= 1
      ? (items[0] ?? "the document")
      : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
  };
  const was = (names: ReadonlySet<string>, what: string) =>
    `${list(names)} ${names.size > 1 ? "were" : "was"} ${what}`;
  switch (result.reason) {
    case "expected-state-changed":
      return `${subject}: ${[
        ...(deleted.size > 0 ? [was(deleted, "deleted")] : []),
        ...(changed.size > 0 || deleted.size === 0
          ? [was(changed, "changed")]
          : []),
      ].join(" and ")} by another session.`;
    case "dependent-record-changed":
      return `${subject}: ${list(all)} ${all.size > 1 ? "are" : "is"} now used by other changes.`;
    case "later-action-overlap":
      return `${subject}: a later action also changed ${list(all)}; undo that first.`;
    case "action-not-found":
      return `${subject}: that history entry no longer exists.`;
    case "identity-mismatch":
    case "context-missing":
      return `${subject}: the document changed.`;
  }
}
