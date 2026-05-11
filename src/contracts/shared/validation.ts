import type { IValidation } from "typia";

export interface ContractValidationIssue {
  path: string;
  expected: string;
  value: unknown;
  message: string;
}

export type ContractValidationResult<T> =
  | { success: true; data: T }
  | { success: false; data: unknown; issues: ContractValidationIssue[] };

export type TypiaValidator<T> = (input: unknown) => IValidation<T>;

export class ContractValidationError extends Error {
  readonly issues: readonly ContractValidationIssue[];
  readonly input: unknown;

  constructor(
    message: string,
    input: unknown,
    issues: readonly ContractValidationIssue[],
  ) {
    super(message);
    this.name = "ContractValidationError";
    this.input = input;
    this.issues = issues;
  }
}

function normalizeTypiaPath(path: string) {
  return path.replace(/^\$input\.?/, "");
}

function messageForIssue(issue: IValidation.IError) {
  return (
    issue.description ??
    `${normalizeTypiaPath(issue.path) || "payload"} must match ${issue.expected}.`
  );
}

export function validateContract<T>(
  validator: TypiaValidator<T>,
  input: unknown,
): ContractValidationResult<T> {
  const result = validator(input);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    data: result.data,
    issues: result.errors.map((issue) => ({
      path: normalizeTypiaPath(issue.path),
      expected: issue.expected,
      value: issue.value,
      message: messageForIssue(issue),
    })),
  };
}

export function requireContract<T>(
  validator: TypiaValidator<T>,
  input: unknown,
  label: string,
): T {
  const result = validateContract(validator, input);

  if (result.success) {
    return result.data;
  }

  const firstIssue = result.issues[0];
  throw new ContractValidationError(
    firstIssue?.message ?? `${label} validation failed.`,
    input,
    result.issues,
  );
}

export function validationIssuesFromTypia(
  validation: IValidation<unknown>,
): ContractValidationIssue[] {
  if (validation.success) {
    return [];
  }

  return validation.errors.map((issue) => ({
    path: normalizeTypiaPath(issue.path),
    expected: issue.expected,
    value: issue.value,
    message: messageForIssue(issue),
  }));
}
