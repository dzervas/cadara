import type { OccCheckpointShapeRecord } from "@/infrastructure/occ/authoring-checkpoint";
import type { NativeTopologyPayloadCheckpointRecord } from "@/infrastructure/occ/native-topology-payload-checkpoint";

/**
 * cadara-3sq.6: an optional, disposable store of evaluated native checkpoints
 * for complete document opens. The document stays the source of truth; a
 * store only ever answers "this exact content was evaluated to this state".
 */
export interface ModelCheckpoint {
  /** OccAuthoringState graph (see authoring-checkpoint.ts). */
  graph: string;
  shapes: OccCheckpointShapeRecord[];
  /** cadara-native-shape-set/v1 checkpoint of the graph's native shapes. */
  brep: string;
  /** The authored document exported from the state, with the document id as a placeholder. */
  exportedDocument: string;
  /**
   * The state's body display payloads the open had built when it published
   * (cadara-dx2k.15). Optional: a store may drop them, and the first snapshot
   * then meshes the bodies again.
   */
  nativeTopologyPayloads?: NativeTopologyPayloadCheckpointRecord[];
}

export type ModelCheckpointEvent =
  | { kind: "hit"; key: string }
  | { kind: "miss"; key: string; reason: "absent" }
  | { kind: "published"; key: string; bytes: number }
  /** Caching is off for this open; the cold path is the ordinary result. */
  | { kind: "bypass"; reason: string }
  /** A stored entry or the store itself failed; the open fell back to the cold path. */
  | { kind: "degraded"; key: string | null; reason: string }
  /** Retention removed entries to stay within the store's bound. */
  | { kind: "evicted"; keys: string[] };

export interface ModelCheckpointStore {
  /**
   * Build/runtime compatibility material folded into every key: the actual
   * production JS bundle and native assets, runtime and platform. Null when
   * they cannot be fingerprinted (a failed attempt is reported as degraded):
   * no entry can then be trusted, so every open bypasses the store.
   */
  compatibility(): Promise<string | null>;
  /** A complete validated entry, or null after reporting a miss/degradation. */
  read(key: string): Promise<ModelCheckpoint | null>;
  /** Publishes atomically; failures are reported as degradation, never thrown. */
  publish(key: string, checkpoint: ModelCheckpoint): Promise<void>;
  report(event: ModelCheckpointEvent): void;
}
