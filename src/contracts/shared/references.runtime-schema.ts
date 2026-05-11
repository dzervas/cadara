import typia from "typia";

import type { DurableRef } from "@/contracts/shared/references";
import {
  requireContract,
  validateContract,
  type ContractValidationResult,
} from "@/contracts/shared/validation";

const durableRefValidator = typia.createValidateEquals<DurableRef>();

export function validateDurableRef(
  value: unknown,
): ContractValidationResult<DurableRef> {
  return validateContract(durableRefValidator, value);
}

export function requireDurableRef(value: unknown): DurableRef {
  return requireContract(durableRefValidator, value, "Durable reference");
}
