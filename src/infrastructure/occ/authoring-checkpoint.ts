import type { DocumentId } from "@/contracts/shared/ids";
import type { OccAuthoringState } from "@/infrastructure/occ/authoring-state";
import {
  collectOccOwnershipGraphObjects,
  releaseOccObjects,
  combineOccCleanupError,
  type OccDisposable,
} from "@/infrastructure/occ/memory";
import type { OpenCascadeInstance } from "@/infrastructure/occ/kernel-capabilities";
import {
  OccShapeSetCheckpointInvalidError,
  readOccShapeSetCheckpoint,
  writeOccShapeSetCheckpoint,
} from "@/infrastructure/occ/shape-set-checkpoint";
import { createOccTopologyProvenanceIndex } from "@/infrastructure/occ/topology-stage";

/**
 * cadara-3sq.6: the complete evaluated native state of an opened document, as
 * non-executable data a fresh process can adopt instead of replaying history.
 *
 * Boundary (recorded on the bead): every OccAuthoringState field except the
 * process-local runtime handle, asset resolver and the derived provenance
 * index. TopoDS wrappers go to one bit-exact native shape-set checkpoint
 * (cadara-3sq.7, shape-set-checkpoint.ts); every other value goes to a
 * reference-preserving JSON graph, so
 * shared objects and shared wrappers stay shared. Any other native object (a
 * TNaming document, an unknown wrapper class), a function or a class instance
 * makes the state not checkpointable.
 */
export const OCC_AUTHORING_CHECKPOINT_FORMAT =
  "cadara-occ-authoring-checkpoint/v1";

/** Process-local or derived; rebuilt on decode. */
const PROCESS_LOCAL_FIELDS = ["oc", "assetResolver", "topologyProvenanceIndex"];

/** Every persisted OccAuthoringState field; a new field must be classified here. */
const CHECKPOINT_FIELDS = [
  "documentId",
  "name",
  "revisionId",
  "modelingTolerance",
  "angularToleranceRadians",
  "sketches",
  "constructions",
  "constructionPlanes",
  "bodies",
  "baseBodies",
  "baseConstructions",
  "baseConstructionPlanes",
  "bodyLabels",
  "bodyAppearances",
  "variables",
  "features",
  "assets",
  "assetBlobs",
  "resolvedGeometryAssets",
  "bakedShapeCache",
  "previousTopologyStage",
  "authoredFeatures",
  "embeddedBinaryAssets",
  "historyOrder",
  "cursor",
  "diagnostics",
  "entities",
  "renderRecords",
  "referenceState",
  "featureTopologyStages",
  "previousFeatureTopologyStages",
  "previousFeatureTopologyLineage",
] as const;

/** Stands for the restoring session's document id inside the graph. */
const DOCUMENT_ID_TAG = "d";

const SHAPE_CLASSES = [
  "TopoDS_Shape",
  "TopoDS_Vertex",
  "TopoDS_Edge",
  "TopoDS_Wire",
  "TopoDS_Face",
  "TopoDS_Shell",
  "TopoDS_Solid",
  "TopoDS_Compound",
] as const;
type ShapeClass = (typeof SHAPE_CLASSES)[number];
const SHAPE_CASTS: Record<
  Exclude<ShapeClass, "TopoDS_Shape">,
  keyof OpenCascadeInstance["TopoDS"]
> = {
  TopoDS_Vertex: "Vertex_1",
  TopoDS_Edge: "Edge_1",
  TopoDS_Wire: "Wire_1",
  TopoDS_Face: "Face_1",
  TopoDS_Shell: "Shell_1",
  TopoDS_Solid: "Solid_1",
  TopoDS_Compound: "Compound_1",
};

const TYPED_ARRAYS = {
  Uint8Array,
  Int8Array,
  Uint16Array,
  Int16Array,
  Uint32Array,
  Int32Array,
  Float32Array,
  Float64Array,
} as const;
type TypedArrayName = keyof typeof TYPED_ARRAYS;

type OccShape = InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;

/** One TopoDS wrapper, in graph encounter order. */
export interface OccCheckpointShapeRecord {
  /** The embind wrapper class to restore (a TopoDS_Face stays a TopoDS_Face). */
  wrapper: ShapeClass;
  isNull: boolean;
  shapeType: number;
  orientation: number;
  /** Position of this (non-null) wrapper in the shape-set checkpoint. */
  mapIndex: number;
}

export interface OccAuthoringCheckpoint {
  format: typeof OCC_AUTHORING_CHECKPOINT_FORMAT;
  /** JSON graph of the state; native shapes are `{"g": index}` into `shapes`. */
  graph: string;
  shapes: OccCheckpointShapeRecord[];
  /** cadara-native-shape-set/v1 checkpoint of every non-null shape record. */
  brep: string;
}

/** The state cannot be represented faithfully; the open stays uncached. */
export class OccCheckpointUnsupportedError extends Error {
  readonly code = "occ-checkpoint-unsupported";
  constructor(message: string) {
    super(`occ-checkpoint-unsupported: ${message}`);
    this.name = "OccCheckpointUnsupportedError";
  }
}

/** Untrusted checkpoint data does not decode to a consistent state. */
export class OccCheckpointInvalidError extends Error {
  readonly code = "occ-checkpoint-invalid";
  constructor(message: string) {
    super(`occ-checkpoint-invalid: ${message}`);
    this.name = "OccCheckpointInvalidError";
  }
}

function enumValue(value: unknown) {
  return (value as { value: number }).value;
}

function shapeClassOf(
  oc: OpenCascadeInstance,
  value: object,
): ShapeClass | null {
  const prototype = Object.getPrototypeOf(value) as unknown;
  for (const name of SHAPE_CLASSES) {
    if (prototype === (oc[name] as unknown as { prototype: unknown }).prototype)
      return name;
  }
  return null;
}

/** An embind wrapper (any bound class) exposes `delete` and `isDeleted` on its prototype. */
function isEmbindObject(value: object) {
  return (
    typeof (value as OccDisposable).delete === "function" &&
    typeof (value as OccDisposable).isDeleted === "function"
  );
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(text: string, path: string) {
  let binary: string;
  try {
    binary = atob(text);
  } catch (error) {
    // atob reports malformed input as a DOMException (InvalidCharacterError).
    return invalid(path, `malformed base64 (${(error as Error).message}).`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Encodes `state` (synchronously, so no operation can change it meanwhile).
 * Throws OccCheckpointUnsupportedError when the state is outside the boundary.
 */
export function encodeOccAuthoringCheckpoint(
  state: OccAuthoringState,
): OccAuthoringCheckpoint {
  const oc = state.oc;
  const documentId = state.documentId;
  const fields = Object.keys(state).sort();
  const expected = [...CHECKPOINT_FIELDS, ...PROCESS_LOCAL_FIELDS].sort();
  if (fields.join() !== expected.join()) {
    throw new OccCheckpointUnsupportedError(
      `authoring state fields ${fields.join(",")} differ from the checkpoint boundary.`,
    );
  }

  const ids = new Map<object, number>();
  const shapes: OccShape[] = [];
  const records: OccCheckpointShapeRecord[] = [];
  const encode = (value: unknown, path: string): unknown => {
    if (value === undefined) return { u: 0 };
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") {
      if (value === documentId) return { [DOCUMENT_ID_TAG]: 0 };
      if (value.includes(documentId)) {
        throw new OccCheckpointUnsupportedError(
          `${path} embeds the session document id.`,
        );
      }
      return value;
    }
    if (typeof value === "number") {
      return Number.isFinite(value) && !Object.is(value, -0)
        ? value
        : { n: Object.is(value, -0) ? "-0" : String(value) };
    }
    if (typeof value !== "object") {
      throw new OccCheckpointUnsupportedError(
        `${path} holds a ${typeof value}.`,
      );
    }
    const seen = ids.get(value);
    if (seen !== undefined) return { r: seen };
    ids.set(value, ids.size);
    if (isEmbindObject(value)) {
      const wrapper = shapeClassOf(oc, value);
      if (!wrapper) {
        throw new OccCheckpointUnsupportedError(
          `${path} holds a native object outside the TopoDS shape classes.`,
        );
      }
      shapes.push(value as OccShape);
      records.push({
        wrapper,
        isNull: false,
        shapeType: 0,
        orientation: 0,
        mapIndex: 0,
      });
      return { g: shapes.length - 1 };
    }
    if (Array.isArray(value)) {
      return {
        a: value.map((entry, index) => encode(entry, `${path}[${index}]`)),
      };
    }
    if (value instanceof Map) {
      return {
        m: [...value].map(([key, entry], index) => [
          encode(key, `${path}<key ${index}>`),
          encode(entry, `${path}<${index}>`),
        ]),
      };
    }
    if (value instanceof Set) {
      return {
        s: [...value].map((entry, index) => encode(entry, `${path}{${index}}`)),
      };
    }
    if (ArrayBuffer.isView(value)) {
      const name = (Object.keys(TYPED_ARRAYS) as TypedArrayName[]).find(
        (candidate) =>
          Object.getPrototypeOf(value) === TYPED_ARRAYS[candidate].prototype,
      );
      if (!name)
        throw new OccCheckpointUnsupportedError(
          `${path} holds an unsupported binary view.`,
        );
      return {
        t: name,
        b: bytesToBase64(
          new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
        ),
      };
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new OccCheckpointUnsupportedError(
        `${path} holds a class instance.`,
      );
    }
    return {
      o: Object.keys(value).map((key) => [
        key,
        encode((value as Record<string, unknown>)[key], `${path}.${key}`),
      ]),
    };
  };
  // The state object itself is graph node 0, as the decoder numbers it.
  ids.set(state, 0);
  const graph = JSON.stringify({
    o: CHECKPOINT_FIELDS.map((field) => [field, encode(state[field], field)]),
  });

  // The ownership graph must own exactly the wrappers the checkpoint carries:
  // hydrated wrappers are then released by the same graph as rebuilt ones.
  const owned = collectOccOwnershipGraphObjects(state);
  if (
    owned.size !== shapes.length ||
    shapes.some((shape) => !owned.has(shape))
  ) {
    throw new OccCheckpointUnsupportedError(
      "native wrappers outside the shared ownership graph.",
    );
  }

  return {
    format: OCC_AUTHORING_CHECKPOINT_FORMAT,
    graph,
    shapes: records,
    brep: writeShapes(oc, shapes, records),
  };
}

// cadara-3sq.7 evidence: shapes go through the bit-exact native shape-set
// checkpoint; record.mapIndex is the shape's position in it.
function writeShapes(
  oc: OpenCascadeInstance,
  shapes: readonly OccShape[],
  records: OccCheckpointShapeRecord[],
) {
  const kept: OccShape[] = [];
  for (const [index, shape] of shapes.entries()) {
    const record = records[index]!;
    record.isNull = shape.IsNull();
    if (record.isNull) continue;
    record.shapeType = enumValue(shape.ShapeType());
    record.orientation = enumValue(shape.Orientation_1());
    record.mapIndex = kept.length;
    kept.push(shape);
  }
  return writeOccShapeSetCheckpoint(oc, kept);
}

const SHAPE_TYPE_ENUMS = [
  "TopAbs_COMPOUND",
  "TopAbs_COMPSOLID",
  "TopAbs_SOLID",
  "TopAbs_SHELL",
  "TopAbs_FACE",
  "TopAbs_WIRE",
  "TopAbs_EDGE",
  "TopAbs_VERTEX",
] as const;
const ORIENTATION_ENUMS = [
  "TopAbs_FORWARD",
  "TopAbs_REVERSED",
  "TopAbs_INTERNAL",
  "TopAbs_EXTERNAL",
] as const;

/**
 * Reads the shape records back into fresh wrappers, checking each recorded
 * type. On any failure every wrapper made here is released before the error
 * leaves.
 */
function readShapes(
  oc: OpenCascadeInstance,
  checkpoint: Pick<OccAuthoringCheckpoint, "shapes" | "brep">,
) {
  let restored: OccShape[];
  try {
    restored = readOccShapeSetCheckpoint(oc, checkpoint.brep);
  } catch (error) {
    if (error instanceof OccShapeSetCheckpointInvalidError)
      throw new OccCheckpointInvalidError(error.message);
    throw error;
  }
  const temporaries: OccDisposable[] = [];
  const decoded: OccShape[] = [];
  const used = new Set<number>();
  let failure: unknown;
  try {
    for (const [index, record] of checkpoint.shapes.entries()) {
      if (record.isNull) {
        decoded.push(new oc.TopoDS_Shape());
        continue;
      }
      const shapeTypeName = SHAPE_TYPE_ENUMS[record.shapeType];
      const orientationName = ORIENTATION_ENUMS[record.orientation];
      const source = restored[record.mapIndex];
      if (
        !shapeTypeName ||
        !orientationName ||
        !source ||
        used.has(record.mapIndex)
      ) {
        throw new OccCheckpointInvalidError(
          `shape ${index} has an invalid record.`,
        );
      }
      used.add(record.mapIndex);
      if (
        enumValue(source.ShapeType()) !== record.shapeType ||
        enumValue(source.Orientation_1()) !== record.orientation
      ) {
        throw new OccCheckpointInvalidError(
          `shape ${index} does not have its recorded type.`,
        );
      }
      if (record.wrapper === "TopoDS_Shape") {
        decoded.push(source);
        continue;
      }
      const cast = SHAPE_CASTS[record.wrapper];
      if (!cast)
        throw new OccCheckpointInvalidError(
          `shape ${index} has an unknown wrapper class.`,
        );
      temporaries.push(source);
      decoded.push((oc.TopoDS[cast] as (input: OccShape) => OccShape)(source));
    }
    if (used.size !== restored.length) {
      throw new OccCheckpointInvalidError(
        "the geometry holds shapes no record refers to.",
      );
    }
  } catch (error) {
    failure = error;
  }
  try {
    releaseOccObjects(
      failure === undefined
        ? temporaries
        : new Set([...temporaries, ...decoded, ...restored]),
    );
  } catch (cleanupError) {
    throw failure === undefined
      ? cleanupError
      : combineOccCleanupError(failure, cleanupError);
  }
  if (failure !== undefined) throw failure;
  return decoded;
}

function invalid(path: string, message: string): never {
  throw new OccCheckpointInvalidError(`${path}: ${message}`);
}

/**
 * Decodes untrusted checkpoint data into a fresh, isolated authoring state for
 * `documentId`. Nothing is adopted here; on failure every wrapper decoded so far
 * is released and OccCheckpointInvalidError (or a cleanup error) is thrown.
 */
export function decodeOccAuthoringCheckpoint(
  oc: OpenCascadeInstance,
  checkpoint: Pick<OccAuthoringCheckpoint, "graph" | "shapes" | "brep">,
  context: Pick<OccAuthoringState, "assetResolver"> & {
    documentId: DocumentId;
  },
): OccAuthoringState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(checkpoint.graph);
  } catch (error) {
    throw new OccCheckpointInvalidError(
      `the state graph is not JSON (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  const shapes = readShapes(oc, checkpoint);
  const used = new Set<number>();
  const objects: unknown[] = [];
  const isNode = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const list = (value: unknown, path: string) =>
    Array.isArray(value) ? value : invalid(path, "expected a list.");
  const decode = (node: unknown, path: string): unknown => {
    if (node === null || typeof node === "boolean" || typeof node === "string")
      return node;
    if (typeof node === "number")
      return Number.isFinite(node) ? node : invalid(path, "non-finite number.");
    if (!isNode(node)) return invalid(path, "unexpected value.");
    const keys = Object.keys(node);
    const tag = keys[0];
    if (keys.length === 1 && tag === "u") return undefined;
    if (keys.length === 1 && tag === DOCUMENT_ID_TAG) return context.documentId;
    if (keys.length === 1 && tag === "n") {
      const special = (
        {
          "-0": -0,
          NaN: Number.NaN,
          Infinity: Infinity,
          "-Infinity": -Infinity,
        } as Record<string, number>
      )[String(node.n)];
      return special ?? invalid(path, "unknown special number.");
    }
    if (keys.length === 1 && tag === "r") {
      const id = node.r;
      return typeof id === "number" &&
        Number.isInteger(id) &&
        id >= 0 &&
        id < objects.length
        ? objects[id]
        : invalid(path, "dangling reference.");
    }
    if (keys.length === 1 && tag === "g") {
      const index = node.g;
      if (
        typeof index !== "number" ||
        !Number.isInteger(index) ||
        !shapes[index] ||
        used.has(index)
      ) {
        return invalid(path, "unknown or repeated shape.");
      }
      used.add(index);
      objects.push(shapes[index]);
      return shapes[index];
    }
    if (keys.length === 1 && tag === "a") {
      const value: unknown[] = [];
      objects.push(value);
      for (const [index, entry] of list(node.a, path).entries())
        value.push(decode(entry, `${path}[${index}]`));
      return value;
    }
    if (keys.length === 1 && tag === "m") {
      const value = new Map<unknown, unknown>();
      objects.push(value);
      for (const [index, entry] of list(node.m, path).entries()) {
        const pair = list(entry, path);
        if (pair.length !== 2) invalid(path, "map entries are pairs.");
        const key = decode(pair[0], `${path}<key ${index}>`);
        value.set(key, decode(pair[1], `${path}<${index}>`));
      }
      return value;
    }
    if (keys.length === 1 && tag === "s") {
      const value = new Set<unknown>();
      objects.push(value);
      for (const [index, entry] of list(node.s, path).entries())
        value.add(decode(entry, `${path}{${index}}`));
      return value;
    }
    if (
      keys.length === 2 &&
      tag === "t" &&
      typeof node.t === "string" &&
      typeof node.b === "string" &&
      node.t in TYPED_ARRAYS
    ) {
      const bytes = base64ToBytes(node.b, path);
      const View = TYPED_ARRAYS[node.t as TypedArrayName];
      if (bytes.byteLength % View.BYTES_PER_ELEMENT !== 0)
        invalid(path, "truncated binary view.");
      const value = new View(
        bytes.buffer,
        0,
        bytes.byteLength / View.BYTES_PER_ELEMENT,
      );
      objects.push(value);
      return value;
    }
    if (keys.length === 1 && tag === "o") {
      const value: Record<string, unknown> = {};
      objects.push(value);
      for (const entry of list(node.o, path)) {
        const pair = list(entry, path);
        if (pair.length !== 2 || typeof pair[0] !== "string")
          invalid(path, "object entries are [key, value].");
        // defineProperty: a "__proto__" key stays a plain own property.
        Object.defineProperty(value, pair[0] as string, {
          value: decode(pair[1], `${path}.${pair[0] as string}`),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return value;
    }
    return invalid(path, `unknown node ${JSON.stringify(keys)}.`);
  };

  let state: OccAuthoringState;
  try {
    let decoded: unknown;
    try {
      decoded = decode(parsed, "state");
    } catch (error) {
      // Untrusted nesting can exhaust the decoder's stack.
      if (error instanceof RangeError)
        throw new OccCheckpointInvalidError(
          `the state graph is too deep (${error.message}).`,
        );
      throw error;
    }
    if (
      !isNode(decoded) ||
      Object.keys(decoded).join() !== CHECKPOINT_FIELDS.join()
    ) {
      throw new OccCheckpointInvalidError(
        "the state graph does not hold exactly the checkpoint fields.",
      );
    }
    if (used.size !== shapes.length) {
      throw new OccCheckpointInvalidError(
        "the geometry holds shapes the state graph never references.",
      );
    }
    const fields = decoded as unknown as OccAuthoringState;
    if (fields.documentId !== context.documentId) {
      throw new OccCheckpointInvalidError(
        "the state belongs to another document.",
      );
    }
    state = {
      ...fields,
      oc,
      assetResolver: context.assetResolver,
      // Never read for execution (each feature run builds its own index).
      topologyProvenanceIndex: createOccTopologyProvenanceIndex({
        stages: fields.featureTopologyStages,
        previousLineage: fields.previousFeatureTopologyLineage,
        historyOrder: fields.historyOrder,
      }),
    };
    const owned = collectOccOwnershipGraphObjects(state);
    if (
      owned.size !== shapes.length ||
      shapes.some((shape) => !owned.has(shape))
    ) {
      throw new OccCheckpointInvalidError(
        "decoded wrappers are outside the ownership graph.",
      );
    }
  } catch (error) {
    try {
      releaseOccObjects(shapes);
    } catch (cleanupError) {
      throw combineOccCleanupError(error, cleanupError);
    }
    throw error;
  }
  return state;
}
