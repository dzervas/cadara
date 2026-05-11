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
