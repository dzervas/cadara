import type { OpenCascadeInstance } from "@/infrastructure/occ/kernel-capabilities";
import {
  combineOccCleanupError,
  releaseOccObjects,
  type OccDisposable,
} from "@/infrastructure/occ/memory";

/**
 * cadara-3sq.7: bit-exact persistence of an ordered list of TopoDS shapes
 * through the production kernel's CadaraNativeShapeSetCheckpoint shim
 * (occ-native-shims/cadara-native-shape-set-checkpoint*.inc).
 *
 * Unlike the text BRep writer (15 significant digits, locations rebuilt through
 * gp_Trsf::SetValues), every geometry, triangulation and location double comes
 * back bit for bit, with TShape sharing, orientations and location chains.
 * The checkpoint is ASCII text, so callers can store it as a string.
 */
export const OCC_SHAPE_SET_CHECKPOINT_FORMAT = "cadara-native-shape-set/v1";

type OccShape = InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;

/** The native result of a write or read; the caller owns it and every shape it hands out. */
interface NativeShapeSetCheckpointResult {
  IsDone(): boolean;
  ErrorMessage(): string;
  Checkpoint(): string;
  ChildCount(): number;
  Child(index: number): OccShape;
  delete(): void;
}

interface NativeShapeSetCheckpointHost {
  CadaraNativeShapeSetCheckpoint?: {
    FormatVersion(): string;
    Write(root: OccShape): NativeShapeSetCheckpointResult;
    Read(checkpoint: string): NativeShapeSetCheckpointResult;
  };
}

/**
 * The input is not valid: a checkpoint that cannot be read back (malformed,
 * truncated, foreign or from another format), or a null shape to write.
 */
export class OccShapeSetCheckpointInvalidError extends Error {
  readonly code = "occ-shape-set-checkpoint-invalid";
  constructor(message: string) {
    super(`occ-shape-set-checkpoint-invalid: ${message}`);
    this.name = "OccShapeSetCheckpointInvalidError";
  }
}

/** The kernel failed to write the shapes; the message carries the native cause. */
export class OccShapeSetCheckpointWriteError extends Error {
  readonly code = "occ-shape-set-checkpoint-write-failed";
  constructor(message: string) {
    super(`occ-shape-set-checkpoint-write-failed: ${message}`);
    this.name = "OccShapeSetCheckpointWriteError";
  }
}

/** The loaded kernel cannot write or read shape-set checkpoints. */
export class OccShapeSetCheckpointUnavailableError extends Error {
  readonly code = "occ-shape-set-checkpoint-unavailable";
  constructor(message: string) {
    super(`occ-shape-set-checkpoint-unavailable: ${message}`);
    this.name = "OccShapeSetCheckpointUnavailableError";
  }
}

function nativeCheckpoint(oc: OpenCascadeInstance) {
  const native = (oc as unknown as NativeShapeSetCheckpointHost)
    .CadaraNativeShapeSetCheckpoint;
  if (native?.FormatVersion() !== OCC_SHAPE_SET_CHECKPOINT_FORMAT) {
    throw new OccShapeSetCheckpointUnavailableError(
      `the kernel does not provide ${OCC_SHAPE_SET_CHECKPOINT_FORMAT}.`,
    );
  }
  return native;
}

/**
 * Writes `shapes` (none null) in order. Reading the result yields shapes equal
 * to these: shared wrappers stay shared, orientations and locations are kept.
 */
export function writeOccShapeSetCheckpoint(
  oc: OpenCascadeInstance,
  shapes: readonly OccShape[],
): string {
  const native = nativeCheckpoint(oc);
  const temporaries: OccDisposable[] = [];
  try {
    const builder = new oc.BRep_Builder();
    temporaries.push(builder);
    const root = new oc.TopoDS_Compound();
    temporaries.push(root);
    builder.MakeCompound(root);
    for (const [index, shape] of shapes.entries()) {
      if (shape.IsNull()) {
        throw new OccShapeSetCheckpointInvalidError(
          `shape ${index} is null; a checkpoint holds only non-null shapes.`,
        );
      }
      builder.Add(root, shape);
    }
    const written = native.Write(root);
    temporaries.push(written);
    if (!written.IsDone()) {
      throw new OccShapeSetCheckpointWriteError(written.ErrorMessage());
    }
    return written.Checkpoint();
  } finally {
    releaseOccObjects(temporaries);
  }
}

/**
 * Reads a checkpoint back into fresh TopoDS_Shape wrappers owned by the caller,
 * in the written order. On any failure nothing stays allocated and
 * OccShapeSetCheckpointInvalidError (or a cleanup error) is thrown.
 */
export function readOccShapeSetCheckpoint(
  oc: OpenCascadeInstance,
  checkpoint: string,
): OccShape[] {
  const read = nativeCheckpoint(oc).Read(checkpoint);
  const shapes: OccShape[] = [];
  let failure: unknown;
  try {
    if (!read.IsDone()) {
      throw new OccShapeSetCheckpointInvalidError(read.ErrorMessage());
    }
    const count = read.ChildCount();
    for (let index = 0; index < count; index += 1) {
      shapes.push(read.Child(index));
    }
  } catch (error) {
    failure = error;
  }
  try {
    releaseOccObjects(
      failure === undefined ? [read] : [read, ...shapes.reverse()],
    );
  } catch (cleanupError) {
    throw failure === undefined
      ? cleanupError
      : combineOccCleanupError(failure, cleanupError);
  }
  if (failure !== undefined) throw failure;
  return shapes;
}
