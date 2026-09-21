import {
  createReferenceImageOperation,
  type CreateReferenceImageOperationInput,
} from "./operations";

/** Stable authored fixture identity for interaction tests; production allocation is tested separately. */
export function createReferenceImageFixture(
  input: CreateReferenceImageOperationInput,
) {
  return {
    ...createReferenceImageOperation(input),
    operationId: `sketch_operation_${input.sequence}_reference-image` as const,
  };
}
