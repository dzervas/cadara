import typia from "typia";
import type { RecipeCommand } from "./recipe";
import { validateContract, type ContractValidationResult } from "@/contracts/shared/validation";

const operationValidator = typia.createValidateEquals<Exclude<RecipeCommand, { operation: "extrude.create" | "extrude.update" }> & { as?: string }>();
// Match the semantic boundary's separate depth/parameter extrusion dispatch.
const depthValidator = typia.createValidateEquals<Extract<RecipeCommand, { operation: "extrude.create" | "extrude.update"; depth: number | string }> & { as?: string }>();
const parametersValidator = typia.createValidateEquals<Extract<RecipeCommand, { operation: "extrude.create" | "extrude.update"; parameters: unknown }> & { as?: string }>();

export function validateRecipeOperation(input: unknown): ContractValidationResult<RecipeCommand & { as?: string }> {
  return input && typeof input === "object" && "operation" in input && (input.operation === "extrude.create" || input.operation === "extrude.update")
    ? "parameters" in input ? validateContract(parametersValidator, input) : validateContract(depthValidator, input)
    : validateContract(operationValidator, input);
}
