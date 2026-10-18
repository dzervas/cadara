import typia from "typia";
import {
  validateContract,
  type ContractValidationResult,
} from "@/contracts/shared/validation";
import type { CompactRecipeOutput } from "./compact-output";

const compactValidator = typia.createValidateEquals<CompactRecipeOutput>();

/** Exact structural validation of the versioned compact recipe envelope. */
export function validateCompactRecipeOutput(
  input: unknown,
): ContractValidationResult<CompactRecipeOutput> {
  return validateContract(compactValidator, input);
}
