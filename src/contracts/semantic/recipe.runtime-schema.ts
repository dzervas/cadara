import typia from "typia";
import type { RecipeCommand, RecipeTrace } from "./recipe";
import { isRecipeReference, type RecipeReference } from "./recipe-references";
import { validateContract, type ContractValidationResult } from "@/contracts/shared/validation";

const referenceValidator = typia.createValidateEquals<RecipeReference>();
const envelopeValidator = typia.createValidateEquals<{ version: 1 | 2; operations: readonly unknown[] }>();
export const recipeReferenceJsonSchemas = typia.json.schemas<[RecipeReference], "3.1">();

export function validateRecipeReference(input: unknown) { return validateContract(referenceValidator, input); }

/** Recorder boundary: commands were already re-resolved and semantically
 * validated when recorded. Validate the envelope/reference transport too. */
export function validateRecordedRecipe(input: unknown): ContractValidationResult<RecipeTrace> {
  const envelope = validateContract(envelopeValidator, input);
  if (!envelope.success) return envelope;
  const issues: { path: string; expected: string; value: unknown }[] = [];
  const aliases = new Set<string>();
  const producers = new Map<string, RecipeCommand>();
  const ids = new Set<string>();
  if (!envelope.data.operations.length) issues.push({ path: "operations", expected: "nonempty operations", value: envelope.data.operations });
  for (const [i, operation] of envelope.data.operations.entries()) {
    const path = `operations[${i}]`;
    if (!operation || typeof operation !== "object") {
      issues.push({ path, expected: "recipe operation object", value: operation });
      continue;
    }
    const command = operation as RecipeCommand & { as?: string };
    if (typeof command.commandId !== "string" || !command.commandId || ids.has(command.commandId)) issues.push({ path: `${path}.commandId`, expected: "nonempty unique command ID", value: command.commandId });
    ids.add(command.commandId);
    const visit = (value: unknown, at: string) => {
      if (isRecipeReference(value)) {
        const checked = validateRecipeReference(value);
        if (!checked.success) {
          issues.push(...checked.issues.map(issue => ({ ...issue, path: `${at}${issue.path ? `.${issue.path}` : ""}` })));
          return;
        }
        if (envelope.data.version !== 2) issues.push({ path: at, expected: "recipe envelope v2 for creation references", value });
        for (const alias of [value.createdBy, value.owner.alias]) if (!aliases.has(alias)) issues.push({ path: at, expected: `earlier producer/owner alias (${alias})`, value });
        const producer = producers.get(value.createdBy);
        const role = value.output.role;
        const supported = role === "sketch" ? producer?.operation === "sketch.begin"
          : role === "dimension" ? producer?.operation === "sketch.dimension.add"
          : producer?.operation === "sketch.author" && !!producer.primitive && (role === "splineOccurrence" || role === "fitPoint"
            ? producer.primitive.kind === "spline" && Array.isArray(producer.primitive.fitPoints) && value.output.index < producer.primitive.fitPoints.length
            : !["rectangle", "centerPointRectangle", "alignedRectangle", "inscribedPolygon", "circumscribedPolygon"].includes(producer.primitive.kind) && (role !== "authoredPoint" || (producer.primitive.kind !== "spline" && (producer.primitive.kind !== "point" || value.output.index === 0))));
        if (!supported) issues.push({ path: at, expected: "compatible semantic creation producer/output role and authored slot", value });
        return;
      }
      if (value && typeof value === "object") {
        if ("alias" in value && (typeof value.alias !== "string" || !aliases.has(value.alias))) issues.push({ path: at, expected: "earlier discovery alias", value });
        if ("sketch" in value && "label" in value && (typeof value.sketch !== "string" || !aliases.has(value.sketch))) issues.push({ path: at, expected: "earlier sketch owner alias", value });
        for (const [key, child] of Object.entries(value)) visit(child, `${at}.${key}`);
      }
    };
    visit(command, path);
    if (command.as !== undefined) {
      if (typeof command.as !== "string" || !command.as || aliases.has(command.as)) issues.push({ path: `${path}.as`, expected: "nonempty unique alias", value: command.as });
      aliases.add(command.as);
      producers.set(command.as, command);
    }
  }
  return issues.length ? { success: false, data: input, issues: issues.map(issue => ({ ...issue, message: `Expected ${issue.expected}` })) } : { success: true, data: envelope.data as RecipeTrace };
}

/** Shared SDK/CLI external-input boundary. The large generated operation union
 * loads only for replay, so normal v1 CLI startup does not repay its transform. */
export async function validateRecipe(input: unknown): Promise<ContractValidationResult<RecipeTrace>> {
  const envelope = validateRecordedRecipe(input);
  if (!envelope.success) return envelope;
  const { validateRecipeOperation } = await import("./recipe-command.runtime-schema");
  const issues = envelope.data.operations.flatMap((operation, i) => {
    const checked = validateRecipeOperation(operation);
    return checked.success ? [] : checked.issues.map(issue => ({ ...issue, path: `operations[${i}]${issue.path ? `.${issue.path}` : ""}` }));
  });
  return issues.length ? { success: false, data: input, issues } : envelope;
}
