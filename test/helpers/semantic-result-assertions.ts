import { expect } from "vitest";
import type { SemanticResult } from "@/contracts/semantic/schema";

/** Exact body bounds (as discovered) match `min`/`max` per axis to five decimals. */
export function expectBounds(bounds: { min: readonly number[]; max: readonly number[] } | null, min: number[], max: number[]) {
  for (const axis of [0, 1, 2]) {
    expect(bounds!.min[axis]).toBeCloseTo(min[axis]!, 5);
    expect(bounds!.max[axis]).toBeCloseTo(max[axis]!, 5);
  }
}

/** Typed targets of the result's discovered references with this exact label and kind. */
export function labelled(result: SemanticResult, label: string, kind: string) {
  return result.discovery!.references.filter((r) => r.label === label && r.target.kind === kind).map((r) => r.target);
}
