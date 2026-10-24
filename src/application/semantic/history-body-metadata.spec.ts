// Logic lane; seam: the in-process semantic SDK over the headless session
// (production OCC adapter, durable history). cadara-xkg: Undo and Redo of a
// body rename or recolour apply the label or colour in place instead of
// restoring (rebuilding) the whole authored document; undoing a geometric
// change still restores it.
import { afterEach, expect, test, vi } from "vitest";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import { createSemanticSessionWorkflow } from "../../../test/helpers/semantic-session-workflow";
import { SemanticDocument } from "./sdk";

afterEach(() => {
  vi.restoreAllMocks();
});

async function extrudedBody(prefix: string) {
  const workflow = await createSemanticSessionWorkflow(prefix);
  const doc = new SemanticDocument(workflow.session);
  await doc.ops.document.create({ label: "Undo metadata" });
  await doc.ops.sketch.begin({ plane: "xy" });
  await doc.ops.sketch.author({
    primitive: { kind: "rectangle", start: [0, 0], end: [10, 10] },
    construction: false,
  });
  const published = await doc.ops.sketch.publish({ requireProfiles: true });
  const sketch = published.discovery!.sketch!;
  const solid = await doc.ops.extrude.create({
    profile: {
      kind: "region",
      sketchId: sketch.sketchId!,
      regionId: sketch.profiles[0]!.regionId,
    },
    depth: 5,
  });
  const [body] = solid.discovery!.model!.bodies;
  const featureId = solid.discovery!.model!.features[0]!.featureId;
  // Spy after setup: only restores caused by the history steps below count.
  const restore = vi.spyOn(
    OpenCascadeKernelAdapter.prototype,
    "restoreAuthoredModelDocument",
  );
  return { doc, body: body!, featureId, restore };
}

const bodyLabel = (doc: SemanticDocument) =>
  doc.references({ kind: "body" })[0]!.label;

test("undo and redo of a body rename apply the label without restoring the document", async () => {
  const { doc, body, restore } = await extrudedBody("undo-rename");
  try {
    const original = bodyLabel(doc);
    await doc.ops.body.rename({ bodyId: body.bodyId, label: "Renamed" });
    expect(bodyLabel(doc)).toBe("Renamed");

    await doc.ops.history.undo({});
    expect(bodyLabel(doc)).toBe(original);
    await doc.ops.history.redo({});
    expect(bodyLabel(doc)).toBe("Renamed");
    expect(restore).not.toHaveBeenCalled();
    expect(doc.inspect(["bodies"]).bodies[0]!.bounds).toEqual(body.bounds);

    // The in-place state is a valid basis for the next authored action.
    await doc.ops.body.rename({ bodyId: body.bodyId, label: "Again" });
    expect(bodyLabel(doc)).toBe("Again");
  } finally {
    await doc.close();
  }
}, 180_000);

test("undo and redo of a body recolour apply the colour without restoring the document", async () => {
  const { doc, body, restore } = await extrudedBody("undo-colour");
  try {
    const custom = { kind: "custom", hex: "#123abc" } as const;
    await doc.ops.body.color.set({ bodyId: body.bodyId, appearance: custom });

    const undone = await doc.ops.history.undo({});
    expect(undone.discovery!.model!.bodies[0]!.appearance).toEqual(
      body.appearance,
    );
    const redone = await doc.ops.history.redo({});
    expect(redone.discovery!.model!.bodies[0]!.appearance).toEqual(custom);
    expect(restore).not.toHaveBeenCalled();
  } finally {
    await doc.close();
  }
}, 180_000);

test("undo of a geometric change still restores the document", async () => {
  const { doc, body, featureId, restore } = await extrudedBody("undo-depth");
  try {
    await doc.ops.extrude.update({ featureId, depth: 8 });
    expect(doc.inspect(["bodies"]).bodies[0]!.bounds).not.toEqual(body.bounds);

    await doc.ops.history.undo({});
    expect(restore).toHaveBeenCalledTimes(1);
    expect(doc.inspect(["bodies"]).bodies[0]!.bounds).toEqual(body.bounds);
  } finally {
    await doc.close();
  }
}, 180_000);
