import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("variable expressions drive sketch dimensions and native solid rebuilds rather than stale output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cadara-variable-native-"));
  const w = await createSketchWorkflow();
  try {
    await w.execute({
      operation: "sketch.discard",
      draft: w.current().discovery!.state.draft,
    });
    const base = await w.execute({
      operation: "variable.add",
      name: "base",
      valueText: "sqrt(81) + sin(pi / 2)",
      intent: "fulfill",
    });
    const baseId = base.discovery!.variables![0]!.variableId;
    const variable = await w.execute({
      operation: "variable.add",
      name: "size",
      valueText: "base - 7",
      intent: "fulfill",
    });
    const variableId = variable.discovery!.variables!.find(
      (v) => v.name === "size",
    )!.variableId;
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
    const dimensionId =
      dimension.discovery!.sketch!.requirements[0]!.dimensionId;
    const expression = await w.execute({
      operation: "sketch.dimension.update",
      draft: dimension.discovery!.state.draft,
      dimensionId,
      value: "size * 2",
      intent: "fulfill",
    });
    expect(
      expression.discovery!.sketch!.requirements[0]!.measuredValue,
    ).toBeCloseTo(6, 6);
    const published = await w.execute({
      operation: "sketch.publish",
      draft: expression.discovery!.state.draft,
      requireProfiles: true,
    });
    const sketch = published.discovery!.sketch!;
    const solid = await w.execute({
      operation: "extrude.create",
      profile: {
        kind: "region",
        sketchId: sketch.sketchId,
        regionId: sketch.profiles[0]!.regionId,
      },
      depth: "size + 4",
      intent: "fulfill",
    });
    expect(solid.discovery!.model!.bodies[0]!.bounds!.min).toEqual([-6, -6, 0]);
    expect(solid.discovery!.model!.bodies[0]!.bounds!.max).toEqual([6, 6, 7]);
    const rebuilt = await w.execute({
      operation: "variable.update",
      variableId: baseId,
      name: "base",
      valueText: "12",
      intent: "fulfill",
    });
    expect(rebuilt.discovery!.model!.bodies[0]!.bounds!.min).toEqual([
      -10, -10, 0,
    ]);
    expect(rebuilt.discovery!.model!.bodies[0]!.bounds!.max).toEqual([
      10, 10, 9,
    ]);
    expect(rebuilt.completion.geometry).toMatchObject({
      kind: "current",
      rebuildRevisionId: rebuilt.discovery!.state.revisionId,
    });
    const path = join(directory, "expressions.cadara.json");
    const saved = await w.execute({ operation: "document.save", path });
    expect(saved.completion.file.kind).toBe("written");
    await w.execute({ operation: "document.open", basis: null, path });
    expect(w.current().discovery!.variables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variableId,
          name: "size",
          valueText: "base - 7",
        }),
        expect.objectContaining({
          variableId: baseId,
          name: "base",
          valueText: "12",
        }),
      ]),
    );
    const retained = await w.execute({
      operation: "variable.update",
      variableId: baseId,
      name: "base",
      valueText: "13",
      intent: "fulfill",
    });
    expect(retained.discovery!.model!.bodies[0]!.bounds!.min).toEqual([
      -12, -12, 0,
    ]);
    expect(retained.discovery!.model!.bodies[0]!.bounds!.max).toEqual([
      12, 12, 10,
    ]);
    const reopened = await w.execute({
      operation: "sketch.open",
      sketchId: sketch.sketchId,
    });
    expect(reopened.discovery!.sketch!.requirements[0]!.dimensionId).toBe(
      dimensionId,
    );
    expect(
      reopened.discovery!.sketch!.requirements[0]!.measuredValue,
    ).toBeCloseTo(12, 6);
    expect(reopened.discovery!.sketch!.profiles).toHaveLength(1);
  } finally {
    await w.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);
