import { expect, test } from "vitest";
import { createHeadlessSessionFactory } from "@/composition/headless";
import { SemanticDocument } from "./sdk";
import type { SemanticSketchGeometryTarget } from "@/contracts/semantic/schema";

async function circles() {
  let saved = "";
  const opened = await createHeadlessSessionFactory({
    nativeFileIO: {
      read: async () => saved,
      write: async (_path, text) => {
        saved = text;
        return {
          kind: "written",
          bytesWritten: new TextEncoder().encode(text).length,
          diagnostics: [],
        };
      },
    },
  }).open();
  if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
  const doc = new SemanticDocument(opened.session, opened.initialization.state);
  try {
    await doc.ops.sketch.begin({ plane: "xy" });
    const targets: SemanticSketchGeometryTarget[] = [];
    for (let index = 0; index < 3; index++) {
      const result = await doc.ops.sketch.author({
        primitive: {
          kind: "circle",
          center: [index * 30, 0],
          radius: index + 2,
        },
        construction: false,
      });
      const entity = result.discovery!.sketch!.entities[index]!;
      const target = result.discovery!.references.find(
        (r) =>
          r.target.kind === "sketchEntity" &&
          r.target.entityId === entity.entityId,
      )!.target;
      if (target.kind !== "sketchEntity")
        throw new Error("Expected circle reference");
      targets.push(target);
    }
    for (const target of targets.slice(1))
      await doc.ops.sketch.requirement.add({
        tool: "constraintEqual",
        targets: [targets[0]!, target],
        mode: "driving",
        value: null,
      });
    await doc.ops.sketch.requirement.add({
      tool: "dimensionDistance",
      targets: [targets[0]!],
      mode: "driving",
      value: 16,
    });
    return { doc, targets, saved: () => saved };
  } catch (error) {
    await doc.close();
    throw error;
  }
}

test("SDK/CLI semantic equality resizes circles and survives native save/open", async () => {
  const { doc, saved } = await circles();
  try {
    const assertCircles = () => {
      const sketch = doc.current!.discovery!.sketch!;
      expect(sketch.entities).toHaveLength(3);
      for (const entity of sketch.entities)
        expect(entity.radius).toBeCloseTo(8, 5);
      expect(
        sketch.constraints.filter((c) => c.kind === "equalLength"),
      ).toMatchObject([{ status: "satisfied" }, { status: "satisfied" }]);
    };
    assertCircles();
    const published = await doc.ops.sketch.publish({ requireProfiles: true });
    const sketchId = published.discovery!.sketch!.sketchId!;
    await doc.ops.document.save({ path: "equal.cadara" });
    const stored = JSON.parse(saved());
    expect(
      stored.sketches[0].definition.constraints.filter(
        (c: { kind: string }) => c.kind === "equalLength",
      ),
    ).toHaveLength(2);
    await doc.ops.document.open({ path: "equal.cadara" });
    await doc.ops.sketch.open({ sketchId });
    assertCircles();
    expect(doc.current!.result.completion.geometry.kind).toBe("current");
  } finally {
    await doc.close();
  }
}, 60000);

test("semantic equality rejects mixed operands and reports conflicting driving circle sizes", async () => {
  const { doc, targets } = await circles();
  try {
    const line = await doc.ops.sketch.author({
      primitive: { kind: "line", start: [0, 20], end: [10, 20] },
      construction: false,
    });
    const entity = line.discovery!.sketch!.entities.find(
      (e) => e.kind === "lineSegment",
    )!;
    const target = line.discovery!.references.find(
      (r) =>
        r.target.kind === "sketchEntity" &&
        r.target.entityId === entity.entityId,
    )!.target;
    if (target.kind !== "sketchEntity")
      throw new Error("Expected line reference");
    const mixed = await doc.tryOp("sketch.requirement.add", {
      tool: "constraintEqual",
      targets: [targets[0]!, target],
      mode: "driving",
      value: null,
    });
    expect(mixed.ok).toBe(false);
    if (mixed.ok) throw new Error("Expected mixed operand refusal");
    expect(mixed.error).toMatchObject({
      result: { outcome: { kind: "rejected" } },
    });
    const conflict = await doc.ops.sketch.requirement.add({
      tool: "dimensionRadius",
      targets: [targets[1]!],
      mode: "driving",
      value: 11,
      intent: "author-invalid",
    });
    expect(conflict.result.outcome.kind).toBe("accepted-invalid");
    expect(conflict.result.completion.geometry.kind).toBe("invalid-editable");
    expect(conflict.result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "solver-requirement-unsatisfied" }),
    );
  } finally {
    await doc.close();
  }
}, 60000);
