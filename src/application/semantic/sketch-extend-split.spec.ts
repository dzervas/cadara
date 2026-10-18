import { expect, it } from "vitest";
import {
  createSketchWorkflow,
  labels,
} from "../../../test/helpers/semantic-sketch-workflow";
import type { SemanticResult } from "@/contracts/semantic/schema";

type Workflow = Awaited<ReturnType<typeof createSketchWorkflow>>;

/** A horizontal line (0,0)→(30,0) and an ordinary vertical line at `x`. */
async function twoLines(f: Workflow, x: number) {
  for (const [start, end] of [
    [
      [0, 0],
      [30, 0],
    ],
    [
      [x, -15],
      [x, 15],
    ],
  ])
    await f.author({ kind: "line", start, end });
  const [target, boundary] = f
    .current()
    .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
    .map((r) => r.target);
  return { before: f.current(), target: target!, boundary: boundary! };
}

/** Endpoint positions of every line, in sketch order. */
function lines(result: SemanticResult) {
  const sketch = result.discovery!.sketch!;
  return sketch.entities.map((e) =>
    e.pointIds.map(
      (id) => sketch.points.find((p) => p.pointId === id)!.position,
    ),
  );
}

it("Extend a line by a line: one 'Extend' action reaches the boundary; Undo and Redo replay it", async () => {
  const f = await createSketchWorkflow();
  try {
    const { before, target, boundary } = await twoLines(f, 50);
    const extended = await f.execute({
      operation: "sketch.geometry.update",
      draft: before.discovery!.state.draft,
      edit: { kind: "extend", target, boundary },
      intent: "fulfill",
    });
    expect(lines(extended), "the line now ends on the boundary").toEqual([
      [
        [0, 0],
        [50, 0],
      ],
      [
        [50, -15],
        [50, 15],
      ],
    ]);
    expect(labels(extended)).toEqual({
      undo: [...labels(before).undo, "Extend"],
      redo: [],
    });

    const undone = await f.execute({
      operation: "history.undo",
      draft: extended.discovery!.state.draft,
    });
    expect(lines(undone), "Undo restores the unextended line").toEqual(
      lines(before),
    );
    expect(labels(undone)).toEqual({
      undo: labels(before).undo,
      redo: ["Extend"],
    });

    const redone = await f.execute({
      operation: "history.redo",
      draft: undone.discovery!.state.draft,
    });
    expect(redone.discovery!.sketch!.entities).toEqual(
      extended.discovery!.sketch!.entities,
    );
    expect(lines(redone), "Redo replays the extension").toEqual(
      lines(extended),
    );
    expect(labels(redone)).toEqual(labels(extended));
  } finally {
    await f.close();
  }
}, 60000);

it("Split a line by a line: one 'Split' action leaves two pieces; Undo and Redo replay it", async () => {
  const f = await createSketchWorkflow();
  try {
    const { before, target, boundary } = await twoLines(f, 15);
    const split = await f.execute({
      operation: "sketch.geometry.update",
      draft: before.discovery!.state.draft,
      edit: { kind: "split", target, boundary, pick: [15, 0] },
      intent: "fulfill",
    });
    const pieces = lines(split);
    expect(pieces, "two line pieces and the boundary").toHaveLength(3);
    expect(pieces).toEqual(
      expect.arrayContaining([
        [
          [0, 0],
          [15, 0],
        ],
        [
          [15, 0],
          [30, 0],
        ],
        [
          [15, -15],
          [15, 15],
        ],
      ]),
    );
    expect(
      split.discovery!.sketch!.entities.map((e) => e.entityId),
      "the split line keeps its identity on one piece",
    ).toContain(target.kind === "sketchEntity" ? target.entityId : null);
    expect(labels(split)).toEqual({
      undo: [...labels(before).undo, "Split"],
      redo: [],
    });

    const undone = await f.execute({
      operation: "history.undo",
      draft: split.discovery!.state.draft,
    });
    expect(undone.discovery!.sketch!.entities).toEqual(
      before.discovery!.sketch!.entities,
    );
    expect(lines(undone), "Undo restores the single line").toEqual(
      lines(before),
    );
    expect(labels(undone)).toEqual({
      undo: labels(before).undo,
      redo: ["Split"],
    });

    const redone = await f.execute({
      operation: "history.redo",
      draft: undone.discovery!.state.draft,
    });
    expect(redone.discovery!.sketch!.entities).toEqual(
      split.discovery!.sketch!.entities,
    );
    expect(lines(redone), "Redo replays the split").toEqual(pieces);
    expect(labels(redone)).toEqual(labels(split));
  } finally {
    await f.close();
  }
}, 60000);
