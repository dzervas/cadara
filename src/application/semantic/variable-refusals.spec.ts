import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("invalid names, duplicates, unresolved/cyclic/non-value/nonfinite expressions refuse without writing", async () => {
  const w = await createSketchWorkflow();
  try {
    await w.execute({
      operation: "sketch.discard",
      draft: w.current().discovery!.state.draft,
    });
    const added = await w.execute({
      operation: "variable.add",
      name: "size",
      valueText: "3",
      intent: "fulfill",
    });
    const variableId = added.discovery!.variables![0]!.variableId;
    await w.execute({
      operation: "variable.add",
      name: "twice",
      valueText: "size * 2",
      intent: "fulfill",
    });
    for (const input of [
      { operation: "variable.add", name: "bad name", valueText: "1" },
      { operation: "variable.add", name: "size", valueText: "1" },
      { operation: "variable.add", name: "other", valueText: "missing + 1" },
      { operation: "variable.add", name: "other", valueText: "1 / 0" },
      { operation: "variable.add", name: "other", valueText: "x = 4" },
      { operation: "variable.add", name: "other", valueText: "(" },
      { operation: "variable.add", name: "other", valueText: "2 cm" },
      {
        operation: "variable.update",
        variableId,
        name: "size",
        valueText: "twice",
      },
      {
        operation: "variable.update",
        variableId,
        name: "renamed",
        valueText: "3",
      },
      {
        operation: "variable.update",
        variableId: "variable_absent",
        name: "size",
        valueText: "8",
      },
    ]) {
      const before = w.current().discovery!;
      const refused = await w.run({ ...input, intent: "author-invalid" });
      expect(refused.outcome.kind, JSON.stringify(refused)).toBe("rejected");
      expect(refused.diagnostics.some((d) => d.severity === "error")).toBe(
        true,
      );
      expect(refused.completion.live.kind).toBe("unchanged");
      expect(refused.completion.persistence.kind).toBe("not-required");
      const inspected = await w.execute({ operation: "document.inspect" });
      expect(inspected.discovery!.state).toEqual(before.state);
      expect(inspected.discovery!.variables).toEqual(before.variables);
      expect(inspected.discovery!.history).toEqual(before.history);
    }
    const stale = await w.run({
      operation: "variable.update",
      variableId,
      name: "size",
      valueText: "8",
      basis: {
        documentId: added.discovery!.state.documentId,
        revisionId: added.discovery!.state.revisionId,
        repositoryHeads: added.discovery!.state.repositoryHeads,
      },
      intent: "fulfill",
    });
    expect(stale.outcome.kind).toBe("conflicted");
    expect(stale.completion.live.kind).toBe("unchanged");
  } finally {
    await w.close();
  }
}, 120_000);

test("invalid variable-driven published sketches cannot certify stale geometry without a solid", async () => {
  const w = await createSketchWorkflow();
  try {
    await w.execute({
      operation: "sketch.discard",
      draft: w.current().discovery!.state.draft,
    });
    const variable = await w.execute({
      operation: "variable.add",
      name: "radius",
      valueText: "3",
      intent: "fulfill",
    });
    const variableId = variable.discovery!.variables![0]!.variableId;
    await w.execute({ operation: "sketch.begin", plane: "xy" });
    const circle = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [0, 0], radius: 3 },
      construction: false,
      intent: "fulfill",
    });
    const target = circle.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const dimension = await w.execute({
      operation: "sketch.requirement.add",
      draft: circle.discovery!.state.draft,
      tool: "dimensionRadius",
      targets: [target],
      mode: "driving",
      value: 3,
      intent: "fulfill",
    });
    await w.execute({
      operation: "sketch.dimension.update",
      draft: dimension.discovery!.state.draft,
      dimensionId: dimension.discovery!.sketch!.requirements[0]!.dimensionId,
      value: "radius",
      intent: "fulfill",
    });
    await w.execute({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: true,
    });
    const invalid = await w.run({
      operation: "variable.update",
      variableId,
      name: "radius",
      valueText: "-2",
      intent: "fulfill",
    });
    expect(invalid.outcome, JSON.stringify(invalid)).toMatchObject({
      kind: "failed",
      failures: expect.arrayContaining(["geometry"]),
    });
    expect(invalid.completion.live.kind).toBe("applied");
    expect(invalid.completion.persistence.kind).toBe("committed");
    expect(invalid.completion.geometry.kind).toBe("failed");
    const accepted = await w.run({
      operation: "variable.update",
      variableId,
      name: "radius",
      valueText: "-3",
      intent: "author-invalid",
    });
    expect(accepted.outcome.kind, JSON.stringify(accepted)).toBe(
      "accepted-invalid",
    );
    expect(accepted.completion.geometry.kind).toBe("invalid-editable");
    await w.execute({
      operation: "variable.update",
      variableId,
      name: "radius",
      valueText: "4",
      intent: "fulfill",
    });
  } finally {
    await w.close();
  }
}, 180_000);

test("applied variable changes with invalid downstream expressions never certify last-good solid geometry", async () => {
  const w = await createSketchWorkflow();
  try {
    await w.execute({
      operation: "sketch.discard",
      draft: w.current().discovery!.state.draft,
    });
    const variable = await w.execute({
      operation: "variable.add",
      name: "height",
      valueText: "7",
      intent: "fulfill",
    });
    const variableId = variable.discovery!.variables![0]!.variableId;
    await w.execute({ operation: "sketch.begin", plane: "xy" });
    const circle = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [0, 0], radius: 2 },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: circle.discovery!.state.draft,
      requireProfiles: true,
    });
    const sketch = published.discovery!.sketch!;
    await w.execute({
      operation: "extrude.create",
      profile: {
        kind: "region",
        sketchId: sketch.sketchId,
        regionId: sketch.profiles[0]!.regionId,
      },
      depth: "height",
      intent: "fulfill",
    });
    const invalid = await w.run({
      operation: "variable.update",
      variableId,
      name: "height",
      valueText: "-2",
      intent: "fulfill",
    });
    expect(invalid.outcome).toMatchObject({
      kind: "failed",
      failures: expect.arrayContaining(["geometry"]),
    });
    expect(invalid.completion.live.kind).toBe("applied");
    expect(invalid.completion.persistence.kind).toBe("committed");
    expect(invalid.completion.geometry.kind).toBe("failed");
    expect(
      invalid.discovery!.model!.bodies.every((b) => b.bounds === null),
    ).toBe(true);
    expect(invalid.diagnostics, JSON.stringify(invalid.diagnostics)).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: "error" })]),
    );
    const accepted = await w.run({
      operation: "variable.update",
      variableId,
      name: "height",
      valueText: "-3",
      intent: "author-invalid",
    });
    expect(accepted.outcome.kind).toBe("accepted-invalid");
    expect(accepted.completion.geometry.kind).toBe("invalid-editable");
    expect(accepted.discovery!.variables![0]!.valueText).toBe("-3");
    const restored = await w.execute({
      operation: "variable.update",
      variableId,
      name: "height",
      valueText: "9",
      intent: "fulfill",
    });
    expect(restored.discovery!.model!.bodies[0]!.bounds!.max).toEqual([
      2, 2, 9,
    ]);
  } finally {
    await w.close();
  }
}, 180_000);
