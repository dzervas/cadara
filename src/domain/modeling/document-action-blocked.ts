import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type {
  AuthoredAction,
  AuthoredActionResult,
  AuthoredAddress,
  AuthoredPresence,
} from "@/contracts/modeling/authored-actions";
import type { SketchDefinition } from "@/contracts/sketch/schema";

/** How a record of a collection is named: id field, label field, noun. */
type RecordNaming = {
  readonly id: string;
  readonly label: string;
  readonly noun: string;
};

/** The document records a blocked action can name. */
const NAMED_RECORDS = {
  sketches: { id: "sketchId", label: "label", noun: "a sketch" },
  features: { id: "featureId", label: "label", noun: "a feature" },
  variables: { id: "variableId", label: "name", noun: "a variable" },
  bodyLabels: { id: "bodyId", label: "label", noun: "a body" },
} as const satisfies Record<string, RecordNaming>;

type NamedCollection = keyof typeof NAMED_RECORDS;

/**
 * T17k2 (review A-2): the sketch records a blocked private (in-sketch)
 * action can name, under `definition.‹collection›.‹id›`.
 */
const NAMED_SKETCH_RECORDS = {
  entities: { id: "entityId", label: "label", noun: "a curve" },
  points: { id: "pointId", label: "label", noun: "a point" },
  constraints: { id: "constraintId", label: "label", noun: "a requirement" },
  dimensions: { id: "dimensionId", label: "label", noun: "a dimension" },
  derivedRelationships: {
    id: "derivationId",
    label: "label",
    noun: "a relationship",
  },
  referenceImages: { id: "operationId", label: "label", noun: "an image" },
} as const satisfies Record<string, RecordNaming>;

/** Where a conflicting address points: a named record, or nothing named. */
type LocatedRecord = {
  readonly naming: RecordNaming;
  readonly id: string;
  /** The current records of its collection. */
  readonly records: readonly Record<string, unknown>[] | undefined;
  /** The address of the record itself (its writes are below it). */
  readonly root: AuthoredAddress;
};

/** The label of a whole written record, or of a write to its label field. */
function writtenLabel(
  relative: readonly string[],
  presence: AuthoredPresence,
  field: string,
): string | undefined {
  if (!presence.exists) return undefined;
  const { value } = presence;
  if (relative.length === 1 && relative[0] === field)
    return typeof value === "string" ? value : undefined;
  if (
    relative.length !== 0 ||
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    return undefined;
  const label = value[field];
  return typeof label === "string" ? label : undefined;
}

/**
 * The shared text: the entry by its history label, every conflicting
 * record once by its own label (current, else from this session's history
 * writes, e.g. the action that created it), never by id or address; an
 * unnamed target is `whole` ("the document", "the sketch"), named only when
 * no record is.
 */
function describeBlockedAction(input: {
  readonly direction: "commit" | "undo" | "redo";
  readonly label: string;
  readonly result: Extract<AuthoredActionResult, { status: "blocked" }>;
  readonly history: readonly Pick<AuthoredAction, "writes">[];
  readonly locate: (address: AuthoredAddress) => LocatedRecord | null;
  readonly whole: string;
}): string {
  const { result, history, locate, whole } = input;
  const subject = `Can't ${input.direction === "commit" ? "apply" : input.direction} ${input.label}`;
  const deleted = new Set<string>();
  const changed = new Set<string>();
  const located = result.targets.map(locate);
  if (!located.some(Boolean) && result.targets.length > 0) changed.add(whole);
  for (const record of located) {
    if (!record) continue;
    const { naming, id, records, root } = record;
    const current = records?.find((entry) => entry[naming.id] === id);
    const own = current?.[naming.label];
    if (typeof own === "string") {
      changed.add(`‘${own}’`);
      continue;
    }
    const written = history
      .flatMap((action) => action.writes)
      .filter((write) =>
        root.every((part, index) => write.address[index] === part),
      )
      .flatMap((write) => {
        const relative = write.address.slice(root.length);
        return [
          writtenLabel(relative, write.before, naming.label),
          writtenLabel(relative, write.after, naming.label),
        ];
      })
      .find((label) => label !== undefined);
    (current ? changed : deleted).add(
      written === undefined ? naming.noun : `‘${written}’`,
    );
  }
  const all = new Set([...deleted, ...changed]);
  const list = (names: ReadonlySet<string>) => {
    const items = [...names];
    return items.length <= 1
      ? (items[0] ?? whole)
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
      return `${subject}: ${whole} changed.`;
  }
}

/**
 * T17e (P-8, specification "Two-author editing": conflicting compensation
 * blocks with a reason): the user text of a blocked document action
 * (commit, Undo or Redo), shared by both document repositories.
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
  return describeBlockedAction({
    ...input,
    whole: "the document",
    locate: (address) => {
      const [collection, id] = address;
      if (
        collection === undefined ||
        id === undefined ||
        !Object.hasOwn(NAMED_RECORDS, collection)
      )
        return null;
      return {
        naming: NAMED_RECORDS[collection as NamedCollection],
        id,
        records: input.current?.[collection as NamedCollection] as
          | readonly Record<string, unknown>[]
          | undefined,
        root: [collection, id],
      };
    },
  });
}

/**
 * T17k2 (review A-2): the user text of a blocked private sketch Undo/Redo
 * (e.g. a retained entry after a peer edited the sketch), the same shape as
 * the document strip's: "Can't undo Create Sketch Geometry: ‘Line 1’ was
 * deleted by another session." Records are named from `definition`.
 */
export function describeBlockedSketchAction(input: {
  readonly direction: "undo" | "redo";
  readonly label: string;
  readonly result: Extract<AuthoredActionResult, { status: "blocked" }>;
  /** The sketch definition the action was checked against. */
  readonly definition: SketchDefinition;
  readonly history: readonly Pick<AuthoredAction, "writes">[];
}): string {
  return describeBlockedAction({
    ...input,
    whole: "the sketch",
    locate: (address) => {
      const [root, collection, id] = address;
      if (
        root !== "definition" ||
        collection === undefined ||
        id === undefined ||
        !Object.hasOwn(NAMED_SKETCH_RECORDS, collection)
      )
        return null;
      const key = collection as keyof typeof NAMED_SKETCH_RECORDS;
      return {
        naming: NAMED_SKETCH_RECORDS[key],
        id,
        records: input.definition[key] as
          | readonly Record<string, unknown>[]
          | undefined,
        root: ["definition", collection, id],
      };
    },
  });
}
