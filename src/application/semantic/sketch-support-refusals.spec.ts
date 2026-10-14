import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("refuses self, duplicate, missing and stale reference sources without authoring another action", async () => {
  const w = await createSketchWorkflow();
  try {
    const local = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "point", position: [2, 3] },
      construction: false,
      intent: "fulfill",
    });
    const own = local.discovery!.references.find(
      (r) => r.target.kind === "sketchPoint",
    )!.target;
    const draft = local.discovery!.state.draft;
    const priorActions = local.discovery!.history!.undoEntries;
    const self = await w.run({
      operation: "sketch.reference.add",
      draft,
      target: own,
      intent: "fulfill",
    });
    expect(self.outcome.kind).toBe("rejected");
    const missing = await w.run({
      operation: "sketch.reference.add",
      draft,
      target: { kind: "edge", bodyId: "body_absent", edgeId: "edge_absent" },
      intent: "fulfill",
    });
    expect(missing.outcome.kind).toBe("rejected");
    const inspected = await w.execute({ operation: "sketch.inspect", draft });
    expect(inspected.discovery!.sketch!.references).toHaveLength(0);
    expect(inspected.discovery!.history!.undoEntries).toEqual(priorActions);
    const published = await w.execute({
      operation: "sketch.publish",
      draft,
      requireProfiles: false,
    });
    const source = published.discovery!.references.find(
      (r) => r.target.kind === "sketchPoint",
    )!.target;
    await w.execute({ operation: "sketch.begin", plane: "xy" });
    const oldDraft = w.current().discovery!.state.draft;
    const projected = await w.execute({
      operation: "sketch.reference.add",
      draft: oldDraft,
      target: source,
      intent: "fulfill",
    });
    const duplicate = await w.run({
      operation: "sketch.reference.add",
      draft: projected.discovery!.state.draft,
      target: source,
      intent: "fulfill",
    });
    expect(duplicate.outcome.kind).toBe("rejected");
    const stale = await w.run({
      operation: "sketch.reference.add",
      draft: oldDraft,
      target: source,
      intent: "fulfill",
    });
    expect(stale.outcome.kind).toBe("conflicted");
    const after = await w.execute({
      operation: "sketch.inspect",
      draft: projected.discovery!.state.draft,
    });
    expect(after.discovery!.sketch!.references).toEqual(
      projected.discovery!.sketch!.references,
    );
    expect(after.discovery!.history!.undoEntries).toEqual(
      projected.discovery!.history!.undoEntries,
    );
  } finally {
    await w.close();
  }
}, 180_000);

test("same-support reassignment is unchanged and never fabricates a committed write", async () => {
  const w = await createSketchWorkflow();
  try {
    const circle = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [4, 3], radius: 2 },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: circle.discovery!.state.draft,
      requireProfiles: true,
    });
    const unchanged = await w.execute({
      operation: "sketch.support.reassign",
      sketchId: published.discovery!.sketch!.sketchId,
      support: {
        kind: "construction",
        constructionId: "construction_plane-xy",
      },
    });
    expect(unchanged.outcome).toEqual({
      kind: "completed",
      change: "unchanged",
    });
    expect(unchanged.completion.live.kind).toBe("unchanged");
    expect(unchanged.completion.persistence.kind).toBe("not-required");
    expect(unchanged.discovery!.state).toEqual(published.discovery!.state);
    expect(unchanged.discovery!.history!.undoEntries).toEqual(
      published.discovery!.history!.undoEntries,
    );
  } finally {
    await w.close();
  }
}, 180_000);
