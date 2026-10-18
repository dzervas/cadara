import { expect, it } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

it("discovers the open draft identity before publication", async () => {
  const workflow = await createSketchWorkflow();
  try {
    const discovery = workflow.current().discovery!;
    const context = discovery.state.editingContext;
    if (context.kind !== "sketch") throw new Error("Expected a private sketch");
    expect(discovery.sketch!.sketchId).toBe(context.sketchId);
    expect(discovery.references).toContainEqual(
      expect.objectContaining({
        target: { kind: "sketch", sketchId: context.sketchId },
      }),
    );
  } finally {
    await workflow.close();
  }
});

it("consumes discovered point and dimension targets without dropping sketch ownership", async () => {
  const w = await createSketchWorkflow();
  try {
    await w.author({ kind: "rectangle", start: [0, 0], end: [20, 10] });
    const points = w
      .current()
      .discovery!.references.flatMap(({ target }) =>
        target.kind === "sketchPoint" ? [target] : [],
      );
    const added = await w.execute({
      operation: "sketch.dimension.add",
      draft: w.draft(),
      axis: "horizontal",
      points: points.slice(0, 2),
      mode: "driving",
      value: 30,
      intent: "fulfill",
    });
    expect(added.discovery!.sketch!.requirements[0]!.measuredValue).toBeCloseTo(
      30,
      6,
    );
    const dimension = added.discovery!.references.find(
      ({ target }) => target.kind === "dimension",
    )!.target;
    const updated = await w.execute({
      operation: "sketch.dimension.update",
      draft: w.draft(),
      dimensionId: dimension,
      value: 35,
      intent: "fulfill",
    });
    expect(
      updated.discovery!.sketch!.requirements[0]!.measuredValue,
    ).toBeCloseTo(35, 6);
    const measured = await w.execute({
      operation: "sketch.dimension.reference",
      draft: w.draft(),
      dimensionId: dimension,
      intent: "fulfill",
    });
    expect(measured.discovery!.sketch!.requirements).toEqual([]);
    expect(
      measured.discovery!.sketch!.measurements[0]!.measuredValue,
    ).toBeCloseTo(35, 6);
    const generation = w.draft()!.generation;
    const refused = await w.run({
      operation: "sketch.dimension.add",
      draft: w.draft(),
      axis: "vertical",
      points: [{ ...points[0]!, sketchId: "sketch_other" }, points[1]],
      mode: "reference",
      intent: "fulfill",
    });
    expect(refused.outcome.kind).toBe("rejected");
    expect(refused.completion.live.kind).toBe("unchanged");
    expect(refused.completion.live.state!.draft!.generation).toBe(generation);
  } finally {
    await w.close();
  }
});

it("scopes reference discovery to a draft or published sketch without mixing regions", async () => {
  const w = await createSketchWorkflow();
  try {
    await w.author({ kind: "circle", center: [0, 0], radius: 2 });
    const first = await w.execute({
      operation: "sketch.publish",
      draft: w.draft(),
      requireProfiles: true,
    });
    const firstTarget = {
      kind: "sketch",
      sketchId: first.discovery!.sketch!.sketchId!,
    } as const;
    await w.execute({ operation: "sketch.begin", plane: "yz" });
    await w.author({ kind: "circle", center: [0, 0], radius: 3 });
    const current = w.current().discovery!;
    const secondTarget = {
      kind: "sketch",
      sketchId: current.sketch!.sketchId!,
    } as const;
    const scoped = await w.execute({
      operation: "document.inspect",
      owner: secondTarget,
    });
    expect(
      scoped.discovery!.references.filter(
        ({ target }) => target.kind === "region",
      ),
    ).toHaveLength(1);
    expect(
      scoped.discovery!.references.every(
        (entry) =>
          "owner" in entry &&
          JSON.stringify(entry.owner) === JSON.stringify(secondTarget),
      ),
    ).toBe(true);
    const previous = await w.execute({
      operation: "document.inspect",
      owner: firstTarget,
    });
    expect(
      previous.discovery!.references.filter(
        ({ target }) => target.kind === "region",
      ),
    ).toHaveLength(1);
    expect(previous.discovery!.references).toContainEqual(
      expect.objectContaining({ target: firstTarget }),
    );
    expect(previous.discovery!.model).toEqual(scoped.discovery!.model);
    const missing = await w.execute({
      operation: "document.inspect",
      owner: { kind: "sketch", sketchId: "sketch_missing" },
    });
    expect(missing.discovery!.references).toEqual([]);
    expect(missing.discovery!.model).toEqual(scoped.discovery!.model);
    const all = await w.execute({ operation: "document.inspect" });
    expect(
      all.discovery!.references.filter(
        ({ target }) => target.kind === "region",
      ),
    ).toHaveLength(2);
    expect(
      all.discovery!.references.find(
        ({ target }) => target.kind === "construction",
      ),
    ).toMatchObject({ owner: null });
  } finally {
    await w.close();
  }
});

it("generates distinct point and point-entity labels while preserving authored ambiguity", async () => {
  const w = await createSketchWorkflow();
  try {
    const authored = await w.author({ kind: "point", position: [3, 4] });
    const references = authored.discovery!.references.filter(
      ({ target }) =>
        target.kind === "sketchPoint" || target.kind === "sketchEntity",
    );
    expect(references.map((entry) => entry.label).sort()).toEqual([
      "Point 1",
      "Point entity 1",
    ]);
    for (const reference of references) {
      await w.execute({
        operation: "sketch.label.set",
        draft: w.draft(),
        target: reference.target,
        label: "Chosen",
        intent: "fulfill",
      });
    }
    expect(
      w
        .current()
        .discovery!.references.filter((entry) => entry.label === "Chosen"),
    ).toHaveLength(2);
  } finally {
    await w.close();
  }
});
