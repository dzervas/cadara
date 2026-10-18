import { expect, it } from "vitest";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

function expectHealthyEmptySketch(result: SemanticResult) {
  const sketch = result.discovery!.sketch!;
  expect(sketch.entities).toEqual([]);
  expect(sketch.constraints).toEqual([]);
  expect(sketch.profiles).toEqual([]);
  expect(sketch.validity.diagnostics).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "regions-unavailable" }),
    ]),
  );
  expect(sketch.validity.state).toBe("current");
  expect(result.completion.geometry.kind).toBe("current");
}

it("a second new empty sketch has no unsolved-constraint profile warning", async () => {
  const f = await createSketchWorkflow();
  try {
    await f.author({ kind: "rectangle", start: [0, 0], end: [20, 10] });
    await f.execute({
      operation: "sketch.publish",
      draft: f.draft(),
      requireProfiles: true,
    });
    const begun = await f.run({ operation: "sketch.begin", plane: "xy" });
    expectHealthyEmptySketch(begun);
  } finally {
    await f.close();
  }
}, 60000);

it("undoing both rectangles clears profiles without claiming the empty sketch is unsolved", async () => {
  const f = await createSketchWorkflow();
  try {
    await f.author({ kind: "rectangle", start: [0, 0], end: [20, 10] });
    await f.author({ kind: "rectangle", start: [30, 0], end: [50, 10] });
    expect(f.current().discovery!.sketch!.profiles).toHaveLength(2);
    await f.execute({ operation: "history.undo", draft: f.draft() });
    const undone = await f.run({ operation: "history.undo", draft: f.draft() });
    expectHealthyEmptySketch(undone);
  } finally {
    await f.close();
  }
}, 60000);
