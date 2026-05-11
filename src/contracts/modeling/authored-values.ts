export type AuthoredValue<T> =
  | { source: "literal"; value: T }
  | { source: "expression"; valueText: string };

export type MaybeAuthoredValue<T> = T | AuthoredValue<T>;

export type FeatureValueKindDescriptor =
  | { kind: "finiteNumber" }
  | { kind: "positiveNumber" }
  | { kind: "positiveInteger" }
  | { kind: "integer"; minimum?: number }
  | { kind: "boolean" }
  | { kind: "string" }
  | { kind: "enumString"; options: readonly string[] }
  | { kind: "angle" };

export type FeatureValueKindFailureCode =
  | "type-mismatch"
  | "non-finite-number"
  | "not-positive"
  | "not-integer"
  | "invalid-enum-value";

export interface FeatureValueKindFailure {
  code: FeatureValueKindFailureCode;
  message: string;
}

export function createLiteralAuthoredValue<T>(value: T): AuthoredValue<T> {
  return { source: "literal", value };
}

export function createExpressionAuthoredValue(
  valueText: string,
): AuthoredValue<never> {
  return { source: "expression", valueText };
}

export function isAuthoredValue(
  value: unknown,
): value is AuthoredValue<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "source" in value &&
    ((value as { source?: unknown }).source === "literal" ||
      (value as { source?: unknown }).source === "expression")
  );
}

export function isExpressionAuthoredValue(
  value: unknown,
): value is Extract<AuthoredValue<unknown>, { source: "expression" }> {
  return isAuthoredValue(value) && value.source === "expression";
}

export function isLiteralAuthoredValue<T>(
  value: MaybeAuthoredValue<T>,
): value is Extract<AuthoredValue<T>, { source: "literal" }> {
  return isAuthoredValue(value) && value.source === "literal";
}

export function getAuthoredLiteralValue<T>(
  value: MaybeAuthoredValue<T>,
): T | null {
  if (isExpressionAuthoredValue(value)) {
    return null;
  }

  return isLiteralAuthoredValue(value) ? value.value : value;
}

export function getAuthoredFormText<T>(
  value: MaybeAuthoredValue<T>,
  formatLiteral: (literal: T) => string = (literal) => String(literal),
): string {
  if (isExpressionAuthoredValue(value)) {
    return value.valueText;
  }

  const literal = isLiteralAuthoredValue(value) ? value.value : value;
  return formatLiteral(literal);
}

export function ensureLiteralAuthoredValue<T>(
  value: MaybeAuthoredValue<T>,
): AuthoredValue<T> {
  return isAuthoredValue(value)
    ? (value as AuthoredValue<T>)
    : createLiteralAuthoredValue(value);
}

export function validateFeatureValueKind(
  value: unknown,
  descriptor: FeatureValueKindDescriptor,
):
  | { ok: true; value: unknown }
  | { ok: false; failure: FeatureValueKindFailure } {
  switch (descriptor.kind) {
    case "finiteNumber":
    case "angle":
      return validateFiniteNumber(value);
    case "positiveNumber": {
      const finite = validateFiniteNumber(value);
      if (!finite.ok) {
        return finite;
      }

      return finite.value > 0
        ? finite
        : {
            ok: false,
            failure: {
              code: "not-positive",
              message: "Value must be greater than zero.",
            },
          };
    }
    case "positiveInteger": {
      const finite = validateFiniteNumber(value);
      if (!finite.ok) {
        return finite;
      }

      if (!Number.isInteger(finite.value)) {
        return {
          ok: false,
          failure: {
            code: "not-integer",
            message: "Value must be an integer.",
          },
        };
      }

      return finite.value > 0
        ? finite
        : {
            ok: false,
            failure: {
              code: "not-positive",
              message: "Value must be a positive integer.",
            },
          };
    }
    case "integer": {
      const finite = validateFiniteNumber(value);
      if (!finite.ok) {
        return finite;
      }

      if (!Number.isInteger(finite.value)) {
        return {
          ok: false,
          failure: {
            code: "not-integer",
            message: "Value must be an integer.",
          },
        };
      }

      if (
        descriptor.minimum !== undefined &&
        finite.value < descriptor.minimum
      ) {
        return {
          ok: false,
          failure: {
            code: "not-integer",
            message: `Value must be an integer greater than or equal to ${descriptor.minimum}.`,
          },
        };
      }

      return finite;
    }
    case "boolean":
      return typeof value === "boolean"
        ? { ok: true, value }
        : {
            ok: false,
            failure: {
              code: "type-mismatch",
              message: "Value must resolve to a boolean.",
            },
          };
    case "string":
      return typeof value === "string"
        ? { ok: true, value }
        : {
            ok: false,
            failure: {
              code: "type-mismatch",
              message: "Value must resolve to a string.",
            },
          };
    case "enumString":
      if (typeof value !== "string") {
        return {
          ok: false,
          failure: {
            code: "type-mismatch",
            message: "Value must resolve to a string.",
          },
        };
      }

      return descriptor.options.includes(value)
        ? { ok: true, value }
        : {
            ok: false,
            failure: {
              code: "invalid-enum-value",
              message: `Value must be one of: ${descriptor.options.join(", ")}.`,
            },
          };
  }
}

function validateFiniteNumber(
  value: unknown,
):
  | { ok: true; value: number }
  | { ok: false; failure: FeatureValueKindFailure } {
  if (typeof value !== "number") {
    return {
      ok: false,
      failure: {
        code: "type-mismatch",
        message: "Value must resolve to a number.",
      },
    };
  }

  return Number.isFinite(value)
    ? { ok: true, value }
    : {
        ok: false,
        failure: {
          code: "non-finite-number",
          message: "Value must resolve to a finite number.",
        },
      };
}
