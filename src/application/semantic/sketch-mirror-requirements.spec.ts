import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("copy-side requirements size the shared original, duplicate drivers refuse and references measure both sides", async () => {
  const w = await createSketchWorkflow();
  try {
    const source = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [4, 3], radius: 2 },
      construction: false,
      intent: "fulfill",
    });
    const seed = source.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const mirrored = await w.execute({
      operation: "sketch.mirror.create",
      draft: source.discovery!.state.draft,
      targets: [seed],
      axis: source.discovery!.sketch!.operands.find(
        (r) => r.label === "Sketch Y axis",
      )!.target,
      intent: "fulfill",
    });
    const copyId = mirrored.discovery!.sketch!.mirrors[0]!.outputEntityIds[0];
    const copy = mirrored.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity" && r.target.entityId === copyId,
    )!.target;
    const sized = await w.execute({
      operation: "sketch.requirement.add",
      draft: mirrored.discovery!.state.draft,
      tool: "dimensionRadius",
      targets: [copy],
      mode: "driving",
      value: 5,
      intent: "fulfill",
    });
    expect(
      sized.discovery!.sketch!.mirrors[0]!.currentGeometry![0]!.radius,
    ).toBeCloseTo(5, 7);
    expect(sized.discovery!.sketch!.mirrors[0]!.sizingRequirementCount).toBe(1);
    const referenced = await w.execute({
      operation: "sketch.requirement.add",
      draft: sized.discovery!.state.draft,
      tool: "dimensionRadius",
      targets: [seed],
      mode: "reference",
      value: null,
      intent: "fulfill",
    });
    expect(
      referenced.discovery!.sketch!.measurements[0]!.measuredValue,
    ).toBeCloseTo(5, 7);
    const dimensionId =
      referenced.discovery!.sketch!.requirements[0]!.dimensionId;
    const changed = await w.execute({
      operation: "sketch.dimension.update",
      draft: referenced.discovery!.state.draft,
      dimensionId,
      value: 7,
      intent: "fulfill",
    });
    expect(
      changed.discovery!.sketch!.mirrors[0]!.currentGeometry![0]!.radius,
    ).toBeCloseTo(7, 7);
    expect(
      changed.discovery!.sketch!.measurements[0]!.measuredValue,
    ).toBeCloseTo(7, 7);
    const duplicate = await w.run({
      operation: "sketch.requirement.add",
      draft: changed.discovery!.state.draft,
      tool: "dimensionRadius",
      targets: [seed],
      mode: "driving",
      value: 8,
      intent: "fulfill",
    });
    expect(duplicate.outcome.kind).toBe("rejected");
    expect(duplicate.completion.live.kind).toBe("unchanged");
    const inspected = await w.execute({
      operation: "sketch.inspect",
      draft: changed.discovery!.state.draft,
    });
    expect(inspected.discovery!.sketch!.requirements).toEqual(
      changed.discovery!.sketch!.requirements,
    );
    expect(inspected.discovery!.history!.undoEntries!).toEqual(
      changed.discovery!.history!.undoEntries!,
    );
    const undo = await w.execute({
      operation: "history.undo",
      draft: inspected.discovery!.state.draft,
    });
    expect(
      undo.discovery!.sketch!.mirrors[0]!.currentGeometry![0]!.radius,
    ).toBeCloseTo(5, 7);
    expect(undo.discovery!.sketch!.measurements[0]!.measuredValue).toBeCloseTo(
      5,
      7,
    );
  } finally {
    await w.close();
  }
}, 120_000);

test("incompatible requirements on coupled points block current profiles, undo restores native geometry", async () => {
  const w = await createSketchWorkflow();
  try {
    const source = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [4, 3], radius: 2 },
      construction: false,
      intent: "fulfill",
    });
    const seed = source.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const mirrored = await w.execute({
      operation: "sketch.mirror.create",
      draft: source.discovery!.state.draft,
      targets: [seed],
      axis: source.discovery!.sketch!.operands.find(
        (r) => r.label === "Sketch Y axis",
      )!.target,
      intent: "fulfill",
    });
    const points = mirrored
      .discovery!.references.filter((r) => r.target.kind === "sketchPoint")
      .map((r) => r.target);
    const fixed = await w.execute({
      operation: "sketch.requirement.add",
      draft: mirrored.discovery!.state.draft,
      tool: "constraintFix",
      targets: [points[0]],
      mode: "driving",
      value: null,
      intent: "fulfill",
    });
    const conflicted = await w.run({
      operation: "sketch.requirement.add",
      draft: fixed.discovery!.state.draft,
      tool: "constraintCoincident",
      targets: points,
      mode: "driving",
      value: null,
      intent: "author-invalid",
    });
    expect(conflicted.outcome.kind).toBe("accepted-invalid");
    expect(conflicted.discovery!.sketch!.profiles).toHaveLength(0);
    expect(
      conflicted.discovery!.sketch!.mirrors[0]!.currentGeometry,
    ).toBeNull();
    expect(conflicted.completion.geometry.kind).not.toBe("current");
    const publish = await w.run({
      operation: "sketch.publish",
      draft: conflicted.discovery!.state.draft,
      requireProfiles: true,
    });
    expect(publish.outcome.kind).toBe("rejected");
    expect(publish.completion.live.kind).toBe("unchanged");
    const undo = await w.execute({
      operation: "history.undo",
      draft: conflicted.discovery!.state.draft,
    });
    expect(undo.discovery!.sketch!.profiles).toHaveLength(2);
    expect(undo.discovery!.sketch!.constraints).toHaveLength(
      fixed.discovery!.sketch!.constraints.length,
    );
    expect(
      undo.discovery!.sketch!.mirrors[0]!.currentGeometry![0]!.points[0]!
        .position,
    ).toEqual([-4, 3]);
  } finally {
    await w.close();
  }
}, 120_000);
