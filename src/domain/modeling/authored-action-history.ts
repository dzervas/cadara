import type {
  AuthoredAction,
  AuthoredActionIdentity,
  AuthoredActionResult,
  AuthoredActionState,
  AuthoredAddress,
  AuthoredFieldWrite,
  AuthoredPresence,
  AuthoredValue,
} from "@/contracts/modeling/authored-actions";
import type { SketchId } from "@/contracts/shared/ids";

export {
  encode as encodeAuthoredActionState,
  decode as decodeAuthoredActionState,
};

type Fields = { [key: string]: AuthoredValue };
const sketchCollections = {
  references: "referenceId",
  points: "pointId",
  entities: "entityId",
  constraints: "constraintId",
  dimensions: "dimensionId",
  styles: "styleId",
  referenceImages: "operationId",
  derivedRelationships: "derivationId",
};
const documentCollections = {
  variables: "variableId",
  sketches: "sketchId",
  features: "featureId",
  bodyLabels: "bodyId",
  bodyAppearances: "bodyId",
  embeddedBinaryAssets: "assetId",
};
const canonicalIds = {
  references: "referenceIds",
  points: "pointIds",
  entities: "entityIds",
  constraints: "constraintIds",
  dimensions: "dimensionIds",
  styles: "styleIds",
};
const object = (value: unknown): value is Fields =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function remapSemanticSketchIds<T>(
  value: T,
  replacements: ReadonlyMap<string, string>,
): T {
  if (Array.isArray(value))
    return value.map((entry) =>
      remapSemanticSketchIds(entry, replacements),
    ) as T;
  if (!object(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === "sketchId" && typeof entry === "string"
        ? (replacements.get(entry) ?? entry)
        : remapSemanticSketchIds(entry, replacements),
    ]),
  ) as T;
}

function remapAddress(
  address: AuthoredAddress,
  replacements: ReadonlyMap<string, string>,
): AuthoredAddress {
  return address.map((part, index) =>
    index > 0 && address[index - 1] === "sketches"
      ? (replacements.get(part) ?? part)
      : part,
  );
}

function remapDependencyPath(
  path: string,
  replacements: ReadonlyMap<string, string>,
) {
  try {
    const parsed: unknown = JSON.parse(path);
    return Array.isArray(parsed) &&
      parsed.every((part) => typeof part === "string")
      ? JSON.stringify(remapAddress(parsed, replacements))
      : path;
  } catch {
    return path;
  }
}

function withoutUndefined(value: unknown): AuthoredValue {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (!object(value)) return value as AuthoredValue;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, withoutUndefined(entry)]),
  );
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (!object(a) || !object(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
  );
}
function collections(
  data: Fields,
  schema: Record<string, string>,
  encode: boolean,
) {
  for (const [key, id] of Object.entries(schema)) {
    if (data[key] === undefined) continue;
    if (encode) {
      const records = data[key] as Fields[];
      const entries = records.map(
        (record) => [String(record[id]), record] as const,
      );
      if (new Set(entries.map(([key]) => key)).size !== entries.length)
        throw new Error(`Duplicate authored identity in ${key}`);
      data[key] = Object.fromEntries(entries);
    } else data[key] = Object.values(data[key] as Fields);
  }
}
function splineOccurrences(definition: Fields, encode: boolean) {
  const entities = definition.entities as Fields[] | Record<string, Fields>;
  const records = Array.isArray(entities) ? entities : Object.values(entities);
  for (const entity of records) {
    if (entity.kind !== "spline") continue;
    const order = entity.pointOccurrenceIds as string[];
    if (encode) {
      const occurrences = entity.pointOccurrences as Fields[];
      const entries = occurrences.map(
        (occurrence) => [String(occurrence.occurrenceId), occurrence] as const,
      );
      if (new Set(entries.map(([id]) => id)).size !== entries.length)
        throw new Error(
          "Duplicate authored identity in spline pointOccurrences",
        );
      entity.pointOccurrences = Object.fromEntries(entries);
    } else {
      const occurrences = entity.pointOccurrences as Record<string, Fields>;
      entity.pointOccurrences = order.map((id) => occurrences[id]);
    }
  }
}
function sketch(data: Fields, encode: boolean) {
  const definition = data.definition as Fields;
  if (encode) splineOccurrences(definition, true);
  collections(definition, sketchCollections, encode);
  if (!encode) splineOccurrences(definition, false);
  for (const [records, ids] of Object.entries(canonicalIds)) {
    if (encode) delete definition[ids];
    else if (definition[records] !== undefined)
      definition[ids] = (definition[records] as Fields[]).map(
        (record) =>
          record[sketchCollections[records as keyof typeof sketchCollections]],
      );
  }
}
/** Only authored fields enter the ledger; canonical membership arrays materialize from stable records.
 * Feature/history order, spline occurrence order, control points, operands and other meaningful sequences stay atomic.
 * Stable spline occurrence records are projected separately so independent tangent fields remain independent writes.
 */
function encode(state: AuthoredActionState): Fields {
  const data = withoutUndefined(structuredClone(state.data)) as Fields;
  if (state.context.kind === "sketch") sketch(data, true);
  else {
    delete data.revisionId;
    delete data.topologyLineage;
    for (const record of data.sketches as Fields[]) sketch(record, true);
    collections(data, documentCollections, true);
    collections(data.assets as Fields, { records: "assetId" }, true);
  }
  return data;
}
function decode(state: AuthoredActionState, data: Fields): AuthoredActionState {
  if (state.context.kind === "sketch") sketch(data, false);
  else {
    collections(data, documentCollections, false);
    collections(data.assets as Fields, { records: "assetId" }, false);
    for (const record of data.sketches as Fields[]) sketch(record, false);
  }
  return { ...state, data } as unknown as AuthoredActionState;
}
function presence(value: Fields, key: string): AuthoredPresence {
  return Object.hasOwn(value, key)
    ? { exists: true, value: value[key] }
    : { exists: false };
}
function read(root: Fields, address: AuthoredAddress): AuthoredPresence {
  let value: AuthoredValue = root;
  for (const key of address) {
    if (!object(value) || !Object.hasOwn(value, key)) return { exists: false };
    value = value[key];
  }
  return { exists: true, value };
}
function diff(
  before: Fields,
  after: Fields,
  address: string[] = [],
): AuthoredFieldWrite[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(
    (key) => {
      const left = presence(before, key),
        right = presence(after, key);
      if (equal(left, right)) return [];
      if (
        left.exists &&
        right.exists &&
        object(left.value) &&
        object(right.value)
      )
        return diff(left.value, right.value, [...address, key]);
      return [{ address: [...address, key], before: left, after: right }];
    },
  );
}
function define(parent: Fields, key: string, value: AuthoredValue) {
  Object.defineProperty(parent, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}
/** T17-8′: for each collection (JSON address) in which an action creates or removes
 * records, its record order on the side(s) where they exist. A record re-created by
 * Undo/Redo goes back after its predecessor in that order, else after the nearest earlier
 * id still present, else first. Membership `*Ids` arrays stay derived from record order.
 */
type RecordOrders = Record<string, { before?: string[]; after?: string[] }>;
type LedgerAction = AuthoredAction & { orders: RecordOrders };
function contractAction({
  sequence,
  identity,
  label,
  writes,
  dependencies,
}: LedgerAction): AuthoredAction {
  return structuredClone({ sequence, identity, label, writes, dependencies });
}
function recordOrders(
  writes: readonly AuthoredFieldWrite[],
  before: Fields,
  after: Fields,
): RecordOrders {
  const orders: RecordOrders = {};
  for (const change of writes) {
    if (
      recordId(change.address) === undefined ||
      change.before.exists === change.after.exists
    )
      continue;
    const side = change.before.exists ? "before" : "after";
    const address = change.address.slice(0, -1);
    const key = JSON.stringify(address);
    if (orders[key]?.[side]) continue;
    const collection = read(side === "before" ? before : after, address);
    if (collection.exists && object(collection.value))
      orders[key] = { ...orders[key], [side]: Object.keys(collection.value) };
  }
  return orders;
}
/** Puts the records `created` (appended by this pass) back at their positions in
 * `order`, rebuilding the collection once: each goes after the nearest earlier id
 * of `order` that is present (possibly another created one), else first.
 */
function placeRecords(
  parent: Fields,
  created: ReadonlySet<string>,
  order: readonly string[],
) {
  const position = new Map(order.map((id, index) => [id, index]));
  const followers = new Map<string | null, string[]>();
  for (const id of [...created].sort(
    (left, right) => position.get(left)! - position.get(right)!,
  )) {
    let anchor: string | null = null;
    for (let index = position.get(id)! - 1; index >= 0; index--)
      if (Object.hasOwn(parent, order[index]!)) {
        anchor = order[index]!;
        break;
      }
    const list = followers.get(anchor);
    if (list) list.push(id);
    else followers.set(anchor, [id]);
  }
  const entries: [string, AuthoredValue][] = [];
  // Depth-first, iteratively: chains of re-created records can be long.
  const emit = (anchor: string | null) => {
    const stack: string[] = [];
    const follow = (from: string | null) => {
      const list = followers.get(from) ?? [];
      for (let index = list.length - 1; index >= 0; index--)
        stack.push(list[index]!);
    };
    follow(anchor);
    for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
      entries.push([id, parent[id]!]);
      follow(id);
    }
  };
  emit(null);
  for (const [key, value] of Object.entries(parent)) {
    if (created.has(key)) continue;
    entries.push([key, value]);
    emit(key);
  }
  for (const [key] of entries) delete parent[key];
  for (const [key, entry] of entries) define(parent, key, entry);
}
function parentOf(root: Fields, address: AuthoredAddress) {
  let parent = root;
  for (const key of address.slice(0, -1)) parent = parent[key] as Fields;
  return parent;
}
function write(root: Fields, change: AuthoredFieldWrite) {
  const parent = parentOf(root, change.address);
  const key = change.address.at(-1)!;
  if (change.after.exists)
    define(parent, key, structuredClone(change.after.value));
  else delete parent[key];
}
function references(
  root: AuthoredValue,
  id: string,
  excluded: AuthoredAddress,
  path: string[] = [],
): string[] {
  if (equal(path, excluded)) return [];
  if (root === id) return [JSON.stringify(path)];
  if (root === null || typeof root !== "object") return [];
  return Object.entries(root).flatMap(([key, value]) =>
    references(value, id, excluded, [...path, key]),
  );
}
function recordId(address: AuthoredAddress): string | undefined {
  // Identity comes from the collection schema, never from reference-valued fields
  // such as a constraint's entityId or a dimension's pointId.
  if (address.length === 2 && Object.hasOwn(documentCollections, address[0]))
    return address[1];
  if (
    address.length === 3 &&
    address[0] === "assets" &&
    address[1] === "records"
  )
    return address[2];
  const local =
    address.length === 5 && address[0] === "sketches"
      ? address.slice(2)
      : address;
  if (
    local.length === 3 &&
    local[0] === "definition" &&
    Object.hasOwn(sketchCollections, local[1])
  )
    return local[2];
}
function overlaps(left: AuthoredAddress, right: AuthoredAddress): boolean {
  return left
    .slice(0, Math.min(left.length, right.length))
    .every((part, index) => part === right[index]);
}

function applyWrites(
  data: Fields,
  writes: readonly AuthoredFieldWrite[],
  dependencies: AuthoredAction["dependencies"],
  side: "before" | "after",
  orders: RecordOrders = {},
): AuthoredActionResult | undefined {
  const targets = writes
    .filter((change) => !equal(read(data, change.address), change.before))
    .map((change) => change.address);
  // A missing ancestor is a conflict even when the leaf was originally absent.
  for (const change of writes)
    for (let length = 1; length < change.address.length; length++) {
      const ancestor = read(data, change.address.slice(0, length));
      if (!ancestor.exists || !object(ancestor.value)) {
        targets.push(change.address);
        break;
      }
    }
  if (targets.length)
    return { status: "blocked", reason: "expected-state-changed", targets };
  // A created record takes its recorded position (the candidate's on a commit);
  // each collection is rebuilt once per pass (T17f review A-1).
  const created = new Map<
    string,
    { parent: Fields; order: readonly string[]; ids: Set<string> }
  >();
  for (const change of writes) {
    const collection = JSON.stringify(change.address.slice(0, -1));
    const order = orders[collection]?.[side];
    const parent = parentOf(data, change.address);
    const id = change.address.at(-1)!;
    const fresh =
      order !== undefined &&
      change.after.exists &&
      recordId(change.address) !== undefined &&
      !Object.hasOwn(parent, id);
    write(data, change);
    if (!fresh) continue;
    const entry = created.get(collection) ?? { parent, order, ids: new Set() };
    entry.ids.add(id);
    created.set(collection, entry);
  }
  for (const { parent, order, ids } of created.values()) {
    const ordered = new Set(order);
    placeRecords(
      parent,
      new Set([...ids].filter((id) => ordered.has(id))),
      order,
    );
  }
  const dependentTargets = dependencies
    .filter((dependency) => {
      if (
        !writes.some(
          (change) =>
            equal(change.address, dependency.address) && !change.after.exists,
        )
      )
        return false;
      return references(data, dependency.id, dependency.address).some(
        (path) => !dependency[side].includes(path),
      );
    })
    .map((dependency) => dependency.address);
  if (dependentTargets.length)
    return {
      status: "blocked",
      reason: "dependent-record-changed",
      targets: dependentTargets,
    };
}

/** One session owner. Call synchronously inside the repository's atomic check/write boundary.
 * Persist the returned state and granular writes in that same transaction. Never await between
 * reading current state and applying a result. The owner is session-local, not a CRDT/history snapshot.
 */
export class AuthoredActionHistory {
  private ledgers = new Map<
    string,
    { undo: LedgerAction[]; redo: LedgerAction[] }
  >();
  private sequence = 0;

  /** Stage history alongside a repository transaction. Adopt this fork only after storage
   * succeeds; discard it on failure. Repositories must serialize their atomic boundary.
   */
  fork(): AuthoredActionHistory {
    const staged = new AuthoredActionHistory();
    staged.ledgers = structuredClone(this.ledgers);
    staged.sequence = this.sequence;
    return staged;
  }

  private ledgerKey(identity: AuthoredActionIdentity) {
    return JSON.stringify([
      identity.actorId,
      identity.documentId,
      identity.context.kind,
      identity.context.kind === "sketch" ? identity.context.sketchId : null,
    ]);
  }

  /** Reconciles a private draft context with the published identity.
   * Only semantic sketch IDs and stable address segments are replaced; arbitrary authored
   * strings and property keys remain byte-for-byte unchanged.
   */
  remapSketchContext(
    identity: AuthoredActionIdentity,
    publishedSketchId: SketchId,
    aliases: readonly string[] = [],
  ): AuthoredActionIdentity {
    if (identity.context.kind !== "sketch") return identity;
    const nextIdentity: AuthoredActionIdentity = {
      ...identity,
      context: { kind: "sketch", sketchId: publishedSketchId },
    };
    const oldKey = this.ledgerKey(identity);
    const nextKey = this.ledgerKey(nextIdentity);
    if (oldKey !== nextKey && this.ledgers.has(nextKey))
      throw new Error(
        `Sketch action history already exists for ${publishedSketchId}.`,
      );
    const ledger = this.ledgers.get(oldKey);
    if (!ledger) return nextIdentity;
    const replacements = new Map<string, string>([
      [identity.context.sketchId, publishedSketchId],
      ...aliases.map((alias) => [alias, publishedSketchId] as const),
    ]);
    const remapPresence = (presence: AuthoredPresence): AuthoredPresence =>
      presence.exists
        ? {
            exists: true,
            value: remapSemanticSketchIds(presence.value, replacements),
          }
        : presence;
    const remapAction = (action: LedgerAction): LedgerAction => ({
      ...action,
      identity: structuredClone(nextIdentity),
      // Sketch-context collections hold no sketch ids; only their addresses remap.
      orders: Object.fromEntries(
        Object.entries(action.orders).map(([address, order]) => [
          JSON.stringify(
            remapAddress(JSON.parse(address) as string[], replacements),
          ),
          order,
        ]),
      ),
      writes: action.writes.map((change) => ({
        address: remapAddress(change.address, replacements),
        before: remapPresence(change.before),
        after: remapPresence(change.after),
      })),
      dependencies: action.dependencies.map((dependency) => ({
        ...dependency,
        address: remapAddress(dependency.address, replacements),
        id:
          dependency.address[0] === "sketches"
            ? (replacements.get(dependency.id) ?? dependency.id)
            : dependency.id,
        before: dependency.before.map((path) =>
          remapDependencyPath(path, replacements),
        ),
        after: dependency.after.map((path) =>
          remapDependencyPath(path, replacements),
        ),
      })),
    });
    if (oldKey !== nextKey) this.ledgers.delete(oldKey);
    this.ledgers.set(nextKey, {
      undo: ledger.undo.map(remapAction),
      redo: ledger.redo.map(remapAction),
    });
    return nextIdentity;
  }

  private ledger(identity: AuthoredActionIdentity) {
    const key = this.ledgerKey(identity);
    let ledger = this.ledgers.get(key);
    if (!ledger) {
      ledger = { undo: [], redo: [] };
      this.ledgers.set(key, ledger);
    }
    return ledger;
  }
  entries(identity: AuthoredActionIdentity): {
    undo: readonly AuthoredAction[];
    redo: readonly AuthoredAction[];
  } {
    const ledger = this.ledger(identity);
    return {
      undo: ledger.undo.map(contractAction),
      redo: ledger.redo.map(contractAction),
    };
  }
  private check(
    identity: AuthoredActionIdentity,
    state: AuthoredActionState,
  ): AuthoredActionResult | undefined {
    if (
      identity.documentId !== state.documentId ||
      !equal(identity.context, state.context) ||
      (state.context.kind === "document" &&
        state.data !== null &&
        (!("documentId" in state.data) ||
          state.data.documentId !== identity.documentId)) ||
      (state.context.kind === "sketch" &&
        state.data !== null &&
        (!("sketchId" in state.data) ||
          state.data.sketchId !== state.context.sketchId))
    ) {
      return { status: "blocked", reason: "identity-mismatch", targets: [] };
    }
    if (state.data === null)
      return { status: "blocked", reason: "context-missing", targets: [] };
  }
  /** expected MUST be the unchanged base used to produce candidate (not a fresh read).
   * current MUST be read in the repository transaction. Both are required even for
   * synchronous edits: substituting current for an older base can overwrite peer work.
   * Stage on fork(), write the result atomically, then adopt the fork after success.
   */
  commit(
    identity: AuthoredActionIdentity,
    current: AuthoredActionState,
    candidate: AuthoredActionState,
    label: string,
    expected: AuthoredActionState,
  ): AuthoredActionResult {
    const blocked =
      this.check(identity, current) ??
      this.check(identity, candidate) ??
      this.check(identity, expected);
    if (blocked) return blocked;
    const before = encode(expected),
      after = encode(candidate);
    const writes = diff(before, after);
    if (!writes.length) return { status: "unchanged" };
    const action: LedgerAction = {
      sequence: this.sequence + 1,
      identity: structuredClone(identity),
      label,
      writes,
      dependencies: writes.flatMap((change) => {
        if (change.before.exists === change.after.exists) return [];
        const id = recordId(change.address);
        return id === undefined
          ? []
          : [
              {
                address: change.address,
                id,
                before: references(before, id, change.address),
                after: references(after, id, change.address),
              },
            ];
      }),
      orders: recordOrders(writes, before, after),
    };
    const data = encode(current);
    const conflict = applyWrites(
      data,
      writes,
      action.dependencies,
      "after",
      action.orders,
    );
    if (conflict) return conflict;
    const ledger = this.ledger(identity);
    this.sequence = action.sequence;
    // A timeline cursor move changes evaluation context, not authored intent.
    // Keep its checked writes in repository storage, but do not create an undo
    // entry or discard redo. Mixed authored actions retain their cursor writes
    // (e.g. creating a feature also selects it) for document validity.
    // A document saved before body colours gets its auto palette slots on open
    // (kernel state only) and persists them with its next write; when that write
    // is a cursor move, creating those records is not authored intent either.
    const cursorOnly = identity.context.kind === "document" &&
      writes.some((change) => change.address[0] === "cursor") &&
      writes.every(
        (change) =>
          change.address[0] === "cursor" ||
          (change.address[0] === "bodyAppearances" && !change.before.exists),
      );
    if (!cursorOnly) {
      ledger.undo.push(structuredClone(action));
      ledger.undo = ledger.undo.slice(-250);
      ledger.redo = [];
    }
    return {
      status: "applied",
      state: decode(current, data),
      action: contractAction(action),
      direction: "commit",
      writes,
    };
  }
  /** Defaults to the newest action, without skipping conflicts. A UI may deliberately
   * select an entries().undo sequence to compensate an independent older intent.
   */
  undo(
    identity: AuthoredActionIdentity,
    current: AuthoredActionState,
    actionSequence?: number,
  ): AuthoredActionResult {
    return this.compensate(identity, current, "undo", actionSequence);
  }
  /** Default Redo restores the most recently undone intent; explicit selection is also checked. */
  redo(
    identity: AuthoredActionIdentity,
    current: AuthoredActionState,
    actionSequence?: number,
  ): AuthoredActionResult {
    return this.compensate(identity, current, "redo", actionSequence);
  }
  private compensate(
    identity: AuthoredActionIdentity,
    current: AuthoredActionState,
    direction: "undo" | "redo",
    actionSequence?: number,
  ): AuthoredActionResult {
    const blocked = this.check(identity, current);
    if (blocked) return blocked;
    const ledger = this.ledger(identity),
      source = ledger[direction];
    const index =
      actionSequence === undefined
        ? source.length - 1
        : source.findIndex((entry) => entry.sequence === actionSequence);
    const action = source[index];
    if (!action)
      return actionSequence === undefined
        ? { status: "unchanged" }
        : { status: "blocked", reason: "action-not-found", targets: [] };
    // Even an ABA value match must not overwrite a later still-applied local action.
    const overlapsLater = action.writes.filter((write) =>
      ledger.undo.some(
        (later) =>
          later.sequence > action.sequence &&
          later.writes.some((other) => overlaps(write.address, other.address)),
      ),
    );
    if (overlapsLater.length)
      return {
        status: "blocked",
        reason: "later-action-overlap",
        targets: overlapsLater.map((write) => write.address),
      };
    const writes = action.writes.map((change) =>
      direction === "undo"
        ? {
            address: change.address,
            before: change.after,
            after: change.before,
          }
        : change,
    );
    const data = encode(current);
    const conflict = applyWrites(
      data,
      writes,
      action.dependencies,
      direction === "undo" ? "before" : "after",
      action.orders,
    );
    if (conflict) return conflict;
    source.splice(index, 1);
    ledger[direction === "undo" ? "redo" : "undo"].push(action);
    // Restoring an older intent must not make it the next default Undo ahead of newer work.
    if (direction === "redo")
      ledger.undo.sort((left, right) => left.sequence - right.sequence);
    return {
      status: "applied",
      state: decode(current, data),
      action: contractAction(action),
      direction,
      writes: structuredClone(writes),
    };
  }
}
