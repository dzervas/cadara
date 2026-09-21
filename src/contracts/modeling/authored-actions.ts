import type {
  AuthoredModelDocument,
  AuthoredSketchRecord,
} from "@/contracts/modeling/authored-document";
import type { DocumentId, SketchId } from "@/contracts/shared/ids";

/** Context lifetime belongs to the session: opening a file creates a new owner. */
export type AuthoredActionContext =
  | { kind: "document" }
  | { kind: "sketch"; sketchId: SketchId };
export interface AuthoredActionIdentity {
  actorId: string;
  documentId: DocumentId;
  context: AuthoredActionContext;
}
export type AuthoredActionSketch = Omit<
  AuthoredSketchRecord,
  "regionSlots" | "definition"
> & {
  definition: Omit<AuthoredSketchRecord["definition"], "authoringOperations">;
};
export type AuthoredActionDocument = Omit<
  AuthoredModelDocument,
  "revisionId" | "topologyLineage" | "sketches"
> & {
  sketches: AuthoredActionSketch[];
};
export type AuthoredActionState =
  | {
      documentId: DocumentId;
      context: { kind: "document" };
      data: AuthoredActionDocument;
    }
  | {
      documentId: DocumentId;
      context: { kind: "sketch"; sketchId: SketchId };
      data: AuthoredActionSketch | null;
    };

export type AuthoredValue =
  | null
  | boolean
  | number
  | string
  | AuthoredValue[]
  | { [key: string]: AuthoredValue };
/** Segments are property names or stable record IDs, never array indices. Sequences are atomic fields. */
export type AuthoredAddress = readonly string[];
export type AuthoredPresence =
  | { exists: false }
  | { exists: true; value: AuthoredValue };
export interface AuthoredFieldWrite {
  address: AuthoredAddress;
  before: AuthoredPresence;
  after: AuthoredPresence;
}
export interface AuthoredAction {
  sequence: number;
  identity: AuthoredActionIdentity;
  label: string;
  writes: readonly AuthoredFieldWrite[];
  /** Incoming references allowed before/after an existence change; no snapshots. */
  dependencies: readonly {
    address: AuthoredAddress;
    id: string;
    before: readonly string[];
    after: readonly string[];
  }[];
}
export type AuthoredActionResult =
  | {
      status: "applied";
      state: AuthoredActionState;
      action: AuthoredAction;
      direction: "commit" | "undo" | "redo";
      writes: readonly AuthoredFieldWrite[];
    }
  | { status: "unchanged" }
  | {
      status: "blocked";
      reason:
        | "identity-mismatch"
        | "context-missing"
        | "expected-state-changed"
        | "dependent-record-changed"
        | "action-not-found"
        | "later-action-overlap";
      targets: readonly AuthoredAddress[];
    };
