import typia from "typia";
import type { ApiKeySummary, CreatedApiKey } from "./account-settings";
import { requireContract } from "@/contracts/shared/validation";

const validateApiKeys = typia.createValidateEquals<ApiKeySummary[]>();
const validateCreatedApiKey = typia.createValidateEquals<CreatedApiKey>();

export function parseApiKeys(input: unknown): ApiKeySummary[] {
  return requireContract(validateApiKeys, input, "API keys");
}

export function parseCreatedApiKey(input: unknown): CreatedApiKey {
  return requireContract(validateCreatedApiKey, input, "Created API key");
}
