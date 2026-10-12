import typia from "typia";
import type {
  SemanticCommand,
  SemanticCorrelation,
  SemanticResult,
} from "./schema";
import {
  validateContract,
  type ContractValidationResult,
} from "@/contracts/shared/validation";
import { semanticResultIssues } from "./validation";

const commandValidator = typia.createValidateEquals<SemanticCommand>();
const resultValidator = typia.createValidateEquals<SemanticResult>();

export function validateSemanticCommand(input: unknown) {
  return validateContract(commandValidator, input);
}

/** Structural validation plus truthful terminal-outcome invariants. */
export function validateSemanticResult(
  expected: SemanticCorrelation,
  input: unknown,
): ContractValidationResult<SemanticResult> {
  const validated = validateContract(resultValidator, input);
  if (!validated.success) return validated;
  const issues = semanticResultIssues(expected, validated.data);
  return issues.length ? { success: false, data: input, issues } : validated;
}
