import typia, { type tags } from "typia";
import {
  validateContract,
  type ContractValidationResult,
} from "@/contracts/shared/validation";
import type { OccCheckpointShapeRecord } from "@/infrastructure/occ/authoring-checkpoint";

type Sha256Hex = string & tags.Pattern<"^[0-9a-f]{64}$">;
type ByteLength = number & tags.Type<"uint32">;

/**
 * cadara-3sq.6: the first line of a model checkpoint cache entry. The entry
 * file is untrusted input: the manifest is validated exactly before any member
 * is read, and the body must hash to `sha256`.
 */
export interface ModelCheckpointEntryManifest {
  format: "cadara-model-checkpoint-entry/v1";
  key: Sha256Hex;
  compatibility: Sha256Hex;
  /** UTF-8 byte lengths of the body members, in body order. */
  members: {
    graph: ByteLength;
    shapes: ByteLength;
    brep: ByteLength;
    exportedDocument: ByteLength;
  };
  /** SHA-256 of the body (every byte after the manifest line). */
  sha256: Sha256Hex;
}

const manifestValidator =
  typia.createValidateEquals<ModelCheckpointEntryManifest>();
const shapeRecordsValidator =
  typia.createValidateEquals<OccCheckpointShapeRecord[]>();

export function validateModelCheckpointEntryManifest(
  input: unknown,
): ContractValidationResult<ModelCheckpointEntryManifest> {
  return validateContract(manifestValidator, input);
}

export function validateModelCheckpointShapeRecords(
  input: unknown,
): ContractValidationResult<OccCheckpointShapeRecord[]> {
  return validateContract(shapeRecordsValidator, input);
}
