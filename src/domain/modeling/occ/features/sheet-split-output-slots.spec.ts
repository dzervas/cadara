import { expect, test } from "vitest";
import { reassociateExactOutputSlots } from "@/domain/modeling/occ/features/combine-split-delete";

test("sheet split output slots reuse a persisted BodyId through a mutually unique exact witness", () => {
  expect([...reassociateExactOutputSlots({
    previous: [{
      outputSlot: "body_persisted" as never,
      outputWitnesses: ["target-face-provenance:a", "target-face-provenance:changed"],
    }],
    current: [{
      key: "new-output",
      outputWitnesses: ["target-face-provenance:a", "target-face-provenance:current"],
    }],
  })]).toEqual([["new-output", "body_persisted"]]);
});

test("sheet split output slots fail closed for zero or many exact witnesses", () => {
  expect(reassociateExactOutputSlots({
    previous: [{ outputSlot: "body_persisted" as never, outputWitnesses: ["a"] }],
    current: [{ key: "new-output", outputWitnesses: ["b"] }],
  }).size).toBe(0);

  expect(reassociateExactOutputSlots({
    previous: [
      { outputSlot: "body_first" as never, outputWitnesses: ["a"] },
      { outputSlot: "body_second" as never, outputWitnesses: ["a"] },
    ],
    current: [{ key: "new-output", outputWitnesses: ["a"] }],
  }).size).toBe(0);

  expect(reassociateExactOutputSlots({
    previous: [{ outputSlot: "body_persisted" as never, outputWitnesses: ["a"] }],
    current: [
      { key: "new-first", outputWitnesses: ["a"] },
      { key: "new-second", outputWitnesses: ["a"] },
    ],
  }).size).toBe(0);
});


test("sheet split output slots deduplicate agreeing transient and persisted copies", () => {
  expect([...reassociateExactOutputSlots({
    previous: [
      { outputSlot: "body_persisted" as never, outputWitnesses: ["a", "b"] },
      { outputSlot: "body_persisted" as never, outputWitnesses: ["b", "a"] },
    ],
    current: [{ key: "new-output", outputWitnesses: ["a", "current"] }],
  })]).toEqual([["new-output", "body_persisted"]]);
});

test("sheet split output slots reject conflicting copies and blank witnesses", () => {
  expect(reassociateExactOutputSlots({
    previous: [
      { outputSlot: "body_persisted" as never, outputWitnesses: ["a"] },
      { outputSlot: "body_persisted" as never, outputWitnesses: ["b"] },
    ],
    current: [{ key: "new-output", outputWitnesses: ["a"] }],
  }).size).toBe(0);
  expect(reassociateExactOutputSlots({
    previous: [{ outputSlot: "body_persisted" as never, outputWitnesses: ["   "] }],
    current: [{ key: "new-output", outputWitnesses: ["   "] }],
  }).size).toBe(0);
});
