import { test } from "bun:test";
import typia, { type tags } from "typia";

import { expectTrue } from "@/testing/expect.spec";

interface TypiaTransformSentinel {
  kind: "typia-transform-sentinel";
  value: number & tags.ExclusiveMinimum<0>;
}

const validateSentinel =
  typia.createValidateEquals<TypiaTransformSentinel>();

test("Typia generated validators execute in Bun tests", () => {
  const valid = validateSentinel({
    kind: "typia-transform-sentinel",
    value: 1,
  });
  expectTrue(valid.success, "Typia should validate a matching tagged payload.");

  const extraField = validateSentinel({
    kind: "typia-transform-sentinel",
    value: 1,
    extra: true,
  });
  expectTrue(
    !extraField.success,
    "Typia strict validation should reject extra persisted fields.",
  );

  const invalidConstraint = validateSentinel({
    kind: "typia-transform-sentinel",
    value: 0,
  });
  expectTrue(
    !invalidConstraint.success,
    "Typia should enforce generated primitive constraints.",
  );
});
