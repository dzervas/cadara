import { expect } from "bun:test";

// Bun's expect(...) assertions do not narrow types for TypeScript, so specs that
// check discriminated unions like `parsed.success` still need an assertion
// function signature to keep the post-check code type-safe.
export function expectTrue(
  condition: unknown,
  message = "Expected condition to be true.",
): asserts condition {
  try {
    expect(condition).toBeTruthy();
  } catch (error) {
    if (error instanceof Error) {
      error.message = `${message}\n\n${error.message}`;
    }
    throw error;
  }
}
