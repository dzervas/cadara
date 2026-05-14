import { test, expect } from "vitest";
import typia, { type tags } from "typia";

interface TypiaTransformSentinel {
  kind: "typia-transform-sentinel";
  value: number & tags.ExclusiveMinimum<0>;
}

const validateSentinel = typia.createValidateEquals<TypiaTransformSentinel>();

test("Typia generated validators execute in Bun tests", () => {
  const valid = validateSentinel({
    kind: "typia-transform-sentinel",
    value: 1,
  });
  expect(
    valid.success,
    "Typia should validate a matching tagged payload.",
  ).toBeTruthy();

  const extraField = validateSentinel({
    kind: "typia-transform-sentinel",
    value: 1,
    extra: true,
  });
  expect(
    extraField.success,
    "Typia strict validation should reject extra persisted fields.",
  ).toBeFalsy();

  const invalidConstraint = validateSentinel({
    kind: "typia-transform-sentinel",
    value: 0,
  });
  expect(
    invalidConstraint.success,
    "Typia should enforce generated primitive constraints.",
  ).toBeFalsy();
});
