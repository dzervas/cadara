import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";
import type { SemanticResult } from "@/contracts/semantic/schema";

// Lane: logic (docs/testing.md). Seam: the in-process semantic session.
// Migrated from the e2e row "document Undo/Redo preserves the original
// identity and later sketch history stays independent": a published sketch
// keeps its identity through document Undo/Redo, a later sketch gets a new
// identity, and re-entering it shows only its own private history.

const sketchIds = (result: SemanticResult) =>
  result.discovery!.model!.timeline!.flatMap((item) =>
    item.target.kind === "sketch" ? [item.target.sketchId] : [],
  );
const labels = (result: SemanticResult) => ({
  undo: result.discovery!.history!.undoEntries!.map((e) => e.label),
  redo: result.discovery!.history!.redoEntries!.map((e) => e.label),
});

test("document Undo/Redo preserves the original sketch identity and later sketch history stays independent", async () => {
  const w = await createSketchWorkflow();
  try {
    const publishLine = async (start: number[], end: number[]) => {
      await w.execute({
        operation: "sketch.author",
        draft: w.current().discovery!.state.draft,
        primitive: { kind: "line", start, end },
        construction: false,
        intent: "fulfill",
      });
      const published = await w.execute({
        operation: "sketch.publish",
        draft: w.current().discovery!.state.draft,
        requireProfiles: false,
      });
      return published.discovery!.sketch!.sketchId!;
    };

    const firstSketchId = await publishLine([-6, 4], [-3, 1]);
    expect(firstSketchId).toMatch(/^sketch_[0-9a-f-]{36}$/);
    expect(sketchIds(w.current())).toEqual([firstSketchId]);
    expect(labels(w.current())).toEqual({
      undo: ["Publish Sketch"],
      redo: [],
    });

    const undone = await w.execute({ operation: "history.undo", draft: null });
    expect(sketchIds(undone), "Undo removes the sketch").toEqual([]);
    expect(labels(undone)).toEqual({ undo: [], redo: ["Publish Sketch"] });

    const redone = await w.execute({ operation: "history.redo", draft: null });
    expect(sketchIds(redone), "Redo restores the original identity").toEqual([
      firstSketchId,
    ]);
    expect(labels(redone)).toEqual({ undo: ["Publish Sketch"], redo: [] });

    const undoneAgain = await w.execute({
      operation: "history.undo",
      draft: null,
    });
    expect(sketchIds(undoneAgain)).toEqual([]);

    await w.execute({ operation: "sketch.begin", plane: "xy" });
    const secondSketchId = await publishLine([2, 4], [5, 1]);
    expect(secondSketchId).toMatch(/^sketch_[0-9a-f-]{36}$/);
    expect(secondSketchId).not.toBe(firstSketchId);
    expect(sketchIds(w.current())).toEqual([secondSketchId]);

    const reopened = await w.execute({
      operation: "sketch.open",
      sketchId: secondSketchId,
    });
    expect(reopened.discovery!.sketch!.entities).toHaveLength(1);
    expect(
      labels(reopened),
      "re-entry shows only this sketch's retained private history",
    ).toEqual({ undo: ["Create Sketch Geometry"], redo: [] });

    const privateUndo = await w.execute({
      operation: "history.undo",
      draft: reopened.discovery!.state.draft,
    });
    expect(privateUndo.discovery!.sketch!.entities).toEqual([]);
    expect(labels(privateUndo)).toEqual({
      undo: [],
      redo: ["Create Sketch Geometry"],
    });
    expect(
      privateUndo.discovery!.state.revisionId,
      "private Undo writes nothing to the document",
    ).toBe(reopened.discovery!.state.revisionId);

    const privateRedo = await w.execute({
      operation: "history.redo",
      draft: privateUndo.discovery!.state.draft,
    });
    expect(privateRedo.discovery!.sketch!.entities).toEqual(
      reopened.discovery!.sketch!.entities,
    );
    expect(privateRedo.discovery!.sketch!.points).toEqual(
      reopened.discovery!.sketch!.points,
    );
    expect(labels(privateRedo)).toEqual(labels(reopened));
  } finally {
    await w.close();
  }
}, 60_000);
