import typia from "typia";

import type { EmbeddedBinaryAssetRecord } from "@/contracts/modeling/embedded-binary-assets";
import {
  requireContract,
  validateContract,
  type ContractValidationResult,
} from "@/contracts/shared/validation";

const embeddedBinaryAssetRecordValidator =
  typia.createValidateEquals<EmbeddedBinaryAssetRecord>();

export function validateEmbeddedBinaryAssetRecord(
  value: unknown,
): ContractValidationResult<EmbeddedBinaryAssetRecord> {
  return validateContract(embeddedBinaryAssetRecordValidator, value);
}

export function requireEmbeddedBinaryAssetRecord(
  value: unknown,
): EmbeddedBinaryAssetRecord {
  return requireContract(
    embeddedBinaryAssetRecordValidator,
    value,
    "Embedded binary asset record",
  );
}
