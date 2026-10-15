import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("document variables add and update through the production owner with exact current handoff", async () => {
  const w = await createSketchWorkflow();
  try {
    const privateState = w.current().discovery!.state;
    const privateRefusal = await w.run({
      operation: "variable.add",
      name: "width",
      valueText: "12",
      intent: "fulfill",
    });
    expect(privateRefusal.outcome).toMatchObject({
      kind: "rejected",
      reasonCode: "editing-context",
    });
    expect(privateRefusal.completion.live.kind).toBe("unchanged");
    expect(privateRefusal.completion.persistence.kind).toBe("not-required");
    expect(privateRefusal.completion.live.state).toEqual(privateState);
    await w.execute({
      operation: "sketch.discard",
      draft: privateState.draft,
    });
    const added = await w.execute({
      operation: "variable.add",
      name: "width",
      valueText: "10 + 2",
      intent: "fulfill",
    });
    expect(added.discovery!.variables).toHaveLength(1);
    const variable = added.discovery!.variables![0]!;
    expect(variable).toMatchObject({ name: "width", valueText: "10 + 2" });
    expect(added.completion.persistence.kind).toBe("committed");
    expect(added.completion.handoff.kind).toBe("current");
    const updated = await w.execute({
      operation: "variable.update",
      variableId: variable.variableId,
      name: "width",
      valueText: "20",
      intent: "fulfill",
    });
    expect(updated.discovery!.variables![0]).toEqual({
      ...variable,
      valueText: "20",
    });
    expect(updated.completion.geometry.kind).toBe("current");
    const inspected = await w.execute({ operation: "document.inspect" });
    expect(inspected.discovery!.state).toEqual(updated.discovery!.state);
    expect(inspected.discovery!.variables).toEqual(
      updated.discovery!.variables,
    );
  } finally {
    await w.close();
  }
}, 120_000);
