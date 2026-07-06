import typia from "typia";

import type { ImportPreparedActions } from "@/contracts/import/actions";
import {
  validateImportBindingInvariants,
  validateImportDiagnosticInvariants,
} from "@/contracts/import/base-validation";
import {
  ContractValidationError,
  validateContract,
  type ContractValidationIssue,
  type ContractValidationResult,
} from "@/contracts/shared/validation";
export {
  requireImportBinding,
  requireImportDiagnostic,
  requireImportSource,
  requireResolvedImportSource,
  validateImportBinding,
  validateImportDiagnostic,
  validateImportSource,
  validateResolvedImportSource,
} from "@/contracts/import/base-validation";

const importPreparedActionsValidator =
  typia.createValidateEquals<ImportPreparedActions>();

export function validateImportOrderedActionsInvariants(
  actions: ImportPreparedActions,
): ContractValidationIssue[] {
  const orderedActions = actions.orderedActions;
  if (!orderedActions) {
    return [];
  }

  const arrayLengths: Record<string, number> = {
    createFeature: actions.createFeatures?.length ?? 0,
    commitSketch: actions.commitSketches?.length ?? 0,
    addDocumentVariable: actions.addDocumentVariables?.length ?? 0,
  };
  const totalActions =
    arrayLengths.createFeature +
    arrayLengths.commitSketch +
    arrayLengths.addDocumentVariable;

  const issues: ContractValidationIssue[] = [];
  const seen = new Set<string>();

  orderedActions.forEach((ref, position) => {
    const path = `orderedActions.${position}`;
    const length = arrayLengths[ref.kind] ?? 0;
    if (
      !Number.isInteger(ref.index) ||
      ref.index < 0 ||
      ref.index >= length
    ) {
      issues.push({
        path,
        expected: `${ref.kind} index in [0, ${length})`,
        value: ref.index,
        message: `Ordered action references out-of-range ${ref.kind} index ${ref.index}.`,
      });
      return;
    }

    const key = `${ref.kind}:${ref.index}`;
    if (seen.has(key)) {
      issues.push({
        path,
        expected: `unique ${ref.kind} reference`,
        value: ref.index,
        message: `Ordered action duplicates ${ref.kind} index ${ref.index}.`,
      });
      return;
    }
    seen.add(key);
  });

  if (seen.size !== totalActions) {
    issues.push({
      path: "orderedActions",
      expected: `permutation of ${totalActions} prepared actions`,
      value: seen.size,
      message: `Ordered action sequence must reference every prepared action exactly once (referenced ${seen.size} of ${totalActions}).`,
    });
  }

  return issues;
}

function validateImportPreparedActionsInvariants(
  actions: ImportPreparedActions,
): ContractValidationIssue[] {
  return [
    ...(actions.binding
      ? validateImportBindingInvariants(actions.binding, "binding")
      : []),
    ...(actions.diagnostics ?? []).flatMap((diagnostic, index) =>
      validateImportDiagnosticInvariants(
        diagnostic,
        `diagnostics.${index}`,
      ),
    ),
    ...validateImportOrderedActionsInvariants(actions),
  ];
}

export function validateImportPreparedActions(
  value: unknown,
): ContractValidationResult<ImportPreparedActions> {
  const result = validateContract(importPreparedActionsValidator, value);
  if (!result.success) {
    return result;
  }

  const issues = validateImportPreparedActionsInvariants(result.data);
  return issues.length === 0
    ? result
    : { success: false, data: result.data, issues };
}

export function requireImportPreparedActions(
  value: unknown,
): ImportPreparedActions {
  const result = validateImportPreparedActions(value);
  if (result.success) {
    return result.data;
  }

  const firstIssue = result.issues[0];
  throw new ContractValidationError(
    firstIssue?.message ?? "Import prepared actions validation failed.",
    value,
    result.issues,
  );
}
