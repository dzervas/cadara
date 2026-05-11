import type {
  BodyId,
  DocumentId,
  FeatureId,
  RevisionId,
  SketchId,
} from "@/contracts/shared/ids";

/**
 * Ownership metadata attached to durable references and snapshot records.
 * Producers own these fields and must keep them aligned with the revision in
 * which the enclosing record was emitted.
 */
export interface OwnershipRecord {
  /** Durable document that owns the enclosing record. */
  ownerDocumentId: DocumentId;
  /** Revision in which the ownership mapping was evaluated. */
  ownerRevisionId: RevisionId;
  /** Owning feature when the record is feature-authored; otherwise null. */
  ownerFeatureId: FeatureId | null;
  /** Owning sketch when the record belongs to a sketch domain object; otherwise null. */
  ownerSketchId: SketchId | null;
  /** Owning body when the record belongs to body topology; otherwise null. */
  ownerBodyId: BodyId | null;
}
