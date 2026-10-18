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

const commandValidator = typia.createValidateEquals<Exclude<SemanticCommand, { operation: "extrude.create" | "extrude.update" }>>();
// Keep both extrusion forms fully generated and exact. The generator's large
// command-union dispatch otherwise selects one extrude.update branch from their
// shared operation/featureId keys before checking depth versus parameters.
const extrudeDepthValidator = typia.createValidateEquals<Extract<SemanticCommand, { operation: "extrude.create" | "extrude.update"; depth: number | string }>>();
const extrudeParametersValidator = typia.createValidateEquals<Extract<SemanticCommand, { operation: "extrude.create" | "extrude.update"; parameters: unknown }>>();
const resultValidator = typia.createValidateEquals<SemanticResult>();

export function validateSemanticCommand(input: unknown): ContractValidationResult<SemanticCommand> {
  if (input && typeof input === "object" && "operation" in input &&
      (input.operation === "extrude.create" || input.operation === "extrude.update")) {
    return "parameters" in input
      ? validateContract(extrudeParametersValidator, input)
      : validateContract(extrudeDepthValidator, input);
  }
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
