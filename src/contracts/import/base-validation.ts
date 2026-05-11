import typia from "typia";

import type { ImportBinding } from "@/contracts/import/binding";
import type { ImportDiagnostic } from "@/contracts/import/diagnostics";
import type {
  ImportSource,
  ResolvedImportSource,
} from "@/contracts/import/source";
import {
  ContractValidationError,
  validateContract,
  type ContractValidationIssue,
  type ContractValidationResult,
} from "@/contracts/shared/validation";

const importSourceValidator = typia.createValidateEquals<ImportSource>();
const resolvedImportSourceValidator =
  typia.createValidateEquals<ResolvedImportSource>();
const importBindingValidator = typia.createValidateEquals<ImportBinding>();
const importDiagnosticValidator = typia.createValidateEquals<ImportDiagnostic>();

function invariantIssue(
  path: string,
  expected: string,
  value: unknown,
  message: string,
): ContractValidationIssue {
  return { path, expected, value, message };
}

function isNonEmptyString(value: string) {
  return value.trim().length > 0;
}

function validateNonEmptyString(
  value: string | undefined,
  path: string,
  label: string,
  optional = false,
): ContractValidationIssue[] {
  if (value === undefined && optional) {
    return [];
  }

  return value !== undefined && isNonEmptyString(value)
    ? []
    : [
        invariantIssue(
          path,
          "non-empty string",
          value,
          `${label} must be a non-empty string.`,
        ),
      ];
}

function validateImportUrl(url: string, path: string): ContractValidationIssue[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    return [
      invariantIssue(
        path,
        "http(s) URL",
        url,
        error instanceof Error && error.message.trim()
          ? `Import URL is invalid: ${error.message}`
          : "Import URL must be a valid http or https URL.",
      ),
    ];
  }

  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    return [];
  }

  return [
    invariantIssue(
      path,
      "http(s) URL",
      url,
      "Import URL must be a valid http or https URL.",
    ),
  ];
}

function composeInvariantResult<T>(
  result: ContractValidationResult<T>,
  validateInvariants: (data: T) => ContractValidationIssue[],
): ContractValidationResult<T> {
  if (!result.success) {
    return result;
  }

  const issues = validateInvariants(result.data);
  return issues.length === 0
    ? result
    : { success: false, data: result.data, issues };
}

function requireWithInvariants<T>(
  validator: (value: unknown) => ContractValidationResult<T>,
  value: unknown,
  label: string,
): T {
  const result = validator(value);
  if (result.success) {
    return result.data;
  }

  const firstIssue = result.issues[0];
  throw new ContractValidationError(
    firstIssue?.message ?? `${label} validation failed.`,
    value,
    result.issues,
  );
}

export function validateImportSourceInvariants(
  source: ImportSource,
  path = "source",
): ContractValidationIssue[] {
  switch (source.kind) {
    case "localFile":
      return [
        ...validateNonEmptyString(source.fileName, `${path}.fileName`, "Local import file name"),
        ...validateNonEmptyString(
          source.pathHint,
          `${path}.pathHint`,
          "Local import path hint",
          true,
        ),
      ];
    case "url":
      return validateImportUrl(source.url, `${path}.url`);
    case "cloudObject":
      return [
        ...validateNonEmptyString(source.service, `${path}.service`, "Cloud import service"),
        ...validateNonEmptyString(source.objectId, `${path}.objectId`, "Cloud import object id"),
        ...validateNonEmptyString(
          source.versionId,
          `${path}.versionId`,
          "Cloud import version id",
          true,
        ),
      ];
  }
}

export function validateResolvedImportSourceInvariants(
  source: ResolvedImportSource,
  path = "source",
): ContractValidationIssue[] {
  return [
    ...validateNonEmptyString(source.name, `${path}.name`, "Resolved import source name"),
    ...validateNonEmptyString(
      source.mediaType ?? undefined,
      `${path}.mediaType`,
      "Resolved import source media type",
      source.mediaType === null,
    ),
    ...validateImportSourceInvariants(source.origin, `${path}.origin`),
  ];
}

export function validateImportBindingInvariants(
  binding: ImportBinding,
  path = "binding",
): ContractValidationIssue[] {
  switch (binding.kind) {
    case "localFile":
      return [
        ...validateNonEmptyString(binding.fileName, `${path}.fileName`, "Local import binding file name"),
        ...validateNonEmptyString(
          binding.pathHint,
          `${path}.pathHint`,
          "Local import binding path hint",
          true,
        ),
      ];
    case "url":
      return validateImportUrl(binding.url, `${path}.url`);
    case "cloudObject":
      return [
        ...validateNonEmptyString(binding.service, `${path}.service`, "Cloud import binding service"),
        ...validateNonEmptyString(binding.objectId, `${path}.objectId`, "Cloud import binding object id"),
        ...validateNonEmptyString(
          binding.versionId,
          `${path}.versionId`,
          "Cloud import binding version id",
          true,
        ),
      ];
  }
}

export function validateImportDiagnosticInvariants(
  diagnostic: ImportDiagnostic,
  path = "diagnostic",
): ContractValidationIssue[] {
  return [
    ...validateNonEmptyString(diagnostic.message, `${path}.message`, "Import diagnostic message"),
    ...validateNonEmptyString(
      diagnostic.code,
      `${path}.code`,
      "Import diagnostic code",
      true,
    ),
  ];
}

export function validateImportSource(
  value: unknown,
): ContractValidationResult<ImportSource> {
  return composeInvariantResult(
    validateContract(importSourceValidator, value),
    validateImportSourceInvariants,
  );
}

export function requireImportSource(value: unknown): ImportSource {
  return requireWithInvariants(validateImportSource, value, "Import source");
}

export function validateResolvedImportSource(
  value: unknown,
): ContractValidationResult<ResolvedImportSource> {
  return composeInvariantResult(
    validateContract(resolvedImportSourceValidator, value),
    validateResolvedImportSourceInvariants,
  );
}

export function requireResolvedImportSource(
  value: unknown,
): ResolvedImportSource {
  return requireWithInvariants(
    validateResolvedImportSource,
    value,
    "Resolved import source",
  );
}

export function validateImportBinding(
  value: unknown,
): ContractValidationResult<ImportBinding> {
  return composeInvariantResult(
    validateContract(importBindingValidator, value),
    validateImportBindingInvariants,
  );
}

export function requireImportBinding(value: unknown): ImportBinding {
  return requireWithInvariants(validateImportBinding, value, "Import binding");
}

export function validateImportDiagnostic(
  value: unknown,
): ContractValidationResult<ImportDiagnostic> {
  return composeInvariantResult(
    validateContract(importDiagnosticValidator, value),
    validateImportDiagnosticInvariants,
  );
}

export function requireImportDiagnostic(value: unknown): ImportDiagnostic {
  return requireWithInvariants(
    validateImportDiagnostic,
    value,
    "Import diagnostic",
  );
}
