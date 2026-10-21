// Logic lane; seam: the in-process semantic SDK over the headless session.
// `body.color.set` resolves a body label through the shared resolver, runs the
// production body-appearance mutation, persists the colour, reports it in
// discovery and undoes like any other model change; malformed appearances never
// reach the session.
import { expect, test } from "vitest";
import { createSemanticSessionWorkflow } from "../../../test/helpers/semantic-session-workflow";
import { SemanticDocument, SemanticOperationError } from "./sdk";

test("body.color.set recolours a body selected by label, persists and undoes", async () => {
  const workflow = await createSemanticSessionWorkflow("body-color");
  const doc = new SemanticDocument(workflow.session);
  try {
    await doc.ops.document.create({ label: "Colours" });
    await doc.ops.sketch.begin({ plane: "xy" });
    await doc.ops.sketch.author({
      primitive: { kind: "rectangle", start: [0, 0], end: [10, 10] },
      construction: false,
    });
    const published = await doc.ops.sketch.publish({ requireProfiles: true });
    const sketch = published.discovery!.sketch!;
    const solid = await doc.ops.extrude.create({
      profile: { kind: "region", sketchId: sketch.sketchId!, regionId: sketch.profiles[0]!.regionId },
      depth: 5,
    });
    const [body] = solid.discovery!.model!.bodies;
    expect(body!.appearance, "premise: the first body gets palette slot 0").toEqual({ kind: "palette", slot: 0 });
    const bodyLabel = doc.references({ kind: "body" })[0]!.label;

    const recoloured = await doc.ops.body.color.set({
      bodyId: { label: bodyLabel },
      appearance: { kind: "custom", hex: "#123abc" },
    });
    expect(recoloured.result.completion.persistence.kind).toBe("committed");
    expect(recoloured.result.changedTargets).toEqual([{ kind: "body", bodyId: body!.bodyId }]);
    expect(recoloured.discovery!.model!.bodies).toEqual([
      { ...body!, appearance: { kind: "custom", hex: "#123abc" } },
    ]);
    expect(doc.inspect(["bodies"]).bodies[0]!.appearance).toEqual({ kind: "custom", hex: "#123abc" });

    await doc.ops.body.color.set({ bodyId: body!.bodyId, appearance: { kind: "palette", slot: 4 } });
    expect(doc.inspect(["bodies"]).bodies[0]!.appearance).toEqual({ kind: "palette", slot: 4 });

    const undone = await doc.ops.history.undo({});
    expect(undone.discovery!.model!.bodies[0]!.appearance).toEqual({ kind: "custom", hex: "#123abc" });
    const reverted = await doc.ops.history.undo({});
    expect(reverted.discovery!.model!.bodies[0]!.appearance).toEqual({ kind: "palette", slot: 0 });
    expect(reverted.discovery!.model!.bodies[0]!.bounds).toEqual(body!.bounds);

    for (const appearance of [
      { kind: "custom", hex: "#ABCDEF" },
      { kind: "custom", hex: "red" },
      { kind: "palette", slot: 6 },
    ] as const) {
      await expect(
        // @ts-expect-error -- malformed appearances are the point of this check
        doc.ops.body.color.set({ bodyId: body!.bodyId, appearance }),
        JSON.stringify(appearance),
      ).rejects.toThrow("Invalid semantic command");
    }
    const missing = await doc.tryOp("body.color.set", {
      bodyId: "body_missing",
      appearance: { kind: "palette", slot: 1 },
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error).toBeInstanceOf(SemanticOperationError);
      expect((missing.error as SemanticOperationError).result.outcome.kind).toBe("rejected");
    }
    expect(doc.inspect(["bodies"]).bodies[0]!.appearance).toEqual({ kind: "palette", slot: 0 });
  } finally {
    await doc.close();
  }
}, 180_000);
