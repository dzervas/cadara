import { expect, it } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

it("authors a radius requirement through the public command and updates its solved geometry", async () => {
  const f = await createSketchWorkflow();
  try {
    const circle = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [0, 0], radius: 5 },
      construction: false,
      intent: "fulfill",
    });
    const target = circle.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const added = await f.execute({
      operation: "sketch.requirement.add",
      draft: circle.discovery!.state.draft,
      tool: "dimensionRadius",
      targets: [target],
      mode: "driving",
      value: 8,
      intent: "fulfill",
    });
    expect(added.discovery!.sketch!.entities[0]!.radius).toBeCloseTo(8, 6);
    const requirement = added.discovery!.sketch!.requirements[0]!;
    expect(requirement.value).toBe(8);
    expect(requirement.measuredValue).toBeCloseTo(8, 6);
    const updated = await f.execute({
      operation: "sketch.dimension.update",
      draft: added.discovery!.state.draft,
      dimensionId: requirement.dimensionId,
      value: 12,
      intent: "fulfill",
    });
    expect(updated.discovery!.sketch!.entities[0]!.radius).toBeCloseTo(12, 6);
  } finally {
    await f.close();
  }
}, 60000);

it("constrains an existing line horizontally, exposes the requirement and removes it as an undoable action", async () => {
  const f = await createSketchWorkflow();
  try {
    const line = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: { kind: "line", start: [0, 0], end: [10, 2] },
      construction: false,
      intent: "fulfill",
    });
    const target = line.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const added = await f.execute({
      operation: "sketch.requirement.add",
      draft: line.discovery!.state.draft,
      tool: "constraintHorizontal",
      targets: [target],
      mode: "driving",
      value: null,
      intent: "fulfill",
    });
    const points = added.discovery!.sketch!.points;
    expect(points[0]!.position[1]).toBeCloseTo(points[1]!.position[1], 6);
    expect(added.discovery!.sketch!.constraints).toMatchObject([
      { kind: "horizontal", status: "satisfied" },
    ]);
    const ref = added.discovery!.references.find(
      (r) => r.target.kind === "constraint",
    )!.target;
    const removed = await f.execute({
      operation: "sketch.requirement.remove",
      draft: added.discovery!.state.draft,
      targets: [ref],
      intent: "fulfill",
    });
    expect(removed.discovery!.sketch!.constraints).toEqual([]);
    const restored = await f.execute({
      operation: "history.undo",
      draft: removed.discovery!.state.draft,
    });
    expect(restored.discovery!.references).toContainEqual({
      label: added.discovery!.sketch!.constraints[0]!.label,
      target: ref,
    });
  } finally {
    await f.close();
  }
}, 60000);
