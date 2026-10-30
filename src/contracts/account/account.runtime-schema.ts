import typia from "typia";
import type { AccountMe } from "./account";
import { requireContract } from "@/contracts/shared/validation";

const validateMe = typia.createValidateEquals<AccountMe>();
export function parseAccountMe(input: unknown): AccountMe {
  return requireContract(validateMe, input, "Account /me");
}
